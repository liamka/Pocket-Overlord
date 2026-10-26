import { hasTrait } from './traits';
import { isAdult } from './unit-stats';
import type { Entity, Village } from './types';
import type { World } from './world';
import { NaturalBiome, NATURAL_BIOMES } from './natural-biomes';
import { bundleLoad, entries, SOURCE_PROFILES, type ResourceBundle, type SourceProfile } from './resources';
import { integer, record } from './validation';
import { STONE } from './stone';
import { availableStock, inTransit, stockOf } from './resource-ledger';
import { clearStorageApproach } from './stockpiles';

// Source owners control placement; mining and mixed batch claims are shared here.
export const DEPOSIT_PROFILES = ['stone', 'boneDeposit', 'metalOre', 'silverOre', 'goldOre', 'meteorite'] as const;
export type DepositProfile = typeof DEPOSIT_PROFILES[number];
export const STONE_BIOMES: readonly NaturalBiome[] = NATURAL_BIOMES.filter(b => (b.ecology.minerals.stone ?? 0) > 0).map(b => b.id);
export interface DepositClaim { workerId: number; villageId: number; amount: number; expires: number }
export interface Deposit {
  profile: DepositProfile; biome: NaturalBiome; origin: 'natural' | 'placed' | 'mine' | 'biology' | 'meteorite' | 'legacy';
  /** Primary material units, not a second inventory. Byproducts follow the profile's ratio. */
  remaining: number; claims: DepositClaim[];
}
declare module './types' { interface ComponentMap { stone: Deposit; commonMetal: Deposit } }
export const mineralDeposit = (entity: Entity): Deposit | undefined => entity.components.stone ?? entity.components.commonMetal;
export const MINING_REASONS = ['Miner needs food', 'Mining site is unsafe', 'No reachable deposit', 'Deposit batch is reserved',
  'No storage space for the whole batch', 'Stone supply is sufficient', 'Miners are needed for food'] as const;
export type MiningReason = typeof MINING_REASONS[number];
export function newDeposit(biome: NaturalBiome, origin: Deposit['origin'] = 'natural', profile: DepositProfile = 'stone'): Deposit {
  const definition: SourceProfile = SOURCE_PROFILES[profile];
  return { profile, biome, origin, remaining: definition.capacity[definition.primary]!, claims: [] };
}
/** Smallest indivisible mixed lot; e.g. three bones and one stone stay together. */
export function depositUnit(profile: DepositProfile): ResourceBundle {
  const outputs = SOURCE_PROFILES[profile].outputs;
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = entries(outputs).reduce((n, [, amount]) => gcd(n, amount), 0);
  return Object.fromEntries(entries(outputs).map(([id, n]) => [id, n / divisor]));
}
export function depositContents(deposit: Deposit, amount = deposit.remaining): ResourceBundle {
  const unit = depositUnit(deposit.profile), primary = SOURCE_PROFILES[deposit.profile].primary;
  return Object.fromEntries(entries(unit).map(([id, n]) => [id, n * amount / unit[primary]!]));
}
export function validDeposit(value: Record<string, unknown>): boolean {
  if (!DEPOSIT_PROFILES.some(id => id === value.profile) || !integer(value.biome, 0, NATURAL_BIOMES.length - 1)
    || !['natural', 'placed', 'mine', 'biology', 'meteorite', 'legacy'].includes(String(value.origin))
    || value.profile === 'goldOre' && !['placed', 'mine', 'biology'].includes(String(value.origin))) return false;
  const profile = value.profile as DepositProfile, primary = SOURCE_PROFILES[profile].primary, unit = depositUnit(profile)[primary]!;
  const definition: SourceProfile = SOURCE_PROFILES[profile];
  return integer(value.remaining, 1, definition.capacity[primary]) && value.remaining % unit === 0
    && Array.isArray(value.claims) && value.claims.length <= 300
    && value.claims.every(c => record(c) && integer(c.workerId, 1) && integer(c.villageId, 1) && integer(c.expires)
      && integer(c.amount, unit, STONE.batch) && c.amount % unit === 0)
    && new Set(value.claims.map(c => c.workerId)).size === value.claims.length
    && value.claims.reduce((sum, c) => sum + c.amount, 0) <= value.remaining;
}
export function cleanDepositClaims(world: World, source: Entity): void {
  const d = mineralDeposit(source);
  if (!d) return;
  d.claims = d.claims.filter(claim => {
    const worker = world.entities.get(claim.workerId), c = worker?.components.citizen;
    return claim.expires > world.tick && c?.villageId === claim.villageId && c.task === 'work' && c.targetId === source.id
      && c.work?.good === SOURCE_PROFILES[d.profile].primary && !c.work.cargo && c.work.orderId === undefined
      && c.hunger < STONE.hunger && !c.emergency && !worker?.components.thermal?.burning && !worker?.components.person?.madness
      && (worker?.components.health?.current ?? 0) > 0;
  });
}
export function releaseDepositClaim(world: World, workerId: number): void {
  for (const key of ['stone', 'commonMetal'] as const) for (const e of world.query(key)) e.components[key]!.claims = e.components[key]!.claims.filter(c => c.workerId !== workerId);
}
export function depositBatch(world: World, source: Entity, workerId: number): number {
  const d = mineralDeposit(source)!;
  cleanDepositClaims(world, source);
  const held = d.claims.find(c => c.workerId === workerId);
  if (held) return held.amount;
  const unit = depositUnit(d.profile), primary = SOURCE_PROFILES[d.profile].primary, load = bundleLoad(unit);
  const free = d.remaining - d.claims.reduce((n, c) => n + c.amount, 0);
  return Math.min(Math.floor(free / unit[primary]!), Math.floor(STONE.batch / unit[primary]!),
    Math.floor(STONE.carryWeight / load.weight), Math.floor(STONE.carryVolume / load.volume)) * unit[primary]!;
}
export function reserveDeposit(world: World, source: Entity, worker: Entity): boolean {
  const c = worker.components.citizen, d = mineralDeposit(source);
  if (world.paused || !d || !c?.villageId || c.work?.cargo || c.hunger >= STONE.hunger || c.emergency
    || !worker.components.person || !isAdult(worker) || worker.components.person.madness || worker.components.thermal?.burning
    || (worker.components.health?.current ?? 0) <= 0 || (source.components.health?.current ?? 0) <= 0 || source.components.thermal?.burning
    || world.entities.get(worker.id) !== worker || world.entities.get(source.id) !== source
    || !world.society.villages.some(v => v.id === c.villageId) || !world.terrain.isLand(source.components.position!.x, source.components.position!.y)) return false;
  const amount = depositBatch(world, source, worker.id);
  if (!amount) return false;
  releaseDepositClaim(world, worker.id);
  d.claims.push({ workerId: worker.id, villageId: c.villageId, amount, expires: world.tick + STONE.claimTicks });
  return true;
}
/** Claims cover only the current batch; extraction and cargo hand-off have no async gap. */
export function takeDeposit(world: World, source: Entity, worker: Entity): ResourceBundle | undefined {
  const d = mineralDeposit(source)!, c = worker.components.citizen!;
  if (c.task !== 'work' || c.targetId !== source.id || c.path.length || c.work!.good !== SOURCE_PROFILES[d.profile].primary || c.work!.progress < STONE.work
    || !clearStorageApproach(world, worker.components.position!, source) || !reserveDeposit(world, source, worker)) return;
  const claim = d.claims.find(c => c.workerId === worker.id)!;
  let amount = claim.amount;
  if (hasTrait(worker, 'miner')) {
    const unit = depositUnit(d.profile), primary = SOURCE_PROFILES[d.profile].primary, size = unit[primary]!, load = bundleLoad(unit);
    const free = d.remaining - d.claims.reduce((sum, c) => sum + c.amount, 0);
    let bonus = 0;
    for (let i = 0; i < claim.amount / size; i++) if (world.rng.next() < 0.5) bonus++;
    // Extra yield is extracted from unreserved ore, bounded by the same cargo limits.
    const capacity = Math.min(Math.floor(STONE.carryWeight / load.weight), Math.floor(STONE.carryVolume / load.volume));
    amount += Math.max(0, Math.min(bonus, Math.floor(free / size), capacity - claim.amount / size)) * size;
  }
  const goods = depositContents(d, amount);
  d.remaining -= amount;
  releaseDepositClaim(world, worker.id);
  return goods;
}
export function housingStoneReserve(world: World, village: Village): number {
  let needed = 0, nextUpgrade = false;
  for (const e of world.query('dwelling', 'building')) {
    if (e.components.dwelling!.villageId !== village.id) continue;
    const project = e.components.building!.project;
    if (!project) { if (!e.components.dwelling!.level) nextUpgrade = true; continue; }
    if (project.paid) continue;
    const held = village.economy?.storage?.reduce((sum, s) => sum + s.reservations.filter(r => r.claimant === e.id)
      .reduce((n, r) => n + (r.goods.stone ?? 0), 0), 0) ?? 0;
    needed += Math.max(0, (project.cost.stone ?? 0) - held);
  }
  return needed + (nextUpgrade ? STONE.houseCost : 0);
}
export function stoneTarget(world: World, village: Village): number {
  const construction = [...world.query('building')].reduce((sum, e) => {
    const c = e.components, owner = c.dwelling?.villageId ?? c.workplace?.villageId ?? c.stockpile?.villageId ?? c.harbor?.villageId;
    return sum + (owner === village.id && !c.building!.project?.paid ? c.building!.project?.cost.stone ?? 0 : 0);
  }, 0);
  const workshop = Math.max(0, ...world.crafting.orders.filter(o => o.villageId === village.id && !o.paid && ['waiting', 'working'].includes(o.state)).map(o => o.inputs.stone ?? 0));
  return Math.max(STONE.stockTarget, Math.max(construction, housingStoneReserve(world, village)) + workshop);
}
export function committedStone(world: World, village: Village): number {
  let amount = stockOf(village, 'stone') + (inTransit(world, village.id).stone ?? 0);
  for (const source of [...world.query('stone'), ...world.query('commonMetal')]) {
    cleanDepositClaims(world, source);
    const d = mineralDeposit(source)!;
    for (const c of d.claims) if (c.villageId === village.id) amount += depositContents(d, c.amount).stone ?? 0;
  }
  return amount;
}
/** Future material carriers withdraw this surplus through the common stock ledger. */
export const stoneSurplus = (world: World, village: Village): number => Math.max(0, availableStock(world, village, 'stone') - stoneTarget(world, village));
