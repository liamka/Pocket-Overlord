import type { PixelSprite, Registry } from './registry';
import type { Entity, ToolControl, Vec2 } from '../core/types';
import { Terrain, WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { number, reference } from '../core/validation';
import type { World } from '../core/world';

export const KAIJU_ID = 'core:kaiju';
export const KAIJU = { speed: 5, health: 18000, charge: 0.7, beam: 1.8, recover: 1.1, reach: 28, pulse: 0.15, step: 0.48, crush: 4.5 } as const;
export interface KaijuState {
  heading: number; age: number; gait: number; stepIn: number;
  targetId: number | null; goalX: number; goalY: number; thinkIn: number;
  aimX: number; aimY: number;
  phase: 'idle' | 'charge' | 'beam' | 'recover'; phaseTime: number; pulseIn: number;
}
declare module '../core/types' { interface ComponentMap { kaiju: KaijuState } }

const controls = new WeakMap<World, ToolControl>();
const difference = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const prey = (e: Entity): boolean => !!e.components.health && !e.components.kaiju && !e.components.dragon && !e.components.projectile;
const latest = (world: World): Entity | undefined => [...world.query('kaiju', 'position')].at(-1);
const clampPoint = (world: World, p: Vec2): Vec2 => ({ x: Math.max(0.5, Math.min(world.terrain.width - 0.5, p.x)), y: Math.max(0.5, Math.min(world.terrain.height - 0.5, p.y)) });

export function kaijuPoint(position: Vec2, heading: number, forward: number, side: number): Vec2 {
  return { x: position.x + Math.cos(heading) * forward - Math.sin(heading) * side,
    y: position.y + Math.sin(heading) * forward + Math.cos(heading) * side };
}

export interface KaijuJoint extends Vec2 { height: number }

/** Height stays vertical on screen while the creature turns on the ground plane. */
export function kaijuPose(position: Vec2, state: KaijuState) {
  const stride = state.gait * Math.PI * 2;
  const charge = state.phase === 'charge' ? state.phaseTime / KAIJU.charge : state.phase === 'beam' ? 1 : 0;
  const bob = Math.cos(stride * 2) * 0.12 + Math.sin(state.age * 2) * 0.06;
  const recoil = state.phase === 'beam' ? Math.sin(state.phaseTime * 37) * 0.06 : 0;
  const joint = (forward: number, side: number, height: number): KaijuJoint => ({ ...kaijuPoint(position, state.heading, forward, side), height });
  const headForward = 2.6 - charge * 0.4 - recoil, headHeight = 12.1 + bob + charge * 0.25;
  return { joint, bob, charge, headForward, headHeight,
    mouth: joint(headForward + 3.2, 0, headHeight + 0.3),
    feet: [-1, 1].map(side => {
      const phase = stride + (side < 0 ? Math.PI : 0);
      return { side, ...joint(Math.cos(phase) * 1.25, side * 2.4, Math.max(0, Math.sin(phase)) * 0.8) };
    }),
  };
}

/** One elevated mouth beam converges on the ground point that receives damage. */
export function kaijuBeam(position: Vec2, state: KaijuState): { from: KaijuJoint; to: Vec2 } {
  const distance = Math.max(7, Math.min(KAIJU.reach, Math.hypot(state.aimX - position.x, state.aimY - position.y)));
  return { from: kaijuPose(position, state).mouth, to: kaijuPoint(position, state.heading, distance, 0) };
}

function crush(world: World, entity: Entity): void {
  const p = entity.components.position!, state = entity.components.kaiju!;
  for (const victim of world.nearby(p, KAIJU.crush)) {
    if (!prey(victim)) continue;
    world.events.push({ kind: 'damage', target: victim.id, amount: 450 });
    const q = victim.components.position!, length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    if (victim.components.motion) world.events.push({ kind: 'impulse', target: victim.id, x: (q.x - p.x) / length * 12, y: (q.y - p.y) / length * 12 });
  }
  world.events.push({ kind: 'surface', ...p, radius: 3.4, terrain: Terrain.Crater });
  for (const joint of kaijuPose(p, state).feet) {
    const foot = clampPoint(world, joint);
    world.events.push({ kind: 'surface', ...foot, radius: 1.3, terrain: Terrain.Crater });
  }
}

function fireBeam(world: World, entity: Entity): void {
  const point = kaijuBeam(entity.components.position!, entity.components.kaiju!).to;
  if (!world.terrain.inside(point.x, point.y)) return;
  world.events.push({ kind: 'surface', ...point, radius: 3.6, terrain: Terrain.Scorched },
    { kind: 'surface', ...point, radius: 2.4, terrain: Terrain.Crater });
  for (const victim of world.nearby(point, 3.6)) {
    if (!prey(victim)) continue;
    world.events.push({ kind: 'heat', target: victim.id, amount: 160 }, { kind: 'damage', target: victim.id, amount: 1200 });
  }
  world.visual({ kind: 'blast', ...point, radius: 2.6 });
}

function rampage(world: World, dt: number): void {
  const controlled = latest(world), input = controls.get(world);
  for (const entity of world.query('kaiju', 'position')) {
    const p = entity.components.position!, state = entity.components.kaiju!;
    const manual = input?.active && entity === controlled;
    state.age += dt; state.thinkIn = Math.max(0, state.thinkIn - dt);
    let target = world.entities.get(state.targetId ?? -1);
    if (!target || !prey(target)) { target = undefined; state.targetId = null; }
    if (!manual && state.thinkIn === 0) {
      let best = Infinity;
      for (const candidate of world.nearby(p, 80)) {
        if (!prey(candidate)) continue;
        const q = candidate.components.position!, distance = Math.hypot(q.x - p.x, q.y - p.y);
        const score = distance + (candidate.components.dwelling ? -12 : candidate.components.person ? 0 : 8);
        if (score < best) { best = score; target = candidate; }
      }
      state.targetId = target?.id ?? null; state.thinkIn = 0.75;
      if (!target && Math.hypot(p.x - state.goalX, p.y - state.goalY) < 3) {
        state.goalX = world.rng.range(2, world.terrain.width - 2); state.goalY = world.rng.range(2, world.terrain.height - 2);
      }
    }
    const goal = target?.components.position ?? { x: state.goalX, y: state.goalY };
    if (!manual) { state.aimX = goal.x; state.aimY = goal.y; }
    const turn = difference(Math.atan2(state.aimY - p.y, state.aimX - p.x), state.heading);
    state.heading = (state.heading + Math.max(-dt * 2.4, Math.min(dt * 2.4, turn)) + Math.PI * 2) % (Math.PI * 2);
    const distance = Math.hypot(goal.x - p.x, goal.y - p.y);
    const attacking = manual ? input.attacking : !!target && distance < KAIJU.reach;
    if (state.phase === 'idle' && attacking && Math.abs(turn) < 0.4) { state.phase = 'charge'; state.phaseTime = 0; }
    if (state.phase !== 'idle') {
      state.phaseTime += dt;
      const duration = KAIJU[state.phase];
      if (state.phaseTime + 1e-9 >= duration) {
        state.phase = state.phase === 'charge' ? 'beam' : state.phase === 'beam' ? 'recover' : 'idle';
        state.phaseTime = 0; state.pulseIn = 0;
      }
    }
    let dx = manual ? input.x : (goal.x - p.x) / (distance || 1), dy = manual ? input.y : (goal.y - p.y) / (distance || 1);
    const magnitude = Math.hypot(dx, dy);
    if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
    // The titan braces its legs while charging and firing its breath.
    const speed = KAIJU.speed * (state.phase === 'beam' ? 0.32 : state.phase === 'charge' ? 0.55 : 1);
    const before = { ...p };
    Object.assign(p, clampPoint(world, { x: p.x + dx * speed * dt, y: p.y + dy * speed * dt }));
    world.spatial.update(entity);
    const moved = Math.hypot(p.x - before.x, p.y - before.y);
    state.gait = (state.gait + moved / 4.8) % 1;
    state.stepIn = Math.max(0, state.stepIn - dt);
    if (state.stepIn === 0 && (moved > 0 || state.age < 0.1)) { crush(world, entity); state.stepIn = KAIJU.step; }
    if (state.phase === 'beam') {
      state.pulseIn = Math.max(0, state.pulseIn - dt);
      if (state.pulseIn === 0) { fireBeam(world, entity); state.pulseIn = KAIJU.pulse; }
    }
  }
}

const icon: PixelSprite = { pixels: [
  '.......aaaa.......', '......abcbbba.....', '.....aabbfbbbba...', '....deabbbaaaa....', '.....dabbbba......',
  '....deabccba......', '.....dabbccbba....', '....deabbccbaa....', '.....dabcccba.....', '...adeabbccba.....',
  '..abdaabbbcba.....', '.abbbaaabccba.....', 'abbba..abbbba.....', 'aaa...abbabbbba...', '......aff..afffa..',
], palette: { a: '#192b34', b: '#405d60', c: '#90a58a', d: '#407f9a', e: '#8ce8ff', f: '#f4dca1' }, anchor: { x: 9, y: 8 } };

export function registerKaiju(registry: Registry): void {
  registry.registerComponent('kaiju', v => number(v.heading, 0, Math.PI * 2) && number(v.age, 0, 1e8) && number(v.gait, 0, 1)
    && number(v.stepIn, 0, KAIJU.step) && reference(v.targetId) && number(v.goalX, 0, WORLD_WIDTH) && number(v.goalY, 0, WORLD_HEIGHT)
    && number(v.aimX, 0, WORLD_WIDTH) && number(v.aimY, 0, WORLD_HEIGHT) && number(v.thinkIn, 0, 0.75)
    && ['idle', 'charge', 'beam', 'recover'].includes(String(v.phase)) && number(v.phaseTime, 0, v.phase === 'idle' ? 0 : KAIJU[v.phase as 'charge' | 'beam' | 'recover'])
    && number(v.pulseIn, 0, KAIJU.pulse));
  registry.registerEntity({ id: KAIJU_ID, sprite: icon, create: p => ({ position: { ...p }, health: { current: KAIJU.health, max: KAIJU.health },
    kaiju: { heading: Math.PI / 6, age: 0, gait: 0, stepIn: 0, targetId: null, goalX: p.x, goalY: p.y,
      aimX: p.x, aimY: Math.max(0, p.y - 20), thinkIn: 0, phase: 'idle', phaseTime: 0, pulseIn: 0 },
  }) });
  registry.registerSystem({ id: 'core:kaiju', after: ['core:movement'], before: ['core:settlement'], update: rampage });
  registry.registerTool({ id: KAIJU_ID, category: 'destruction', icon, label: 'Giant Kaiju', radius: KAIJU.crush, showArea: false, color: '#81dcff',
    hint: 'Click to summon a reptilian titan. WASD or arrows: move. Aim with the mouse; hold left click for atomic breath. Select another power to let it rampage. Right-drag: pan.',
    apply: (world, point) => {
      const existing = latest(world);
      if (existing) { existing.components.kaiju!.aimX = point.x; existing.components.kaiju!.aimY = point.y; return; }
      if (!world.spawn(KAIJU_ID, point)) return 'Too many objects in the world';
    },
    aim: (world, point) => { const state = latest(world)?.components.kaiju; if (state) { state.aimX = point.x; state.aimY = point.y; } },
    control: (world, input) => { controls.set(world, { x: input.x, y: input.y, attacking: input.attacking, active: input.active }); },
  });
}
