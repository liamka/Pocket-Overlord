import type { ResourceBundle } from './resources';
import type { Vec2 } from './types';

export const VISITORS_ID = 'core:overseas-visitors';
export const VISITOR_SHIP_ID = 'core:visitor-ship';
export const HUNTER_ID = 'core:monster-hunter';
export const VISITORS = { firstTrade: 90 * 30, tradeInterval: 180 * 30, huntInterval: 120 * 30,
  stay: 30, huntDuration: 75 * 30, hunters: 3, reach: 12, damage: 100, attackDelay: 1.25, speed: 2.8 } as const;
export type VisitorSchedule = { tradeAt: number; huntAt: number };
export interface ForeignVoyage {
  kind: 'merchants' | 'hunters';
  phase: 'arriving' | 'visiting' | 'departing';
  entry: Vec2;
  berth: Vec2;
  shore: Vec2;
  portId: number | null;
  villageId: number | null;
  monsterId: number | null;
  goods: ResourceBundle;
  purchases: ResourceBundle;
  wait: number;
  retryIn: number;
  leaveAt: number;
  traded: boolean;
}
export interface MonsterHunter {
  shipId: number | null;
  targetId: number | null;
  returning: boolean;
  exit: Vec2;
  path: Vec2[];
  rethink: number;
  cooldown: number;
  heading: number;
  stride: number;
  moving: boolean;
  loot: ResourceBundle;
}
declare module './types' { interface ComponentMap { foreignVoyage: ForeignVoyage; monsterHunter: MonsterHunter } }
