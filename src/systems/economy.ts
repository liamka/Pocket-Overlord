import type { World } from '../core/world';
import { isRoadSurface, type Entity, type Village } from '../core/types';
import { economyOf, recordService, type Good, type WorkplaceKind } from '../core/village-life';
import { findPath } from './navigation';
import { villageOf } from './society';

const distance = (a: Entity, b: Entity): number => Math.hypot(a.components.position!.x - b.components.position!.x, a.components.position!.y - b.components.position!.y);
export function marketOf(world: World, villageId: number): Entity | undefined {
  return [...world.query('workplace', 'position')].find(e => e.components.workplace!.kind === 'market' && e.components.workplace!.villageId === villageId && !e.components.thermal?.burning);
}

export function economy(world: World): void {
  for (const workplace of [...world.query('workplace')]) if (!villageOf(world, workplace.components.workplace!.villageId)) world.remove(workplace.id);
  if (world.tick % 150 !== 0) return;
  for (const village of world.society.villages) {
    const e = economyOf(village);
    e.stocks.bread = Math.min(e.stocks.bread, village.food);
    if (world.tick < e.buildAfter) continue;
    const adults = [...world.query('person', 'citizen', 'position')].filter(p => p.components.person!.age >= 18
      && p.components.citizen!.villageId === village.id && p.components.citizen!.task !== 'migrate' && !p.components.thermal?.burning);
    if (adults.length < 3) continue;
    e.buildAfter = world.tick + 450;
    const existing = [...world.query('workplace')].filter(p => p.components.workplace!.villageId === village.id);
    const kind = (['market', 'mill', 'bakery', 'workshop'] as const).find(kind => !existing.some(p => p.components.workplace!.kind === kind));
    if (!kind || kind !== 'market' && !marketOf(world, village.id)) continue;
    const worker = adults[0];
    for (let i = 0; i < 24; i++) {
      const angle = world.rng.range(0, Math.PI * 2), radius = world.rng.range(4, 11);
      const p = { x: village.x + Math.cos(angle) * radius, y: village.y + Math.sin(angle) * radius };
      if (!world.safeLand(p, 1.5) || isRoadSurface(world.terrain.at(p.x, p.y)) || !world.canStand(p, 1.2)
        || world.nearby(p, 3).some(e => e.components.farm || e.components.workplace || e.components.thermal?.burning || e.components.explosive)) continue;
      if (findPath(world, worker.components.position!, p, 1.8) === undefined) continue;
      const building = world.spawn(`core:${kind}`, p);
      if (building) {
        building.components.workplace!.villageId = village.id;
        world.visual({ kind: 'build', ...p, radius: 1 });
        if (kind === 'market') world.announce(`${village.name}: the market opened`);
      }
      break;
    }
  }
}

const recipes: Record<'flour' | 'bread' | 'tools', { station: WorkplaceKind; input: Good; needed: number; output: number }> = {
  flour: { station: 'mill', input: 'grain', needed: 2, output: 2 },
  bread: { station: 'bakery', input: 'flour', needed: 2, output: 4 },
  tools: { station: 'workshop', input: 'wood', needed: 3, output: 2 },
};

function stop(entity: Entity): void {
  const c = entity.components.citizen!;
  c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0;
  if (!c.work?.cargo) delete c.work;
}

function sendToMarket(world: World, entity: Entity, village: Village): boolean {
  const c = entity.components.citizen!, cargo = c.work?.cargo, market = marketOf(world, village.id);
  if (!cargo || !market) return false;
  if (economyOf(village).stocks[cargo.good] >= 2000 || cargo.good === 'bread' && village.food >= 2000) return false;
  const path = findPath(world, entity.components.position!, market.components.position!, 1.8);
  if (path === undefined) return false;
  c.task = 'deliver'; c.targetId = market.id; c.path = path; c.repair = null; c.reconsiderIn = 2;
  return true;
}

/** Work produces a carried batch. Stocks change only after the worker reaches the market. */
export function continueVillageWork(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!;
  if (c.task !== 'work' && c.task !== 'deliver') return false;
  const village = villageOf(world, c.villageId), work = c.work, target = world.entities.get(c.targetId ?? -1);
  if (!village || !work || !target || c.hunger >= 70 || entity.components.person!.age < 18
    || entity.components.thermal?.burning || target.components.thermal?.burning) { stop(entity); return false; }
  // Hunger, war and disaster orders can suspend a delivery without duplicating its cargo.
  if (c.path.length || distance(entity, target) > 2.1) {
    if (c.reconsiderIn <= 0 || !c.path.length) {
      const route = findPath(world, entity.components.position!, target.components.position!, 1.8);
      if (route === undefined) { stop(entity); return false; }
      c.path = route; c.reconsiderIn = 2;
    }
    return true;
  }
  const stocks = economyOf(village).stocks;
  if (c.task === 'deliver') {
    const cargo = work.cargo;
    if (!cargo || target.components.workplace?.kind !== 'market' || target.components.workplace.villageId !== village.id) { stop(entity); return false; }
    const amount = Math.min(cargo.amount, 2000 - stocks[cargo.good], cargo.good === 'bread' ? 2000 - village.food : Infinity);
    stocks[cargo.good] += amount;
    if (cargo.good === 'bread') village.food += amount;
    if (amount > 0) { economyOf(village).deliveries++; recordService(entity, 1); }
    cargo.amount -= amount;
    if (cargo.amount <= 1e-8) work.cargo = null;
    stop(entity); return false;
  }
  const good = work.good;
  if (good === 'wood' ? target.typeId !== 'core:tree'
    : good === 'grain' ? target.components.farm?.villageId !== village.id || (target.components.farm.grain ?? 0) < 1
    : target.components.workplace?.kind !== recipes[good].station || target.components.workplace.villageId !== village.id || stocks[recipes[good].input] < recipes[good].needed) {
    stop(entity); return false;
  }
  work.progress = Math.min(4, work.progress + 0.5);
  if (entity.components.person!.animation) entity.components.person!.animation.work = (work.progress % 1);
  if (work.progress < (good === 'grain' ? 1 : 4)) return true;
  let amount: number;
  if (good === 'wood') { amount = 3; world.remove(target.id); }
  else if (good === 'grain') { amount = Math.min(6, target.components.farm!.grain!); target.components.farm!.grain! -= amount; }
  else { const recipe = recipes[good]; stocks[recipe.input] -= recipe.needed; amount = recipe.output; }
  work.cargo = { good, amount, villageId: village.id }; work.progress = 0;
  if (!sendToMarket(world, entity, village)) stop(entity);
  return true;
}

export function assignVillageWork(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!, village = villageOf(world, c.villageId);
  if (!village || entity.components.person!.age < 18 || c.hunger >= 70) return false;
  if (c.work?.cargo) return sendToMarket(world, entity, village);
  const market = marketOf(world, village.id);
  if (!market) return false;
  const residents = [...world.query('citizen', 'person')].filter(e => e.components.citizen!.villageId === village.id && e.components.person!.age >= 18 && e.components.citizen!.task !== 'migrate');
  const workers = residents.filter(e => ['work', 'deliver', 'tend', 'guard'].includes(e.components.citizen!.task));
  if (workers.length >= Math.max(1, Math.floor(residents.length / 2))) return false;
  const stocks = economyOf(village).stocks;
  const buildings = [...world.query('workplace', 'position')].filter(e => e.components.workplace!.villageId === village.id && !e.components.thermal?.burning);
  const jobs: { good: Good; target: Entity }[] = [];
  const addRecipe = (good: 'flour' | 'bread' | 'tools', limit: number): void => {
    const recipe = recipes[good];
    if (stocks[recipe.input] < recipe.needed || stocks[good] >= limit) return;
    for (const target of buildings) if (target.components.workplace!.kind === recipe.station) jobs.push({ good, target });
  };
  addRecipe('bread', 30); addRecipe('flour', 12);
  for (const target of world.query('farm', 'position')) if (target.components.farm!.villageId === village.id && (target.components.farm!.grain ?? 0) >= 1 && stocks.grain < 24) jobs.push({ good: 'grain', target });
  addRecipe('tools', 8);
  if (stocks.wood < 12) {
    const trees = world.nearby(market.components.position!, 18).filter(e => e.typeId === 'core:tree' && !e.components.thermal?.burning);
    trees.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of trees) jobs.push({ good: 'wood', target });
  }
  for (const { good, target } of jobs) {
    if (workers.some(e => e.components.citizen!.targetId === target.id)) continue;
    const path = findPath(world, entity.components.position!, target.components.position!, 1.8);
    if (path === undefined || findPath(world, path.at(-1) ?? entity.components.position!, market.components.position!, 1.8) === undefined) continue;
    c.task = 'work'; c.targetId = target.id; c.path = path; c.repair = null; c.reconsiderIn = 2;
    c.work = { good, progress: 0, cargo: null };
    return true;
  }
  return false;
}
