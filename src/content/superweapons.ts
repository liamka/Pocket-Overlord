import type { PixelSprite, Registry } from './registry';
import { integer, number, record } from '../core/validation';
import { isBridge, Terrain, WORLD_HEIGHT, WORLD_WIDTH, type Vec2 } from '../core/types';
import type { World } from '../core/world';
import { launchSeaWave } from '../systems/effects';

export const HAMMER = { id: 'core:hammer-of-dawn', charge: 0.6, interval: 0.1, radius: 6, groundRadius: 3.5, speed: 10 } as const;
export const TSAR = { id: 'core:tsar-bomba', delay: 0.9, radius: 40, damageRadius: 52, craterRadius: 12, falloutRadius: 22, interval: 0.5, pulses: 37, cloud: 5, end: 19.4 } as const;
export type SuperweaponStrike = { x: number; y: number; elapsed: number; next: number; seed: number; targetX?: number; targetY?: number };
type StrikeState = { strikes: SuperweaponStrike[] };
type Timing = { start: number; interval: number; pulses?: number; end?: number };
const hammerTiming: Timing = { start: HAMMER.charge, ...HAMMER };
const tsarTiming: Timing = { start: TSAR.delay, ...TSAR };

function validState(value: unknown, timing: Timing): value is StrikeState {
  return record(value) && Array.isArray(value.strikes) && value.strikes.length <= 16 && value.strikes.every(strike =>
    record(strike) && number(strike.x, 0, WORLD_WIDTH) && number(strike.y, 0, WORLD_HEIGHT)
    && (timing !== hammerTiming || number(strike.targetX, 0, WORLD_WIDTH) && number(strike.targetY, 0, WORLD_HEIGHT))
    && number(strike.elapsed, 0, timing.end ?? 1e8) && integer(strike.seed, 0, 0xffffffff)
    && integer(strike.next, 0, timing.pulses ?? 1e9)
    && strike.next === Math.min(timing.pulses ?? Infinity, Math.max(0, Math.floor((strike.elapsed - timing.start + 1e-9) / timing.interval) + 1)));
}

export function superweaponStrikes(world: World, id: typeof HAMMER.id | typeof TSAR.id): readonly SuperweaponStrike[] {
  const state = world.scenarios.find(scenario => scenario.id === id)?.state;
  return validState(state, id === HAMMER.id ? hammerTiming : tsarTiming) ? state.strikes : [];
}

const hammerIcon: PixelSprite = {
  pixels: [
    '..aa..........aa..', '.abbba..cc..abbba.', '.abdbaccddccabdba.', '.abbba.cddc.abbba.', '..aa...ceec...aa..',
    '.......ceec.......', '.......ceec.......', '......cgeegc......', '.......geeg.......', '.......geeg.......',
    '......gheehg......', '.......heeh.......', '....ghhheehhhg....', '..ghheeeeeeeehhg..', '....ghhhhhhhg.....',
  ],
  palette: { a: '#233d52', b: '#477b9b', c: '#5d6e70', d: '#b9d2c7', e: '#fff6cc', g: '#d67a29', h: '#ffc65c' }, anchor: { x: 9, y: 8 },
};
const tsarIcon: PixelSprite = {
  pixels: [
    '.......aaa.......', '......abbba......', '.....abcccba.....', '.....abcddba.....', '.....abcccba.....',
    '....abeeeeeba....', '....abefffeba....', '....abefffeba....', '....abeeeeeba....',
    '.....abcccba.....', '.....abcccba.....', '....aabcccbaa....', '...abbabbbabba...', '...abbaaaaabba...', '....aa...aa......',
  ],
  palette: { a: '#2d4045', b: '#8b9f98', c: '#dedbc2', d: '#fff2c9', e: '#d7a24c', f: '#574a35' }, anchor: { x: 8, y: 7 },
};

function sear(world: World, point: Vec2): void {
  const { x, y } = point;
  world.events.push({ kind: 'surface', origin: 'heat-ray', x, y, radius: HAMMER.groundRadius, terrain: Terrain.Scorched },
    { kind: 'surface', origin: 'heat-ray', x, y, radius: 1.5, terrain: Terrain.Crater });
  for (const entity of world.nearby(point, HAMMER.radius).sort((a, b) => a.id - b.id)) {
    if (entity.components.projectile) continue;
    if (entity.components.thermal) world.events.push({ kind: 'heat', target: entity.id, amount: 80, player: true });
    if (entity.components.health) world.events.push({ kind: 'damage', target: entity.id, amount: 108, cause: 'divine', player: true });
  }
}

/** A breached coastal crater fills from adjoining water, permanently removing its land. */
function floodCoastalCrater(world: World, point: Vec2): void {
  const map = world.terrain, crater: Vec2[] = [];
  let flooded = false;
  const waterAt = (x: number, y: number): boolean => map.inside(x, y)
    && (map.at(x, y) <= Terrain.Water || isBridge(map.at(x, y)));
  map.circle(point.x, point.y, TSAR.craterRadius, (x, y) => {
    crater.push({ x, y });
    flooded ||= waterAt(x, y) || waterAt(x - 1, y) || waterAt(x + 1, y) || waterAt(x, y - 1) || waterAt(x, y + 1);
  });
  if (!flooded) return;
  for (const { x, y } of crater) if (map.isLand(x, y)) map.set(x, y, Terrain.Water);
}

function detonate(world: World, point: Vec2): void {
  const { x, y } = point;
  floodCoastalCrater(world, point);
  // Trace the waves against the new coastline, after the crater has filled.
  launchSeaWave(world, point, TSAR.radius);
  world.events.push({ kind: 'surface', x, y, radius: TSAR.radius, terrain: Terrain.Scorched },
    { kind: 'surface', x, y, radius: TSAR.craterRadius, terrain: Terrain.Crater });
  for (const entity of world.nearby(point, TSAR.damageRadius).sort((a, b) => a.id - b.id)) {
    if (entity.components.projectile) continue;
    const position = entity.components.position!, dx = position.x - point.x, dy = position.y - point.y;
    const distance = Math.hypot(dx, dy), force = 28 * Math.max(0, 1 - distance / TSAR.damageRadius) / (distance || 1);
    if (entity.components.thermal) world.events.push({ kind: 'heat', target: entity.id, amount: 500, player: true });
    if (entity.components.health) world.events.push({ kind: 'damage', target: entity.id, amount: 3500, cause: 'explosion', player: true });
    if (entity.components.motion) world.events.push({ kind: 'impulse', target: entity.id, x: dx * force, y: dy * force });
  }
}

function fallout(world: World, point: Vec2): void {
  for (const entity of world.nearby(point, TSAR.falloutRadius).sort((a, b) => a.id - b.id)) {
    if (!entity.components.projectile && entity.components.health) world.events.push({ kind: 'damage', target: entity.id, amount: 15, cause: 'other', player: true });
  }
}

function registerStrike(registry: Registry, id: string, timing: Timing, pulse: (world: World, strike: SuperweaponStrike, index: number) => void): void {
  registry.registerScenario<StrikeState>({ id, create: () => ({ strikes: [] }), validate: (state): state is StrikeState => validState(state, timing),
    update: (world, state, dt) => {
      for (let i = state.strikes.length - 1; i >= 0; i--) {
        const strike = state.strikes[i]; strike.elapsed += dt;
        if (id === HAMMER.id) {
          const dx = strike.targetX! - strike.x, dy = strike.targetY! - strike.y, distance = Math.hypot(dx, dy);
          // Limit the sweep speed so successive damage pulses leave a continuous trench.
          const fraction = Math.min(1 - Math.exp(-8 * dt), HAMMER.speed * dt / (distance || 1));
          strike.x += dx * fraction; strike.y += dy * fraction;
        }
        while (strike.next < (timing.pulses ?? Infinity) && strike.elapsed + 1e-9 >= timing.start + strike.next * timing.interval) pulse(world, strike, strike.next++);
        if (timing.end !== undefined && strike.elapsed >= timing.end) state.strikes.splice(i, 1);
      }
      if (!state.strikes.length) return 'complete';
    },
  });
}

function callStrike(world: World, point: Vec2, id: typeof HAMMER.id | typeof TSAR.id): string | void {
  let scenario = world.scenarios.find(scenario => scenario.id === id);
  if (!scenario) {
    if (!world.startScenario(id)) return 'Too many active superweapons';
    scenario = world.scenarios.find(scenario => scenario.id === id)!;
  }
  const state = scenario.state;
  if (!validState(state, id === HAMMER.id ? hammerTiming : tsarTiming) || state.strikes.length >= 16) return 'Too many active superweapons';
  if (id === HAMMER.id && state.strikes.length) {
    const strike = state.strikes[0]; strike.targetX = point.x; strike.targetY = point.y; return;
  }
  state.strikes.push({ ...point, elapsed: 0, next: 0, seed: Math.floor(world.rng.range(0, 0x100000000)),
    ...(id === HAMMER.id ? { targetX: point.x, targetY: point.y } : {}),
  });
}

/** Both attacks use saved simulation time; loading never repeats an impact. */
export function registerSuperweapons(registry: Registry): void {
  registerStrike(registry, HAMMER.id, hammerTiming, sear);
  registerStrike(registry, TSAR.id, tsarTiming, (world, strike, index) => index === 0 ? detonate(world, strike) : fallout(world, strike));
  registry.registerTool({ id: HAMMER.id, category: 'destruction', icon: hammerIcon, label: 'Hammer of Dawn', color: '#ffd36b', radius: HAMMER.radius, showArea: false,
    hint: 'Hold the left mouse button to fire an orbital beam. Move the pointer to guide it; release to stop. Right-drag to pan.',
    apply: (world, point) => callStrike(world, point, HAMMER.id),
    aim: (world, point) => {
      const strikes = superweaponStrikes(world, HAMMER.id);
      for (let i = strikes.length - 1; i >= 0; i--) {
        const strike = strikes[i];
        strike.targetX = point.x; strike.targetY = point.y; break;
      }
    },
    release: world => {
      const index = world.scenarios.findIndex(scenario => scenario.id === HAMMER.id);
      if (index >= 0) world.scenarios.splice(index, 1);
    },
  }).registerTool({ id: TSAR.id, category: 'destruction', icon: tsarIcon, label: 'Tsar Bomba 100MT', color: '#f4b36c', radius: TSAR.damageRadius, showArea: false,
    hint: 'Drop a 100MT bomb. A huge blast leaves a crater, a mushroom cloud and lingering radioactive fallout. Coastal craters fill with water.',
    apply: (world, point) => callStrike(world, point, TSAR.id),
  });
}
