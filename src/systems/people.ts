import type { World } from '../core/world';
import { isRoadSurface, POPULATION_LIMIT, SOCIAL_EVENT_RATE, type Entity, type Vec2 } from '../core/types';
import { findPath, findShorePath } from './navigation';
import { assignHouse, atWar, villageOf } from './society';
import { RACES, raceOf } from '../core/races';
import { campaignObjective } from './diplomacy';
import { assignRepair, continueRepair, roadRepairs } from './road-repair';
import { seasonAt } from '../core/seasons';
import { aboardFerry, waitingForFerry } from '../core/ferries';
import { approachFerry } from './ferries';
import { reservedBeds } from './migration';
import { recordResidentMovement } from '../core/resident-animation';
import { assignConstruction, continueConstruction, startConstruction } from './construction';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const endangered = (world: World, p: Vec2): boolean => world.nearby(p, 7).some(e => e.components.explosive || e.components.thermal?.burning);

function swim(world: World, entity: Entity, dt: number): void {
  const { motion, position, person, citizen } = entity.components, m = motion!, p = position!;
  if (citizen) { if (citizen.task !== 'migrate') citizen.task = 'idle'; citizen.targetId = null; citizen.reconsiderIn = 0; citizen.repair = null; }
  if (m.decisionIn <= 0) {
    const path = findShorePath(world, p, entity.id);
    if (citizen) citizen.path = path;
    if (!path.length) m.heading = world.rng.range(0, Math.PI * 2);
    m.decisionIn = 1;
  }
  while (citizen?.path.length && distance(p, citizen.path[0]) < 0.1) citizen.path.shift();
  const waypoint = citizen?.path[0];
  let speed = m.speed * 0.6 * (person!.age < 18 ? 0.7 : 1);
  if (waypoint) { m.heading = Math.atan2(waypoint.y - p.y, waypoint.x - p.x); speed = Math.min(speed, distance(p, waypoint) / dt); }
  const dx = (Math.cos(m.heading) * speed + m.vx) * dt, dy = (Math.sin(m.heading) * speed + m.vy) * dt;
  const substeps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
  for (let i = 0; i < substeps; i++) {
    const next = { x: p.x + dx / substeps, y: p.y + dy / substeps };
    if (!world.canStand(next, 0.17, entity.id, true)) { m.decisionIn = Math.min(m.decisionIn, 0.2); break; }
    p.x = next.x; p.y = next.y;
    if (world.terrain.isLand(p.x, p.y)) {
      m.decisionIn = 0;
      if (citizen) citizen.path = [];
      break;
    }
  }
  m.vx *= Math.exp(-6 * dt); m.vy *= Math.exp(-6 * dt); world.spatial.update(entity);
}

export function movement(world: World, dt: number): void {
  for (const entity of world.query('motion', 'position')) {
    const { motion: m, position: p, person, citizen } = entity.components;
    const previous = { ...p! };
    if (person) person.age += dt * 0.3;
    m!.decisionIn -= dt;
    if (person && approachFerry(world, entity, dt)) { recordResidentMovement(entity, previous, dt, aboardFerry(world, entity.id)); continue; }
    if (person && !world.terrain.isLand(p!.x, p!.y)) { swim(world, entity, dt); recordResidentMovement(entity, previous, dt); continue; }
    let speed = m!.speed * (person && person.age < 18 ? 0.7 : 1);
    if (isRoadSurface(world.terrain.at(p!.x, p!.y))) speed *= 1.4;
    else speed *= world.terrain.biomeAt(p!.x, p!.y).walking;
    let fleeX = 0, fleeY = 0;
    for (const other of world.nearby(p!, 8)) {
      if (other.id === entity.id) continue;
      const enemy = citizen && other.components.citizen && atWar(world, citizen.villageId, other.components.citizen.villageId)
        && (person!.age < 18 || citizen.task !== 'fight');
      if (!enemy) continue;
      const op = other.components.position!, d = distance(p!, op);
      if (d > 4) continue;
      fleeX += (p!.x - op.x || 0.01) / Math.max(0.1, d * d);
      fleeY += (p!.y - op.y || 0.01) / Math.max(0.1, d * d);
    }
    if (fleeX || fleeY) {
      m!.heading = Math.atan2(fleeY, fleeX); speed *= 2.3;
      if (citizen) { citizen.path = []; citizen.reconsiderIn = 0; }
    } else if (citizen && citizen.task !== 'idle') {
      while (citizen.path.length && distance(p!, citizen.path[0]) < 0.2) citizen.path.shift();
      const waypoint = citizen.path[0];
      if (waypoint) { m!.heading = Math.atan2(waypoint.y - p!.y, waypoint.x - p!.x); speed = Math.min(speed, distance(p!, waypoint) / dt); }
      else {
        const target = world.entities.get(citizen.targetId ?? -1)?.components.position;
        const reach = citizen.task === 'fight' ? 1.3 : 1.9;
        if (target && distance(p!, target) > reach && distance(p!, target) < 3) m!.heading = Math.atan2(target.y - p!.y, target.x - p!.x);
        else speed = 0;
      }
    } else if (m!.decisionIn <= 0) {
      const home = person?.homeId ? world.entities.get(person.homeId)?.components.position : undefined;
      m!.heading = home && distance(home, p!) > 6 ? Math.atan2(home.y - p!.y, home.x - p!.x) : world.rng.range(0, Math.PI * 2);
      m!.decisionIn = world.rng.range(1, 3.5);
    }
    const dx = (Math.cos(m!.heading) * speed + m!.vx) * dt, dy = (Math.sin(m!.heading) * speed + m!.vy) * dt;
    const substeps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
    for (let s = 0; s < substeps; s++) {
      const next = { x: p!.x + dx / substeps, y: p!.y + dy / substeps };
      if (world.canStand(next, 0.17, entity.id)) {
        if (person && (dx || dy)) world.terrain.useRoad(p!.x, p!.y);
        p!.x = next.x; p!.y = next.y;
        if (person && (dx || dy)) world.terrain.useRoad(p!.x, p!.y);
      }
      else {
        m!.heading += world.rng.range(0.8, 2.3); m!.decisionIn = 0.2;
        // Yield around another resident instead of indefinitely blocking a shared route.
        if (citizen && citizen.path.length) {
          const side = { x: p!.x + Math.cos(m!.heading) * 0.5, y: p!.y + Math.sin(m!.heading) * 0.5 };
          if (world.canStand(side, 0.17, entity.id)) citizen.path.unshift(side);
          citizen.reconsiderIn = Math.min(citizen.reconsiderIn, 0.5);
        }
        break;
      }
    }
    m!.vx *= Math.exp(-6 * dt); m!.vy *= Math.exp(-6 * dt); world.spatial.update(entity);
    recordResidentMovement(entity, previous, dt);
  }
}

function findSite(world: World, center: Vec2, radius: number, attempts: number, size: number): Vec2 | undefined {
  for (let i = 0; i < attempts; i++) {
    const angle = world.rng.range(0, Math.PI * 2), d = world.rng.range(2, radius);
    const p = { x: center.x + Math.cos(angle) * d, y: center.y + Math.sin(angle) * d };
    if (size > 1 && isRoadSurface(world.terrain.at(p.x, p.y))) continue;
    if (world.nearby(p, size + 1.8).some(e => e.components.farm)) continue;
    if (world.safeLand(p, size) && world.canStand(p, size)) return p;
  }
}

export function settlement(world: World): void {
  // Keep saved countdown units while slowing decisions and family milestones together.
  if (world.tick % (15 / SOCIAL_EVENT_RATE) !== 0) return;
  const residents = new Map<number, Entity[]>();
  const reserved = reservedBeds(world);
  const people = [...world.query('person', 'position', 'citizen')];
  for (const entity of people) {
    const person = entity.components.person!;
    person.buildIn -= 0.5; person.reproduceIn = Math.max(0, person.reproduceIn - 0.5);
    if (person.homeId && !world.entities.has(person.homeId)) person.homeId = null;
    if (person.homeId) { const list = residents.get(person.homeId) ?? []; list.push(entity); residents.set(person.homeId, list); }
  }
  const moveIn = (entity: Entity, house: Entity): void => {
    const person = entity.components.person!, old = residents.get(person.homeId ?? -1);
    if (old) { const index = old.indexOf(entity); if (index >= 0) old.splice(index, 1); }
    person.homeId = house.id; entity.components.citizen!.villageId = assignHouse(world, house).id;
    const list = residents.get(house.id) ?? []; list.push(entity); residents.set(house.id, list);
  };
  for (const entity of people) {
    const person = entity.components.person!, citizen = entity.components.citizen!, position = entity.components.position!;
    if (citizen.task === 'migrate' || aboardFerry(world, entity.id)) continue;
    if (!world.terrain.isLand(position.x, position.y) || entity.components.thermal?.burning || endangered(world, position)) continue;
    if (person.homeId !== null) {
      const home = world.entities.get(person.homeId)!;
      citizen.villageId = assignHouse(world, home).id;
    }
    if (person.homeId === null) {
      const home = world.nearby(position, 18).find(e => e.components.dwelling && !e.components.thermal?.burning
        && raceOf(e) === raceOf(entity)
        && !atWar(world, citizen.villageId, e.components.dwelling.villageId)
        && (residents.get(e.id)?.length ?? 0) + (reserved.get(e.id) ?? 0) < e.components.dwelling.capacity);
      if (home) moveIn(entity, home);
      else if (person.age >= 18 && person.buildIn <= 0) {
        const site = findSite(world, position, 6, 12, 1.3), house = site && startConstruction(world, site, entity);
        if (house) moveIn(entity, house);
        person.buildIn = world.rng.range(7, 12) * RACES[raceOf(entity)].construction;
      }
    }
  }
  for (const entity of people) {
    const person = entity.components.person!, citizen = entity.components.citizen!, village = villageOf(world, citizen.villageId);
    if (citizen.task === 'migrate' || aboardFerry(world, entity.id) || person.age < 18 || !village || person.homeId === null || entity.components.thermal?.burning
      || !world.terrain.isLand(entity.components.position!.x, entity.components.position!.y)) continue;
    if (citizen.partnerId === null) {
      const partner = people.find(other => {
        const p = other.components.person!, c = other.components.citizen!;
        return other.id !== entity.id && c.task !== 'migrate' && p.age >= 18 && p.sex !== person.sex && c.partnerId === null && c.villageId === village.id
          && raceOf(other) === raceOf(entity)
          && world.terrain.isLand(other.components.position!.x, other.components.position!.y)
          && !other.components.thermal?.burning && !citizen.parents.includes(other.id) && !c.parents.includes(entity.id)
          && !citizen.parents.some(id => c.parents.includes(id));
      });
      if (partner) {
        citizen.partnerId = partner.id; partner.components.citizen!.partnerId = entity.id;
        world.visual({ kind: 'love', target: entity.id, ...entity.components.position!, radius: 1 });
        world.visual({ kind: 'love', target: partner.id, ...partner.components.position!, radius: 1 });
        world.announce(`${village.name}: образовалась новая семья`);
      }
    }
    const candidate = world.entities.get(citizen.partnerId ?? -1);
    const partner = candidate && candidate.components.citizen?.task !== 'migrate' && world.terrain.isLand(candidate.components.position!.x, candidate.components.position!.y) ? candidate : undefined;
    if (person.sex !== 'a' || !partner && citizen.pregnancy === 0) continue;
    let home = world.entities.get(person.homeId)!;
    let members = residents.get(home.id)!;
    if (partner && partner.components.person!.homeId !== home.id && members.length + (reserved.get(home.id) ?? 0) < home.components.dwelling!.capacity) moveIn(partner, home);
    // Crowded families build their own home before trying to have a child.
    if (partner && !home.components.dwelling!.construction && (members.length >= home.components.dwelling!.capacity || partner.components.person!.homeId !== home.id) && person.buildIn <= 0) {
      const site = findSite(world, village, 11, 16, 1.3), newHome = site && startConstruction(world, site, entity);
      if (newHome) { newHome.components.dwelling!.villageId = village.id; moveIn(entity, newHome); moveIn(partner, newHome); home = newHome; members = residents.get(home.id)!; }
      person.buildIn = 12 * RACES[raceOf(entity)].construction;
    }
    const safe = !home.components.dwelling!.construction && !endangered(world, home.components.position!) && !home.components.thermal?.burning;
    if (citizen.pregnancy > 0) {
      citizen.pregnancy = Math.max(0.01, citizen.pregnancy - 0.5);
      if (citizen.pregnancy > 0.01 || !safe || members.length + (reserved.get(home.id) ?? 0) >= home.components.dwelling!.capacity || world.population >= POPULATION_LIMIT) continue;
      const site = findSite(world, home.components.position!, 4, 10, 0.3), child = site && world.spawn(RACES[raceOf(entity)].entityId, site);
      if (child) {
        child.components.person!.age = 0; child.components.person!.reproduceIn = 30;
        child.components.citizen!.parents = [entity.id, citizen.fatherId!]; moveIn(child, home);
        citizen.pregnancy = 0; citizen.fatherId = null; person.reproduceIn = 32;
        if (partner) partner.components.person!.reproduceIn = 32;
        world.visual({ kind: 'birth', ...site, radius: 1 }); world.announce(`${village.name}: родился ребёнок`);
      }
    } else if (partner && safe && person.reproduceIn <= 0 && partner.components.person!.reproduceIn <= 0 && village.food >= 3
      && citizen.hunger < 65 && partner.components.citizen!.hunger < 65 && members.length + (reserved.get(home.id) ?? 0) < home.components.dwelling!.capacity
      && partner.components.person!.homeId === home.id && world.population < POPULATION_LIMIT
      && distance(entity.components.position!, partner.components.position!) < 16) {
      citizen.pregnancy = 8; citizen.fatherId = partner.id; village.food -= 2;
    }
  }
}

export function intentions(world: World): void {
  if (world.tick % 15 !== 0) return;
  const season = seasonAt(world.tick);
  const people = [...world.query('person', 'citizen', 'position')];
  const repairs = roadRepairs(world, people);
  const houses = [...world.query('dwelling', 'position')], fields = [...world.query('farm', 'position')];
  const assignments = new Map<number, number>();
  for (const e of people) if (e.components.citizen!.task === 'farm') {
    const id = e.components.citizen!.targetId!; assignments.set(id, (assignments.get(id) ?? 0) + 1);
  }
  for (const entity of people) {
    const c = entity.components.citizen!, person = entity.components.person!, position = entity.components.position!;
    const stats = RACES[raceOf(entity)];
    const village = villageOf(world, c.villageId);
    c.hunger = Math.min(100, c.hunger + (person.age < 18 ? 0.4 : 0.55) * season.appetite);
    c.attackIn = Math.max(0, c.attackIn - 0.5); c.reconsiderIn -= 0.5;
    if (c.hunger >= 90) world.events.push({ kind: 'damage', target: entity.id, amount: 0.75 });
    if (person.age >= stats.lifespan) { world.events.push({ kind: 'damage', target: entity.id, amount: entity.components.health!.current }); continue; }
    if (c.task === 'migrate' || aboardFerry(world, entity.id) || waitingForFerry(world, entity)) continue;
    if (continueConstruction(world, entity)) continue;
    if (continueRepair(world, entity, repairs)) continue;
    if (!world.terrain.isLand(position.x, position.y)) continue;
    if (c.hunger < 30 && c.task !== 'fight' && entity.components.health && !entity.components.thermal?.burning) entity.components.health.current = Math.min(entity.components.health.max, entity.components.health.current + stats.recovery);
    const current = world.entities.get(c.targetId ?? -1);
    if (current && c.task === 'eat' && village && current.components.dwelling?.villageId === village.id && distance(position, current.components.position!) < 2.4 && village.food >= 1) {
      village.food--; c.hunger = Math.max(0, c.hunger - 45); c.reconsiderIn = 0;
    }
    if (current && c.task === 'fight' && atWar(world, c.villageId, current.components.citizen?.villageId ?? current.components.dwelling?.villageId ?? null)
      && distance(position, current.components.position!) <= (current.components.dwelling ? 2.3 : 1.5) && c.attackIn <= 0 && !endangered(world, position)) {
      world.events.push({ kind: 'damage', target: current.id, amount: current.components.dwelling ? stats.damage / 2 : stats.damage }); c.attackIn = stats.attackInterval;
    }
    if (c.reconsiderIn > 0) continue;
    c.reconsiderIn = 2 + entity.id % 4 * 0.5;
    let task: typeof c.task = 'idle', target: Entity | undefined;
    let route: Vec2[] | undefined;
    const nearest = (list: Entity[]): Entity | undefined => list.sort((a, b) => distance(position, a.components.position!) - distance(position, b.components.position!))[0];
    if (village && c.hunger >= 55 && village.food >= 1) {
      target = nearest(houses.filter(e => e.components.dwelling!.villageId === village.id && !e.components.thermal?.burning)); task = 'eat';
    } else if (person.age >= 18 && village && entity.id % 3 !== 0 && c.hunger < 85) {
      const enemies = people.filter(e => e.components.person!.age >= 18 && atWar(world, village.id, e.components.citizen!.villageId));
      const objective = campaignObjective(world, village.id);
      target = nearest(enemies.filter(e => distance(position, e.components.position!) < 12))
        ?? nearest(houses.filter(e => e.components.dwelling!.villageId === objective))
        ?? nearest(enemies.filter(e => e.components.citizen!.villageId === objective));
      if (target) task = 'fight';
    }
    if (!target) {
      const formerField = c.task === 'farm' ? c.targetId : null;
      if (assignConstruction(world, entity) || assignRepair(world, entity, repairs)) {
        if (formerField !== null) assignments.set(formerField, Math.max(0, (assignments.get(formerField) ?? 0) - 1));
        continue;
      }
    }
    if (!target && person.age >= 18 && village) {
      const available = season.growth > 0 ? fields.filter(e => e.components.farm!.villageId === village.id && !e.components.thermal?.burning) : [];
      available.sort((a, b) => ((assignments.get(a.id) ?? 0) - Number(c.targetId === a.id)) - ((assignments.get(b.id) ?? 0) - Number(c.targetId === b.id)) || distance(position, a.components.position!) - distance(position, b.components.position!));
      for (const field of available) {
        const path = findPath(world, position, field.components.position!, 1.8);
        if (path !== undefined) { target = field; route = path; task = 'farm'; break; }
      }
      const visiting = entity.id % 6 === 0 && Math.floor(world.tick / 300) % 3 === 1 && c.hunger < 50;
      if (visiting) {
        const ally = nearest(houses.filter(h => world.society.relations.some(r => r.status === 'alliance' && (r.a === village.id && r.b === h.components.dwelling!.villageId || r.b === village.id && r.a === h.components.dwelling!.villageId))));
        if (ally) { target = ally; route = undefined; task = 'visit'; }
      }
    }
    if (c.task === 'farm' && c.targetId !== null) assignments.set(c.targetId, Math.max(0, (assignments.get(c.targetId) ?? 0) - 1));
    c.task = target ? task : 'idle'; c.targetId = target?.id ?? null;
    c.repair = null;
    c.path = route ?? (target ? findPath(world, position, target.components.position!, task === 'fight' && !target.components.dwelling ? 1 : 1.8) ?? [] : []);
    if (c.task === 'farm') assignments.set(target!.id, (assignments.get(target!.id) ?? 0) + 1);
  }
}
