import type { Entity, Vec2 } from './types';

export const REPRODUCTION_METHODS = ['sexual', 'hermaphroditic', 'parthenogenesis', 'budding', 'fission', 'divine', 'vegetative', 'spore', 'soulborne', 'metamorph'] as const;
export type ReproductionMethod = typeof REPRODUCTION_METHODS[number];
export type MaturationForm = 'viviparity' | 'oviparity' | 'direct';
export const REPRODUCTION_INTERVAL: Record<ReproductionMethod, number> = {
  sexual: 600, hermaphroditic: 600, parthenogenesis: 1200, budding: 1500, fission: 600,
  divine: 1800, vegetative: 900, spore: 1800, soulborne: 1200, metamorph: 1,
};
/** Input for the future physiology/editor owners, not a second trait catalogue. */
export interface ReproductionProfile {
  methods: ReproductionMethod[]; form: MaturationForm;
  baseMaturation: number; maturation: number; birthRate: number; offspringLimit: number;
  habitat: 'land' | 'water';
}
export const defaultReproduction = (mode?: string): ReproductionProfile => ({
  methods: mode === 'family' ? ['sexual'] : mode === 'herd' ? ['hermaphroditic'] : [],
  form: 'viviparity', baseMaturation: 0.6, maturation: 1, birthRate: 0, offspringLimit: 20, habitat: 'land',
});
export const REPRODUCTION_REASONS = ['Ready to reproduce', 'Births disabled by world law', 'Settlement population limit', 'Subspecies population limit', 'No reproduction method', 'Still growing', 'Already expecting offspring',
  'Recovering after reproduction', 'Needs at least 50 nutrition', 'Needs 90% health', 'No compatible partner', 'Partner is too far away',
  'No route to the partner', 'Busy or in danger', 'World population limit', 'Family is full', 'Offspring limit reached', 'No room at home',
  'No safe birthplace', 'Waiting for maturation', 'Waiting for a free birthplace', 'Divine birth already used', 'Too young for divine birth',
  'Divine birth requires no partner', 'Needs a recent meal', 'Needs a harvested soul', 'Parent is gone', 'Reproduction cancelled',
  'Offspring born', 'Egg laid', 'Egg hatched', 'Spore could not take root', 'Body changed'] as const;
export type ReproductionReason = typeof REPRODUCTION_REASONS[number];
export interface BirthSlot { sex: 'a' | 'b'; point?: Vec2 }
export interface PendingBirth {
  method: ReproductionMethod; form: MaturationForm; parents: number[]; startedAt: number; dueAt: number;
  typeId: string; subspeciesId: number; homeId: number | null; children: BirthSlot[];
  /** Older pregnancies can wait at a full global limit without overbooking it. */
  reserved: boolean; habitat: 'land' | 'water';
}
export interface Reproduction {
  sex?: 'a' | 'b'; cooldowns: Partial<Record<ReproductionMethod, number>>; born: number; divineUsed: boolean;
  pending?: PendingBirth;
  egg?: { parents: number[]; laidAt: number; hatchAt: number };
  cloneOf?: number;
  last?: { method: ReproductionMethod; at: number; reason: ReproductionReason };
}
declare module './types' { interface ComponentMap { reproduction: Reproduction } }
export function initializeReproduction(e: Entity, tick: number): void {
  if (e.components.reproduction || !e.components.person && !e.components.animal) return;
  const c = e.components;
  c.reproduction = { ...(c.animal ? { sex: e.id % 2 ? 'a' as const : 'b' as const } : {}), born: 0, divineUsed: false,
    cooldowns: { [c.person ? 'sexual' : 'hermaphroditic']: tick + Math.ceil((c.person?.reproduceIn ?? c.animal?.breedIn ?? 0) * 30) } };
}
export function birthReservations(entities: Iterable<Entity>, homeId?: number): { entities: number; people: number } {
  let count = 0, people = 0;
  for (const e of entities) {
    const p = e.components.reproduction?.pending;
    if (!p?.reserved || homeId !== undefined && p.homeId !== homeId) continue;
    count += p.children.length;
    if (e.components.person) people += p.children.length;
  }
  return { entities: count, people };
}

export const reproductionSex = (e: Entity): 'a' | 'b' => e.components.person?.sex ?? e.components.reproduction?.sex ?? 'a';
