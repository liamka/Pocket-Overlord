import type { Entity, Vec2, Village } from './types';
import type { Storage } from './stockpiles';
import type { ForestPolicy, ForestProblem } from './forestry';
import type { MiningReason } from './deposits';
import { LEGACY_GOODS, type ResourceBundle, type ResourceId } from './resources';

export const GOODS = LEGACY_GOODS;
export type Good = typeof GOODS[number];
export type WorkplaceKind = 'market' | 'mill' | 'bakery' | 'workshop';
export interface VillageEconomy {
  taxRate?: import('./currency').TaxRate;
  supplyAfter?: number;
  supplyHistory?: import('./supply').SupplyEntry[];
  metalworking?: number;
  forestPolicy?: ForestPolicy;
  forestProblem?: ForestProblem;
  storage?: Storage[];
  stocks: Record<Good, number> & ResourceBundle;
  lost?: ResourceBundle;
  spent?: ResourceBundle;
  deliveries: number;
  buildAfter: number;
}
export interface VillageGovernment {
  leaderId: number | null;
  trust: number;
  electedAt: number;
  electionAt: number;
  lastHarvest: number;
  elections: number;
}
/** The primary and byproducts are one indivisible ownership transfer. */
export interface Cargo { good: ResourceId; amount: number; villageId: number; byproducts?: ResourceBundle }
export interface ResidentWork { good: ResourceId; progress: number; cargo: Cargo | null; waiting?: MiningReason; orderId?: number; mine?: import('./mines').MineShift; reservation?: { villageId: number; inputs: ResourceBundle } }
export interface Integration {
  villageId: number; groupId: number; arrived: number;
  status: 'settling' | 'settled' | 'isolated'; belonging: number; worked: boolean;
  friendId: number | null; contactId: number | null; contact: number;
  socialAfter: number; socialUntil: number; leaveAfter: number;
}
export interface Animal {
  parents?: number[];
  kind: 'sheep' | 'dog' | 'wolf';
  villageId: number | null;
  ownerId: number | null;
  age: number;
  hunger: number;
  breedIn: number;
  produceIn: number;
  attackIn: number;
  decisionIn: number;
  targetId: number | null;
  path: Vec2[];
  heading: number;
  stride: number;
  moving: boolean;
}
export interface Workplace { kind: WorkplaceKind; villageId: number | null }

export function economyOf(village: Village): VillageEconomy {
  return village.economy ??= { stocks: { grain: 0, flour: 0, bread: 0, wood: 0, tools: 0, stone: 0, stoneAxes: 0, gold: 0 }, deliveries: 0, buildAfter: village.founded + 900 };
}
export function governmentOf(village: Village): VillageGovernment {
  return village.government ??= { leaderId: null, trust: 60, electedAt: 0, electionAt: 0, lastHarvest: village.harvested, elections: 0 };
}
export function recordService(entity: Entity, amount: number): void {
  const c = entity.components.citizen;
  if (c) c.service = Math.min(1000, (c.service ?? 0) + amount);
  if (c?.integration && c.integration.villageId === c.villageId && c.task !== 'migrate' && amount > 0) {
    c.integration.worked = true;
    c.integration.belonging = Math.min(100, c.integration.belonging + amount * 5);
  }
}

const names = ['Alden', 'Bryn', 'Cora', 'Dara', 'Eden', 'Finn', 'Gale', 'Hollis', 'Ira', 'Jory', 'Kit', 'Linden', 'Mira', 'Neri', 'Orin', 'Perry', 'Quinn', 'Rowan', 'Sage', 'Tavi'];
/** Stable personal names survive elections, migration and reloads. */
export const residentName = (id: number, world?: import('./world').World): string => {
  const identity = world?.entities.get(id)?.components.unit ?? world?.unitHistory.find(m => m.id === id)?.identity;
  return identity?.customName ?? identity?.displayName ?? `${names[id % names.length]} ${Math.floor(id / names.length) + 1}`;
};
