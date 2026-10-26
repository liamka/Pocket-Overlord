import { isAdult } from './unit-stats';
import { EQUIPMENT, EQUIPMENT_SLOTS, MODIFIERS, MODIFIER_RULES, equipmentScore, type EquipmentSlot, type Modifiers } from './equipment-catalog';
import { equippedItem, itemScore, wornOutLeather } from './equipment';
import { canAfford } from './resource-ledger';
import { Random } from './random';
import { raceOf } from './races';
import { operational } from './buildings';
import { canWorkMetal, isCommonMetalMaterial, metalExperience } from './common-metals';
import { SILVER } from './silver';
import type { ResourceBundle } from './resources';
import type { Entity } from './types';
import type { World } from './world';

// Pocket Overlord balance, not a reproduction of the wiki's invalid modifier attempts.
export const CRAFTING = { work: 4, chance: 0.5, ordinaryTries: 1, dwarfTries: 3, masteryTries: 5, maxTries: 8, maxLevel: 5, history: 128 } as const;
/** Supplied by the future culture owner; no cultures or wallets are created here. */
export interface CraftingPolicy { preferredKinds?: readonly string[]; mastery?: boolean; specialRecipes?: readonly string[] }
export const CRAFT_REASONS = ['worker', 'materials', 'housing', 'money', 'access', 'knowledge', 'hunger', 'unsafe', 'recipient', 'replacement', 'storage', 'working', 'delivery', 'complete', 'cancelled'] as const;
export type CraftReason = typeof CRAFT_REASONS[number];
export interface CraftOrder {
  id: number; villageId: number; recipientId: number | null; homeId: number | null; slot: EquipmentSlot; recipe: string;
  workplaceId: number | null; workerId: number | null; inputs: ResourceBundle; coins: number | null;
  progress: number; paid: boolean; state: 'waiting' | 'working' | 'delivering' | 'completed' | 'cancelled'; reason: CraftReason;
  seed: number; tries: number; mastery: boolean; createdAt: number; resultId: number | null;
  reservedUntil?: number;
}
export interface CraftingState { nextOrderId: number; orders: CraftOrder[] }
export const newCrafting = (): CraftingState => ({ nextOrderId: 1, orders: [] });
export const activeOrder = (o: CraftOrder): boolean => o.state === 'waiting' || o.state === 'working' || o.state === 'delivering';
export const orderForWorker = (world: World, entity: Entity): CraftOrder | undefined => world.crafting.orders.find(o => o.id === entity.components.citizen?.work?.orderId);
export const modifierTries = (entity: Entity, mastery = false): number => Math.min(CRAFTING.maxTries,
  (raceOf(entity) === 'dwarf' ? CRAFTING.dwarfTries : CRAFTING.ordinaryTries) + (mastery ? CRAFTING.masteryTries : 0));
export function craftedModifiers(order: Pick<CraftOrder, 'recipe' | 'seed' | 'tries'>): Modifiers {
  const slot = EQUIPMENT[order.recipe].slot, random = new Random(order.seed), result: Modifiers = {};
  const pool = MODIFIERS.filter(m => MODIFIER_RULES[m].max === 5 && MODIFIER_RULES[m].slots.includes(slot));
  for (let i = 0; i < order.tries; i++) if (random.next() < CRAFTING.chance) {
    const id = pool[Math.floor(random.next() * pool.length)], level = 1 + Math.floor(random.next() * CRAFTING.maxLevel);
    result[id] = Math.max(result[id] ?? 0, level);
  }
  return result;
}
export function needsRecipe(world: World, recipient: Entity, recipe: string): boolean {
  const d = EQUIPMENT[recipe], old = equippedItem(world, recipient.id, d.slot);
  // Quality alone never triggers a new order for the same material tier.
  return !old || !old.modifiers.cursed && equipmentScore(recipe) > itemScore(old);
}
export function metalRecipeAllowed(world: World, villageId: number, recipe: string): boolean {
  const material = EQUIPMENT[recipe]?.material;
  const village = world.society.villages.find(v => v.id === villageId);
  if (material === 'silver') return !!village && metalExperience(village) >= SILVER.requires;
  return !isCommonMetalMaterial(material) || !!village && canWorkMetal(village, material);
}
export function selectRecipe(world: World, recipient: Entity, slot: EquipmentSlot, policy: CraftingPolicy = {}): string | undefined {
  const village = world.society.villages.find(v => v.id === recipient.components.citizen?.villageId);
  if (!village) return;
  const kinds = slot === 'weapon' ? [...new Set([...(policy.preferredKinds ?? []), 'axe', 'sword', 'hammer', 'spear', 'bow', 'stick'])] : [slot];
  for (const kind of kinds) {
    const candidates = Object.values(EQUIPMENT).filter(d => d.slot === slot && d.kind === kind
      && (d.recipe.available || policy.specialRecipes?.includes(d.id)) && metalRecipeAllowed(world, village.id, d.id) && needsRecipe(world, recipient, d.id))
      .sort((a, b) => equipmentScore(b.id) - equipmentScore(a.id) || b.value - a.value || a.id.localeCompare(b.id, 'en'));
    if (!candidates.length) continue;
    return (candidates.find(d => canAfford(world, village, d.recipe.inputs)) ?? candidates.at(-1))!.id;
  }
}
export function requestCraft(world: World, recipient: Entity, slot: EquipmentSlot, policy: CraftingPolicy = {}): CraftOrder | undefined {
  const c = recipient.components.citizen;
  if (world.paused || !c?.villageId || !recipient.components.person || !isAdult(recipient) || c.task === 'migrate') return;
  const home = world.entities.get(recipient.components.person.homeId ?? -1);
  if (recipient.components.thermal?.burning || recipient.components.person.madness || c.emergency
    || recipient.components.person.homeId !== null && (!home?.components.dwelling || !operational(home) || home.components.thermal?.burning)) return;
  const existing = world.crafting.orders.find(o => activeOrder(o) && o.recipientId === recipient.id && o.slot === slot);
  if (existing) return existing;
  const recipe = selectRecipe(world, recipient, slot, policy);
  if (!recipe) return;
  // A reusable item already in transit or storage is picked up before ordering another.
  const stores = world.society.villages.find(v => v.id === c.villageId)?.economy?.storage ?? [];
  if (world.equipment.items.some(i => {
    const l = i.location;
    return !wornOutLeather(i) && EQUIPMENT[i.definition].slot === slot && needsRecipe(world, recipient, i.definition)
      && (l.kind === 'carried' && l.villageId === c.villageId || l.kind === 'stored' && stores.some(s => s.buildingId === l.buildingId));
  })) return;
  const d = EQUIPMENT[recipe];
  const order: CraftOrder = { id: world.crafting.nextOrderId++, villageId: c.villageId, recipientId: recipient.id,
    homeId: recipient.components.person.homeId, slot, recipe, workplaceId: null, workerId: null, inputs: { ...d.recipe.inputs }, coins: d.recipe.coins,
    progress: 0, paid: false, state: 'waiting', reason: 'worker', seed: Math.floor(world.rng.next() * 0x100000000),
    tries: 1, mastery: !!policy.mastery, createdAt: world.tick, resultId: null };
  world.crafting.orders.push(order); return order;
}
export function requestVillageCrafts(world: World, villageId: number): void {
  for (const recipient of world.query('person', 'citizen')) if (recipient.components.citizen!.villageId === villageId)
    for (const slot of EQUIPMENT_SLOTS) requestCraft(world, recipient, slot);
}
