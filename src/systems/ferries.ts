import type { World } from '../core/world';
import { FERRY_CAPACITY, type Entity } from '../core/types';
import { aboardFerry, ferryAvailable, ferryLink, ferryPosition, ferryRoutes, nextWaypoint, tilePoint } from '../core/ferries';

/** Walk onto the landing, then wait for the boat rather than stepping into the river. */
export function approachFerry(world: World, entity: Entity, dt: number): boolean {
  if (aboardFerry(world, entity.id)) return true;
  const p = entity.components.position!, next = nextWaypoint(entity);
  const link = next && ferryLink(world, p, next);
  if (!link) return false;
  const bank = tilePoint(world, link.road.tiles[link.side ? link.ferry.end : link.ferry.start]);
  const d = Math.hypot(p.x - bank.x, p.y - bank.y), step = Math.min(d, 2 * dt);
  if (d > 0.05) {
    const target = { x: p.x + (bank.x - p.x) / d * step, y: p.y + (bank.y - p.y) / d * step };
    if (world.canStand(target, 0.17, entity.id)) Object.assign(p, target);
  }
  if (entity.components.motion) entity.components.motion.vx = entity.components.motion.vy = 0;
  world.terrain.useRoad(p.x, p.y); world.spatial.update(entity);
  return true;
}

/** Boats shuttle on demand, including an empty return to collect travelers on the other bank. */
export function ferries(world: World, dt: number): void {
  for (const { road, ferry } of ferryRoutes(world)) {
    ferry.passengers = ferry.passengers.filter(id => world.entities.has(id));
    if (!ferryAvailable(world, road, ferry)) {
      // A destroyed landing or a filled channel releases passengers at the actual boat position.
      for (const id of ferry.passengers) {
        const c = world.entities.get(id)?.components.citizen;
        if (c) { c.path = []; c.reconsiderIn = 0; }
      }
      ferry.passengers = [];
      continue;
    }
    const length = ferry.end - ferry.start;
    if (ferry.progress !== ferry.target) {
      const step = 1.8 * dt / length;
      ferry.progress += Math.sign(ferry.target - ferry.progress) * Math.min(step, Math.abs(ferry.target - ferry.progress));
      const position = ferryPosition(world, road, ferry);
      for (const id of ferry.passengers) {
        const e = world.entities.get(id)!;
        Object.assign(e.components.position!, position); world.spatial.update(e);
      }
      if (ferry.progress !== ferry.target) continue;
      // Landing occurs at the far bank, never at a water waypoint.
      for (const id of ferry.passengers) {
        const e = world.entities.get(id)!, { citizen, caravan } = e.components;
        const landing = world.findFreePosition(position, caravan ? 0.4 : 0.17) ?? position;
        Object.assign(e.components.position!, landing); world.spatial.update(e);
        ferry.passengers = ferry.passengers.filter(passenger => passenger !== id);
        if (caravan) caravan.next++;
        else if (citizen) { citizen.path.shift(); citizen.reconsiderIn = Math.max(2, citizen.reconsiderIn); }
        world.terrain.useRoad(position.x, position.y);
      }
      ferry.passengers = []; ferry.wait = 1;
    }
    const waiting: [Entity[], Entity[]] = [[], []];
    for (const e of world.query('position')) {
      if (!e.components.citizen && !e.components.caravan || aboardFerry(world, e.id)) continue;
      const next = nextWaypoint(e), p = e.components.position!;
      const link = next && ferryLink(world, p, next);
      if (!link || link.ferry !== ferry) continue;
      waiting[link.side].push(e);
    }
    const side = ferry.target, position = ferryPosition(world, road, ferry);
    let seats = ferry.passengers.reduce((sum, id) => sum + (world.entities.get(id)!.components.caravan ? FERRY_CAPACITY : 1), 0);
    for (const e of waiting[side]) {
      const cost = e.components.caravan ? FERRY_CAPACITY : 1, p = e.components.position!;
      if (seats + cost > FERRY_CAPACITY || Math.hypot(p.x - position.x, p.y - position.y) > 0.65) continue;
      if (!ferry.passengers.length) ferry.wait = 1;
      ferry.passengers.push(e.id); seats += cost;
      Object.assign(p, position); world.spatial.update(e);
    }
    ferry.wait = Math.max(0, ferry.wait - dt);
    if (ferry.wait === 0 && (ferry.passengers.length || waiting[side ? 0 : 1].length)) ferry.target = side ? 0 : 1;
  }
}
