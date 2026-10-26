import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain, STEP, type Migration } from '../src/core/types';
import { assignHouse } from '../src/systems/society';
import { territories, removeVillage } from '../src/systems/territory';
import { migrations } from '../src/systems/migration';
import { movement } from '../src/systems/people';
import { beginProject, housingLimit, transferBuilding } from '../src/core/buildings';
import { foundingZones, habitableZone, initializeTerritories, ownsPosition, zoneAt, zoneCenter, zoneNeighbours, TERRITORY } from '../src/core/territory';
import { DEVELOPMENT_GRAPHS, developmentProblem } from '../src/core/village-development';
import { governmentOf } from '../src/core/village-life';
import { initializeStorage } from '../src/core/stockpiles';
import { deposit, stockOf } from '../src/core/resource-ledger';
import { decodeSave } from '../src/persistence/schema';

function settlement() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 24 })!;
  const person = world.spawn('core:person', { x: 14, y: 24 })!;
  const village = assignHouse(world, home, person);
  person.components.person!.homeId = home.id; person.components.citizen!.villageId = village.id;
  initializeStorage(world, village);
  return { world, home, person, village };
}

describe('village territory', () => {
  it('owns each zone once and uses edges without wrapping rows', () => {
    const { world, village } = settlement();
    const other = assignHouse(world, world.spawn('core:house', { x: 36, y: 24 })!);
    expect(other.id).not.toBe(village.id);
    expect(village.territory!.zones.some(z => other.territory!.zones.includes(z))).toBe(false);
    expect(zoneNeighbours(world, 5)).not.toContain(6);
    expect(zoneNeighbours(world, 5)).not.toContain(10);
    expect(ownsPosition(world, village.id, { x: 36, y: 24 })).toBe(false);
    expect(housingLimit(world, village).zones).toBe(village.territory!.zones.length);
  });

  it('does not turn mountains or water into habitable land through adjacency', () => {
    const { world, village } = settlement(), z = zoneAt(world, { x: 28, y: 24 });
    const p = zoneCenter(world, z);
    world.terrain.set(p.x, p.y, Terrain.Mountain);
    expect(habitableZone(world, z)).toBe(false);
    expect(foundingZones(world, p)).toEqual([]);
    const owned = zoneCenter(world, village.territory!.zones[0]);
    world.terrain.set(owned.x, owned.y, Terrain.Water);
    expect(ownsPosition(world, village.id, owned)).toBe(false);
    expect(habitableZone(world, zoneAt(world, owned))).toBe(false);
  });

  it('reserves a colony without founding it and releases it if the adult dies', () => {
    const { world, person, village } = settlement(), destination = { x: 36, y: 24 };
    const child = world.spawn('core:person', { x: 15, y: 24 })!;
    child.components.person!.age = 1;
    const group: Migration = { id: world.society.nextMigrationId++, fromId: village.id, toId: null, members: [person.id, child.id],
      homeIds: [], destination, food: 0, foodGoods: {}, started: world.tick, reservedZones: foundingZones(world, destination) };
    world.society.migrations.push(group);
    for (const e of [person, child]) { e.components.person!.homeId = null; Object.assign(e.components.citizen!, { villageId: village.id, task: 'migrate' }); }
    expect(foundingZones(world, destination)).toEqual([]);
    expect(world.society.villages).toHaveLength(1);
    world.remove(person.id); world.tick = 15; migrations(world);
    expect(world.society.villages).toHaveLength(1);
    expect(world.society.migrations).toHaveLength(0);
    expect(child.components.citizen!.task).toBe('idle');
    expect(foundingZones(world, destination).length).toBeGreaterThan(0);
  });

  it('decays one zone per interval, freezes on pause, and stops when residents return', () => {
    const { world, person, village } = settlement(), count = village.territory!.zones.length;
    world.remove(person.id); world.tick = 30; territories(world);
    expect(village.territory!.zones).toHaveLength(count);
    const state = structuredClone(village.territory);
    world.paused = true; territories(world);
    expect(village.territory).toEqual(state);
    world.paused = false; world.tick += TERRITORY.decayTicks; territories(world);
    expect(village.territory!.zones).toHaveLength(count - 1);
    const arrival = world.spawn('core:person', { x: 14, y: 24 })!;
    arrival.components.citizen!.villageId = village.id;
    world.tick += 30; territories(world);
    expect(village.territory!.abandonedAt).toBeNull();
    world.tick += TERRITORY.decayTicks; territories(world);
    expect(village.territory!.zones).toHaveLength(count - 1);
  });

  it('keeps paid construction and upgraded capacity through a whole-zone transfer', () => {
    const { world, village } = settlement();
    const site = world.spawn('core:house', { x: 20, y: 24 })!;
    site.components.dwelling!.villageId = village.id;
    beginProject(site, 'upgrade'); Object.assign(site.components.building!.project!, { paid: true, progress: 0.5 });
    deposit(village, { stone: 8 });
    const other = assignHouse(world, world.spawn('core:house', { x: 36, y: 24 })!);
    expect(transferBuilding(world, site, other)).toBe(true);
    expect(transferBuilding(world, site, other)).toBe(true);
    expect(site.components.building!.project).toMatchObject({ paid: true, progress: 0.5 });
    expect(stockOf(village, 'stone')).toBe(8);
    expect(site.components.dwelling!.capacity).toBe(5);
    delete site.components.building!.project; site.components.building!.state = 'active'; site.components.building!.level = 2;
    Object.assign(site.components.dwelling!, { level: 2, capacity: 7 });
    transferBuilding(world, site, village);
    expect(site.components.dwelling).toMatchObject({ level: 2, capacity: 7, villageId: village.id });
  });

  it('retains an active frontier journey and RNG across a save and continuation', () => {
    const { world, person, village } = settlement();
    governmentOf(village).leaderId = person.id; village.territory!.expandAt = 0;
    world.tick = 30; territories(world);
    expect(village.territory!.expansion?.actorId).toBe(person.id);
    const saved = decodeSave(world.snapshot(), world.registry), resumed = new World(world.seed, world.registry, saved, []);
    for (let i = 0; i < 90; i++) for (const w of [world, resumed]) { w.tick++; movement(w, STEP); territories(w); }
    expect(resumed.snapshot()).toEqual(world.snapshot());
    expect(resumed.rng.state).toBe(world.rng.state);
  });

  it('does not regenerate lost land or grant supplies while adopting legacy saves', () => {
    const { world, village } = settlement(), before = stockOf(village, 'provisions'), rng = world.rng.state;
    delete village.territory; initializeTerritories(world);
    const zones = [...village.territory!.zones];
    initializeTerritories(world);
    expect(village.territory!.zones).toEqual(zones);
    village.territory!.zones = []; initializeTerritories(world);
    expect(village.territory!.zones).toEqual([]);
    expect(stockOf(village, 'provisions')).toBe(before); expect(world.rng.state).toBe(rng);
  });

  it('does not claim an unreachable frontier or keep a removed leader in a journey', () => {
    const { world, village, person } = settlement(), p = person.components.position!;
    governmentOf(village).leaderId = person.id; village.territory!.expandAt = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) world.terrain.set(p.x + dx, p.y + dy, Terrain.Water);
    const count = village.territory!.zones.length;
    world.tick = 30; territories(world);
    expect(village.territory!.expansion).toBeUndefined();
    expect(village.territory!.reason).toBe('No route to the frontier');
    expect(village.territory!.zones).toHaveLength(count);
    village.territory!.expansion = { actorId: person.id, zone: 3, started: world.tick };
    world.remove(person.id);
    expect(village.territory!.expansion).toBeUndefined();
  });

  it('rejects duplicate land and stale frontier actors in saved worlds', () => {
    const { world, village } = settlement();
    const other = assignHouse(world, world.spawn('core:house', { x: 36, y: 24 })!);
    const saved = world.snapshot();
    saved.society.villages.find(v => v.id === other.id)!.territory!.zones.push(village.territory!.zones[0]);
    expect(() => decodeSave(saved, world.registry)).toThrow();
    const stale = world.snapshot(); stale.society.villages[0].territory!.expansion = { actorId: 999999, zone: 3, started: 0 };
    expect(() => decodeSave(stale, world.registry)).toThrow();
  });

  it('clears live references when the final territory disappears', () => {
    const { world, person, village, home } = settlement();
    removeVillage(world, village);
    expect(world.society.villages).toHaveLength(0);
    expect(person.components.citizen!.villageId).toBeNull();
    expect(home.components.dwelling!.villageId).toBeNull();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('uses completed prerequisites and excludes wells/statues from Basic II', () => {
    const { world, village } = settlement();
    expect(developmentProblem(world, village, 'core:bakery')).toBe('Required buildings are not ready');
    const mill = world.spawn('core:mill', { x: 18, y: 28 })!;
    mill.components.workplace!.villageId = village.id; beginProject(mill, 'build');
    expect(developmentProblem(world, village, 'core:bakery')).toBeDefined();
    delete mill.components.building!.project; mill.components.building!.state = 'active';
    expect(developmentProblem(world, village, 'core:bakery')).toBeUndefined();
    expect(DEVELOPMENT_GRAPHS.basic1.well).toBeDefined(); expect(DEVELOPMENT_GRAPHS.basic1.statue).toBeDefined();
    expect(DEVELOPMENT_GRAPHS.basic2.well).toBeUndefined(); expect(DEVELOPMENT_GRAPHS.basic2.statue).toBeUndefined();
    expect(DEVELOPMENT_GRAPHS.basic2.temple.requires).not.toContain('statue');
    expect(DEVELOPMENT_GRAPHS.advanced.house3.requires).toContain('hall2');
  });
});
