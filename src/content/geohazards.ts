import { lawEnabled } from '../core/world-rules';
import type { PixelSprite, Registry } from './registry';
import type { World } from '../core/world';
import { Terrain, WORLD_WIDTH, WORLD_HEIGHT, type Vec2 } from '../core/types';
import { integer, number, record } from '../core/validation';
import { noise } from '../core/random';
import { liftedIds } from '../core/cataclysms';
import { aboardFerry } from '../core/ferries';
import { ACID, GEOHAZARDS, VOLCANO, geohazards, markHazardsChanged, poolRadius, type Pool, type Geohazards, type Volcano } from '../core/geohazards';
import { applyEvent } from '../systems/effects';
import { heatCell } from '../systems/temperature';

declare module '../core/types' { interface ComponentMap { volcano: Volcano } }

const seed = (v: unknown): boolean => integer(v, 0, 0xffffffff);
const point = (v: Record<string, unknown>): boolean => number(v.x, 0, WORLD_WIDTH) && number(v.y, 0, WORLD_HEIGHT);
const validPools = (v: unknown, limit: number, life: number): boolean => Array.isArray(v) && v.length <= limit && v.every(p => record(p) && point(p)
  && number(p.radius, 0.5, ACID.radius) && number(p.age, 0, 1e8) && number(p.remaining, 0, life) && seed(p.seed) && typeof p.etched === 'boolean');
function validState(v: unknown): v is Geohazards {
  return record(v) && validPools(v.acid, GEOHAZARDS.acids, ACID.life) && validPools(v.lava, GEOHAZARDS.lava, VOLCANO.lavaLife)
    && Array.isArray(v.bombs) && v.bombs.length <= GEOHAZARDS.bombs && v.bombs.every(b => record(b) && point(b)
      && number(b.tx, 0, WORLD_WIDTH) && number(b.ty, 0, WORLD_HEIGHT) && number(b.life, 1.5, 2.5) && number(b.age, 0, b.life as number) && seed(b.seed))
    && Array.isArray(v.flows) && v.flows.length <= GEOHAZARDS.flows && v.flows.every(f => record(f) && point(f)
      && number(f.heading, -100, 100) && integer(f.left, 0, 14) && number(f.stepIn, 0, 0.25) && seed(f.seed));
}
function ensureState(world: World): Geohazards | undefined {
  if (!geohazards(world) && !world.startScenario(GEOHAZARDS.id)) return;
  return geohazards(world);
}
const nextSeed = (world: World): number => Math.floor(world.rng.range(0, 0x100000000));
const clampPoint = (world: World, p: Vec2): Vec2 => ({ x: Math.max(0, Math.min(world.terrain.width - 0.001, p.x)), y: Math.max(0, Math.min(world.terrain.height - 0.001, p.y)) });
function addPool(world: World, pools: Pool[], p: Vec2, radius: number, life: number, limit: number): void {
  if (!world.terrain.inside(p.x, p.y)) return;
  markHazardsChanged(world);
  const old = pools.find(old => Math.hypot(old.x - p.x, old.y - p.y) < radius * 0.5);
  if (old) { old.remaining = life; return; }
  if (pools.length >= limit) pools.shift();
  pools.push({ ...p, radius, age: 0, remaining: life, seed: nextSeed(world), etched: false });
}
function erupt(world: World, state: Geohazards, p: Vec2, volcano: Volcano): void {
  volcano.eruption = 2.6; volcano.cooldown = VOLCANO.period;
  for (let i = 0; i < 8 && state.bombs.length < GEOHAZARDS.bombs; i++) {
    const angle = i * Math.PI / 4 + world.rng.range(-0.3, 0.3), distance = world.rng.range(5, 12);
    const target = clampPoint(world, { x: p.x + Math.cos(angle) * distance, y: p.y + Math.sin(angle) * distance });
    state.bombs.push({ ...p, tx: target.x, ty: target.y, age: 0, life: world.rng.range(1.6, 2.4), seed: nextSeed(world) });
  }
  for (let i = 0; i < 3 && state.flows.length < GEOHAZARDS.flows; i++) {
    const heading = i * Math.PI * 2 / 3 + noise(volcano.seed, i) * 1.3;
    state.flows.push({ ...p, heading, left: 14, stepIn: 0, seed: nextSeed(world) });
  }
}
function update(world: World, state: Geohazards, dt: number): void {
  const lifted = liftedIds(world);
  for (const entity of [...world.query('volcano', 'position')]) {
    const p = entity.components.position!, v = entity.components.volcano!;
    if (!world.terrain.isLand(p.x, p.y)) { world.remove(entity.id); continue; }
    v.age = Math.min(1e8, v.age + dt); v.eruption = Math.max(0, v.eruption - dt); v.cooldown = Math.max(0, v.cooldown - dt);
    if (v.cooldown <= 1e-9) erupt(world, state, p, v);
  }
  for (let i = state.bombs.length - 1; i >= 0; i--) {
    const b = state.bombs[i]; b.age += dt;
    if (b.age < b.life) continue;
    const p = { x: b.tx, y: b.ty };
    for (const e of world.nearby(p, 1.8).sort((a, b) => a.id - b.id)) {
      if (lifted.has(e.id) || e.components.volcano || e.components.dragon || e.components.ufo || e.components.projectile) continue;
      applyEvent(world, { kind: 'damage', target: e.id, amount: 95, cause: 'fire' });
      applyEvent(world, { kind: 'heat', target: e.id, amount: 130 });
    }
    addPool(world, state.lava, p, 1.6, VOLCANO.lavaLife, GEOHAZARDS.lava); state.bombs.splice(i, 1);
  }
  for (let i = state.flows.length - 1; i >= 0; i--) {
    const flow = state.flows[i]; flow.stepIn = Math.max(0, flow.stepIn - dt);
    if (flow.stepIn > 1e-9) continue;
    flow.heading += (noise(flow.left, flow.seed) - 0.5) * 0.5;
    const p = { x: flow.x + Math.cos(flow.heading) * 0.8, y: flow.y + Math.sin(flow.heading) * 0.8 };
    if (!world.terrain.inside(p.x, p.y) || world.terrain.at(p.x, p.y) === Terrain.Mountain && flow.left < 10) { state.flows.splice(i, 1); continue; }
    Object.assign(flow, p); flow.left--; flow.stepIn = 0.25;
    addPool(world, state.lava, p, 1.1, VOLCANO.lavaLife, GEOHAZARDS.lava);
    if (flow.left <= 0 || !world.terrain.isLand(p.x, p.y)) state.flows.splice(i, 1);
  }
  for (const [kind, pools, life, rate] of [['acid', state.acid, ACID.life, ACID.damage], ['lava', state.lava, VOLCANO.lavaLife, VOLCANO.damage]] as const) {
    // Overlapping brush samples and lava branches never multiply damage.
    const hits = new Map<number, number>();
    for (let i = pools.length - 1; i >= 0; i--) {
      const pool = pools[i];
      if (kind === 'lava') world.terrain.edit(() => world.terrain.circle(pool.x, pool.y, poolRadius(pool), (x, y) => {
        heatCell(world, { x, y }, dt * 4);
      }));
      const water = world.terrain.cell(pool.x, pool.y).water && !world.terrain.cell(pool.x, pool.y).ice;
      const rain = world.effects.some(r => Math.hypot(pool.x - r.x, pool.y - r.y) <= r.radius);
      pool.age = Math.min(1e8, pool.age + dt); pool.remaining = Math.max(0, pool.remaining - dt * (water ? 8 : rain ? 4 : kind === 'lava' && lawEnabled(world, 'eternal-lava') ? 0 : 1));
      if (pool.remaining <= 0) { pools.splice(i, 1); continue; }
      const radius = poolRadius(pool);
      if (!water && !pool.etched && pool.age >= 0.4) {
        applyEvent(world, { kind: 'surface', x: pool.x, y: pool.y, radius: pool.radius, terrain: Terrain.Scorched, origin: kind === 'acid' ? 'acid' : 'volcano' });
        if (kind === 'acid') applyEvent(world, { kind: 'surface', x: pool.x, y: pool.y, radius: pool.radius * 0.45, terrain: Terrain.Crater, origin: 'acid' });
        pool.etched = true;
      }
      if (water || kind === 'lava' && pool.remaining < 2) continue;
      for (const e of world.nearby(pool, radius)) {
        if (lifted.has(e.id) || aboardFerry(world, e.id) || e.components.dragon || e.components.ufo || e.components.projectile || kind === 'lava' && e.components.volcano) continue;
        const d = Math.hypot(e.components.position!.x - pool.x, e.components.position!.y - pool.y);
        hits.set(e.id, Math.max(hits.get(e.id) ?? 0, (0.5 + 0.5 * (1 - d / radius)) * Math.min(1, pool.remaining / (life * 0.2))));
      }
    }
    for (const [id, strength] of [...hits].sort(([a], [b]) => a - b)) {
      applyEvent(world, { kind: 'damage', target: id, amount: rate * strength * dt, cause: kind === 'acid' ? 'acid' : 'fire' });
      if (kind === 'lava') applyEvent(world, { kind: 'heat', target: id, amount: 100 * strength * dt });
    }
  }
}

const acidIcon: PixelSprite = { pixels: ['...aa....', '..abba...', '.abcbba..', 'abcccba..', '.abbba...', '...a.....', '.bb.bbb..', 'bbbbbbbb.'],
  palette: { a: '#38543a', b: '#80a444', c: '#d7df85' }, anchor: { x: 4, y: 4 } };
const volcanoIcon: PixelSprite = { pixels: ['..aa.aa..', '...aba...', '...ccc...', '..cdddc..', '.cdeedcc.', 'ccdeeddcc', 'ccdeeddcc', 'ccccccccc'],
  palette: { a: '#77766b', b: '#d88746', c: '#484b45', d: '#a54d2c', e: '#ffc365' }, anchor: { x: 4, y: 6 } };

export function registerGeohazards(registry: Registry): void {
  registry.registerComponent('volcano', v => number(v.age, 0, 1e8) && number(v.eruption, 0, 2.6) && number(v.cooldown, 0, VOLCANO.period) && seed(v.seed));
  registry.registerEntity({ id: VOLCANO.id, sprite: volcanoIcon, create: (p, rng) => ({ position: { ...p }, health: { current: 1500, max: 1500 },
    solid: { radius: 1.2 }, volcano: { age: 0, eruption: 0, cooldown: VOLCANO.grow, seed: Math.floor(rng.range(0, 0x100000000)) } }) });
  registry.registerScenario<Geohazards>({ id: GEOHAZARDS.id, create: () => ({ acid: [], lava: [], bombs: [], flows: [] }), validate: validState,
    update: (world, state) => { if (!state.acid.length && !state.lava.length && !state.bombs.length && !state.flows.length && ![...world.query('volcano')].length) return 'complete'; },
  });
  registry.registerSystem({ id: GEOHAZARDS.id, after: ['core:rain'], before: ['core:water'], update: (world, dt) => {
    const state = geohazards(world) ?? ([...world.query('volcano')].length ? ensureState(world) : undefined);
    if (state) { update(world, state, dt); markHazardsChanged(world); }
  } });
  registry.registerTool({ id: ACID.id, label: 'Acid', category: 'destruction', icon: acidIcon, radius: ACID.radius, paint: true, color: '#b8c56a',
    hint: 'Pour acid that eats through residents, trees and buildings. Rain dilutes the puddles.',
    apply: (world, p) => { const state = ensureState(world); if (state) addPool(world, state.acid, p, ACID.radius, ACID.life, GEOHAZARDS.acids); },
  });
  registry.registerTool({ id: VOLCANO.id, label: 'Volcano', category: 'destruction', icon: volcanoIcon, radius: 4, color: '#e88c4a',
    hint: 'Place a volcano on land. Repeated eruptions throw hot rocks and send lava through the surroundings.',
    canApply: (world, p) => world.terrain.isLand(p.x, p.y) && [...world.query('volcano')].length < VOLCANO.limit
      && !world.nearby(p, 8).some(e => e.components.volcano),
    apply: (world, p) => {
      if (!world.terrain.isLand(p.x, p.y) || [...world.query('volcano')].length >= VOLCANO.limit || world.nearby(p, 8).some(e => e.components.volcano)) return;
      const state = ensureState(world); if (!state) return;
      const entity = world.spawn(VOLCANO.id, p); if (!entity) return;
      for (const other of world.nearby(p, 2.5).sort((a, b) => a.id - b.id)) if (other.id !== entity.id) {
        if (other.components.ruin) world.remove(other.id);
        else if (!other.components.dragon && !other.components.ufo && !other.components.projectile) applyEvent(world, { kind: 'damage', target: other.id, amount: 500, cause: 'divine', player: true });
      }
      applyEvent(world, { kind: 'surface', ...p, radius: 3.5, terrain: Terrain.Scorched, origin: 'volcano' });
      world.terrain.circle(p.x, p.y, 1.2, (x, y) => { if (world.terrain.isLand(x, y)) world.terrain.set(x, y, Terrain.Mountain); });
    },
  });
}
