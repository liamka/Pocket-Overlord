import { describe, expect, it } from 'vitest';
import { aboardFerry, ferryAvailable, ferryPosition, tilePoint } from '../src/core/ferries';
import { roadIsIntact } from '../src/core/roads';
import { FERRY_CAPACITY, MAX_FERRY_SPAN, SAVE_VERSION, STEP, Terrain, type Entity, type Vec2 } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { processEvents, water } from '../src/systems/effects';
import { ferries } from '../src/systems/ferries';
import { findPath, findRoadPath } from '../src/systems/navigation';
import { movement } from '../src/systems/people';
import { roads } from '../src/systems/society';
import { setFood, advance, villageWorld, workRoad } from './helpers';

function riverWorld(span: number, vertical = false, deep = false): World {
  const world = villageWorld(vertical ? [{ x: 24, y: 8 }, { x: 24, y: 38 }] : [{ x: 8, y: 24 }, { x: 38, y: 24 }]);
  world.society.roads = [];
  for (const relation of world.society.relations) { relation.roadAttempt = 0; relation.nextDecision = 1e9; }
  const start = Math.floor((48 - span) / 2);
  for (let n = start; n < start + span; n++) for (let other = 0; other < 48; other++) world.terrain.set(vertical ? other : n, vertical ? n : other, deep ? Terrain.DeepWater : Terrain.Water);
  for (const e of world.query('person')) { e.components.person!.sex = 'b'; e.components.person!.reproduceIn = 100000; }
  return world;
}

function buildCrossing(world: World): void {
  roads(world);
  expect(world.society.roads).toHaveLength(1);
  workRoad(world);
  expect(roadIsIntact(world, world.society.roads[0])).toBe(true);
}

function traveler(world: World, position: Vec2, destination: Vec2): Entity {
  const person = world.spawn('core:person', position)!;
  person.components.person!.age = 24;
  const c = person.components.citizen!;
  c.task = 'visit'; c.path = findPath(world, position, destination, 0.1)!;
  expect(c.path).toBeDefined();
  return person;
}

function travelStep(world: World): void {
  world.tick++; ferries(world, STEP); movement(world, STEP); caravans(world, STEP); water(world, STEP); processEvents(world);
}

describe('resident bridge repairs', () => {
  it.each([false, true])('rebuilds a destroyed span from a bank, including its saved deck orientation (%s)', vertical => {
    const world = riverWorld(3, vertical); buildCrossing(world);
    const road = world.society.roads[0], decks = road.bridges!;
    expect(decks).toHaveLength(3);
    for (const e of [...world.query('person')]) world.remove(e.id);
    for (const deck of decks) { const p = tilePoint(world, deck.tile); world.terrain.set(p.x, p.y, Terrain.Scorched); }
    const first = road.tiles.indexOf(decks[0].tile), bank = tilePoint(world, road.tiles[first - 1]);
    const worker = world.spawn('core:person', bank)!;
    worker.components.person!.age = 24; worker.components.person!.sex = 'b';
    worker.components.person!.homeId = [...world.query('dwelling')][0].id;
    worker.components.citizen!.villageId = road.a;
    advance(world, 1);
    expect(decks.every(d => world.terrain.tiles[d.tile] === Terrain.Water)).toBe(true);
    expect(worker.components.citizen!.repair).not.toBeNull();
    const saved = decodeSave(world.snapshot(), world.registry), restored = new World(world.seed, world.registry, saved);
    for (let n = 0; n < 24 * 30; n++) {
      world.step(); restored.step();
      const p = worker.components.position!;
      expect(world.terrain.isLand(p.x, p.y)).toBe(true);
    }
    expect(decks.every(d => world.terrain.tiles[d.tile] === d.terrain)).toBe(true);
    expect(roadIsIntact(world, road)).toBe(true);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
  });

  it('recovers intended decks from old saves without repairing remotely or filling deep water', () => {
    const world = riverWorld(3); buildCrossing(world);
    const road = world.society.roads[0], decks = structuredClone(road.bridges!);
    for (const e of [...world.query('person')]) world.remove(e.id);
    for (const deck of decks) { const p = tilePoint(world, deck.tile); world.terrain.set(p.x, p.y, Terrain.Crater); }
    const old = world.snapshot(); old.version = 20; delete old.society.roads[0].bridges; delete old.society.roads[0].ferries;
    const saved = decodeSave(old, world.registry);
    expect(saved.version).toBe(SAVE_VERSION); expect(saved.society.roads[0].bridges).toEqual(decks);
    expect(old.society.roads[0].bridges).toBeUndefined();
    const restored = new World(world.seed, world.registry, saved);
    advance(restored, 10);
    expect(decks.every(d => restored.terrain.tiles[d.tile] === Terrain.Water)).toBe(true);
    const p = tilePoint(restored, decks[0].tile); restored.terrain.set(p.x, p.y, Terrain.DeepWater);
    const worker = restored.spawn('core:person', tilePoint(restored, road.tiles[road.tiles.indexOf(decks[0].tile) - 1]))!;
    worker.components.person!.age = 24; worker.components.citizen!.villageId = road.a;
    advance(restored, 8); expect(restored.terrain.at(p.x, p.y)).toBe(Terrain.DeepWater);
  });
});

describe('river ferries', () => {
  it.each([[4, false, false], [8, true, true], [MAX_FERRY_SPAN, false, true]] as const)('creates land approaches and a ferry across %s water tiles (%s, %s)', (span, vertical, deep) => {
    const world = riverWorld(span, vertical, deep), [a, b] = world.society.villages;
    expect(findPath(world, a, b)).toBeUndefined();
    buildCrossing(world);
    const road = world.society.roads[0], ferry = road.ferries![0];
    expect(road.ferries).toHaveLength(1); expect(road.bridges).toEqual([]);
    expect(ferry.end - ferry.start - 1).toBe(span);
    expect(road.tiles.slice(ferry.start + 1, ferry.end).every(tile => world.terrain.tiles[tile] === (deep ? Terrain.DeepWater : Terrain.Water))).toBe(true);
    expect(ferryAvailable(world, road, ferry)).toBe(true);
    const path = findPath(world, a, b)!;
    expect(path.every(p => world.terrain.isLand(p.x, p.y))).toBe(true);
    expect(path.some((p, i) => i > 0 && Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) === span + 1)).toBe(true);
    expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
  });

  it('keeps short shallow crossings as bridges and rejects ocean-sized gaps', () => {
    const narrow = riverWorld(3); buildCrossing(narrow);
    expect(narrow.society.roads[0].ferries).toEqual([]);
    const ocean = riverWorld(MAX_FERRY_SPAN + 1, false, true);
    expect(findRoadPath(ocean, ocean.society.villages[0], ocean.society.villages[1], 2.2, true)).toBeUndefined();
  });

  it('collects a traveler from the opposite bank and carries them without swimming or losing health', () => {
    const world = riverWorld(8, false, true); buildCrossing(world);
    for (const e of [...world.query('person')]) world.remove(e.id);
    const road = world.society.roads[0], ferry = road.ferries![0];
    const from = tilePoint(world, road.tiles[ferry.end]), to = tilePoint(world, road.tiles[ferry.start]);
    const person = traveler(world, from, { x: to.x - 3, y: to.y }), initialHealth = person.components.health!.current;
    let boarded = false, waterFrames = 0;
    for (let i = 0; i < 20 * 30; i++) {
      travelStep(world);
      if (aboardFerry(world, person.id)) boarded = true;
      const p = person.components.position!;
      if (!world.terrain.isLand(p.x, p.y)) { waterFrames++; expect(aboardFerry(world, person.id)).toBe(true); }
    }
    expect(boarded).toBe(true); expect(waterFrames).toBeGreaterThan(90);
    expect(person.components.position!.x).toBeLessThan(to.x);
    expect(person.components.health!.current).toBe(initialHealth);
    expect(person.components.citizen!.path).toEqual([]);
  });

  it('delivers and returns a real caravan while keeping the river water', () => {
    const world = riverWorld(6); buildCrossing(world);
    const [a, b] = world.society.villages; setFood(a, 100); setFood(b, 10);
    expect(dispatchCaravan(world, a.id, b.id, 12)).toBe(true);
    const wagon = [...world.query('caravan')][0]; let boarded = false;
    for (let n = 0; n < 65 * 30 && world.entities.has(wagon.id); n++) {
      world.tick++; ferries(world, STEP); caravans(world, STEP);
      if (aboardFerry(world, wagon.id)) boarded = true;
    }
    expect(boarded).toBe(true); expect(world.entities.has(wagon.id)).toBe(false);
    expect(b.food).toBe(22); expect(a.food).toBe(88);
    const road = world.society.roads[0], ferry = road.ferries![0];
    expect(road.tiles.slice(ferry.start + 1, ferry.end).every(i => world.terrain.tiles[i] === Terrain.Water)).toBe(true);
  });

  it('preserves a paused trip and resumes deterministically after loading', () => {
    const world = riverWorld(6); buildCrossing(world);
    for (const e of [...world.query('person')]) world.remove(e.id);
    const road = world.society.roads[0], ferry = road.ferries![0];
    const person = traveler(world, tilePoint(world, road.tiles[ferry.start]), tilePoint(world, road.tiles[ferry.end + 2]));
    for (let n = 0; n < 90; n++) travelStep(world);
    expect(aboardFerry(world, person.id)).toBe(true); expect(ferry.progress).toBeGreaterThan(0);
    world.paused = true;
    const saved = world.snapshot(), restored = new World(world.seed, world.registry, decodeSave(saved, world.registry));
    advance(restored, 5); expect(restored.snapshot()).toEqual(saved);
    world.paused = restored.paused = false;
    for (let n = 0; n < 300; n++) { travelStep(world); travelStep(restored); }
    expect(restored.snapshot()).toEqual(world.snapshot());
    for (const patch of [{ end: ferry.start + 2 }, { progress: 2 }, { target: 2 }, { passengers: [person.id, person.id] }, { passengers: [999999] }]) {
      const invalid = structuredClone(saved); Object.assign(invalid.society.roads[0].ferries![0], patch);
      expect(() => decodeSave(invalid, world.registry)).toThrow();
    }
  });

  it('limits boarding capacity, removes dead passengers and disables a lost landing', () => {
    const world = riverWorld(6); buildCrossing(world);
    for (const e of [...world.query('person')]) world.remove(e.id);
    const road = world.society.roads[0], ferry = road.ferries![0], from = tilePoint(world, road.tiles[ferry.start]), to = tilePoint(world, road.tiles[ferry.end]);
    for (let n = 0; n < FERRY_CAPACITY + 2; n++) {
      const e = traveler(world, from, to); e.components.citizen!.path = [to];
    }
    ferries(world, STEP); expect(ferry.passengers).toHaveLength(FERRY_CAPACITY);
    const id = ferry.passengers[0]; world.remove(id); expect(ferry.passengers).not.toContain(id);
    for (let n = 0; n < 90; n++) travelStep(world);
    const p = ferryPosition(world, road, ferry); expect(world.terrain.isLand(p.x, p.y)).toBe(false);
    world.terrain.set(to.x, to.y, Terrain.Water); ferries(world, STEP);
    expect(ferry.passengers).toEqual([]); expect(roadIsIntact(world, road)).toBe(false);
    expect(findPath(world, from, { x: to.x + 2, y: to.y })).toBeUndefined();
    expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
  });
});
