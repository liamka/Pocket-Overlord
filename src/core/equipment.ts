import { canSpend, spendMoney } from './currency';
import { isAdult } from './unit-stats';
import { reconcileStats } from './unit-stats';
import { LEATHER } from './leather';
import { EQUIPMENT, EQUIPMENT_SLOTS, MODIFIERS, MODIFIER_RULES, equipmentScore, validModifiers, wornOutLeather, type EquipmentSlot, type HitStatus, type Modifiers, type ProjectileKind } from './equipment-catalog';
export { wornOutLeather } from './equipment-catalog';
import { RACES, raceOf } from './races';
import { hasCapability } from './capabilities';
import type { Registry } from '../content/registry';
import { clearStorageApproach, releaseReservation, storageFor, storageOwner, storageRoom, storageRoute, storesOf, syncStocks } from './stockpiles';
import { operational } from './buildings';
import { findPath } from '../systems/navigation';
import { bundleLoad } from './resources';
import { cargoContents, makeCargo } from './resource-ledger';
import type { Entity, Vec2, Village } from './types';
import type { World } from './world';

export type ItemLocation = { kind: 'equipped'; entityId: number } | { kind: 'carried'; entityId: number; villageId: number }
  | { kind: 'stored'; buildingId: number } | ({ kind: 'ground' } & Vec2);
export type ItemReason = 'created' | 'loaded' | 'legacy' | 'equipped' | 'delivered' | 'replaced' | 'gift' | 'death' | 'collapse' | 'reforged' | 'transmuted' | 'transformed';
export interface EquipmentItem {
  id: number; definition: string; modifiers: Modifiers; durability: number; maxDurability: number;
  author: { id: number | null; name: string }; createdAt: number; name: string; favorite: boolean; playerMarked: boolean;
  location: ItemLocation; claim?: number;
  origin?: { kind: 'crafted'; orderId: number; villageId: number; workplaceId: number; recipientId: number | null };
  history: { tick: number; reason: ItemReason; location: ItemLocation }[];
}
export interface EquipmentShot extends Vec2 {
  id: number; sourceId: number; targetId: number; villageId: number | null; kind: ProjectileKind;
  destination: Vec2; damage: number; statuses: HitStatus[]; remaining: number; hostile: boolean;
  /** Shared receipt for one volley. Absent on legacy projectiles, which grant no hit XP. */
  experience?: { attackId: number; awarded: boolean };
  /** Hunting never damages the breeding reserve, even after the hunter changes jobs. */
  hunting?: true;
}
export interface EquipmentState { nextItemId: number; nextShotId: number; items: EquipmentItem[]; shots: EquipmentShot[] }
export interface CombatState { baseHealth: number; immunities: HitStatus[]; statuses: Partial<Record<HitStatus, number>> }
export const newEquipment = (): EquipmentState => ({ nextItemId: 1, nextShotId: 1, items: [], shots: [] });
export const canUseEquipment = (entity: Entity, registry?: Registry): boolean => !!entity.components.citizen && !!entity.components.person && isAdult(entity)
  && (!registry || hasCapability(registry, entity, 'tools'));
interface EquipmentIndex {
  items: EquipmentItem[];
  length: number;
  owners: Map<string, EquipmentItem[]>;
  slots: Map<number, Map<EquipmentSlot, EquipmentItem>>;
  order: Map<EquipmentItem, number>;
}
const equipmentIndexes = new WeakMap<EquipmentState, EquipmentIndex>();
const ownerKey = (location: ItemLocation): string | undefined => location.kind === 'ground' ? undefined
  : location.kind === 'stored' ? `stored:${location.buildingId}` : `${location.kind}:${location.entityId}`;
function indexItem(index: EquipmentIndex, item: EquipmentItem, remove = false): void {
  const location = item.location, key = ownerKey(location);
  if (key === undefined) return;
  const items = index.owners.get(key) ?? [];
  if (remove) {
    const at = items.indexOf(item); if (at !== -1) items.splice(at, 1);
    if (!items.length) index.owners.delete(key);
  } else {
    const at = items.findIndex(other => index.order.get(other)! > index.order.get(item)!);
    items.splice(at === -1 ? items.length : at, 0, item); index.owners.set(key, items);
  }
  if (location.kind === 'equipped') {
    const slots = index.slots.get(location.entityId) ?? new Map<EquipmentSlot, EquipmentItem>();
    const slot = EQUIPMENT[item.definition].slot;
    if (remove) { slots.delete(slot); if (!slots.size) index.slots.delete(location.entityId); }
    else { slots.set(slot, item); index.slots.set(location.entityId, slots); }
  }
}
function equipmentIndex(world: World): EquipmentIndex {
  const state = world.equipment;
  let index = equipmentIndexes.get(state);
  if (!index || index.items !== state.items || index.length !== state.items.length) {
    index = { items: state.items, length: state.items.length, owners: new Map(), slots: new Map(), order: new Map() };
    state.items.forEach((item, order) => { index!.order.set(item, order); indexItem(index!, item); });
    equipmentIndexes.set(state, index);
  }
  return index;
}
export const equippedItems = (world: World, entityId: number): EquipmentItem[] => equipmentIndex(world).owners.get(`equipped:${entityId}`)?.slice() ?? [];
export const carriedItems = (world: World, entityId: number): EquipmentItem[] => equipmentIndex(world).owners.get(`carried:${entityId}`)?.slice() ?? [];
export const equippedItem = (world: World, entityId: number, slot: EquipmentSlot): EquipmentItem | undefined => equipmentIndex(world).slots.get(entityId)?.get(slot);
export const itemValue = (item: EquipmentItem): number => EQUIPMENT[item.definition].value + Object.values(item.modifiers).reduce((sum, n) => sum + n * 2, 0);
export const itemScore = (item: EquipmentItem): number => wornOutLeather(item) ? 0 : equipmentScore(item.definition, item.modifiers);
export function equipmentBonuses(world: World, entity: Entity) {
  const result = { damage: 0, armor: 0, speed: 0, critical: 0, attackSpeed: 0, health: 0, intelligence: 0, warfare: 0, sharpness: 0, diplomacy: 0, strength: 0 };
  // Add flat bonuses once, then callers apply their base and final caps. No base stat is incremented on equip.
  for (const item of equippedItems(world, entity.id)) {
    if (wornOutLeather(item)) continue;
    const d = EQUIPMENT[item.definition], m = item.modifiers;
    result.damage += d.damage; result.armor += d.armor + (m.protection ?? 0) * 2;
    result.speed += (d.speed ?? 0) + (m.speed ?? 0) * 0.05; result.critical += (d.critical ?? 0) + (m.critical ?? 0) * 0.02;
    result.attackSpeed += (m.attackSpeed ?? 0) * 0.04; result.health += (m.health ?? 0) * 5;
    for (const key of ['intelligence', 'warfare', 'sharpness', 'diplomacy', 'strength'] as const) result[key] += m[key] ?? 0;
  }
  result.damage += result.strength + result.sharpness;
  return result;
}
/** Called after a real combat hit with the pre-hit equipment, including a fatal hit.
 * Worn items retain identity/history; neither wear nor replacement returns raw leather. */
export function wearLeather(world: World, entityId: number, items: readonly EquipmentItem[]): void {
  if (world.paused) return;
  let broken = false;
  for (const item of items) if (EQUIPMENT[item.definition].material === 'leather' && item.durability > 0 && !item.modifiers.eternal) {
    item.durability = Math.max(0, item.durability - LEATHER.wearPerHit);
    broken ||= item.durability === 0;
  }
  if (broken) refreshWearer(world, entityId);
}
function refreshWearer(world: World, id: number): void {
  const e = world.entities.get(id), h = e?.components.health, c = e?.components.citizen;
  if (!e || !h || !c) return;
  const combat = e.components.combat ??= { baseHealth: e.components.stats?.base.health ?? h.max, immunities: [], statuses: {} };
  if (e.components.stats) reconcileStats(world, e);
  else { h.max = combat.baseHealth + equipmentBonuses(world, e).health; h.current = Math.min(h.current, h.max); }
  // Compatibility display only. Item ownership and combat always read the item ledger.
  if (equippedItem(world, id, 'weapon')?.definition === 'stone-axe') c.weapon = 'stone-axe'; else delete c.weapon;
}
export function itemPosition(world: World, item: EquipmentItem): Vec2 | undefined {
  const l = item.location;
  return l.kind === 'ground' ? l : world.entities.get(l.kind === 'stored' ? l.buildingId : l.entityId)?.components.position;
}
function clearItemApproach(world: World, from: Vec2, to: Vec2): boolean {
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  if (distance > 2.1) return false;
  const steps = Math.max(1, Math.ceil(distance / 0.15));
  for (let i = 0; i <= steps; i++) {
    const p = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
    if (!world.terrain.isLand(p.x, p.y) || world.nearby(p, 1.4).some(e => e.components.solid
      && Math.hypot(e.components.position!.x - p.x, e.components.position!.y - p.y) < e.components.solid.radius + 0.1)) return false;
  }
  return true;
}
function syncStorageItems(world: World): void {
  for (const v of world.society.villages) {
    for (const s of storesOf(v)) {
      const items = equipmentIndex(world).owners.get(`stored:${s.buildingId}`) ?? [];
      s.goods.stoneAxes = items.filter(i => i.definition === 'stone-axe').length;
      s.equipmentVolume = items.length - s.goods.stoneAxes;
    }
    syncStocks(v);
  }
}
function syncCarriedItems(world: World, entityId: number): void {
  const c = world.entities.get(entityId)?.components.citizen;
  if (!c) return;
  const items = carriedItems(world, entityId), first = items[0];
  const villageId = first?.location.kind === 'carried' ? first.location.villageId : c.work?.cargo?.villageId;
  if (villageId === undefined) return;
  const work = c.work ??= { good: 'stoneAxes', progress: 0, cargo: null };
  const goods = work.cargo ? cargoContents(work.cargo) : {};
  goods.stoneAxes = items.filter(i => i.definition === 'stone-axe').length;
  work.cargo = makeCargo(goods, villageId, work.cargo?.good);
}
export function relocateItem(world: World, item: EquipmentItem, location: ItemLocation, reason: ItemReason): void {
  const old = item.location, index = equipmentIndex(world);
  indexItem(index, item, true);
  item.location = { ...location }; delete item.claim;
  indexItem(index, item);
  item.history.push({ tick: world.tick, reason, location: { ...location } });
  if (item.history.length > 128) item.history.shift();
  if (old.kind === 'stored' || location.kind === 'stored') syncStorageItems(world);
  if (old.kind === 'carried') syncCarriedItems(world, old.entityId);
  if (location.kind === 'carried') syncCarriedItems(world, location.entityId);
  if (old.kind === 'equipped') refreshWearer(world, old.entityId);
  if (location.kind === 'equipped') refreshWearer(world, location.entityId);
}
/** Used only by paid production, migration and explicit content spawns. No recipe is unlocked here. */
export function createItem(world: World, definition: string, location: ItemLocation, author: EquipmentItem['author'] = { id: null, name: '' }, modifiers: Modifiers = {}): EquipmentItem {
  const d = EQUIPMENT[definition];
  if (!d || !validModifiers(modifiers, d.slot)) throw new Error('Invalid equipment definition');
  if (location.kind === 'equipped') {
    const entity = world.entities.get(location.entityId);
    if (!entity || !canUseEquipment(entity, world.registry) || equippedItem(world, entity.id, d.slot)) throw new Error('Equipment slot unavailable');
  }
  const item: EquipmentItem = { id: world.equipment.nextItemId++, definition, modifiers: { ...modifiers }, durability: d.durability,
    maxDurability: d.durability, author: { ...author }, createdAt: world.tick, name: '', favorite: false, playerMarked: !!modifiers.player,
    location: { ...location }, history: [{ tick: world.tick, reason: 'created', location: { ...location } }] };
  const index = equipmentIndex(world);
  world.equipment.items.push(item); index.length++;
  index.order.set(item, index.length - 1); indexItem(index, item);
  if (location.kind === 'stored') syncStorageItems(world);
  if (location.kind === 'carried') syncCarriedItems(world, location.entityId);
  if (location.kind === 'equipped') refreshWearer(world, location.entityId);
  return item;
}
export function replacementReason(world: World, entity: Entity, item: EquipmentItem): string | undefined {
  if (!canUseEquipment(entity, world.registry)) return 'Only adults who can use equipment may wear this';
  if (wornOutLeather(item)) return 'Worn leather gives no protection';
  const old = equippedItem(world, entity.id, EQUIPMENT[item.definition].slot);
  if (old?.id === item.id) return 'Already equipped';
  if (old?.modifiers.cursed) return 'A cursed item cannot be replaced';
  if (old && itemScore(old) >= itemScore(item)) return 'The current item is at least as effective';
}
export function equipmentStorageRoom(world: World, buildingId: number, item: EquipmentItem): boolean {
  const store = storageFor(world, buildingId);
  return !!store && (item.definition === 'stone-axe' ? storageRoom(store, 'stoneAxes') >= 1
    : !Object.keys(store.limits).length && bundleLoad(store.goods).volume + (store.equipmentVolume ?? 0) < store.capacity);
}
function leaveItem(world: World, item: EquipmentItem, entity: Entity, reason: ItemReason, preferredStore?: number): void {
  const p = entity.components.position!;
  const village = world.society.villages.find(v => v.id === entity.components.citizen?.villageId);
  const building = village && storesOf(village).map(s => world.entities.get(s.buildingId)).find(e => e && (preferredStore === undefined || e.id === preferredStore)
    && operational(e) && !e.components.thermal?.burning && clearStorageApproach(world, p, e) && equipmentStorageRoom(world, e.id, item));
  // Full or distant storage always leaves physical loot; even ordinary items are never silently deleted.
  relocateItem(world, item, building ? { kind: 'stored', buildingId: building.id } : { kind: 'ground', ...p }, reason);
}
export function equipItem(world: World, entity: Entity, item: EquipmentItem, reason: ItemReason = 'equipped'): boolean {
  if (world.paused || replacementReason(world, entity, item)) return false;
  const p = itemPosition(world, item), from = entity.components.position;
  if (!p || !from || Math.hypot(p.x - from.x, p.y - from.y) > 2.1) return false;
  const l = item.location;
  if (l.kind === 'carried' || l.kind === 'equipped') {
    if (l.entityId !== entity.id && (reason !== 'gift' && reason !== 'death' || !clearItemApproach(world, from, p))) return false;
  }
  if (l.kind === 'stored') {
    const building = world.entities.get(l.buildingId);
    if (!building || storageOwner(building) !== entity.components.citizen?.villageId || !operational(building)
      || building.components.thermal?.burning || !clearStorageApproach(world, from, building)) return false;
  } else if (l.kind === 'ground' && !clearItemApproach(world, from, p)) return false;
  if (item.claim !== undefined && item.claim !== entity.id) return false;
  const old = equippedItem(world, entity.id, EQUIPMENT[item.definition].slot);
  relocateItem(world, item, { kind: 'equipped', entityId: entity.id }, reason);
  if (old) leaveItem(world, old, entity, 'replaced', l.kind === 'stored' ? l.buildingId : undefined);
  refreshWearer(world, entity.id);
  return true;
}
export function removeEquippedItem(world: World, entity: Entity, slot: EquipmentSlot): boolean {
  const item = equippedItem(world, entity.id, slot);
  if (!item || item.modifiers.cursed) return false;
  leaveItem(world, item, entity, 'replaced'); return true;
}
export function releaseItemClaims(world: World, id: number): void { for (const i of world.equipment.items) if (i.claim === id) delete i.claim; }
export function assignItem(world: World, entity: Entity): boolean {
  const c = entity.components.citizen;
  if (!c || !canUseEquipment(entity, world.registry) || c.work?.cargo || carriedItems(world, entity.id).length || c.hunger >= 55 || world.paused) return false;
  for (const item of world.equipment.items.slice().sort((a, b) => itemScore(b) - itemScore(a) || a.id - b.id)) {
    if (item.claim !== undefined || replacementReason(world, entity, item)) continue;
    const l = item.location, p = itemPosition(world, item);
    if (!p || l.kind !== 'stored' && l.kind !== 'ground') continue;
    const building = l.kind === 'stored' ? world.entities.get(l.buildingId) : undefined;
    if (building && (storageOwner(building) !== c.villageId || !operational(building) || building.components.thermal?.burning)) continue;
    if (l.kind === 'ground' && Math.hypot(p.x - entity.components.position!.x, p.y - entity.components.position!.y) > 12) continue;
    const path = building ? storageRoute(world, entity.components.position!, building) : findPath(world, entity.components.position!, p, 0.5);
    if (path === undefined) continue;
    releaseItemClaims(world, entity.id); item.claim = entity.id;
    for (const v of world.society.villages) releaseReservation(v, entity.id);
    Object.assign(c, { task: 'equip', targetId: building?.id ?? null, path, repair: null, reconsiderIn: 2 });
    return true;
  }
  return false;
}
export function continueItemPickup(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!;
  if (world.paused || c.task !== 'equip') return false;
  const item = world.equipment.items.find(i => i.claim === entity.id), p = item && itemPosition(world, item);
  const stop = (): false => { releaseItemClaims(world, entity.id); c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0; return false; };
  if (!item || !p || c.hunger >= 70 || replacementReason(world, entity, item)) return stop();
  if (!c.path.length && equipItem(world, entity, item)) return stop();
  if (c.reconsiderIn <= 0 || !c.path.length) {
    const l = item.location, building = l.kind === 'stored' ? world.entities.get(l.buildingId) : undefined;
    if (l.kind !== 'stored' && l.kind !== 'ground' || building && (storageOwner(building) !== c.villageId || !operational(building) || building.components.thermal?.burning)) return stop();
    const path = building ? storageRoute(world, entity.components.position!, building) : findPath(world, entity.components.position!, p, 0.5);
    if (path === undefined || !path.length) return stop();
    c.path = path; c.reconsiderIn = 2;
  }
  return true;
}
export function equipmentDelivery(world: World, entity: Entity): { village: Village; building: Entity; path: Vec2[] } | undefined {
  const item = carriedItems(world, entity.id)[0];
  if (!item || item.location.kind !== 'carried') return;
  const villageId = item.location.villageId;
  const village = world.society.villages.find(v => v.id === villageId);
  if (!village) return;
  for (const store of storesOf(village)) {
    const building = world.entities.get(store.buildingId);
    if (!building || storageOwner(building) !== village.id || !operational(building) || building.components.thermal?.burning || !equipmentStorageRoom(world, building.id, item)) continue;
    const path = storageRoute(world, entity.components.position!, building);
    if (path !== undefined) return { village, building, path };
  }
}
export function deliverItems(world: World, entity: Entity, village: Village, buildingId: number): EquipmentItem[] {
  const building = world.entities.get(buildingId);
  if (!building || storageOwner(building) !== village.id || !operational(building) || !clearStorageApproach(world, entity.components.position!, building)) return [];
  const delivered: EquipmentItem[] = [];
  for (const item of world.equipment.items) if (item.location.kind === 'carried' && item.location.entityId === entity.id && item.location.villageId === village.id && equipmentStorageRoom(world, buildingId, item)) {
    relocateItem(world, item, { kind: 'stored', buildingId }, 'delivered'); delivered.push(item);
  }
  return delivered;
}
export function releaseEquipment(world: World, entity: Entity, killerId?: number, retained: readonly EquipmentItem[] = []): void {
  releaseItemClaims(world, entity.id);
  const killer = world.entities.get(killerId ?? -1);
  for (const item of world.equipment.items) {
    if (retained.includes(item)) continue;
    const l = item.location;
    if (l.kind === 'stored' && l.buildingId === entity.id) relocateItem(world, item, { kind: 'ground', ...entity.components.position! }, 'collapse');
    else if ((l.kind === 'equipped' || l.kind === 'carried') && l.entityId === entity.id) {
      if (!killer || !equipItem(world, killer, item, 'death')) leaveItem(world, item, entity, 'death');
    }
  }
  // Carried axes have become individual loot, not a second resource-pile drop.
  const cargo = entity.components.citizen?.work?.cargo;
  if (cargo?.good === 'stoneAxes') entity.components.citizen!.work!.cargo = null;
  else if (cargo?.byproducts) delete cargo.byproducts.stoneAxes;
}
export interface GiftContact { completed: boolean; rule: 'elders' | 'youth' | null; relation: 'family' | 'friend' | 'stranger' }
/** Repair uses the same personal price table as crafting. Existing wear is unchanged. */
export function repairEquipment(world: World, owner: Entity): boolean {
  const c = owner.components.citizen, p = owner.components.position;
  if (world.paused || !c || !p || !isAdult(owner) || c.hunger >= 70 || c.emergency || owner.components.thermal?.burning) return false;
  const station = [...world.query('workplace')].find(e => e.components.workplace!.kind === 'workshop'
    && e.components.workplace!.villageId === c.villageId && operational(e) && !e.components.thermal?.burning && clearStorageApproach(world, p, e));
  if (!station) return false;
  const item = equippedItems(world, owner.id).find(i => i.durability < i.maxDurability);
  if (!item) return false;
  const price = EQUIPMENT[item.definition].recipe.coins;
  if (price === null || !canSpend(world, owner, Math.ceil(price / 2)) || !spendMoney(world, owner, Math.ceil(price / 2), 'repair')) return false;
  item.durability = item.maxDurability; reconcileStats(world, owner); return true;
}
/** Culture supplies this policy when implemented. No default cultural rule is invented. */
export function giftEquipment(world: World, giver: Entity, receiver: Entity, item: EquipmentItem, contact: GiftContact): boolean {
  if (world.paused || !contact.completed || !contact.rule || giver.id === receiver.id || !canUseEquipment(giver, world.registry) || !canUseEquipment(receiver, world.registry)
    || item.location.kind !== 'equipped' || item.location.entityId !== giver.id || item.modifiers.cursed || item.favorite
    || Math.hypot(giver.components.position!.x - receiver.components.position!.x, giver.components.position!.y - receiver.components.position!.y) > 2.1
    || (contact.rule === 'elders' ? giver.components.person!.age >= receiver.components.person!.age : giver.components.person!.age <= receiver.components.person!.age)
    || replacementReason(world, receiver, item)) return false;
  if (world.rng.next() >= Math.min(0.8, (contact.relation === 'stranger' ? 0.2 : 0.5) + equipmentBonuses(world, giver).diplomacy * 0.02) || world.rng.next() >= 0.5) return false;
  return equipItem(world, receiver, item, 'gift');
}
/** Money is deliberately a separate operation and never spends the gold resource. */
export function transferMoney(giver: { money: number }, receiver: { money: number }, amount: number): boolean {
  if (giver === receiver || !Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(giver.money) || !Number.isSafeInteger(receiver.money)
    || giver.money < amount || receiver.money < 0 || !Number.isSafeInteger(receiver.money + amount)) return false;
  giver.money -= amount; receiver.money += amount; return true;
}
export function editItem(world: World, id: number, action: 'favorite' | 'reforge' | 'transmute', definition?: string): boolean {
  const item = world.equipment.items.find(i => i.id === id);
  if (!item) return false;
  if (action === 'favorite') { item.favorite = !item.favorite; return true; }
  const oldSlot = EQUIPMENT[item.definition].slot;
  if (action === 'transmute') {
    const next = definition && EQUIPMENT[definition];
    if (!next || next.slot !== oldSlot) return false;
    item.definition = next.id;
  } else {
    const pool = MODIFIERS.filter(m => MODIFIER_RULES[m].max === 5 && MODIFIER_RULES[m].slots.includes(oldSlot));
    const selected = pool[Math.floor(world.rng.next() * pool.length)];
    const retained: Modifiers = Object.fromEntries(Object.entries(item.modifiers).filter(([m]) => ['eternal', 'cursed'].includes(m)));
    item.modifiers = { ...retained, [selected]: 1 + Math.floor(world.rng.next() * 5) };
  }
  item.playerMarked = true; item.modifiers.player = 1;
  relocateItem(world, item, item.location, action === 'reforge' ? 'reforged' : 'transmuted');
  return true;
}
export function maintainEquipment(world: World): void {
  for (const item of world.equipment.items) {
    const c = item.claim === undefined ? undefined : world.entities.get(item.claim)?.components.citizen;
    const building = item.location.kind === 'stored' ? world.entities.get(item.location.buildingId) : undefined;
    if (item.claim !== undefined && (!c || c.task !== 'equip' || item.location.kind === 'stored' && (c.targetId !== item.location.buildingId || !building || storageOwner(building) !== c.villageId))) delete item.claim;
  }
}
export const equipmentBaseDamage = (entity: Entity): number => entity.components.person ? RACES[raceOf(entity)].damage : entity.components.animal?.kind === 'dog' ? 9 : 5;
export { EQUIPMENT_SLOTS };
