import { loadShipment, noteSupply, returnShipment, shipmentSize, shipmentStoreFits, supplyBlock, supplyBorderOpen, supplyChoices, supplyLoad, supplyPolicy, supplySegmentOpen, unloadShipment, type SupplyGood } from '../core/supply';
import { deliverFood, packedFood, deposit } from '../core/resource-ledger';
import { aboardFerry, ferryLink } from '../core/ferries';
import { approachFerry } from './ferries';
import type { World } from '../core/world';
import { SOCIAL_EVENT_RATE, type Entity, type Vec2 } from '../core/types';
import { findPath } from './navigation';
import { roadIsIntact } from '../core/roads';
import { clearStorageApproach, deliveryStore, initializeStorage, storageOwner, storageRoute, storesOf } from '../core/stockpiles';

const LIMIT = 32;
const village = (world: World, id: number | null) => world.society.villages.find(v => v.id === id);
const peaceful = (world: World, a: number, b: number | null): boolean => world.society.relations.some(r => (r.a === a && r.b === b || r.b === a && r.a === b) && r.status !== 'war');
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// Residents can pass a wagon. Buildings and water still block it.
function passable(world: World, p: Vec2): boolean {
  return world.terrain.canWalk(p.x, p.y) && !world.nearby(p, 1.4).some(e => e.components.solid && distance(p, e.components.position!) < e.components.solid.radius + 0.2);
}

function clearSegment(world: World, a: Vec2, b: Vec2): boolean {
  if (ferryLink(world, a, b)) return true;
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  const steps = Math.max(1, Math.ceil(Math.sqrt(squared) / 0.25));
  for (let i = 0; i <= steps; i++) if (!world.terrain.canWalk(a.x + dx * i / steps, a.y + dy * i / steps)) return false;
  return !world.nearby({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.sqrt(squared) / 2 + 1.4).some(e => {
    if (!e.components.solid) return false;
    const p = e.components.position!, t = squared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < e.components.solid.radius + 0.2;
  });
}

/** Choose a reachable physical store before reserving a unique batch. */
export function dispatchCaravan(world: World, fromId: number, toId: number, requested = 12, good: SupplyGood = 'food'): boolean {
  const from = village(world, fromId), to = village(world, toId);
  if (world.paused || !from || !to || fromId === toId || !peaceful(world, fromId, toId)
    || [...world.query('caravan')].length >= LIMIT || supplyBlock(world, from, to, good)) return false;
  initializeStorage(world, from); initializeStorage(world, to);
  const road = world.society.roads.find(r => (r.a === fromId && r.b === toId || r.b === fromId && r.a === toId) && roadIsIntact(world, r));
  if (!road?.tiles.length) return false;
  let path = road.tiles.filter((_, n) => !road.ferries?.some(f => n > f.start && n < f.end)).map(i => ({ x: i % world.terrain.width + 0.5, y: Math.floor(i / world.terrain.width) + 0.5 }));
  if (road.a !== fromId) path.reverse();
  // Older roads can include a house's centre at their endpoints.
  while (path.length && !passable(world, path[0]) && distance(path[0], from) < 3) path.shift();
  while (path.length && !passable(world, path.at(-1)!) && distance(path.at(-1)!, to) < 3) path.pop();
  if (path.length < 2 || !passable(world, path[0])) return false;
  if (!path.every((p, i) => passable(world, p) && (i === 0 || clearSegment(world, path[i - 1], p)))) {
    const detour = findPath(world, path[0], to, 2.2, (a, b) => clearSegment(world, a, b) && supplySegmentOpen(world, fromId, a, b));
    if (!detour?.length) return false;
    path = [path[0], ...detour];
  }

  for (const store of storesOf(from)) {
    const source = world.entities.get(store.buildingId);
    if (!source || storageOwner(source) !== fromId || source.components.thermal?.burning) continue;
    const load = supplyLoad(world, from, to, source.id, good, requested);
    if (!load) continue;
    const approach = storageRoute(world, path[0], source);
    if (!approach) continue;
    const goods = load.items.length ? { stoneAxes: load.items.length } : load.goods;
    const drop = deliveryStore(world, to, path.at(-1)!, goods, true);
    if (!drop || !shipmentStoreFits(world, drop.building, load)) continue;
    const route = [...approach.reverse(), ...path, ...drop.path];
    if (!route.every((p, i) => supplyBorderOpen(world, fromId, p) && (!i || supplySegmentOpen(world, fromId, route[i - 1], p)))) continue;
    const entity = world.spawn('core:caravan', route[0]);
    if (!entity) return false;
    Object.assign(entity.components.caravan!, { fromId, toId, path: route, next: 1 });
    if (!loadShipment(world, entity, from, to, source, drop.building, good, load)) { world.remove(entity.id); continue; }
    return true;
  }
  return false;
}

function returnHome(world: World, entity: Entity): void {
  const c = entity.components.caravan!;
  if (aboardFerry(world, entity.id)) c.reroute = true;
  else { c.path = c.path.slice(0, c.next).reverse(); c.next = 0; }
  c.returning = true; c.retryIn = 0;
  const home = village(world, c.fromId);
  if (home) world.announce(`Караван возвращается в ${home.name}`);
}

export function caravans(world: World, dt: number): void {
  if (world.paused) return;
  for (const entity of world.query('caravan', 'position')) {
    const c = entity.components.caravan!, p = entity.components.position!;
    const home = village(world, c.fromId), destination = village(world, c.toId);
    if (!home) { world.remove(entity.id); continue; }
    const shipment = entity.components.shipment;
    const targetStore = shipment && world.entities.get(shipment.destinationId);
    if (shipment && shipment.phase === 'outbound' && (!destination || !peaceful(world, c.fromId, c.toId)
      || !targetStore || storageOwner(targetStore) !== shipment.toId)) {
      returnShipment(world, entity, destination && !peaceful(world, c.fromId, c.toId) ? 'Supply relations changed' : 'Supply destination gone');
      returnHome(world, entity); c.reroute = true;
    }
    if (!c.returning && (!destination || !peaceful(world, c.fromId, c.toId))) returnHome(world, entity);
    if (!destination) c.toId = null;
    if (aboardFerry(world, entity.id)) continue;
    c.retryIn = Math.max(0, c.retryIn - dt);
    if (c.reroute) {
      if (c.retryIn > 0) continue;
      const path = findPath(world, p, c.returning ? home : destination!, 2.2, (a, b) => clearSegment(world, a, b) && supplySegmentOpen(world, c.fromId, a, b));
      if (path === undefined) { c.retryIn = 2; if (shipment) noteSupply(world, entity, 'Supply route blocked'); continue; }
      c.path = path; c.next = 0; delete c.reroute;
      if (shipment && shipment.phase === 'outbound') noteSupply(world, entity, 'Supply travelling');
    }
    const nextGoal = c.path[c.next];
    if (nextGoal && !supplySegmentOpen(world, c.fromId, p, nextGoal)) {
      c.reroute = true; c.retryIn = 2;
      if (shipment) noteSupply(world, entity, 'Supply border closed');
      continue;
    }
    if (approachFerry(world, entity, dt)) continue;
    let remaining = dt;
    while (remaining > 0 && c.next < c.path.length) {
      const goal = c.path[c.next], d = distance(p, goal);
      if (d < 0.001) { c.next++; if (approachFerry(world, entity, dt)) break; continue; }
      const speed = 2.2 * world.terrain.cell(p.x, p.y).movement.speed;
      const step = Math.min(remaining * speed, d, 0.2), next = { x: p.x + (goal.x - p.x) / d * step, y: p.y + (goal.y - p.y) / d * step };
      if (!passable(world, next) || !supplyBorderOpen(world, c.fromId, next)) {
        if (shipment) noteSupply(world, entity, supplyBorderOpen(world, c.fromId, next) ? 'Supply route blocked' : 'Supply border closed');
        c.reroute = true; c.retryIn = 2;
        break;
      }
      world.terrain.useRoad(p.x, p.y);
      p.x = next.x; p.y = next.y; remaining -= step / speed;
      world.terrain.useRoad(p.x, p.y);
    }
    world.spatial.update(entity);
    if (c.next < c.path.length) continue;
    const recipient = c.returning ? home : destination;
    if (shipment) {
      if (shipment.phase === 'complete') {
        if (c.returning) world.remove(entity.id); else returnHome(world, entity);
        continue;
      }
      if (!recipient) continue;
      const goods = shipment.itemIds.length ? { stoneAxes: shipment.itemIds.length } : shipment.goods;
      const drop = deliveryStore(world, recipient, p, goods);
      if (!drop || !shipmentStoreFits(world, drop.building, { goods: shipment.goods,
        items: world.equipment.items.filter(i => shipment.itemIds.includes(i.id)) })) { noteSupply(world, entity, 'Supply storage full'); continue; }
      if (!clearStorageApproach(world, p, drop.building)) {
        if (!drop.path.every((q, i) => supplySegmentOpen(world, c.fromId, i ? drop.path[i - 1] : p, q))) {
          noteSupply(world, entity, 'Supply border closed'); continue;
        }
        c.path.push(...drop.path); continue;
      }
      unloadShipment(world, entity, recipient, drop.building);
      if (!shipmentSize(shipment)) { if (c.returning) world.remove(entity.id); else returnHome(world, entity); }
      continue;
    }
    const drop = recipient && deliveryStore(world, recipient, p, c.gems ? { gems: c.gems } : packedFood(c.food, c.foodGoods), !!c.gems);
    if ((c.food > 1e-8 || c.gems) && !drop) continue; // Keep the load until space and a route become available.
    if (drop && !clearStorageApproach(world, p, drop.building)) {
      c.path.push(...drop.path); continue;
    }
    if (c.gems && recipient && drop) {
      const delivered = deposit(recipient, { gems: c.gems }, drop.building.id).gems ?? 0;
      c.gems -= delivered;
      if (delivered) world.announce(`Gem caravan arrived in ${recipient.name}: ${delivered} gems`);
      if (c.gems) continue;
      if (c.returning) world.remove(entity.id); else returnHome(world, entity);
      continue;
    }
    if (c.returning) {
      c.foodGoods ??= packedFood(c.food);
      c.food -= deliverFood(home, c.foodGoods, drop?.building.id);
      if (c.food <= 1e-8) world.remove(entity.id);
    } else if (destination) {
      c.foodGoods ??= packedFood(c.food);
      const delivered = deliverFood(destination, c.foodGoods, drop?.building.id); c.food -= delivered;
      world.announce(`Караван прибыл в ${destination.name}: доставлено еды — ${delivered}`);
      returnHome(world, entity);
    }
  }
  if (world.tick % (450 / SOCIAL_EVENT_RATE) !== 0) return;
  // Select one highest-priority reachable request per sender, across all neighbours.
  const roads = world.society.roads.filter(r => r.a !== r.b && roadIsIntact(world, r));
  for (const from of world.society.villages) {
    if (supplyBlock(world, from, from, 'food')) continue;
    const neighbours = new Set(roads.filter(r => r.a === from.id || r.b === from.id).map(r => r.a === from.id ? r.b : r.a));
    const candidates = world.society.villages.filter(to => neighbours.has(to.id))
      .flatMap(to => supplyChoices(world, from, to).map(good => ({ to, good })));
    candidates.sort((a, b) => supplyPolicy(world, from, b.good).priority - supplyPolicy(world, from, a.good).priority);
    for (const { to, good } of candidates) if (dispatchCaravan(world, from.id, to.id, 12, good)) break;
  }
}
