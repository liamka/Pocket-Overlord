import type { World } from './world';
import type { Entity, Vec2 } from './types';
import { WORLD_HEIGHT, WORLD_WIDTH } from './types';
import { integer, number, record } from './validation';
import { Random } from './random';
import { lawEnabled } from './world-rules';
import { subspeciesOf } from './subspecies-state';

// Local balance: wiki speeds are scaled to 0.2 cells/s per unit. Every source
// lasts 60 simulation seconds; rendering and the camera never schedule drops.
export const CLOUDS = { id: 'core:thunderstorms', limit: 32, lifetime: 60, speedScale: 0.2,
  interval: 0.75, firstDrop: 0.25, dropsPerTick: 8, densityRadius: 3, densityLimit: 3, boltLife: 0.3 } as const;
export const CLOUD_TYPES = ['life', 'snow', 'rain', 'lightning', 'ash', 'magic', 'rage', 'hell', 'lava', 'acid'] as const;
export type CloudType = typeof CLOUD_TYPES[number];
export type CloudSize = 'small' | 'medium' | 'big';
export type CloudOrigin = 'manual' | 'stormfront' | 'hellstorm' | 'gaia';
export const cloudDefinitions: Record<CloudType, { label: string; speed: [number, number]; color: string; drop: string }> = {
  life: { label: 'Life cloud', speed: [2, 6], color: '#b5cda7', drop: '#80b34c' },
  snow: { label: 'Snow cloud', speed: [1, 4], color: '#c5dbe4', drop: '#e5f6ff' },
  rain: { label: 'Rain cloud', speed: [1, 4], color: '#8aabbd', drop: '#69b8ec' },
  lightning: { label: 'Lightning cloud', speed: [1, 4], color: '#718097', drop: '#fff3b0' },
  ash: { label: 'Ash cloud', speed: [1, 4], color: '#8d8580', drop: '#c6bbb3' },
  magic: { label: 'Magic cloud', speed: [1, 7], color: '#c2a3df', drop: '#f5caee' },
  rage: { label: 'Rage cloud', speed: [1, 4], color: '#bd727c', drop: '#f18b85' },
  hell: { label: 'Hell cloud', speed: [1, 3], color: '#b28266', drop: '#ffae54' },
  lava: { label: 'Lava cloud', speed: [1, 3], color: '#a26656', drop: '#f36238' },
  acid: { label: 'Acid cloud', speed: [1, 4], color: '#9eaf71', drop: '#c1e76b' },
};
export const cloudRadius = (size: CloudSize): number => size === 'small' ? 1.5 : size === 'medium' ? 2.5 : 3.5;
export type LightningBolt = { x: number; y: number; remaining: number; seed: number };
export type Cloud = { id: number; type: CloudType; size: CloudSize; x: number; y: number; speed: number;
  remaining: number; dropIn: number; seed: number; origin: CloudOrigin; bolt: LightningBolt | null;
  lastDrop: { x: number; y: number; remaining: number } | null; result: string };
export type CloudState = { clouds: Cloud[]; nextId: number; cursor: number };
export type CloudDrop = Vec2 & { type: CloudType; seed: number; player: boolean; cloudId?: number };
declare module './types' { interface GameEventMap { precipitation: CloudDrop } }

export const isCloudType = (v: unknown): v is CloudType => CLOUD_TYPES.includes(v as CloudType);
export function validCloudState(v: unknown): v is CloudState {
  if (!record(v) || !integer(v.nextId, 1) || !integer(v.cursor, 0, Number(v.nextId) - 1) || !Array.isArray(v.clouds) || v.clouds.length > CLOUDS.limit) return false;
  const ids = new Set<number>();
  return v.clouds.every(c => {
    if (!record(c) || !integer(c.id, 1, Number(v.nextId) - 1) || ids.has(c.id) || !isCloudType(c.type)
      || !['small', 'medium', 'big'].includes(String(c.size)) || !number(c.x, 0, WORLD_WIDTH + 84) || !number(c.y, 0, WORLD_HEIGHT)
      || !number(c.remaining, 0, CLOUDS.lifetime) || !number(c.dropIn, 0, CLOUDS.interval)
      || !integer(c.seed, 0, 0xffffffff) || !['manual', 'stormfront', 'hellstorm', 'gaia'].includes(String(c.origin))
      || typeof c.result !== 'string' || c.result.length > 160) return false;
    const [min, max] = cloudDefinitions[c.type].speed;
    if (c.type === 'magic' && c.size !== 'small' || c.type !== 'magic' && c.type !== 'life' && c.size !== 'big') return false;
    if (!number(c.speed, min * CLOUDS.speedScale, max * CLOUDS.speedScale)
      || c.origin === 'stormfront' && c.type !== 'lightning' || c.origin === 'hellstorm' && c.type !== 'hell' || c.origin === 'gaia' && c.type !== 'life') return false;
    if (c.bolt !== null && (!record(c.bolt) || !number(c.bolt.x, 0, WORLD_WIDTH) || !number(c.bolt.y, 0, WORLD_HEIGHT)
      || !number(c.bolt.remaining, 0, CLOUDS.boltLife) || !integer(c.bolt.seed, 0, 0xffffffff) || c.type !== 'lightning')) return false;
    if (c.lastDrop !== null && (!record(c.lastDrop) || !number(c.lastDrop.x, 0, WORLD_WIDTH) || !number(c.lastDrop.y, 0, WORLD_HEIGHT)
      || !number(c.lastDrop.remaining, 0, CLOUDS.interval))) return false;
    ids.add(c.id); return true;
  });
}
export function cloudState(world: World): CloudState | undefined {
  return world.scenarios.find(s => s.id === CLOUDS.id)?.state as CloudState | undefined;
}
export const clouds = (world: World): readonly Cloud[] => cloudState(world)?.clouds ?? [];
export function summonCloud(world: World, type: CloudType, p: Vec2, origin: CloudOrigin = 'manual'): Cloud | string {
  if (world.paused) return 'Resume time to summon clouds.';
  if (!world.terrain.inside(p.x, p.y)) return 'Choose a point inside the world.';
  if (origin === 'stormfront' && type !== 'lightning' || origin === 'hellstorm' && type !== 'hell' || origin === 'gaia' && type !== 'life') return 'This cloud cannot come from that source.';
  let state = cloudState(world);
  if (!state) {
    if (!world.startScenario(CLOUDS.id)) return 'Too many active clouds.';
    state = cloudState(world)!;
  }
  // Holding a brush cannot multiply the local source or extend a plot's deadline.
  const nearby = state.clouds.find(c => c.type === type && c.origin === origin && Math.hypot(c.x - p.x, c.y - p.y) < 1.4);
  if (nearby) return nearby;
  if (state.clouds.length >= CLOUDS.limit) return 'Too many active clouds.';
  const seed = Math.floor(world.rng.next() * 0x100000000), random = new Random(seed), range = cloudDefinitions[type].speed;
  const size: CloudSize = type === 'magic' ? 'small' : type === 'life' ? (['small', 'medium', 'big'] as const)[Math.floor(random.next() * 3)] : 'big';
  const cloud: Cloud = { id: state.nextId++, type, size, ...p, speed: random.range(...range) * CLOUDS.speedScale,
    remaining: CLOUDS.lifetime, dropIn: CLOUDS.firstDrop, seed: random.state, origin, bolt: null, lastDrop: null, result: 'Waiting for precipitation' };
  state.clouds.push(cloud); return cloud;
}
export function cancelCloud(world: World, id: number): boolean {
  const state = cloudState(world), index = state?.clouds.findIndex(c => c.id === id) ?? -1;
  if (!state || index < 0) return false;
  state.clouds.splice(index, 1); return true; // Drops are synchronous, so nothing remains queued by this source.
}
/** Called inside the existing, once-only death transaction. Cloud expiry gives no reward. */
export function cloudOnDeath(world: World, entity: Entity): void {
  if (!entity.components.position || !lawEnabled(world, 'clouds-of-life')) return;
  if (subspeciesOf(entity)?.traits.includes('gaia-roots') || world.registry.cloudGaiaBlood(world, entity)) {
    if (world.rng.next() < 0.3) summonCloud(world, 'life', entity.components.position, 'gaia');
  }
}
