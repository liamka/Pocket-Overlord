import { setForbiddenKnowledge } from '../src/core/world-rules';
import { createRegistry } from '../src/content/defaults';
import type { Registry } from '../src/content/registry';
import { World } from '../src/core/world';
import { assignHouse } from '../src/systems/society';
import { STEP, Terrain, type Vec2, type Village } from '../src/core/types';
import { deposit, takeFood } from '../src/core/resource-ledger';
import { bundleLoad } from '../src/core/resources';
import { roadIsIntact } from '../src/core/roads';
import { aboardFerry, waitingForFerry } from '../src/core/ferries';
import { cancelJob } from '../src/core/jobs';
import { cancelBehaviour } from '../src/core/behaviour';
import { assignRepair, continueRepair, roadRepairs } from '../src/systems/road-repair';
import { movement } from '../src/systems/people';
import { ferries } from '../src/systems/ferries';
import { roads } from '../src/systems/society';

/** Fixture supplies must update the physical ledger, including snapshots used as fixtures. */
export function setFood(village: Village, amount: number, buildingId?: number): void {
  if (!village.economy?.storage) { village.food = amount; return; }
  takeFood(village, village.food);
  const store = village.economy.storage.find(s => buildingId === undefined || s.buildingId === buildingId);
  if (store) store.capacity = Math.max(store.capacity, bundleLoad(store.goods).volume + amount);
  deposit(village, { provisions: amount }, buildingId);
}

export function flatWorld(registry: Registry = createRegistry()): World {
  const source = new World(12345, registry);
  const snapshot = source.snapshot();
  snapshot.entities = []; snapshot.nextEntityId = 1;
  snapshot.terrain = { width: 48, height: 48, tiles: new Array(48 * 48).fill(Terrain.Grass), moisture: new Array(48 * 48).fill(0), recovery: [] };
  return new World(snapshot.seed, registry, snapshot);
}
/** Editors are explicitly enabled only in fixtures that exercise editing. */
export function editorWorld(): World { const world = flatWorld(); setForbiddenKnowledge(world, true); return world; }
export function advance(world: World, seconds: number): void { for (let i = 0; i < Math.round(seconds / STEP); i++) world.step(); }

/** Isolate road labour from unrelated city decisions; movement and ferries remain physical. */
export function workRoad(world: World, observe?: () => void): void {
  roads(world);
  const road = world.society.roads[0], people = [...world.query('person', 'citizen', 'position')];
  if (!road) throw new Error('No road planned');
  for (const e of people) { cancelJob(world, e, 'No work needed'); cancelBehaviour(world, e); }
  for (let n = 0; n < 600 * 30 && !roadIsIntact(world, road); n++) {
    world.tick++; roads(world);
    if (world.tick % 15 === 0) {
      const queue = roadRepairs(world, people);
      for (const e of people) {
        e.components.citizen!.reconsiderIn -= 0.5;
        if (aboardFerry(world, e.id) || waitingForFerry(world, e)) continue;
        if (!continueRepair(world, e, queue)) assignRepair(world, e, queue);
      }
    }
    ferries(world, STEP); movement(world, STEP); observe?.();
  }
  if (!roadIsIntact(world, road)) throw new Error('Road workers did not finish');
}

export function villageWorld(centers: Vec2[] = [{ x: 8, y: 24 }, { x: 36, y: 24 }]): World {
  const world = flatWorld();
  for (const center of centers) {
    world.spawn('core:house', center);
    for (let i = 0; i < 4; i++) {
      const person = world.spawn('core:person', { x: center.x + (i % 2 ? 2 : -2), y: center.y + (i < 2 ? 2 : -2) })!;
      person.components.person!.sex = i % 2 ? 'b' : 'a';
      person.components.person!.reproduceIn = 30;
    }
  }
  advance(world, 1);
  return world;
}

export function diplomaticWorld(count = 8): World {
  const source = flatWorld(), snapshot = source.snapshot();
  snapshot.terrain = { width: 96, height: 64, tiles: Array(96 * 64).fill(Terrain.Grass), moisture: Array(96 * 64).fill(0), recovery: [] };
  const world = new World(snapshot.seed, source.registry, snapshot);
  for (let i = 0; i < count; i++) {
    const center = { x: 10 + i % 4 * 22, y: i < 4 ? 10 : 40 };
    const house = world.spawn('core:house', center)!;
    const village = assignHouse(world, house);
    for (let j = 0; j < 4; j++) {
      const e = world.spawn('core:person', { x: center.x + (j % 2 ? 2 : -2), y: center.y + (j < 2 ? 2 : -2) })!;
      e.components.person!.homeId = house.id; e.components.citizen!.villageId = village.id;
      e.components.person!.sex = j % 2 ? 'b' : 'a';
    }
  }
  for (let i = 1; i < world.society.villages.length; i++) {
    const a = world.society.villages[i - 1], b = world.society.villages[i], tiles: number[] = [];
    let x = a.x, y = a.y;
    while (x !== b.x || y !== b.y) {
      if (x !== b.x) x += Math.sign(b.x - x); else y += Math.sign(b.y - y);
      tiles.push(world.terrain.index(x, y)); world.terrain.set(x, y, Terrain.Road);
    }
    world.society.roads.push({ a: a.id, b: b.id, tiles, built: tiles.length });
  }
  for (const r of world.society.relations) { r.affinity = 0; r.nextDecision = 100000; r.roadAttempt = -1; }
  return world;
}

export function withCrate(): Registry {
  return createRegistry().registerEntity({ id: 'test:wooden-crate', sprite: 'crate', create: position => ({
    position: { ...position }, health: { current: 100, max: 100 }, combustible: { fuel: 50, ignition: 25 },
    thermal: { temperature: 0, wetness: 0, burning: false }, solid: { radius: 0.5 },
  }) });
}

export function migrationWorld(): World {
  const world = flatWorld();
  const home = world.spawn('core:house', { x: 8, y: 24 })!, from = assignHouse(world, home);
  const destination = world.spawn('core:house', { x: 36, y: 24 })!, to = assignHouse(world, destination);
  from.food = 0; from.migrationAfter = 0; to.food = 80; to.migrationAfter = 100000;
  const family = [{ x: 6, y: 22 }, { x: 10, y: 22 }, { x: 8, y: 26 }].map(p => world.spawn('core:person', p)!);
  for (const [i, person] of family.entries()) {
    Object.assign(person.components.person!, { homeId: home.id, age: i === 2 ? 4 : 24, sex: i === 0 ? 'a' : 'b', reproduceIn: 100000, buildIn: 100000 });
    Object.assign(person.components.citizen!, { villageId: from.id, hunger: 70, partnerId: i < 2 ? family[1 - i].id : null, parents: i === 2 ? [family[0].id, family[1].id] : [] });
  }
  world.society.relations[0].nextDecision = 100000;
  return world;
}

export function pioneerWorld(): World {
  const source = flatWorld(), data = source.snapshot();
  data.terrain = { width: 96, height: 64, tiles: Array(96 * 64).fill(Terrain.Grass), moisture: Array(96 * 64).fill(0), recovery: [] };
  const world = new World(data.seed, source.registry, data);
  for (let h = 0; h < 3; h++) {
    const home = world.spawn('core:house', { x: 16 + h * 4, y: 32 })!, village = assignHouse(world, home);
    village.food = 200; village.migrationAfter = 0;
    const family = Array.from({ length: 4 }, (_, i) => world.spawn('core:person', { x: 16 + h * 4 + (i % 2 ? 1.5 : -1.5), y: 32 + (i < 2 ? -2 : 2) })!);
    family.forEach((person, i) => {
      Object.assign(person.components.person!, { homeId: home.id, sex: i % 2 ? 'b' : 'a', reproduceIn: 100000, buildIn: 100000 });
      Object.assign(person.components.citizen!, { villageId: village.id, partnerId: family[i % 2 ? i - 1 : i + 1].id });
    });
  }
  return world;
}
