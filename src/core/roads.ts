import { jobVacancy } from './jobs';
import type { World } from './world';
import { ferryAvailable } from './ferries';
import { buildingOwner, operational } from './buildings';
import { zoneAt, zoneOwner } from './territory';
import { hazardAreas } from './geohazards';
import { isBridge, isRoadSurface, MAX_BRIDGE_SPAN, MAX_FERRY_SPAN, ROAD_OVERGROWTH_SECONDS, Terrain, type BridgeDeck, type Road } from './types';

export const ROAD_PROBLEMS = ['Roads connected', 'Road needs buildings', 'No road route', 'Road crosses another territory',
  'No available workers', 'Workers are busy', 'No route to the target', 'Road work is unsafe', 'Road endpoint is gone', 'Road is abandoned', 'Waiting for a worker', 'Road construction', 'Road surface changed'] as const;
export type RoadProblem = typeof ROAD_PROBLEMS[number];
export interface RoadWork { road: Road; tile: number; terrain: Terrain; next?: number; ferry?: { start: number; end: number } }
export const roadPoint = (world: World, tile: number) => ({ x: tile % world.terrain.width + 0.5, y: Math.floor(tile / world.terrain.width) + 0.5 });

/** Historical building IDs never get reassigned to a replacement building. */
export function roadOwned(world: World, road: Road): boolean {
  return [road.a, road.b].every(id => world.society.villages.some(v => v.id === id))
    && (!road.buildings || road.buildings.every(id => {
      const e = world.entities.get(id); return !!e && buildingOwner(e) === road.a && operational(e) && !e.components.ruin;
    }));
}
export function roadWorkProblem(world: World, work: RoadWork): RoadProblem | undefined {
  if (!roadOwned(world, work.road)) return 'Road endpoint is gone';
  const p = roadPoint(world, work.tile), owner = zoneOwner(world, zoneAt(world, p));
  if (owner && owner.id !== work.road.a && owner.id !== work.road.b || work.road.buildings && owner?.id !== work.road.a) return 'Road crosses another territory';
  if (world.society.relations.some(r => r.status === 'war' && (r.a === work.road.a || r.b === work.road.a || r.a === work.road.b || r.b === work.road.b))
    || world.terrain.cell(p.x, p.y).damagePerSecond > 0
    || hazardAreas(world).some(a => Math.hypot(a.x - p.x, a.y - p.y) < a.radius + 2)
    || world.nearby(p, 8).some(e => (e.components.thermal?.burning || e.components.explosive)
      && Math.hypot(e.components.position!.x - p.x, e.components.position!.y - p.y) < (e.components.explosive?.radius ?? 3) + 2)) return 'Road work is unsafe';
  if (work.terrain === Terrain.Road && !world.terrain.canWalk(p.x, p.y)) return 'Road surface changed';
  if (!work.ferry && world.nearby(p, 1.5).some(e => e.components.solid
    && Math.hypot(e.components.position!.x - p.x, e.components.position!.y - p.y) < e.components.solid.radius + 0.25)) return 'Road surface changed';
}

/** The frontier advances one physical job at a time. Existing surfaces need no new labour. */
export function roadFront(world: World, road: Road): RoadWork | undefined {
  const n = road.built, tile = road.tiles[n], map = world.terrain;
  if (tile === undefined) return;
  const base = map.tiles[tile];
  if (base === Terrain.Grass || base === Terrain.Sand || base === Terrain.Scorched || base === Terrain.Crater)
    return { road, tile, terrain: Terrain.Road, next: n + 1 };
  if (base !== Terrain.Water && base !== Terrain.DeepWater || n === 0) return;
  // A partly built deck is still the same short crossing, not a new bank.
  let start = n - 1;
  while (start > 0 && isBridge(map.tiles[road.tiles[start]])) start--;
  const bank = road.tiles[start], step = road.tiles[start + 1] - bank;
  let end = n;
  while (end < road.tiles.length && map.tiles[road.tiles[end]] < Terrain.Sand) end++;
  if (end >= road.tiles.length || !map.canWalk(road.tiles[end] % map.width, Math.floor(road.tiles[end] / map.width))
    || !map.canWalk(bank % map.width, Math.floor(bank / map.width))
    || ![1, map.width].includes(Math.abs(step)) || !road.tiles.slice(start + 1, end + 1).every((t, i) => t === bank + step * (i + 1))) return;
  if (end - start - 1 <= MAX_BRIDGE_SPAN && road.tiles.slice(start + 1, end).every(t => map.tiles[t] === Terrain.Water || isBridge(map.tiles[t])))
    return { road, tile, terrain: Math.abs(step) === 1 ? Terrain.BridgeHorizontal : Terrain.BridgeVertical, next: n + 1 };
  if (start !== n - 1) return;
  const span = ferryCrossing(world, bank, Math.abs(step) === 1 ? Math.sign(step) : 0, Math.abs(step) === map.width ? Math.sign(step) : 0);
  if (span?.every((t, i) => t === road.tiles[n + i])) return { road, tile: bank, terrain: map.tiles[bank], next: end, ferry: { start, end } };
}
export function roadWorks(world: World, road: Road): RoadWork[] {
  if (!roadOwned(world, road)) return [];
  const jobs: RoadWork[] = [], decks = road.bridges ?? legacyBridges(road, world.terrain.tiles, world.terrain.width);
  for (let n = 0; n < road.built; n++) {
    const tile = road.tiles[n], base = world.terrain.tiles[tile], wear = world.terrain.roadWear.get(tile);
    if (isRoadSurface(base) || wear?.age === ROAD_OVERGROWTH_SECONDS || road.ferries?.some(f => n > f.start && n < f.end)) continue;
    const deck = decks.find(d => d.tile === tile);
    if (deck ? base === Terrain.Water || base === Terrain.DeepWater && wear?.target === Terrain.DeepWater : [Terrain.Sand, Terrain.Grass, Terrain.Scorched, Terrain.Crater].includes(base))
      jobs.push({ road, tile, terrain: deck?.terrain ?? Terrain.Road });
  }
  const front = roadFront(world, road); if (front) jobs.push(front);
  return jobs;
}
export function roadProblem(world: World, road: Road): RoadProblem {
  if (!roadOwned(world, road)) return 'Road endpoint is gone';
  if (roadIsIntact(world, road)) return 'Roads connected';
  const work = roadWorks(world, road)[0];
  if (!work) return road.tiles.some(t => world.terrain.roadWear.get(t)?.age === ROAD_OVERGROWTH_SECONDS) ? 'Road is abandoned' : 'Road surface changed';
  const problem = roadWorkProblem(world, work); if (problem) return problem;
  if ([...world.query('citizen')].some(e => e.components.citizen!.task === 'repair' && e.components.citizen!.repair?.tile === work.tile)) return 'Road construction';
  const reasons = world.society.villages.filter(v => v.id === road.a || v.id === road.b).map(v => jobVacancy(world, v, 'roadBuilder').reason);
  if (reasons.includes('Waiting for a worker')) return 'Waiting for a worker';
  if (reasons.includes('No route to the target')) return 'No route to the target';
  return reasons.includes('Workers are busy') ? 'Workers are busy' : reasons.every(r => r === 'No available workers') ? 'No available workers' : 'Waiting for a worker';
}

const intact = new WeakMap<Road, { terrain: World['terrain']; revision: number; built: number; value: boolean }>();

/** Construction progress alone does not guarantee that a road still exists. */
export function roadIsIntact(world: World, road: Road): boolean {
  const terrain = world.terrain, cached = intact.get(road);
  if (!road.ferries?.length && cached && cached.terrain === terrain && cached.revision === terrain.revision && cached.built === road.built) return cached.value;
  const value = road.built === road.tiles.length && road.tiles.every((tile, n) => isRoadSurface(terrain.tiles[tile]) && terrain.canWalk(tile % terrain.width, Math.floor(tile / terrain.width)) || road.ferries?.some(f => n > f.start && n < f.end && ferryAvailable(world, road, f)));
  intact.set(road, { terrain, revision: terrain.revision, built: road.built, value });
  return value;
}

/** A straight, shallow crossing with solid banks at both ends. Includes the far bank. */
export function bridgeCrossing(world: World, start: number, dx: number, dy: number): number[] | undefined {
  return waterCrossing(world, start, dx, dy, false);
}

export function ferryCrossing(world: World, start: number, dx: number, dy: number): number[] | undefined {
  return waterCrossing(world, start, dx, dy, true);
}

function waterCrossing(world: World, start: number, dx: number, dy: number, ferry: boolean): number[] | undefined {
  const map = world.terrain;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  const clear = (x: number, y: number): boolean => !world.nearby({ x: x + 0.5, y: y + 0.5 }, 1.5).some(e =>
    e.components.solid && Math.hypot(e.components.position!.x - x - 0.5, e.components.position!.y - y - 0.5) < e.components.solid.radius + 0.25);
  const bank = (x: number, y: number): boolean => map.isLand(x, y) && map.at(x, y) !== Terrain.Mountain && !isBridge(map.at(x, y)) && clear(x, y);
  let x = start % map.width, y = Math.floor(start / map.width);
  if (!bank(x, y)) return;
  const tiles: number[] = [];
  for (let n = 0; n <= (ferry ? MAX_FERRY_SPAN : MAX_BRIDGE_SPAN); n++) {
    x += dx; y += dy;
    if (!map.inside(x, y) || !clear(x, y)) return;
    if (map.at(x, y) !== Terrain.Water && (!ferry || map.at(x, y) !== Terrain.DeepWater)) return tiles.length && (!ferry || tiles.length > MAX_BRIDGE_SPAN) && bank(x, y) ? [...tiles, map.index(x, y)] : undefined;
    tiles.push(map.index(x, y));
  }
}

/** Recover intended decks from older roads, including shallow gaps left by destruction. */
export function legacyBridges(road: Road, tiles: number[], width: number): BridgeDeck[] {
  const decks: BridgeDeck[] = [];
  for (let n = 0; n < road.built; n++) {
    const tile = road.tiles[n], terrain = tiles[tile];
    if (isBridge(terrain)) decks.push({ tile, terrain });
    else if (terrain === Terrain.Water && n > 0) {
      let end = n;
      while (end < road.built && tiles[road.tiles[end]] === Terrain.Water) end++;
      const before = road.tiles[n - 1], after = road.tiles[end], step = road.tiles[n] - before;
      if (end - n <= MAX_BRIDGE_SPAN && after !== undefined && isRoadSurface(tiles[before]) && isRoadSurface(tiles[after])
        && (Math.abs(step) === 1 || Math.abs(step) === width)
        && road.tiles.slice(n, end + 1).every((t, i) => t === before + step * (i + 1))) {
        for (let j = n; j < end; j++) decks.push({ tile: road.tiles[j], terrain: Math.abs(step) === 1 ? Terrain.BridgeHorizontal : Terrain.BridgeVertical });
      }
      n = end - 1;
    }
  }
  return decks;
}
