import type { World } from './world';

export const GEOHAZARDS = { id: 'core:geohazards', acids: 64, lava: 160, bombs: 64, flows: 32 } as const;
export const ACID = { id: 'core:acid', radius: 3.2, life: 9, damage: 28 } as const;
export const VOLCANO = { id: 'core:volcano', limit: 12, grow: 2, period: 10, lavaLife: 12, damage: 48 } as const;
export type Pool = { x: number; y: number; radius: number; age: number; remaining: number; seed: number; etched: boolean };
export type LavaBomb = { x: number; y: number; tx: number; ty: number; age: number; life: number; seed: number };
export type LavaFlow = { x: number; y: number; heading: number; left: number; stepIn: number; seed: number };
export type Volcano = { age: number; eruption: number; cooldown: number; seed: number };
export type Geohazards = { acid: Pool[]; lava: Pool[]; bombs: LavaBomb[]; flows: LavaFlow[] };

export function geohazards(world: World): Geohazards | undefined {
  return world.scenarios.find(s => s.id === GEOHAZARDS.id)?.state as Geohazards | undefined;
}
export function poolRadius(pool: Pool): number {
  return pool.radius * Math.min(1, 0.25 + pool.age * 2) * Math.min(1, pool.remaining / 1.5);
}
export function bombPose(bomb: LavaBomb): { x: number; y: number; z: number } {
  const t = Math.min(1, bomb.age / bomb.life);
  return { x: bomb.x + (bomb.tx - bomb.x) * t, y: bomb.y + (bomb.ty - bomb.y) * t, z: (1 - t) * 5 + 24 * t * (1 - t) };
}
export function hazardAreas(world: World): { x: number; y: number; radius: number }[] {
  const state = geohazards(world);
  return state ? [...state.acid, ...state.lava].filter(p => p.remaining > 1).map(p => ({ x: p.x, y: p.y, radius: poolRadius(p) })) : [];
}
