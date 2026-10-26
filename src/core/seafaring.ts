import type { ResourceBundle } from './resources';
import type { World } from './world';
import { Terrain, type Entity, type Vec2 } from './types';

export const SHIP_ID = 'core:ship';
export const HARBOR_ID = 'core:harbor';
export const SHIP_CLEARANCE = 2.6;
export interface HarborState {
  villageId: number | null;
  direction: number;
  built: number;
  launchIn: number;
}
export interface ShipState {
  kind: 'fishing' | 'trade';
  homeId: number | null;
  targetId: number | null;
  heading: number;
  speed: number;
  turn: number;
  sail: number;
  phase: 'docked' | 'sailing' | 'fishing' | 'returning' | 'idle';
  wait: number;
  cargo: number;
  foodGoods?: ResourceBundle;
  cargoOwnerId?: number;
  targetOwnerId?: number | null;
  /** A generated arrival income, never an imaginary mineral cargo. */
  goldVoyage?: { fromId: number; toId: number; departed: number; settled: boolean; income: number };
  path: Vec2[];
  next: number;
  wake: { x: number; y: number; heading: number; age: number }[];
}
declare module './types' { interface ComponentMap { harbor: HarborState; ship: ShipState } }

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleDelta = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
export function harborBerth(harbor: Entity): Vec2 {
  const p = harbor.components.position!, angle = harbor.components.harbor!.direction * Math.PI / 2;
  return { x: p.x + Math.cos(angle) * 5.5, y: p.y + Math.sin(angle) * 5.5 };
}

/** Keep the entire hull clear of coasts, bridges and map edges, including at bends. */
export function canSail(world: World, p: Vec2, radius = SHIP_CLEARANCE): boolean {
  const map = world.terrain;
  if (!map.inside(p.x - radius, p.y - radius) || !map.inside(p.x + radius, p.y + radius)) return false;
  for (let y = Math.floor(p.y - radius); y <= Math.floor(p.y + radius); y++) {
    for (let x = Math.floor(p.x - radius); x <= Math.floor(p.x + radius); x++) {
      const dx = Math.max(x - p.x, 0, p.x - x - 1), dy = Math.max(y - p.y, 0, p.y - y - 1);
      if (dx * dx + dy * dy < radius * radius && !map.isOpenWater(x, y)) return false;
    }
  }
  return true;
}

export function clearSeaSegment(world: World, a: Vec2, b: Vec2): boolean {
  const steps = Math.max(1, Math.ceil(distance(a, b) * 3));
  for (let i = 0; i <= steps; i++) {
    if (!canSail(world, { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps })) return false;
  }
  return true;
}

/** Water-only routes are simplified only when the hull can clear the whole shortcut. */
export function seaRoute(world: World, start: Vec2, end: Vec2): Vec2[] | undefined {
  if (!canSail(world, start) || !canSail(world, end)) return;
  if (clearSeaSegment(world, start, end)) return [{ ...end }];
  const map = world.terrain, first = map.index(start.x, start.y), last = map.index(end.x, end.y);
  const previous = new Int32Array(map.tiles.length).fill(-1), queue = new Int32Array(map.tiles.length);
  previous[first] = first; queue[0] = first;
  let head = 0, tail = 1;
  const point = (i: number): Vec2 => ({ x: i % map.width + 0.5, y: Math.floor(i / map.width) + 0.5 });
  const anchor = point(first);
  if (!clearSeaSegment(world, start, anchor)) return;
  while (head < tail && previous[last] === -1) {
    const current = queue[head++], p = point(current);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (!map.inside(q.x, q.y)) continue;
      const next = map.index(q.x, q.y);
      if (previous[next] !== -1 || !canSail(world, q)) continue;
      previous[next] = current; queue[tail++] = next;
    }
  }
  if (previous[last] === -1 || !clearSeaSegment(world, point(last), end)) return;
  const raw = [{ ...end }];
  for (let i = last; i !== first; i = previous[i]) raw.push(point(i));
  raw.push(anchor); raw.reverse();
  const route: Vec2[] = [];
  let from = start, cursor = 0;
  while (cursor < raw.length) {
    let next = cursor;
    while (next + 1 < raw.length && clearSeaSegment(world, from, raw[next + 1])) next++;
    route.push(raw[next]); from = raw[next]; cursor = next + 1;
  }
  return route;
}

export function harborSite(world: World, p: Vec2): number | undefined {
  const map = world.terrain;
  if (![Terrain.Sand, Terrain.Grass, Terrain.Road].includes(map.at(p.x, p.y))) return;
  if (world.nearby(p, 7).some(e => e.components.harbor || e.components.solid && distance(p, e.components.position!) < 2.2 + e.components.solid.radius)) return;
  for (let direction = 0; direction < 4; direction++) {
    const angle = direction * Math.PI / 2, dx = Math.round(Math.cos(angle)), dy = Math.round(Math.sin(angle));
    if (!map.isLand(p.x - dx, p.y - dy)) continue;
    let clear = true;
    for (let along = 1; along <= 5; along++) for (let across = -1; across <= 1; across++) {
      const x = p.x + dx * along - dy * across, y = p.y + dy * along + dx * across;
      if (!map.isOpenWater(x, y)) clear = false;
    }
    if (clear && canSail(world, { x: p.x + dx * 5.5, y: p.y + dy * 5.5 })) return direction;
  }
}
