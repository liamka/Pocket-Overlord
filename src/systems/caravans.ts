import { aboardFerry, ferryLink } from '../core/ferries';
import { approachFerry } from './ferries';
import type { World } from '../core/world';
import { SOCIAL_EVENT_RATE, type Entity, type Vec2 } from '../core/types';
import { findPath } from './navigation';
import { roadIsIntact } from '../core/roads';
import { foodReserve } from '../core/seasons';

const LIMIT = 32;
const village = (world: World, id: number | null) => world.society.villages.find(v => v.id === id);
const peaceful = (world: World, a: number, b: number | null): boolean => world.society.relations.some(r => (r.a === a && r.b === b || r.b === a && r.a === b) && r.status !== 'war');
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

// Residents can pass a wagon. Buildings and water still block it.
function passable(world: World, p: Vec2): boolean {
  return world.terrain.isLand(p.x, p.y) && !world.nearby(p, 1.4).some(e => e.components.solid && distance(p, e.components.position!) < e.components.solid.radius + 0.2);
}

function clearSegment(world: World, a: Vec2, b: Vec2): boolean {
  if (ferryLink(world, a, b)) return true;
  const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
  const steps = Math.max(1, Math.ceil(Math.sqrt(squared) / 0.25));
  for (let i = 0; i <= steps; i++) if (!world.terrain.isLand(a.x + dx * i / steps, a.y + dy * i / steps)) return false;
  return !world.nearby({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, Math.sqrt(squared) / 2 + 1.4).some(e => {
    if (!e.components.solid) return false;
    const p = e.components.position!, t = squared ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / squared)) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t) < e.components.solid.radius + 0.2;
  });
}

/** Reserve real food at departure; only arrival credits the destination. */
export function dispatchCaravan(world: World, fromId: number, toId: number, requested = 12): boolean {
  const from = village(world, fromId), to = village(world, toId);
  const active = [...world.query('caravan')];
  if (!from || !to || fromId === toId || !peaceful(world, fromId, toId) || active.length >= LIMIT
    || active.some(e => { const c = e.components.caravan!; return c.fromId === fromId && c.toId === toId || c.fromId === toId && c.toId === fromId; })) return false;
  const people = [...world.query('person', 'citizen')];
  const residents = people.filter(e => e.components.citizen!.villageId === fromId);
  if (!residents.some(e => e.components.person!.age >= 18) || !people.some(e => e.components.citizen!.villageId === toId)) return false;
  const food = Math.floor(Math.min(12, requested, from.food - foodReserve(world.tick, residents.length), 2000 - to.food));
  if (food < 1) return false;
  const road = world.society.roads.find(r => (r.a === fromId && r.b === toId || r.b === fromId && r.a === toId) && roadIsIntact(world, r));
  if (!road?.tiles.length) return false;
  let path = road.tiles.filter((_, n) => !road.ferries?.some(f => n > f.start && n < f.end)).map(i => ({ x: i % world.terrain.width + 0.5, y: Math.floor(i / world.terrain.width) + 0.5 }));
  if (road.a !== fromId) path.reverse();
  // Older roads can include a house's centre at their endpoints.
  while (path.length && !passable(world, path[0]) && distance(path[0], from) < 3) path.shift();
  while (path.length && !passable(world, path.at(-1)!) && distance(path.at(-1)!, to) < 3) path.pop();
  if (path.length < 2 || !passable(world, path[0])) return false;
  if (!path.every((p, i) => passable(world, p) && (i === 0 || clearSegment(world, path[i - 1], p)))) {
    const detour = findPath(world, path[0], to, 2.2, (a, b) => clearSegment(world, a, b));
    if (!detour?.length) return false;
    path = [path[0], ...detour];
  }
  const entity = world.spawn('core:caravan', path[0]);
  if (!entity) return false;
  Object.assign(entity.components.caravan!, { fromId, toId, food, path, next: 1 });
  from.food -= food;
  world.announce(`Караван: ${from.name} → ${to.name}, еды: ${food}`);
  return true;
}

function returnHome(world: World, entity: Entity): void {
  const c = entity.components.caravan!;
  c.path = c.path.slice(0, c.next).reverse(); c.next = 0; c.returning = true; c.retryIn = 0;
  const home = village(world, c.fromId);
  if (home) world.announce(`Караван возвращается в ${home.name}`);
}

export function caravans(world: World, dt: number): void {
  for (const entity of world.query('caravan', 'position')) {
    const c = entity.components.caravan!, p = entity.components.position!;
    const home = village(world, c.fromId), destination = village(world, c.toId);
    if (!home) { world.remove(entity.id); continue; }
    if (aboardFerry(world, entity.id)) continue;
    if (!c.returning && (!destination || !peaceful(world, c.fromId, c.toId))) returnHome(world, entity);
    if (!destination) c.toId = null;
    if (approachFerry(world, entity, dt)) continue;
    c.retryIn = Math.max(0, c.retryIn - dt);
    let remaining = 2.2 * dt;
    while (remaining > 0 && c.next < c.path.length) {
      const goal = c.path[c.next], d = distance(p, goal);
      if (d < 0.001) { c.next++; if (approachFerry(world, entity, dt)) break; continue; }
      const step = Math.min(remaining, d, 0.2), next = { x: p.x + (goal.x - p.x) / d * step, y: p.y + (goal.y - p.y) / d * step };
      if (!passable(world, next)) {
        if (c.retryIn === 0) {
          // Back up to the last tile centre before turning, avoiding diagonal corner cuts.
          const anchor = c.path[Math.max(0, c.next - 1)];
          const detour = passable(world, anchor) ? findPath(world, anchor, c.returning ? home : destination!, 2.2, (a, b) => clearSegment(world, a, b)) : undefined;
          if (detour) c.path = [...c.path.slice(0, c.next), anchor, ...detour];
          c.retryIn = 2;
        }
        break;
      }
      world.terrain.useRoad(p.x, p.y);
      p.x = next.x; p.y = next.y; remaining -= step;
      world.terrain.useRoad(p.x, p.y);
    }
    world.spatial.update(entity);
    if (c.next < c.path.length) continue;
    if (c.returning) {
      home.food = Math.min(2000, home.food + c.food); world.remove(entity.id);
    } else if (destination) {
      const delivered = Math.min(c.food, 2000 - destination.food);
      destination.food += delivered; c.food -= delivered;
      world.announce(`Караван прибыл в ${destination.name}: доставлено еды — ${delivered}`);
      returnHome(world, entity);
    }
  }
  if (world.tick % (450 / SOCIAL_EVENT_RATE) !== 0) return;
  // One shipment per road, including its return journey; the global cap bounds path work.
  for (const road of world.society.roads) {
    if (!roadIsIntact(world, road)) continue;
    const a = village(world, road.a), b = village(world, road.b);
    if (!a || !b) continue;
    const [from, to] = a.food >= b.food ? [a, b] : [b, a];
    const amount = Math.floor((from.food - to.food) / 2);
    if (amount >= 2) dispatchCaravan(world, from.id, to.id, amount);
  }
}
