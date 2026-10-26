import { cancelJob } from './jobs';
import { habitableZone, initializeTerritories, ownsPosition, reservedZone, zoneAt, zoneNeighbours, zoneOwner } from './territory';
import type { Entity, Vec2, Village } from './types';
import type { World } from './world';
import { NaturalBiome } from './natural-biomes';
import { RACES, type RaceId } from './races';
import { STONE } from './stone';
import { COMMON_METAL } from './common-metals';
import { GOLD } from './gold';
import type { ResourceBundle } from './resources';
import { clearStorageApproach, destroyStorage, initializeStorage, releaseReservation, storageRoute, storesOf, syncStocks } from './stockpiles';

export type Capability = 'housing' | 'storage' | 'workplace' | 'source';
export type BuildingState = 'planned' | 'reserved' | 'construction' | 'active' | 'damaged' | 'abandoned' | 'ruined';
export type BuildingAction = 'build' | 'upgrade' | 'repair' | 'clear';
export interface BuildingProject { action: BuildingAction; progress: number; struckAt: number; paid: boolean; cost: ResourceBundle; legacyGoldCost?: true }
export interface Building { kind: string; architecture: Architecture; level: number; state: BuildingState; project?: BuildingProject }
export interface BuildingProfile {
  label: string; capabilities: readonly Capability[]; footprint: readonly Vec2[]; entrances: readonly Vec2[];
  placement: 'land' | 'field' | 'coast'; cost: ResourceBundle; repair: ResourceBundle; hits: number;
  health: number; fuel: number; ignition: number; effects: { houses?: number; beds?: number; storage?: number };
  uniquePerVillage?: boolean; resistance?: 'fire' | 'acid';
}
const footprint = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
const entrances = [{ x: 0, y: 1.8 }, { x: 1.8, y: 0 }, { x: 0, y: -1.8 }, { x: -1.8, y: 0 }];
const profile = (label: string, capabilities: Capability[], cost: ResourceBundle, effects: BuildingProfile['effects'] = {}): BuildingProfile => ({
  label, capabilities, footprint, entrances, placement: 'land', cost, repair: { wood: 1 }, hits: 12,
  health: 140, fuel: 45, ignition: 38, effects,
});
/** Pocket Overlord balance, not WorldBox prices. Tilled fields cost labour.
 * Material upgrades retain the existing stone price and add common ore. Future buildings register a
 * profile here, rather than adding exceptions to construction or storage. */
export const BUILDINGS: Record<string, BuildingProfile> = {
  'core:mine': { ...profile('Mine', ['workplace', 'source'], { gold: 15 }),
    footprint: Array.from({ length: 15 }, (_, i) => ({ x: i % 5 - 2, y: Math.floor(i / 5) - 1 })),
    entrances: [{ x: 0, y: 1.8 }], health: 300, fuel: 35, repair: { wood: 2, stone: 2 }, uniquePerVillage: true },
  // Temples, wiki revision 21580: 30 gold / 10 stone / 2 metal; Economy disagrees on gold.
  // Local price: half the current gold stock target, three stone deliveries and one metal lot.
  // Physical resources only; personal coins never pay this recipe.
  'core:temple': { ...profile('Temple', [], { gold: 10, stone: 10, commonMetal: 2 }, { houses: 2 }),
    footprint: Array.from({ length: 20 }, (_, i) => ({ x: i % 5 - 2, y: Math.floor(i / 5) - 2 })),
    health: 1500, fuel: 0, repair: { stone: 2, commonMetal: 1 }, uniquePerVillage: true, resistance: 'fire' },
  'core:house': { ...profile('House', ['housing', 'storage'], { wood: 4 }, { beds: 5, storage: 256 }), health: 180, fuel: 70, ignition: 42 },
  'core:farm': { ...profile('Field', ['workplace', 'source'], {}), placement: 'field', health: 55, fuel: 35, ignition: 30, hits: 6 },
  'core:market': profile('Market', ['workplace', 'storage'], { wood: 4, gold: GOLD.building.market }, { storage: 256, houses: 2 }),
  'core:mill': profile('Windmill', ['workplace', 'storage'], { wood: 6, stone: 2, commonMetal: COMMON_METAL.millCost, gold: GOLD.building.mill }, { storage: 48 }),
  'core:bakery': profile('Bakery', ['workplace'], { wood: 4, stone: 2 }),
  'core:workshop': profile('Workshop', ['workplace'], { wood: 6, stone: 2 }),
  'core:stockpile': { ...profile('Stockpile', ['storage'], { wood: 6 }, { storage: 256 }), health: 180 },
  'core:stockpile-fireproof': { ...profile('Fireproof stockpile', ['storage'], { wood: 4, stone: 8 }, { storage: 256 }), health: 180 },
  'core:stockpile-acidproof': { ...profile('Acidproof stockpile', ['storage'], { wood: 4, stone: 8 }, { storage: 256 }), health: 180 },
  'core:harbor': { ...profile('Harbor', ['workplace', 'storage'], { wood: 8, stone: 4, gold: GOLD.building.harbor }, { storage: 256 }), placement: 'coast', health: 320, fuel: 120, ignition: 42 },
};
export const HOUSE_UPGRADE = { stone: STONE.houseCost, wood: STONE.houseWood, commonMetal: COMMON_METAL.houseCost, gold: GOLD.building.houseUpgrade };

interface ArchitectureProfile { levels: number; biome?: NaturalBiome; futureBiome?: 'flower' | 'garlic' | 'wasteland'; resistance?: 'fire' | 'acid' }
export const ARCHITECTURES = {
  human: { levels: 2 }, elf: { levels: 2 }, orc: { levels: 2 }, dwarf: { levels: 2 },
  necromancer: { levels: 1, biome: NaturalBiome.Corrupted }, druid: { levels: 1, biome: NaturalBiome.Jungle },
  demon: { levels: 1, biome: NaturalBiome.Infernal, resistance: 'fire' }, ice: { levels: 1, biome: NaturalBiome.Permafrost },
  flower: { levels: 1, futureBiome: 'flower' }, crystal: { levels: 1, biome: NaturalBiome.Crystal, resistance: 'fire' },
  lemon: { levels: 1, biome: NaturalBiome.Lemon }, garlic: { levels: 1, futureBiome: 'garlic' },
  candy: { levels: 1, biome: NaturalBiome.Candy }, acid: { levels: 1, futureBiome: 'wasteland', resistance: 'acid' },
} satisfies Record<string, ArchitectureProfile>;
export type Architecture = keyof typeof ARCHITECTURES;
export const buildingProfile = (entity: Entity): BuildingProfile | undefined => BUILDINGS[entity.components.building?.kind ?? entity.typeId];
export const buildingOwner = (entity: Entity): number | null => entity.components.dwelling?.villageId ?? entity.components.workplace?.villageId
  ?? entity.components.stockpile?.villageId ?? entity.components.harbor?.villageId ?? entity.components.farm?.villageId ?? entity.components.temple?.villageId ?? entity.components.mine?.villageId ?? entity.components.ruin?.villageId ?? null;
export function setBuildingOwner(entity: Entity, owner: number | null): void {
  for (const key of ['dwelling', 'workplace', 'stockpile', 'harbor', 'farm', 'temple', 'mine', 'ruin'] as const) {
    const c = entity.components[key]; if (c) c.villageId = owner;
  }
}
export function newBuilding(kind: string, architecture: Architecture = 'human'): Building {
  return { kind, architecture, level: 1, state: 'active' };
}
export const operational = (entity: Entity): boolean => !entity.components.building || !entity.components.building.project
  && ['active', 'damaged', 'abandoned'].includes(entity.components.building.state) && (entity.components.health?.current ?? 1) > 0;
export const hasCapability = (entity: Entity, capability: Capability): boolean => !!buildingProfile(entity)?.capabilities.includes(capability);
export function buildingCost(entity: Entity, action: BuildingAction): ResourceBundle {
  return { ...(action === 'upgrade' ? HOUSE_UPGRADE : action === 'repair' ? buildingProfile(entity)?.repair : action === 'clear' ? {} : buildingProfile(entity)?.cost) };
}
export function beginProject(entity: Entity, action: BuildingAction): void {
  entity.components.building!.project = { action, progress: 0, struckAt: -1, paid: false, cost: buildingCost(entity, action) };
  entity.components.building!.state = 'planned';
}
export const buildingCells = (entity: Entity): Vec2[] => (buildingProfile(entity)?.footprint ?? []).map(p => ({ x: Math.floor(entity.components.position!.x + p.x), y: Math.floor(entity.components.position!.y + p.y) }));
export function buildingGround(world: World, entity: Entity): boolean {
  // The central foundation carries the building. Full footprints constrain new
  // placement; older shore houses keep their identity when only an edge is wet.
  const p = entity.components.position!;
  return world.terrain.isLand(p.x, p.y);
}
export function buildingEntrances(world: World, entity: Entity): Vec2[] {
  const center = entity.components.position!;
  return (buildingProfile(entity)?.entrances ?? []).map(p => ({ x: center.x + p.x, y: center.y + p.y }))
    .filter(p => (entity.components.mine ? world.terrain.isLand(p.x, p.y) && !world.nearby(p, 1.4).some(e => e.components.solid
      && Math.hypot(e.components.position!.x - p.x, e.components.position!.y - p.y) < e.components.solid.radius + 0.15)
      : world.canStand(p, 0.15)) && clearStorageApproach(world, p, entity));
}
export const buildingRoute = (world: World, from: Vec2, entity: Entity): Vec2[] | undefined => storageRoute(world, from, entity);

export function hasOrderedBuilding(world: World, kind: string, owner: number, ignoreId?: number): boolean {
  return [...world.query('building')].some(e => e.id !== ignoreId && e.components.building!.kind === kind
    && buildingOwner(e) === owner && !e.components.ruin && e.components.building!.state !== 'ruined');
}
/** Derived from current ownership, never persisted as a cumulative award.
 * Captured duplicates survive; the oldest completed temple supplies the single bonus.
 * Repairs retain completion, whereas rebuilding must finish again. */
export function housingBonuses(world: World, owner: number): Map<number, number> {
  const bonuses = new Map<number, number>(), unique = new Set<string>();
  for (const e of [...world.query('building')].sort((a, b) => a.id - b.id)) {
    const b = e.components.building!, profile = buildingProfile(e)!;
    if (buildingOwner(e) !== owner || e.components.ruin || b.state === 'ruined' || !profile.effects.houses
      || (e.components.health?.current ?? 0) <= 0 || e.components.thermal?.burning
      || !operational(e) && !(e.components.temple && b.project?.action === 'repair')) continue;
    if (profile.uniquePerVillage && unique.has(b.kind)) continue;
    unique.add(b.kind); bonuses.set(e.id, profile.effects.houses);
  }
  return bonuses;
}

/** Local balance: three founding slots, one per nine owned zones and catalogue bonuses.
 * Culture plan 69 supplies its own multiplier; beds never enter this count. */
export function housingLimit(world: World, village: Village): { used: number; limit: number; zones: number; bonus: number } {
  const zones = village.territory?.zones.length ?? 0;
  const bonus = [...housingBonuses(world, village.id).values()].reduce((sum, n) => sum + n, 0);
  let used = 0;
  for (const e of world.query('building')) if (buildingOwner(e) === village.id && e.components.building!.state !== 'ruined' && !e.components.ruin) {
    if (hasCapability(e, 'housing')) used++;
  }
  return { used, limit: zones ? 3 + Math.floor(zones / 9) + bonus : 0, zones, bonus };
}
export function cancelBuildingProject(world: World, entity: Entity): void {
  const b = entity.components.building, project = b?.project;
  if (!b || !project) return;
  for (const village of world.society.villages) releaseReservation(village, entity.id);
  if (project.action === 'build') { world.remove(entity.id); return; }
  delete b.project; b.state = entity.components.ruin ? 'ruined' : (entity.components.health!.current < entity.components.health!.max ? 'damaged' : 'active');
  for (const worker of world.query('citizen')) if (worker.components.citizen!.targetId === entity.id && worker.components.citizen!.task === 'build')
    Object.assign(worker.components.citizen!, { task: 'idle', targetId: null, path: [] });
}
/** Capture is an integration operation, not a new war/kingdom simulation. Contents
 * move with the intact building; unspent claims return to their original stores. */
export function transferBuilding(world: World, entity: Entity, owner: Village): boolean {
  if (!world.entities.has(entity.id) || !world.society.villages.includes(owner)) return false;
  initializeTerritories(world);
  const p = entity.components.position!, zone = zoneAt(world, p);
  if (!ownsPosition(world, owner.id, p)) {
    if (!habitableZone(world, zone) || reservedZone(world, zone) || !zoneNeighbours(world, zone).some(z => owner.territory!.zones.includes(z))) return false;
    const previousOwner = zoneOwner(world, zone);
    if (previousOwner) previousOwner.territory!.zones = previousOwner.territory!.zones.filter(z => z !== zone);
    owner.territory!.zones.push(zone); owner.territory!.zones.sort((a, b) => a - b);
    for (const building of world.query('building', 'position')) if (building.id !== entity.id && zoneAt(world, building.components.position!) === zone) transferBuilding(world, building, owner);
  }
  const previous = world.society.villages.find(v => v.id === buildingOwner(entity));
  if (previous?.id === owner.id) return true;
  initializeStorage(world, owner);
  for (const village of world.society.villages) releaseReservation(village, entity.id);
  if (previous) {
    const store = storesOf(previous).find(s => s.buildingId === entity.id);
    if (store) {
      for (const reservation of store.reservations) releaseReservation(previous, reservation.claimant);
      previous.economy!.storage = storesOf(previous).filter(s => s !== store);
      store.reservations = []; (owner.economy ??= { stocks: { grain: 0, flour: 0, bread: 0, wood: 0, tools: 0, stone: 0, stoneAxes: 0 }, deliveries: 0, buildAfter: world.tick + 900 }).storage ??= [];
      owner.economy.storage.push(store); syncStocks(previous); syncStocks(owner);
    }
  }
  setBuildingOwner(entity, owner.id);
  for (const worker of world.query('citizen')) if (worker.components.citizen!.jobAssignment?.targetId === entity.id) cancelJob(world, worker, 'Workplace changed owner');
  if (entity.components.building?.project && !entity.components.building.project.paid) entity.components.building.state = 'planned';
  for (const e of world.query('citizen')) {
    const c = e.components.citizen!;
    if (e.components.person?.homeId === entity.id) {
      if ((e.components.person.race ?? 'human') === (owner.race ?? 'human')) {
        const prior = world.society.villages.find(v => v.id === c.villageId);
        cancelJob(world, e, 'Workplace changed owner');
        if (prior?.government?.leaderId === e.id) {
          prior.government.leaderId = null;
          if (e.components.stats?.experience) delete e.components.stats.experience.ruling;
        }
        if (prior?.territory?.expansion?.actorId === e.id) {
          delete prior.territory.expansion; c.path = [];
        }
        c.villageId = owner.id; delete c.profession;
      }
      else { e.components.person.homeId = null; e.components.person.displaced = { homeId: entity.id, since: world.tick }; }
      delete c.integration;
    }
    if (c.targetId === entity.id) { Object.assign(c, { task: 'idle', targetId: null, path: [], reconsiderIn: 0 }); if (c.work) delete c.work.reservation; }
  }
  return true;
}
export function destroyBuilding(world: World, entity: Entity): void {
  const p = entity.components.position!, b = entity.components.building;
  if (!b || entity.components.ruin) { world.remove(entity.id); return; }
  const owner = buildingOwner(entity), race = entity.components.dwelling?.race ?? 'human';
  for (const resident of world.query('person')) if (resident.components.person!.homeId === entity.id)
    resident.components.person!.displaced = { homeId: entity.id, since: world.tick };
  world.remove(entity.id);
  if (!world.terrain.isLand(p.x, p.y)) return;
  const ruin = world.spawn('core:ruin', p);
  if (!ruin) return;
  Object.assign(ruin.components.ruin!, { homeId: entity.id, race, villageId: owner, capacity: entity.components.dwelling?.level === 2 ? 5 : entity.components.dwelling?.capacity ?? 5, destroyedAt: world.tick });
  ruin.components.building = { kind: b.kind, architecture: b.architecture, level: b.level, state: 'ruined' };
  ruin.components.appearance!.variant = entity.components.appearance?.variant ?? 0;
}
export function maintainBuildings(world: World): void {
  for (const entity of [...world.query('building', 'position')]) {
    const b = entity.components.building!;
    if (entity.components.ruin) continue;
    if (!buildingGround(world, entity)) { destroyBuilding(world, entity); continue; }
    const owner = buildingOwner(entity);
    if (owner !== null && !world.society.villages.some(v => v.id === owner)) {
      destroyStorage(world, entity.id); setBuildingOwner(entity, null);
      for (const v of world.society.villages) releaseReservation(v, entity.id);
      if (b.project && !b.project.paid) b.state = 'planned';
    }
    if (b.project) continue;
    b.state = entity.components.health!.current < entity.components.health!.max ? 'damaged'
      : ![...world.query('citizen')].some(e => e.components.citizen!.villageId === buildingOwner(entity)) ? 'abandoned' : 'active';
  }
}
export function architectureResists(entity: Entity, cause: 'fire' | 'acid'): boolean {
  const a = entity.components.building?.architecture;
  return buildingProfile(entity)?.resistance === cause || !!a && (ARCHITECTURES[a] as ArchitectureProfile).resistance === cause;
}
/** Future peoples opt in through the shared biome writer and the caller's law.
 * No autonomous spreading until the biome/law owner actually enables it. */
export function applyArchitectureEnvironment(world: World, entity: Entity, spreadAllowed: boolean): void {
  if (world.paused || !spreadAllowed || !operational(entity) || !entity.components.building) return;
  const biome = (ARCHITECTURES[entity.components.building.architecture] as ArchitectureProfile).biome;
  if (biome === undefined) return;
  const p = entity.components.position!;
  world.terrain.circle(p.x, p.y, 2, (x, y) => { if (world.terrain.isLand(x, y)) world.terrain.setBiome(x, y, biome); });
}
export function configureArchitecture(entity: Entity, race: RaceId): void {
  entity.components.building!.architecture = race;
  if (entity.components.dwelling) { entity.components.dwelling.race = race; entity.components.health = { current: RACES[race].houseHealth, max: RACES[race].houseHealth }; }
}
