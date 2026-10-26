import { canSpend, payWork, spendMoney, walletOf } from '../core/currency';
import { isAdult } from '../core/unit-stats';
import { activeOrder, CRAFTING, craftedModifiers, metalRecipeAllowed, modifierTries, needsRecipe, orderForWorker, type CraftOrder, type CraftReason } from '../core/crafting';
import { isCommonMetalMaterial, metalExperience } from '../core/common-metals';
import { EQUIPMENT, equipmentScore } from '../core/equipment-catalog';
import { carriedItems, createItem, equipmentDelivery } from '../core/equipment';
import { operational } from '../core/buildings';
import { availableStock, canAfford } from '../core/resource-ledger';
import { housingWoodReserve } from '../core/forestry';
import { housingStoneReserve } from '../core/deposits';
import { GEMS } from '../core/gems';
import { clearStorageApproach, consumeReservation, deliveryStore, releaseReservation, reserveGoods, storageRoute, storesOf } from '../core/stockpiles';
import { entries } from '../core/resources';
import { economyOf, residentName } from '../core/village-life';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { cancelJob, claimJob, jobEligibility, releaseJob } from '../core/jobs';

export function cancelCraft(world: World, order: CraftOrder, reason: CraftReason = 'cancelled'): void {
  if (order.paid || !activeOrder(order)) return;
  const worker = world.entities.get(order.workerId ?? -1), c = worker?.components.citizen;
  // A reassigned worker may already hold a different job's reservation under the same entity id.
  if (!c?.work?.reservation || c.work.orderId === order.id)
    for (const v of world.society.villages) if (order.workerId !== null) releaseReservation(v, order.workerId);
  if (c?.work?.orderId === order.id) {
    releaseJob(worker!);
    delete c.work;
    if (c.task === 'work') Object.assign(c, { task: 'idle', targetId: null, path: [], reconsiderIn: 0 });
  }
  order.state = 'cancelled'; order.reason = reason;
}
function invalidRecipient(world: World, order: CraftOrder): CraftReason | undefined {
  if (!metalRecipeAllowed(world, order.villageId, order.recipe)) return 'knowledge';
  if (order.recipientId === null) return;
  const e = world.entities.get(order.recipientId), c = e?.components.citizen;
  if (!e?.components.person || !isAdult(e) || !c || c.villageId !== order.villageId || c.task === 'migrate') return 'recipient';
  if (!needsRecipe(world, e, order.recipe)) return 'replacement';
  const home = world.entities.get(order.homeId ?? -1);
  if (order.homeId !== null && (!home?.components.dwelling || !operational(home) || home.components.thermal?.burning)) return 'unsafe';
}
function workerProblem(world: World, worker: Entity, order: CraftOrder): CraftReason | undefined {
  const c = worker.components.citizen, p = worker.components.position, station = world.entities.get(order.workplaceId ?? -1);
  if (!c || !worker.components.person || !isAdult(worker) || c.villageId !== order.villageId) return 'worker';
  if (jobEligibility(world, worker, 'blacksmith')) return 'worker';
  if (c.hunger >= 70) return 'hunger';
  if (c.emergency || worker.components.person.madness || worker.components.thermal?.burning || !p || !world.terrain.isLand(p.x, p.y)) return 'unsafe';
  if (!station || !operational(station) || station.components.thermal?.burning || station.components.workplace?.kind !== 'workshop'
    || station.components.workplace.villageId !== order.villageId) return 'access';
}
export function startCraft(world: World, worker: Entity, order: CraftOrder, workplace: Entity): boolean {
  const c = worker.components.citizen, village = world.society.villages.find(v => v.id === order.villageId);
  if (world.paused || !c || !village || order.state !== 'waiting' || c.work?.cargo || carriedItems(world, worker.id).length || c.work?.orderId !== undefined
    || order.inputs.gems && world.crafting.orders.some(o => o.villageId === order.villageId && o.state === 'working' && !!o.inputs.gems)
    || [...world.query('citizen')].some(e => e.id !== worker.id && e.components.citizen!.task === 'work' && e.components.citizen!.targetId === workplace.id)
    || world.crafting.orders.some(o => o.state === 'working' && (o.workerId === worker.id || o.workplaceId === workplace.id))) return false;
  const recipient = world.entities.get(order.recipientId ?? -1);
  if (recipient) {
    const requested = EQUIPMENT[order.recipe];
    const best = Object.values(EQUIPMENT).filter(d => d.slot === order.slot && d.kind === requested.kind
      // New metal skills must not get stuck behind an older order for an unavailable rare material.
      // An already selected silver recipe waits for silver; only a real upgrade may replace it.
      && (equipmentScore(d.id) >= equipmentScore(order.recipe) || requested.material !== 'silver' && isCommonMetalMaterial(d.material))
      && (d.recipe.available || d.id === order.recipe) && metalRecipeAllowed(world, village.id, d.id)
      && needsRecipe(world, recipient, d.id) && canAfford(world, village, d.recipe.inputs, worker.id))
      .sort((a, b) => equipmentScore(b.id) - equipmentScore(a.id) || b.value - a.value || a.id.localeCompare(b.id, 'en'))[0];
    if (best) { order.recipe = best.id; order.inputs = { ...best.recipe.inputs }; order.coins = best.recipe.coins; }
  }
  const problem = invalidRecipient(world, order);
  if (problem) { cancelCraft(world, order, problem); return false; }
  order.workplaceId = workplace.id;
  const blocked = workerProblem(world, worker, order);
  if (blocked) { order.reason = blocked; return false; }
  if (order.coins === null || order.coins > 0 && (!recipient || !canSpend(world, recipient, order.coins))) { order.reason = 'money'; return false; }
  const path = storageRoute(world, worker.components.position!, workplace);
  if (path === undefined) { order.reason = 'access'; return false; }
  if (!canAfford(world, village, order.inputs, worker.id)) { order.reason = 'materials'; return false; }
  if (order.inputs.wood && availableStock(world, village, 'wood', worker.id) - order.inputs.wood < housingWoodReserve(world, village)) { order.reason = 'housing'; return false; }
  if (order.inputs.stone && availableStock(world, village, 'stone', worker.id) - order.inputs.stone < housingStoneReserve(world, village)) { order.reason = 'housing'; return false; }
  // Every ingredient must also be accessible from the workplace, where it is consumed.
  if (!reserveGoods(world, village, order.inputs, worker.id, path.at(-1) ?? worker.components.position!)) { order.reason = 'access'; return false; }
  if (!claimJob(world, worker, 'blacksmith', workplace.id, 'stoneAxes')) { releaseReservation(village, worker.id); order.reason = 'worker'; return false; }
  order.workerId = worker.id; order.tries = modifierTries(worker, order.mastery); order.state = 'working'; order.reason = 'working';
  if (order.inputs.gems) order.reservedUntil = world.tick + GEMS.reservationTicks;
  Object.assign(c, { task: 'work', targetId: workplace.id, path, repair: null, reconsiderIn: 2,
    work: { good: 'stoneAxes', progress: order.progress, cargo: null, orderId: order.id, reservation: { villageId: village.id, inputs: { ...order.inputs } } } });
  return true;
}
export function continueCraft(world: World, worker: Entity): boolean {
  const order = orderForWorker(world, worker), c = worker.components.citizen!;
  if (!order || order.state !== 'working' || world.paused) return false;
  if (!claimJob(world, worker, 'blacksmith', order.workplaceId, 'stoneAxes')) { cancelJob(world, worker, 'No available workers'); return false; }
  if (order.reservedUntil !== undefined && world.tick >= order.reservedUntil) { cancelCraft(world, order, 'access'); return false; }
  const problem = invalidRecipient(world, order) ?? workerProblem(world, worker, order);
  if (problem) { cancelCraft(world, order, problem); return false; }
  const station = world.entities.get(order.workplaceId!)!, village = world.society.villages.find(v => v.id === order.villageId);
  if (!village || c.task !== 'work' || c.targetId !== station.id) { cancelCraft(world, order, 'worker'); return false; }
  if (!deliveryStore(world, village, worker.components.position!, { stoneAxes: 1 }, true)) { cancelJob(world, worker, 'Storage is full'); return false; }
  if (order.inputs.wood && availableStock(world, village, 'wood', worker.id) - order.inputs.wood < housingWoodReserve(world, village)) { cancelCraft(world, order, 'housing'); return false; }
  if (order.inputs.stone && availableStock(world, village, 'stone', worker.id) - order.inputs.stone < housingStoneReserve(world, village)) { cancelCraft(world, order, 'housing'); return false; }
  if (c.path.length || !clearStorageApproach(world, worker.components.position!, station)) {
    if (c.reconsiderIn <= 0 || !c.path.length) {
      const path = storageRoute(world, worker.components.position!, station);
      if (path === undefined) { cancelCraft(world, order, 'access'); return false; }
      c.path = path; c.reconsiderIn = 2;
    }
    return true;
  }
  // Revalidate access without moving or expanding this order's reservation.
  const reserved = storesOf(village).filter(s => s.reservations.some(r => r.claimant === worker.id));
  if (!reserved.length || reserved.some(s => {
    const store = world.entities.get(s.buildingId);
    return !store || store.components.thermal?.burning || storageRoute(world, worker.components.position!, store) === undefined;
  })) { cancelCraft(world, order, 'access'); return false; }
  order.progress = Math.min(CRAFTING.work, order.progress + 0.5); c.work!.progress = order.progress;
  if (worker.components.person?.animation) worker.components.person.animation.work = order.progress % 1;
  if (order.progress < EQUIPMENT[order.recipe].recipe.work) return true;
  const recipient = world.entities.get(order.recipientId ?? -1), cost = order.coins ?? 0;
  if (cost > 0 && (!recipient || !canSpend(world, recipient, cost) || walletOf(world, recipient).completed.craft === world.tick)) {
    cancelCraft(world, order, 'money'); return false;
  }
  if (!consumeReservation(village, worker.id, order.inputs)) { cancelCraft(world, order, 'materials'); return false; }
  // Synchronous commit: after these checks no other order can spend the same coins.
  if (recipient) spendMoney(world, recipient, cost, 'craft');
  order.paid = true;
  payWork(world, worker, 'production');
  const item = createItem(world, order.recipe, { kind: 'carried', entityId: worker.id, villageId: village.id }, { id: worker.id, name: residentName(worker.id, world) }, craftedModifiers(order));
  if (EQUIPMENT[order.recipe].material === 'silver' || isCommonMetalMaterial(EQUIPMENT[order.recipe].material)) economyOf(village).metalworking = Math.min(1000000, metalExperience(village) + 1);
  // Original, language-neutral proper name; the recipe and quality labels are localized in the inspector.
  item.name = `${residentName(worker.id, world)} · ${order.id}`;
  item.origin = { kind: 'crafted', orderId: order.id, villageId: village.id, workplaceId: station.id, recipientId: order.recipientId };
  order.resultId = item.id; order.state = 'delivering'; order.reason = 'delivery'; delete c.work!.reservation;
  const destination = equipmentDelivery(world, worker);
  Object.assign(c, { task: destination ? 'deliver' : 'idle', targetId: destination?.building.id ?? null, path: destination?.path ?? [], reconsiderIn: 2 });
  if (destination && c.jobAssignment) Object.assign(c.jobAssignment, { phase: 'deliver', targetId: destination.building.id });
  else releaseJob(worker, 'Storage is full');
  if (!destination) order.reason = 'storage';
  return true;
}
/** Also runs at snapshot boundaries so interrupted jobs cannot retain spendable claims. */
export function maintainCrafting(world: World): void {
  for (const o of world.crafting.orders) {
    if (!activeOrder(o)) continue;
    if (!o.paid && o.state === 'working' && o.reservedUntil !== undefined && world.tick >= o.reservedUntil) { cancelCraft(world, o, 'access'); continue; }
    if (o.paid) {
      const item = world.equipment.items.find(i => i.id === o.resultId);
      if (!item || item.location.kind !== 'carried') {
        o.state = 'completed'; o.reason = 'complete';
        const work = world.entities.get(o.workerId ?? -1)?.components.citizen?.work;
        if (work?.orderId === o.id) delete work.orderId;
      }
      continue;
    }
    const invalid = invalidRecipient(world, o);
    if (invalid || !world.society.villages.some(v => v.id === o.villageId)) { cancelCraft(world, o, invalid ?? 'recipient'); continue; }
    if (o.state === 'working') {
      const e = world.entities.get(o.workerId!), c = e?.components.citizen;
      const problem = e ? workerProblem(world, e, o) : 'worker';
      const village = world.society.villages.find(v => v.id === o.villageId)!;
      const held: Record<string, number> = {};
      for (const s of storesOf(village)) for (const r of s.reservations) if (r.claimant === o.workerId)
        for (const [id, n] of entries(r.goods)) held[id] = (held[id] ?? 0) + n;
      if (problem || c?.work?.orderId !== o.id || c.task !== 'work' || c.targetId !== o.workplaceId
        || entries(o.inputs).some(([id, n]) => held[id] !== n)) cancelCraft(world, o, problem ?? 'worker');
    } else {
      const village = world.society.villages.find(v => v.id === o.villageId)!;
      const recipient = world.entities.get(o.recipientId ?? -1);
      o.reason = o.coins === null || o.coins > 0 && (!recipient || !canSpend(world, recipient, o.coins)) ? 'money'
        : !canAfford(world, village, o.inputs) ? 'materials'
        : o.inputs.wood && availableStock(world, village, 'wood') - o.inputs.wood < housingWoodReserve(world, village) ? 'housing'
        : ![...world.query('workplace')].some(e => e.components.workplace!.villageId === o.villageId && e.components.workplace!.kind === 'workshop' && operational(e) && !e.components.thermal?.burning) ? 'access' : 'worker';
    }
  }
  const history = world.crafting.orders.filter(o => !activeOrder(o));
  if (history.length > CRAFTING.history) {
    const removed = new Set(history.slice(0, -CRAFTING.history).map(o => o.id));
    world.crafting.orders = world.crafting.orders.filter(o => !removed.has(o.id));
  }
}
