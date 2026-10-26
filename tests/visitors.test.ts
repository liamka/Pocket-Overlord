import { describe, expect, it } from 'vitest';
import { STEP, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { VISITORS, VISITORS_ID, type VisitorSchedule } from '../src/core/visitors';
import { bundleSize } from '../src/core/resources';
import { deposit, stockOf, withdraw } from '../src/core/resource-ledger';
import { attachStorage, initializeStorage } from '../src/core/stockpiles';
import { canSail } from '../src/core/seafaring';
import { inspectUnit } from '../src/core/units';
import { assignHouse } from '../src/systems/society';
import { visitors } from '../src/systems/visitors';
import { seafaring } from '../src/systems/seafaring';
import { flatWorld } from './helpers';

function island() {
  const world = flatWorld();
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) world.terrain.set(x, y,
    x >= 14 && x <= 33 && y >= 14 && y <= 33 ? Terrain.Grass : Terrain.Water);
  const town = assignHouse(world, world.spawn('core:house', { x: 24.5, y: 24.5 })!);
  const port = world.spawn('core:harbor', { x: 14.5, y: 21.5 })!;
  Object.assign(port.components.harbor!, { villageId: town.id, direction: 2, built: 1, launchIn: 60 });
  initializeStorage(world, town); attachStorage(town, port);
  deposit(town, { wood: 80, stone: 40 });
  return { world, town, port };
}
function tick(world: World, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) { world.tick++; visitors(world, STEP); }
}
function tradeNow(world: World): void {
  world.startScenario(VISITORS_ID);
  (world.scenarios.find(s => s.id === VISITORS_ID)!.state as VisitorSchedule).tradeAt = world.tick;
  tick(world, 1);
}
function dragon(world: World) { return world.spawn('core:dragon', { x: 24.5, y: 20.5 })!; }

describe('overseas visitors', () => {
  it('automatically schedules arrivals in existing worlds with working ports', () => {
    const { world } = island();
    expect(world.scenarios).toHaveLength(0);
    tick(world, 1);
    expect(world.scenarios.find(s => s.id === VISITORS_ID)).toBeDefined();
    expect([...world.query('foreignVoyage')]).toHaveLength(0);
    tick(world, VISITORS.firstTrade / 30);
    expect([...world.query('foreignVoyage')]).toHaveLength(1);
    const visitor = [...world.query('foreignVoyage')][0];
    expect(visitor.components.foreignVoyage!.kind).toBe('merchants');
    expect(canSail(world, visitor.components.position!)).toBe(true);
  });

  it('sails to a port, barters finite cargo for real surplus and sails back out', () => {
    const { world, town } = island(), before = stockOf(town, 'wood');
    tradeNow(world);
    const boat = [...world.query('foreignVoyage')][0], voyage = boat.components.foreignVoyage!;
    const cargo = { ...voyage.goods };
    for (let i = 0; i < 120 && !voyage.traded; i++) tick(world, 1);
    expect(voyage.traded).toBe(true);
    expect(bundleSize(voyage.goods)).toBe(0);
    for (const [good, amount] of Object.entries(cargo)) expect(town.economy!.stocks[good as keyof typeof cargo]).toBe(amount);
    expect(before - stockOf(town, 'wood')).toBe(20);
    expect(voyage.purchases).toEqual({ wood: 20 });
    expect(stockOf(town, 'wood')).toBeGreaterThanOrEqual(20);
    const savedStocks = { ...town.economy!.stocks };
    tick(world, 90);
    expect(world.entities.has(boat.id)).toBe(false);
    expect(town.economy!.stocks).toEqual(savedStocks);
    expect(world.society.history.some(e => e.text === 'Overseas merchants sailed away')).toBe(true);
  });

  it('does not take reserves or payment when the harbor storage is full', () => {
    const { world, town, port } = island();
    const store = town.economy!.storage!.find(s => s.buildingId === port.id)!;
    store.capacity = 0;
    tradeNow(world); const boat = [...world.query('foreignVoyage')][0], goods = { ...boat.components.foreignVoyage!.goods };
    tick(world, 80);
    expect(boat.components.foreignVoyage!.goods).toEqual(goods);
    expect(boat.components.foreignVoyage!.purchases).toEqual({});
    expect(stockOf(town, 'wood')).toBe(80);
    const second = island();
    withdraw(second.town, { wood: 60, stone: 24 }, 'transfer');
    tradeNow(second.world); tick(second.world, 80);
    expect(second.world.society.history.some(e => e.text === 'Overseas merchants found no surplus to trade')).toBe(true);
  });

  it('turns back without trading if a port is destroyed or captured', () => {
    for (const capture of [false, true]) {
      const { world, town, port } = island(); tradeNow(world);
      const boat = [...world.query('foreignVoyage')][0];
      if (capture) port.components.harbor!.villageId = 999; else world.remove(port.id);
      tick(world, 60);
      expect(world.entities.has(boat.id)).toBe(false);
      expect(stockOf(town, 'wood')).toBe(80);
      expect(boat.components.foreignVoyage!.purchases).toEqual({});
    }
  });

  it('never creates overseas ships in an enclosed lake', () => {
    const { world } = island();
    for (let n = 0; n < 48; n++) {
      world.terrain.set(n, 0, Terrain.Grass); world.terrain.set(n, 47, Terrain.Grass);
      world.terrain.set(0, n, Terrain.Grass); world.terrain.set(47, n, Terrain.Grass);
    }
    tradeNow(world); tick(world, 30);
    expect([...world.query('foreignVoyage')]).toHaveLength(0);
  });

  it('lands hunters, deals actual damage, takes one trophy and leaves with survivors', () => {
    const { world } = island(), target = dragon(world), population = world.population;
    tick(world, 1);
    const boat = [...world.query('foreignVoyage')][0];
    expect(boat.components.foreignVoyage!.kind).toBe('hunters');
    for (let i = 0; i < 90 && world.entities.has(target.id); i++) tick(world, 1);
    expect(world.entities.has(target.id)).toBe(false);
    expect(world.population).toBe(population);
    tick(world, 80);
    expect([...world.query('monsterHunter')]).toHaveLength(0);
    expect(world.entities.has(boat.id)).toBe(false);
    expect(boat.components.foreignVoyage!.purchases).toEqual({ dragonScale: 1 });
    expect(world.society.history.filter(e => e.text === 'Monster hunters defeated their quarry and collected a trophy')).toHaveLength(1);
  });

  it('does not award a trophy when a monster disappears and does not replace dead hunters', () => {
    const { world } = island(), target = dragon(world);
    tick(world, 1); const boat = [...world.query('foreignVoyage')][0];
    for (let i = 0; i < 60 && ![...world.query('monsterHunter')].length; i++) tick(world, 1);
    const party = [...world.query('monsterHunter')]; expect(party).toHaveLength(3);
    world.remove(party[0].id); world.remove(target.id);
    tick(world, 90);
    expect([...world.query('monsterHunter')]).toHaveLength(0);
    expect(boat.components.foreignVoyage!.purchases).toEqual({});
    expect(world.society.history.filter(e => e.text === 'Monster hunters landed and started tracking their quarry')).toHaveLength(1);
  });

  it('preserves ongoing voyages and hunts across saves, pauses and deterministic continuation', () => {
    const { world } = island(); tradeNow(world); dragon(world); tick(world, 7);
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    world.paused = loaded.paused = true;
    const before = world.snapshot(); visitors(world, STEP); world.step();
    expect(world.snapshot()).toEqual(before);
    world.paused = loaded.paused = false;
    tick(world, 50); tick(loaded, 50);
    expect(loaded.snapshot()).toEqual(world.snapshot());
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('keeps foreign ships out of the domestic fishing and delivery state machine', () => {
    const { world } = island(); tradeNow(world);
    const boat = [...world.query('foreignVoyage')][0], before = structuredClone(boat.components);
    for (let i = 0; i < 120; i++) { world.tick++; seafaring(world, STEP); }
    expect(boat.components).toEqual(before);
  });

  it('runs in the ordinary world with a moving dragon and exposes visitor identities', () => {
    const { world } = island(); dragon(world);
    let arrived = false, inspected = false, boatId: number | undefined;
    for (let i = 0; i < 60 * 30; i++) {
      world.step();
      const boat = [...world.query('foreignVoyage')].find(e => e.components.foreignVoyage!.kind === 'hunters');
      if (boat) boatId = boat.id;
      for (const hunter of world.query('monsterHunter')) {
        arrived = true; inspected ||= inspectUnit(world, hunter.id)?.occupation === 'Monster hunter';
      }
    }
    expect(arrived).toBe(true); expect(inspected).toBe(true); expect(boatId).toBeDefined();
    expect(world.entities.has(boatId!)).toBe(false);
    expect([...world.query('monsterHunter')]).toHaveLength(0);
  });
});
