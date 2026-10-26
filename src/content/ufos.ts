import { lawEnabled } from '../core/world-rules';
import { statusStops } from '../core/status-effects';
import type { Registry } from './registry';
import type { Entity, Vec2, WorldViewport } from '../core/types';
import { Terrain, WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { number, record, reference } from '../core/validation';
import type { World } from '../core/world';

export const UFO_ID = 'core:ufo';
export const UFO = { speed: 11, altitude: 9, health: 900, charge: 0.55, beam: 1.1, recover: 0.55,
  contact: 0.16, radius: 2.6, cooldown: 2.2, lifetime: 35 } as const;
interface Departure {
  fromX: number; fromY: number; toX: number; toY: number;
  vx: number; vy: number; elapsed: number; duration: number;
}
export interface UfoState {
  age: number; offset: number; vx: number; vy: number;
  goalX: number; goalY: number; targetId: number | null; thinkIn: number; attackIn: number;
  phase: 'cruise' | 'charge' | 'beam' | 'recover'; phaseTime: number;
  arrival?: { fromX: number; fromY: number; elapsed: number; duration: number };
  returnPoint?: Vec2;
  departure?: Departure;
}
declare module '../core/types' { interface ComponentMap { ufo: UfoState } }

const viewports = new WeakMap<World, WorldViewport>();
/** The host supplies camera bounds without making rendering advance the simulation. */
export function setUfoViewport(world: World, viewport: WorldViewport): void { viewports.set(world, viewport); }
const currentView = (world: World): WorldViewport => viewports.get(world)
  ?? { left: 0, top: 0, right: world.terrain.width, bottom: world.terrain.height };
const prey = (entity: Entity): boolean => !!entity.components.health && !!entity.components.combustible
  && !entity.components.explosive;
const ease = (t: number): number => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/** A saved world-space path remains fixed when the camera pans or the game reloads. */
export function ufoGroundPosition(position: Vec2, state: UfoState): Vec2 {
  if (state.departure) {
    const d = state.departure, t = Math.min(1, d.elapsed / d.duration);
    // Preserve the initial velocity, then accelerate away without braking at the screen edge.
    const inertia = d.duration * t * (1 - t) ** 2;
    return { x: d.fromX + (d.toX - d.fromX) * t * t + d.vx * inertia,
      y: d.fromY + (d.toY - d.fromY) * t * t + d.vy * inertia };
  }
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
  setUfoViewport(world, view);
  state.returnPoint = { x: fromX, y: fromY };
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

function depart(world: World, entity: Entity, direction?: Vec2): void {
  const state = entity.components.ufo!, from = ufoGroundPosition(entity.components.position!, state), view = currentView(world);
  const back = state.returnPoint ?? { x: from.x < world.terrain.width / 2 ? -6 : world.terrain.width + 6,
    y: from.y < world.terrain.height / 2 ? -6 : world.terrain.height + UFO.altitude + 6 };
  let dx = direction?.x ?? back.x - from.x, dy = direction?.y ?? back.y - from.y;
  if (Math.hypot(dx, dy) < 0.001) { dx = -1; dy = -1; }
  const edgeX = dx < 0 ? Math.min(0, view.left) - 6 : Math.max(world.terrain.width, view.right) + 6;
  const edgeY = dy < 0 ? Math.min(0, view.top) - 6 : Math.max(world.terrain.height, view.bottom) + UFO.altitude + 6;
  const scale = Math.min(dx ? (edgeX - from.x) / dx : Infinity, dy ? (edgeY - from.y) / dy : Infinity);
  const toX = from.x + dx * scale, toY = from.y + dy * scale;
  state.departure = { fromX: from.x, fromY: from.y, toX, toY, vx: state.vx, vy: state.vy, elapsed: 0,
    duration: Math.max(1.5, Math.min(4, Math.hypot(toX - from.x, toY - from.y) / (UFO.speed * 3))) };
  state.targetId = null;
  state.phase = state.phase === 'beam' || state.phase === 'charge' ? 'recover' : 'cruise';
  state.phaseTime = 0;
}

function leave(world: World, entity: Entity, dt: number): void {
  const state = entity.components.ufo!, d = state.departure!, p = entity.components.position!;
  d.elapsed = Math.min(d.duration, d.elapsed + dt);
  if (state.phase === 'recover') {
    state.phaseTime += dt;
    if (state.phaseTime >= UFO.recover) { state.phase = 'cruise'; state.phaseTime = 0; }
  }
  const ground = ufoGroundPosition(p, state), t = d.elapsed / d.duration;
  const vx = (d.toX - d.fromX) * 2 * t / d.duration + d.vx * (1 - 4 * t + 3 * t * t);
  const vy = (d.toY - d.fromY) * 2 * t / d.duration + d.vy * (1 - 4 * t + 3 * t * t);
  const speed = Math.max(1, Math.hypot(vx, vy) / UFO.speed);
  state.vx = vx / speed; state.vy = vy / speed;
  p.x = Math.max(0, Math.min(world.terrain.width - 0.001, ground.x));
  p.y = Math.max(0, Math.min(world.terrain.height - 0.001, ground.y));
  world.spatial.update(entity);
  if (d.elapsed === d.duration) {
    const view = currentView(world);
    if (ground.x <= view.left - 4 || ground.x >= view.right + 4
      || ground.y <= view.top - 4 || ground.y >= view.bottom + UFO.altitude + 4) world.remove(entity.id);
    // A player following the flight must see it continue, never disappear in the viewport.
    else depart(world, entity, { x: d.toX - d.fromX, y: d.toY - d.fromY });
  }
}

function wander(world: World, p: Vec2, state: UfoState): void {
  const angle = world.rng.range(0, Math.PI * 2), distance = world.rng.range(14, 32);
  state.goalX = Math.max(1, Math.min(world.terrain.width - 1, p.x + Math.cos(angle) * distance));
  state.goalY = Math.max(1, Math.min(world.terrain.height - 1, p.y + Math.sin(angle) * distance));
}

function strike(world: World, p: Vec2, sourceId: number): void {
  world.events.push({ kind: 'surface', origin: 'heat-ray', ...p, radius: UFO.radius, terrain: Terrain.Scorched },
    { kind: 'surface', origin: 'heat-ray', ...p, radius: 1, terrain: Terrain.Crater });
  world.visual({ kind: 'blast', ...p, radius: UFO.radius });
  for (const victim of world.nearby(p, UFO.radius).sort((a, b) => a.id - b.id)) {
    // Ground strikes cannot hit the saucer hovering above their impact point.
    if (victim.components.ufo || victim.components.dragon || victim.components.projectile) continue;
    const q = victim.components.position!, force = 1 - Math.hypot(q.x - p.x, q.y - p.y) / UFO.radius;
    world.events.push({ kind: 'heat', target: victim.id, amount: 140 * force, sourceId },
      { kind: 'damage', target: victim.id, amount: 300 * force, cause: 'conflict', sourceId });
  }
}

function fly(world: World, dt: number): void {
  for (const entity of world.query('ufo', 'position')) {
    if (statusStops(entity)) continue;
    const p = entity.components.position!, state = entity.components.ufo!;
    state.age += dt; state.attackIn = Math.max(0, state.attackIn - dt);
    state.thinkIn = Math.max(0, state.thinkIn - dt);
    if (state.departure) { leave(world, entity, dt); continue; }
    if (state.arrival) {
      state.returnPoint ??= { x: state.arrival.fromX, y: state.arrival.fromY };
      state.arrival.elapsed = Math.min(state.arrival.duration, state.arrival.elapsed + dt);
      locateArrival(world, entity);
      if (state.arrival.elapsed === state.arrival.duration) {
        p.x = state.goalX; p.y = state.goalY; state.vx = state.vy = 0;
        delete state.arrival; world.spatial.update(entity);
      }
      continue;
    }
    if (state.age + 1e-9 >= UFO.lifetime) { depart(world, entity); continue; }
    const peaceful = lawEnabled(world, 'peaceful-monsters');
    if (peaceful) { state.targetId = null; state.phase = 'cruise'; state.phaseTime = 0; }
    if (state.phase !== 'cruise') {
      const before = state.phaseTime;
      state.phaseTime += dt;
      if (state.phase === 'beam' && before < UFO.contact && state.phaseTime >= UFO.contact) strike(world, p, entity.id);
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
      if (!peaceful && state.attackIn === 0) {
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
    && (v.returnPoint === undefined || record(v.returnPoint) && number(v.returnPoint.x, -1000020, 1000020) && number(v.returnPoint.y, -1000020, 1000020))
    && (v.departure === undefined || record(v.departure) && v.arrival === undefined && v.targetId === null
      && (v.phase === 'cruise' || v.phase === 'recover') && number(v.age, UFO.lifetime - 1e-9, 1e8)
      && number(v.departure.fromX, -2e6, 2e6) && number(v.departure.fromY, -2e6, 2e6)
      && number(v.departure.toX, -2e6, 2e6) && number(v.departure.toY, -2e6, 2e6)
      && number(v.departure.vx, -UFO.speed, UFO.speed) && number(v.departure.vy, -UFO.speed, UFO.speed)
      && number(v.departure.duration, 1.5, 4) && number(v.departure.elapsed, 0, v.departure.duration))
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
