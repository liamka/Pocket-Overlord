import type { World } from '../core/world';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import { recordService } from '../core/village-life';
import { weaponBonus } from '../core/stone';
import { seasonAt } from '../core/seasons';
import { findPath } from './navigation';
import { atWar, villageOf } from './society';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const danger = (e: Entity): boolean => !!(e.components.thermal?.burning || e.components.explosive);

function animalRoute(world: World, from: Vec2, to: Vec2, reach: number): Vec2[] | undefined {
  const path = findPath(world, from, to, reach);
  // Animals use land and bridges; they do not occupy passenger ferries.
  if (path?.some((p, i) => distance(i ? path[i - 1] : from, p) > 1.6)) return;
  return path;
}

function nearbySite(world: World, center: Vec2, min: number, max: number): Vec2 | undefined {
  for (let i = 0; i < 16; i++) {
    const angle = world.rng.range(0, Math.PI * 2), radius = world.rng.range(min, max);
    const p = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    if (world.canStand(p, 0.3) && !world.nearby(p, 3).some(danger)) return p;
  }
}

function establishHerds(world: World): void {
  if (world.tick % 150 !== 0) return;
  for (const village of world.society.villages) {
    const residents = [...world.query('person', 'citizen', 'position')].filter(e => e.components.citizen!.villageId === village.id
      && e.components.person!.age >= 18 && !e.components.person!.madness && e.components.person!.homeId !== null && e.components.citizen!.task !== 'migrate');
    if (residents.length < 3 || world.tick < village.founded + 600) continue;
    const state = village.livestock ??= { established: false, threatAfter: world.tick + 3600 };
    if (!state.established && village.food >= 8) {
      const owner = residents[0], home = world.entities.get(owner.components.person!.homeId!)!;
      let sheep = [...world.query('animal')].filter(e => e.components.animal!.kind === 'sheep' && e.components.animal!.villageId === village.id).length;
      for (; sheep < 2; sheep++) {
        const p = nearbySite(world, home.components.position!, 2, 5);
        const e = p && world.spawn('core:sheep', p);
        if (!e) break;
        e.components.animal!.villageId = village.id; village.food -= 2;
      }
      if (sheep >= 2) {
        const p = nearbySite(world, owner.components.position!, 1, 3), dog = p && world.spawn('core:dog', p);
        if (dog) {
          dog.components.animal!.ownerId = owner.id; dog.components.animal!.villageId = village.id;
          state.established = true;
          world.announce(`${village.name}: residents started keeping sheep and a guard dog`);
        }
      }
    }
    if (state.established && world.tick >= state.threatAfter) {
      state.threatAfter = world.tick + 5400;
      const sheep = [...world.query('animal', 'position')].find(e => e.components.animal!.kind === 'sheep' && e.components.animal!.villageId === village.id);
      if (!sheep || [...world.query('animal')].filter(e => e.components.animal!.kind === 'wolf').length >= 6) continue;
      const p = nearbySite(world, sheep.components.position!, 15, 23);
      if (p && animalRoute(world, p, sheep.components.position!, 1.2) !== undefined) world.spawn('core:wolf', p);
    }
  }
}

export function husbandry(world: World, dt: number): void {
  establishHerds(world);
  const season = seasonAt(world.tick);
  for (const entity of [...world.query('animal', 'position')]) {
    const a = entity.components.animal!, p = entity.components.position!;
    a.age += dt * 0.3; a.hunger = Math.min(100, a.hunger + dt * (a.kind === 'sheep' ? 0.65 * season.appetite : 0.3));
    a.breedIn = Math.max(0, a.breedIn - dt); a.produceIn = Math.max(0, a.produceIn - dt);
    a.attackIn = Math.max(0, a.attackIn - dt); a.decisionIn = Math.max(0, a.decisionIn - dt);
    if (a.kind === 'sheep' && season.growth > 0 && world.terrain.at(p.x, p.y) === Terrain.Grass && !world.terrain.surfaceAt(p.x, p.y)) a.hunger = Math.max(0, a.hunger - dt * 0.25);
    if (!world.terrain.isLand(p.x, p.y) || a.hunger >= 95 || a.age >= 160) {
      world.events.push({ kind: 'damage', target: entity.id, amount: dt * (a.age >= 160 ? 10 : 2) });
    }
    if (a.villageId !== null && !villageOf(world, a.villageId)) a.villageId = null;
    let owner = world.entities.get(a.ownerId ?? -1);
    if (a.kind === 'dog') {
      if (!owner?.components.person) {
        owner = [...world.query('person', 'citizen', 'position')].find(e => e.components.citizen!.villageId === a.villageId && distance(p, e.components.position!) < 12);
        a.ownerId = owner?.id ?? null;
      }
      if (owner) a.villageId = owner.components.citizen!.villageId;
    }
    const village = villageOf(world, a.villageId);
    if (a.kind === 'sheep' && village && a.hunger < 50 && a.age >= 18 && !entity.components.thermal?.burning) {
      if (a.produceIn <= 0) { village.food = Math.min(2000, village.food + 1); a.produceIn = 25; }
      if (a.breedIn <= 0) {
        const herd = [...world.query('animal', 'position')].filter(e => e.components.animal!.kind === 'sheep' && e.components.animal!.villageId === village.id);
        const mate = herd.find(e => e.id !== entity.id && e.components.animal!.age >= 18 && e.components.animal!.hunger < 50 && e.components.animal!.breedIn <= 0 && distance(p, e.components.position!) < 6);
        const site = herd.length < 8 && mate ? nearbySite(world, p, 1, 2) : undefined;
        const lamb = site && world.spawn('core:sheep', site);
        if (lamb) {
          lamb.components.animal!.age = 0; lamb.components.animal!.villageId = village.id;
          a.breedIn = 90; mate!.components.animal!.breedIn = 90;
          world.visual({ kind: 'birth', ...site!, radius: 1 }); world.announce(`${village.name}: a lamb was born`);
        }
      }
    }
    if (a.decisionIn <= 0) {
      a.decisionIn = 1; a.targetId = null;
      const nearby = world.nearby(p, 14), hazards = nearby.filter(e => danger(e) && distance(p, e.components.position!) < 6
        || a.kind === 'sheep' && e.components.animal?.kind === 'wolf' && distance(p, e.components.position!) < 8);
      let destination: Vec2 | undefined, reach = 1.2;
      if (hazards.length) {
        const q = hazards[0].components.position!, angle = Math.atan2(p.y - q.y, p.x - q.x);
        for (const turn of [0, 0.7, -0.7, 1.4, -1.4]) {
          const candidate = { x: p.x + Math.cos(angle + turn) * 4, y: p.y + Math.sin(angle + turn) * 4 };
          if (world.canStand(candidate, 0.2)) { destination = candidate; break; }
        }
      } else if (a.kind === 'wolf' && a.hunger >= 15) {
        const prey = nearby.filter(e => e.components.animal?.kind === 'sheep').sort((x, y) => distance(p, x.components.position!) - distance(p, y.components.position!))[0];
        if (prey) { a.targetId = prey.id; destination = prey.components.position; reach = 0.8; }
      } else if (a.kind === 'dog') {
        const home = world.entities.get(owner?.components.person?.homeId ?? -1)?.components.position;
        const enemy = nearby.find(e => e.components.animal?.kind === 'wolf'
          || e.components.citizen && e.components.person!.age >= 18 && atWar(world, a.villageId, e.components.citizen.villageId)
          && !!home && distance(home, e.components.position!) < 7);
        if (enemy) { a.targetId = enemy.id; destination = enemy.components.position; reach = 0.8; }
        else if (owner && distance(p, owner.components.position!) > 2.3) { destination = owner.components.position; reach = 1.8; }
        else if (home && !owner) destination = home;
      }
      if (!destination && a.kind !== 'dog') {
        const center = village ?? p;
        destination = nearbySite(world, distance(p, center) > 9 ? center : p, 1, 3);
      }
      a.path = destination ? animalRoute(world, p, destination, reach) ?? [] : [];
    }
    const target = world.entities.get(a.targetId ?? -1);
    if (target?.components.health && a.kind !== 'sheep' && distance(p, target.components.position!) <= 1.4 && a.attackIn <= 0 && !entity.components.thermal?.burning) {
      const damage = a.kind === 'dog' ? 9 : 5;
      world.events.push({ kind: 'damage', target: target.id, amount: damage }); a.attackIn = 1;
      if (a.kind === 'wolf') a.hunger = Math.max(0, a.hunger - 8);
      else if (owner) recordService(owner, 0.1);
    }
    while (a.path.length && distance(p, a.path[0]) < 0.15) a.path.shift();
    const next = a.path[0]; a.moving = false;
    if (next) {
      const heading = Math.atan2(next.y - p.y, next.x - p.x), speed = a.kind === 'sheep' ? 1.3 : 2.2;
      const step = Math.min(distance(p, next), speed * dt * (a.age < 18 ? 0.7 : 1));
      const q = { x: p.x + Math.cos(heading) * step, y: p.y + Math.sin(heading) * step };
      if (world.canStand(q, 0.15, entity.id)) {
        p.x = q.x; p.y = q.y; a.heading = heading; a.stride = (a.stride + step * 7) % (Math.PI * 2); a.moving = true;
        world.spatial.update(entity);
      } else { a.decisionIn = Math.min(a.decisionIn, 0.2); a.path = []; }
    }
  }
}

export function assignAnimalCare(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!, p = entity.components.position!, village = villageOf(world, c.villageId);
  if (!village || entity.components.person!.age < 18 || c.hunger >= 70) return false;
  const animals = world.nearby(p, 12).filter(e => e.components.animal);
  const wolf = animals.find(e => e.components.animal!.kind === 'wolf' && world.nearby(e.components.position!, 5).some(other => other.components.animal?.kind === 'sheep' && other.components.animal.villageId === village.id));
  const feed = village.food > 2 ? animals.find(e => e.components.animal!.villageId === village.id && e.components.animal!.hunger >= 45
    && ![...world.query('citizen')].some(other => other.id !== entity.id && other.components.citizen!.task === 'tend' && other.components.citizen!.targetId === e.id)) : undefined;
  const target = wolf ?? feed;
  if (!target) return false;
  const path = findPath(world, p, target.components.position!, wolf ? 1 : 1.6);
  if (!path) return false;
  c.task = wolf ? 'guard' : 'tend'; c.targetId = target.id; c.path = path; c.repair = null; c.reconsiderIn = 1;
  return true;
}

export function continueAnimalCare(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!;
  if (c.task !== 'tend' && c.task !== 'guard') return false;
  const target = world.entities.get(c.targetId ?? -1), a = target?.components.animal, village = villageOf(world, c.villageId);
  if (!a || !village || c.hunger >= 70 || target!.components.thermal?.burning || entity.components.thermal?.burning
    || c.task === 'tend' && (a.hunger < 30 || a.villageId !== village.id || village.food < 1) || c.task === 'guard' && a.kind !== 'wolf') {
    c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0; return false;
  }
  if (!c.path.length && distance(entity.components.position!, target!.components.position!) <= (c.task === 'guard' ? 1.5 : 2)) {
    if (c.task === 'tend') {
      village.food--; a.hunger = Math.max(0, a.hunger - 55); recordService(entity, 0.5);
      c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0;
    } else if (c.attackIn <= 0) { world.events.push({ kind: 'damage', target: target!.id, amount: 10 + weaponBonus(entity) }); c.attackIn = 1; recordService(entity, 0.1); }
  } else if (c.reconsiderIn <= 0 || !c.path.length) {
    const route = findPath(world, entity.components.position!, target!.components.position!, c.task === 'guard' ? 1 : 1.6);
    if (!route) { c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0; return false; }
    c.path = route; c.reconsiderIn = 1;
  }
  return true;
}
