import { payWork } from '../core/currency';
import { isAdult } from '../core/unit-stats';
import type { World } from '../core/world';
import { isBridge, ROAD_REPAIR_SECONDS, Terrain, type Entity, type Vec2 } from '../core/types';
import { findPath } from './navigation';
import { legacyBridges, roadWorks, roadWorkProblem, type RoadWork } from '../core/roads';
import { RACES, raceOf } from '../core/races';
import { claimJob, releaseJob } from '../core/jobs';

interface Repairs {
  jobs: Map<number, RoadWork[]>;
  claims: Map<number, number>;
  pathsLeft: number;
}
const point = (world: World, tile: number): Vec2 => ({ x: tile % world.terrain.width + 0.5, y: Math.floor(tile / world.terrain.width) + 0.5 });
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const available = (world: World, work: RoadWork): boolean => !roadWorkProblem(world, work)
  && roadWorks(world, work.road).some(w => w.tile === work.tile && w.terrain === work.terrain && w.next === work.next && !!w.ferry === !!work.ferry);
const forWorker = (world: World, repairs: Repairs, tile: number, village: number): RoadWork | undefined => repairs.jobs.get(tile)
  ?.find(w => (w.road.a === village || w.road.b === village) && available(world, w));

function repairPath(world: World, start: Vec2, destination: Vec2, deck?: Terrain, landing = false): Vec2[] | undefined {
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
  const path = findPath(world, start, destination, landing ? 0.1 : 1.25);
  // Navigation accepts tile centres; the worker may still be outside working distance.
  if (path?.length === 0 && distance(start, destination) > 1.3) path.push(point(world, world.terrain.index(start.x, start.y)));
  return path;
}

/** Construction and repairs share the same queue, job slots and exclusive tile claims. */
export function roadRepairs(world: World, people: Entity[]): Repairs {
  const jobs = new Map<number, RoadWork[]>(), claims = new Map<number, number>();
  for (const road of world.society.roads) {
    road.bridges ??= legacyBridges(road, world.terrain.tiles, world.terrain.width);
    for (const work of roadWorks(world, road)) jobs.set(work.tile, [...(jobs.get(work.tile) ?? []), work]);
  }
  for (const e of people) {
    const c = e.components.citizen!;
    if ((e.components.health?.current ?? 1) > 0 && c.task === 'repair' && c.repair && !claims.has(c.repair.tile)) claims.set(c.repair.tile, e.id);
  }
  return { jobs, claims, pathsLeft: 2 };
}

function stopRepair(entity: Entity, repairs: Repairs): void {
  releaseJob(entity);
  const c = entity.components.citizen!;
  if (c.repair && repairs.claims.get(c.repair.tile) === entity.id) repairs.claims.delete(c.repair.tile);
  c.repair = null; c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0;
}

/** Work advances only while a living adult is physically beside the damaged tile. */
export function continueRepair(world: World, entity: Entity, repairs: Repairs): boolean {
  if (world.paused) return false;
  const c = entity.components.citizen!, job = c.repair, p = entity.components.position!;
  if (c.task !== 'repair') return false;
  const work = job && c.villageId !== null ? forWorker(world, repairs, job.tile, c.villageId) : undefined;
  if (job && work && !claimJob(world, entity, 'roadBuilder', null, undefined, job.tile)) { stopRepair(entity, repairs); return false; }
  if (!job || c.villageId === null || !work
    || repairs.claims.get(job.tile) !== entity.id || !isAdult(entity) || c.hunger >= 55
    || (entity.components.health?.current ?? 0) <= 0 || !RACES[raceOf(entity)].roads
    || entity.components.thermal?.burning || !world.terrain.isLand(p.x, p.y)) {
    stopRepair(entity, repairs); return false;
  }
  const destination = point(world, job.tile);
  if (distance(p, destination) <= (work.ferry ? 0.65 : 1.3)) {
    c.path = []; job.remaining = Math.max(0, job.remaining - 0.5 / RACES[raceOf(entity)].construction);
    if (job.remaining === 0) {
      if (work.ferry) {
        (work.road.ferries ??= []).push({ ...work.ferry, progress: 0, target: 0, wait: 1, passengers: [] });
      } else {
        world.terrain.set(destination.x, destination.y, work.terrain);
        if (isBridge(work.terrain) && !work.road.bridges!.some(d => d.tile === job.tile)) work.road.bridges!.push({ tile: job.tile, terrain: work.terrain === Terrain.BridgeHorizontal ? Terrain.BridgeHorizontal : Terrain.BridgeVertical });
      }
      if (work.next !== undefined) work.road.built = work.next;
      repairs.jobs.delete(job.tile);
      payWork(world, entity, 'road');
      world.visual({ kind: 'build', ...destination, radius: 0.5 });
      stopRepair(entity, repairs);
    }
  } else if (c.reconsiderIn <= 0 && repairs.pathsLeft > 0) {
    repairs.pathsLeft--;
    const path = repairPath(world, p, destination, isBridge(work.terrain) ? work.terrain : undefined, !!work.ferry);
    if (path === undefined) { stopRepair(entity, repairs); c.jobProblem = { kind: 'roadBuilder', reason: 'No route to the target' }; return false; }
    c.path = path; c.reconsiderIn = 2;
  }
  return true;
}

export function assignRepair(world: World, entity: Entity, repairs: Repairs): boolean {
  if (world.paused) return false;
  const c = entity.components.citizen!, position = entity.components.position!;
  if (c.villageId === null || c.hunger >= 55 || !isAdult(entity) || entity.components.thermal?.burning || repairs.pathsLeft === 0 || !RACES[raceOf(entity)].roads) return false;
  let workers = 0;
  for (const id of repairs.claims.values()) if (world.entities.get(id)?.components.citizen?.villageId === c.villageId) workers++;
  if (workers >= 2) return false;
  let nearest: number | undefined, best = Infinity;
  for (const tile of repairs.jobs.keys()) {
    const work = forWorker(world, repairs, tile, c.villageId);
    if (!work || repairs.claims.has(tile)) continue;
    const deck = isBridge(work.terrain) ? work.terrain : undefined, target = point(world, tile);
    if (deck !== undefined) {
      const dx = deck === Terrain.BridgeHorizontal ? 1 : 0, dy = dx ? 0 : 1;
      if (![-1, 1].some(sign => world.terrain.isLand(target.x + dx * sign, target.y + dy * sign))) continue;
    }
    const d = distance(position, target);
    if (d < best) { nearest = tile; best = d; }
  }
  if (nearest === undefined) return false;
  repairs.pathsLeft--;
  const work = forWorker(world, repairs, nearest, c.villageId)!;
  const path = repairPath(world, position, point(world, nearest), isBridge(work.terrain) ? work.terrain : undefined, !!work.ferry);
  if (path === undefined) {
    const village = world.society.villages.find(v => v.id === c.villageId);
    if (village?.roadPlan) village.roadPlan.problem = 'No road route';
    c.jobProblem = { kind: 'roadBuilder', reason: 'No route to the target' };
    return false;
  }
  if (work.ferry && !path.length && distance(position, point(world, nearest)) > 0.65) path.push(point(world, nearest));
  if (!claimJob(world, entity, 'roadBuilder', null, undefined, nearest)) return false;
  c.task = 'repair'; c.targetId = null; c.path = path; c.reconsiderIn = 2;
  c.repair = { tile: nearest, remaining: ROAD_REPAIR_SECONDS };
  repairs.claims.set(nearest, entity.id);
  return true;
}
