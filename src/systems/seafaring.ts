import { statusStops } from '../core/status-effects';
import { isAdult } from '../core/unit-stats';
import { operational } from '../core/buildings';
import { planBuilding } from './construction';
import { attachStorage, initializeStorage, reserveGoods, consumeReservation, releaseReservation } from '../core/stockpiles';
import { FOREST } from '../core/forestry';
import { deliverFood, deposit, packedFood, recordLoss } from '../core/resource-ledger';
import { GOLD } from '../core/gold';
import { addBundle } from '../core/resources';
import type { World } from '../core/world';
import { HARBOR_ID, SHIP_ID, SHIP_CLEARANCE, angleDelta, canSail, clearSeaSegment, distance, harborBerth, harborSite, seaRoute, type ShipState } from '../core/seafaring';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import { reachableTiles } from './navigation';
import { loadShipment, noteSupply, returnShipment, shipmentSize, shipmentStoreFits, supplyBlock, supplyChoices, supplyFriendly, supplyLoad, supplyPolicy, supplySegmentOpen, unloadShipment } from '../core/supply';
import { storageFor, storageRoom } from '../core/stockpiles';
import { bundleLoad, entries } from '../core/resources';

const village = (world: World, id: number | null) => world.society.villages.find(v => v.id === id);
const SHIP_SPACING = SHIP_CLEARANCE * 2 + 0.3;
const BERTH_WAIT_DISTANCE = SHIP_SPACING + 3;
const ready = (e: Entity): boolean => !!e.components.harbor && e.components.harbor.built === 1 && operational(e) && !e.components.thermal?.burning;
const friendly = (world: World, a: Entity, b: Entity): boolean => {
  const first = a.components.harbor!.villageId, second = b.components.harbor!.villageId;
  return !world.society.relations.some(r => (r.a === first && r.b === second || r.a === second && r.b === first) && r.status === 'war');
};

export function buildHarbor(world: World, position: Vec2, villageId?: number): Entity | undefined {
  const direction = harborSite(world, position);
  if (direction === undefined) return;
  const owner = village(world, villageId ?? null) ?? world.society.villages.filter(v => distance(v, position) < 24).sort((a, b) => distance(a, position) - distance(b, position))[0];
  if (!owner) return;
  return planBuilding(world, HARBOR_ID, position, owner);
}

function harbors(world: World, dt: number): void {
  for (const port of world.query('harbor', 'position')) {
    const state = port.components.harbor!, p = port.components.position!, berth = harborBerth(port);
    if (!world.terrain.isLand(p.x, p.y) || world.terrain.at(p.x, p.y) === Terrain.Mountain || !canSail(world, berth)) {
      world.remove(port.id); continue;
    }
    if (!village(world, state.villageId)) state.villageId = null;
    if (port.components.thermal?.burning) continue;
    if (!ready(port)) continue;
    const owner = village(world, state.villageId);
    if (owner) { initializeStorage(world, owner); attachStorage(owner, port); }
    state.launchIn = Math.max(0, state.launchIn - dt);
    if (state.launchIn > 0) continue;
    state.launchIn = 8;
    const fleet = [...world.query('ship')], own = fleet.filter(e => e.components.ship!.homeId === port.id);
    const hasOtherPort = [...world.query('harbor')].some(e => e.id !== port.id && ready(e) && friendly(world, port, e));
    if (own.length >= (hasOtherPort ? 2 : 1) || fleet.length >= 48 || fleet.some(e => distance(e.components.position!, berth) < BERTH_WAIT_DISTANCE)) continue;
    if (!owner || !reserveGoods(world, owner, { wood: FOREST.shipWood }, port.id, p)) continue;
    const ship = world.spawn(SHIP_ID, berth);
    if (!ship) { releaseReservation(owner, port.id); continue; }
    if (!consumeReservation(owner, port.id, { wood: FOREST.shipWood })) { world.remove(ship.id); releaseReservation(owner, port.id); continue; }
    if (ship) Object.assign(ship.components.ship!, { homeId: port.id, kind: own.some(e => e.components.ship!.kind === 'fishing') ? 'trade' : 'fishing',
      heading: angleDelta(state.direction * Math.PI / 2 + Math.PI / 2, 0), phase: 'docked', wait: 2 });
  }
  if (world.tick % 150 !== 0) return;
  for (const town of world.society.villages) {
    if ([...world.query('harbor')].some(e => e.components.harbor!.villageId === town.id)) continue;
    const adults = [...world.query('person', 'citizen', 'position')].filter(e => e.components.citizen!.villageId === town.id && isAdult(e));
    if (adults.length < 3 || world.tick - town.founded < 300) continue;
    const reachable = reachableTiles(world, adults.map(e => e.components.position!), 28);
    let site: Vec2 | undefined, score = Infinity;
    world.terrain.circle(town.x, town.y, 22, (x, y, i) => {
      if (reachable[i] < 0) return;
      const p = { x: x + 0.5, y: y + 0.5 }, d = distance(town, p);
      if (d < score && harborSite(world, p) !== undefined) { site = p; score = d; }
    });
    if (site) buildHarbor(world, site, town.id);
  }
}

function routeTo(world: World, entity: Entity, goal: Vec2, phase: ShipState['phase'], targetId: number | null): boolean {
  const path = seaRoute(world, entity.components.position!, goal);
  if (!path) return false;
  if (!entity.components.shipment) delete entity.components.ship!.goldVoyage;
  Object.assign(entity.components.ship!, { path, next: 0, phase, targetId, wait: 0, targetOwnerId: world.entities.get(targetId ?? -1)?.components.harbor?.villageId ?? null });
  return true;
}

function fishingTrip(world: World, entity: Entity): void {
  const p = entity.components.position!, ship = entity.components.ship!;
  const heading = ship.heading + world.rng.range(-0.7, 0.7), range = world.rng.range(10, 22);
  for (let i = 0; i < 12; i++) {
    const a = heading + i * Math.PI / 6, goal = { x: p.x + Math.cos(a) * range, y: p.y + Math.sin(a) * range };
    if (routeTo(world, entity, goal, 'sailing', null)) return;
  }
  ship.phase = 'idle'; ship.wait = 5;
}

function returnToPort(world: World, entity: Entity): boolean {
  const ship = entity.components.ship!, home = world.entities.get(ship.homeId ?? -1);
  if (home && ready(home) && (!ship.cargoOwnerId || home.components.harbor!.villageId === ship.cargoOwnerId)
    && routeTo(world, entity, harborBerth(home), 'returning', home.id)) return true;
  if (ship.cargoOwnerId) for (const port of world.query('harbor')) {
    if (ready(port) && port.components.harbor!.villageId === ship.cargoOwnerId && routeTo(world, entity, harborBerth(port), 'returning', port.id)) {
      ship.homeId = port.id; return true;
    }
  }
  return false;
}

function depart(world: World, entity: Entity): void {
  const ship = entity.components.ship!, p = entity.components.position!;
  if (ship.kind === 'trade') {
    const ports = [...world.query('harbor')].filter(ready), current = ports.find(e => distance(harborBerth(e), p) < 1);
    if (current) {
      const destinations = ports.filter(e => e.id !== current.id && friendly(world, current, e));
      destinations.sort((a, b) => (a.id === ship.homeId ? -1 : b.id === ship.homeId ? 1 : distance(harborBerth(a), p) - distance(harborBerth(b), p)));
      const from = village(world, current.components.harbor!.villageId);
      if (from && !ship.cargo && !supplyBlock(world, from, from, 'food', entity.id)) {
        initializeStorage(world, from); attachStorage(from, current);
        const requests = destinations.flatMap(other => {
          const to = village(world, other.components.harbor!.villageId);
          return to && to.id !== from.id ? supplyChoices(world, from, to).map(good => ({ other, to, good })) : [];
        }).sort((a, b) => supplyPolicy(world, from, b.good).priority - supplyPolicy(world, from, a.good).priority);
        for (const { other, to, good } of requests) {
          initializeStorage(world, to); attachStorage(to, other);
          if (supplyBlock(world, from, to, good, entity.id)) continue;
          const load = supplyLoad(world, from, to, current.id, good, 24), store = storageFor(world, other.id);
          if (!load || !store || !shipmentStoreFits(world, other, load)
            || entries(load.goods).some(([id, n]) => storageRoom(store, id) < n)
            || bundleLoad(store.goods).volume + (store.equipmentVolume ?? 0) + bundleLoad(load.goods).volume + load.items.length > store.capacity) continue;
          if (!routeTo(world, entity, harborBerth(other), 'sailing', other.id)) continue;
          const path = [p, ...ship.path];
          if (!path.every((q, i) => !i || supplySegmentOpen(world, from.id, path[i - 1], q))) continue;
          if (!loadShipment(world, entity, from, to, current, other, good, load)) continue;
          ship.goldVoyage = { fromId: from.id, toId: to.id, departed: world.tick, settled: false, income: 0 };
          return;
        }
      }
      // An empty commercial voyage earns no cargo receipt. Legacy loads finish below.
      for (const other of destinations) {
        if (!routeTo(world, entity, harborBerth(other), 'sailing', other.id)) continue;
        return;
      }
    } else if (returnToPort(world, entity)) return;
    ship.phase = 'idle'; ship.wait = 5;
  } else fishingTrip(world, entity);
}

/** Shipment accounting is shared with wagons; hull movement and berths stay here. */
function supplyShip(world: World, entity: Entity, dt: number): void {
  const s = entity.components.shipment!, ship = entity.components.ship!, p = entity.components.position!;
  const from = village(world, s.fromId), to = village(world, s.toId);
  const destination = world.entities.get(s.destinationId);
  if (!from) { world.remove(entity.id); return; }
  if (s.phase === 'outbound' && (!to || !destination || !ready(destination) || destination.components.harbor!.villageId !== s.toId
    || !supplyFriendly(world, s.fromId, s.toId, true))) {
    returnShipment(world, entity, to && !supplyFriendly(world, s.fromId, s.toId, true) ? 'Supply relations changed' : 'Supply destination gone');
    ship.phase = 'idle'; ship.path = []; ship.next = 0; ship.wait = 0;
  }
  const returning = s.phase === 'returning' || s.phase === 'complete';
  let target = returning ? world.entities.get(ship.targetId ?? -1) : destination;
  if (returning && (!target || !ready(target) || target.components.harbor!.villageId !== s.fromId)) target = undefined;
  if (!target || ship.phase !== 'sailing' && ship.phase !== 'returning') {
    ship.wait = Math.max(0, ship.wait - dt);
    if (ship.wait > 0) return;
    const routed = returning ? returnToPort(world, entity) : !!target && routeTo(world, entity, harborBerth(target), 'sailing', target.id);
    if (!routed) { ship.wait = 2; noteSupply(world, entity, 'Supply route blocked'); return; }
    target = world.entities.get(ship.targetId ?? -1);
  }
  const next = ship.path[ship.next];
  if (next && !supplySegmentOpen(world, s.fromId, p, next)) {
    ship.speed = 0; noteSupply(world, entity, 'Supply border closed'); return;
  }
  sail(world, entity, dt, arriveSupply);
  if (ship.phase === 'idle' && shipmentSize(s)) noteSupply(world, entity, 'Supply route blocked');
}

function arriveSupply(world: World, entity: Entity): void {
  const s = entity.components.shipment!, ship = entity.components.ship!, p = entity.components.position!;
  const target = world.entities.get(ship.targetId ?? -1), from = village(world, s.fromId), to = village(world, s.toId);
  const returning = s.phase === 'returning' || s.phase === 'complete';

  if (!target || !ready(target) || distance(p, harborBerth(target)) > 0.2) {
    ship.phase = 'idle'; ship.wait = 2; noteSupply(world, entity, 'Supply route blocked'); return;
  }
  ship.speed = 0;
  if (s.phase === 'complete') {
    if (target.components.harbor!.villageId !== s.fromId) { ship.phase = 'idle'; ship.wait = 0; return; }
    delete entity.components.shipment; delete ship.cargoOwnerId;
    ship.phase = 'docked'; ship.wait = 4; ship.targetId = null; return;
  }
  const recipient = returning ? from : to;
  if (!recipient) return;
  const delivered = unloadShipment(world, entity, recipient, target);
  const voyage = ship.goldVoyage;
  if (!returning && delivered > 0 && voyage && !voyage.settled && voyage.fromId === s.fromId && voyage.toId === recipient.id) {
    voyage.settled = true;
    voyage.income = deposit(recipient, { gold: GOLD.tradeIncome }, target.id).gold ?? 0;
    recordLoss(recipient, { gold: GOLD.tradeIncome - voyage.income });
  }
  if (!shipmentSize(s)) {
    if (returning) { delete entity.components.shipment; delete ship.cargoOwnerId; ship.phase = 'docked'; ship.wait = 4; ship.targetId = null; }
    else { ship.phase = 'idle'; ship.wait = 0; }
  }
}

function arrive(world: World, entity: Entity): void {
  if (entity.components.shipment) { arriveSupply(world, entity); return; }
  const ship = entity.components.ship!, target = world.entities.get(ship.targetId ?? -1);
  ship.path = []; ship.next = 0; ship.speed = 0;
  if (target && ready(target) && distance(entity.components.position!, harborBerth(target)) <= 0.2
    && (ship.targetOwnerId === undefined || target.components.harbor!.villageId === ship.targetOwnerId)
    && (!ship.cargoOwnerId || !world.society.relations.some(r => (r.a === ship.cargoOwnerId && r.b === target.components.harbor!.villageId || r.b === ship.cargoOwnerId && r.a === target.components.harbor!.villageId) && r.status === 'war'))) {
    const owner = village(world, target.components.harbor!.villageId);
    if (owner) {
      ship.foodGoods ??= packedFood(ship.cargo);
      initializeStorage(world, owner); attachStorage(owner, target);
      const delivered = deliverFood(owner, ship.foodGoods, target.id);
      const voyage = ship.goldVoyage;
      if (ship.kind === 'trade' && ship.phase === 'sailing' && voyage && !voyage.settled
        && voyage.toId === owner.id && voyage.fromId === ship.cargoOwnerId && delivered > 0) {
        // Commit the receipt with unloading. Full stores lose overflow; retries and
        // save/load cannot mint a second arrival reward, even after partial unloading.
        voyage.settled = true;
        voyage.income = deposit(owner, { gold: GOLD.tradeIncome }, target.id).gold ?? 0;
        recordLoss(owner, { gold: GOLD.tradeIncome - voyage.income });
      }
      if (ship.kind === 'fishing') owner.harvested += delivered;
      ship.cargo -= delivered;
      if (ship.cargo <= 1e-8) delete ship.cargoOwnerId;
    }
    ship.phase = 'docked'; ship.wait = 4; ship.targetId = null;
  } else { ship.phase = 'fishing'; ship.wait = 6; ship.targetId = null; }
}

/** The nearest arrival enters first; the berth stays occupied until its departing hull clears it. */
function berthApproach(world: World, entity: Entity, fleet: Entity[]): number {
  const ship = entity.components.ship!, target = world.entities.get(ship.targetId ?? -1);
  if (!target?.components.harbor) return Infinity;
  const berth = harborBerth(target), remaining = distance(entity.components.position!, berth);
  const blocked = fleet.some(other => {
    if (other.id === entity.id) return false;
    const state = other.components.ship!, d = distance(other.components.position!, berth);
    const arriving = state.targetId === target.id && (state.phase === 'sailing' || state.phase === 'returning');
    if (!arriving) return d < SHIP_SPACING;
    return d < remaining || d === remaining && other.id < entity.id;
  });
  return blocked ? Math.max(0, remaining - BERTH_WAIT_DISTANCE) : Infinity;
}

export function sail(world: World, entity: Entity, dt: number, onArrival = arrive): void {
  if (world.paused || statusStops(entity)) return;
  const ship = entity.components.ship!, p = entity.components.position!;
  const fleet = [...world.query('ship', 'position')];
  const approach = berthApproach(world, entity, fleet);
  if (approach === 0) { ship.speed = 0; ship.turn *= Math.max(0, 1 - dt * 3); return; }
  const goal = ship.path[ship.next];
  if (!goal) { onArrival(world, entity); return; }
  const d = distance(p, goal), final = ship.next === ship.path.length - 1;
  if (d < 0.06) { ship.next++; if (final) onArrival(world, entity); return; }
  let desired = Math.atan2(goal.y - p.y, goal.x - p.x), clearance = approach;
  const ahead = fleet.filter(e => {
    if (e.id === entity.id) return false;
    const q = e.components.position!, gap = distance(p, q);
    const angle = angleDelta(Math.atan2(q.y - p.y, q.x - p.x), desired);
    return gap < SHIP_SPACING + 3 && Math.abs(angle) < Math.PI / 2 && Math.abs(Math.sin(angle) * gap) < SHIP_SPACING + 0.3;
  }).sort((a, b) => distance(p, a.components.position!) - distance(p, b.components.position!))[0];
  if (ahead) {
    const other = ahead.components.ship!, q = ahead.components.position!, gap = distance(p, q);
    if (ship.targetId !== null && other.targetId === ship.targetId) {
      // Follow the queue without trying to overtake another arrival.
      clearance = Math.min(clearance, Math.max(0, gap - SHIP_SPACING));
    } else {
      // Steer around waiting hulls so a departing ship can release the berth.
      const bearing = Math.atan2(q.y - p.y, q.x - p.x);
      const offset = Math.asin(Math.min(1, (SHIP_SPACING + 0.3) / gap)) + 0.15;
      const passing = [bearing + offset, bearing - offset].find(angle => clearSeaSegment(world, p,
        { x: p.x + Math.cos(angle) * 2, y: p.y + Math.sin(angle) * 2 }));
      if (passing === undefined) clearance = 0;
      else desired = passing;
    }
  }
  const turn = angleDelta(desired, ship.heading);
  const maxTurn = 1.25 * dt, change = Math.max(-maxTurn, Math.min(maxTurn, turn));
  ship.heading = angleDelta(ship.heading + change, 0);
  ship.turn += (change / maxTurn - ship.turn) * Math.min(1, dt * 4);
  const cruise = ship.kind === 'trade' ? 2.5 : 2.1;
  const braking = Math.min(1, Math.sqrt(d / (final ? 3 : 1.4)));
  const alignment = Math.max(0, Math.cos(turn)) ** 3;
  const targetSpeed = Math.min(cruise * braking * alignment, Math.sqrt(4 * clearance));
  const candidate = { x: p.x + Math.cos(ship.heading) * Math.min(d, Math.max(ship.speed, 0.2) * dt),
    y: p.y + Math.sin(ship.heading) * Math.min(d, Math.max(ship.speed, 0.2) * dt) };
  if (!canSail(world, candidate)) {
    ship.speed = 0;
    ship.wait = Math.max(0, ship.wait - dt);
    if (ship.wait === 0) {
      const destination = ship.path.at(-1)!;
      const replacement = seaRoute(world, p, destination);
      if (replacement) { ship.path = replacement; ship.next = 0; }
      else { ship.path = []; ship.next = 0; ship.phase = 'idle'; ship.targetId = null; }
      ship.wait = 2;
    }
    return;
  }
  ship.speed += Math.max(-dt * 2, Math.min(dt * 0.8, targetSpeed - ship.speed));
  const step = Math.min(d, ship.speed * dt, clearance);
  const next = { x: p.x + Math.cos(ship.heading) * step, y: p.y + Math.sin(ship.heading) * step };
  if (entity.components.shipment && !supplySegmentOpen(world, entity.components.shipment.fromId, p, next)) {
    ship.speed = 0; noteSupply(world, entity, 'Supply border closed'); return;
  }
  const blocked = fleet.some(other => other.id !== entity.id && distance(next, other.components.position!) < SHIP_SPACING
    && distance(next, other.components.position!) < distance(p, other.components.position!) - 1e-8);
  if (!blocked && canSail(world, next)) { Object.assign(p, next); world.spatial.update(entity); }
  else ship.speed = 0;
}

export function seafaring(world: World, dt: number): void {
  if (world.paused) return;
  harbors(world, dt);
  for (const entity of world.query('ship', 'position')) {
    if (statusStops(entity)) continue;
    if (entity.components.foreignVoyage) continue;
    const ship = entity.components.ship!, p = entity.components.position!;
    for (const mark of ship.wake) mark.age += dt;
    ship.wake = ship.wake.filter(mark => mark.age <= 3);
    if (!canSail(world, p)) { ship.speed = 0; ship.sail = Math.max(0, ship.sail - dt); continue; }
    if (entity.components.shipment) { ship.sail = Math.min(1, ship.sail + dt * 0.45); supplyShip(world, entity, dt); continue; }
    const home = world.entities.get(ship.homeId ?? -1);
    if (!home?.components.harbor) ship.homeId = null;
    if (ship.homeId === null && world.tick % 60 === entity.id % 60) {
      const ports = [...world.query('harbor', 'position')].filter(e => ready(e) && (!ship.cargoOwnerId || e.components.harbor!.villageId === ship.cargoOwnerId))
        .sort((a, b) => distance(harborBerth(a), p) - distance(harborBerth(b), p));
      for (const port of ports) if (seaRoute(world, p, harborBerth(port))) { ship.homeId = port.id; break; }
    }
    const target = world.entities.get(ship.targetId ?? -1);
    if (ship.targetId !== null && (!target?.components.harbor || !ready(target) || ship.targetOwnerId !== undefined && target.components.harbor.villageId !== ship.targetOwnerId || home?.components.harbor && !friendly(world, home, target))) {
      ship.path = []; ship.next = 0; ship.targetId = null; ship.phase = 'idle'; ship.wait = 1;
      if (!returnToPort(world, entity)) ship.phase = 'idle';
    }
    const underway = ship.phase === 'sailing' || ship.phase === 'returning';
    ship.sail += Math.max(-dt * 0.6, Math.min(dt * 0.45, (underway ? 1 : 0) - ship.sail));
    if (underway) sail(world, entity, dt);
    else {
      ship.speed = Math.max(0, ship.speed - dt * 1.5); ship.turn *= Math.max(0, 1 - dt * 3);
      ship.wait = Math.max(0, ship.wait - dt);
      if (ship.wait === 0) {
        if (ship.phase === 'fishing') {
          const caught = Math.min(24 - ship.cargo, Math.floor(world.rng.range(4, 9)));
          ship.foodGoods ??= packedFood(ship.cargo); addBundle(ship.foodGoods, { fish: caught }); ship.cargo += caught;
          if (home?.components.harbor?.villageId) ship.cargoOwnerId = home.components.harbor.villageId;
          if (!returnToPort(world, entity)) { ship.phase = 'idle'; ship.wait = 2; }
        } else if (ship.cargo) {
          if (!returnToPort(world, entity)) { ship.phase = 'idle'; ship.wait = 2; }
        }
        else depart(world, entity);
      }
    }
    const last = ship.wake.at(-1);
    if (ship.speed > 0.15 && (!last || last.age >= 0.14)) {
      ship.wake.push({ ...p, heading: ship.heading, age: 0 });
      if (ship.wake.length > 24) ship.wake.shift();
    }
  }
}
