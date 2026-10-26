import { FOOD_RECIPES, type DishId } from '../content/food-catalog';
import { canCook } from '../core/food';
import { payWork } from '../core/currency';
import { isAdult } from '../core/unit-stats';
import { developmentProblem } from '../core/village-development';
import { ownsPosition } from '../core/territory';
import { assignItem, carriedItems, continueItemPickup, deliverItems, equipmentDelivery, repairEquipment } from '../core/equipment';
import { cancelBehaviour, completeBehaviour, enterBehaviour } from '../core/behaviour';
import { requestCraft, requestVillageCrafts } from '../core/crafting';
import { EQUIPMENT_SLOTS } from '../core/equipment-catalog';
import { continueCraft, startCraft } from './crafting';
import { BUILDINGS, buildingOwner, hasOrderedBuilding, operational } from '../core/buildings';
import { planBuilding } from './construction';
import { clearStorageApproach, consumeReservation, deliveryStore, initializeStorage, releaseReservation, reserveGoods, storageFor, storageOwner, storageRoute, storesOf } from '../core/stockpiles';
import { hasPhysiology } from '../core/physiology';
import type { World } from '../core/world';
import { isRoadSurface, type Entity, type Village } from '../core/types';
import { economyOf, recordService } from '../core/village-life';
import { findPath } from './navigation';
import { villageOf } from './society';
import { STONE } from '../core/stone';
import { SILVER } from '../core/silver';
import { GOLD } from '../core/gold';
import { BONE } from '../core/bone';
import { LEATHER } from '../core/leather';
import { needsLeather } from '../core/hunting';
import { committedStone, mineralDeposit, depositBatch, depositContents, releaseDepositClaim, reserveDeposit, stoneTarget, type MiningReason } from '../core/deposits';
import { gemProfile, missingGems } from '../core/gems';
import { availableStock, canAfford, cargoContents, deposit, inTransit, isCrafted, makeCargo, RECIPES as recipes, stockOf, type CraftedGood } from '../core/resource-ledger';
import { bundleSize, entries, SOURCE_PROFILES, type ResourceId } from '../core/resources';
import { deathGoods, extractSource, mayGather, sourceContents } from '../core/resource-sources';
import { FOREST, fellingProblem, housingWoodReserve, releaseTreeClaim, reserveTree, treeOwner, treeYield } from '../core/forestry';
import { cancelJob, claimJob, hasCivilianService, huntable, jobEligibility, productionJob, releaseJob } from '../core/jobs';
import { attackReach, performAttack } from './equipment';
import { finishMineShift, insideMine, leaveMine, mineDemand, mineRoute, mineSafety, mineWorkers, MINE } from '../core/mines';
import { buildingEntrances } from '../core/buildings';

const distance = (a: Entity, b: Entity): number => Math.hypot(a.components.position!.x - b.components.position!.x, a.components.position!.y - b.components.position!.y);
export function marketOf(world: World, villageId: number): Entity | undefined {
  return [...world.query('workplace', 'position')].find(e => e.components.workplace!.kind === 'market' && e.components.workplace!.villageId === villageId && operational(e) && !e.components.thermal?.burning);
}

export function economy(world: World): void {
  if (world.paused) return;
  for (const worker of world.query('citizen')) {
    if (!worker.components.citizen!.work?.mine) continue;
    const c = worker.components.citizen!, mine = world.entities.get(c.targetId ?? -1);
    if (!mine?.components.mine || c.jobAssignment?.kind !== 'miner' || c.task !== 'work'
      || c.villageId !== mine.components.mine.villageId || mineSafety(world, mine) || jobEligibility(world, worker, 'miner')) {
      if (mine?.components.mine) mine.components.mine.lastAttempt = { tick: world.tick, outcome: 'Mine work interrupted' };
      cancelJob(world, worker, 'Target is no longer available');
    }
  }
  for (const village of world.society.villages) initializeStorage(world, village);
  if (world.tick % 150 !== 0) return;
  for (const owner of world.query('person', 'citizen', 'position')) repairEquipment(world, owner);
  for (const village of world.society.villages) {
    requestVillageCrafts(world, village.id);
    const e = economyOf(village);
    if (world.tick < e.buildAfter) continue;
    const adults = [...world.query('person', 'citizen', 'position')].filter(p => isAdult(p) && !p.components.person!.madness
      && p.components.citizen!.villageId === village.id && p.components.citizen!.task !== 'migrate' && !p.components.thermal?.burning);
    if (adults.length < 3) continue;
    e.buildAfter = world.tick + 450;
    const existing = [...world.query('workplace')].filter(p => p.components.workplace!.villageId === village.id);
    const kind = (['market', 'mill', 'bakery', 'workshop'] as const).find(kind => !existing.some(p => p.components.workplace!.kind === kind)
      && !developmentProblem(world, village, `core:${kind}`) && canAfford(world, village, BUILDINGS[`core:${kind}`].cost))
      ?? (storesOf(village).every(s => Object.values(s.goods).reduce((sum, n) => sum + n, 0) >= s.capacity * 0.8) ? 'stockpile' : undefined)
      ?? (!hasOrderedBuilding(world, 'core:mine', village.id) && canAfford(world, village, BUILDINGS['core:mine'].cost)
        && village.food >= adults.length * MINE.foodReserve && !developmentProblem(world, village, 'core:mine') ? 'mine' : undefined)
      ?? (!hasOrderedBuilding(world, 'core:temple', village.id) && canAfford(world, village, BUILDINGS['core:temple'].cost)
        && !developmentProblem(world, village, 'core:temple') ? 'temple' : undefined);
    if (!kind || kind !== 'market' && !marketOf(world, village.id)) continue;
    const worker = adults[0];
    for (let i = 0; i < 24; i++) {
      const angle = world.rng.range(0, Math.PI * 2), radius = world.rng.range(4, 11);
      const p = { x: village.x + Math.cos(angle) * radius, y: village.y + Math.sin(angle) * radius };
      if (!ownsPosition(world, village.id, p) || !world.safeLand(p, 1.5) || isRoadSurface(world.terrain.at(p.x, p.y)) || !world.canStand(p, 1.2)
        || world.nearby(p, 3).some(e => e.components.farm || e.components.workplace || e.components.thermal?.burning || e.components.explosive)) continue;
      if (findPath(world, worker.components.position!, p, 1.8) === undefined) continue;
      if (planBuilding(world, `core:${kind}`, p, village, adults.find(e => e.components.citizen!.task !== 'build' && !e.components.citizen!.work?.cargo))) break;
    }
  }
}

/** Item claims retain ownership at the store until physical pickup. */
export const continueEquipping = continueItemPickup;
export const assignEquipment = assignItem;

/** A mine shift is a job at the entrance, then hidden inside. The resident keeps
 * its entity and exit position, so interruption/removal can never strand a slot. */
export function assignMineWork(world: World, worker: Entity, village: Village): boolean {
  const c = worker.components.citizen!;
  if (world.paused || c.jobAssignment?.kind === 'miner' || c.work?.cargo || carriedItems(world, worker.id).length || jobEligibility(world, worker, 'miner')) return false;
  for (const mine of world.query('mine', 'position')) {
    if (buildingOwner(mine) !== village.id) continue;
    const need = mineDemand(world, mine, village);
    if (!need.limit || mineWorkers(world, mine).length >= need.limit) continue;
    const path = mineRoute(world, worker.components.position!, mine);
    if (path === undefined) { c.jobProblem = { kind: 'miner', reason: 'No route to the target' }; continue; }
    cancelBehaviour(world, worker, 'Action interrupted', false);
    if (!claimJob(world, worker, 'miner', mine.id, 'stone')) continue;
    c.task = 'work'; c.targetId = mine.id; c.path = path; c.reconsiderIn = 2; c.repair = null;
    c.work = { good: 'stone', progress: 0, cargo: null, mine: { enteredAt: null,
      duration: Math.floor(world.rng.range(MINE.minTicks, MINE.maxTicks + 1)) } };
    return true;
  }
  return false;
}
export function continueMineWork(world: World, worker: Entity): boolean {
  const c = worker.components.citizen!, shift = c.work?.mine, mine = world.entities.get(c.targetId ?? -1);
  if (world.paused || !shift) return false;
  const village = villageOf(world, c.villageId);
  const reason = jobEligibility(world, worker, 'miner');
  if (!mine?.components.mine || !village || c.jobAssignment?.kind !== 'miner' || c.task !== 'work'
    || buildingOwner(mine) !== village.id || reason || mineSafety(world, mine)) {
    if (mine?.components.mine) mine.components.mine.lastAttempt = { tick: world.tick, outcome: 'Mine work interrupted' };
    cancelJob(world, worker, reason ?? 'Target is no longer available'); return false;
  }
  const entrance = buildingEntrances(world, mine)[0];
  if (shift.enteredAt === null) {
    const need = mineDemand(world, mine, village);
    if (!need.limit || c.jobAssignment.slot >= need.limit) { cancelJob(world, worker, 'No work needed'); return false; }
    if (Math.hypot(worker.components.position!.x - entrance.x, worker.components.position!.y - entrance.y) >= 0.35) {
      if (!c.path.length || c.reconsiderIn <= 0) {
        const path = mineRoute(world, worker.components.position!, mine);
        if (!path) { cancelJob(world, worker, 'No route to the target'); return false; }
        c.path = path; c.reconsiderIn = 2;
      }
      return true;
    }
    c.path = []; shift.enteredAt = world.tick; c.jobAssignment.phase = 'operate';
    if (worker.components.motion) { worker.components.motion.vx = 0; worker.components.motion.vy = 0; }
  }
  c.work!.progress = Math.min(1, (world.tick - shift.enteredAt) / shift.duration);
  if (c.work!.progress < 1) return true;
  const demand = mineDemand(world, mine, village);
  // Clear first: saving or cancellation can never replay this completed attempt.
  stop(world, worker);
  if (!demand.limit) {
    mine.components.mine.lastAttempt = { tick: world.tick, outcome: demand.reason === 'No room for a new deposit' ? demand.reason : 'Mine work interrupted' };
    return false;
  }
  finishMineShift(world, mine);
  return false;
}

function stop(world: World, entity: Entity, waiting?: MiningReason): void {
  leaveMine(world, entity);
  releaseJob(entity);
  cancelBehaviour(world, entity);
  releaseTreeClaim(world, entity.id);
  releaseDepositClaim(world, entity.id);
  const c = entity.components.citizen!;
  const village = villageOf(world, c.villageId);
  if (village) releaseReservation(village, entity.id);
  c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0;
  if (c.work) delete c.work.reservation;
  if (waiting && c.work) { c.work.waiting = waiting; c.work.progress = 0; }
  else if (!c.work?.cargo && !carriedItems(world, entity.id).length) delete c.work;
}

function sendToMarket(world: World, entity: Entity, village: Village): boolean {
  const c = entity.components.citizen!, cargo = c.work?.cargo;
  const equipment = equipmentDelivery(world, entity);
  if (equipment) {
    c.task = 'deliver'; c.targetId = equipment.building.id; c.path = equipment.path; c.repair = null; c.reconsiderIn = 2;
    if (c.jobAssignment) Object.assign(c.jobAssignment, { phase: 'deliver', targetId: c.targetId });
    return enterBehaviour(world, entity, 'delivery', 'carry');
  }
  if (!cargo || cargo.villageId !== village.id) return false;
  const goods = cargoContents(cargo);
  const destination = deliveryStore(world, village, entity.components.position!, goods, !!(goods.gems || goods.gold));
  if (!destination) { if (c.work && cargoContents(cargo).stone) c.work.waiting = 'No storage space for the whole batch'; return false; }
  delete c.work!.waiting;
  c.task = 'deliver'; c.targetId = destination.building.id; c.path = destination.path; c.repair = null; c.reconsiderIn = 2;
  if (c.jobAssignment) Object.assign(c.jobAssignment, { phase: 'deliver', targetId: c.targetId });
  return enterBehaviour(world, entity, c.behaviour?.taskId === 'gather' ? 'gather' : 'delivery', 'carry');
}

/** Work produces a carried batch. Stocks change only after a physical storage hand-off. */
export function continueVillageWork(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!;
  if (world.paused || c.task !== 'work' && c.task !== 'deliver') return false;
  if (c.work?.mine || c.jobAssignment?.kind === 'miner') return continueMineWork(world, entity);
  if (!hasCivilianService(world, entity)) { cancelJob(world, entity, 'Military service'); return false; }
  if (c.task === 'work' && c.work?.orderId !== undefined) return continueCraft(world, entity);
  const item = carriedItems(world, entity.id)[0];
  const itemOwner = item?.location.kind === 'carried' ? item.location.villageId : undefined;
  const village = villageOf(world, c.task === 'deliver' ? c.work?.cargo?.villageId ?? itemOwner ?? c.villageId : c.villageId), work = c.work, target = world.entities.get(c.targetId ?? -1);
  const foundingStore = target && village?.economy?.storage?.[0]?.buildingId === target.id && target.components.building?.project?.action === 'build';
  if (!village || !work || !target || c.hunger >= 70 || !isAdult(entity)
    || c.emergency || entity.components.thermal?.burning || target.components.thermal?.burning || target.components.building && !operational(target) && !(c.task === 'deliver' && foundingStore)) {
    stop(world, entity, (target && mineralDeposit(target)) || work?.good === 'stone' || work?.good === 'commonMetal' ? c.hunger >= STONE.hunger ? 'Miner needs food' : !target ? 'No reachable deposit' : 'Mining site is unsafe' : undefined); return false;
  }
  initializeStorage(world, village);
  if (c.task === 'work') {
    const kind = productionJob(target, work.good);
    if (!claimJob(world, entity, kind, target.id, work.good)) { stop(world, entity); return false; }
    if (kind === 'hunter') {
      if (!huntable(world, village, target)) { stop(world, entity); return false; }
      if (!deliveryStore(world, village, entity.components.position!, deathGoods(world, target), true)) { cancelJob(world, entity, 'Storage is full'); return false; }
      const reach = attackReach(world, entity, target);
      if (distance(entity, target) > reach) {
        if (c.reconsiderIn <= 0 || !c.path.length) {
          const route = findPath(world, entity.components.position!, target.components.position!, reach * 0.85);
          if (route === undefined) { cancelJob(world, entity, 'No route to the target'); return false; }
          c.path = route; c.reconsiderIn = 0.5;
        }
      } else { c.path = []; c.jobAssignment!.phase = 'operate'; performAttack(world, entity, target); }
      return true;
    }
    const batch = isCrafted(work.good) && !target.components.resourcePile && !mineralDeposit(target) ? recipes[work.good].outputs : sourceContents(target);
    if (batch && !deliveryStore(world, village, entity.components.position!, batch, false)) {
      cancelJob(world, entity, 'Storage is full'); return false;
    }
  }
  const chain = c.task === 'work' || c.behaviour?.taskId === 'gather' ? 'gather' : 'delivery';
  // Hunger, war and disaster orders can suspend a delivery without duplicating its cargo.
  const canThrow = c.task === 'deliver' && hasPhysiology(entity, 'good-throwers') && clearStorageApproach(world, entity.components.position!, target, 8.1);
  if (!canThrow && (c.path.length || distance(entity, target) > 2.1 || (c.task === 'deliver' || target.components.foodPlant || target.components.resourcePile || target.components.tree || mineralDeposit(target) || target.components.gemSource) && !clearStorageApproach(world, entity.components.position!, target))) {
    if (!enterBehaviour(world, entity, chain, c.task === 'deliver' ? 'carry' : 'approach')) return false;
    if (c.reconsiderIn <= 0 || !c.path.length) {
      const route = c.task === 'deliver' || target.components.foodPlant || target.components.resourcePile || target.components.tree || mineralDeposit(target) || target.components.gemSource ? storageRoute(world, entity.components.position!, target) : findPath(world, entity.components.position!, target.components.position!, 1.8);
      if (route === undefined) { cancelBehaviour(world, entity, 'No route to the target'); stop(world, entity, mineralDeposit(target) ? 'No reachable deposit' : undefined); return false; }
      c.path = route; c.reconsiderIn = 2;
    }
    return true;
  }
  if (c.task === 'deliver') {
    if (canThrow) c.path = [];
    if (!enterBehaviour(world, entity, chain, 'unload')) return false;
    const cargo = work.cargo;
    if (!cargo && !item || !storageFor(world, target.id) || storageOwner(target) !== village.id) { stop(world, entity); return false; }
    if ((cargo?.villageId ?? itemOwner) !== village.id) { stop(world, entity); return false; }
    const goods = cargo ? cargoContents(cargo) : {};
    // Rare units and their mixed batch are indivisible, even if food left fractional storage room.
    if (goods.gems || goods.gold) {
      const destination = deliveryStore(world, village, entity.components.position!, goods, true);
      if (!destination) { stop(world, entity); return false; }
      if (destination.building.id !== target.id) {
        c.targetId = destination.building.id; c.path = destination.path; c.reconsiderIn = 2;
        return enterBehaviour(world, entity, chain, 'carry');
      }
    }
    completeBehaviour(world, entity, () => {
      const axes = goods.stoneAxes ?? 0;
      delete goods.stoneAxes;
      const delivered = deposit(village, goods, target.id);
      const items = deliverItems(world, entity, village, target.id);
      if (axes) { goods.stoneAxes = axes; delivered.stoneAxes = items.filter(i => i.definition === 'stone-axe').length; }
      for (const [id, amount] of entries(delivered)) goods[id] = (goods[id] ?? 0) - amount;
      if (bundleSize(delivered) || items.length) { economyOf(village).deliveries++; recordService(entity, 1); }
      work.cargo = makeCargo(goods, village.id, cargo?.good);
      if (!work.cargo && !carriedItems(world, entity.id).length && (bundleSize(delivered) || items.length)) payWork(world, entity, 'delivery');
      return bundleSize(delivered) > 0 || items.length > 0;
    });
    stop(world, entity); return false;
  }
  const good = work.good;
  const pile = target.components.resourcePile;
  // Version 36 jobs are migrated to explicit orders before entering the simulation.
  if (good === 'stoneAxes' && !pile) { stop(world, entity); return false; }
  const recipe = isCrafted(good) && !target.components.foodPlant && !pile && !mineralDeposit(target) ? recipes[good] : undefined;
  if (target.components.foodPlant ? target.components.foodPlant.good !== good || target.components.foodPlant.remaining < 1
    : pile ? !mayGather(entity, target)
    : mineralDeposit(target) ? good !== SOURCE_PROFILES[mineralDeposit(target)!.profile].primary || !world.terrain.isLand(target.components.position!.x, target.components.position!.y)
    : good === 'gems' ? !target.components.gemSource || !world.terrain.isLand(target.components.position!.x, target.components.position!.y)
    : good === 'wood' ? target.typeId !== 'core:tree'
    : good === 'grain' ? target.components.farm?.villageId !== village.id || (target.components.farm.grain ?? 0) < 1
    : good === 'stone' ? !mineralDeposit(target) || !world.terrain.isLand(target.components.position!.x, target.components.position!.y)
    : good === 'commonMetal' ? !target.components.commonMetal || !world.terrain.isLand(target.components.position!.x, target.components.position!.y)
    : !recipe || !canCook(entity, good) || target.components.workplace?.kind !== recipe.station || target.components.workplace.villageId !== village.id || !canAfford(world, village, recipe.inputs, entity.id)) {
    stop(world, entity); return false;
  }
  // Legacy in-progress recipes acquire a reservation once, without spending twice.
  if (recipe) {
    if ('wood' in recipe.inputs && availableStock(world, village, 'wood', entity.id) - recipe.inputs.wood! < housingWoodReserve(world, village)) { stop(world, entity); return false; }
    if (!reserveGoods(world, village, recipe.inputs, entity.id, entity.components.position!)) { stop(world, entity); return false; }
    work.reservation ??= { villageId: village.id, inputs: { ...recipe.inputs } };
  }
  if (work.reservation && work.reservation.villageId !== village.id) { stop(world, entity); return false; }
  if (mineralDeposit(target)) {
    if (!reserveDeposit(world, target, entity)) { stop(world, entity, 'Deposit batch is reserved'); return false; }
    const goods = depositContents(mineralDeposit(target)!, depositBatch(world, target, entity.id));
    if (!deliveryStore(world, village, entity.components.position!, goods, true)) { stop(world, entity, 'No storage space for the whole batch'); return false; }
    delete work.waiting;
  }
  if (target.components.gemSource && !deliveryStore(world, village, entity.components.position!, gemProfile(target.components.gemSource).outputs, true)) { stop(world, entity); return false; }
  if (target.components.tree) {
    const problem = fellingProblem(world, target, village, entity.id);
    if (problem) { economyOf(village).forestProblem = problem; stop(world, entity); return false; }
    if (!reserveTree(world, target, entity)) { stop(world, entity); return false; }
    if (!deliveryStore(world, village, entity.components.position!, treeYield(target), true)) {
      economyOf(village).forestProblem = 'No storage space for the whole harvest'; stop(world, entity); return false;
    }
  }
  const requiredWork = recipe?.work ?? (good === 'grain' || pile || target.components.foodPlant ? 1 : mineralDeposit(target) ? STONE.work : 4);
  if (recipe && !deliveryStore(world, village, entity.components.position!, recipe.outputs, true)) { cancelJob(world, entity, 'Storage is full'); return false; }
  if (!enterBehaviour(world, entity, 'gather', 'extract', work.progress / requiredWork)) return false;
  work.progress = Math.min(requiredWork, work.progress + 0.5);
  c.behaviour!.progress = work.progress / requiredWork;
  if (entity.components.person!.animation) entity.components.person!.animation.work = (work.progress % 1);
  if (work.progress < requiredWork) return true;
  if (!completeBehaviour(world, entity, () => {
    if (!recipe) {
      const extracted = extractSource(world, entity, target);
      if (extracted) payWork(world, entity, 'gathering');
      return extracted;
    }
    if (!consumeReservation(village, entity.id, recipe.inputs)) return false;
    work.cargo = makeCargo(recipe.outputs, village.id, good);
    delete work.reservation; payWork(world, entity, 'production'); return true;
  })) { stop(world, entity); return false; }
  work.progress = 0;
  if (!sendToMarket(world, entity, village)) stop(world, entity, work.waiting);
  return true;
}

export function assignVillageWork(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!, village = villageOf(world, c.villageId);
  if (world.paused || !village || !isAdult(entity) || c.hunger >= 70) return false;
  if (!hasCivilianService(world, entity)) return false;
  if (c.behaviour?.status === 'cancelled' && world.tick < c.behaviour.retryAt) return false;
  cancelBehaviour(world, entity, 'Action interrupted', false);
  initializeStorage(world, village);
  if (carriedItems(world, entity.id).length) {
    c.work ??= { good: 'stoneAxes', progress: 0, cargo: null };
    return sendToMarket(world, entity, village);
  }
  if (c.work?.cargo) {
    // A migrant returns the shipment to its original owner. If that village vanished,
    // the orphaned load stays with the carrier until destruction; it is never credited twice.
    const owner = villageOf(world, c.work.cargo.villageId);
    return !!owner && sendToMarket(world, entity, owner);
  }
  const market = marketOf(world, village.id) ?? storesOf(village).map(s => world.entities.get(s.buildingId)).find(Boolean);
  if (!market) return false;
  const residents = [...world.query('citizen', 'person')].filter(e => e.components.citizen!.villageId === village.id && isAdult(e) && e.components.citizen!.task !== 'migrate');
  const workers = residents.filter(e => ['work', 'deliver', 'tend', 'guard'].includes(e.components.citizen!.task));
  if (workers.length >= Math.max(1, Math.floor(residents.length / 2))) return false;
  if (!workers.some(e => insideMine(e) || e.components.citizen!.jobAssignment?.kind === 'miner') && assignMineWork(world, entity, village)) return true;
  const stocks = economyOf(village).stocks;
  const buildingDemand = { wood: 0, stone: 0, commonMetal: 0, gold: 0 };
  for (const site of world.query('building')) {
    const project = site.components.building!.project;
    if (!project || project.paid || buildingOwner(site) !== village.id) continue;
    buildingDemand.wood += project.cost.wood ?? 0; buildingDemand.stone += project.cost.stone ?? 0;
    buildingDemand.commonMetal += project.cost.commonMetal ?? 0;
    buildingDemand.gold += project.cost.gold ?? 0;
  }
  const buildings = [...world.query('workplace', 'position')].filter(e => e.components.workplace!.villageId === village.id && operational(e) && !e.components.thermal?.burning);
  const jobs: { good: ResourceId; target: Entity; orderId?: number }[] = [];
  const hungry = village.food < residents.length;
  const addRecipe = (good: CraftedGood, limit: number): void => {
    const recipe = recipes[good];
    if (!canCook(entity, good) || !canAfford(world, village, recipe.inputs) || (stocks[good] ?? 0) >= limit) return;
    if ('wood' in recipe.inputs && (hungry || availableStock(world, village, 'wood') - recipe.inputs.wood! < housingWoodReserve(world, village))) return;
    for (const target of buildings) if (target.components.workplace!.kind === recipe.station) jobs.push({ good, target });
  };
  for (const good of Object.keys(FOOD_RECIPES) as DishId[]) addRecipe(good, 6);
  addRecipe('bread', 30); addRecipe('flour', 12);
  for (const target of world.nearby(market.components.position!, 28)) {
    const plant = target.components.foodPlant;
    if (plant?.remaining && !target.components.thermal?.burning && stockOf(village, plant.good) < 24) jobs.push({ good: plant.good, target });
  }
  for (const target of world.nearby(market.components.position!, 18)) {
    if (!target.components.resourcePile || !mayGather(entity, target) || target.components.thermal?.burning || target.components.building && !operational(target)) continue;
    const good = entries(sourceContents(target)!).find(([id, n]) => n > 0 && stockOf(village, id) < 2000)?.[0];
    if (good) jobs.push({ good, target });
  }
  for (const target of world.query('farm', 'position')) if (operational(target) && target.components.farm!.villageId === village.id && (target.components.farm!.grain ?? 0) >= 1 && stocks.grain < 24) jobs.push({ good: 'grain', target });
  const foodHunt = village.food < residents.length * 2, leatherHunt = !foodHunt && needsLeather(world, village);
  if (foodHunt || leatherHunt) for (const target of world.nearby(village, LEATHER.huntRadius)) {
    if (huntable(world, village, target) && (!leatherHunt || deathGoods(world, target).leather)) jobs.push({ good: foodHunt ? 'meat' : 'leather', target });
  }
  addRecipe('tools', 8);
  const upgrading = [...world.query('dwelling')].some(e => e.components.dwelling!.villageId === village.id && !e.components.dwelling!.level && !e.components.building!.project);
  for (const slot of EQUIPMENT_SLOTS) requestCraft(world, entity, slot);
  for (const order of world.crafting.orders) if (order.villageId === village.id && order.state === 'waiting') {
    for (const target of buildings) if (target.components.workplace!.kind === 'workshop') jobs.push({ good: 'stoneAxes', target, orderId: order.id });
  }
  const metalDemand = Math.max(12, buildingDemand.commonMetal, ...world.crafting.orders.filter(o => o.villageId === village.id && !o.paid && o.state !== 'cancelled').map(o => o.inputs.commonMetal ?? 0));
  const needsMetal = availableStock(world, village, 'commonMetal') < metalDemand;
  const needsGems = missingGems(world, village) > 0;
  if (needsGems && !workers.some(e => e.components.citizen!.work?.good === 'gems')) {
    const sources = world.nearby(market.components.position!, 28).filter(e => e.components.gemSource && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    sources.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of sources) jobs.push({ good: 'gems', target });
  }
  if (stocks.wood < Math.max(12, buildingDemand.wood) || needsMetal || needsGems) {
    const trees = world.nearby(village, FOREST.radius).filter(e => e.components.tree && treeOwner(world, e)?.id === village.id);
    trees.sort((a, b) => distance(entity, a) - distance(entity, b));
    delete economyOf(village).forestProblem;
    let harvestable = false;
    for (const target of trees) {
      if (stocks.wood >= Math.max(12, buildingDemand.wood) && !(needsMetal && treeYield(target).commonMetal) && !(needsGems && treeYield(target).gems)) continue;
      const problem = fellingProblem(world, target, village, entity.id);
      if (problem) { economyOf(village).forestProblem ??= problem; continue; }
      harvestable = true;
      jobs.push({ good: 'wood', target });
    }
    if (harvestable) delete economyOf(village).forestProblem;
    else economyOf(village).forestProblem ??= 'No mature trees nearby';
  }
  let miningReason: MiningReason = hungry ? 'Miners are needed for food' : 'Stone supply is sufficient';
  const incomingGold = (inTransit(world, village.id).gold ?? 0) + [...world.query('stone')].reduce((sum, e) => sum
    + (e.components.stone!.profile === 'goldOre' ? e.components.stone!.claims.filter(c => c.villageId === village.id && c.expires > world.tick).reduce((n, c) => n + c.amount, 0) : 0), 0);
  const needsGold = availableStock(world, village, 'gold') + incomingGold < Math.max(GOLD.stockTarget, buildingDemand.gold);
  if (needsGold) {
    miningReason = hungry ? 'Miners are needed for food' : 'No reachable deposit';
    const sources = world.nearby(market.components.position!, STONE.radius).filter(e => e.components.stone?.profile === 'goldOre' && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    sources.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of sources) jobs.push({ good: 'gold', target });
  }
  const silverDemand = Math.max(SILVER.stockTarget, ...world.crafting.orders.filter(o => o.villageId === village.id && !o.paid && ['waiting', 'working'].includes(o.state)).map(o => o.inputs.silver ?? 0));
  const incomingSilver = (inTransit(world, village.id).silver ?? 0) + [...world.query('stone')].reduce((sum, e) => sum
    + (e.components.stone!.profile === 'silverOre' ? e.components.stone!.claims.filter(c => c.villageId === village.id && c.expires > world.tick).reduce((n, c) => n + c.amount, 0) : 0), 0);
  const needsSilver = availableStock(world, village, 'silver') + incomingSilver < silverDemand;
  if (needsSilver) {
    miningReason = hungry ? 'Miners are needed for food' : 'No reachable deposit';
    const sources = world.nearby(market.components.position!, STONE.radius).filter(e => e.components.stone?.profile === 'silverOre' && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    sources.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of sources) jobs.push({ good: 'silver', target });
  }
  const boneDemand = Math.max(BONE.stockTarget, ...world.crafting.orders.filter(o => o.villageId === village.id && !o.paid && ['waiting', 'working'].includes(o.state)).map(o => o.inputs.bone ?? 0));
  const incomingBone = (inTransit(world, village.id).bone ?? 0) + [...world.query('stone')].reduce((sum, e) => sum
    + (e.components.stone!.profile === 'boneDeposit' ? e.components.stone!.claims.filter(c => c.villageId === village.id && c.expires > world.tick).reduce((n, c) => n + c.amount, 0) : 0), 0);
  const needsBone = availableStock(world, village, 'bone') + incomingBone < boneDemand;
  if (needsBone) {
    miningReason = hungry ? 'Miners are needed for food' : 'No reachable deposit';
    const sources = world.nearby(market.components.position!, STONE.radius).filter(e => e.components.stone?.profile === 'boneDeposit' && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    sources.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of sources) jobs.push({ good: 'bone', target });
  }
  if (committedStone(world, village) < stoneTarget(world, village)) {
    miningReason = hungry ? 'Miners are needed for food' : 'No reachable deposit';
    const deposits = world.nearby(market.components.position!, STONE.radius).filter(e => e.components.stone && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    deposits.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of deposits) if (!jobs.some(job => job.target === target)) jobs.push({ good: SOURCE_PROFILES[mineralDeposit(target)!.profile].primary, target });
  }
  if (needsMetal) {
    const deposits = world.nearby(market.components.position!, 28).filter(e => e.components.commonMetal && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    deposits.sort((a, b) => distance(entity, a) - distance(entity, b));
    for (const target of deposits) jobs.push({ good: 'commonMetal', target });
  }
  // A well-fed village can devote one worker to stone development while the others
  // keep producing food. Otherwise bread recipes can indefinitely starve mining.
  const stoneWork = jobs.some(job => job.good === 'gold' || job.good === 'stone' || job.good === 'silver' || job.good === 'bone' || job.good === 'commonMetal' || job.good === 'stoneAxes');
  if (stoneWork && village.food >= residents.length * STONE.foodReserve
    && !workers.some(e => ['wood', 'stone', 'silver', 'bone', 'commonMetal', 'gold', 'stoneAxes'].includes(e.components.citizen!.work?.good ?? ''))) {
    const priority = (good: ResourceId): number => good === 'stoneAxes' ? 0
      : good === 'wood' && stocks.wood < Math.max(buildingDemand.wood, upgrading ? STONE.houseWood : STONE.axeWood) ? 1
      : good === 'gold' && needsGold || good === 'silver' && needsSilver || good === 'bone' && needsBone ? 2 : good === 'commonMetal' ? 2 : good === 'stone' ? 3 : 4;
    jobs.sort((a, b) => priority(a.good) - priority(b.good));
  }
  // At most one well-fed worker pursues the next bounded accessory demand.
  if (needsGems && village.food >= residents.length * 2 && !workers.some(e => e.components.citizen!.work?.good === 'gems')) {
    const gemJob = (job: typeof jobs[number]): number => job.good === 'gems' || job.target.components.tree && !!treeYield(job.target).gems ? 1 : 0;
    jobs.sort((a, b) => gemJob(b) - gemJob(a));
  }
  for (const { good, target, orderId } of jobs) {
    const kind = productionJob(target, good);
    const forbidden = jobEligibility(world, entity, kind);
    if (forbidden) { c.jobProblem = { kind, reason: forbidden }; continue; }
    if (hungry && good === 'gems') continue;
    if (hungry && (mineralDeposit(target) || good === 'wood' || good === 'stone' || good === 'commonMetal' || good === 'tools' || good === 'stoneAxes')) continue;
    if (!mineralDeposit(target) && workers.some(e => e.components.citizen!.targetId === target.id)) continue;
    if (orderId !== undefined) {
      if (startCraft(world, entity, world.crafting.orders.find(o => o.id === orderId)!, target)) return true;
      continue;
    }
    const path = target.components.foodPlant || target.components.resourcePile || target.components.tree || mineralDeposit(target) || target.components.gemSource ? storageRoute(world, entity.components.position!, target) : findPath(world, entity.components.position!, target.components.position!, 1.8);
    if (path === undefined) { c.jobProblem = { kind, reason: 'No route to the target' }; if (target.components.tree) economyOf(village).forestProblem = 'No reachable tree'; continue; }
    const batch = target.components.animal ? deathGoods(world, target) : isCrafted(good) && !target.components.resourcePile && !mineralDeposit(target) ? recipes[good].outputs : sourceContents(target) ?? { meat: 1 };
    if (!deliveryStore(world, village, path.at(-1) ?? entity.components.position!, batch, isCrafted(good) || !!target.components.animal)) {
      c.jobProblem = { kind, reason: 'Storage is full' }; continue;
    }
    if (target.components.gemSource && !deliveryStore(world, village, path.at(-1) ?? entity.components.position!, gemProfile(target.components.gemSource).outputs, true)) continue;
    if (target.components.tree && !deliveryStore(world, village, path.at(-1) ?? entity.components.position!, treeYield(target), true)) {
      economyOf(village).forestProblem = 'No storage space for the whole harvest'; continue;
    }
    if (isCrafted(good) && !target.components.resourcePile && !reserveGoods(world, village, recipes[good].inputs, entity.id, entity.components.position!)) continue;
    if (mineralDeposit(target)) {
      const amount = depositBatch(world, target, entity.id);
      if (!amount) { miningReason = 'Deposit batch is reserved'; continue; }
      if (!deliveryStore(world, village, path.at(-1) ?? entity.components.position!, depositContents(mineralDeposit(target)!, amount), true)) {
        miningReason = 'No storage space for the whole batch'; continue;
      }
    }
    releaseTreeClaim(world, entity.id);
    releaseDepositClaim(world, entity.id);
    if (target.components.tree && !reserveTree(world, target, entity)) continue;
    if (mineralDeposit(target) && !reserveDeposit(world, target, entity)) { miningReason = 'Deposit batch is reserved'; continue; }
    if (!claimJob(world, entity, kind, target.id, good)) {
      releaseReservation(village, entity.id); releaseTreeClaim(world, entity.id); releaseDepositClaim(world, entity.id); continue;
    }
    c.task = 'work'; c.targetId = target.id; c.path = path; c.repair = null; c.reconsiderIn = 2;
    c.work = { good, progress: 0, cargo: null, ...(isCrafted(good) && !target.components.resourcePile ? { reservation: { villageId: village.id, inputs: { ...recipes[good].inputs } } } : {}) };
    if (target.components.tree) delete economyOf(village).forestProblem;
    return kind === 'hunter' || enterBehaviour(world, entity, 'gather', 'approach');
  }
  if (assignMineWork(world, entity, village)) return true;
  c.work = { good: needsGold ? 'gold' : needsBone ? 'bone' : needsSilver ? 'silver' : 'stone', progress: 0, cargo: null, waiting: miningReason };
  return false;
}
