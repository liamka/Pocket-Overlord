import type { World } from '../core/world';
import type { Entity, Vec2 } from '../core/types';
import { Terrain } from '../core/types';
import { operational } from '../core/buildings';
import { addBundle, entries, type ResourceId } from '../core/resources';
import { availableStock, deposit, stockOf, withdraw } from '../core/resource-ledger';
import { attachStorage, initializeStorage, storageRoom } from '../core/stockpiles';
import { canSail, distance, harborBerth, seaRoute, SHIP_CLEARANCE } from '../core/seafaring';
import { HUNTER_ID, VISITORS, VISITORS_ID, VISITOR_SHIP_ID, type ForeignVoyage, type VisitorSchedule } from '../core/visitors';
import { sail } from './seafaring';
import { findPath } from './navigation';
import { applyEvent } from './effects';

const readyPort = (world: World, e: Entity): boolean => !!e.components.harbor && e.components.harbor.built === 1
  && operational(e) && !e.components.thermal?.burning && world.society.villages.some(v => v.id === e.components.harbor!.villageId)
  && canSail(world, harborBerth(e));
const monster = (e: Entity | undefined): e is Entity => !!e?.components.position && (e.components.health?.current ?? 0) > 0
  && (!!e.components.dragon && !e.components.dragon.arrival && !e.components.dragon.departure || !!e.components.kaiju);

/** Enter through navigable map edges, never through enclosed lakes. */
function seaEntries(world: World, goal: Vec2): Vec2[] {
  const { width, height } = world.terrain, margin = SHIP_CLEARANCE + 0.5;
  const candidates: Vec2[] = [];
  for (let x = margin; x <= width - margin; x += 8) candidates.push({ x, y: margin }, { x, y: height - margin });
  for (let y = margin; y <= height - margin; y += 8) candidates.push({ x: margin, y }, { x: width - margin, y });
  return candidates.filter(p => canSail(world, p)).sort((a, b) => distance(a, goal) - distance(b, goal));
}

function seaEntrance(world: World, berth: Vec2): { entry: Vec2; path: Vec2[] } | undefined {
  for (const entry of seaEntries(world, berth).slice(0, 8)) {
    if ([...world.query('ship', 'position')].some(e => distance(e.components.position!, entry) < SHIP_CLEARANCE * 2 + 1)) continue;
    const path = seaRoute(world, entry, berth);
    if (path) return { entry, path };
  }
}

function launch(world: World, kind: ForeignVoyage['kind'], berth: Vec2, shore: Vec2, port?: Entity, target?: Entity): boolean {
  if ([...world.query('ship')].length >= 48) return false;
  const entrance = seaEntrance(world, berth);
  if (!entrance) return false;
  const entity = world.spawn(VISITOR_SHIP_ID, entrance.entry);
  if (!entity) return false;
  const voyage = entity.components.foreignVoyage!, ship = entity.components.ship!;
  Object.assign(voyage, { kind, berth, shore, entry: entrance.entry, portId: port?.id ?? null,
    villageId: port?.components.harbor!.villageId ?? null, monsterId: target?.id ?? null });
  if (kind === 'merchants') voyage.goods = world.rng.next() < 0.5 ? { mythril: 2, tools: 3 } : { gems: 2, silver: 3 };
  Object.assign(ship, { kind: 'trade', phase: 'sailing', path: entrance.path, next: 0, targetId: port?.id ?? null,
    heading: Math.atan2(entrance.path[0].y - entrance.entry.y, entrance.path[0].x - entrance.entry.x) });
  world.announce(kind === 'merchants' ? 'Overseas merchants are approaching the island' : 'Monster hunters are approaching the island');
  return true;
}

function sendHunters(world: World, target: Entity): boolean {
  const p = target.components.position!, candidates: { shore: Vec2; berth: Vec2 }[] = [];
  world.terrain.circle(p.x, p.y, 44, (x, y) => {
    const shore = { x: x + 0.5, y: y + 0.5 };
    if (!world.terrain.isLand(x, y) || world.terrain.at(x, y) === Terrain.Mountain || !world.canStand(shore, 0.3)) return;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      if (world.terrain.isLand(x + dx, y + dy)) continue;
      const berth = { x: shore.x + dx * 5.5, y: shore.y + dy * 5.5 };
      if (!canSail(world, berth)) continue;
      // A small landing boat crosses the gap; no intervening island or mountain.
      if ([1, 2, 3, 4, 5].some(n => world.terrain.isLand(shore.x + dx * n, shore.y + dy * n))) continue;
      candidates.push({ shore, berth }); break;
    }
  });
  candidates.sort((a, b) => distance(a.shore, p) - distance(b.shore, p));
  for (const { shore, berth } of candidates.slice(0, 6)) {
    if (world.terrain.isLand(p.x, p.y) && !landPath(world, shore, p, VISITORS.reach - 1)) continue;
    if (launch(world, 'hunters', berth, shore, undefined, target)) return true;
  }
  return false;
}

function schedule(world: World): void {
  if (world.tick % 30 !== 0) return;
  let active = world.scenarios.find(s => s.id === VISITORS_ID);
  if (!active) {
    if (![...world.query('harbor')].some(e => readyPort(world, e)) && ![...world.query('dragon'), ...world.query('kaiju')].some(monster)) return;
    if (!world.startScenario(VISITORS_ID)) return;
    active = world.scenarios.find(s => s.id === VISITORS_ID)!;
  }
  const state = active.state as VisitorSchedule, voyages = [...world.query('foreignVoyage')];
  if (world.tick >= state.tradeAt && !voyages.some(e => e.components.foreignVoyage!.kind === 'merchants')) {
    state.tradeAt = world.tick + 15 * 30;
    const ports = [...world.query('harbor')].filter(e => readyPort(world, e));
    if (ports.length) {
      const start = Math.floor(world.rng.range(0, ports.length));
      for (let i = 0; i < Math.min(ports.length, 3); i++) {
        const port = ports[(start + i) % ports.length];
        if (!launch(world, 'merchants', harborBerth(port), port.components.position!, port)) continue;
        state.tradeAt = world.tick + VISITORS.tradeInterval + Math.floor(world.rng.range(0, 120 * 30)); break;
      }
    }
  }
  if (world.tick < state.huntAt || voyages.some(e => e.components.foreignVoyage!.kind === 'hunters') || [...world.query('monsterHunter')].length) return;
  state.huntAt = world.tick + 5 * 30;
  const threats = [...world.query('dragon'), ...world.query('kaiju')].filter(e => monster(e)
    && world.society.villages.some(v => distance(v, e.components.position!) < 36));
  for (const target of threats.slice(0, 2)) if (sendHunters(world, target)) {
    state.huntAt = world.tick + VISITORS.huntInterval; break;
  }
}

/** Barter uses unreserved physical stock and leaves building/food reserves at home. */
function trade(world: World, entity: Entity): void {
  const voyage = entity.components.foreignVoyage!, port = world.entities.get(voyage.portId ?? -1);
  const town = world.society.villages.find(v => v.id === voyage.villageId);
  if (!port || !town) return;
  initializeStorage(world, town);
  const store = attachStorage(town, port);
  const payments: { good: ResourceId; amount: number; reserve: number }[] = [
    { good: 'wood', amount: 4, reserve: 20 }, { good: 'stone', amount: 4, reserve: 16 }, { good: 'grain', amount: 6, reserve: 40 },
  ];
  let exchanged = 0;
  for (const [good, amount] of entries(voyage.goods)) for (let i = 0; i < amount; i++) {
    if (storageRoom(store, good) < 1 || stockOf(town, good) >= 2000) break;
    const payment = payments.find(p => availableStock(world, town, p.good) >= p.reserve + p.amount);
    if (!payment || !withdraw(town, { [payment.good]: payment.amount }, 'transfer')) break;
    const delivered = deposit(town, { [good]: 1 }, port.id);
    if (!delivered[good]) { deposit(town, { [payment.good]: payment.amount }); break; }
    voyage.goods[good] = (voyage.goods[good] ?? 0) - 1; addBundle(voyage.purchases, { [payment.good]: payment.amount }); exchanged++;
  }
  voyage.traded = true;
  world.announce(exchanged ? 'Overseas merchants exchanged rare goods for local supplies' : 'Overseas merchants found no surplus to trade');
}

function depart(world: World, entity: Entity): void {
  const voyage = entity.components.foreignVoyage!, ship = entity.components.ship!;
  voyage.phase = 'departing'; voyage.retryIn = 0; ship.targetId = null; ship.path = []; ship.next = 0; ship.phase = 'idle';
  routeVoyage(world, entity);
}

function routeVoyage(world: World, entity: Entity): void {
  const voyage = entity.components.foreignVoyage!, ship = entity.components.ship!, p = entity.components.position!;
  voyage.retryIn = 5;
  let path = seaRoute(world, p, voyage.phase === 'departing' ? voyage.entry : voyage.berth);
  if (!path && voyage.phase === 'departing') for (const entry of seaEntries(world, p).slice(0, 8)) {
    path = seaRoute(world, p, entry);
    if (path) { voyage.entry = entry; break; }
  }
  if (path) Object.assign(ship, { path, next: 0, phase: 'sailing' });
}

function arrive(world: World, entity: Entity): void {
  const voyage = entity.components.foreignVoyage!, ship = entity.components.ship!;
  ship.path = []; ship.next = 0; ship.speed = 0; ship.phase = 'docked';
  if (voyage.phase === 'departing') {
    world.announce(voyage.kind === 'merchants' ? 'Overseas merchants sailed away' : 'The hunters expedition has left the island');
    world.remove(entity.id); return;
  }
  voyage.phase = 'visiting'; voyage.wait = VISITORS.stay; voyage.leaveAt = world.tick + VISITORS.huntDuration;
  if (voyage.kind === 'merchants') { world.announce('Overseas merchants arrived at the harbor'); return; }
  if (!monster(world.entities.get(voyage.monsterId ?? -1))) { depart(world, entity); return; }
  let landed = 0;
  for (let i = 0; i < VISITORS.hunters; i++) {
    const dx = (voyage.berth.x - voyage.shore.x) / 5.5, dy = (voyage.berth.y - voyage.shore.y) / 5.5;
    const p = world.findFreePosition({ x: voyage.shore.x - dy * (i - 1) * 0.85 - dx * 0.3,
      y: voyage.shore.y + dx * (i - 1) * 0.85 - dy * 0.3 }, 0.3);
    if (!p) break;
    const hunter = world.spawn(HUNTER_ID, p);
    if (!hunter) break;
    Object.assign(hunter.components.monsterHunter!, { shipId: entity.id, targetId: voyage.monsterId, exit: { ...voyage.shore }, cooldown: i * 0.25 });
    landed++;
  }
  if (landed) world.announce('Monster hunters landed and started tracking their quarry');
  else depart(world, entity);
}

function updateVoyage(world: World, entity: Entity, dt: number): void {
  const voyage = entity.components.foreignVoyage!, ship = entity.components.ship!, p = entity.components.position!;
  voyage.retryIn = Math.max(0, voyage.retryIn - dt);
  for (const mark of ship.wake) mark.age += dt;
  ship.wake = ship.wake.filter(mark => mark.age <= 3);
  if (voyage.kind === 'merchants' && voyage.phase !== 'departing') {
    const port = world.entities.get(voyage.portId ?? -1);
    if (!port || !readyPort(world, port) || port.components.harbor!.villageId !== voyage.villageId) depart(world, entity);
  }
  if (voyage.kind === 'hunters' && voyage.phase === 'arriving' && !monster(world.entities.get(voyage.monsterId ?? -1))) depart(world, entity);
  const moving = voyage.phase !== 'visiting';
  ship.sail += Math.max(-dt * 0.6, Math.min(dt * 0.45, (moving ? 1 : 0) - ship.sail));
  if (moving) {
    if (!ship.path.length && voyage.retryIn === 0) routeVoyage(world, entity);
    if (ship.path.length) sail(world, entity, dt, arrive);
  } else if (voyage.kind === 'merchants') {
    voyage.wait = Math.max(0, voyage.wait - dt);
    if (!voyage.traded && voyage.wait <= VISITORS.stay / 2) trade(world, entity);
    if (voyage.wait === 0) depart(world, entity);
  } else if (![...world.query('monsterHunter')].some(e => e.components.monsterHunter!.shipId === entity.id)) depart(world, entity);
  const last = ship.wake.at(-1);
  if (ship.speed > 0.15 && (!last || last.age >= 0.14)) {
    ship.wake.push({ ...p, heading: ship.heading, age: 0 });
    if (ship.wake.length > 24) ship.wake.shift();
  }
}

function landPath(world: World, start: Vec2, goal: Vec2, reach: number): Vec2[] | undefined {
  const path = findPath(world, start, goal, reach);
  // Visitors have no seats on village ferries. Reject crossings instead of walking over water.
  if (path?.some((p, i) => distance(p, i ? path[i - 1] : start) > 1.6)) return;
  return path;
}

function updateHunter(world: World, entity: Entity, dt: number): void {
  const h = entity.components.monsterHunter!, p = entity.components.position!, boat = world.entities.get(h.shipId ?? -1);
  const voyage = boat?.components.foreignVoyage;
  h.cooldown = Math.max(0, h.cooldown - dt); h.rethink = Math.max(0, h.rethink - dt); h.moving = false;
  const target = world.entities.get(h.targetId ?? -1);
  if (!monster(target) || !voyage || world.tick >= voyage.leaveAt || entity.components.health!.current < 40) {
    if (!h.returning) { h.returning = true; h.path = []; h.rethink = 0; }
  }
  if (h.returning && distance(p, h.exit) < 1) {
    if (voyage) addBundle(voyage.purchases, h.loot);
    world.remove(entity.id); return;
  }
  if (!h.returning && target && distance(p, target.components.position!) <= VISITORS.reach) {
    h.path = []; h.heading = Math.atan2(target.components.position!.y - p.y, target.components.position!.x - p.x);
    if (h.cooldown === 0 && !entity.components.thermal?.burning) {
      h.cooldown = VISITORS.attackDelay;
      applyEvent(world, { kind: 'damage', target: target.id, amount: VISITORS.damage, cause: 'conflict', sourceId: entity.id });
      if (!world.entities.has(target.id)) {
        addBundle(h.loot, target.components.dragon ? { dragonScale: 1 } : { bone: 3 });
        world.announce('Monster hunters defeated their quarry and collected a trophy');
      }
    }
    return;
  }
  const goal = h.returning ? h.exit : target?.components.position;
  if (!goal) return;
  if (h.rethink === 0) { h.path = landPath(world, p, goal, h.returning ? 0.6 : VISITORS.reach - 1) ?? []; h.rethink = 2; }
  while (h.path.length && distance(p, h.path[0]) < 0.1) h.path.shift();
  const next = h.path[0];
  if (!next) return;
  h.heading = Math.atan2(next.y - p.y, next.x - p.x);
  const step = Math.min(distance(p, next), VISITORS.speed * dt), q = { x: p.x + Math.cos(h.heading) * step, y: p.y + Math.sin(h.heading) * step };
  if (world.canStand(q, 0.17, entity.id)) {
    Object.assign(p, q); h.moving = step > 0; h.stride = (h.stride + step * 3) % (Math.PI * 2); world.spatial.update(entity);
  } else { h.path = []; }
}

export function visitors(world: World, dt: number): void {
  if (world.paused) return;
  schedule(world);
  for (const entity of world.query('foreignVoyage', 'ship', 'position')) updateVoyage(world, entity, dt);
  for (const entity of world.query('monsterHunter', 'position')) updateHunter(world, entity, dt);
}
