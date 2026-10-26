import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain, ROAD_OVERGROWTH_SECONDS, STEP, type Entity, type Road } from '../src/core/types';
import { assignHouse, roads } from '../src/systems/society';
import { assignRepair, continueRepair, roadRepairs } from '../src/systems/road-repair';
import { roadIsIntact, roadProblem } from '../src/core/roads';
import { decodeSave } from '../src/persistence/schema';
import { RACES, RACE_IDS } from '../src/core/races';
import { initializeStorage } from '../src/core/stockpiles';
import { buildingOwner } from '../src/core/buildings';
import { aboardFerry, ferryPosition } from '../src/core/ferries';
import { approachFerry } from '../src/systems/ferries';
import { caravans } from '../src/systems/caravans';
import { findPath } from '../src/systems/navigation';

function construction() {
  const world = flatWorld();
  const a = assignHouse(world, world.spawn('core:house', { x: 8.5, y: 24.5 })!);
  const b = assignHouse(world, world.spawn('core:house', { x: 38.5, y: 24.5 })!);
  initializeStorage(world, a); initializeStorage(world, b);
  const worker = world.spawn('core:person', { x: 10.5, y: 25.5 })!;
  worker.components.citizen!.villageId = a.id;
  const road: Road = { a: a.id, b: b.id, tiles: [10, 11, 12].map(x => world.terrain.index(x, 24)), built: 0 };
  world.society.roads = [road];
  return { world, worker, road, a, b };
}
function workBeside(world: World, worker: Entity): void {
  for (let i = 0; i < 8 && worker.components.citizen!.repair; i++) {
    world.tick += 15; continueRepair(world, worker, roadRepairs(world, [...world.query('citizen')]));
  }
}

describe('road lifecycle', () => {
  it('requires one available worker per segment; pause and a competing settlement cannot duplicate labour', () => {
    const { world, worker, road, b } = construction();
    for (let i = 0; i < 10; i++) { world.tick += 30; roads(world); }
    expect(road.built).toBe(0);
    const other = world.spawn('core:person', { x: 10.5, y: 23.5 })!;
    other.components.citizen!.villageId = b.id;
    const before = structuredClone(world.society.villages.map(v => v.economy?.stocks));
    const queue = roadRepairs(world, [worker, other]);
    expect(assignRepair(world, worker, queue)).toBe(true);
    expect(assignRepair(world, other, roadRepairs(world, [worker, other]))).toBe(false);
    world.paused = true;
    const snapshot = world.snapshot();
    continueRepair(world, worker, queue); roads(world); world.step();
    expect(world.snapshot()).toEqual(snapshot);
    expect(new World(world.seed, world.registry, decodeSave(snapshot, world.registry)).snapshot()).toEqual(snapshot);
    world.paused = false; workBeside(world, worker);
    expect(road.built).toBe(1);
    expect(world.terrain.tiles[road.tiles[0]]).toBe(Terrain.Road);
    expect(world.society.villages.map(v => v.economy?.stocks)).toEqual(before);
  });

  it('cancels a lost worker and refuses new terrain, fire and foreign territory', () => {
    const { world, worker, road } = construction();
    expect(assignRepair(world, worker, roadRepairs(world, [worker]))).toBe(true);
    world.remove(worker.id);
    const replacement = world.spawn('core:person', { x: 10.5, y: 25.5 })!;
    replacement.components.citizen!.villageId = road.a;
    expect(assignRepair(world, replacement, roadRepairs(world, [replacement]))).toBe(true);
    world.terrain.set(10, 24, Terrain.Mountain);
    continueRepair(world, replacement, roadRepairs(world, [replacement]));
    expect(replacement.components.citizen!.repair).toBeNull();
    expect(road.built).toBe(0);
    world.terrain.set(10, 24, Terrain.Grass);
    const fire = world.spawn('core:tree', { x: 10.5, y: 24.5 })!; fire.components.thermal!.burning = true;
    expect(roadProblem(world, road)).toBe('Road work is unsafe');
    world.remove(fire.id);
    const foreign = assignHouse(world, world.spawn('core:house', { x: 24.5, y: 8.5 })!);
    for (const village of world.society.villages) village.territory!.zones = village.territory!.zones.filter(z => z !== 19);
    foreign.territory!.zones.push(19);
    expect(roadProblem(world, road)).toBe('Road crosses another territory');
    expect(assignRepair(world, replacement, roadRepairs(world, [replacement]))).toBe(false);
  });

  it('restores sand after damage and abandonment while retaining newer cover', () => {
    const world = flatWorld(), map = world.terrain, tile = map.index(12, 24);
    map.set(12, 24, Terrain.Sand); map.set(12, 24, Terrain.Road); map.set(12, 24, Terrain.Crater);
    expect(map.recovery.get(tile)!.target).toBe(Terrain.Sand);
    map.set(12, 24, Terrain.Road); map.setLayers(12, 24, { top: 'flower-light', frost: 'snow' });
    map.roadWear.get(tile)!.age = ROAD_OVERGROWTH_SECONDS - 1;
    map.ageRoad(tile);
    expect(map.at(12, 24)).toBe(Terrain.Sand);
    expect(map.layers.get(tile)).toMatchObject({ top: 'flower-light', frost: 'snow' });
    const saved = decodeSave(world.snapshot(), world.registry), restored = new World(world.seed, world.registry, saved);
    expect(restored.terrain.roadWear.get(tile)).toEqual(map.roadWear.get(tile));
    map.set(12, 24, Terrain.Mountain); map.ageRoad(tile);
    expect(map.at(12, 24)).toBe(Terrain.Mountain);
  });

  it('opens the original water and clears resident and migrant paths when a bridge breaks', () => {
    const world = flatWorld(), map = world.terrain;
    for (let y = 0; y < 48; y++) map.set(24, y, Terrain.Water);
    map.setLayers(24, 24, { waterDepth: 2 }); map.set(24, 24, Terrain.BridgeHorizontal);
    const resident = world.spawn('core:person', { x: 23.5, y: 24.5 })!;
    resident.components.citizen!.path = findPath(world, resident.components.position!, { x: 26.5, y: 24.5 }, 0)!;
    const migrant = world.spawn('core:person', { x: 22.5, y: 24.5 })!;
    migrant.components.citizen!.task = 'migrate'; migrant.components.citizen!.path = [...resident.components.citizen!.path];
    map.set(24, 24, Terrain.Crater);
    expect(map.at(24, 24)).toBe(Terrain.Water);
    expect(map.cell(24, 24).waterDepth).toBe(2);
    expect(resident.components.citizen!.path).toEqual([]);
    expect(migrant.components.citizen!.path).toEqual([]);
    expect(findPath(world, resident.components.position!, { x: 26.5, y: 24.5 }, 0)).toBeUndefined();
    world.remove(migrant.id); // This path-only fixture has no migration group to persist.
    const saved = decodeSave(world.snapshot(), world.registry);
    expect(new World(world.seed, world.registry, saved).terrain.cell(24, 24).waterDepth).toBe(2);
  });

  it('holds a caravan and its load at a missing crossing until a physical route exists', () => {
    const { world, road, a, b } = construction();
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    road.tiles = [23, 24, 25, 26].map(x => world.terrain.index(x, 24)); road.built = 4;
    road.bridges = [{ tile: road.tiles[1], terrain: Terrain.BridgeHorizontal }];
    for (const tile of road.tiles) world.terrain.set(tile % 48, 24, tile === road.tiles[1] ? Terrain.BridgeHorizontal : Terrain.Road);
    const wagon = world.spawn('core:caravan', { x: 23.5, y: 24.5 })!;
    Object.assign(wagon.components.caravan!, { fromId: a.id, toId: b.id, food: 12,
      path: [24, 25, 26].map(x => ({ x: x + 0.5, y: 24.5 })), next: 0 });
    const foodBefore = b.food;
    world.terrain.set(24, 24, Terrain.Crater);
    expect(wagon.components.caravan!.reroute).toBe(true);
    for (let n = 0; n < 180; n++) { world.tick++; caravans(world, STEP); }
    expect(wagon.components.position!.x).toBeLessThan(24);
    expect(wagon.components.caravan!.food).toBe(12);
    expect(b.food).toBe(foodBefore);
    expect(roadIsIntact(world, road)).toBe(false);
  });

  it.each(RACE_IDS)('%s keeps building local links, including the port', race => {
    const world = flatWorld(), home = world.spawn('core:house', { x: 8.5, y: 24.5 })!;
    home.components.dwelling!.race = race;
    const village = assignHouse(world, home);
    for (let y = 0; y < 48; y++) world.terrain.set(19, y, Terrain.Water);
    const port = world.spawn('core:harbor', { x: 17.5, y: 24.5 })!;
    port.components.harbor!.villageId = village.id;
    const worker = world.spawn(RACES[race].entityId, { x: 10.5, y: 24.5 })!;
    worker.components.citizen!.villageId = village.id;
    roads(world);
    const road = world.society.roads.find(r => r.buildings?.includes(port.id))!;
    expect(road.a).toBe(village.id); expect(road.b).toBe(village.id);
    expect(road.buildings!.every(id => buildingOwner(world.entities.get(id)!) === village.id)).toBe(true);
    expect(road.built).toBe(0);
    expect(assignRepair(world, worker, roadRepairs(world, [worker]))).toBe(true);
    expect(decodeSave(world.snapshot(), world.registry).society.roads).toEqual(world.society.roads);
    world.remove(port.id);
    continueRepair(world, worker, roadRepairs(world, [worker]));
    expect(worker.components.citizen!.repair).toBeNull();
    expect(roadProblem(world, road)).toBe('Road endpoint is gone');
  });

  it('preserves old ferry passengers and does not count waiting at the landing as road traffic', () => {
    const { world, worker, road } = construction();
    road.tiles = [10, 11, 12, 13, 14, 15].map(x => world.terrain.index(x, 24)); road.built = 6;
    for (let x = 10; x <= 15; x++) world.terrain.set(x, 24, x === 10 || x === 15 ? Terrain.Road : Terrain.Water);
    const ferry = { start: 0, end: 5, progress: 0, target: 0 as const, wait: 1, passengers: [] as number[] };
    road.ferries = [ferry];
    Object.assign(worker.components.position!, { x: 10.5, y: 24.5 });
    worker.components.citizen!.path = [{ x: 15.5, y: 24.5 }];
    world.terrain.roadWear.get(road.tiles[0])!.age = 200;
    approachFerry(world, worker, STEP);
    expect(world.terrain.roadWear.get(road.tiles[0])!.age).toBe(200);
    ferry.progress = 0.5; ferry.passengers = [worker.id]; Object.assign(worker.components.position!, ferryPosition(world, road, ferry));
    const saved = world.snapshot(); delete saved.society.roads[0].buildings; delete saved.society.villages[0].roadPlan;
    const restored = new World(world.seed, world.registry, decodeSave(saved, world.registry));
    expect(aboardFerry(restored, worker.id)).toBe(true);
    const position = { ...restored.entities.get(worker.id)!.components.position! };
    restored.terrain.set(12, 24, Terrain.BridgeHorizontal);
    expect(aboardFerry(restored, worker.id)).toBe(false);
    expect(restored.entities.get(worker.id)!.components.position).toEqual(position);
  });
});
