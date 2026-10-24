import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { declareWar } from '../src/systems/diplomacy';
import { applyEvent, processEvents } from '../src/systems/effects';
import { villages } from '../src/systems/society';
import { advance, villageWorld } from './helpers';

function tradingWorld(): World {
  const source = villageWorld(), snapshot = source.snapshot();
  snapshot.terrain.tiles.fill(Terrain.Sand);
  const tiles = Array.from({ length: 29 }, (_, i) => 26 * 48 + i + 8);
  for (const i of tiles) snapshot.terrain.tiles[i] = Terrain.Road;
  snapshot.society.roads = [{ a: 1, b: 2, tiles, built: tiles.length }];
  snapshot.society.villages[0].food = 60; snapshot.society.villages[1].food = 0;
  // Isolate transport accounting from meals, harvests and diplomacy decisions.
  return new World(snapshot.seed, source.registry, snapshot, [{ id: 'core:caravans', update: caravans }]);
}

describe('caravans', () => {
  it('automatically dispatches on a finished road and delivers only after travelling', () => {
    const world = tradingWorld(), population = world.population;
    world.tick = 449; world.step();
    expect([...world.query('caravan')]).toHaveLength(0);
    expect(world.society.villages.map(v => v.food)).toEqual([60, 0]);
    world.tick = 899; world.step();
    const wagon = [...world.query('caravan')][0], start = { ...wagon.components.position! };
    expect(wagon.components.caravan!.food).toBe(12);
    expect(world.society.villages.map(v => v.food)).toEqual([48, 0]);
    advance(world, 1);
    expect(wagon.components.position!.x).toBeGreaterThan(start.x);
    expect(world.terrain.at(wagon.components.position!.x, wagon.components.position!.y)).toBe(Terrain.Road);
    expect(world.society.villages[1].food).toBe(0);
    advance(world, 12);
    expect(wagon.components.caravan!.returning).toBe(true); expect(wagon.components.caravan!.food).toBe(0);
    expect(world.society.villages.map(v => v.food)).toEqual([48, 12]);
    advance(world, 13);
    expect([...world.query('caravan')]).toHaveLength(0); expect(world.population).toBe(population);
    expect(world.society.villages.map(v => v.food)).toEqual([48, 12]);
  });
  it('keeps reserves and refuses duplicate shipments, unfinished roads and war routes', () => {
    const world = tradingWorld(), road = world.society.roads[0];
    road.built--; expect(dispatchCaravan(world, 1, 2)).toBe(false); road.built++;
    world.society.villages[0].food = 8; expect(dispatchCaravan(world, 1, 2)).toBe(false);
    world.society.villages[0].food = 13; expect(dispatchCaravan(world, 1, 2)).toBe(true);
    expect(world.society.villages[0].food).toBe(8); expect([...world.query('caravan')][0].components.caravan!.food).toBe(5);
    world.society.villages[0].food = 60; expect(dispatchCaravan(world, 1, 2)).toBe(false);
    world.remove([...world.query('caravan')][0].id); declareWar(world, 1, 2);
    expect(dispatchCaravan(world, 1, 2)).toBe(false);
  });
  it('turns back when war begins and returns the reserved cargo without feeding the enemy', () => {
    const world = tradingWorld(); dispatchCaravan(world, 1, 2); advance(world, 3);
    const wagon = [...world.query('caravan')][0], x = wagon.components.position!.x;
    declareWar(world, 1, 2); const foodAfterRations = world.society.villages[0].food;
    advance(world, 1); expect(wagon.components.caravan!.returning).toBe(true); expect(wagon.components.position!.x).toBeLessThan(x);
    advance(world, 3);
    expect([...world.query('caravan')]).toHaveLength(0);
    expect(world.society.villages[0].food).toBe(foodAfterRations + 12); expect(world.society.villages[1].food).toBe(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('loses cargo when destroyed by the same explosion rules as other objects', () => {
    const world = tradingWorld(); dispatchCaravan(world, 1, 2); advance(world, 3);
    const wagon = [...world.query('caravan')][0];
    applyEvent(world, { kind: 'blast', ...wagon.components.position!, radius: 1, power: 500, heat: 100 }); processEvents(world);
    expect(world.entities.has(wagon.id)).toBe(false); expect([...world.query('caravan')]).toHaveLength(0);
    expect(world.society.villages.map(v => v.food)).toEqual([48, 0]);
  });
  it('waits at a water barrier and continues when the crossing is restored', () => {
    const world = tradingWorld(); dispatchCaravan(world, 1, 2);
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    advance(world, 14);
    const wagon = [...world.query('caravan')][0];
    expect(wagon.components.position!.x).toBeLessThan(24); expect(world.society.villages[1].food).toBe(0);
    expect(wagon.components.caravan!.food).toBe(12);
    world.terrain.set(24, 26, Terrain.Road); advance(world, 6);
    expect(world.society.villages[1].food).toBe(12); expect(wagon.components.caravan!.returning).toBe(true);
  });
  it.each(['before', 'after'])('goes around an obstacle built %s departure and returns by the travelled path', when => {
    const world = tradingWorld();
    if (when === 'before') world.spawn('core:house', { x: 24.5, y: 26.5 });
    expect(dispatchCaravan(world, 1, 2)).toBe(true); advance(world, 2);
    const wagon = [...world.query('caravan')][0];
    if (when === 'after') world.spawn('core:house', { x: 24.5, y: 26.5 });
    advance(world, 15); expect(world.society.villages[1].food).toBe(12);
    advance(world, 16); expect(world.entities.has(wagon.id)).toBe(false);
    expect(world.society.villages.reduce((sum, v) => sum + v.food, 0) + [...world.query('caravan')].reduce((sum, e) => sum + e.components.caravan!.food, 0)).toBe(60);
  });
  it('returns cargo when the destination disappears and removes abandoned origin routes', () => {
    const world = tradingWorld(); dispatchCaravan(world, 1, 2); advance(world, 3);
    for (const e of [...world.entities.values()]) if (e.components.citizen?.villageId === 2 || e.components.dwelling?.villageId === 2) world.remove(e.id);
    villages(world); world.step();
    const wagon = [...world.query('caravan')][0];
    expect(wagon.components.caravan!.toId).toBeNull(); expect(wagon.components.caravan!.returning).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    advance(world, 4); expect(world.society.villages[0].food).toBe(60); expect([...world.query('caravan')]).toHaveLength(0);
    const other = tradingWorld(); dispatchCaravan(other, 1, 2);
    for (const e of [...other.entities.values()]) if (e.components.citizen?.villageId === 1 || e.components.dwelling?.villageId === 1) other.remove(e.id);
    villages(other); other.step(); expect([...other.query('caravan')]).toHaveLength(0);
    expect(() => decodeSave(other.snapshot(), other.registry)).not.toThrow();
  });
  it.each(['before', 'after'])('avoids narrow edges near an off-centre tree planted %s departure', when => {
    const world = tradingWorld();
    // Both adjacent tile centres are clear, but their connecting segment clips this tree.
    if (when === 'before') world.spawn('core:tree', { x: 24.13665, y: 27.16095 });
    expect(dispatchCaravan(world, 1, 2)).toBe(true);
    if (when === 'after') world.spawn('core:tree', { x: 24.13665, y: 27.16095 });
    const wagon = [...world.query('caravan')][0];
    advance(world, 20);
    expect(world.society.villages[1].food).toBe(12); expect(wagon.components.caravan!.returning).toBe(true);
    expect(wagon.components.caravan!.path.length).toBeLessThan(40);
    advance(world, 10); expect(world.entities.has(wagon.id)).toBe(false);
  });
  it('restores cargo, route and progress without advancing during pause or duplicating food', () => {
    const world = tradingWorld(); dispatchCaravan(world, 1, 2); advance(world, 4.2); world.paused = true;
    const saved = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(saved.seed, world.registry, saved, world.systems);
    advance(restored, 30); expect(restored.snapshot()).toEqual(saved);
    world.paused = restored.paused = false; advance(world, 10); advance(restored, 10);
    expect(restored.snapshot()).toEqual(world.snapshot()); expect(restored.society.villages.map(v => v.food)).toEqual([48, 12]);
    const returning = decodeSave(restored.snapshot(), restored.registry);
    const last = new World(returning.seed, restored.registry, returning, restored.systems);
    advance(restored, 12); advance(last, 12); expect(last.snapshot()).toEqual(restored.snapshot());
  });
  it('migrates v6 worlds and rejects corrupt routes, cargo and settlement references', () => {
    const world = tradingWorld(), old = { ...world.snapshot(), version: 6 };
    expect(decodeSave(old, world.registry)).toEqual({ ...old, version: SAVE_VERSION }); expect(old.version).toBe(6);
    dispatchCaravan(world, 1, 2);
    for (const patch of [{ fromId: 999 }, { toId: 999 }, { food: -1 }, { food: 13 }, { next: 999 }, { path: [{ x: 48, y: 5 }] }]) {
      const invalid = world.snapshot(); Object.assign(invalid.entities.find(e => e.components.caravan)!.components.caravan!, patch);
      expect(() => decodeSave(invalid, world.registry)).toThrow();
    }
  });
});
