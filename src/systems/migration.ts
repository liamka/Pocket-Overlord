import { aboardFerry } from '../core/ferries';
import type { World } from '../core/world';
import { ENTITY_LIMIT, SOCIAL_EVENT_RATE, type Entity, type Migration, type Vec2, type Village } from '../core/types';
import { foodReserve, seasonAt } from '../core/seasons';
import { assignHouse, atWar, buildHouse, fertilePatch, villageOf } from './society';
import { raceOf } from '../core/races';
import { findPath, reachableTiles } from './navigation';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const inWar = (world: World, id: number): boolean => world.society.wars.some(w => w.attackers.includes(id) || w.defenders.includes(id));
const occupants = (world: World, home: number): number => [...world.query('person')].filter(e => e.components.person!.homeId === home).length;

/** Reserved beds remain unavailable to births and ordinary housing assignments. */
export function reservedBeds(world: World): Map<number, number> {
  const result = new Map<number, number>();
  for (const group of world.society.migrations) {
    const id = group.homeIds[0];
    if (id !== undefined) result.set(id, (result.get(id) ?? 0) + group.members.length);
  }
  return result;
}

function household(world: World, adult: Entity, residents: Entity[]): Entity[] | undefined {
  const members = new Set([adult.id]);
  const partner = world.entities.get(adult.components.citizen!.partnerId ?? -1);
  if (partner) {
    if (!residents.includes(partner) || partner.components.citizen!.task === 'migrate') return;
    members.add(partner.id);
  }
  for (const child of residents) {
    if (child.components.person!.age >= 18) continue;
    if (child.components.citizen!.parents.some(id => members.has(id))
      || child.components.citizen!.parents.length === 0 && child.components.person!.homeId !== null && child.components.person!.homeId === adult.components.person!.homeId) members.add(child.id);
  }
  const family = residents.filter(e => members.has(e.id));
  if (family.length > 5 || family.some(e => e.components.citizen!.task === 'migrate' || !world.terrain.isLand(e.components.position!.x, e.components.position!.y))) return;
  return family;
}

function colonySite(world: World, origin: Village, reachable: Int32Array): Vec2 | undefined {
  let best: Vec2 | undefined, score = Infinity;
  for (const radius of [24, 32, 40, 48]) for (let angle = 0; angle < 24; angle++) {
    const p = { x: Math.floor(origin.x + Math.cos(angle * Math.PI / 12) * radius) + 0.5, y: Math.floor(origin.y + Math.sin(angle * Math.PI / 12) * radius) + 0.5 };
    if (!world.terrain.inside(p.x, p.y) || reachable[world.terrain.index(p.x, p.y)] < 0
      || world.society.villages.some(v => distance(v, p) < 24)
      || world.society.migrations.some(g => g.toId === null && distance(g.destination, p) < 18)
      || !fertilePatch(world, p) || !world.canStand(p, 1.3)) continue;
    // The founders need a second clear building plot and farmland next to their homes.
    if (![[-4, 0], [4, 0], [0, -4], [0, 4]].some(([x, y]) => {
      const nearby = { x: p.x + x, y: p.y + y };
      return fertilePatch(world, nearby) && world.canStand(nearby, 1.3);
    })) continue;
    const next = reachable[world.terrain.index(p.x, p.y)];
    if (next < score) { score = next; best = p; }
  }
  return best;
}

function depart(world: World, from: Village, members: Entity[], destination: Vec2, home?: Entity): void {
  const food = Math.min(from.food, members.length * 3);
  from.food -= food; from.migrationAfter = world.tick + 1800 / SOCIAL_EVENT_RATE;
  const group: Migration = { id: world.society.nextMigrationId++, fromId: from.id, toId: home?.components.dwelling?.villageId ?? null,
    destination: { ...destination }, members: members.map(e => e.id), homeIds: home ? [home.id] : [], food, started: world.tick };
  world.society.migrations.push(group);
  for (const e of members) {
    e.components.person!.homeId = null;
    Object.assign(e.components.citizen!, { task: 'migrate', targetId: null, path: [], reconsiderIn: 0, repair: null });
  }
  const target = villageOf(world, group.toId);
  world.announce(target ? `Migration: ${from.name} → ${target.name} (${members.length})` : `Pioneers leave ${from.name} (${members.length})`);
}

/** Consider one village every five seconds; expensive reachability is only calculated for an eligible party. */
function plan(world: World): void {
  const villages = world.society.villages;
  if (world.tick % 150 !== 0 || !villages.length || world.society.migrations.length >= 16) return;
  const from = villages[Math.floor(world.tick / 150) % villages.length];
  if (world.tick < from.migrationAfter) return;
  const residents = [...world.query('person', 'citizen', 'position')].filter(e => e.components.citizen!.villageId === from.id && e.components.citizen!.task !== 'migrate');
  const families: Entity[][] = [], selected = new Set<number>();
  for (const adult of residents) {
    if (adult.components.person!.age < 18 || selected.has(adult.id)) continue;
    const family = household(world, adult, residents);
    if (!family || family.some(e => selected.has(e.id))) continue;
    families.push(family); for (const e of family) selected.add(e.id);
  }
  if (!families.length) return;
  const war = inWar(world, from.id);
  const need = families.find(f => war || f.some(e => e.components.person!.homeId === null)
    || from.food < residents.length * 0.5 && f.some(e => e.components.citizen!.hunger >= 65));
  const reserved = reservedBeds(world);
  if (need) {
    const homes = [...world.query('dwelling', 'position')].filter(h => {
      const d = h.components.dwelling!, to = villageOf(world, d.villageId);
      return to && to.id !== from.id && !inWar(world, to.id) && !atWar(world, from.id, to.id) && !h.components.thermal?.burning
        && need.every(e => raceOf(e) === raceOf(h))
        && d.capacity - occupants(world, h.id) - (reserved.get(h.id) ?? 0) >= need.length
        && to.food >= foodReserve(world.tick, [...world.query('citizen')].filter(e => e.components.citizen!.villageId === to.id).length + need.length);
    }).sort((a, b) => distance(from, a.components.position!) - distance(from, b.components.position!));
    for (const home of homes.slice(0, 3)) {
      const path = findPath(world, need[0].components.position!, home.components.position!, 2.2);
      if (path) { depart(world, from, need, home.components.position!, home); return; }
    }
  }
  if (war || seasonAt(world.tick).id === 'winter' || residents.length < 12 || families.length < 2 || world.entities.size > ENTITY_LIMIT - 4) return;
  const pioneers = families.filter(f => f.some(e => e.components.person!.age >= 18)).slice(0, 2).flat();
  if (pioneers.length < 4 || residents.length - pioneers.length < 4
    || from.food < foodReserve(world.tick, residents.length - pioneers.length) + pioneers.length * 3) return;
  const reachable = reachableTiles(world, [pioneers[0].components.position!], 120);
  if (pioneers.some(e => reachable[world.terrain.index(e.components.position!.x, e.components.position!.y)] < 0)) return;
  const site = colonySite(world, from, reachable);
  if (site) depart(world, from, pioneers, site);
  else from.migrationAfter = world.tick + 900 / SOCIAL_EVENT_RATE;
}

function finish(world: World, group: Migration, homes?: Entity[]): void {
  const source = villageOf(world, group.fromId), destination = homes?.[0] && villageOf(world, homes[0].components.dwelling!.villageId);
  for (const id of group.members) {
    const e = world.entities.get(id);
    if (!e?.components.citizen || !e.components.person) continue;
    const home = homes?.find(h => occupants(world, h.id) < h.components.dwelling!.capacity);
    if (home && destination) { e.components.person.homeId = home.id; e.components.citizen.villageId = destination.id; }
    Object.assign(e.components.citizen, { task: 'idle', targetId: null, path: [], reconsiderIn: 0, repair: null });
  }
  const pantry = destination ?? source;
  if (pantry) { pantry.food = Math.min(2000, pantry.food + group.food); pantry.migrationAfter = world.tick + 1800 / SOCIAL_EVENT_RATE; }
  if (destination) world.announce(`Migrants arrived in ${destination.name} (${group.members.length})`);
  else if (source) world.announce(`Migration from ${source.name} was interrupted`);
  world.society.migrations.splice(world.society.migrations.indexOf(group), 1);
}

function found(world: World, group: Migration): Entity[] | undefined {
  const count = Math.ceil(group.members.length / 5), sites: Vec2[] = [];
  for (const [x, y] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]]) {
    const p = { x: group.destination.x + x, y: group.destination.y + y };
    if (fertilePatch(world, p) && world.canStand(p, 1.3) && world.society.villages.every(v => distance(v, p) > 19)) sites.push(p);
    if (sites.length === count) break;
  }
  if (sites.length < count || world.entities.size + count > ENTITY_LIMIT) return;
  const founder = world.entities.get(group.members[0]);
  if (!founder) return;
  const homes = sites.map(p => buildHouse(world, p, raceOf(founder))!);
  const village = assignHouse(world, homes[0]);
  village.food = 0; // All starting supplies come from the expedition, never from free founding food.
  for (const home of homes) {
    home.components.dwelling!.villageId = village.id;
    home.components.dwelling!.construction = { progress: 0, struckAt: -1 };
  }
  return homes;
}

export function migrations(world: World): void {
  if (world.tick % 15 !== 0) return;
  let pathBudget = 1;
  for (const group of [...world.society.migrations]) {
    const members = group.members.map(id => world.entities.get(id)!).filter(Boolean);
    const home = world.entities.get(group.homeIds[0]);
    if (!members.some(e => e.components.person!.age >= 18) || world.tick - group.started > 3600
      || group.toId !== null && (!home?.components.dwelling || home.components.thermal?.burning || atWar(world, group.fromId, group.toId)
        || home.components.dwelling.capacity - occupants(world, home.id) < members.length)
      || !world.terrain.isLand(group.destination.x, group.destination.y)) { finish(world, group); continue; }
    for (const e of members) {
      const c = e.components.citizen!, p = e.components.position!;
      if (c.hunger >= 50 && group.food >= 1) { group.food--; c.hunger = Math.max(0, c.hunger - 45); }
      c.task = 'migrate'; c.targetId = null; c.repair = null;
      if (aboardFerry(world, e.id) || !world.terrain.isLand(p.x, p.y)) continue;
      if (distance(p, group.destination) <= 3.2) { c.path = []; continue; }
      if (pathBudget && (c.path.length === 0 || c.reconsiderIn <= 0 && e.components.motion!.decisionIn > 0)) {
        c.path = findPath(world, p, group.destination, 2.8) ?? [];
        c.reconsiderIn = 6; pathBudget--;
      }
    }
    if (members.every(e => world.terrain.isLand(e.components.position!.x, e.components.position!.y) && distance(e.components.position!, group.destination) <= 3.2)) {
      const homes = group.toId === null ? found(world, group) : [home!];
      if (homes) finish(world, group, homes);
    }
  }
  plan(world);
}
