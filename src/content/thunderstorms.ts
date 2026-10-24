import type { PixelSprite, Registry } from './registry';
import { integer, number, record } from '../core/validation';
import { Terrain, WORLD_HEIGHT, WORLD_WIDTH, type Vec2 } from '../core/types';
import type { World } from '../core/world';

// Keep the existing tool ID so saved toolbar preferences still select this power.
export const STORM = { id: 'core:thunderstorms', toolId: 'core:rain', radius: 3.5, duration: 6,
  firstStrike: 0.25, interval: 0.75, boltLife: 0.3, hitRadius: 1.25, limit: 32 } as const;
export type LightningBolt = { x: number; y: number; remaining: number; seed: number };
export type StormCloud = { x: number; y: number; remaining: number; strikeIn: number; bolt: LightningBolt | null };
type StormState = { clouds: StormCloud[] };

function validState(value: unknown): value is StormState {
  return record(value) && Array.isArray(value.clouds) && value.clouds.length <= STORM.limit && value.clouds.every(cloud =>
    record(cloud) && number(cloud.x, 0, WORLD_WIDTH) && number(cloud.y, 0, WORLD_HEIGHT)
    && number(cloud.remaining, 0, STORM.duration) && number(cloud.strikeIn, 0, STORM.interval)
    && (cloud.bolt === null || record(cloud.bolt) && number(cloud.bolt.x, 0, WORLD_WIDTH)
      && number(cloud.bolt.y, 0, WORLD_HEIGHT) && number(cloud.bolt.remaining, 0, STORM.boltLife)
      && integer(cloud.bolt.seed, 0, 0xffffffff)));
}

export function stormClouds(world: World): readonly StormCloud[] {
  const state = world.scenarios.find(scenario => scenario.id === STORM.id)?.state;
  return validState(state) ? state.clouds : [];
}

function strike(world: World, cloud: StormCloud): void {
  const targets = world.nearby(cloud, STORM.radius).filter(entity => {
    const { thermal, combustible, position, projectile } = entity.components;
    return thermal && combustible && combustible.fuel > 0 && !projectile && world.terrain.isLand(position!.x, position!.y);
  });
  const unburnt = targets.filter(entity => !entity.components.thermal!.burning);
  const candidates = unburnt.length ? unburnt : targets;
  let point: Vec2;
  if (candidates.length) point = candidates[Math.floor(world.rng.next() * candidates.length)].components.position!;
  else {
    const angle = world.rng.range(0, Math.PI * 2), distance = Math.sqrt(world.rng.next()) * STORM.radius;
    point = { x: Math.max(0, Math.min(world.terrain.width - 0.01, cloud.x + Math.cos(angle) * distance)),
      y: Math.max(0, Math.min(world.terrain.height - 0.01, cloud.y + Math.sin(angle) * distance)) };
  }
  cloud.bolt = { ...point, remaining: STORM.boltLife, seed: Math.floor(world.rng.range(0, 0x100000000)) };
  world.events.push({ kind: 'surface', ...point, radius: STORM.hitRadius, terrain: Terrain.Scorched });
  for (const entity of world.nearby(point, STORM.hitRadius)) {
    const { thermal, combustible, position, projectile } = entity.components;
    if (!thermal || !combustible || combustible.fuel <= 0 || projectile || !world.terrain.isLand(position!.x, position!.y)) continue;
    // A direct lightning strike evaporates moisture before igniting the fuel.
    thermal.wetness = 0;
    world.events.push({ kind: 'heat', target: entity.id, amount: combustible.ignition + 100 });
    if (entity.components.health) world.events.push({ kind: 'damage', target: entity.id, amount: 14 });
  }
}

const icon: PixelSprite = {
  pixels: [
    '......aaaaaa......', '....aabbbbbbaa....', '..aabbbccccbbbaa..', '.abbbccccccccbbba.',
    'abbbccccccccccbbba', 'abbbbbbbbbbbbbbbba', '.aaaaaaaaaaaaaaaa.', '.........ddd......',
    '...ee...ddd...ee..', '...ee..ddd....ee..', '..ee..dddddd.ee...', '..ee.....dd..ee...',
    '........dd........', '.......dd.........', '......d...........',
  ],
  palette: { a: '#293344', b: '#526079', c: '#78849a', d: '#fff1a6', e: '#6bc5ed' }, anchor: { x: 9, y: 7 },
};

export function registerThunderstorms(registry: Registry): void {
  registry.registerScenario<StormState>({ id: STORM.id, create: () => ({ clouds: [] }), validate: validState,
    update: (world, state, dt) => {
      for (let i = state.clouds.length - 1; i >= 0; i--) {
        const cloud = state.clouds[i];
        cloud.remaining -= dt;
        if (cloud.remaining <= 0) { state.clouds.splice(i, 1); continue; }
        if (cloud.bolt) {
          cloud.bolt.remaining -= dt;
          if (cloud.bolt.remaining <= 0) cloud.bolt = null;
        }
        cloud.strikeIn -= dt;
        if (cloud.strikeIn <= 1e-9) { strike(world, cloud); cloud.strikeIn = Math.min(STORM.interval, cloud.strikeIn + STORM.interval); }
      }
      if (!state.clouds.length) return 'complete';
    },
  });
  registry.registerTool({ id: STORM.toolId, category: 'destruction', icon, label: 'Thunderstorm', radius: STORM.radius,
    color: '#a6c7ff', continuous: true,
    hint: 'Click or hold to summon a thunderstorm. Lightning sets people, houses, trees and other flammable objects on fire.',
    apply: (world, point) => {
      let scenario = world.scenarios.find(scenario => scenario.id === STORM.id);
      if (!scenario) {
        if (!world.startScenario(STORM.id)) return 'Too many active thunderstorms';
        scenario = world.scenarios.find(scenario => scenario.id === STORM.id)!;
      }
      if (!validState(scenario.state)) return;
      const nearby = scenario.state.clouds.find(cloud => Math.hypot(cloud.x - point.x, cloud.y - point.y) < STORM.radius * 0.4);
      if (nearby) { nearby.x = point.x; nearby.y = point.y; nearby.remaining = STORM.duration; return; }
      if (scenario.state.clouds.length >= STORM.limit) return 'Too many active thunderstorms';
      scenario.state.clouds.push({ ...point, remaining: STORM.duration, strikeIn: STORM.firstStrike, bolt: null });
    },
  });
}
