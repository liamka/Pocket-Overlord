import { canJoinSettlement } from '../core/world-rules';
import { foundingZones, initializeTerritories, newTerritory, ownsPosition, territoryOwner, zoneAt } from '../core/territory';
import { constructionProfileFor } from '../core/village-development';
import { speciesOf } from '../core/creatures';
import { isAdult } from '../core/unit-stats';
import { claimJob, storageHasRoom } from '../core/jobs';
import { buildingEntrances, buildingOwner, buildingProfile, configureArchitecture, maintainBuildings, operational } from '../core/buildings';
import { planBuilding } from './construction';
import { addFood, withdraw } from '../core/resource-ledger';
import type { World } from '../core/world';
import { payWork } from '../core/currency';
import { recordService } from '../core/village-life';
import { ENTITY_LIMIT, POPULATION_LIMIT, SOCIAL_EVENT_RATE, isBridge, isRoadSurface, type Entity, type Vec2, type Village } from '../core/types';
import { Random } from '../core/random';
import { initializeStorage } from '../core/stockpiles';
import { findRoadPath, reachableTiles } from './navigation';
import { settlementName } from '../content/settlement-names';
import { legacyBridges, roadIsIntact, roadPoint } from '../core/roads';
import { seasonAt } from '../core/seasons';
import { RACES, RACE_IDS, raceAffinity, raceOf, type RaceId } from '../core/races';

export const villageOf = (world: World, id: number | null | undefined): Village | undefined => world.society.villages.find(v => v.id === id);
export { atWar, diplomacy } from './diplomacy';

export function buildHouse(world: World, position: Vec2, race: RaceId): Entity | undefined {
  const house = world.spawn('core:house', position);
  if (house) {
    configureArchitecture(house, race);
    house.components.health = { current: RACES[race].houseHealth, max: RACES[race].houseHealth };
  }
  return house;
}

export function assignHouse(world: World, house: Entity, founder?: Entity, reserved?: number[]): Village {
  initializeTerritories(world);
  const p = house.components.position!, dwelling = house.components.dwelling!;
  const race = raceOf(house);
  let village = villageOf(world, dwelling.villageId);
  if (!village) village = territoryOwner(world, p);
  if (!village) {
    const id = world.society.nextVillageId++;
    village = { id, race, ...p, name: settlementName(world.seed, id, world.society.villages.map(v => v.name)), food: 16, harvested: 0, founded: world.tick, migrationAfter: world.tick + 900 / SOCIAL_EVENT_RATE };
    if (house.components.building?.state === 'abandoned') village.food = 0;
    village.territory = newTerritory(world, village, reserved ?? foundingZones(world, p), founder);
    village.constructionProfile = constructionProfileFor(house.components.building?.architecture ?? race, founder && speciesOf(world.registry, founder)?.sourceName);
    world.society.villages.push(village);
    for (const other of world.society.villages) if (other.id !== id) {
      world.society.relations.push({ a: other.id, b: id, status: 'neutral', affinity: Math.floor(world.rng.range(-12, 12)) + raceAffinity(other.race, race), since: world.tick, nextDecision: world.tick + 450 / SOCIAL_EVENT_RATE, roadAttempt: 0 });
    }
    world.announce(`Основана деревня ${village.name}`);
  }
  dwelling.villageId = village.id;
  return village;
}

// Grass is fertile soil. A field needs a whole 3×3 patch, not just one green tile.
export function fertilePatch(world: World, p: Vec2): boolean {
  for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
    const cell = world.terrain.cell(p.x + x, p.y + y);
    if (!cell.farmable) return false;
  }
  return true;
}

/** Populate a fresh game without advancing its clock or changing its landscape. */
export function seedSettlements(world: World): void {
  if (world.tick || world.population || world.houseCount || world.society.villages.length) return;
  const rng = new Random(world.seed ^ 0x73657474), count = Math.floor(rng.range(0, 4));
  const freeSite = (p: Vec2): boolean => {
    if (!fertilePatch(world, p) || !world.canStand(p, 2.5)) return false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!world.terrain.isLand(p.x + dx, p.y + dy)) return false;
    }
    return true;
  };
  for (let attempt = 0; attempt < 1200 && world.society.villages.length < count; attempt++) {
    const center = { x: Math.floor(rng.range(4, world.terrain.width - 4)) + 0.5, y: Math.floor(rng.range(4, world.terrain.height - 4)) + 0.5 };
    if (world.society.villages.some(v => Math.hypot(v.x - center.x, v.y - center.y) < 48) || !freeSite(center)) continue;
    const zones = foundingZones(world, center);
    if (!zones.length) continue;
    const homes = Math.floor(rng.range(2, 4)), sites = [center];
    const distances = reachableTiles(world, [center], 24);
    // Reserve every home and its field before creating any part of the settlement.
    for (let sample = 0; sample < 120 && sites.length < homes + 1; sample++) {
      const p = { x: center.x + Math.floor(rng.range(-9, 10)), y: center.y + Math.floor(rng.range(-9, 10)) };
      if (!world.terrain.inside(p.x, p.y) || !zones.includes(zoneAt(world, p)) || distances[world.terrain.index(p.x, p.y)] < 0
        || sites.some(site => Math.hypot(site.x - p.x, site.y - p.y) < 5) || !freeSite(p)) continue;
      sites.push(p);
    }
    if (sites.length !== homes + 1) continue;
    if (world.entities.size + homes * 5 + 1 > ENTITY_LIMIT || world.population + homes * 4 > POPULATION_LIMIT) return;
    const race = RACE_IDS[Math.floor(rng.range(0, RACE_IDS.length))];
    let village: Village | undefined;
    for (const site of sites.slice(0, homes)) {
      const house = buildHouse(world, site, race)!;
      village = assignHouse(world, house);
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
        const resident = world.spawn(RACES[race].entityId, { x: site.x + dx, y: site.y + dy })!;
        resident.components.person!.homeId = house.id;
        resident.components.citizen!.villageId = village.id;
      }
    }
    const field = world.spawn('core:farm', sites[homes])!;
    configureArchitecture(field, race);
    Object.assign(field.components.farm!, { villageId: village!.id, growth: rng.range(0.25, 0.85) });
    initializeStorage(world, village!);
    addFood(village!, homes * 16);
  }
}

function findFarmSite(world: World, village: Village, adults: Entity[]): Vec2 | undefined {
  const distances = reachableTiles(world, adults.map(e => e.components.position!), 40);
  const plannedRoad = new Set(world.society.roads.flatMap(road => road.tiles));
  let best: Vec2 | undefined, bestScore = Infinity;
  world.terrain.circle(village.x, village.y, 14, (x, y, i) => {
    const p = { x: x + 0.5, y: y + 0.5 };
    if (distances[i] < 0 || !ownsPosition(world, village.id, p) || !fertilePatch(world, p)) return;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (plannedRoad.has(world.terrain.index(x + dx, y + dy))) return;
    }
    if (world.nearby(p, 3.5).some(e => {
      const other = e.components.position!;
      const clearance = e.components.farm ? 3.5 : e.components.solid ? 1.5 + e.components.solid.radius : 0;
      return clearance > 0 && Math.hypot(p.x - other.x, p.y - other.y) < clearance;
    })) return;
    const score = distances[i] + Math.hypot(p.x - village.x, p.y - village.y) * 0.25;
    if (score < bestScore) { bestScore = score; best = p; }
  });
  return best;
}

export function villages(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  initializeTerritories(world);
  for (const house of world.query('dwelling', 'position')) {
    const owner = territoryOwner(world, house.components.position!);
    if (house.components.dwelling!.villageId === null && owner && (owner.race ?? 'human') === raceOf(house)) house.components.dwelling!.villageId = owner.id;
  }
  for (const person of world.query('person', 'citizen')) {
    const home = world.entities.get(person.components.person!.homeId ?? -1);
    if (home?.components.dwelling && canJoinSettlement(world, person, home.components.dwelling.villageId)) person.components.citizen!.villageId = home.components.dwelling.villageId;
  }
  maintainBuildings(world);

  if (world.tick % 150 === 0) for (const village of world.society.villages) {
    const adults = [...world.query('person', 'citizen', 'position')].filter(e => e.components.citizen!.villageId === village.id && e.components.citizen!.task !== 'migrate' && isAdult(e) && !e.components.person!.madness && !e.components.thermal?.burning && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    for (const field of world.query('farm', 'position')) {
      if (field.components.farm!.villageId === village.id && !fertilePatch(world, field.components.position!)) world.remove(field.id);
    }
    const fields = [...world.query('farm')].filter(e => e.components.farm!.villageId === village.id);
    if (seasonAt(world.tick).growth > 0 && adults.length && fields.length < Math.min(8, Math.ceil(adults.length / 4))) {
      const site = findFarmSite(world, village, adults);
      const field = site && planBuilding(world, 'core:farm', site, village, adults.find(e => e.components.citizen!.task !== 'build' && !e.components.citizen!.work?.cargo));
      if (field) {
        field.components.farm!.villageId = village.id;
        if (!fields.length) world.announce(`${village.name}: жители заложили первые поля`);
      }
    }
  }
}

/** Local design: connect useful buildings (including ports), reuse existing roads,
 * and charge only the builder's physical labour. Walking still uses shortest paths. */
function localRoads(world: World): void {
  const village = [...world.society.villages].filter(v => (v.roadPlan?.after ?? 0) <= world.tick && RACES[v.race ?? 'human'].roads)
    .sort((a, b) => (a.roadPlan?.after ?? 0) - (b.roadPlan?.after ?? 0) || a.id - b.id)[0];
  if (!village) return;
  const plan = village.roadPlan ??= { after: 0, cursor: 0, problem: 'Road needs buildings' };
  plan.after = world.tick + 300;
  const buildings = [...world.query('position')].filter(e => buildingOwner(e) === village.id && buildingProfile(e)
    && operational(e) && !e.components.ruin).sort((a, b) => a.id - b.id);
  if (buildings.length < 2) { plan.problem = 'Road needs buildings'; return; }
  const n = 1 + plan.cursor % (buildings.length - 1); plan.cursor = (plan.cursor + 1) % (buildings.length - 1);
  const to = buildings[n], from = buildings.slice(0, n).sort((a, b) => {
    const distance = (e: Entity) => Math.hypot(e.components.position!.x - to.components.position!.x, e.components.position!.y - to.components.position!.y);
    return distance(a) - distance(b) || a.id - b.id;
  })[0];
  if (world.society.roads.some(r => r.buildings?.includes(from.id) && r.buildings.includes(to.id))) { plan.problem = 'Roads connected'; return; }
  const starts = buildingEntrances(world, from), ends = buildingEntrances(world, to);
  const pairs = starts.flatMap(start => ends.map(end => ({ start, end }))).sort((a, b) =>
    Math.hypot(a.start.x - a.end.x, a.start.y - a.end.y) - Math.hypot(b.start.x - b.end.x, b.start.y - b.end.y));
  const pair = pairs[0], zones = new Set(village.territory?.zones ?? []);
  const path = pair && findRoadPath(world, pair.start, pair.end, 0.8, true,
    tile => zones.has(zoneAt(world, roadPoint(world, tile))));
  if (!path?.length) { plan.problem = 'No road route'; return; }
  world.society.roads.push({ a: village.id, b: village.id, buildings: [from.id, to.id], tiles: path.map(p => world.terrain.index(p.x, p.y)), built: 0 });
  plan.problem = 'Waiting for a worker';
}

export function roads(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  for (const road of world.society.roads) {
    road.bridges ??= legacyBridges(road, world.terrain.tiles, world.terrain.width);
    road.ferries ??= [];
    // Shared surfaces already exist; every missing segment is left to the worker queue.
    while (road.built < road.tiles.length && isRoadSurface(world.terrain.tiles[road.tiles[road.built]])) {
      const tile = road.tiles[road.built++], terrain = world.terrain.tiles[tile];
      if (isBridge(terrain) && !road.bridges.some(d => d.tile === tile)) road.bridges.push({ tile, terrain });
    }
    if (roadIsIntact(world, road)) {
      const relation = world.society.relations.find(r => r.a === road.a && r.b === road.b);
      if (relation && relation.roadAttempt !== -1) {
        relation.roadAttempt = -1;
        world.announce(`Дорога: ${villageOf(world, road.a)!.name} — ${villageOf(world, road.b)!.name}`);
      }
    }
  }
  if (world.society.roads.length >= 300) return;
  localRoads(world);
  if (world.society.roads.length >= 300) return;
  // Connect separate road networks first, with at most one bounded path search per second.
  const networks = new Map<number, number>();
  const root = (id: number): number => {
    let next = id;
    while (networks.has(next) && networks.get(next) !== next) next = networks.get(next)!;
    while (id !== next) { const parent = networks.get(id)!; networks.set(id, next); id = parent; }
    return next;
  };
  for (const road of world.society.roads) networks.set(root(road.a), root(road.b));
  const candidates = world.society.relations.filter(r => r.status !== 'war' && r.roadAttempt <= world.tick && root(r.a) !== root(r.b));
  candidates.sort((a, b) => {
    const distance = (r: typeof a): number => { const v = villageOf(world, r.a)!, w = villageOf(world, r.b)!; return Math.hypot(v.x - w.x, v.y - w.y); };
    return distance(a) - distance(b);
  });
  const relation = candidates[0];
  if (!relation) return;
  relation.roadAttempt = world.tick + 900;
  const a = villageOf(world, relation.a)!, b = villageOf(world, relation.b)!;
  const entrance = world.findFreePosition(a, 0.2);
  const foreign = new Set(world.society.villages.filter(v => v.id !== a.id && v.id !== b.id).flatMap(v => v.territory?.zones ?? []));
  const path = entrance && findRoadPath(world, entrance, b, 2.2, true, tile => !foreign.has(zoneAt(world, roadPoint(world, tile))));
  if (!path?.length) for (const v of [a, b]) {
    v.roadPlan ??= { after: world.tick + 300, cursor: 0, problem: 'No road route' }; v.roadPlan.problem = 'No road route';
  }
  if (path?.length) world.society.roads.push({ a: a.id, b: b.id, tiles: path.map(p => world.terrain.index(p.x, p.y)), built: 0 });
}

export function agriculture(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  const season = seasonAt(world.tick);
  const workers = new Map<number, Entity[]>();
  for (const e of world.query('citizen', 'position', 'person')) {
    const c = e.components.citizen!, target = world.entities.get(c.targetId ?? -1);
    if (c.task !== 'farm' || !target?.components.farm || !operational(target) || !isAdult(e) || e.components.thermal?.burning) continue;
    const owner = villageOf(world, c.villageId);
    if (!owner || c.emergency || c.hunger >= 70 || c.path.length || target.components.farm.villageId !== owner.id
      || !ownsPosition(world, owner.id, target.components.position!) || !storageHasRoom(world, owner, 'grain') || !claimJob(world, e, 'farmer', target.id, 'grain')) continue;
    const p = e.components.position!, t = target.components.position!;
    if (!world.terrain.isLand(p.x, p.y)) continue;
    if (Math.hypot(p.x - t.x, p.y - t.y) <= 2) workers.set(target.id, [...(workers.get(target.id) ?? []), e]);
  }
  for (const e of world.query('farm')) {
    const field = e.components.farm!, village = villageOf(world, field.villageId);
    if (!village || !operational(e) || e.components.thermal?.burning || !fertilePatch(world, e.components.position!)) continue;
    if (season.growth === 0) { field.growth = Math.max(0, field.growth - 0.04); continue; }
    const farmers = (workers.get(e.id) ?? []).slice(0, 2), labour = farmers.length;
    const p = e.components.position!, soil = world.terrain.cell(p.x, p.y);
    const equipped = (village.economy?.stocks.tools ?? 0) >= 1;
    field.growth = Math.min(1, field.growth + (0.012 + labour * 0.06 * (equipped ? 1.25 : 1) * (1 + (e.components.thermal?.wetness ?? 0))) * season.growth * soil.growth);
    if (field.growth >= 1 && labour > 0) {
      const grain = Math.min(season.yield, 2000 - (field.grain ?? 0));
      field.grain = Math.min(2000, (field.grain ?? 0) + grain);
      village.harvested += grain; // Harvest remains on the field until a carrier delivers it.
      if (equipped) withdraw(village, { tools: 0.15 });
      for (const worker of farmers) { recordService(worker, 1); payWork(world, worker, 'farming'); }
      field.growth = 0; field.harvests++;
      if (field.harvests === 1) world.announce(`${village.name}: собран первый урожай`);
    }
  }
}

