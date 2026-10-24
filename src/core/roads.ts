import type { World } from './world';
import { ferryAvailable } from './ferries';
import { isBridge, isRoadSurface, MAX_BRIDGE_SPAN, MAX_FERRY_SPAN, Terrain, type BridgeDeck, type Road } from './types';

const intact = new WeakMap<Road, { terrain: World['terrain']; revision: number; built: number; value: boolean }>();

/** Construction progress alone does not guarantee that a road still exists. */
export function roadIsIntact(world: World, road: Road): boolean {
  const terrain = world.terrain, cached = intact.get(road);
  if (!road.ferries?.length && cached && cached.terrain === terrain && cached.revision === terrain.revision && cached.built === road.built) return cached.value;
  const value = road.built === road.tiles.length && road.tiles.every((tile, n) => isRoadSurface(terrain.tiles[tile]) || road.ferries?.some(f => n > f.start && n < f.end && ferryAvailable(world, road, f)));
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
