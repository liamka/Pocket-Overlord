import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { economyOf } from '../src/core/village-life';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { assignHouse } from '../src/systems/society';
import { assignEquipment, assignVillageWork, continueEquipping, continueVillageWork } from '../src/systems/economy';
import { assignConstruction, construction } from '../src/systems/construction';
import { declareWar } from '../src/systems/diplomacy';
import { intentions } from '../src/systems/people';
import { processEvents } from '../src/systems/effects';
import { advance, diplomaticWorld, flatWorld } from './helpers';

function settlement() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  village.food = 120; village.migrationAfter = 100000;
  const people = [18, 20, 26, 28].map(x => world.spawn('core:person', { x, y: 21 })!);
  for (const e of people) {
    Object.assign(e.components.person!, { homeId: home.id, sex: 'b', reproduceIn: 100000, buildIn: 100000 });
    e.components.citizen!.villageId = village.id;
  }
  const market = world.spawn('core:market', { x: 16, y: 28 })!;
  market.components.workplace!.villageId = village.id;
  return { world, village, people, worker: people[0], home, market, stocks: economyOf(village).stocks };
}

function arrive(world: World, entity: Entity, x: number, y: number): void {
  Object.assign(entity.components.position!, { x, y }); world.spatial.update(entity);
  entity.components.citizen!.path = [];
}

describe('stone economy', () => {
  it('generates finite, nonflammable deposits deterministically and lets the player place them on clear land', () => {
    const a = new World(12345), b = new World(12345);
    const deposits = [...a.query('stone')];
    expect(deposits.length).toBeGreaterThan(20);
    expect(deposits).toEqual([...b.query('stone')]);
    expect(deposits.map(e => e.components.position)).not.toEqual([...new World(12346).query('stone')].map(e => e.components.position));
    expect(new Set(deposits.map(e => e.components.position!.x)).size).toBeGreaterThan(deposits.length * 0.9);
    expect(new Set(deposits.map(e => e.components.position!.y)).size).toBeGreaterThan(deposits.length * 0.9);
    expect(deposits.every(e => a.safeLand(e.components.position!, 0.7) && a.canStand(e.components.position!, 0.7, e.id))).toBe(true);
    expect(deposits.every(e => e.components.stone!.remaining === 24 && !e.components.combustible)).toBe(true);
    const world = flatWorld(); world.paused = true;
    world.command({ kind: 'use-tool', toolId: 'core:stone', x: 20, y: 20 });
    expect([...world.query('stone')]).toHaveLength(1);
    world.command({ kind: 'use-tool', toolId: 'core:stone', x: 20, y: 20 });
    world.terrain.set(30, 30, Terrain.Water);
    world.command({ kind: 'use-tool', toolId: 'core:stone', x: 30, y: 30 });
    expect([...world.query('stone')]).toHaveLength(1);
  });

  it('mines only after arrival, depletes deposits and stocks stone only after delivery', () => {
    const { world, worker, stocks, village } = settlement();
    const deposit = world.spawn('core:stone', { x: 30, y: 28 })!; deposit.components.stone!.remaining = 4;
    expect(assignVillageWork(world, worker)).toBe(true);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(deposit.components.stone!.remaining).toBe(4);
    arrive(world, worker, 28.3, 28);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(world.entities.has(deposit.id)).toBe(false); expect(stocks.stone).toBe(0);
    expect(worker.components.citizen!.work!.cargo).toEqual({ good: 'stone', amount: 4, villageId: village.id });
    worker.components.citizen!.hunger = 80; continueVillageWork(world, worker);
    expect(worker.components.citizen!.work!.cargo!.amount).toBe(4);
    worker.components.citizen!.hunger = 10; expect(assignVillageWork(world, worker)).toBe(true);
    arrive(world, worker, 17.8, 28); continueVillageWork(world, worker);
    expect(stocks.stone).toBe(4); expect(worker.components.citizen!.work).toBeUndefined();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('does not mine across water or recreate depleted deposits on reload', () => {
    const { world, worker } = settlement();
    const deposit = world.spawn('core:stone', { x: 32, y: 28 })!;
    for (let y = 0; y < 48; y++) world.terrain.set(23, y, Terrain.Water);
    expect(assignVillageWork(world, worker)).toBe(false);
    world.remove(deposit.id);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    expect([...restored.query('stone')]).toHaveLength(0);
  });

  it('charges for an upgrade once, preserves its work on reload and increases capacity and health only on completion', () => {
    const { world, worker, home, stocks, people } = settlement();
    stocks.wood = 2; stocks.stone = 7;
    expect(assignConstruction(world, worker)).toBe(false);
    stocks.stone = 8; expect(assignConstruction(world, worker)).toBe(true);
    expect(stocks.wood).toBe(0); expect(stocks.stone).toBe(0);
    expect(home.components.dwelling!.capacity).toBe(5); expect(home.components.health!.max).toBe(180);
    expect(assignConstruction(world, people[1])).toBe(true);
    expect(stocks.stone).toBe(0);
    arrive(world, worker, 22.3, 24);
    worker.components.person!.animation = { stride: 0, moving: 0, heading: 0, work: 0 };
    for (let i = 0; i < 100; i++) { world.tick++; construction(world, STEP); }
    expect(home.components.dwelling!.construction!.progress).toBeGreaterThan(0);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    for (let i = 0; i < 400; i++) {
      world.tick++; restored.tick++; construction(world, STEP); construction(restored, STEP);
    }
    expect(home.components.dwelling!.level).toBe(2);
    expect(home.components.dwelling!.capacity).toBe(7); expect(home.components.health!.max).toBe(300);
    expect(home.components.dwelling!.construction).toBeUndefined();
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(assignConstruction(world, worker)).toBe(false);
  });

  it('crafts axes using both materials, delivers them, and equips adults only at the market', () => {
    const { world, worker, stocks, village, home, people } = settlement();
    home.components.dwelling!.level = 2;
    const workshop = world.spawn('core:workshop', { x: 32, y: 28 })!; workshop.components.workplace!.villageId = village.id;
    stocks.tools = 8; stocks.wood = 1; stocks.stone = 1;
    expect(assignVillageWork(world, worker)).toBe(false);
    stocks.stone = 2; expect(assignVillageWork(world, worker)).toBe(true);
    arrive(world, worker, 30.3, 28);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(stocks.stone).toBe(0); expect(stocks.wood).toBe(0); expect(stocks.stoneAxes).toBe(0);
    arrive(world, worker, 17.8, 28); continueVillageWork(world, worker);
    expect(stocks.stoneAxes).toBe(1);
    people[1].components.person!.age = 8; expect(assignEquipment(world, people[1])).toBe(false);
    const soldier = people[2]; expect(assignEquipment(world, soldier)).toBe(true);
    continueEquipping(world, soldier); expect(stocks.stoneAxes).toBe(1); expect(soldier.components.citizen!.weapon).toBeUndefined();
    expect(assignEquipment(world, people[3])).toBe(false);
    arrive(world, soldier, 17.8, 28); continueEquipping(world, soldier);
    expect(stocks.stoneAxes).toBe(0); expect(soldier.components.citizen!.weapon).toBe('stone-axe');
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('applies the stone weapon bonus to actual combat damage', () => {
    const world = diplomaticWorld(2);
    const fighters = [...world.query('person', 'citizen')];
    const attacker = fighters.find(e => e.components.citizen!.villageId === 1 && e.id % 3 !== 0)!, target = fighters.find(e => e.components.citizen!.villageId === 2)!;
    declareWar(world, 1, 2); arrive(world, attacker, 20, 20); arrive(world, target, 21, 20);
    Object.assign(attacker.components.citizen!, { task: 'fight', targetId: target.id, attackIn: 0, weapon: 'stone-axe', hunger: 10 });
    const health = target.components.health!.current;
    world.tick = 15; intentions(world); processEvents(world);
    expect(health - target.components.health!.current).toBe(16);
  });

  it('migrates existing stockpiles without inventing stone and rejects corrupt resource data', () => {
    const { world, stocks, worker } = settlement(); stocks.wood = 9;
    const old = world.snapshot(); old.version = 31;
    Reflect.deleteProperty(old.society.villages[0].economy!.stocks, 'stone');
    Reflect.deleteProperty(old.society.villages[0].economy!.stocks, 'stoneAxes');
    const migrated = decodeSave(old, world.registry);
    expect(migrated.society.villages[0].economy!.stocks).toMatchObject({ wood: 9, stone: 0, stoneAxes: 0 });
    expect(old.version).toBe(31); expect(old.society.villages[0].economy!.stocks).not.toHaveProperty('stone');
    stocks.stone = -1; expect(() => decodeSave(world.snapshot(), world.registry)).toThrow(); stocks.stone = 0;
    Object.assign(worker.components.citizen!, { weapon: 'invalid' }); expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
    delete worker.components.citizen!.weapon;
    const deposit = world.spawn('core:stone', { x: 32, y: 28 })!; deposit.components.stone!.remaining = 0;
    expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
  });

  it('runs the entire chain autonomously from natural materials and continues deterministically after reload', () => {
    const { world, village, home } = settlement();
    for (const x of [12, 16, 20, 28, 32, 36]) world.spawn('core:tree', { x, y: 34 });
    for (const x of [12, 20, 28, 36]) world.spawn('core:stone', { x, y: 38 });
    advance(world, 150);
    expect(home.components.dwelling!.level).toBe(2);
    expect([...world.query('person', 'citizen')].some(e => e.components.citizen!.weapon === 'stone-axe')).toBe(true);
    expect([...world.query('stone')].reduce((total, e) => total + e.components.stone!.remaining, 0)).toBeLessThan(96);
    expect(village.economy!.deliveries).toBeGreaterThan(0);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    advance(world, 3); advance(restored, 3); expect(restored.snapshot()).toEqual(world.snapshot());
    restored.paused = true; const before = restored.snapshot(); advance(restored, 1); expect(restored.snapshot()).toEqual(before);
  });
});
