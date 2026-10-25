import type { World } from '../core/world';
import { economyOf, recordService } from '../core/village-life';
import { marketOf } from './economy';
import { SOCIAL_EVENT_RATE, Terrain, type Entity, type Vec2, type Village } from '../core/types';
import { findRoadPath, reachableTiles } from './navigation';
import { settlementName } from '../content/settlement-names';
import { bridgeCrossing, ferryCrossing, legacyBridges, roadIsIntact } from '../core/roads';
import { seasonAt } from '../core/seasons';
import { RACES, raceAffinity, raceOf, type RaceId } from '../core/races';

export const villageOf = (world: World, id: number | null | undefined): Village | undefined => world.society.villages.find(v => v.id === id);
export { atWar, diplomacy } from './diplomacy';

export function buildHouse(world: World, position: Vec2, race: RaceId): Entity | undefined {
  const house = world.spawn('core:house', position);
  if (house) {
    house.components.dwelling!.race = race;
    house.components.health = { current: RACES[race].houseHealth, max: RACES[race].houseHealth };
  }
  return house;
}

export function assignHouse(world: World, house: Entity): Village {
  const p = house.components.position!, dwelling = house.components.dwelling!;
  const race = raceOf(house);
  let village = villageOf(world, dwelling.villageId);
  if (village && (village.race ?? 'human') !== race) village = undefined;
  if (!village) village = world.society.villages.filter(v => (v.race ?? 'human') === race && Math.hypot(v.x - p.x, v.y - p.y) <= 18)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (!village) {
    const id = world.society.nextVillageId++;
    village = { id, race, ...p, name: settlementName(world.seed, id, world.society.villages.map(v => v.name)), food: 16, harvested: 0, founded: world.tick, migrationAfter: world.tick + 900 / SOCIAL_EVENT_RATE };
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
    if (world.terrain.at(p.x + x, p.y + y) !== Terrain.Grass) return false;
    const surface = world.terrain.surfaceAt(p.x + x, p.y + y);
    if (surface && ['ice', 'stone', 'water'].includes(surface.kind)) return false;
  }
  return true;
}

function findFarmSite(world: World, village: Village, adults: Entity[]): Vec2 | undefined {
  const distances = reachableTiles(world, adults.map(e => e.components.position!), 40);
  const plannedRoad = new Set(world.society.roads.flatMap(road => road.tiles));
  let best: Vec2 | undefined, bestScore = Infinity;
  world.terrain.circle(village.x, village.y, 14, (x, y, i) => {
    const p = { x: x + 0.5, y: y + 0.5 };
    if (distances[i] < 0 || !fertilePatch(world, p)) return;
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
  if (world.tick % 30 !== 0) return;
  for (const house of world.query('dwelling', 'position')) assignHouse(world, house);
  for (const person of world.query('person', 'citizen')) {
    const home = world.entities.get(person.components.person!.homeId ?? -1);
    if (home?.components.dwelling) person.components.citizen!.villageId = home.components.dwelling.villageId;
  }
  const active = new Set<number>();
  for (const e of world.query('citizen')) if (e.components.citizen!.villageId !== null) active.add(e.components.citizen!.villageId!);
  for (const e of world.query('dwelling')) if (e.components.dwelling!.villageId !== null) active.add(e.components.dwelling!.villageId!);
  for (const village of world.society.villages) {
    if (!active.has(village.id)) {
      world.announce(`Деревня ${village.name} опустела`);
      for (const field of world.query('farm')) if (field.components.farm!.villageId === village.id) world.remove(field.id);
    }
  }
  world.society.villages = world.society.villages.filter(v => active.has(v.id));
  world.society.relations = world.society.relations.filter(r => active.has(r.a) && active.has(r.b));
  world.society.roads = world.society.roads.filter(r => active.has(r.a) && active.has(r.b));

  if (world.tick % 150 === 0) for (const village of world.society.villages) {
    const adults = [...world.query('person', 'citizen', 'position')].filter(e => e.components.citizen!.villageId === village.id && e.components.citizen!.task !== 'migrate' && e.components.person!.age >= 18 && !e.components.thermal?.burning && world.terrain.isLand(e.components.position!.x, e.components.position!.y));
    for (const field of world.query('farm', 'position')) {
      if (field.components.farm!.villageId === village.id && !fertilePatch(world, field.components.position!)) world.remove(field.id);
    }
    const fields = [...world.query('farm')].filter(e => e.components.farm!.villageId === village.id);
    if (seasonAt(world.tick).growth > 0 && adults.length && fields.length < Math.min(8, Math.ceil(adults.length / 4))) {
      const site = findFarmSite(world, village, adults);
      const field = site && world.spawn('core:farm', site);
      if (field) {
        field.components.farm!.villageId = village.id;
        if (!fields.length) world.announce(`${village.name}: жители заложили первые поля`);
      }
    }
  }
}

export function roads(world: World): void {
  if (world.tick % 30 !== 0) return;
  for (const road of world.society.roads) {
    road.bridges ??= legacyBridges(road, world.terrain.tiles, world.terrain.width);
    road.ferries ??= [];
    const end = Math.min(road.tiles.length, road.built + 3);
    while (road.built < end) {
      const i = road.tiles[road.built], tile = world.terrain.tiles[i];
      if (tile < Terrain.Sand) {
        const bank = road.tiles[road.built - 1], width = world.terrain.width;
        if (bank === undefined) break;
        const dx = i % width - bank % width, dy = Math.floor(i / width) - Math.floor(bank / width);
        const bridge = bridgeCrossing(world, bank, dx, dy);
        const span = bridge ?? ferryCrossing(world, bank, dx, dy);
        if (!span || span.some((tile, n) => road.tiles[road.built + n] !== tile)) break;
        if (bridge) for (const tile of span.slice(0, -1)) {
          const terrain = dx ? Terrain.BridgeHorizontal : Terrain.BridgeVertical;
          world.terrain.set(tile % width, Math.floor(tile / width), terrain);
          if (!road.bridges.some(deck => deck.tile === tile)) road.bridges.push({ tile, terrain });
        } else road.ferries.push({ start: road.built - 1, end: road.built + span.length - 1, progress: 0, target: 0, wait: 1, passengers: [] });
        road.built += span.length - 1;
        continue;
      }
      road.built++;
      // Damaged sections are handled by residents, never by automatic construction.
      if (tile === Terrain.Grass || tile === Terrain.Sand) world.terrain.set(i % world.terrain.width, Math.floor(i / world.terrain.width), Terrain.Road);
    }
    if (end > 0 && roadIsIntact(world, road)) {
      const relation = world.society.relations.find(r => r.a === road.a && r.b === road.b);
      if (relation && relation.roadAttempt !== -1) {
        relation.roadAttempt = -1;
        world.announce(`Дорога: ${villageOf(world, road.a)!.name} — ${villageOf(world, road.b)!.name}`);
      }
    }
  }
  // Connect separate road networks first, with at most one bounded path search per second.
  const connected = (a: number, b: number): boolean => {
    const seen = new Set([a]);
    for (const id of seen) for (const road of world.society.roads) {
      if (road.a === id) seen.add(road.b);
      if (road.b === id) seen.add(road.a);
    }
    return seen.has(b);
  };
  const candidates = world.society.relations.filter(r => r.roadAttempt <= world.tick && !world.society.roads.some(road => road.a === r.a && road.b === r.b) && !connected(r.a, r.b));
  candidates.sort((a, b) => {
    const distance = (r: typeof a): number => { const v = villageOf(world, r.a)!, w = villageOf(world, r.b)!; return Math.hypot(v.x - w.x, v.y - w.y); };
    return distance(a) - distance(b);
  });
  const relation = candidates[0];
  if (!relation) return;
  relation.roadAttempt = world.tick + 900;
  const a = villageOf(world, relation.a)!, b = villageOf(world, relation.b)!;
  const entrance = world.findFreePosition(a, 0.2);
  const path = entrance && findRoadPath(world, entrance, b, 2.2, true);
  if (path?.length) world.society.roads.push({ a: a.id, b: b.id, tiles: path.map(p => world.terrain.index(p.x, p.y)), built: 0 });
}

export function agriculture(world: World): void {
  if (world.tick % 30 !== 0) return;
  const season = seasonAt(world.tick);
  const workers = new Map<number, number>();
  for (const e of world.query('citizen', 'position', 'person')) {
    const c = e.components.citizen!, target = world.entities.get(c.targetId ?? -1);
    if (c.task !== 'farm' || !target?.components.farm || e.components.person!.age < 18 || e.components.thermal?.burning) continue;
    const p = e.components.position!, t = target.components.position!;
    if (!world.terrain.isLand(p.x, p.y)) continue;
    if (Math.hypot(p.x - t.x, p.y - t.y) <= 2) workers.set(target.id, (workers.get(target.id) ?? 0) + 1);
  }
  for (const e of world.query('farm')) {
    const field = e.components.farm!, village = villageOf(world, field.villageId);
    if (!village || e.components.thermal?.burning || !fertilePatch(world, e.components.position!)) continue;
    if (season.growth === 0) { field.growth = Math.max(0, field.growth - 0.04); continue; }
    const labour = Math.min(2, workers.get(e.id) ?? 0);
    const p = e.components.position!, soil = world.terrain.biomeAt(p.x, p.y);
    const equipped = (village.economy?.stocks.tools ?? 0) >= 1;
    field.growth = Math.min(1, field.growth + (0.012 + labour * 0.06 * (equipped ? 1.25 : 1) * (1 + (e.components.thermal?.wetness ?? 0))) * season.growth * soil.growth);
    if (field.growth >= 1 && labour > 0) {
      const grain = marketOf(world, village.id) && (field.grain ?? 0) < 24 ? Math.floor(season.yield * 0.3) : 0;
      field.grain = Math.min(2000, (field.grain ?? 0) + grain);
      village.food = Math.min(2000, village.food + season.yield - grain); village.harvested += season.yield;
      if (equipped) economyOf(village).stocks.tools = Math.max(0, economyOf(village).stocks.tools - 0.15);
      for (const worker of world.query('citizen', 'position')) if (worker.components.citizen!.task === 'farm' && worker.components.citizen!.targetId === e.id
        && Math.hypot(worker.components.position!.x - p.x, worker.components.position!.y - p.y) <= 2) recordService(worker, 1);
      field.growth = 0; field.harvests++;
      if (field.harvests === 1) world.announce(`${village.name}: собран первый урожай`);
    }
  }
}

