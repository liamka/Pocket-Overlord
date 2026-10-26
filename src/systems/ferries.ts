import { noteSupply, supplySegmentOpen } from '../core/supply';
import type { World } from '../core/world';
import { liftedIds } from '../core/cataclysms';
import { FERRY_CAPACITY, type Entity } from '../core/types';
import { aboardFerry, ferryAvailable, ferryLink, ferryPosition, ferryRoutes, releaseUnavailableFerries, nextWaypoint, tilePoint } from '../core/ferries';

/** Walk onto the landing, then wait for the boat rather than stepping into the river. */
export function approachFerry(world: World, entity: Entity, dt: number): boolean {
  if (world.paused || aboardFerry(world, entity.id)) return true;
  const p = entity.components.position!, next = nextWaypoint(entity);
  const link = next && ferryLink(world, p, next);
  if (!link) return false;
  const bank = tilePoint(world, link.road.tiles[link.side ? link.ferry.end : link.ferry.start]);
  const d = Math.hypot(p.x - bank.x, p.y - bank.y), step = Math.min(d, 2 * world.terrain.cell(p.x, p.y).movement.speed * dt);
  if (d > 0.05) {
    const target = { x: p.x + (bank.x - p.x) / d * step, y: p.y + (bank.y - p.y) / d * step };
    if (step > 0 && world.canStand(target, 0.17, entity.id)) {
      world.terrain.useRoad(p.x, p.y); Object.assign(p, target); world.terrain.useRoad(p.x, p.y);
    }
  }
  if (entity.components.motion) entity.components.motion.vx = entity.components.motion.vy = 0;
  world.spatial.update(entity);
  return true;
}

/** Boats shuttle on demand, including an empty return to collect travelers on the other bank. */
export function ferries(world: World, dt: number): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  releaseUnavailableFerries(world);
  for (const { road, ferry } of ferryRoutes(world)) {
    ferry.passengers = ferry.passengers.filter(id => world.entities.has(id));
    if (!ferryAvailable(world, road, ferry)) continue;
    const length = ferry.end - ferry.start;
    if (ferry.progress !== ferry.target) {
      const step = 1.8 * dt / length;
      const previous = ferry.progress, before = ferryPosition(world, road, ferry);
      ferry.progress += Math.sign(ferry.target - ferry.progress) * Math.min(step, Math.abs(ferry.target - ferry.progress));
      const position = ferryPosition(world, road, ferry);
      const stopped = ferry.passengers.map(id => world.entities.get(id)!).filter(e => e.components.shipment
        && !supplySegmentOpen(world, e.components.shipment.fromId, before, position));
      if (stopped.length) {
        ferry.progress = previous;
        for (const e of stopped) noteSupply(world, e, 'Supply border closed');
        continue;
      }
      for (const id of ferry.passengers) {
        const e = world.entities.get(id)!;
        Object.assign(e.components.position!, position); world.spatial.update(e);
      }
      if (ferry.progress !== ferry.target) continue;
      ferry.wait = 1;
    }
    if (ferry.passengers.length) {
      const position = ferryPosition(world, road, ferry);
      let blockedLanding = false;
      // Landing occurs at the far bank, never at a water waypoint.
      for (const id of ferry.passengers) {
        const e = world.entities.get(id)!, { citizen, caravan } = e.components;
        const waypoint = nextWaypoint(e);
        // Newly boarded travelers still point to the opposite bank.
        if (waypoint && world.terrain.index(waypoint.x, waypoint.y) !== world.terrain.index(position.x, position.y)) continue;
        const landing = world.findFreePosition(position, caravan ? 0.4 : 0.17);
        if (!landing) { blockedLanding = true; continue; }
        Object.assign(e.components.position!, landing); world.spatial.update(e);
        ferry.passengers = ferry.passengers.filter(passenger => passenger !== id);
        if (caravan) caravan.next++;
        else if (citizen) { citizen.path.shift(); citizen.reconsiderIn = Math.max(2, citizen.reconsiderIn); }
        world.terrain.useRoad(position.x, position.y);
      }
      // Stay at this landing until every passenger has an accessible place to step off.
      if (blockedLanding) continue;
    }
    const waiting: [Entity[], Entity[]] = [[], []];
    for (const e of world.query('position')) {
      if (!e.components.citizen && !e.components.caravan || lifted.has(e.id) || aboardFerry(world, e.id)) continue;
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
