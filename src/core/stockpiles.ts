import { releaseEquipment } from './equipment';
import { buildingOwner, buildingProfile, hasCapability, operational } from './buildings';
import type { Entity, Vec2, Village } from './types';
import type { World } from './world';
import { economyOf } from './village-life';
import { addBundle, bundleLoad, canConsume, entries, RESIDENT_DIET, RESOURCES, validBundle, type ResourceBundle } from './resources';
import { findPath } from '../systems/navigation';
import { housingWoodReserve } from './forestry';

export type Resistance = 'ordinary' | 'fireproof' | 'acidproof';
export interface Storage {
  buildingId: number;
  capacity: number;
  equipmentVolume?: number;
  limits: ResourceBundle;
  goods: ResourceBundle;
  reservations: { claimant: number; goods: ResourceBundle }[];
}
// Pocket Overlord balance: 256 volume, 2000 of a single good, 100% loss on collapse.
// Protection prevents its named hazard only; ordinary damage and blasts still apply.
export const STORAGE_CAPACITY = 256;
export function storageOwner(entity: Entity): number | null { return buildingOwner(entity); }
export const storesOf = (village: Village): Storage[] => economyOf(village).storage ?? [];
export function storageFor(world: World, buildingId: number): Storage | undefined {
  const owner = world.society.villages.find(v => storesOf(v).some(s => s.buildingId === buildingId));
  return owner && storesOf(owner).find(s => s.buildingId === buildingId);
}
export function syncStocks(village: Village): void {
  const economy = economyOf(village);
  if (!economy.storage) return;
  for (const id of Object.keys(economy.stocks)) delete economy.stocks[id as keyof typeof economy.stocks];
  Object.assign(economy.stocks, { grain: 0, flour: 0, bread: 0, wood: 0, tools: 0, stone: 0, stoneAxes: 0, gold: 0 });
  village.food = 0;
  for (const store of economy.storage) for (const [id, n] of entries(store.goods)) {
    if (id !== 'provisions') economy.stocks[id] = (economy.stocks[id] ?? 0) + n;
    if (canConsume(id, RESIDENT_DIET)) village.food += n;
  }
}
export function attachStorage(village: Village, building: Entity, goods: ResourceBundle = {}, legacy = false): Storage {
  const stores = economyOf(village).storage ??= [];
  const existing = stores.find(s => s.buildingId === building.id);
  if (existing) return existing;
  const mill = building.components.workplace?.kind === 'mill';
  const store: Storage = { buildingId: building.id, capacity: legacy ? Math.max(STORAGE_CAPACITY, bundleLoad(goods).volume) : buildingProfile(building)?.effects.storage ?? STORAGE_CAPACITY,
    limits: mill && !legacy ? { grain: 48, flour: 48 } : {}, goods: { ...goods }, reservations: [] };
  stores.push(store); syncStocks(village); return store;
}
/** One-time conversion: aggregate food includes typed meals, never a second copy. */
export function initializeStorage(world: World, village: Village): void {
  const economy = economyOf(village);
  if (economy.storage) return;
  const food = entries(economy.stocks).reduce((n, [id, amount]) => n + (canConsume(id, RESIDENT_DIET) ? amount : 0), 0);
  if (food > village.food + 1e-8) throw new Error('Inconsistent legacy food');
  const goods: ResourceBundle = { ...economy.stocks, provisions: Math.max(0, village.food - food) };
  const owned = [...world.entities.values()].filter(e => storageOwner(e) === village.id && e.components.position && !e.components.ruin);
  const building = owned.find(e => e.components.workplace?.kind === 'market') ?? owned.find(e => e.components.dwelling) ?? world.spawn('core:stockpile', village);
  if (!building) return; // Entity limit: retain the legacy balance until a physical anchor is available.
  if (building.components.stockpile) building.components.stockpile.villageId = village.id;
  attachStorage(village, building, goods, true);
}
export function storageRoom(store: Storage, good: keyof ResourceBundle): number {
  const limit = Object.keys(store.limits).length ? store.limits[good] ?? 0 : 2000;
  return Math.max(0, Math.min(limit - (store.goods[good] ?? 0), (store.capacity - bundleLoad(store.goods).volume - (store.equipmentVolume ?? 0)) / RESOURCES[good].volume));
}
export function reservedAt(store: Storage, excludeId?: number): ResourceBundle {
  const result: ResourceBundle = {};
  for (const r of store.reservations) if (r.claimant !== excludeId) addBundle(result, r.goods);
  return result;
}
export function releaseReservation(village: Village, claimant: number): void {
  for (const s of storesOf(village)) s.reservations = s.reservations.filter(r => r.claimant !== claimant);
}
export function cleanReservations(world: World, village: Village): void {
  for (const s of storesOf(village)) s.reservations = s.reservations.filter(r => {
    const entity = world.entities.get(r.claimant), c = entity?.components.citizen;
    if (entity?.components.building?.project) return !entity.components.building.project.paid && buildingOwner(entity) === village.id;
    if (!c || c.villageId !== village.id) return false;
    const target = world.entities.get(c.targetId ?? -1);
    return !!target && storageOwner(target) === village.id && operational(target) && !target.components.thermal?.burning
      && c.task === 'work' && !!c.work?.reservation && !c.work.cargo;
  });
}
/** A short hand-off must cross dry, unobstructed ground, even at zero path length. */
export function clearStorageApproach(world: World, from: Vec2, building: Entity, radius = 2.1): boolean {
  const to = building.components.position;
  if (!to || Math.hypot(from.x - to.x, from.y - to.y) > radius) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(from.x - to.x, from.y - to.y) / 0.15));
  for (let i = 0; i <= steps; i++) {
    const p = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
    if (!world.terrain.isLand(p.x, p.y) || world.nearby(p, 1.4).some(e => e.id !== building.id && e.components.solid
      && Math.hypot(p.x - e.components.position!.x, p.y - e.components.position!.y) < e.components.solid.radius + 0.1)) return false;
  }
  return true;
}
export function storageRoute(world: World, from: Vec2, building: Entity): Vec2[] | undefined {
  if (clearStorageApproach(world, from, building)) return [];
  const direct = findPath(world, from, building.components.position!, 1.8);
  if (direct === undefined) return;
  if (clearStorageApproach(world, direct.at(-1) ?? from, building)) return direct;
  // findPath's radius alone can stop on the wrong bank. Try physical approach tiles.
  const center = building.components.position!;
  for (let n = 0; n < 16; n++) {
    const a = n * Math.PI / 8, p = { x: center.x + Math.cos(a) * 1.8, y: center.y + Math.sin(a) * 1.8 };
    if (!world.canStand(p, 0.25) || !clearStorageApproach(world, p, building)) continue;
    const path = findPath(world, from, p, 0.75);
    if (path !== undefined && clearStorageApproach(world, path.at(-1) ?? from, building)) return path;
  }
}
export function deliveryStore(world: World, village: Village, from: Vec2, goods: ResourceBundle, whole = false): { building: Entity; path: Vec2[] } | undefined {
  initializeStorage(world, village);
  for (const key of ['workplace', 'stockpile', 'harbor'] as const) for (const e of world.query(key)) {
    if (storageOwner(e) === village.id && operational(e) && (e.components.stockpile || ['market', 'mill'].includes(e.components.workplace?.kind ?? '') || e.components.harbor?.built === 1)) attachStorage(village, e);
  }
  for (const store of storesOf(village).slice().sort((a, b) => {
    const p = world.entities.get(a.buildingId)?.components.position, q = world.entities.get(b.buildingId)?.components.position;
    return (p ? Math.hypot(p.x - from.x, p.y - from.y) : Infinity) - (q ? Math.hypot(q.x - from.x, q.y - from.y) : Infinity);
  })) {
    const building = world.entities.get(store.buildingId);
    if (!building || storageOwner(building) !== village.id || !operational(building) && building.id !== village.economy?.storage?.[0]?.buildingId || building.components.thermal?.burning
      || !entries(goods).some(([id, n]) => n > 0 && storageRoom(store, id) > 1e-8)) continue;
    if (whole && (entries(goods).some(([id, n]) => storageRoom(store, id) < n || (village.economy!.stocks[id] ?? 0) + n > 2000)
      || bundleLoad(store.goods).volume + (store.equipmentVolume ?? 0) + bundleLoad(goods).volume > store.capacity
      || village.food + entries(goods).reduce((sum, [id, n]) => sum + (canConsume(id, RESIDENT_DIET) ? n : 0), 0) > 2000)) continue;
    const path = storageRoute(world, from, building);
    if (path !== undefined) return { building, path };
  }
}
export function reserveGoods(world: World, village: Village, goods: ResourceBundle, claimant: number, from?: Vec2, onlyStore?: number): boolean {
  if (goods.stoneAxes || !validBundle(goods, 2000, false) || entries(goods).some(([, n]) => n <= 0)) return false;
  initializeStorage(world, village); cleanReservations(world, village);
  if (goods.wood && !world.entities.get(claimant)?.components.building?.project) {
    const freeWood = storesOf(village).reduce((sum, s) => sum + Math.max(0, (s.goods.wood ?? 0) - (reservedAt(s, claimant).wood ?? 0)), 0);
    if (freeWood - goods.wood < housingWoodReserve(world, village)) return false;
  }
  const planned: { store: Storage; goods: ResourceBundle }[] = [], left = { ...goods };
  for (const store of storesOf(village)) {
    const building = world.entities.get(store.buildingId);
    if (!building || storageOwner(building) !== village.id || !operational(building) && building.id !== village.economy?.storage?.[0]?.buildingId || building.components.thermal?.burning || onlyStore !== undefined && onlyStore !== building.id
      || from && storageRoute(world, from, building) === undefined) continue;
    const reserved = reservedAt(store, claimant), batch: ResourceBundle = {};
    for (const [id, n] of entries(left)) {
      const amount = Math.min(n, Math.max(0, (store.goods[id] ?? 0) - (reserved[id] ?? 0)));
      if (amount > 0) { batch[id] = amount; left[id] = n - amount; }
    }
    if (Object.keys(batch).length) planned.push({ store, goods: batch });
  }
  if (entries(left).some(([, n]) => n > 1e-8)) return false;
  releaseReservation(village, claimant);
  for (const { store, goods: batch } of planned) store.reservations.push({ claimant, goods: batch });
  return true;
}
export function consumeReservation(village: Village, claimant: number, expected: ResourceBundle, reason: 'consume' | 'transfer' = 'consume'): boolean {
  if (expected.stoneAxes || !validBundle(expected, 2000, false) || entries(expected).some(([, n]) => n <= 0)) return false;
  const total: ResourceBundle = {};
  for (const s of storesOf(village)) for (const r of s.reservations) if (r.claimant === claimant) addBundle(total, r.goods);
  if (entries(expected).some(([id, n]) => Math.abs((total[id] ?? 0) - n) > 1e-8) || entries(total).some(([id, n]) => n > (expected[id] ?? 0) + 1e-8)) return false;
  for (const s of storesOf(village)) for (const r of s.reservations) if (r.claimant === claimant) {
    if (entries(r.goods).some(([id, n]) => (s.goods[id] ?? 0) + 1e-8 < n)) return false;
  }
  for (const s of storesOf(village)) for (const r of s.reservations) if (r.claimant === claimant)
    for (const [id, n] of entries(r.goods)) s.goods[id] = Math.max(0, (s.goods[id] ?? 0) - n);
  releaseReservation(village, claimant); syncStocks(village);
  if (reason === 'consume') addBundle(economyOf(village).spent ??= {}, expected);
  return true;
}
export function destroyStorage(world: World, buildingId: number): void {
  const entity = world.entities.get(buildingId);
  if (entity) releaseEquipment(world, entity);
  for (const village of world.society.villages) {
    const store = storesOf(village).find(s => s.buildingId === buildingId);
    if (!store) continue;
    const affected = new Set(store.reservations.map(r => r.claimant));
    addBundle(economyOf(village).lost ??= {}, store.goods);
    economyOf(village).storage = storesOf(village).filter(s => s !== store);
    for (const id of affected) {
      releaseReservation(village, id);
      const claimant = world.entities.get(id);
      if (claimant?.components.building?.project && !claimant.components.building.project.paid) claimant.components.building.state = 'planned';
      const c = claimant?.components.citizen;
      if (c && !c.work?.cargo) { delete c.work; Object.assign(c, { task: 'idle', targetId: null, path: [], reconsiderIn: 0 }); }
    }
    syncStocks(village);
    world.announce(`${village.name}: stockpile destroyed; its contents were lost`);
  }
}
export function maintainStorage(world: World): void {
  const anchors = [...world.entities.values()].filter(e => operational(e) && hasCapability(e, 'storage') && !e.components.dwelling && !e.components.ruin);
  for (const village of world.society.villages) {
    initializeStorage(world, village);
    for (const store of [...storesOf(village)]) {
      const building = world.entities.get(store.buildingId);
      if (!building || storageOwner(building) !== village.id) destroyStorage(world, store.buildingId);
    }
    for (const e of anchors) if (storageOwner(e) === village.id) attachStorage(village, e);
    cleanReservations(world, village);
  }
}
