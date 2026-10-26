import { FOOD_RECIPES } from '../content/food-catalog';
import { operational } from './buildings';
import type { Entity, Village } from './types';
import type { World } from './world';
import { economyOf, type Cargo } from './village-life';
import { addBundle, bundleSize, canConsume, entries, RESIDENT_DIET, validBundle, type Diet, type ResourceBundle, type ResourceId } from './resources';
import { EQUIPMENT } from './equipment-catalog';
import { cleanReservations, reservedAt, storageRoom, storesOf, syncStocks } from './stockpiles';

export const RECIPES = {
  ...FOOD_RECIPES,
  flour: { station: 'mill', inputs: { grain: 2 }, work: 4, outputs: { flour: 2 } },
  bread: { station: 'bakery', inputs: { flour: 2 }, work: 4, outputs: { bread: 4 } },
  tools: { station: 'workshop', inputs: { wood: 3 }, work: 4, outputs: { tools: 2 } },
  stoneAxes: { station: 'workshop', inputs: EQUIPMENT['stone-axe'].recipe.inputs, work: EQUIPMENT['stone-axe'].recipe.work, outputs: { stoneAxes: 1 } },
} as const;
export type CraftedGood = keyof typeof RECIPES;
export const isCrafted = (good: string): good is CraftedGood => Object.hasOwn(RECIPES, good);
export const cargoContents = (cargo: Cargo): ResourceBundle => ({ [cargo.good]: cargo.amount, ...cargo.byproducts });
export function makeCargo(goods: ResourceBundle, villageId: number, primary?: ResourceId): Cargo | null {
  const positive = entries(goods).filter(([, amount]) => amount > 1e-8);
  const first = positive.find(([id]) => id === primary) ?? positive[0];
  if (!first) return null;
  const byproducts = Object.fromEntries(positive.filter(([id]) => id !== first[0]));
  return { good: first[0], amount: first[1], villageId, ...(Object.keys(byproducts).length ? { byproducts } : {}) };
}

/** Physical stores are authoritative. The legacy food/stock fields are synchronized
 * summaries; provisions is the untyped remainder during one-time conversion. */
export function stockOf(village: Village, good: ResourceId): number {
  if (village.economy?.storage) return storesOf(village).reduce((sum, s) => sum + (s.goods[good] ?? 0), 0);
  const stocks = economyOf(village).stocks;
  if (good !== 'provisions') return stocks[good] ?? 0;
  return Math.max(0, village.food - entries(stocks).reduce((sum, [id, n]) => sum + (canConsume(id, RESIDENT_DIET) ? n : 0), 0));
}
export function stockContents(village: Village): ResourceBundle {
  if (village.economy?.storage) {
    const goods: ResourceBundle = {}; for (const s of storesOf(village)) addBundle(goods, s.goods); return goods;
  }
  return { ...economyOf(village).stocks, provisions: stockOf(village, 'provisions') };
}
export function recordLoss(village: Village | undefined, goods: ResourceBundle): void {
  if (village) addBundle(economyOf(village).lost ??= {}, goods);
}
export function deposit(village: Village, goods: ResourceBundle, buildingId?: number): ResourceBundle {
  if (!validBundle(goods, 1e12) || goods.stoneAxes) throw new Error('Use individual item delivery for equipment');
  const delivered: ResourceBundle = {}, stocks = economyOf(village).stocks;
  if (village.economy?.storage) {
    for (const s of storesOf(village)) {
      if (buildingId !== undefined && s.buildingId !== buildingId) continue;
      for (const [id, requested] of entries(goods)) {
        let amount = Math.max(0, Math.min(requested - (delivered[id] ?? 0), storageRoom(s, id), 2000 - stockOf(village, id),
          canConsume(id, RESIDENT_DIET) ? 2000 - village.food : Infinity));
        if (id === 'gold') amount = Math.floor(amount + 1e-8);
        if (amount > 0) { s.goods[id] = (s.goods[id] ?? 0) + amount; delivered[id] = (delivered[id] ?? 0) + amount; syncStocks(village); }
      }
    }
    return delivered;
  }
  for (const [good, requested] of entries(goods)) {
    let amount = Math.max(0, Math.min(requested, 2000 - stockOf(village, good), canConsume(good, RESIDENT_DIET) ? 2000 - village.food : Infinity));
    if (good === 'gold') amount = Math.floor(amount + 1e-8);
    if (!amount) continue;
    if (good !== 'provisions') stocks[good] = (stocks[good] ?? 0) + amount;
    if (canConsume(good, RESIDENT_DIET)) village.food += amount;
    delivered[good] = amount;
  }
  return delivered;
}
export function withdraw(village: Village, goods: ResourceBundle, reason: 'transfer' | 'consume' = 'consume', buildingId?: number): boolean {
  if (!validBundle(goods, 1e12) || goods.stoneAxes) return false;
  if (village.economy?.storage) {
    const stores = storesOf(village).filter(s => buildingId === undefined || s.buildingId === buildingId);
    const free: ResourceBundle = {};
    for (const s of stores) { const reserved = reservedAt(s); for (const [id, n] of entries(s.goods)) free[id] = (free[id] ?? 0) + Math.max(0, n - (reserved[id] ?? 0)); }
    if (entries(goods).some(([id, n]) => (free[id] ?? 0) + 1e-8 < n)) return false;
    const left = { ...goods };
    for (const s of stores) {
      const reserved = reservedAt(s);
      for (const [id, n] of entries(left)) { const amount = Math.min(n, Math.max(0, (s.goods[id] ?? 0) - (reserved[id] ?? 0))); s.goods[id] = Math.max(0, (s.goods[id] ?? 0) - amount); left[id] = n - amount; }
    }
    syncStocks(village);
    if (reason === 'consume') addBundle(economyOf(village).spent ??= {}, goods);
    return true;
  }
  if (!entries(goods).every(([good, n]) => n >= 0 && Number.isFinite(n) && stockOf(village, good) + 1e-8 >= n)) return false;
  const stocks = economyOf(village).stocks;
  for (const [good, n] of entries(goods)) {
    if (good !== 'provisions') stocks[good] = Math.max(0, (stocks[good] ?? 0) - n);
    if (canConsume(good, RESIDENT_DIET)) village.food = Math.max(0, village.food - n);
  }
  if (reason === 'consume') addBundle(economyOf(village).spent ??= {}, goods);
  return true;
}
export function takeFood(village: Village, requested: number, reason: 'transfer' | 'consume' = 'consume', diet: Diet = RESIDENT_DIET, buildingId?: number): ResourceBundle {
  if (!Number.isFinite(requested) || requested < 0) return {};
  const goods: ResourceBundle = {};
  let left = requested;
  for (const good of [...new Set(['provisions', ...diet])] as ResourceId[]) {
    if (!canConsume(good, diet)) continue;
    const stores = storesOf(village).filter(s => buildingId === undefined || s.buildingId === buildingId);
    const reserved = stores.reduce((sum, s) => sum + (reservedAt(s)[good] ?? 0), 0);
    const stock = buildingId === undefined ? stockOf(village, good) : stores.reduce((sum, s) => sum + (s.goods[good] ?? 0), 0);
    const amount = Math.min(left, Math.max(0, stock - reserved));
    if (amount > 0) { goods[good] = amount; left -= amount; }
  }
  return withdraw(village, goods, reason, buildingId) ? goods : {};
}
export function addFood(village: Village, amount: number): number { return bundleSize(deposit(village, { provisions: amount })); }

/** Old scalar transport loads are untyped provisions; new departures retain their composition. */
export function packedFood(amount: number, goods?: ResourceBundle): ResourceBundle { return goods ?? { provisions: amount }; }
export function eatPackedFood(goods: ResourceBundle, amount: number, owner?: Village, diet: Diet = RESIDENT_DIET): number {
  const consumed: ResourceBundle = {};
  let left = amount;
  for (const [id, n] of entries(goods)) {
    if (!canConsume(id, diet)) continue;
    const eaten = Math.min(left, n); goods[id] = n - eaten; left -= eaten;
    if (eaten > 0) consumed[id] = eaten;
  }
  if (owner) addBundle(economyOf(owner).spent ??= {}, consumed);
  return amount - left;
}
export function deliverFood(village: Village, goods: ResourceBundle, buildingId?: number): number {
  const delivered = deposit(village, goods, buildingId);
  for (const [id, amount] of entries(delivered)) goods[id] = (goods[id] ?? 0) - amount;
  return bundleSize(delivered);
}

export function activeReservation(world: World, entity: Entity): ResourceBundle {
  const c = entity.components.citizen, r = c?.work?.reservation;
  if (!c || !r || c.task !== 'work' || c.work!.cargo || c.villageId !== r.villageId || !isCrafted(c.work!.good)) return {};
  const station = world.entities.get(c.targetId ?? -1);
  return !!station && operational(station) && station.components.workplace?.villageId === r.villageId && station.components.workplace.kind === RECIPES[c.work!.good].station
    && !station.components.thermal?.burning ? r.inputs : {};
}
export function reservedStock(world: World, village: Village, excludeId?: number): ResourceBundle {
  const result: ResourceBundle = {};
  if (village.economy?.storage) {
    cleanReservations(world, village);
    for (const s of storesOf(village)) addBundle(result, reservedAt(s, excludeId));
    return result;
  }
  for (const entity of world.query('citizen')) {
    const c = entity.components.citizen!;
    if (entity.id === excludeId || c.villageId !== village.id) continue;
    addBundle(result, activeReservation(world, entity));
  }
  return result;
}
export function availableStock(world: World, village: Village, good: ResourceId, excludeId?: number): number {
  return Math.max(0, stockOf(village, good) - (reservedStock(world, village, excludeId)[good] ?? 0));
}
export function canAfford(world: World, village: Village, goods: ResourceBundle, excludeId?: number): boolean {
  const reserved = reservedStock(world, village, excludeId);
  return entries(goods).every(([id, amount]) => stockOf(village, id) - (reserved[id] ?? 0) + 1e-8 >= amount);
}
export function inTransit(world: World, villageId: number): ResourceBundle {
  const result: ResourceBundle = {};
  for (const entity of world.query('citizen')) {
    const cargo = entity.components.citizen!.work?.cargo;
    if (cargo?.villageId === villageId) addBundle(result, cargoContents(cargo));
  }
  for (const entity of world.query('caravan')) {
    const load = entity.components.caravan!;
    if (entity.components.shipment) { if (entity.components.shipment.fromId === villageId) addBundle(result, entity.components.shipment.goods); continue; }
    if (load.fromId === villageId) addBundle(result, packedFood(load.food, load.foodGoods));
    if (load.fromId === villageId && load.gems) addBundle(result, { gems: load.gems });
  }
  for (const entity of world.query('ship')) {
    if (entity.components.shipment) { if (entity.components.shipment.fromId === villageId) addBundle(result, entity.components.shipment.goods); continue; }
    const load = entity.components.ship!, port = world.entities.get(load.homeId ?? -1);
    if ((load.cargoOwnerId ?? port?.components.harbor?.villageId) === villageId) addBundle(result, packedFood(load.cargo, load.foodGoods));
  }
  for (const group of world.society.migrations) if (group.fromId === villageId) addBundle(result, packedFood(group.food, group.foodGoods));
  return result;
}
