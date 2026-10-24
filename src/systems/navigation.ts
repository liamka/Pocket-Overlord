import type { World } from '../core/world';
import { isRoadSurface, Terrain, type Vec2 } from '../core/types';
import { noise } from '../core/random';
import { bridgeCrossing, ferryCrossing } from '../core/roads';

import { ferryAvailable, ferryRoutes } from '../core/ferries';

const grids = new WeakMap<World, { tick: number; revision: number; size: number; blocked: Uint8Array }>();

/** A short route to a free shore; swimming never opens water routes for land walkers. */
export function findShorePath(world: World, start: Vec2, ignoreId: number): Vec2[] {
  const map = world.terrain, first = map.index(start.x, start.y);
  const previous = new Map<number, number>([[first, first]]), queue = [{ index: first, depth: 0 }];
  for (let head = 0; head < queue.length; head++) {
    const { index: current, depth } = queue[head], x = current % map.width, y = Math.floor(current / map.width);
    if (map.isLand(x, y)) {
      const path: Vec2[] = [];
      for (let i = current; i !== first; i = previous.get(i)!) path.push({ x: i % map.width + 0.5, y: Math.floor(i / map.width) + 0.5 });
      return path.reverse();
    }
    if (depth >= 12) continue;
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      if (!map.inside(nx, ny)) continue;
      const next = ny * map.width + nx;
      if (previous.has(next) || !world.canStand({ x: nx + 0.5, y: ny + 0.5 }, 0.17, ignoreId, true)) continue;
      previous.set(next, current); queue.push({ index: next, depth: depth + 1 });
    }
  }
  return [];
}

function obstacles(world: World): Uint8Array {
  const map = world.terrain, cached = grids.get(world);
  if (cached && cached.tick === world.tick && cached.revision === map.revision && cached.size === world.entities.size) return cached.blocked;
  const blocked = Uint8Array.from(map.tiles, (_, i) => Number(!map.isLand(i % map.width, Math.floor(i / map.width))));
  for (const entity of world.query('solid', 'position')) {
    const p = entity.components.position!, radius = entity.components.solid!.radius + 0.25;
    map.circle(p.x, p.y, radius, (_x, _y, i) => { blocked[i] = 1; });
  }
  grids.set(world, { tick: world.tick, revision: map.revision, size: world.entities.size, blocked });
  return blocked;
}

/** Distance from any available worker; one bounded flood fill for an entire village. */
export function reachableTiles(world: World, starts: Vec2[], maxSteps: number): Int32Array {
  const map = world.terrain, blocked = obstacles(world);
  const distances = new Int32Array(map.tiles.length).fill(-1), queue = new Int32Array(map.tiles.length);
  let head = 0, tail = 0;
  for (const start of starts) {
    if (!map.isLand(start.x, start.y)) continue;
    const i = map.index(start.x, start.y);
    if (distances[i] !== -1) continue;
    distances[i] = 0; queue[tail++] = i;
  }
  while (head < tail) {
    const current = queue[head++];
    if (distances[current] >= maxSteps) continue;
    const x = current % map.width, y = Math.floor(current / map.width);
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      if (!map.inside(nx, ny)) continue;
      const next = ny * map.width + nx;
      if (distances[next] !== -1 || blocked[next]) continue;
      distances[next] = distances[current] + 1; queue[tail++] = next;
    }
  }
  return distances;
}

/** Cardinal land paths. People are transient obstacles handled by movement, never by the route grid. */
export function findPath(world: World, start: Vec2, destination: Vec2, reach = 1.8, canTraverse?: (from: Vec2, to: Vec2) => boolean): Vec2[] | undefined {
  const map = world.terrain;
  if (!map.isLand(start.x, start.y) || !map.isLand(destination.x, destination.y)) return;
  const blocked = obstacles(world), first = map.index(start.x, start.y);
  const crossings = new Map<number, number[]>();
  for (const { road, ferry } of ferryRoutes(world)) if (ferryAvailable(world, road, ferry)) {
    const a = road.tiles[ferry.start], b = road.tiles[ferry.end];
    crossings.set(a, [...crossings.get(a) ?? [], b]); crossings.set(b, [...crossings.get(b) ?? [], a]);
  }
  const previous = new Int32Array(map.tiles.length).fill(-1), queue = new Int32Array(map.tiles.length);
  let head = 0, tail = 1; queue[0] = first; previous[first] = first;
  while (head < tail) {
    const current = queue[head++], x = current % map.width, y = Math.floor(current / map.width);
    if (!blocked[current] && Math.hypot(x + 0.5 - destination.x, y + 0.5 - destination.y) <= reach) {
      const path: Vec2[] = [];
      for (let i = current; i !== first; i = previous[i]) path.push({ x: i % map.width + 0.5, y: Math.floor(i / map.width) + 0.5 });
      // Keep the departure bank when a ferry is the very first step.
      if (path.length && crossings.get(first)?.includes(map.index(path.at(-1)!.x, path.at(-1)!.y))) path.push({ x: first % map.width + 0.5, y: Math.floor(first / map.width) + 0.5 });
      return path.reverse();
    }
    for (const next of crossings.get(current) ?? []) {
      if (previous[next] !== -1 || blocked[next]) continue;
      previous[next] = current; queue[tail++] = next;
    }
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      if (!map.inside(nx, ny)) continue;
      const next = ny * map.width + nx;
      if (previous[next] !== -1 || blocked[next]) continue;
      if (canTraverse && !canTraverse(current === first ? start : { x: x + 0.5, y: y + 0.5 }, { x: nx + 0.5, y: ny + 0.5 })) continue;
      previous[next] = current; queue[tail++] = next;
    }
  }
}

/** Construction follows valleys and clearings, while walking keeps its own traversal rules. */
function roadTerrain(world: World): { blocked: Uint8Array; costs: Float64Array } {
  const map = world.terrain, blocked = obstacles(world).slice(), costs = new Float64Array(map.tiles.length).fill(1);
  const clearance = new Uint8Array(map.tiles.length).fill(4), queue = new Int32Array(map.tiles.length);
  let head = 0, tail = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] < Terrain.Sand || map.tiles[i] === Terrain.Mountain) {
      blocked[i] = 1; clearance[i] = 0; queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++], distance = clearance[i] + 1;
    if (distance >= 4) continue;
    const x = i % map.width, y = Math.floor(i / map.width);
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      const next = ny * map.width + nx;
      if (!map.inside(nx, ny) || clearance[next] <= distance) continue;
      clearance[next] = distance; queue[tail++] = next;
    }
  }
  for (let i = 0; i < costs.length; i++) {
    // Keep some room beside a shore or ridge without closing narrow land passages.
    costs[i] += [0, 1.8, 0.7, 0.15, 0][clearance[i]];
    if (map.tiles[i] === Terrain.Sand) costs[i] += 0.15;
  }
  for (const tree of world.query('position', 'solid')) {
    if (tree.typeId !== 'core:tree') continue;
    const p = tree.components.position!;
    map.circle(p.x, p.y, 4, (x, y, i) => {
      costs[i] += 0.9 * (1 - Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) / 4);
    });
  }
  for (let i = 0; i < costs.length; i++) if (isRoadSurface(map.tiles[i])) costs[i] = 0.65;
  return { blocked, costs };
}

function roadRoute(world: World, start: Vec2, destination: Vec2, reach: number, blocked: Uint8Array, costs: Float64Array, allowFerries: boolean): Vec2[] | undefined {
  const map = world.terrain, first = map.index(start.x, start.y);
  const previous = new Int32Array(map.tiles.length).fill(-1), distances = new Float64Array(map.tiles.length).fill(Infinity);
  type Entry = { tile: number; distance: number; estimate: number };
  const heap: Entry[] = [];
  const push = (tile: number, distance: number): void => {
    const estimate = distance + Math.max(0, Math.hypot(tile % map.width + 0.5 - destination.x, Math.floor(tile / map.width) + 0.5 - destination.y) - reach) * 0.65;
    const entry = { tile, distance, estimate };
    let i = heap.length; heap.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].estimate <= estimate) break;
      heap[i] = heap[parent]; i = parent;
    }
    heap[i] = entry;
  };
  const pop = (): Entry => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].estimate < heap[child].estimate) child++;
        if (heap[child].estimate >= last.estimate) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  previous[first] = first; distances[first] = 0; push(first, 0);
  while (heap.length) {
    const { tile, distance } = pop();
    if (distance !== distances[tile]) continue;
    const x = tile % map.width, y = Math.floor(tile / map.width);
    if (!blocked[tile] && Math.hypot(x + 0.5 - destination.x, y + 0.5 - destination.y) <= reach) {
      const path: Vec2[] = [];
      for (let i = tile; i !== first; i = previous[i]) {
        const parent = previous[i], step = Math.sign(i % map.width - parent % map.width) + Math.sign(Math.floor(i / map.width) - Math.floor(parent / map.width)) * map.width;
        for (let n = i; n !== parent; n -= step) path.push({ x: n % map.width + 0.5, y: Math.floor(n / map.width) + 0.5 });
      }
      // Preserve the near bank even when the crossing is the first route segment.
      if (path.length && map.at(path.at(-1)!.x, path.at(-1)!.y) < Terrain.Sand) path.push({ x: first % map.width + 0.5, y: Math.floor(first / map.width) + 0.5 });
      return path.reverse();
    }
    for (const [nx, ny] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
      if (!map.inside(nx, ny)) continue;
      let next = ny * map.width + nx, bridgeCost = 0;
      if (map.tiles[next] < Terrain.Sand) {
        const bridge = bridgeCrossing(world, tile, nx - x, ny - y);
        const crossing = bridge ?? (allowFerries ? ferryCrossing(world, tile, nx - x, ny - y) : undefined);
        if (!crossing) continue;
        next = crossing.at(-1)!; bridgeCost = (crossing.length - 1) * (bridge ? 4 : 6) + (bridge ? 0 : 12);
      }
      if (blocked[next]) continue;
      const candidate = distance + (costs[tile] + costs[next]) / 2 + bridgeCost;
      if (candidate >= distances[next]) continue;
      distances[next] = candidate; previous[next] = tile; push(next, candidate);
    }
  }
}

/** Shape roads independently of walking routes, retaining edge-connected, obstacle-free tiles. */
export function findRoadPath(world: World, start: Vec2, destination: Vec2, reach = 2.2, allowFerries = false): Vec2[] | undefined {
  const map = world.terrain;
  if (!map.isLand(start.x, start.y) || !map.isLand(destination.x, destination.y)
    || map.at(start.x, start.y) === Terrain.Mountain || map.at(destination.x, destination.y) === Terrain.Mountain) return;
  const { blocked, costs } = roadTerrain(world), path = roadRoute(world, start, destination, reach, blocked, costs, allowFerries);
  if (!path?.length) return path;
  const result: Vec2[] = [];
  // Bridges and their banks stay straight; smooth the land approaches independently.
  for (let i = 0; i < path.length;) {
    if (map.at(path[i].x, path[i].y) < Terrain.Sand) { result.push(path[i++]); continue; }
    let end = i + 1;
    while (end < path.length && map.at(path[end].x, path[end].y) >= Terrain.Sand) end++;
    result.push(...shapeRoadPath(world, path.slice(i, end), blocked, costs)); i = end;
  }
  return result;
}

function shapeRoadPath(world: World, path: Vec2[], blocked: Uint8Array, costs: Float64Array): Vec2[] {
  const map = world.terrain;
  // Walk every crossed grid boundary, including both steps at a diagonal corner.
  const line = (a: Vec2, b: Vec2): number[] | undefined => {
    let x = Math.floor(a.x), y = Math.floor(a.y);
    const endX = Math.floor(b.x), endY = Math.floor(b.y), dx = b.x - a.x, dy = b.y - a.y;
    const sx = Math.sign(dx), sy = Math.sign(dy), tiles: number[] = [];
    let tx = dx ? ((sx > 0 ? x + 1 : x) - a.x) / dx : Infinity;
    let ty = dy ? ((sy > 0 ? y + 1 : y) - a.y) / dy : Infinity;
    while (true) {
      if (!map.inside(x, y) || blocked[y * map.width + x]) return;
      tiles.push(y * map.width + x);
      if (x === endX && y === endY) return tiles;
      if (x !== endX && (y === endY || tx < ty)) { x += sx; tx += 1 / Math.abs(dx); }
      else { y += sy; ty += 1 / Math.abs(dy); }
    }
  };
  const cost = (tiles: number[] | undefined): number => tiles ? tiles.reduce((sum, tile, i) => sum + (i ? (costs[tiles[i - 1]] + costs[tile]) / 2 : 0), 0) : Infinity;
  const curveCost = (points: Vec2[]): number => points.reduce((sum, p, i) => sum + (i ? cost(line(points[i - 1], p)) : 0), 0);
  const mix = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const direction = (a: Vec2, b: Vec2): Vec2 => {
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };

  // A visible shortcut must also respect the terrain cost of the chosen detour.
  const prefix = [0];
  for (let i = 1; i < path.length; i++) prefix.push(prefix[i - 1] + (costs[map.index(path[i - 1].x, path[i - 1].y)] + costs[map.index(path[i].x, path[i].y)]) / 2);
  const anchors = [path[0]];
  for (let i = 0; i < path.length - 1;) {
    let next = path.length - 1;
    while (next > i + 1 && cost(line(path[i], path[next])) > (prefix[next] - prefix[i]) * 1.05) next--;
    anchors.push(path[next]); i = next;
  }
  // Finish a turn farther along the existing surface, leaving room for a tangent
  // approach instead of bending backwards to meet the original square junction.
  for (let i = 1; i < anchors.length - 1; i++) {
    const a = anchors[i - 1], b = anchors[i], c = anchors[i + 1];
    const before = line(a, b)!, after = line(b, c)!;
    const arrivesOnRoad = before.every(tile => isRoadSurface(map.tiles[tile])), leavesOnRoad = after.every(tile => isRoadSurface(map.tiles[tile]));
    if (arrivesOnRoad === leavesOnRoad) continue;
    const incoming = Math.hypot(b.x - a.x, b.y - a.y), outgoing = Math.hypot(c.x - b.x, c.y - b.y);
    const trim = Math.min(8, incoming * 0.35, outgoing * 0.35);
    const join = leavesOnRoad ? mix(b, c, trim / outgoing) : mix(b, a, trim / incoming);
    if (curveCost([a, join, c]) <= (cost(before) + cost(after)) * 1.1) anchors[i] = join;
  }
  const tangents = anchors.map((p, i) => {
    if (i === 0) return direction(p, anchors[Math.min(1, anchors.length - 1)]);
    if (i === anchors.length - 1) return direction(anchors[i - 1], p);
    const incoming = direction(anchors[i - 1], p), outgoing = direction(p, anchors[i + 1]);
    const arrivesOnRoad = line(anchors[i - 1], p)!.every(tile => isRoadSurface(map.tiles[tile]));
    const leavesOnRoad = line(p, anchors[i + 1])!.every(tile => isRoadSurface(map.tiles[tile]));
    if (leavesOnRoad && !arrivesOnRoad) return outgoing;
    if (arrivesOnRoad && !leavesOnRoad) return incoming;
    return direction({ x: 0, y: 0 }, { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y });
  });
  let shaped = [anchors[0]];
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1], b = anchors[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    const straight = line(a, b)!, onRoad = straight.every(tile => isRoadSurface(map.tiles[tile]));
    const joinsRoad = isRoadSurface(map.at(a.x, a.y)) || isRoadSurface(map.at(b.x, b.y));
    const bend = joinsRoad ? 0 : (noise(map.index(a.x, a.y), map.index(b.x, b.y), world.seed) < 0.5 ? -1 : 1) * Math.min(2.5, length * 0.09);
    const handle = Math.min(10, length / 3), incoming = tangents[i - 1], outgoing = tangents[i];
    const c = { x: a.x + incoming.x * handle, y: a.y + incoming.y * handle }, d = { x: b.x - outgoing.x * handle, y: b.y - outgoing.y * handle };
    let segment = [a, b];
    // Shared tangents round bends and approaches to existing roads. The bow has zero
    // slope at both ends, so adjacent spans keep the same direction at their join.
    for (const scale of [1, 0.5, 0.25]) {
      const samples = Math.max(4, Math.ceil(length * 2));
      const candidate = Array.from({ length: samples + 1 }, (_, n) => {
        const t = n / samples, u = 1 - t, offset = Math.sin(Math.PI * t) ** 2 * bend * scale;
        const curve = { x: u ** 3 * a.x + 3 * u * u * t * c.x + 3 * u * t * t * d.x + t ** 3 * b.x,
          y: u ** 3 * a.y + 3 * u * u * t * c.y + 3 * u * t * t * d.y + t ** 3 * b.y };
        const p = mix(mix(a, b, t), curve, scale);
        return { x: p.x - dy / length * offset, y: p.y + dx / length * offset };
      });
      if (curveCost(candidate) <= cost(straight) * (onRoad ? 1.05 : 1.2)) { segment = candidate; break; }
    }
    shaped.push(...segment.slice(1));
  }
  // Round the joins only where the cut stays on free land, preserving narrow passages.
  for (let pass = 0; pass < 2; pass++) {
    const rounded = [shaped[0]];
    for (let i = 1; i < shaped.length - 1; i++) {
      const a = mix(shaped[i], shaped[i - 1], 0.25), b = mix(shaped[i], shaped[i + 1], 0.25);
      if (cost(line(a, b)) <= curveCost([a, shaped[i], b]) * 1.05) rounded.push(a, b); else rounded.push(shaped[i]);
    }
    rounded.push(shaped.at(-1)!);
    if (Number.isFinite(curveCost(rounded))) shaped = rounded;
  }
  const tiles: number[] = [], visited = new Map<number, number>();
  for (let i = 0; i < shaped.length; i++) {
    for (const tile of line(shaped[Math.max(0, i - 1)], shaped[i])!) {
      // Rasterizing a shallow bend may touch a tile twice. Erase loops without leaving gaps.
      const previous = visited.get(tile);
      if (previous !== undefined) {
        while (tiles.length > previous + 1) visited.delete(tiles.pop()!);
      } else { visited.set(tile, tiles.length); tiles.push(tile); }
    }
  }
  return tiles.map(i => ({ x: i % map.width + 0.5, y: Math.floor(i / map.width) + 0.5 }));
}
