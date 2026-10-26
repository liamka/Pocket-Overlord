import type { Registry } from './registry';
import type { Animal, Workplace } from '../core/village-life';
import { GOODS } from '../core/village-life';
import { bundleLoad, canConsume, entries, isResource, RESIDENT_DIET, validBundle, type ResourceBundle } from '../core/resources';
import { cargoContents, isCrafted, RECIPES } from '../core/resource-ledger';
import type { Cargo } from '../core/village-life';
import { bool, integer, number, point, record, reference, type RecordValue } from '../core/validation';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { FOREST_POLICIES, FOREST_PROBLEMS } from '../core/forestry';
import { MINING_REASONS } from '../core/deposits';
import { MINE } from '../core/mines';

declare module '../core/types' {
  interface ComponentMap { animal: Animal; workplace: Workplace }
}

export function validWork(value: unknown): boolean {
  if (value === undefined) return true;
  if (!record(value) || !isResource(value.good) || !number(value.progress, 0, 4)) return false;
  if (value.mine !== undefined && (!record(value.mine) || value.good !== 'stone'
    || value.progress > 1
    || !integer(value.mine.duration, MINE.minTicks, MINE.maxTicks)
    || value.mine.enteredAt !== null && !integer(value.mine.enteredAt))) return false;
  if (value.waiting !== undefined && !MINING_REASONS.some(reason => reason === value.waiting)) return false;
  if (value.orderId !== undefined && (!integer(value.orderId, 1) || value.good !== 'stoneAxes')) return false;
  const cargo = value.cargo, r = value.reservation;
  if (cargo !== null && (!record(cargo) || !isResource(cargo.good) || !number(cargo.amount, 1e-8, 12) || !integer(cargo.villageId, 1)
    || cargo.good === 'gold' && !integer(cargo.amount, 1, 12)
    || cargo.byproducts !== undefined && (!validBundle(cargo.byproducts, 12) || Object.hasOwn(cargo.byproducts, cargo.good))
    || bundleLoad(cargoContents(cargo as unknown as Cargo)).weight > 36 || bundleLoad(cargoContents(cargo as unknown as Cargo)).volume > 24)) return false;
  if (r !== undefined) {
    if (!record(r) || !integer(r.villageId, 1) || !validBundle(r.inputs, 12, false) || cargo !== null || !isCrafted(value.good)) return false;
    const inputs = RECIPES[value.good].inputs;
    if (value.orderId === undefined && (Object.keys(r.inputs).length !== Object.keys(inputs).length || !Object.entries(inputs).every(([id, n]) => (r.inputs as RecordValue)[id] === n))) return false;
  }
  return true;
}

export function validIntegration(value: unknown): boolean {
  if (value === undefined) return true;
  return record(value) && integer(value.villageId, 1) && integer(value.groupId, 1) && integer(value.arrived)
    && ['settling', 'settled', 'isolated'].includes(String(value.status)) && number(value.belonging, 0, 100) && bool(value.worked)
    && reference(value.friendId) && reference(value.contactId) && number(value.contact, 0, 10)
    && integer(value.socialAfter) && integer(value.socialUntil) && integer(value.leaveAfter);
}

export function validVillageLife(v: RecordValue): boolean {
  const e = v.economy, g = v.government, livestock = v.livestock;
  return (e === undefined || record(e) && validBundle(e.stocks) && !Object.hasOwn(e.stocks, 'provisions') && GOODS.every(good => number((e.stocks as RecordValue)[good], 0, 2000))
    && (e.forestPolicy === undefined || typeof e.forestPolicy === 'string' && Object.hasOwn(FOREST_POLICIES, e.forestPolicy))
    && (e.forestProblem === undefined || FOREST_PROBLEMS.some(reason => reason === e.forestProblem))
    && (e.metalworking === undefined || integer(e.metalworking, 0, 1000000))
    && entries(e.stocks).reduce((sum, [id, n]) => sum + (canConsume(id, RESIDENT_DIET) ? n : 0), 0) <= Number(v.food) + 1e-8
    && (e.storage === undefined || Array.isArray(e.storage) && e.storage.length <= 6000 && e.storage.every(s => record(s)
      && integer(s.buildingId, 1) && number(s.capacity, 1, 200000) && validBundle(s.limits) && validBundle(s.goods)
      && (s.equipmentVolume === undefined || integer(s.equipmentVolume))
      && bundleLoad(s.goods).volume + Number(s.equipmentVolume ?? 0) <= Number(s.capacity) + 1e-8
      && (!Object.keys(s.limits).length || entries(s.goods).every(([id, n]) => n <= ((s.limits as ResourceBundle)[id] ?? 0)))
      && Array.isArray(s.reservations) && s.reservations.length <= 6000 && s.reservations.every(r => record(r) && integer(r.claimant, 1) && validBundle(r.goods, 2000, false))))
    && (e.lost === undefined || validBundle(e.lost, 1e12)) && (e.spent === undefined || validBundle(e.spent, 1e12)) && integer(e.deliveries) && integer(e.buildAfter))
    && (g === undefined || record(g) && reference(g.leaderId) && number(g.trust, 0, 100) && integer(g.electedAt) && integer(g.electionAt) && integer(g.lastHarvest) && integer(g.elections))
    && (livestock === undefined || record(livestock) && bool(livestock.established) && integer(livestock.threatAfter));
}

export function registerVillageLife(registry: Registry): void {
  registry.registerComponent('animal', a => ['sheep', 'dog', 'wolf'].includes(String(a.kind)) && reference(a.villageId) && reference(a.ownerId)
    && (a.parents === undefined || Array.isArray(a.parents) && a.parents.length <= 2 && a.parents.every(id => integer(id, 1)) && new Set(a.parents).size === a.parents.length)
    && (a.kind !== 'wolf' || a.ownerId === null && a.villageId === null) && number(a.age, 0, 10000) && number(a.hunger, 0, 100)
    && number(a.breedIn, 0, 120) && number(a.produceIn, 0, 30) && number(a.attackIn, 0, 2) && number(a.decisionIn, 0, 2)
    && reference(a.targetId) && Array.isArray(a.path) && a.path.length <= WORLD_WIDTH * WORLD_HEIGHT && a.path.every(point)
    && number(a.heading, -Math.PI, Math.PI) && number(a.stride, 0, Math.PI * 2) && bool(a.moving));
  registry.registerComponent('workplace', w => ['market', 'mill', 'bakery', 'workshop'].includes(String(w.kind)) && reference(w.villageId));
  for (const kind of ['sheep', 'dog', 'wolf'] as const) {
    const health = kind === 'sheep' ? 35 : kind === 'dog' ? 65 : 45;
    registry.registerEntity({ id: `core:${kind}`, sprite: kind, create: p => ({
      position: { ...p }, health: { current: health, max: health }, combustible: { fuel: 12, ignition: 36 },
      thermal: { temperature: 0, wetness: 0, burning: false },
      animal: { kind, villageId: null, ownerId: null, age: 20, hunger: 20, breedIn: 90, produceIn: 25,
        attackIn: 0, decisionIn: 0, targetId: null, path: [], heading: 0, stride: 0, moving: false },
    }) });
  }
  for (const kind of ['market', 'mill', 'bakery', 'workshop'] as const) registry.registerEntity({ id: `core:${kind}`, sprite: kind, create: p => ({
    position: { ...p }, health: { current: 140, max: 140 }, combustible: { fuel: 45, ignition: 38 },
    thermal: { temperature: 0, wetness: 0, burning: false }, solid: { radius: 1.1 }, workplace: { kind, villageId: null },
  }) });
}
