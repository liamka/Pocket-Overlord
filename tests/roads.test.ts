import { describe, expect, it } from 'vitest';
import { roadIsIntact } from '../src/core/roads';
import { isBridge, isRoadSurface, MAX_BRIDGE_SPAN, ROAD_OVERGROWTH_SECONDS, ROAD_REPAIR_SECONDS, SAVE_VERSION, STEP, Terrain, type Vec2 } from '../src/core/types';
import { roadWearStage } from '../src/core/terrain';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { findPath, findRoadPath } from '../src/systems/navigation';
import { roads } from '../src/systems/society';
import { landscape } from '../src/systems/landscape';
import { movement } from '../src/systems/people';
import { assignRepair, continueRepair, roadRepairs } from '../src/systems/road-repair';
import { applyEvent, processEvents } from '../src/systems/effects';
import { setFood, advance, flatWorld, villageWorld, workRoad } from './helpers';

function expectContinuous(world: World, path: Vec2[]): void {
  expect(path.length).toBeGreaterThan(0);
  expect(new Set(path.map(p => world.terrain.index(p.x, p.y))).size).toBe(path.length);
  for (const [i, p] of path.entries()) {
    expect(world.terrain.isLand(p.x, p.y)).toBe(true);
    if (i) expect(Math.abs(p.x - path[i - 1].x) + Math.abs(p.y - path[i - 1].y)).toBe(1);
  }
}

describe('road shape', () => {
  it('rejects disconnected islands before exploring routes, but respects reach and newly opened crossings', () => {
    const world = flatWorld(), start = { x: 8.5, y: 20.5 }, end = { x: 38.5, y: 20.5 };
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    let visits = 0;
    expect(findPath(world, start, end, 0, () => { visits++; return true; })).toBeUndefined();
    expect(visits).toBe(0);
    expect(findPath(world, { x: 23.5, y: 20.5 }, { x: 25.5, y: 20.5 }, 2.1)).toEqual([]);
    world.terrain.set(24, 20, Terrain.Grass);
    expect(findPath(world, start, end, 0)).toHaveLength(30);
  });
  it('reuses searches without stale paths after terrain and obstacle changes', () => {
    const world = flatWorld(), start = { x: 8.5, y: 8.5 }, end = { x: 18.5, y: 8.5 };
    expect(findPath(world, start, end, 0)).toHaveLength(10);
    for (let y = 0; y < 48; y++) world.terrain.set(12, y, Terrain.Water);
    expect(findPath(world, start, end, 0)).toBeUndefined();
    world.terrain.set(12, 10, Terrain.Grass);
    const route = findPath(world, start, end, 0)!;
    expect(route).toHaveLength(14);
    expect(route).toContainEqual({ x: 12.5, y: 10.5 });
    const tree = world.spawn('core:tree', { x: 12.5, y: 10.5 })!;
    let visits = 0;
    expect(findPath(world, start, end, 0, () => { visits++; return true; })).toBeUndefined();
    expect(visits).toBe(0);
    world.remove(tree.id); world.tick++;
    expect(findPath(world, start, end, 0)).toEqual(route);
    expect(findPath(world, end, start, 0)).toHaveLength(14);
    expect(findPath(world, start, end, 0, (_a, b) => b.y < 10)).toBeUndefined();
    expect(findPath(world, start, end, 0)).toEqual(route);
  });
  it.each([[38.5, 38.5], [8.5, 38.5], [38.5, 8.5], [8.5, 8.5]])('connects diagonal settlements without long square elbows toward %s, %s', (x, y) => {
    const world = flatWorld(), start = { x: 47 - x, y: 47 - y }, destination = { x, y };
    const path = findRoadPath(world, start, destination)!;
    expectContinuous(world, path);
    expect(Math.hypot(path.at(-1)!.x - x, path.at(-1)!.y - y)).toBeLessThanOrEqual(2.2);
    let run = 0, longest = 0, direction = '';
    for (let i = 1; i < path.length; i++) {
      const next = `${path[i].x - path[i - 1].x},${path[i].y - path[i - 1].y}`;
      run = next === direction ? run + 1 : 1; direction = next; longest = Math.max(longest, run);
    }
    expect(longest).toBeLessThanOrEqual(4);
  });

  it('gently bends aligned roads and reproduces their shape without consuming simulation randomness', () => {
    const world = flatWorld(), start = { x: 5.5, y: 24.5 }, destination = { x: 42.5, y: 24.5 }, state = world.rng.state;
    const path = findRoadPath(world, start, destination)!;
    expectContinuous(world, path);
    const ys = path.map(p => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(3);
    expect(path.length).toBeLessThan(45);
    expect(findRoadPath(world, start, destination)).toEqual(path);
    expect(world.rng.state).toBe(state);
  });

  it('keeps shaped routes clear of water and solid objects, including a one-tile passage', () => {
    const world = flatWorld(), start = { x: 5.5, y: 24.5 }, destination = { x: 42.5, y: 24.5 };
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.DeepWater);
    expect(findRoadPath(world, start, destination)).toBeUndefined();
    world.terrain.set(24, 10, Terrain.Grass);
    world.spawn('core:house', { x: 16.5, y: 15.5 });
    world.spawn('core:tree', { x: 31.5, y: 16.5 });
    const path = findRoadPath(world, start, destination)!;
    expectContinuous(world, path);
    expect(path).toContainEqual({ x: 24.5, y: 10.5 });
    for (const p of path) expect(world.canStand(p, 0.25)).toBe(true);
  });

  it('builds and reloads the shaped road with the existing save format', () => {
    const world = villageWorld([{ x: 8, y: 8 }, { x: 38, y: 38 }]);
    workRoad(world);
    const road = world.society.roads[0];
    expect(roadIsIntact(world, road)).toBe(true);
    const path = road.tiles.map(i => ({ x: i % 48 + 0.5, y: Math.floor(i / 48) + 0.5 }));
    expectContinuous(world, path);
    expect(path.some(p => p.x > 16 && p.x < 30 && p.y > 16 && p.y < 30)).toBe(true);
    const saved = world.snapshot(), restored = new World(saved.seed, world.registry, decodeSave(saved, world.registry));
    expect(restored.snapshot()).toEqual(saved);
    advance(world, 2); advance(restored, 2);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('takes a valley around a mountain ridge without altering the landscape', () => {
    const world = flatWorld();
    for (let y = 15; y <= 32; y++) for (let x = 20; x <= 27; x++) world.terrain.set(x, y, Terrain.Mountain);
    const terrain = world.terrain.snapshot(), path = findRoadPath(world, { x: 5.5, y: 24.5 }, { x: 42.5, y: 24.5 })!;
    expectContinuous(world, path);
    expect(path.every(p => world.terrain.at(p.x, p.y) !== Terrain.Mountain)).toBe(true);
    const crossing = path.filter(p => p.x >= 20 && p.x < 28);
    expect(crossing.every(p => p.y < 14 || p.y >= 34)).toBe(true);
    expect(world.terrain.snapshot()).toEqual(terrain);
  });

  it('uses a narrow mountain pass and leaves disconnected settlements without a road', () => {
    const world = flatWorld(), start = { x: 5.5, y: 24.5 }, destination = { x: 42.5, y: 24.5 };
    for (let y = 0; y < 48; y++) for (let x = 23; x <= 25; x++) world.terrain.set(x, y, Terrain.Mountain);
    expect(findRoadPath(world, start, destination)).toBeUndefined();
    for (let x = 23; x <= 25; x++) world.terrain.set(x, 12, Terrain.Grass);
    const path = findRoadPath(world, start, destination)!;
    expectContinuous(world, path);
    expect(path).toContainEqual({ x: 24.5, y: 12.5 });
    expect(path.every(p => world.terrain.at(p.x, p.y) !== Terrain.Mountain)).toBe(true);
  });

  it('prefers a clearing to a clear but densely wooded corridor', () => {
    const world = flatWorld();
    for (const y of [19.5, 21.5, 23.5, 25.5, 27.5, 29.5]) for (let x = 17.5; x <= 29.5; x += 3) world.spawn('core:tree', { x, y });
    const trees = [...world.query('solid')].map(e => e.id), state = world.rng.state;
    const path = findRoadPath(world, { x: 5.5, y: 24.5 }, { x: 42.5, y: 24.5 })!;
    expectContinuous(world, path);
    expect(path.filter(p => p.x >= 20 && p.x <= 27).every(p => p.y < 18 || p.y > 31)).toBe(true);
    expect(path.every(p => world.canStand(p, 0.25))).toBe(true);
    expect([...world.query('solid')].map(e => e.id)).toEqual(trees);
    expect(world.rng.state).toBe(state);
  });

  it('follows a shore with room to turn while keeping a one-tile land bridge usable', () => {
    const world = flatWorld();
    for (let y = 0; y < 21; y++) for (let x = 17; x < 30; x++) world.terrain.set(x, y, Terrain.Water);
    const path = findRoadPath(world, { x: 5.5, y: 20.5 }, { x: 42.5, y: 20.5 })!;
    expectContinuous(world, path);
    const shoreline = path.filter(p => p.x >= 17 && p.x < 30);
    expect(shoreline.every(p => p.y >= 23 && p.y < 28)).toBe(true);
    for (let x = 0; x < 48; x++) world.terrain.set(x, 22, Terrain.DeepWater);
    world.terrain.set(10, 22, Terrain.Grass);
    const bridge = findRoadPath(world, { x: 10.5, y: 18.5 }, { x: 10.5, y: 28.5 })!;
    expectContinuous(world, bridge);
    expect(bridge).toContainEqual({ x: 10.5, y: 22.5 });
  });

  it.each(['joining', 'leaving'])('rounds the approach when %s an existing road instead of making a square elbow', direction => {
    const world = flatWorld();
    for (let x = 4; x < 45; x++) world.terrain.set(x, 12, Terrain.Road);
    const start = { x: 8.5, y: 38.5 }, end = { x: 42.5, y: 12.5 };
    const path = direction === 'joining' ? findRoadPath(world, start, end, 0)! : findRoadPath(world, end, start, 0)!.reverse();
    expectContinuous(world, path);
    const join = path.findIndex(p => world.terrain.at(p.x, p.y) === Terrain.Road);
    expect(join).toBeGreaterThan(6);
    expect(join).toBeLessThan(path.length - 6);
    const before = path[join - 6], at = path[join], after = path[join + 6];
    const approach = { x: at.x - before.x, y: at.y - before.y }, onward = { x: after.x - at.x, y: after.y - at.y };
    const alignment = (approach.x * onward.x + approach.y * onward.y) / (Math.hypot(approach.x, approach.y) * Math.hypot(onward.x, onward.y));
    expect(alignment).toBeGreaterThan(0.5);
    expect(path.slice(join).every(p => world.terrain.at(p.x, p.y) === Terrain.Road)).toBe(true);
  });
});

function riverWorld(span = 2, vertical = false): World {
  const world = villageWorld(vertical ? [{ x: 24, y: 8 }, { x: 24, y: 36 }] : undefined);
  world.society.roads = [];
  for (const relation of world.society.relations) { relation.roadAttempt = 0; relation.nextDecision = 1e9; }
  for (let n = 0; n < span; n++) for (let i = 0; i < 48; i++) world.terrain.set(vertical ? i : 23 + n, vertical ? 23 + n : i, Terrain.Water);
  return world;
}

function finishRoad(world: World): void {
  workRoad(world);
  expect(roadIsIntact(world, world.society.roads[0])).toBe(true);
}

function ageRoads(world: World, seconds: number): void {
  for (let i = 0; i < seconds; i++) { world.tick += 30; landscape(world); }
}

describe('river bridges', () => {
  it.each([[1, false], [MAX_BRIDGE_SPAN, false], [2, true]] as const)('builds a complete %s-tile crossing, vertical=%s, before walkers can cross', (span, vertical) => {
    const world = riverWorld(span, vertical), [a, b] = world.society.villages;
    expect(findPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    roads(world);
    const road = world.society.roads[0], river = road.tiles.filter(i => world.terrain.tiles[i] === Terrain.Water);
    expect(river).toHaveLength(span);
    expect(world.terrain.tiles.some(isBridge)).toBe(false);
    workRoad(world, () => {
      const built = river.filter(i => isBridge(world.terrain.tiles[i])).length;
      if (built < span) expect(findPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    });
    expect(roadIsIntact(world, road)).toBe(true);
    expect(river.every(i => world.terrain.tiles[i] === (vertical ? Terrain.BridgeVertical : Terrain.BridgeHorizontal))).toBe(true);
    expect(world.terrain.tiles.filter(t => t === Terrain.Water)).toHaveLength(span * 48 - span);
    expectContinuous(world, findPath(world, world.findFreePosition(a)!, b)!);
    const snapshot = world.snapshot();
    expect(new World(snapshot.seed, world.registry, decodeSave(snapshot, world.registry)).snapshot()).toEqual(snapshot);
  });

  it('refuses wide water, deep water, blocked banks and diagonal-only landings', () => {
    const world = riverWorld(MAX_BRIDGE_SPAN + 1), [a, b] = world.society.villages;
    expect(findRoadPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    for (let y = 0; y < 48; y++) {
      for (let x = 24; x <= 23 + MAX_BRIDGE_SPAN; x++) world.terrain.set(x, y, Terrain.Grass);
      world.terrain.set(23, y, Terrain.DeepWater);
    }
    expect(findRoadPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    world.terrain.set(23, 24, Terrain.Water); world.terrain.set(24, 24, Terrain.Mountain);
    expect(findRoadPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    world.terrain.set(24, 24, Terrain.Grass);
    const house = world.spawn('core:house', { x: 24.5, y: 24.5 })!;
    expect(findRoadPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    world.remove(house.id);
    expect(findRoadPath(world, world.findFreePosition(a)!, b)).toBeDefined();
  });

  it('lets residents and food caravans cross without swimming and keeps the approaches in use', () => {
    const source = riverWorld(); finishRoad(source);
    const snapshot = source.snapshot(), world = new World(source.seed, source.registry, snapshot, [{ id: 'core:caravans', update: caravans }]);
    const road = world.society.roads[0], bridge = road.tiles.find(i => isBridge(world.terrain.tiles[i]))!, y = Math.floor(bridge / 48) + 0.5;
    const walker = world.spawn('core:person', { x: 21.5, y })!;
    walker.components.citizen!.task = 'visit'; walker.components.citizen!.path = [{ x: 26.5, y }];
    for (let i = 0; i < 120; i++) movement(world, STEP);
    expect(walker.components.position!.x).toBeGreaterThan(25);
    expect(world.terrain.isLand(walker.components.position!.x, walker.components.position!.y)).toBe(true);
    world.remove(walker.id);
    for (const state of world.terrain.roadWear.values()) state.age = 240;
    setFood(world.society.villages[0], 60); setFood(world.society.villages[1], 0);
    expect(dispatchCaravan(world, 1, 2)).toBe(true);
    advance(world, road.tiles.length / 2.2 + 3);
    expect(world.society.villages[1].food).toBe(12);
    expect([...world.terrain.roadWear.values()].some(s => s.age === 0)).toBe(true);
  });

  it('exposes water after a bridge is destroyed instead of leaving walkable craters', () => {
    const world = riverWorld(); finishRoad(world);
    const tile = world.society.roads[0].tiles.find(i => isBridge(world.terrain.tiles[i]))!, x = tile % 48, y = Math.floor(tile / 48);
    applyEvent(world, { kind: 'blast', x: x + 0.5, y: y + 0.5, radius: 2, power: 100, heat: 100 }); processEvents(world);
    expect(world.terrain.at(x, y)).toBe(Terrain.Water);
    expect(world.terrain.recovery.has(tile)).toBe(false);
    expect(roadIsIntact(world, world.society.roads[0])).toBe(false);
    const [a, b] = world.society.villages;
    expect(findPath(world, world.findFreePosition(a)!, b)).toBeUndefined();
    ageRoads(world, 60);
    expect(world.terrain.at(x, y)).toBe(Terrain.Water);
  });
});

describe('abandoned roads', () => {
  it('grows weeds in stages and returns unused roads to their original ground, even after their village disappears', () => {
    const world = flatWorld();
    world.terrain.set(12, 24, Terrain.Road);
    world.terrain.set(13, 24, Terrain.Sand); world.terrain.set(13, 24, Terrain.Road);
    const grass = world.terrain.index(12, 24), sand = world.terrain.index(13, 24);
    ageRoads(world, 120);
    expect(roadWearStage(world.terrain.roadWear.get(grass)!.age)).toBe(1);
    expect(world.terrain.at(12, 24)).toBe(Terrain.Road);
    ageRoads(world, 240);
    expect(roadWearStage(world.terrain.roadWear.get(grass)!.age)).toBe(3);
    ageRoads(world, 120);
    expect(world.terrain.at(12, 24)).toBe(Terrain.Grass);
    expect(world.terrain.at(13, 24)).toBe(Terrain.Sand);
    expect(world.terrain.roadWear.get(sand)!.age).toBe(ROAD_OVERGROWTH_SECONDS);
  });

  it('real footsteps clear weeds locally and repeated use keeps a road alive', () => {
    const world = flatWorld();
    for (let x = 10; x <= 30; x++) world.terrain.set(x, 24, Terrain.Road);
    ageRoads(world, 360);
    const person = world.spawn('core:person', { x: 12.5, y: 24.5 })!;
    person.components.citizen!.task = 'visit'; person.components.citizen!.path = [{ x: 18.5, y: 24.5 }];
    movement(world, STEP);
    const used = world.terrain.index(12, 24), unused = world.terrain.index(29, 24);
    expect(world.terrain.roadWear.get(used)!.age).toBe(0);
    expect(world.terrain.roadWear.get(unused)!.age).toBe(360);
    for (let i = 0; i < 12; i++) { ageRoads(world, 60); world.terrain.useRoad(12.5, 24.5); }
    expect(world.terrain.at(12, 24)).toBe(Terrain.Road);
    expect(world.terrain.at(29, 24)).toBe(Terrain.Grass);
  });

  it('does not let construction or repair workers immediately resurrect abandoned tracks', () => {
    const world = villageWorld(); finishRoad(world);
    ageRoads(world, ROAD_OVERGROWTH_SECONDS);
    const road = world.society.roads[0];
    expect(road.tiles.every(i => !isRoadSurface(world.terrain.tiles[i]))).toBe(true);
    expect(roadRepairs(world, [...world.query('person', 'citizen')]).jobs.size).toBe(0);
    roads(world);
    expect(road.tiles.every(i => !isRoadSurface(world.terrain.tiles[i]))).toBe(true);
  });

  it('preserves wear and abandonment across pause, reload and old-save migration', () => {
    const world = flatWorld(); world.terrain.set(20, 20, Terrain.Road); ageRoads(world, 350); world.paused = true;
    const saved = world.snapshot(), restored = new World(saved.seed, world.registry, decodeSave(saved, world.registry));
    advance(restored, 10); expect(restored.snapshot()).toEqual(saved);
    world.paused = restored.paused = false;
    ageRoads(world, 130); ageRoads(restored, 130);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(decodeSave(restored.snapshot(), world.registry)).toEqual(restored.snapshot());
    const old = { ...saved, version: 17, terrain: { ...saved.terrain, roadWear: undefined } };
    const migrated = decodeSave(old, world.registry);
    expect(migrated.version).toBe(SAVE_VERSION); expect(migrated.terrain.roadWear).toEqual([]);
    expect(migrated.terrain.tiles).toEqual(old.terrain.tiles);
    expect(old.terrain.roadWear).toBeUndefined();
    for (const patch of [{ index: -1 }, { age: -1 }, { age: ROAD_OVERGROWTH_SECONDS + 1 }, { target: Terrain.Water }, { age: ROAD_OVERGROWTH_SECONDS }]) {
      const invalid = structuredClone(saved); Object.assign(invalid.terrain.roadWear![0], patch);
      expect(() => decodeSave(invalid, world.registry)).toThrow();
    }
  });
});

function repairWorld(): World {
  const world = villageWorld();
  for (let i = 0; i < world.terrain.tiles.length; i++) world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Sand);
  for (const road of world.society.roads) {
    road.built = road.tiles.length;
    for (const i of road.tiles) world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Road);
  }
  for (const r of world.society.relations) r.nextDecision = 1e9;
  for (const v of world.society.villages) setFood(v, 500);
  for (const e of world.query('person')) e.components.person!.sex = 'b';
  return world;
}

function breakMiddle(world: World): number {
  const road = world.society.roads[0], tile = road.tiles[Math.floor(road.tiles.length / 2)];
  world.terrain.set(tile % 48, Math.floor(tile / 48), Terrain.Crater);
  return tile;
}

function startWork(world: World): void {
  for (let i = 0; i < 90; i++) {
    advance(world, 0.5);
    if ([...world.query('citizen')].some(e => (e.components.citizen!.repair?.remaining ?? ROAD_REPAIR_SECONDS) < ROAD_REPAIR_SECONDS)) return;
  }
  throw new Error('No resident reached the damaged road');
}

describe('road destruction and repair', () => {
  it.each([['core:dynamite', 2, 2, 3], ['core:rocket', 1.25, 4, 5]] as const)('%s destroys both the centre and the outer road surface after its fuse', (toolId, fuse, edge, outside) => {
    const world = flatWorld();
    for (let x = 2; x < 46; x++) world.terrain.set(x, 24, Terrain.Road);
    world.terrain.set(24, 23, Terrain.Water);
    world.command({ kind: 'speed', speed: 0 });
    world.command({ kind: 'use-tool', toolId, x: 24.5, y: 24.5 });
    advance(world, 5); expect(world.terrain.at(24, 24)).toBe(Terrain.Road);
    world.command({ kind: 'speed', speed: 1 }); advance(world, fuse - 0.1);
    expect(world.terrain.at(24, 24)).toBe(Terrain.Road);
    advance(world, 0.1);
    expect(world.terrain.at(24, 24)).toBe(Terrain.Crater);
    expect(world.terrain.at(24 + edge, 24)).toBe(Terrain.Scorched);
    expect(world.terrain.at(24 + outside, 24)).toBe(Terrain.Road);
    expect(world.terrain.at(24, 23)).toBe(Terrain.Water);
    expect(world.terrain.recovery.get(world.terrain.index(24, 24))!.target).toBe(Terrain.Grass);
  });

  it('requires an adult to walk to the damage and work there before restoring a road', () => {
    const world = repairWorld(), road = world.society.roads[0], tile = breakMiddle(world);
    expect(roadIsIntact(world, road)).toBe(false);
    expect(dispatchCaravan(world, 1, 2)).toBe(false);
    advance(world, 2);
    const workers = [...world.query('citizen')].filter(e => e.components.citizen!.repair?.tile === tile);
    expect(workers).toHaveLength(1);
    expect(workers[0].components.citizen!.repair!.remaining).toBe(ROAD_REPAIR_SECONDS);
    expect(workers[0].components.citizen!.path.length).toBeGreaterThan(0);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Crater);
    startWork(world);
    const worker = [...world.query('citizen')].find(e => e.components.citizen!.repair?.tile === tile)!;
    const p = worker.components.position!;
    expect(Math.hypot(p.x - (tile % 48 + 0.5), p.y - (Math.floor(tile / 48) + 0.5))).toBeLessThanOrEqual(1.3);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Crater);
    advance(world, 3);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Road);
    expect(world.terrain.recovery.has(tile)).toBe(false);
    expect(roadIsIntact(world, road)).toBe(true);
    expect(dispatchCaravan(world, 1, 2)).toBe(true);
    expect([...world.query('citizen')].some(e => e.components.citizen!.repair?.tile === tile)).toBe(false);
  });

  it('natural regrowth and rain never rebuild an abandoned road', () => {
    const world = repairWorld(), tile = breakMiddle(world);
    for (const e of [...world.query('person')]) world.remove(e.id);
    world.addRain({ x: tile % 48, y: Math.floor(tile / 48) }, 4, 3);
    advance(world, 400);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Sand);
    expect(roadIsIntact(world, world.society.roads[0])).toBe(false);
  });

  it('does not repair remotely, fill water or send children to work', () => {
    const world = repairWorld(), tile = breakMiddle(world), x = tile % 48, y = Math.floor(tile / 48);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.terrain.set(x + dx, y + dy, Terrain.Water);
    advance(world, 20);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Crater);
    expect([...world.query('citizen')].filter(e => e.components.citizen!.repair)).toHaveLength(0);
    expect(world.terrain.at(x + 1, y)).toBe(Terrain.Water);
    const children = repairWorld(), damaged = breakMiddle(children);
    for (const e of children.query('person')) e.components.person!.age = 0;
    advance(children, 20);
    expect(children.terrain.tiles[damaged]).toBe(Terrain.Crater);
    expect([...children.query('citizen')].filter(e => e.components.citizen!.repair)).toHaveLength(0);
  });

  it('loses a dead worker’s job and lets a replacement repair the same tile', () => {
    const world = repairWorld(), tile = breakMiddle(world);
    const only = [...world.query('person')][0];
    for (const e of [...world.query('person')]) if (e !== only) world.remove(e.id);
    startWork(world); world.remove(only.id); advance(world, 10);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Crater);
    const person = world.spawn('core:person', { x: tile % 48 + 0.5, y: Math.floor(tile / 48) + 1.5 })!;
    person.components.citizen!.villageId = world.society.villages[0].id;
    person.components.person!.homeId = [...world.query('dwelling')][0].id;
    advance(world, 6);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Road);
  });

  it('moves within working distance when navigation already considers the current tile reached', () => {
    const world = repairWorld(), tile = breakMiddle(world), worker = [...world.query('person')][0];
    const p = worker.components.position!, c = worker.components.citizen!;
    p.x = tile % 48 + 0.5; p.y = Math.floor(tile / 48) + 1.98;
    const repairs = roadRepairs(world, [worker]);
    expect(assignRepair(world, worker, repairs)).toBe(true);
    expect(c.path).toEqual([{ x: p.x, y: Math.floor(p.y) + 0.5 }]);
    for (let n = 0; n < 30; n++) movement(world, STEP);
    for (let n = 0; n < ROAD_REPAIR_SECONDS * 2; n++) continueRepair(world, worker, repairs);
    expect(world.terrain.tiles[tile]).toBe(Terrain.Road);
    expect(c.repair).toBeNull();
  });

  it('preserves a paused repair, resumes deterministically and detects a second strike', () => {
    const world = repairWorld(), tile = breakMiddle(world); startWork(world); world.paused = true;
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(snapshot.seed, world.registry, snapshot);
    advance(restored, 10); expect(restored.snapshot()).toEqual(snapshot);
    world.paused = restored.paused = false; advance(world, 6); advance(restored, 6);
    expect(restored.snapshot()).toEqual(world.snapshot()); expect(restored.terrain.tiles[tile]).toBe(Terrain.Road);
    restored.terrain.set(tile % 48, Math.floor(tile / 48), Terrain.Scorched);
    expect(roadIsIntact(restored, restored.society.roads[0])).toBe(false);
    startWork(restored); advance(restored, 3); expect(restored.terrain.tiles[tile]).toBe(Terrain.Road);
  });

  it('migrates old residents and rejects invalid repair targets or progress', () => {
    const world = repairWorld(), legacy = JSON.parse(JSON.stringify(world.snapshot())); legacy.version = 7;
    for (const e of legacy.entities) if (e.components.citizen) delete e.components.citizen.repair;
    const migrated = decodeSave(legacy, world.registry);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.entities.filter(e => e.components.citizen).every(e => e.components.citizen!.repair === null)).toBe(true);
    expect(legacy.entities.find((e: { components: { citizen?: object } }) => e.components.citizen).components.citizen.repair).toBeUndefined();
    breakMiddle(world); startWork(world);
    for (const patch of [{ tile: -1 }, { tile: 48 * 48 }, { remaining: 0 }, { remaining: 4 }]) {
      const invalid = world.snapshot(), c = invalid.entities.find(e => e.components.citizen?.repair)!.components.citizen!;
      Object.assign(c.repair!, patch); expect(() => decodeSave(invalid, world.registry)).toThrow();
    }
    const invalid = world.snapshot(); invalid.entities.find(e => e.components.citizen?.repair)!.components.citizen!.task = 'idle';
    expect(() => decodeSave(invalid, world.registry)).toThrow();
  });
});
