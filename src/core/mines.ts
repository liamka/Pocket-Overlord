import type { Entity, Vec2, Village, WorldSnapshot } from './types';
import type { World } from './world';
import { monthTicks } from './calendar';
import { buildingCells, buildingEntrances, buildingOwner, operational } from './buildings';
import { biomeMineralWeights, MINERAL_ENTITIES, selectBiomeMineral, spawnMineral } from './biome-minerals';
import type { BiomeMineral } from '../content/biome-profiles';
import { NaturalBiome } from './natural-biomes';
import { mineralDeposit, depositContents } from './deposits';
import { gemContents } from './gems';
import { availableStock, inTransit } from './resource-ledger';
import { isAdult } from './unit-stats';
import { supplyTarget, storageHasRoom } from './jobs';
import { ownsPosition } from './territory';
import { canPlaceGold } from '../content/gold';
import { clearStorageApproach } from './stockpiles';
import { findPath } from '../systems/navigation';

/** Pocket Overlord balance: 2–3 calendar months, at most five workers, one per six
 * adults; keep two food units per adult and at most six nearby unmined sources.
 * The 15-gold recipe is in BUILDINGS. No underground stock or ore depletion pool. */
export const MINE = { slots: 5, minTicks: monthTicks(2), maxTicks: monthTicks(3), success: 0.6,
  radius: 8, maxDeposits: 6, maxUnmined: 120, adultsPerWorker: 6, foodReserve: 2 } as const;
export const MINE_OUTCOMES = ['Ore exposed', 'No ore found this shift', 'No room for a new deposit', 'Mine work interrupted', 'Ore type unavailable'] as const;
export type MineOutcome = typeof MINE_OUTCOMES[number];
export interface Mine {
  villageId: number | null; anchor: Vec2;
  lastAttempt?: { tick: number; outcome: MineOutcome; resource?: BiomeMineral };
}
export interface MineShift { enteredAt: number | null; duration: number }
export interface MineOrigin { mineId: number; anchor: Vec2; biome: NaturalBiome; createdAt: number }
export interface MineExplored { mineId: number; villageId: number | null; tick: number; outcome: MineOutcome; depositId: number | null }
declare module './types' {
  interface ComponentMap { mine: Mine; mineOrigin: MineOrigin }
  interface GameEventMap { 'mine-explored': MineExplored }
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mineAnchor = (p: Vec2): Vec2 => ({ x: Math.floor(p.x), y: Math.floor(p.y + 1) });
export const insideMine = (entity: Entity): boolean => entity.components.citizen?.task === 'work'
  && entity.components.citizen.jobAssignment?.kind === 'miner' && entity.components.citizen.work?.mine?.enteredAt != null;
export const mineWorkers = (world: World, mine: Entity): Entity[] => [...world.query('citizen')]
  .filter(e => e.components.citizen!.jobAssignment?.kind === 'miner' && e.components.citizen!.targetId === mine.id);
export function leaveMine(world: World, worker: Entity): void {
  const shift = worker.components.citizen?.work?.mine;
  if (!shift) return;
  if (shift.enteredAt !== null && worker.components.position) {
    // Other residents must have room to exit too. If all nearby ground is gone,
    // keep the resident at the entrance for the existing swimming/rescue rules.
    const exit = world.findFreePosition(worker.components.position, 0.18);
    if (exit) { Object.assign(worker.components.position, exit); world.spatial.update(worker); }
  }
  delete worker.components.citizen!.work!.mine;
}
export const mineWeights = (world: World, mine: Entity) => biomeMineralWeights(world.terrain.biomeAt(mine.components.mine!.anchor.x, mine.components.mine!.anchor.y).id, true);

export function mineSafety(world: World, mine: Entity): string | undefined {
  if (!operational(mine) || mine.components.ruin) return 'Building effects inactive';
  if (mine.components.thermal?.burning || world.nearby(mine.components.position!, 4).some(e => e.components.explosive || e.components.thermal?.burning)) return 'Mining site is unsafe';
  if (buildingCells(mine).some(p => !world.terrain.cell(p.x, p.y).buildable)) return 'Mine flooded or ground destroyed';
  if (!buildingEntrances(world, mine).length) return 'Entrance blocked';
}

/** Deterministic search, shared by placement, demand and the final hand-off.
 * Full building footprints and their entrances remain clear, including planned sites. */
export function mineDepositSite(world: World, mine: Entity): Vec2 | undefined {
  const center = mine.components.position!, entrance = buildingEntrances(world, mine)[0];
  if (!entrance) return;
  for (let radius = 4; radius <= MINE.radius; radius += 2) for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const p = { x: Math.floor(center.x + Math.cos(angle) * radius) + 0.5, y: Math.floor(center.y + Math.sin(angle) * radius) + 0.5 };
    if (!canPlaceGold(world, p) || mine.components.mine?.villageId != null && !ownsPosition(world, mine.components.mine.villageId, p)) continue;
    if (world.nearby(p, 6).some(e => e.components.building && (buildingCells(e).some(cell => distance(p, { x: cell.x + 0.5, y: cell.y + 0.5 }) < 1.5)
      || buildingEntrances(world, e).some(q => distance(p, q) < 1.8)))) continue;
    const path = findPath(world, entrance, p, 1.8);
    if (path !== undefined && clearStorageApproach(world, path.at(-1) ?? entrance, { id: -1, typeId: '', components: { position: p } })) return p;
  }
}
export function mineRoute(world: World, from: Vec2, mine: Entity): Vec2[] | undefined {
  const entrance = buildingEntrances(world, mine)[0];
  if (!entrance) return;
  if (distance(from, entrance) < 0.35) return [];
  const path = findPath(world, from, entrance, 0.8);
  if (path === undefined) return;
  const end = path.at(-1) ?? from;
  const steps = Math.max(1, Math.ceil(distance(end, entrance) / 0.15));
  for (let i = 0; i <= steps; i++) {
    const p = { x: end.x + (entrance.x - end.x) * i / steps, y: end.y + (entrance.y - end.y) * i / steps };
    if (!world.terrain.isLand(p.x, p.y) || world.nearby(p, 1.4).some(e => e.components.solid
      && distance(p, e.components.position!) < e.components.solid.radius + 0.18)) return;
  }
  return [...path, entrance];
}
export function mineDemand(world: World, mine: Entity, village: Village): { limit: number; reason?: string } {
  const blocked = (reason: string) => ({ limit: 0, reason });
  const safety = mineSafety(world, mine);
  if (safety) return blocked(safety);
  if (buildingOwner(mine) !== village.id) return blocked('No owner');
  const adults = [...world.query('citizen', 'person')].filter(e => e.components.citizen!.villageId === village.id && isAdult(e)).length;
  if (adults < 3 || village.food < adults * MINE.foodReserve) return blocked('Food takes priority');
  const weights = mineWeights(world, mine);
  const resources = Object.keys(weights) as BiomeMineral[];
  if (resources.some(r => !world.registry.entities.has(MINERAL_ENTITIES[r]))) return blocked('Ore type unavailable');
  const deposits = world.nearby(mine.components.position!, MINE.radius + 1).filter(e => mineralDeposit(e) || e.components.gemSource);
  if (deposits.length >= MINE.maxDeposits || deposits.reduce((sum, e) => sum + (mineralDeposit(e)?.remaining ?? e.components.gemSource!.remaining), 0) >= MINE.maxUnmined)
    return blocked('Mine waits for nearby ore to be collected');
  const incoming = inTransit(world, village.id);
  const needed = resources.filter(r => availableStock(world, village, r) + (incoming[r] ?? 0)
    + deposits.reduce((sum, e) => sum + ((mineralDeposit(e) ? depositContents(mineralDeposit(e)!) : gemContents(e.components.gemSource!))[r] ?? 0), 0) < supplyTarget(world, village, r));
  if (!needed.length) return blocked('Ore supply is sufficient');
  if (!needed.some(r => storageHasRoom(world, village, r))) return blocked('Storage is full');
  if (!mineDepositSite(world, mine)) return blocked('No room for a new deposit');
  return { limit: Math.min(MINE.slots, Math.max(1, Math.floor(adults / MINE.adultsPerWorker))) };
}
/** Exactly one saved RNG attempt; the caller clears the shift before calling this.
 * Finite sources retain their own material and anchor biome after terraforming. */
export function finishMineShift(world: World, mine: Entity): Entity | undefined {
  if (world.paused || mineSafety(world, mine)) return;
  const state = mine.components.mine!, site = mineDepositSite(world, mine);
  const result = (outcome: MineOutcome, resource?: BiomeMineral, depositId: number | null = null) => {
    state.lastAttempt = { tick: world.tick, outcome, ...(resource ? { resource } : {}) };
    world.events.push({ kind: 'mine-explored', mineId: mine.id, villageId: state.villageId, tick: world.tick, outcome, depositId });
  };
  if (!site) { result('No room for a new deposit'); return; }
  if (world.rng.next() >= MINE.success) { result('No ore found this shift'); return; }
  const biome = world.terrain.biomeAt(state.anchor.x, state.anchor.y).id;
  const resource = selectBiomeMineral(biome, world.rng, true)!;
  if (!world.registry.entities.has(MINERAL_ENTITIES[resource])) { result('Ore type unavailable', resource); return; }
  const source = spawnMineral(world, site, resource, 'mine', biome);
  if (!source) { result('No room for a new deposit'); return; }
  source.components.mineOrigin = { mineId: mine.id, anchor: { ...state.anchor }, biome, createdAt: world.tick };
  result('Ore exposed', resource, source.id);
  world.visual({ kind: 'build', ...site, radius: 1 });
  return source;
}

/** Optional additions need no resource-generating migration. Old saves contain no shifts. */
export function validMinesSave(save: WorldSnapshot): boolean {
  for (const event of save.events) if (event.kind === 'mine-explored' && (event.tick > save.tick
    || event.mineId >= save.nextEntityId || event.depositId !== null && event.depositId >= save.nextEntityId)) return false;
  const entities = new Map(save.entities.map(e => [e.id, e]));
  for (const e of save.entities) {
    const mine = e.components.mine, origin = e.components.mineOrigin, c = e.components.citizen, shift = c?.work?.mine;
    if (e.typeId === 'core:mine' && !mine) return false;
    if (mine) {
      const anchor = mineAnchor(e.components.position!);
      if (e.typeId !== 'core:mine' || e.components.building?.kind !== 'core:mine' || e.components.building.level !== 1
        || e.components.ruin || e.components.workplace || e.components.dwelling || e.components.stockpile || e.components.farm || e.components.harbor || e.components.temple
        || mine.anchor.x !== anchor.x || mine.anchor.y !== anchor.y || anchor.x >= save.terrain.width || anchor.y >= save.terrain.height
        || mine.lastAttempt && mine.lastAttempt.tick > save.tick) return false;
    }
    if (origin) {
      const source = mineralDeposit(e) ?? e.components.gemSource;
      if (!source || source.origin !== 'mine' || source.biome !== origin.biome || origin.mineId >= save.nextEntityId || origin.createdAt > save.tick
        || origin.anchor.x >= save.terrain.width || origin.anchor.y >= save.terrain.height) return false;
      const parent = entities.get(origin.mineId);
      if (parent && (!parent.components.mine || distance(parent.components.mine.anchor, origin.anchor) !== 0)) return false;
    }
    if (shift) {
      const target = entities.get(c!.targetId ?? -1);
      if (!target?.components.mine || !operational(target) || c!.jobAssignment?.kind !== 'miner' || c!.jobAssignment.targetId !== target.id
        || c!.task !== 'work' || c!.work!.cargo || c!.work!.reservation || c!.work!.orderId !== undefined
        || shift.enteredAt !== null && (shift.enteredAt < c!.jobAssignment.assignedAt || shift.enteredAt > save.tick || c!.path.length > 0
          || distance(e.components.position!, { x: target.components.position!.x, y: target.components.position!.y + 1.8 }) > 0.4)) return false;
    } else if (c?.jobAssignment?.kind === 'miner') return false;
  }
  return true;
}
