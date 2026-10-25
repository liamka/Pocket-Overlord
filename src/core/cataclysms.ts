import { noise } from './random';
import type { World } from './world';

export const CATACLYSMS = { id: 'core:cataclysms', captives: 256, stains: 160, bursts: 80, stainLife: 24, burstLife: 1.8 } as const;
export const TORNADO = { id: 'core:blood-tornado', radius: 9, speed: 10, grow: 0.65, life: 12, collapse: 1.3, rain: 2.2, carry: 2.4, limit: 3 } as const;
export const GRAVITY = { id: 'core:gravity-clap', radius: 11, charge: 2.2, wave: 0.65, end: 4.2, limit: 6 } as const;
export type Captive = { id: number; x: number; y: number; at: number; angle: number };
export type BloodTornado = { x: number; y: number; targetX: number; targetY: number; vx: number; vy: number;
  age: number; released: number | null; seed: number; blood: number; debris: number; captives: Captive[] };
export type GravityClap = { x: number; y: number; age: number; seed: number; fired: boolean; blood: number; hit: string; captives: Captive[] };
export type BloodStain = { x: number; y: number; age: number; seed: number; size: number };
export type CataclysmBurst = { x: number; y: number; z: number; age: number; seed: number; spread: number; kind: 'blood' | 'debris' };
export type CataclysmState = { tornadoes: BloodTornado[]; claps: GravityClap[]; stains: BloodStain[]; bursts: CataclysmBurst[] };
export type LiftedPose = { x: number; y: number; z: number; angle: number; scale: number };

export const ease = (t: number): number => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
export function cataclysms(world: World): CataclysmState | undefined {
  return world.scenarios.find(scenario => scenario.id === CATACLYSMS.id)?.state as CataclysmState | undefined;
}
export function liftedIds(world: World): Set<number> {
  const state = cataclysms(world);
  return new Set(state ? [...state.tornadoes, ...state.claps].flatMap(power => power.captives.map(c => c.id)) : []);
}
export function tornadoStrength(t: BloodTornado): number {
  return ease(t.age / TORNADO.grow) * (1 - ease(t.released === null ? 0 : (t.age - t.released) / TORNADO.collapse));
}
export function tornadoCaptivePose(t: BloodTornado, c: Captive): LiftedPose {
  const age = Math.max(0, t.age - c.at), blend = ease(age / 0.55), rise = ease(age / TORNADO.carry);
  const turn = (age - 0.25 * (1 - Math.exp(-age * 4))) * (3.6 + noise(c.id, t.seed) * 1.4);
  const angle = c.angle + turn;
  const radius = 1.3 + rise * 3.4, z = rise * 12;
  return { x: c.x + (t.x + Math.cos(angle) * radius - t.vx * rise * 0.12 - c.x) * blend,
    y: c.y + (t.y + Math.sin(angle) * radius * 0.55 - c.y) * blend,
    z, angle: (turn * 0.8 + Math.sin(age * 2 + c.id) * 0.3) * blend, scale: 1 - rise * 0.12 };
}
export function gravityCaptivePose(g: GravityClap, c: Captive): LiftedPose {
  const age = Math.max(0, g.age - c.at), lift = ease(age / 0.8);
  const phase = Math.max(0, Math.min(1, (g.age - 0.5) / 1.6)), pull = phase ** 3;
  const tremble = Math.sin(age * 12 + c.id) * 0.07 * pull * (1 - pull);
  return { x: c.x + (g.x - c.x) * pull + tremble, y: c.y + (g.y - c.y) * pull,
    z: lift * (3 + noise(c.id, 31) * 2) * (1 - pull) + 7.5 * pull,
    angle: Math.sin(age * 3 + c.id) * 0.25 * lift + pull * (c.id % 2 ? 1 : -1) * 2,
    scale: 1 - ease((g.age - 2.05) / 0.15) * 0.7 };
}
