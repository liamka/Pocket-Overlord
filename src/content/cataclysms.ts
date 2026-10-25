import type { Registry, PixelSprite } from './registry';
import type { World } from '../core/world';
import { integer, number, record } from '../core/validation';
import { ENTITY_LIMIT, Terrain, WORLD_WIDTH, WORLD_HEIGHT, type Vec2, type Entity } from '../core/types';
import { aboardFerry } from '../core/ferries';
import { applyEvent } from '../systems/effects';
import { CATACLYSMS, TORNADO, GRAVITY, cataclysms, liftedIds, tornadoCaptivePose, gravityCaptivePose, tornadoStrength,
  type CataclysmState, type Captive, type BloodTornado, type GravityClap, type LiftedPose } from '../core/cataclysms';

const point = (v: Record<string, unknown>): boolean => number(v.x, 0, WORLD_WIDTH) && number(v.y, 0, WORLD_HEIGHT);
const seed = (v: unknown): boolean => integer(v, 0, 0xffffffff);
function validState(value: unknown): value is CataclysmState {
  if (!record(value)) return false;
  const ids = new Set<number>();
  const captives = (v: unknown, age: number): boolean => Array.isArray(v) && v.length <= CATACLYSMS.captives && v.every(c => {
    if (!record(c) || !integer(c.id, 1) || ids.has(c.id) || !point(c) || !number(c.at, 0, age) || !number(c.angle, -Math.PI, Math.PI)) return false;
    ids.add(c.id); return ids.size <= CATACLYSMS.captives;
  });
  return Array.isArray(value.tornadoes) && value.tornadoes.length <= TORNADO.limit && value.tornadoes.every(t =>
    record(t) && point(t) && number(t.targetX, 0, WORLD_WIDTH) && number(t.targetY, 0, WORLD_HEIGHT)
    && number(t.vx, -TORNADO.speed, TORNADO.speed) && number(t.vy, -TORNADO.speed, TORNADO.speed)
    && number(t.age, 0, 1e8) && seed(t.seed) && integer(t.blood, 0, 1000000) && integer(t.debris, 0, 1000000)
    && (t.released === null || number(t.released, 0, t.age + 1.3) && t.age <= t.released + TORNADO.collapse + TORNADO.rain)
    && captives(t.captives, t.age))
    && Array.isArray(value.claps) && value.claps.length <= GRAVITY.limit && value.claps.every(g =>
      record(g) && point(g) && number(g.age, 0, GRAVITY.end) && seed(g.seed) && integer(g.blood, 0, CATACLYSMS.captives)
      && typeof g.hit === 'string' && g.hit.length <= ENTITY_LIMIT * 18 && /^(?:,[1-9]\d*,)*$/.test(g.hit)
      && g.fired === (g.age + 1e-9 >= GRAVITY.charge) && captives(g.captives, g.age) && (!g.fired || (g.captives as Captive[]).length === 0))
    && Array.isArray(value.stains) && value.stains.length <= CATACLYSMS.stains && value.stains.every(s =>
      record(s) && point(s) && number(s.age, 0, CATACLYSMS.stainLife) && seed(s.seed) && number(s.size, 0.1, 5))
    && Array.isArray(value.bursts) && value.bursts.length <= CATACLYSMS.bursts && value.bursts.every(b =>
      record(b) && point(b) && number(b.z, 0, 20) && number(b.age, 0, CATACLYSMS.burstLife) && seed(b.seed)
      && number(b.spread, 0.1, 16) && (b.kind === 'blood' || b.kind === 'debris'));
}
const nextSeed = (world: World): number => Math.floor(world.rng.range(0, 0x100000000));
const clampPoint = (world: World, p: Vec2): Vec2 => ({ x: Math.max(0, Math.min(world.terrain.width - 0.001, p.x)), y: Math.max(0, Math.min(world.terrain.height - 0.001, p.y)) });

function stain(world: World, state: CataclysmState, p: Vec2, size: number): void {
  if (state.stains.length >= CATACLYSMS.stains) state.stains.shift();
  state.stains.push({ ...clampPoint(world, p), age: 0, size, seed: nextSeed(world) });
}
function burst(world: World, state: CataclysmState, p: Vec2, z: number, spread: number, kind: 'blood' | 'debris'): void {
  if (state.bursts.length >= CATACLYSMS.bursts) state.bursts.shift();
  state.bursts.push({ ...clampPoint(world, p), z, age: 0, spread, kind, seed: nextSeed(world) });
  if (kind === 'blood') stain(world, state, p, Math.min(3.5, spread * 0.45));
}
function capture(world: World, power: BloodTornado | GravityClap, radius: number, held: Set<number>): void {
  for (const entity of world.nearby(power, radius)) {
    if (held.size >= CATACLYSMS.captives) break;
    if (!entity.components.person || !entity.components.health || held.has(entity.id) || aboardFerry(world, entity.id)) continue;
    const p = entity.components.position!;
    power.captives.push({ id: entity.id, x: p.x, y: p.y, at: power.age, angle: Math.atan2(p.y - power.y, p.x - power.x) }); held.add(entity.id);
    const c = entity.components.citizen;
    if (c) { if (c.task !== 'migrate') c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null; delete c.emergency; }
  }
}
function locate(world: World, entity: Entity, pose: LiftedPose): void {
  Object.assign(entity.components.position!, clampPoint(world, pose));
  const m = entity.components.motion;
  if (m) { m.vx = m.vy = 0; m.decisionIn = 0; }
  world.spatial.update(entity);
}
function killCaptive(world: World, state: CataclysmState, entity: Entity, pose: LiftedPose, spread: number): void {
  locate(world, entity, pose);
  burst(world, state, pose, pose.z, spread, 'blood');
  applyEvent(world, { kind: 'damage', target: entity.id, amount: entity.components.health!.current });
}
function tornado(world: World, state: CataclysmState, t: BloodTornado, dt: number, held: Set<number>): void {
  const before = t.age; t.age += dt;
  if (t.released === null && t.age >= TORNADO.life) t.released = Math.max(TORNADO.life, before);
  const live = t.released === null || t.age < t.released;
  const moving = live && t.age >= TORNADO.grow;
  if (moving && (Math.hypot(t.targetX - t.x, t.targetY - t.y) < 1.5 || Math.floor(before / 2.5) !== Math.floor(t.age / 2.5))) {
    const nearEdge = t.x < 4 || t.y < 4 || t.x > world.terrain.width - 4 || t.y > world.terrain.height - 4;
    let heading = Math.hypot(t.vx, t.vy) > 0.1 ? Math.atan2(t.vy, t.vx) : world.rng.range(0, Math.PI * 2);
    if (nearEdge) heading = Math.atan2(world.terrain.height / 2 - t.y, world.terrain.width / 2 - t.x);
    heading += world.rng.range(-0.9, 0.9);
    const travel = world.rng.range(12, 24);
    const target = clampPoint(world, { x: t.x + Math.cos(heading) * travel, y: t.y + Math.sin(heading) * travel });
    t.targetX = target.x; t.targetY = target.y;
  }
  const dx = t.targetX - t.x, dy = t.targetY - t.y, distance = Math.hypot(dx, dy);
  const speed = moving ? Math.min(TORNADO.speed * 0.5, distance * 3) : 0;
  const blend = 1 - Math.exp(-dt * 5);
  t.vx += (dx / (distance || 1) * speed - t.vx) * blend; t.vy += (dy / (distance || 1) * speed - t.vy) * blend;
  Object.assign(t, clampPoint(world, { x: t.x + t.vx * dt, y: t.y + t.vy * dt }));
  const strength = tornadoStrength(t);
  if (live && t.age >= 0.15) capture(world, t, TORNADO.radius * strength, held);
  for (let i = t.captives.length - 1; i >= 0; i--) {
    const c = t.captives[i], entity = world.entities.get(c.id);
    if (!entity?.components.health) { t.captives.splice(i, 1); continue; }
    const pose = tornadoCaptivePose(t, c);
    if (t.age - c.at >= TORNADO.carry || t.released !== null && t.age >= t.released + 0.65) {
      killCaptive(world, state, entity, pose, 4); t.blood = Math.min(1000000, t.blood + 1); t.captives.splice(i, 1);
    } else locate(world, entity, pose);
  }
  if (strength > 0.3 && Math.floor(before * 5) !== Math.floor(t.age * 5)) {
    for (const entity of world.nearby(t, 5.5 * strength)) {
      const c = entity.components;
      if (!c.health || c.person || c.projectile || c.dragon || c.ufo || c.kaiju || c.ship) continue;
      if (c.health.current <= 32) {
        burst(world, state, c.position!, 1, 3, c.animal ? 'blood' : 'debris');
        if (c.animal) t.blood = Math.min(1000000, t.blood + 1);
        else t.debris = Math.min(1000000, t.debris + 1);
      }
      applyEvent(world, { kind: 'damage', target: entity.id, amount: 32 });
    }
  }
  if (t.blood && t.released !== null && t.age >= t.released + 0.4 && Math.floor(before * 12) !== Math.floor(t.age * 12)) {
    const angle = world.rng.range(0, Math.PI * 2), radius = world.rng.range(0.5, 7);
    stain(world, state, { x: t.x + Math.cos(angle) * radius, y: t.y + Math.sin(angle) * radius }, world.rng.range(0.2, 0.7));
  }
}
function clap(world: World, state: CataclysmState, g: GravityClap, dt: number, held: Set<number>): void {
  const before = g.age; g.age += dt;
  if (g.age < 0.35) capture(world, g, GRAVITY.radius, held);
  if (!g.fired) {
    for (let i = g.captives.length - 1; i >= 0; i--) {
      const c = g.captives[i], entity = world.entities.get(c.id);
      if (!entity?.components.health) { g.captives.splice(i, 1); continue; }
      const pose = gravityCaptivePose(g, c);
      if (g.age + 1e-9 >= GRAVITY.charge) {
        killCaptive(world, state, entity, pose, 10); g.blood++;
      } else locate(world, entity, pose);
    }
    if (g.age + 1e-9 >= GRAVITY.charge) {
      g.fired = true; g.captives = [];
      // The expanding ground ring and its damage use the same radius and timeline.
      applyEvent(world, { kind: 'surface', x: g.x, y: g.y, radius: 1.6, terrain: Terrain.Crater });
      if (g.blood) for (let i = 0; i < 36; i++) {
        const angle = i * Math.PI * 2 / 36 + world.rng.range(-0.06, 0.06), radius = world.rng.range(2, GRAVITY.radius);
        stain(world, state, { x: g.x + Math.cos(angle) * radius, y: g.y + Math.sin(angle) * radius }, world.rng.range(0.25, 1.1));
      }
    }
  }
  if (!g.fired || before >= GRAVITY.charge + GRAVITY.wave) return;
  const previous = Math.max(0, (before - GRAVITY.charge) / GRAVITY.wave) * GRAVITY.radius;
  const radius = Math.min(1, Math.max(0, (g.age - GRAVITY.charge) / GRAVITY.wave)) * GRAVITY.radius;
  for (const entity of world.nearby(g, radius)) {
    const c = entity.components;
    if (!c.health || c.projectile || c.dragon || c.ufo || held.has(entity.id) || g.hit.includes(`,${entity.id},`)) continue;
    const dx = c.position!.x - g.x, dy = c.position!.y - g.y, distance = Math.hypot(dx, dy);
    if (distance < previous) continue;
    g.hit += `,${entity.id},`;
    const damage = 250 * (1 - distance / (GRAVITY.radius * 1.4));
    if (c.health.current <= damage) burst(world, state, c.position!, 0, 4, c.person || c.animal ? 'blood' : 'debris');
    applyEvent(world, { kind: 'damage', target: entity.id, amount: damage });
    if (c.motion) applyEvent(world, { kind: 'impulse', target: entity.id, x: dx / (distance || 1) * 12, y: dy / (distance || 1) * 12 });
  }
}

const tornadoIcon: PixelSprite = { pixels: ['...aaaaaa...', '.aabbbbbbaa.', 'abccddddccba', '.abbbcccbaa.', '..abddcba...', '...abccba...', '....abdcba..', '....abcca...', '...abcca....', '...abda.....', '..abda......', '..aaa.......', '.ee..ee.....'],
  palette: { a: '#3e423c', b: '#625e53', c: '#928b7b', d: '#bdb6a2', e: '#8e3026' }, anchor: { x: 6, y: 7 } };
const gravityIcon: PixelSprite = { pixels: ['...bb......', '..acb..aa..', '.a.....ca..', '.a..ccc..a.', 'a..cddbc..a', 'a..cdebc..a', '.a..bcc..a.', '.ac......a.', '..cc..bc...', '...aabb....', '...fffff...'],
  palette: { a: '#737d78', b: '#797969', c: '#c3c1a6', d: '#5c6257', e: '#171e1d', f: '#672b24' }, anchor: { x: 5, y: 5 } };

function ensureState(world: World): CataclysmState | undefined {
  return cataclysms(world) ?? (world.startScenario(CATACLYSMS.id) ? cataclysms(world) : undefined);
}
export function registerCataclysms(registry: Registry): void {
  registry.registerScenario<CataclysmState>({ id: CATACLYSMS.id,
    create: () => ({ tornadoes: [], claps: [], stains: [], bursts: [] }), validate: validState,
    update: (world, state, dt) => {
      for (const s of state.stains) s.age += dt;
      for (const b of state.bursts) b.age += dt;
      state.stains = state.stains.filter(s => s.age < CATACLYSMS.stainLife);
      state.bursts = state.bursts.filter(b => b.age < CATACLYSMS.burstLife);
      const held = liftedIds(world);
      for (const t of state.tornadoes) tornado(world, state, t, dt, held);
      for (const g of state.claps) clap(world, state, g, dt, held);
      state.tornadoes = state.tornadoes.filter(t => t.released === null || t.age < t.released + TORNADO.collapse + TORNADO.rain);
      state.claps = state.claps.filter(g => g.age < GRAVITY.end);
      if (!state.tornadoes.length && !state.claps.length && !state.stains.length && !state.bursts.length) return 'complete';
    },
  });
  registry.registerTool({ id: TORNADO.id, category: 'destruction', icon: tornadoIcon, label: 'Blood tornado', color: '#ef687e', radius: TORNADO.radius, showArea: false,
    hint: 'Click to summon a blood tornado. It roams on its own, lifts residents and debris, then fades into crimson rain.',
    apply: (world, p) => {
      const state = ensureState(world); if (!state) return 'Too many active cataclysms';
      if (state.tornadoes.length >= TORNADO.limit) return 'Too many active cataclysms';
      state.tornadoes.push({ ...p, targetX: p.x, targetY: p.y, vx: 0, vy: 0, age: 0, released: null, seed: nextSeed(world), blood: 0, debris: 0, captives: [] });
    },
  }).registerTool({ id: GRAVITY.id, category: 'destruction', icon: gravityIcon, label: 'Gravity clap', color: '#d9a0f7', radius: GRAVITY.radius,
    hint: 'Click to lift nearby residents, pull them into a single point and unleash a crimson shockwave.',
    apply: (world, p) => {
      const state = ensureState(world); if (!state || state.claps.length >= GRAVITY.limit) return 'Too many active cataclysms';
      state.claps.push({ ...p, age: 0, seed: nextSeed(world), fired: false, blood: 0, hit: '', captives: [] });
    },
  });
}
