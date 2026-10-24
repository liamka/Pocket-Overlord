import type { World } from '../core/world';
import { isRoadSurface, ROAD_OVERGROWTH_SECONDS, ROAD_REPAIR_SECONDS, Terrain, type Entity, type Vec2 } from '../core/types';
import { findPath } from './navigation';
import { legacyBridges } from '../core/roads';

interface Repairs {
  jobs: Map<number, Set<number>>;
  claims: Map<number, number>;
  pathsLeft: number;
  decks: Map<number, Terrain.BridgeHorizontal | Terrain.BridgeVertical>;
}
const point = (world: World, tile: number): Vec2 => ({ x: tile % world.terrain.width + 0.5, y: Math.floor(tile / world.terrain.width) + 0.5 });
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const damaged = (world: World, tile: number, decks: Repairs['decks']): boolean => decks.has(tile)
  ? world.terrain.tiles[tile] === Terrain.Water
  : world.terrain.tiles[tile] >= Terrain.Sand && !isRoadSurface(world.terrain.tiles[tile]) && world.terrain.roadWear.get(tile)?.age !== ROAD_OVERGROWTH_SECONDS;

function repairPath(world: World, start: Vec2, destination: Vec2, deck?: Terrain): Vec2[] | undefined {
  if (deck !== undefined) {
    const dx = deck === Terrain.BridgeHorizontal ? 1 : 0, dy = dx ? 0 : 1;
    const banks = [-1, 1].map(sign => ({ x: destination.x + dx * sign, y: destination.y + dy * sign }))
      .filter(p => world.terrain.isLand(p.x, p.y)).sort((a, b) => distance(start, a) - distance(start, b));
    for (const bank of banks) {
      const path = findPath(world, start, bank, 0.1);
      if (path !== undefined) return path.length || distance(start, destination) <= 1.3 ? path : [bank];
    }
    return;
  }
  const path = findPath(world, start, destination, 1.25);
  // Navigation accepts tile centres; the worker may still be outside working distance.
  if (path?.length === 0 && distance(start, destination) > 1.3) path.push(point(world, world.terrain.index(start.x, start.y)));
  return path;
}

/** One scan per decision step, shared by every worker. Only already built sections need repair. */
export function roadRepairs(world: World, people: Entity[]): Repairs {
  const jobs = new Map<number, Set<number>>(), claims = new Map<number, number>(), decks: Repairs['decks'] = new Map();
  for (const road of world.society.roads) {
    road.bridges ??= legacyBridges(road, world.terrain.tiles, world.terrain.width);
    for (const deck of road.bridges) decks.set(deck.tile, deck.terrain);
  }
  for (const road of world.society.roads) for (let n = 0; n < road.built; n++) {
    const tile = road.tiles[n];
    if (!damaged(world, tile, decks)) continue;
    let owners = jobs.get(tile);
    if (!owners) jobs.set(tile, owners = new Set());
    owners.add(road.a); owners.add(road.b);
  }
  for (const e of people) {
    const c = e.components.citizen!;
    if (c.task === 'repair' && c.repair && !claims.has(c.repair.tile)) claims.set(c.repair.tile, e.id);
  }
  // At most four route searches per simulated second, including blocked workers' retries.
  return { jobs, claims, decks, pathsLeft: 2 };
}

function stopRepair(entity: Entity, repairs: Repairs): void {
  const c = entity.components.citizen!;
  if (c.repair && repairs.claims.get(c.repair.tile) === entity.id) repairs.claims.delete(c.repair.tile);
  c.repair = null; c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0;
}

/** Work advances only while a living adult is physically beside the damaged tile. */
export function continueRepair(world: World, entity: Entity, repairs: Repairs): boolean {
  const c = entity.components.citizen!, job = c.repair, p = entity.components.position!;
  if (c.task !== 'repair') return false;
  if (!job || c.villageId === null || !repairs.jobs.get(job.tile)?.has(c.villageId) || !damaged(world, job.tile, repairs.decks)
    || repairs.claims.get(job.tile) !== entity.id || entity.components.person!.age < 18 || c.hunger >= 55
    || entity.components.thermal?.burning || !world.terrain.isLand(p.x, p.y)) {
    stopRepair(entity, repairs); return false;
  }
  const destination = point(world, job.tile);
  if (distance(p, destination) <= 1.3) {
    c.path = []; job.remaining = Math.max(0, job.remaining - 0.5);
    if (job.remaining === 0) {
      world.terrain.set(destination.x, destination.y, repairs.decks.get(job.tile) ?? Terrain.Road);
      world.visual({ kind: 'build', ...destination, radius: 0.5 });
      stopRepair(entity, repairs);
    }
  } else if (c.reconsiderIn <= 0 && repairs.pathsLeft > 0) {
    repairs.pathsLeft--;
    const path = repairPath(world, p, destination, repairs.decks.get(job.tile));
    if (path === undefined) { stopRepair(entity, repairs); return false; }
    c.path = path; c.reconsiderIn = 2;
  }
  return true;
}

export function assignRepair(world: World, entity: Entity, repairs: Repairs): boolean {
  const c = entity.components.citizen!, position = entity.components.position!;
  if (c.villageId === null || c.hunger >= 55 || entity.components.person!.age < 18 || entity.components.thermal?.burning || repairs.pathsLeft === 0) return false;
  let workers = 0;
  for (const id of repairs.claims.values()) if (world.entities.get(id)?.components.citizen?.villageId === c.villageId) workers++;
  if (workers >= 2) return false;
  let nearest: number | undefined, best = Infinity;
  for (const [tile, owners] of repairs.jobs) {
    if (!owners.has(c.villageId) || repairs.claims.has(tile) || !damaged(world, tile, repairs.decks)) continue;
    const deck = repairs.decks.get(tile), target = point(world, tile);
    if (deck !== undefined) {
      const dx = deck === Terrain.BridgeHorizontal ? 1 : 0, dy = dx ? 0 : 1;
      if (![-1, 1].some(sign => world.terrain.isLand(target.x + dx * sign, target.y + dy * sign))) continue;
    }
    const d = distance(position, target);
    if (d < best) { nearest = tile; best = d; }
  }
  if (nearest === undefined) return false;
  repairs.pathsLeft--;
  const path = repairPath(world, position, point(world, nearest), repairs.decks.get(nearest));
  if (path === undefined) return false;
  c.task = 'repair'; c.targetId = null; c.path = path; c.reconsiderIn = 2;
  c.repair = { tile: nearest, remaining: ROAD_REPAIR_SECONDS };
  repairs.claims.set(nearest, entity.id);
  return true;
}
