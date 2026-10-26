import { FOOD_RECIPES, isDish } from '../content/food-catalog';
import { canCook } from './food';
import { roadWorks, roadWorkProblem } from './roads';
import { lawEnabled, newWorldRules } from './world-rules';
import { leaveMine, mineDemand, MINE } from './mines';
import { GOLD } from './gold';
import { territoryOwner, ownsPosition } from './territory';
import { isAdult } from './unit-stats';
import type { Entity, Village, WorldSnapshot } from './types';
import type { World } from './world';
import { buildingOwner, operational } from './buildings';
import { capabilitiesOf } from './capabilities';
import { cancelBehaviour } from './behaviour';
import { FOREST_POLICIES, releaseTreeClaim, treeOwner, treeProblem } from './forestry';
import { mineralDeposit, releaseDepositClaim, stoneTarget } from './deposits';
import { SILVER } from './silver';
import { BONE } from './bone';
import { LEATHER } from './leather';
import { huntable, huntCandidate, needsLeather } from './hunting';
export { huntable } from './hunting';
import { missingGems } from './gems';
import { carriedItems } from './equipment';
import { releaseReservation, storageRoom, storesOf } from './stockpiles';
import { inTransit, stockOf } from './resource-ledger';
import { seasonAt } from './seasons';
import { integer, record, reference } from './validation';
import { isResource, SOURCE_PROFILES, type ResourceId } from './resources';

/** Local worker limits; source: Jobs, revision 22322. These are not WorldBox balance values. */
export const JOBS = {
  blacksmith: 'Blacksmith', builder: 'Builder', cleaner: 'Ruin cleaner', manureCleaner: 'Manure cleaner',
  farmer: 'Farmer', firefighter: 'Firefighter', bushGatherer: 'Berry gatherer', herbGatherer: 'Herb gatherer',
  honeyGatherer: 'Honey gatherer', hunter: 'Hunter', miner: 'Mine worker', depositMiner: 'Deposit miner',
  roadBuilder: 'Road worker', woodcutter: 'Woodcutter', miller: 'Miller', baker: 'Baker', collector: 'Remains collector',
} as const;
export type JobKind = keyof typeof JOBS;
const unavailableJobs: readonly JobKind[] = ['manureCleaner', 'honeyGatherer'];
const maximumSlots: Partial<Record<JobKind, number>> = { builder: 3, cleaner: 1, firefighter: 4, hunter: 1, miner: 5, depositMiner: 2, roadBuilder: 1, woodcutter: 2, collector: 3 };
/** Political office and military service are independent of the current action. */
export interface Profession { villageId: number | null; office: 'resident' | 'leader' | 'king'; service: 'civilian' | 'warrior' | 'captain' }
export interface JobAssignment {
  kind: JobKind; villageId: number; targetId: number | null; tile: number | null;
  /** A slot is unique within one village/job, including the journey to work. */
  slot: number; phase: 'approach' | 'operate' | 'deliver'; assignedAt: number; output?: ResourceId;
}
export const JOB_REASONS = ['No work needed', 'No suitable source', 'No suitable workplace', 'No available workers',
  'Workers are busy', 'Job slots are occupied', 'Storage is full', 'Military service', 'Ruler duties', 'Too young to work',
  'Worker needs food', 'Workplace changed owner', 'No route to the target', 'Target is no longer available',
  'Responding to danger', 'Materials are missing', 'Winter stops field work', 'No manure to collect',
  'No fertilizer available', 'No mine available', 'Food takes priority', 'Waiting for a worker', 'Breeding herd is protected'] as const;
export type JobReason = typeof JOB_REASONS[number];
export interface JobProblem { kind: JobKind; reason: JobReason }
export interface JobVacancy { kind: JobKind; limit: number; filled: number; shortage: number; reason?: JobReason }

export function professionOf(world: Pick<World, 'society' | 'worldRules'>, entity: Entity): Profession {
  const c = entity.components.citizen!;
  const village = world.society.villages.find(v => v.id === c.villageId);
  const prior = c.profession?.villageId === c.villageId ? c.profession : undefined;
  const office = village?.government?.leaderId === entity.id ? 'leader' : prior?.office === 'king' ? 'king' : 'resident';
  // Use the existing campaign's selection; no army, captain selection or culture is created here.
  const serving = lawEnabled(world, 'armies') && !!village
    && world.society.wars.some(w => w.attackers.includes(village.id) || w.defenders.includes(village.id))
    && c.task !== 'migrate' && !entity.components.person?.madness && isAdult(entity)
    && (entity.id % 3 !== 0 || prior?.service === 'captain')
    && (prior?.service === 'warrior' || prior?.service === 'captain'
      || stockOf(village, 'gold') > GOLD.recruitThreshold && village.food >= GOLD.recruitFood
        && !c.work?.cargo && !c.jobAssignment && !c.emergency && c.task !== 'build' && c.task !== 'deliver');
  return { villageId: village?.id ?? null, office, service: serving ? prior?.service === 'captain' ? 'captain' : 'warrior' : 'civilian' };
}
export function jobEligibility(world: World, entity: Entity, kind: JobKind): JobReason | undefined {
  const c = entity.components.citizen, person = entity.components.person;
  if (!c || !person || !isAdult(entity)) return 'Too young to work';
  if (!capabilitiesOf(world.registry, entity)?.citizenship || person.madness || c.task === 'migrate') return 'No available workers';
  const role = professionOf(world, entity);
  if (role.service !== 'civilian') return 'Military service';
  if (role.office !== 'resident' && ['farmer', 'miner', 'depositMiner'].includes(kind)) return 'Ruler duties';
  if (c.hunger >= (kind === 'firefighter' ? 80 : 70)) return 'Worker needs food';
  if (entity.components.thermal?.burning || c.emergency && kind !== 'firefighter') return 'Responding to danger';
}
export const hasCivilianService = (world: World, entity: Entity): boolean => !!capabilitiesOf(world.registry, entity)?.citizenship && professionOf(world, entity).service === 'civilian';

export function productionJob(target: Entity, good: ResourceId): JobKind {
  if (target.components.foodPlant) return target.components.foodPlant.good === 'berries' ? 'bushGatherer' : 'herbGatherer';
  if (target.components.mine) return 'miner';
  if (target.components.animal) return 'hunter';
  if (target.components.resourcePile) return 'collector';
  if (mineralDeposit(target) || target.components.gemSource) return 'depositMiner';
  if (target.components.tree) return 'woodcutter';
  if (target.components.farm) return 'farmer';
  return good === 'flour' ? 'miller' : good === 'bread' || isDish(good) ? 'baker' : 'blacksmith';
}
export const constructionJob = (target: Entity): JobKind => target.components.building?.project?.action === 'clear' ? 'cleaner' : 'builder';
export function supplyTarget(world: World, village: Village, good: ResourceId): number {
  const base = good === 'gold' ? GOLD.stockTarget : good === 'stone' ? stoneTarget(world, village) : good === 'silver' ? SILVER.stockTarget : good === 'bone' ? BONE.stockTarget
    : good === 'leather' ? LEATHER.stockTarget
    : good === 'wood' || good === 'commonMetal' ? 12 : good === 'gems' ? stockOf(village, 'gems') + missingGems(world, village) : 0;
  const construction = [...world.query('building')].reduce((sum, e) => sum + (buildingOwner(e) === village.id && e.components.building!.project
    && !e.components.building!.project!.paid ? e.components.building!.project!.cost[good] ?? 0 : 0), 0);
  const recipes = world.crafting.orders.filter(o => o.villageId === village.id && !o.paid && ['waiting', 'working'].includes(o.state));
  return Math.max(base, construction, ...recipes.map(o => o.inputs[good] ?? 0));
}
function demand(world: World, village: Village, kind: JobKind): { limit: number; reason?: JobReason } {
  const adults = [...world.query('person', 'citizen')].filter(e => e.components.citizen!.villageId === village.id && isAdult(e)).length;
  const hungry = village.food < Math.max(1, adults) * 2;
  const nearby = (): Entity[] => world.nearby(village, 28);
  const buildings = (): Entity[] => [...world.query('building')].filter(e => buildingOwner(e) === village.id);
  const stationCount = (station: string): number => [...world.query('workplace')].filter(e => e.components.workplace!.villageId === village.id
    && e.components.workplace!.kind === station && operational(e) && !e.components.thermal?.burning).length;
  const result = (limit: number, reason: JobReason = 'No work needed') => ({ limit, ...(!limit ? { reason } : {}) });
  // Unsupported sources stay unavailable, including profiles whose producers do not exist yet.
  if (kind === 'manureCleaner') return result(0, 'No manure to collect');
  if (kind === 'miner') {
    const mines = buildings().filter(e => e.components.mine);
    const limit = Math.min(MINE.slots, mines.reduce((n, e) => n + mineDemand(world, e, village).limit, 0));
    return result(limit, !mines.length ? 'No mine available' : hungry ? 'Food takes priority' : 'No work needed');
  }
  if (kind === 'honeyGatherer') return result(0, 'No suitable source');
  if (kind === 'bushGatherer' || kind === 'herbGatherer') {
    const sources = nearby().filter(e => e.components.foodPlant?.remaining && productionJob(e, e.components.foodPlant.good) === kind
      && storageHasRoom(world, village, e.components.foodPlant.good) && stockOf(village, e.components.foodPlant.good) < 24);
    return result(sources.length ? Math.min(2, sources.length) : 0, 'No suitable source');
  }
  if (kind === 'firefighter') return result(Math.min(4, nearby().filter(e => e.components.thermal?.burning && !e.components.explosive
    && (buildingOwner(e) === village.id || e.components.citizen?.villageId === village.id || buildingOwner(e) === null && !e.components.citizen)).length * 2));
  if (kind === 'builder' || kind === 'cleaner') return result(Math.min(kind === 'cleaner' ? 1 : 3, buildings().filter(e => e.components.building?.project
    && constructionJob(e) === kind).length * 2));
  if (kind === 'roadBuilder') return result(world.society.roads.some(r => (r.a === village.id || r.b === village.id)
    && roadWorks(world, r).some(job => !roadWorkProblem(world, job))) ? 1 : 0);
  if (kind === 'farmer') {
    if (seasonAt(world.tick).growth === 0) return result(0, 'Winter stops field work');
    if (!storageHasRoom(world, village, 'provisions') && !storageHasRoom(world, village, 'grain')) return result(0, 'Storage is full');
    if (village.food >= Math.max(30, adults * 8) && stockOf(village, 'grain') >= 24) return result(0);
    const fields = [...world.query('farm')].filter(e => e.components.farm!.villageId === village.id && operational(e) && !e.components.thermal?.burning);
    return result(Math.min(fields.length * 2, Math.max(1, Math.ceil(adults / (hungry ? 2 : 4)))), fields.length ? 'No work needed' : 'No suitable workplace');
  }
  if (kind === 'miller' || kind === 'baker') {
    const count = stationCount(kind === 'miller' ? 'mill' : 'bakery');
    if (!count) return result(0, 'No suitable workplace');
    if (kind === 'baker' && Object.entries(FOOD_RECIPES).some(([good, recipe]) => stockOf(village, good as ResourceId) < 6
      && storageHasRoom(world, village, good as ResourceId) && Object.entries(recipe.inputs).every(([id, n]) => stockOf(village, id as ResourceId) >= n)
      && [...world.query('citizen')].some(e => e.components.citizen!.villageId === village.id && canCook(e, good)))) return result(count);
    const output = kind === 'miller' ? 'flour' : 'bread', input = kind === 'miller' ? 'grain' : 'flour';
    if (!storageHasRoom(world, village, output)) return result(0, 'Storage is full');
    if (stockOf(village, output) + (inTransit(world, village.id)[output] ?? 0) >= (kind === 'miller' ? 12 : 30)) return result(0);
    return result(stockOf(village, input) >= 2 ? count : 0, 'Materials are missing');
  }
  if (kind === 'blacksmith') {
    const count = stationCount('workshop');
    if (!count) return result(0, 'No suitable workplace');
    if (!storageHasRoom(world, village, 'tools') && !storageHasRoom(world, village, 'stoneAxes')) return result(0, 'Storage is full');
    return result(stockOf(village, 'tools') + (inTransit(world, village.id).tools ?? 0) < 8
      || world.crafting.orders.some(o => o.villageId === village.id && ['waiting', 'working'].includes(o.state)) ? count : 0);
  }
  if (kind === 'woodcutter') {
    if (village.food < adults) return result(0, 'Food takes priority');
    if (!storageHasRoom(world, village, 'wood')) return result(0, 'Storage is full');
    if (stockOf(village, 'wood') + (inTransit(world, village.id).wood ?? 0) >= supplyTarget(world, village, 'wood')
      && stockOf(village, 'commonMetal') >= supplyTarget(world, village, 'commonMetal') && missingGems(world, village) === 0) return result(0);
    const trees = nearby().filter(e => e.components.tree && treeOwner(world, e)?.id === village.id && !treeProblem(e));
    const policy = FOREST_POLICIES[village.economy?.forestPolicy ?? 'balanced'];
    return result(trees.length > policy.trees ? Math.min(trees.length - policy.trees, policy.workers, stockOf(village, 'wood') > 15 ? 1 : 3) : 0, 'No suitable source');
  }
  if (kind === 'depositMiner') {
    if (village.food < adults) return result(0, 'Food takes priority');
    const sources = nearby().filter(e => mineralDeposit(e) || e.components.gemSource);
    if (!sources.length) return result(0, 'No suitable source');
    const incoming = inTransit(world, village.id);
    const needed = sources.filter(e => {
      const deposit = mineralDeposit(e), good = deposit ? SOURCE_PROFILES[deposit.profile].primary : 'gems';
      return stockOf(village, good) + (incoming[good] ?? 0) < supplyTarget(world, village, good);
    });
    if (!needed.length) return result(0);
    if (!needed.some(e => storageHasRoom(world, village, mineralDeposit(e) ? SOURCE_PROFILES[mineralDeposit(e)!.profile].primary : 'gems'))) return result(0, 'Storage is full');
    return result(Math.max(1, Math.min(2, Math.floor(adults / 3))));
  }
  if (kind === 'collector') {
    if (!storageHasRoom(world, village, 'meat') && !storageHasRoom(world, village, 'bone') && !storageHasRoom(world, village, 'leather')) return result(0, 'Storage is full');
    return result(nearby().some(e => e.components.resourcePile) ? Math.min(3, Math.max(1, Math.ceil(adults / (hungry ? 3 : 8)))) : 0, 'No suitable source');
  }
  if (!(hungry || needsLeather(world, village))) return result(0);
  if (!storageHasRoom(world, village, hungry ? 'meat' : 'leather')) return result(0, 'Storage is full');
  const candidates = nearby().filter(e => huntCandidate(world, village, e));
  return result(candidates.some(e => huntable(world, village, e)) ? 1 : 0, candidates.length ? 'Breeding herd is protected' : 'No suitable source');
}
export function jobVacancy(world: World, village: Village, kind: JobKind): JobVacancy {
  const need = demand(world, village, kind);
  const residents = [...world.query('person', 'citizen')].filter(e => e.components.citizen!.villageId === village.id);
  const filled = residents.filter(e => e.components.citizen!.jobAssignment?.kind === kind).length;
  const shortage = Math.max(0, need.limit - filled);
  let reason = need.reason;
  if (!reason && shortage) {
    const eligible = residents.filter(e => !jobEligibility(world, e, kind));
    const idle = eligible.filter(e => !e.components.citizen!.jobAssignment && ['idle', 'farm'].includes(e.components.citizen!.task));
    reason = !eligible.length ? 'No available workers' : !idle.length ? 'Workers are busy' : 'Waiting for a worker';
    const problem = idle.find(e => e.components.citizen!.jobProblem?.kind === kind)?.components.citizen!.jobProblem;
    if (problem && idle.length) reason = problem.reason;
  }
  return { kind, limit: need.limit, filled, shortage, reason };
}
export const jobVacancies = (world: World, village: Village): JobVacancy[] => (Object.keys(JOBS) as JobKind[]).map(kind => jobVacancy(world, village, kind));

export function releaseJob(entity: Entity, reason?: JobReason): void {
  const c = entity.components.citizen;
  if (c?.work?.mine) { delete c.work.mine; c.work.progress = 0; }
  if (!c?.jobAssignment) return;
  if (reason) c.jobProblem = { kind: c.jobAssignment.kind, reason };
  delete c.jobAssignment;
}
/** Cancellation does not erase a batch, consume a recipe or return already consumed inputs. */
export function cancelJob(world: World, entity: Entity, reason: JobReason): void {
  const c = entity.components.citizen;
  if (!c) return;
  leaveMine(world, entity);
  releaseJob(entity, reason);
  if (['gather', 'delivery', 'construction'].includes(c.behaviour?.taskId ?? '')) cancelBehaviour(world, entity);
  releaseTreeClaim(world, entity.id); releaseDepositClaim(world, entity.id);
  for (const village of world.society.villages) releaseReservation(village, entity.id);
  for (const order of world.crafting.orders) if (order.workerId === entity.id && order.state === 'working' && !order.paid) {
    order.state = 'waiting'; order.reason = 'worker'; order.workerId = order.workplaceId = null; delete order.reservedUntil;
  }
  if (c.work) {
    delete c.work.reservation;
    if (!c.work.cargo && !carriedItems(world, entity.id).length) delete c.work;
  }
  if (c.emergency?.kind === 'extinguish') delete c.emergency;
  if (['work', 'deliver', 'farm', 'build', 'repair'].includes(c.task)) Object.assign(c, { task: 'idle', targetId: null, path: [], repair: null, reconsiderIn: 0 });
}

export function claimJob(world: World, entity: Entity, kind: JobKind, targetId: number | null, output?: ResourceId, tile: number | null = null): boolean {
  if (world.paused) return false;
  const c = entity.components.citizen!, village = world.society.villages.find(v => v.id === c.villageId);
  let reason = jobEligibility(world, entity, kind);
  if (!village) return false;
  if (output && !canCook(entity, output)) reason = 'No suitable workplace';
  const old = c.jobAssignment;
  const target = world.entities.get(targetId ?? -1);
  if (targetId !== null && (!target || (target.components.health?.current ?? 1) <= 0)) reason = 'Target is no longer available';
  if (target?.components.building && kind !== 'firefighter' && buildingOwner(target) !== village.id) reason = 'Workplace changed owner';
  if (target?.components.position && kind !== 'firefighter') {
    const owner = territoryOwner(world, target.components.position);
    if (target.components.building ? !ownsPosition(world, village.id, target.components.position) : owner && owner.id !== village.id) reason = 'Workplace changed owner';
  }
  if (kind === 'roadBuilder' && [...world.query('citizen')].some(e => e.id !== entity.id && e.components.citizen!.jobAssignment?.kind === kind && e.components.citizen!.jobAssignment!.tile === tile)) reason = 'Job slots are occupied';
  if (kind === 'hunter' && target && !huntable(world, village, target)) reason = 'Breeding herd is protected';
  if (kind === 'hunter' && [...world.query('citizen')].some(e => e.id !== entity.id
    && e.components.citizen!.jobAssignment?.kind === 'hunter' && e.components.citizen!.jobAssignment!.targetId === targetId)) reason = 'Job slots are occupied';
  if (!reason && old?.kind === kind && old.villageId === village.id && old.targetId === targetId && old.tile === tile) {
    if (output) old.output = output;
    return true;
  }
  const need = demand(world, village, kind);
  if (!reason && !need.limit) reason = need.reason;
  const occupied = [...world.query('citizen')].filter(e => e.id !== entity.id && e.components.citizen!.jobAssignment?.villageId === village.id)
    .map(e => e.components.citizen!.jobAssignment!);
  const slots = new Set(occupied.filter(j => j.kind === kind).map(j => j.slot));
  let slot = 0; while (slots.has(slot)) slot++;
  const sameTarget = occupied.filter(j => j.kind === kind && j.targetId === targetId && j.tile === tile).length;
  if (!reason && (slot >= need.limit || sameTarget >= (kind === 'miner' ? MINE.slots : ['builder', 'farmer', 'firefighter', 'depositMiner'].includes(kind) ? 2 : 1))) reason = 'Job slots are occupied';
  if (reason) { c.jobProblem = { kind, reason }; return false; }
  if (old?.kind === 'miner' && kind !== 'miner') leaveMine(world, entity);
  c.profession = professionOf(world, entity);
  c.jobAssignment = { kind, villageId: village.id, targetId, tile, slot, phase: 'approach', assignedAt: world.tick, ...(output ? { output } : {}) };
  delete c.jobProblem; return true;
}

function assignmentMatches(entity: Entity, job: JobAssignment): boolean {
  const c = entity.components.citizen!;
  if (job.kind === 'firefighter') return c.emergency?.kind === 'extinguish' && c.emergency.targetId === job.targetId;
  if (c.emergency || c.villageId !== job.villageId) return false;
  if (job.phase === 'deliver') return c.task === 'deliver' && c.targetId === job.targetId;
  if (c.targetId !== job.targetId) return false;
  if (job.kind === 'builder' || job.kind === 'cleaner') return c.task === 'build';
  if (job.kind === 'roadBuilder') return c.task === 'repair' && c.repair?.tile === job.tile;
  return c.task === 'work' || job.kind === 'farmer' && c.task === 'farm';
}
/** Called at transition boundaries as well as each step. No random draw, timer or reward. */
export function reconcileJobs(world: World): void {
  for (const entity of world.query('citizen', 'person')) {
    const c = entity.components.citizen!;
    c.profession = professionOf(world, entity);
    const job = c.jobAssignment;
    if (!job) continue;
    if (c.villageId !== job.villageId || !world.society.villages.some(v => v.id === job.villageId)) { cancelJob(world, entity, 'Workplace changed owner'); continue; }
    if (c.task === 'deliver' && (c.work?.cargo || carriedItems(world, entity.id).length) && c.targetId !== null) {
      job.phase = 'deliver'; job.targetId = c.targetId;
    }
    if (!assignmentMatches(entity, job)) { leaveMine(world, entity); releaseJob(entity); continue; }
    const target = world.entities.get(job.targetId ?? -1);
    const reason = !world.society.villages.some(v => v.id === job.villageId) ? 'Workplace changed owner'
      : job.targetId !== null && !target ? 'Target is no longer available'
      : target?.components.building && job.kind !== 'firefighter' && (buildingOwner(target) !== job.villageId || !ownsPosition(world, job.villageId, target.components.position!)) ? 'Workplace changed owner'
      : jobEligibility(world, entity, job.kind);
    if (reason) { cancelJob(world, entity, reason); continue; }
    if (job.kind === 'farmer' && c.task === 'farm') {
      const village = world.society.villages.find(v => v.id === job.villageId)!;
      const need = demand(world, village, 'farmer');
      if (!need.limit) { cancelJob(world, entity, need.reason ?? 'No work needed'); continue; }
    }
    job.phase = c.task === 'deliver' ? 'deliver' : (c.emergency?.path ?? c.path).length ? 'approach' : 'operate';
  }
}
export function removeJobTarget(world: World, id: number): void {
  for (const entity of world.query('citizen')) {
    const c = entity.components.citizen!, job = c.jobAssignment;
    if (entity.id === id) releaseJob(entity);
    else if (job?.targetId === id) {
      // Extraction already put the finite batch in the worker's hands. Delivery chooses its own target next.
      if (c.work?.cargo && c.behaviour?.status === 'completed') continue;
      else cancelJob(world, entity, 'Target is no longer available');
    }
  }
}
export function storageHasRoom(world: World, village: Village, good: ResourceId): boolean {
  return storesOf(village).some(s => {
    const building = world.entities.get(s.buildingId);
    return building && !building.components.thermal?.burning && storageRoom(s, good) >= 1;
  });
}

export function validProfession(v: unknown): boolean {
  return v === undefined || record(v) && reference(v.villageId) && ['resident', 'leader', 'king'].includes(String(v.office)) && ['civilian', 'warrior', 'captain'].includes(String(v.service));
}
export function validJob(v: unknown): boolean {
  return v === undefined || record(v) && typeof v.kind === 'string' && Object.hasOwn(JOBS, v.kind) && integer(v.villageId, 1)
    && reference(v.targetId) && (v.tile === null || integer(v.tile, 0, 512 * 384 - 1)) && integer(v.slot, 0, 299)
    && ['approach', 'operate', 'deliver'].includes(String(v.phase)) && integer(v.assignedAt) && (v.output === undefined || isResource(v.output))
    && (v.kind === 'roadBuilder' ? v.targetId === null && v.tile !== null && v.phase !== 'deliver' : v.targetId !== null && v.tile === null);
}
export function validJobProblem(v: unknown): boolean {
  return v === undefined || record(v) && typeof v.kind === 'string' && Object.hasOwn(JOBS, v.kind) && JOB_REASONS.some(r => r === v.reason);
}
export function validJobsSave(save: WorldSnapshot): boolean {
  const entities = new Map(save.entities.map(e => [e.id, e])), villages = new Set(save.society.villages.map(v => v.id)), slots = new Set<string>();
  const targets = new Map<string, number>();
  for (const entity of save.entities) {
    const c = entity.components.citizen, job = c?.jobAssignment, role = c?.profession;
    if (role && role.villageId !== null && (!villages.has(role.villageId) || role.villageId !== c!.villageId)) return false;
    const expectedRole = c && professionOf({ society: save.society, worldRules: save.worldRules ?? newWorldRules() }, entity);
    if (role && (role.office !== expectedRole!.office || role.service !== expectedRole!.service || role.villageId !== expectedRole!.villageId)) return false;
    if (!job) continue; // Optional additions: old saves adopt jobs at the next normal decision, without a migration.
    const key = `${job.villageId}:${job.kind}:${job.slot}`, target = entities.get(job.targetId ?? -1);
    if (!validJob(job) || !villages.has(job.villageId) || !entity.components.person || !isAdult(entity)
      || unavailableJobs.includes(job.kind) || job.slot >= (maximumSlots[job.kind] ?? 300)
      || job.assignedAt > save.tick || slots.has(key) || !assignmentMatches(entity, job)
      || job.targetId !== null && !target || job.tile !== null && (job.tile >= save.terrain.width * save.terrain.height
        || !save.society.roads.some(r => (r.a === job.villageId || r.b === job.villageId) && r.tiles.slice(0, Math.min(r.built + 1, r.tiles.length)).includes(job.tile!)))
      || expectedRole?.service !== 'civilian'
      || expectedRole.office !== 'resident' && ['farmer', 'miner', 'depositMiner'].includes(job.kind)
      || target?.components.building && job.kind !== 'firefighter' && buildingOwner(target) !== job.villageId) return false;
    if (target && job.phase !== 'deliver' && job.kind !== 'firefighter') {
      if (c!.task === 'work' && (!c!.work || productionJob(target, c!.work.good) !== job.kind || c!.work.good !== job.output)) return false;
      if (c!.task === 'build' && (!target.components.building?.project || constructionJob(target) !== job.kind)) return false;
      if (c!.task === 'farm' && target.components.farm?.villageId !== job.villageId) return false;
    }
    if (job.phase !== 'deliver') {
      const targetKey = `${job.kind === 'roadBuilder' ? '' : job.villageId}:${job.kind}:${job.targetId}:${job.tile}`, count = (targets.get(targetKey) ?? 0) + 1;
      if (count > (job.kind === 'miner' ? MINE.slots : ['builder', 'farmer', 'firefighter', 'depositMiner'].includes(job.kind) ? 2 : 1)) return false;
      targets.set(targetKey, count);
    }
    slots.add(key);
  }
  return true;
}
