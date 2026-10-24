import type { Registry } from './registry';
import type { Entity, Vec2, WorldViewport } from '../core/types';
import { Terrain, WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { number, record, reference } from '../core/validation';
import type { World } from '../core/world';

export const UFO_ID = 'core:ufo';
export const UFO = { speed: 11, altitude: 9, health: 900, charge: 0.55, beam: 1.1, recover: 0.55,
  contact: 0.16, radius: 2.6, cooldown: 2.2 } as const;
export interface UfoState {
  age: number; offset: number; vx: number; vy: number;
  goalX: number; goalY: number; targetId: number | null; thinkIn: number; attackIn: number;
  phase: 'cruise' | 'charge' | 'beam' | 'recover'; phaseTime: number;
  arrival?: { fromX: number; fromY: number; elapsed: number; duration: number };
}
declare module '../core/types' { interface ComponentMap { ufo: UfoState } }

const prey = (entity: Entity): boolean => !!entity.components.health && !!entity.components.combustible
  && !entity.components.explosive;
const ease = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** A saved world-space path remains fixed when the camera pans or the game reloads. */
export function ufoGroundPosition(position: Vec2, state: UfoState): Vec2 {
  if (!state.arrival) return position;
  const { fromX, fromY, elapsed, duration } = state.arrival;
  const remaining = (1 - Math.min(1, elapsed / duration)) ** 3;
  return { x: state.goalX + (fromX - state.goalX) * remaining,
    y: state.goalY + (fromY - state.goalY) * remaining };
}

/** The beam and the hull share one emitter; height never rotates with the flight direction. */
export function ufoPose(position: Vec2, state: UfoState) {
  const ground = ufoGroundPosition(position, state);
  const time = state.age + state.offset;
  const altitude = UFO.altitude + Math.sin(time * 2.7) * 0.18 + Math.sin(time * 1.3) * 0.08;
  const bank = state.vx / UFO.speed * 0.22 + Math.sin(time * 2.1) * 0.025;
  const pitch = state.vy / UFO.speed * 0.14;
  const charge = state.phase === 'charge' ? ease(state.phaseTime / UFO.charge) : state.phase === 'beam' ? 1 : 0;
  const extension = state.phase === 'beam' ? ease(state.phaseTime / UFO.contact) : 0;
  const strength = state.phase === 'beam' ? 1 - ease((state.phaseTime - UFO.beam + 0.32) / 0.32) : 0;
  const emitter = { x: ground.x, y: ground.y - altitude + 0.65 };
  return { time, ground, altitude, bank, pitch, charge, extension, strength, emitter,
    tip: { x: ground.x, y: emitter.y + (ground.y - emitter.y) * extension } };
}

function summon(world: World, point: Vec2, viewport?: WorldViewport): string | void {
  const entity = world.spawn(UFO_ID, point);
  if (!entity) return 'Too many objects in the world';
  const view = viewport && [viewport.left, viewport.top, viewport.right, viewport.bottom].every(v => number(v, -1e6, 1e6))
    && viewport.left <= point.x && viewport.right >= point.x && viewport.top <= point.y && viewport.bottom >= point.y
    ? viewport : { left: 0, top: 0, right: world.terrain.width, bottom: world.terrain.height };
  const corner = Math.floor(world.rng.range(0, 4)), margin = 6;
  const fromX = corner % 2 ? view.right + margin : view.left - margin;
  // The lower corners include altitude so the entire hull starts below the screen.
  const fromY = corner < 2 ? view.top - margin : view.bottom + UFO.altitude + margin;
  const distance = Math.hypot(point.x - fromX, point.y - fromY);
  const state = entity.components.ufo!;
  state.arrival = { fromX, fromY, elapsed: 0, duration: Math.max(1.5, Math.min(4, distance / (UFO.speed * 3))) };
  locateArrival(world, entity);
}

function locateArrival(world: World, entity: Entity): void {
  const p = entity.components.position!, state = entity.components.ufo!, arrival = state.arrival!;
  const ground = ufoGroundPosition(p, state);
  // Off-map travel has a separate render position; the spatial index stays inside the world.
  p.x = Math.max(0, Math.min(world.terrain.width - 0.001, ground.x));
  p.y = Math.max(0, Math.min(world.terrain.height - 0.001, ground.y));
  const dx = state.goalX - arrival.fromX, dy = state.goalY - arrival.fromY, distance = Math.hypot(dx, dy) || 1;
  const speed = Math.min(UFO.speed, distance * 3 / arrival.duration * (1 - arrival.elapsed / arrival.duration) ** 2);
  state.vx = dx / distance * speed; state.vy = dy / distance * speed;
  world.spatial.update(entity);
}

function wander(world: World, p: Vec2, state: UfoState): void {
  const angle = world.rng.range(0, Math.PI * 2), distance = world.rng.range(14, 32);
  state.goalX = Math.max(1, Math.min(world.terrain.width - 1, p.x + Math.cos(angle) * distance));
  state.goalY = Math.max(1, Math.min(world.terrain.height - 1, p.y + Math.sin(angle) * distance));
}

function strike(world: World, p: Vec2): void {
  world.events.push({ kind: 'surface', ...p, radius: UFO.radius, terrain: Terrain.Scorched },
    { kind: 'surface', ...p, radius: 1, terrain: Terrain.Crater });
  world.visual({ kind: 'blast', ...p, radius: UFO.radius });
  for (const victim of world.nearby(p, UFO.radius)) {
    // Ground strikes cannot hit the saucer hovering above their impact point.
    if (victim.components.ufo || victim.components.dragon || victim.components.projectile) continue;
    const q = victim.components.position!, force = 1 - Math.hypot(q.x - p.x, q.y - p.y) / UFO.radius;
    world.events.push({ kind: 'heat', target: victim.id, amount: 140 * force },
      { kind: 'damage', target: victim.id, amount: 300 * force });
  }
}

function fly(world: World, dt: number): void {
  for (const entity of world.query('ufo', 'position')) {
    const p = entity.components.position!, state = entity.components.ufo!;
    state.age += dt; state.attackIn = Math.max(0, state.attackIn - dt);
    state.thinkIn = Math.max(0, state.thinkIn - dt);
    if (state.arrival) {
      state.arrival.elapsed = Math.min(state.arrival.duration, state.arrival.elapsed + dt);
      locateArrival(world, entity);
      if (state.arrival.elapsed === state.arrival.duration) {
        p.x = state.goalX; p.y = state.goalY; state.vx = state.vy = 0;
        delete state.arrival; world.spatial.update(entity);
      }
      continue;
    }
    if (state.phase !== 'cruise') {
      const before = state.phaseTime;
      state.phaseTime += dt;
      if (state.phase === 'beam' && before < UFO.contact && state.phaseTime >= UFO.contact) strike(world, p);
      if (state.phaseTime + 1e-9 >= UFO[state.phase]) {
        if (state.phase === 'charge') state.phase = 'beam';
        else if (state.phase === 'beam') state.phase = 'recover';
        else {
          state.phase = 'cruise'; state.targetId = null; state.attackIn = UFO.cooldown;
          wander(world, p, state); state.thinkIn = 0;
        }
        state.phaseTime = 0;
      }
      continue;
    }
    let target = world.entities.get(state.targetId ?? -1);
    if (!target || !prey(target)) { target = undefined; state.targetId = null; }
    if (state.thinkIn === 0) {
      if (state.attackIn === 0) {
        let best = Infinity;
        for (const candidate of world.nearby(p, 64)) {
          if (!prey(candidate)) continue;
          const q = candidate.components.position!;
          const score = Math.hypot(q.x - p.x, q.y - p.y) + (candidate.components.dwelling ? -8 : candidate.components.person ? 0 : 10)
            + (candidate.components.thermal?.burning ? 18 : 0);
          if (score < best) { best = score; target = candidate; }
        }
        state.targetId = target?.id ?? null;
      }
      if (target) { state.goalX = target.components.position!.x; state.goalY = target.components.position!.y; }
      else if (Math.hypot(state.goalX - p.x, state.goalY - p.y) < 1) wander(world, p, state);
      state.thinkIn = 0.4;
    }
    const dx = state.goalX - p.x, dy = state.goalY - p.y, distance = Math.hypot(dx, dy);
    // Arrive with continuous acceleration and braking instead of snapping between waypoints.
    const speed = Math.min(UFO.speed, distance * 2.5), blend = 1 - Math.exp(-dt * 4);
    state.vx += (dx / (distance || 1) * speed - state.vx) * blend;
    state.vy += (dy / (distance || 1) * speed - state.vy) * blend;
    p.x = Math.max(0.5, Math.min(world.terrain.width - 0.5, p.x + state.vx * dt));
    p.y = Math.max(0.5, Math.min(world.terrain.height - 0.5, p.y + state.vy * dt));
    if (p.x === 0.5 || p.x === world.terrain.width - 0.5) state.vx = 0;
    if (p.y === 0.5 || p.y === world.terrain.height - 0.5) state.vy = 0;
    world.spatial.update(entity);
    if (target && state.attackIn === 0 && Math.hypot(target.components.position!.x - p.x, target.components.position!.y - p.y) < 0.45
      && Math.hypot(state.vx, state.vy) < 1) {
      state.vx = state.vy = 0; state.phase = 'charge'; state.phaseTime = 0;
    }
  }
}

export function registerUfos(registry: Registry): void {
  registry.registerComponent('ufo', v => number(v.age, 0, 1e8) && number(v.offset, 0, 100)
    && number(v.vx, -UFO.speed, UFO.speed) && number(v.vy, -UFO.speed, UFO.speed)
    && number(v.goalX, 0, WORLD_WIDTH) && number(v.goalY, 0, WORLD_HEIGHT) && reference(v.targetId)
    && number(v.thinkIn, 0, 0.4) && number(v.attackIn, 0, UFO.cooldown)
    && (v.arrival === undefined || record(v.arrival) && v.phase === 'cruise' && v.targetId === null
      && number(v.arrival.fromX, -1000020, 1000020) && number(v.arrival.fromY, -1000020, 1000020)
      && number(v.arrival.duration, 1.5, 4) && number(v.arrival.elapsed, 0, v.arrival.duration))
    && (v.phase === 'cruise' ? v.phaseTime === 0
      : (v.phase === 'charge' || v.phase === 'beam' || v.phase === 'recover') && number(v.phaseTime, 0, UFO[v.phase])));
  registry.registerEntity({ id: UFO_ID, sprite: 'ufo', create: (position, rng) => ({
    position: { ...position }, health: { current: UFO.health, max: UFO.health },
    ufo: { age: 0, offset: rng.range(0, 100), vx: 0, vy: 0, goalX: position.x, goalY: position.y,
      targetId: null, thinkIn: 0, attackIn: 0, phase: 'cruise', phaseTime: 0 },
  }) });
  registry.registerSystem({ id: 'core:ufos', after: ['core:movement'], before: ['core:settlement'], update: fly });
  registry.registerTool({ id: UFO_ID, category: 'destruction', icon: 'ufo', label: 'Flying saucer', radius: 2, showArea: false, color: '#b4ef65',
    hint: 'Call in a flying saucer from a screen corner. It hovers over its targets and fires a destructive green beam.',
    apply: summon,
  });
}
