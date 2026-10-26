import type { Entity, Vec2, Village } from './types';
import type { World } from './world';
import { availableStock, deposit, recordLoss } from './resource-ledger';
import { bundleSize, canConsume, entries, RESIDENT_DIET, RESOURCE_IDS, type ResourceBundle, type ResourceId } from './resources';
import { clearStorageApproach, consumeReservation, releaseReservation, reserveGoods, reservedAt, storageOwner, storesOf } from './stockpiles';
import { equipmentStorageRoom, relocateItem, replacementReason, type EquipmentItem } from './equipment';
import { foodReserve } from './seasons';
import { housingWoodReserve } from './forestry';
import { housingStoneReserve } from './deposits';
import { gemOrderDemand } from './gems';
import { economyOf } from './village-life';
import { isAdult } from './unit-stats';
import { operational } from './buildings';
import { zoneAt, zoneOwner } from './territory';
import { distance, harborBerth } from './seafaring';

export type SupplyGood = ResourceId | 'food' | 'equipment';
export const SUPPLY_REASONS = ['Supply reserved', 'Supply travelling', 'Supply returning', 'Supply delivered', 'Supply returned',
  'Supply route blocked', 'Supply border closed', 'Supply relations changed', 'Supply destination gone', 'Supply storage full',
  'Supply carrier lost', 'Supply own reserve', 'Supply cooling down', 'Supply already assigned', 'Supply no surplus'] as const;
export type SupplyReason = typeof SUPPLY_REASONS[number];
export interface SupplyEntry extends Vec2 {
  carrierId: number; fromId: number; toId: number; good: SupplyGood; amount: number;
  delivered: number; returned: number; lost: number; tick: number; started: number; reason: SupplyReason;
}
export interface Shipment {
  fromId: number; toId: number; sourceId: number; destinationId: number; good: SupplyGood;
  goods: ResourceBundle; itemIds: number[]; amount: number; delivered: number; returned: number; lost: number;
  started: number; phase: 'outbound' | 'returning' | 'complete'; reason: SupplyReason;
  journal: { tick: number; reason: SupplyReason }[];
}
declare module './types' { interface ComponentMap { shipment: Shipment } }
export interface SupplyPolicy { reserve: number; need: number; batch: number; priority: number; cooldown: number }
// Pocket Overlord balance. The old wiki technology multipliers are deliberately absent.
export function supplyPolicy(world: World, village: Village, good: SupplyGood): SupplyPolicy {
  const residents = [...world.query('citizen')].filter(e => e.components.citizen!.villageId === village.id).length;
  if (good === 'food') return { reserve: foodReserve(world.tick, residents), need: Math.max(residents * 3, foodReserve(world.tick, residents)), batch: 12, priority: 100, cooldown: 900 };
  if (good === 'equipment' || good === 'stoneAxes') return { reserve: 1, need: 1, batch: 1, priority: 40, cooldown: 1200 };
  if (good === 'gems') return { reserve: Math.max(1, gemOrderDemand(world, village.id)), need: gemOrderDemand(world, village.id), batch: 4, priority: 50, cooldown: 900 };
  if (good === 'wood') return { reserve: Math.max(20, housingWoodReserve(world, village)), need: 10, batch: 10, priority: 70, cooldown: 900 };
  if (good === 'stone') return { reserve: Math.max(20, housingStoneReserve(world, village)), need: 10, batch: 10, priority: 60, cooldown: 900 };
  if (good === 'grain' || good === 'flour') return { reserve: 24, need: 12, batch: 12, priority: 80, cooldown: 900 };
  return { reserve: 30, need: 10, batch: 10, priority: 45, cooldown: 1200 };
}
export const SUPPLY_GOODS: SupplyGood[] = ['food', ...RESOURCE_IDS.filter(id => !canConsume(id, RESIDENT_DIET) && id !== 'stoneAxes'), 'equipment'];
export function supplyFriendly(world: World, a: number, b: number, sea = false): boolean {
  if (a === b) return true;
  const r = world.society.relations.find(r => r.a === a && r.b === b || r.a === b && r.b === a);
  // Preserve existing neutral/allied land routes and non-hostile ports. Kingdoms own future membership rules.
  return r ? r.status !== 'war' : sea;
}
export function supplyBorderOpen(world: World, fromId: number, p: Vec2): boolean {
  const owner = zoneOwner(world, zoneAt(world, p));
  return !owner || supplyFriendly(world, fromId, owner.id, true);
}
export function supplySegmentOpen(world: World, fromId: number, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(1, Math.ceil(distance(a, b) * 2));
  for (let i = 0; i <= steps; i++) if (!supplyBorderOpen(world, fromId, { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps })) return false;
  return true;
}
const people = (world: World, id: number) => [...world.query('person', 'citizen')].filter(e => e.components.citizen!.villageId === id);
export const shipmentCarriers = (world: World): Entity[] => [...world.query('caravan'), ...world.query('ship')].filter(e => e.components.shipment);
export const shipmentSize = (s: Shipment): number => bundleSize(s.goods) + s.itemIds.length;
export function incomingSupply(world: World, villageId: number, good: SupplyGood): number {
  let amount = 0;
  for (const e of shipmentCarriers(world)) {
    const s = e.components.shipment!;
    const equipment = (g: SupplyGood) => g === 'equipment' || g === 'stoneAxes';
    if (s.phase === 'outbound' && s.toId === villageId && (s.good === good || equipment(s.good) && equipment(good))) amount += shipmentSize(s);
  }
  if (good === 'food' || good === 'gems') for (const e of world.query('caravan')) {
    const c = e.components.caravan!;
    if (!e.components.shipment && !c.returning && c.toId === villageId) amount += good === 'food' ? c.food : c.gems ?? 0;
  }
  if (good === 'food') for (const e of world.query('ship')) {
    const s = e.components.ship!;
    if (!e.components.shipment && s.phase === 'sailing' && s.targetOwnerId === villageId) amount += s.cargo;
  }
  return amount;
}
function freeFood(world: World, v: Village): number { return RESIDENT_DIET.reduce((n, id) => n + availableStock(world, v, id), 0); }
export function supplyNeed(world: World, v: Village, good: SupplyGood): number {
  if (!people(world, v.id).length) return 0;
  const held = good === 'food' ? freeFood(world, v) : good === 'equipment' || good === 'stoneAxes'
    ? world.equipment.items.filter(i => i.location.kind === 'stored' && storesOf(v).some(s => s.buildingId === (i.location.kind === 'stored' && i.location.buildingId))).length
    : availableStock(world, v, good);
  return Math.max(0, supplyPolicy(world, v, good).need - held - incomingSupply(world, v.id, good));
}
export function supplyChoices(world: World, from: Village, to: Village): SupplyGood[] {
  return SUPPLY_GOODS.filter(good => supplyNeed(world, to, good) > 0).sort((a, b) => supplyPolicy(world, from, b).priority - supplyPolicy(world, from, a).priority);
}
export function supplyBlock(world: World, from: Village, to: Village, good: SupplyGood, carrierId?: number): SupplyReason | undefined {
  if (world.tick < (from.economy?.supplyAfter ?? 0)) return 'Supply cooling down';
  if (shipmentCarriers(world).some(e => e.id !== carrierId && e.components.shipment!.fromId === from.id)
    || [...world.query('caravan')].some(e => e.id !== carrierId && !e.components.shipment && e.components.caravan!.fromId === from.id)
    || [...world.query('ship')].some(e => e.id !== carrierId && !e.components.shipment && e.components.ship!.kind === 'trade'
      && e.components.ship!.cargo > 0 && (e.components.ship!.cargoOwnerId ?? world.entities.get(e.components.ship!.homeId ?? -1)?.components.harbor?.villageId) === from.id)) return 'Supply already assigned';
  if (good !== 'food' && (freeFood(world, from) < foodReserve(world.tick, people(world, from.id).length)
    || to.food < people(world, to.id).length)) return 'Supply own reserve';
}
export interface SupplyLoad { goods: ResourceBundle; items: EquipmentItem[] }
export function supplyLoad(world: World, from: Village, to: Village, sourceId: number, good: SupplyGood, requested: number): SupplyLoad | undefined {
  if (!Number.isFinite(requested) || requested <= 0 || !people(world, from.id).some(isAdult)) return;
  const store = storesOf(from).find(s => s.buildingId === sourceId);
  if (!store || supplyNeed(world, to, good) < 1) return;
  const policy = supplyPolicy(world, from, good), reserved = reservedAt(store);
  if (good === 'equipment' || good === 'stoneAxes') {
    const stored = world.equipment.items.filter(i => i.location.kind === 'stored' && storesOf(from).some(s => s.buildingId === (i.location.kind === 'stored' && i.location.buildingId)));
    const item = stored.find(i => i.location.kind === 'stored' && i.location.buildingId === sourceId && i.claim === undefined && !i.favorite && !i.modifiers.cursed && i.durability > 0
      && (good !== 'stoneAxes' || i.definition === 'stone-axe') && stored.filter(other => other.definition === i.definition).length > policy.reserve
      && people(world, to.id).some(e => !replacementReason(world, e, i)));
    return item ? { goods: {}, items: [item] } : undefined;
  }
  const available = good === 'food' ? freeFood(world, from) : availableStock(world, from, good);
  let left = Math.floor(Math.min(requested, policy.batch, available - policy.reserve, supplyNeed(world, to, good)));
  if (left < 1) return;
  const goods: ResourceBundle = {};
  for (const id of good === 'food' ? RESIDENT_DIET : [good]) {
    const amount = Math.min(left, Math.floor(Math.max(0, (store.goods[id] ?? 0) - (reserved[id] ?? 0))));
    if (amount) { goods[id] = amount; left -= amount; }
  }
  return bundleSize(goods) ? { goods, items: [] } : undefined;
}
export function noteSupply(world: World, entity: Entity, reason: SupplyReason): void {
  const s = entity.components.shipment!;
  if (s.journal.at(-1)?.reason === reason) return;
  s.reason = reason; s.journal.push({ tick: world.tick, reason });
  if (s.journal.length > 16) s.journal.shift();
  const entry: SupplyEntry = { carrierId: entity.id, fromId: s.fromId, toId: s.toId, good: s.good, amount: s.amount,
    delivered: s.delivered, returned: s.returned, lost: s.lost, tick: world.tick, started: s.started, reason, ...entity.components.position! };
  for (const v of world.society.villages) if (v.id === s.fromId || v.id === s.toId) {
    const history = economyOf(v).supplyHistory ??= [];
    history.push({ ...entry }); if (history.length > 16) history.shift();
  }
}
/** Compatibility summaries only; the shipment owns all new cargo. */
export function syncShipment(entity: Entity): void {
  const s = entity.components.shipment!;
  const foodGoods = Object.fromEntries(entries(s.goods).filter(([id]) => canConsume(id, RESIDENT_DIET)));
  if (entity.components.caravan) Object.assign(entity.components.caravan, { food: bundleSize(foodGoods), foodGoods, gems: s.goods.gems ?? 0 });
  if (entity.components.ship) Object.assign(entity.components.ship, { cargo: bundleSize(foodGoods), foodGoods, cargoOwnerId: s.fromId });
}
/** Reserve and load are one synchronous handoff at a physical store. No other actor can claim the batch between them. */
export function loadShipment(world: World, entity: Entity, from: Village, to: Village, source: Entity, destination: Entity, good: SupplyGood, load: SupplyLoad): boolean {
  if (world.paused || entity.components.shipment || supplyBlock(world, from, to, good, entity.id) || !supplyFriendly(world, from.id, to.id, !!entity.components.ship)
    || storageOwner(source) !== from.id || storageOwner(destination) !== to.id || !shipmentApproach(world, entity, source)
    || !operational(source) || source.components.thermal?.burning || !operational(destination) || destination.components.thermal?.burning) return false;
  if (load.items.some(i => i.claim !== undefined || i.location.kind !== 'stored' || i.location.buildingId !== source.id)) return false;
  if (bundleSize(load.goods) && !reserveGoods(world, from, load.goods, entity.id, undefined, source.id)) return false;
  if (bundleSize(load.goods) && !consumeReservation(from, entity.id, load.goods, 'transfer')) { releaseReservation(from, entity.id); return false; }
  entity.components.shipment = { fromId: from.id, toId: to.id, sourceId: source.id, destinationId: destination.id, good,
    goods: { ...load.goods }, itemIds: load.items.map(i => i.id), amount: bundleSize(load.goods) + load.items.length,
    delivered: 0, returned: 0, lost: 0, started: world.tick, phase: 'outbound', reason: 'Supply reserved', journal: [] };
  for (const item of load.items) relocateItem(world, item, { kind: 'carried', entityId: entity.id, villageId: from.id }, 'loaded');
  syncShipment(entity); noteSupply(world, entity, 'Supply reserved'); noteSupply(world, entity, 'Supply travelling');
  return true;
}
export function shipmentApproach(world: World, entity: Entity, building: Entity): boolean {
  return !!entity.components.ship ? !!building.components.harbor && building.components.harbor.built === 1
    && distance(entity.components.position!, harborBerth(building)) <= 0.2 : clearStorageApproach(world, entity.components.position!, building);
}
export function shipmentStoreFits(world: World, building: Entity, load: SupplyLoad): boolean {
  return load.items.every(item => equipmentStorageRoom(world, building.id, item));
}
export function returnShipment(world: World, entity: Entity, reason: SupplyReason): void {
  const s = entity.components.shipment!;
  if (s.phase === 'complete') return;
  s.phase = 'returning'; noteSupply(world, entity, reason);
}
export function unloadShipment(world: World, entity: Entity, recipient: Village, building: Entity): number {
  const s = entity.components.shipment!;
  if (world.paused || s.phase === 'complete' || storageOwner(building) !== recipient.id || !operational(building) || building.components.thermal?.burning
    || !shipmentApproach(world, entity, building) || recipient.id !== (s.phase === 'returning' ? s.fromId : s.toId)
    || !supplyFriendly(world, s.fromId, recipient.id, !!entity.components.ship)) return 0;
  const receipt = deposit(recipient, s.goods, building.id);
  for (const [id, n] of entries(receipt)) s.goods[id] = Math.max(0, (s.goods[id] ?? 0) - n);
  let delivered = bundleSize(receipt);
  for (const id of [...s.itemIds]) {
    const item = world.equipment.items.find(i => i.id === id);
    if (!item || item.location.kind !== 'carried' || item.location.entityId !== entity.id || !equipmentStorageRoom(world, building.id, item)) continue;
    relocateItem(world, item, { kind: 'stored', buildingId: building.id }, 'delivered'); s.itemIds.splice(s.itemIds.indexOf(id), 1); delivered++;
  }
  if (s.phase === 'returning') s.returned += delivered; else s.delivered += delivered;
  syncShipment(entity);
  if (shipmentSize(s) <= 1e-8) {
    const reason = s.phase === 'returning' ? 'Supply returned' : 'Supply delivered';
    s.phase = 'complete';
    const from = world.society.villages.find(v => v.id === s.fromId);
    if (from) economyOf(from).supplyAfter = world.tick + supplyPolicy(world, from, s.good).cooldown;
    noteSupply(world, entity, reason);
  } else noteSupply(world, entity, 'Supply storage full');
  return delivered;
}
export function loseShipment(world: World, entity: Entity): void {
  const s = entity.components.shipment;
  if (!s || s.phase === 'complete') return;
  const from = world.society.villages.find(v => v.id === s.fromId);
  recordLoss(from, s.goods); s.lost += shipmentSize(s); s.goods = {}; s.itemIds = []; s.phase = 'complete';
  if (from) economyOf(from).supplyAfter = world.tick + supplyPolicy(world, from, s.good).cooldown;
  syncShipment(entity); noteSupply(world, entity, 'Supply carrier lost');
}
