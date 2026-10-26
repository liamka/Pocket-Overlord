import type { PixelSprite, Registry } from './registry';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { integer, number, record } from '../core/validation';
import type { World } from '../core/world';
import { flightExitDistance, flightPoint } from '../core/flight';

const STRIKE_ID = 'core:napalm-strike';
export const NAPALM_FIRE_ID = 'core:napalm-fire';
export const NAPALM = {
  count: 15, spacing: 7 / 3, scatter: 2, radius: 16 / 3,
  approach: 1.2, interval: 0.11, fall: 0.65, exit: 1.4,
  altitude: 10, drift: 6, fireSeconds: 3,
} as const;
export const NAPALM_LAST_DROP = NAPALM.approach + (NAPALM.count - 1) * NAPALM.interval;
export const NAPALM_END = NAPALM_LAST_DROP + NAPALM.exit;
export type NapalmBomb = { x: number; y: number; index: number };
export type NapalmStrike = { x: number; y: number; heading: number; next: number; elapsed: number; bombs: NapalmBomb[] };
type NapalmState = { strikes: NapalmStrike[] };

function validState(value: unknown): value is NapalmState {
  return record(value) && Array.isArray(value.strikes) && value.strikes.length <= 64 && value.strikes.every(strike =>
    record(strike) && number(strike.x, 0, WORLD_WIDTH) && number(strike.y, 0, WORLD_HEIGHT)
    && number(strike.heading, 0, Math.PI * 2)
    && integer(strike.next, 0, NAPALM.count) && number(strike.elapsed, 0, NAPALM_END)
    && Array.isArray(strike.bombs) && strike.bombs.length <= NAPALM.count
    && new Set(strike.bombs.map(bomb => record(bomb) ? bomb.index : null)).size === strike.bombs.length
    && strike.bombs.every(bomb => record(bomb) && integer(bomb.index, 0, Number(strike.next) - 1)
      && number(bomb.x, -19, WORLD_WIDTH + 19) && number(bomb.y, -19, WORLD_HEIGHT + 19)
      && number(Number(strike.elapsed) - NAPALM.approach - bomb.index * NAPALM.interval, -1e-7, NAPALM.fall)));
}

export function napalmStrikes(world: World): readonly NapalmStrike[] {
  const state = world.scenarios.find(scenario => scenario.id === STRIKE_ID)?.state;
  return validState(state) ? state.strikes : [];
}

/** Shared flight geometry keeps the plane, falling canisters and impacts aligned. */
export function napalmPlanePosition(strike: NapalmStrike, worldWidth: number, worldHeight: number) {
  const speed = NAPALM.spacing / NAPALM.interval;
  const first = -7 * NAPALM.spacing - NAPALM.drift;
  if (strike.elapsed < NAPALM.approach) {
    const before = NAPALM.approach - strike.elapsed;
    const start = Math.min(-flightExitDistance(strike, strike.heading + Math.PI, worldWidth, worldHeight), first - speed * NAPALM.approach);
    return flightPoint(strike, strike.heading, first - speed * before - (first - start - speed * NAPALM.approach) * (before / NAPALM.approach) ** 2);
  }
  const last = first + (NAPALM.count - 1) * NAPALM.spacing;
  if (strike.elapsed <= NAPALM_LAST_DROP) return flightPoint(strike, strike.heading, first + (strike.elapsed - NAPALM.approach) * speed);
  const after = strike.elapsed - NAPALM_LAST_DROP;
  const end = Math.max(flightExitDistance(strike, strike.heading, worldWidth, worldHeight), last + speed * NAPALM.exit);
  return flightPoint(strike, strike.heading, last + speed * after + (end - last - speed * NAPALM.exit) * (after / NAPALM.exit) ** 2);
}

export function napalmBombPose(strike: NapalmStrike, bomb: NapalmBomb, progress: number) {
  const release = flightPoint(strike, strike.heading, (bomb.index - 7) * NAPALM.spacing - NAPALM.drift);
  const p = Math.max(0, Math.min(1, progress));
  const dx = bomb.x - release.x, dy = bomb.y - release.y;
  const ground = { x: release.x + dx * p, y: release.y + dy * p };
  return { x: ground.x, y: ground.y - NAPALM.altitude * (1 - p * p), ground,
    heading: Math.atan2(dy + 2 * NAPALM.altitude * p, dx) };
}

const embers: PixelSprite = {
  pixels: ['..aa..a...', '.abbaabbaa', 'aabccbbba.', '.aaabbaa..'],
  palette: { a: '#61372b', b: '#c65426', c: '#ffb43b' }, anchor: { x: 5, y: 2 },
};
const icon: PixelSprite = {
  pixels: [
    '...........a............', '..........aaa...........', '..........abba..........',
    '.........abbba..........', '....a....abbba..........', '....aa..abcbba..........',
    '....aba.abccbba...a.....', '...abbbaabcccbba.aa.....', '...abbbaabcccbbaaba.....',
    '..abbccbabccccbbabba....', '..abbccccccccccbbba.....', '.abbcccccdccccccbba.....',
    '.abbcccddddcccccbba.....', '.abbcccddddcccccbba.....', '..abbccddddccccbba......',
    '...abbccddccccbba.......', '....aabcccccbbaa........', '......aaaaaaa...........',
    '........................', '.aa....aa....aa....aa...', '.bb....bb....bb....bb...',
  ],
  palette: { a: '#873524', b: '#e3672c', c: '#ffb43b', d: '#fff0a2' }, anchor: { x: 12, y: 11 },
};

/** A saved scenario schedules the carpet bombing using simulation time. */
export function registerNapalm(registry: Registry): void {
  registry.registerEntity({ id: NAPALM_FIRE_ID, sprite: embers, create: position => ({
    position: { ...position }, combustible: { fuel: NAPALM.fireSeconds, ignition: 15 },
    thermal: { temperature: 100, wetness: 0, burning: true, ignition: { cause: 'fire', player: true } },
  }) });
  registry.registerScenario<NapalmState>({ id: STRIKE_ID, create: () => ({ strikes: [] }), validate: validState,
    update: (world, state, dt) => {
      for (let i = state.strikes.length - 1; i >= 0; i--) {
        const strike = state.strikes[i];
        strike.elapsed += dt;
        while (strike.next < NAPALM.count && strike.elapsed + 1e-9 >= NAPALM.approach + strike.next * NAPALM.interval) {
          strike.bombs.push({ ...flightPoint(strike, strike.heading, (strike.next - 7) * NAPALM.spacing,
            world.rng.range(-NAPALM.scatter, NAPALM.scatter)), index: strike.next++ });
        }
        for (let b = strike.bombs.length - 1; b >= 0; b--) {
          const bomb = strike.bombs[b];
          if (strike.elapsed + 1e-9 < NAPALM.approach + bomb.index * NAPALM.interval + NAPALM.fall) continue;
          strike.bombs.splice(b, 1);
          if (!world.terrain.inside(bomb.x, bomb.y)) continue;
          world.events.push({ kind: 'blast', x: bomb.x, y: bomb.y, radius: NAPALM.radius, power: 144, heat: 180, style: 'napalm', player: true });
          if (world.terrain.isLand(bomb.x, bomb.y)) world.spawn(NAPALM_FIRE_ID, { x: bomb.x, y: bomb.y });
        }
        if (strike.elapsed >= NAPALM_END && !strike.bombs.length) state.strikes.splice(i, 1);
      }
      if (!state.strikes.length) return 'complete';
    },
  });
  registry.registerSystem({ id: 'core:napalm-fire', after: ['core:fire'], before: ['core:landscape'], update: world => {
    for (const entity of world.query('thermal', 'combustible')) {
      if (entity.typeId === NAPALM_FIRE_ID && (!entity.components.thermal!.burning || entity.components.combustible!.fuel <= 0)) world.remove(entity.id);
    }
  } });
  registry.registerTool({ id: 'core:napalm', category: 'destruction', icon, label: 'Napalm Airstrike',
    hint: 'Call a bomber to drop 15 napalm canisters. Burning fuel spreads along a narrow strip.',
    radius: NAPALM.radius, showArea: false, color: '#f59a46',
    apply: (world, point) => {
      let scenario = world.scenarios.find(scenario => scenario.id === STRIKE_ID);
      if (!scenario) {
        if (!world.startScenario(STRIKE_ID)) return 'Too many active airstrikes';
        scenario = world.scenarios.find(scenario => scenario.id === STRIKE_ID)!;
      }
      if (!validState(scenario.state) || scenario.state.strikes.length >= 64) return 'Too many active airstrikes';
      scenario.state.strikes.push({ ...point, heading: Math.floor(world.rng.range(0, 8)) * Math.PI / 4, next: 0, elapsed: 0, bombs: [] });
    },
  });
}
