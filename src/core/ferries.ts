import type { World } from './world';
import { Terrain, type Entity, type Ferry, type Road, type Vec2 } from './types';

export const tilePoint = (world: World, tile: number): Vec2 => ({ x: tile % world.terrain.width + 0.5, y: Math.floor(tile / world.terrain.width) + 0.5 });
export function ferryPosition(world: World, road: Road, ferry: Ferry): Vec2 {
  const a = tilePoint(world, road.tiles[ferry.start]), b = tilePoint(world, road.tiles[ferry.end]);
  return { x: a.x + (b.x - a.x) * ferry.progress, y: a.y + (b.y - a.y) * ferry.progress };
}
export function ferryAvailable(world: World, road: Road, ferry: Ferry): boolean {
  if (road.built <= ferry.end) return false;
  for (const n of [ferry.start, ferry.end]) {
    const p = tilePoint(world, road.tiles[n]);
    if (!world.terrain.isLand(p.x, p.y) || world.terrain.at(p.x, p.y) === Terrain.Mountain
      || world.nearby(p, 1.5).some(e => e.components.solid && Math.hypot(e.components.position!.x - p.x, e.components.position!.y - p.y) < e.components.solid.radius + 0.25)) return false;
  }
  return road.tiles.slice(ferry.start + 1, ferry.end).every(i => world.terrain.tiles[i] < Terrain.Sand);
}
export function* ferryRoutes(world: World): Generator<{ road: Road; ferry: Ferry }> {
  for (const road of world.society.roads) for (const ferry of road.ferries ?? []) yield { road, ferry };
}
export function aboardFerry(world: World, id: number): boolean {
  for (const { ferry } of ferryRoutes(world)) if (ferry.passengers.includes(id)) return true;
  return false;
}
export function ferryLink(world: World, from: Vec2, to: Vec2): { road: Road; ferry: Ferry; side: 0 | 1 } | undefined {
  const first = world.terrain.index(from.x, from.y), last = world.terrain.index(to.x, to.y);
  for (const { road, ferry } of ferryRoutes(world)) {
    const a = road.tiles[ferry.start], b = road.tiles[ferry.end];
    if ((first === a && last === b || first === b && last === a) && ferryAvailable(world, road, ferry)) return { road, ferry, side: first === a ? 0 : 1 };
  }
}
export function nextWaypoint(entity: Entity): Vec2 | undefined {
  const { citizen, caravan } = entity.components;
  return caravan ? caravan.path[caravan.next] : citizen?.path[0];
}
export function waitingForFerry(world: World, entity: Entity): boolean {
  const p = entity.components.position, next = nextWaypoint(entity);
  return !!p && !!next && !!ferryLink(world, p, next);
}
