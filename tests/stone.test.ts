import { createItem } from '../src/core/equipment';
import { cargoContents, deposit, inTransit, stockOf, takeFood } from '../src/core/resource-ledger';
import { cleanDepositClaims, newDeposit, reserveDeposit, STONE_BIOMES } from '../src/core/deposits';
import { NaturalBiome } from '../src/core/natural-biomes';
import { extractSource } from '../src/core/resource-sources';
import { initializeStorage } from '../src/core/stockpiles';
import { requestCraft } from '../src/core/crafting';
import { EQUIPMENT } from '../src/core/equipment-catalog';
import { continueCraft, startCraft } from '../src/systems/crafting';
import { performAttack } from '../src/systems/equipment';
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

describe('stone batch ownership', () => {
  const prepare = (world: World, worker: Entity, source: Entity, good: 'stone' | 'bone' = 'stone') => {
    Object.assign(worker.components.citizen!, { task: 'work', targetId: source.id, path: [], work: { good, progress: 4, cargo: null } });
    arrive(world, worker, source.components.position!.x - 1.8, source.components.position!.y);
  };

  it('shares the final five units between two reservations, including a reload before extraction', () => {
    const { world, village, people } = settlement();
    const source = world.spawn('core:stone', { x: 30, y: 28 })!;
    source.components.stone!.remaining = 5;
    for (const worker of people.slice(0, 2)) { prepare(world, worker, source); expect(reserveDeposit(world, source, worker)).toBe(true); }
    expect(source.components.stone!.claims.map(c => c.amount)).toEqual([4, 1]);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    const loadedSource = restored.entities.get(source.id)!;
    for (const worker of people.slice(0, 2)) expect(extractSource(restored, restored.entities.get(worker.id)!, loadedSource)).toBe(true);
    expect(restored.entities.has(source.id)).toBe(false);
    expect(inTransit(restored, village.id).stone).toBe(5);
    expect(stockOf(restored.society.villages[0], 'stone')).toBe(0);
    expect(extractSource(restored, restored.entities.get(people[0].id)!, loadedSource)).toBe(false);
  });

  it('keeps a mixed lot together through hunger, delivery and repeated reloads', () => {
    const { world, worker, village, market } = settlement();
    const source = world.spawn('core:stone', { x: 30, y: 28 })!;
    // Exercise the shared adapter without registering the future bone source or its generator.
    source.components.stone = newDeposit(NaturalBiome.Corrupted, 'placed', 'boneDeposit');
    prepare(world, worker, source, 'bone');
    expect(extractSource(world, worker, source)).toBe(true);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ bone: 3, stone: 1 });
    Object.assign(worker.components.citizen!, { task: 'deliver', targetId: market.id, hunger: 80 });
    continueVillageWork(world, worker);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ bone: 3, stone: 1 });
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    const carrier = loaded.entities.get(worker.id)!; carrier.components.citizen!.hunger = 10;
    expect(assignVillageWork(loaded, carrier)).toBe(true);
    const target = loaded.entities.get(carrier.components.citizen!.targetId!)!;
    const p = carrier.components.citizen!.path.at(-1) ?? { x: target.components.position!.x - 1.8, y: target.components.position!.y };
    arrive(loaded, carrier, p.x, p.y); continueVillageWork(loaded, carrier);
    const again = new World(loaded.seed, loaded.registry, decodeSave(loaded.snapshot(), loaded.registry));
    const owner = again.society.villages.find(v => v.id === village.id)!;
    expect(stockOf(owner, 'bone')).toBe(3); expect(stockOf(owner, 'stone')).toBe(1);
    expect(inTransit(again, village.id)).toEqual({});
  });

  it('releases interrupted reservations and records a dead carrier’s load only once', () => {
    const { world, worker, village } = settlement();
    const source = world.spawn('core:stone', { x: 30, y: 28 })!;
    prepare(world, worker, source); expect(reserveDeposit(world, source, worker)).toBe(true);
    worker.components.citizen!.hunger = 80; cleanDepositClaims(world, source);
    expect(source.components.stone!.claims).toEqual([]); expect(source.components.stone!.remaining).toBe(24);
    worker.components.citizen!.hunger = 10; expect(extractSource(world, worker, source)).toBe(true);
    world.remove(worker.id); world.remove(worker.id);
    expect(village.economy!.lost!.stone).toBe(4); expect(source.components.stone!.remaining).toBe(20);
    expect(stockOf(village, 'stone')).toBe(0);
  });

  it('does not mine another batch when the stock target is already carried', () => {
    const { world, worker, people, village } = settlement();
    const source = world.spawn('core:stone', { x: 30, y: 28 })!;
    initializeStorage(world, village); deposit(village, { stone: 20 });
    people[1].components.citizen!.work = { good: 'stone', progress: 0, cargo: { good: 'stone', amount: 4, villageId: village.id } };
    expect(assignVillageWork(world, worker)).toBe(false);
    expect(worker.components.citizen!.targetId).not.toBe(source.id);
    expect(source.components.stone!.claims).toEqual([]);
  });

  it('migrates old deposits without refilling them and rejects overbooked batches', () => {
    const { world } = settlement();
    const source = world.spawn('core:stone', { x: 30, y: 28 })!; source.components.stone!.remaining = 7;
    const old = world.snapshot(); old.version = 38;
    const saved = old.entities.find(e => e.id === source.id)!;
    Reflect.deleteProperty(saved.components.stone!, 'profile'); Reflect.deleteProperty(saved.components.stone!, 'biome');
    Reflect.deleteProperty(saved.components.stone!, 'origin'); Reflect.deleteProperty(saved.components.stone!, 'claims');
    const migrated = decodeSave(old, world.registry);
    expect(migrated.entities.find(e => e.id === source.id)!.components.stone!.remaining).toBe(7);
    expect(migrated.entities.filter(e => e.components.stone)).toHaveLength(1);
    const invalid = world.snapshot();
    invalid.entities.find(e => e.id === source.id)!.components.stone!.claims = [
      { workerId: 2, villageId: 1, amount: 4, expires: 900 }, { workerId: 3, villageId: 1, amount: 4, expires: 900 },
    ];
    expect(() => decodeSave(invalid, world.registry)).toThrow();
  });

  it('uses stone as food only when the explicitly supplied diet allows it', () => {
    const { world, village } = settlement();
    village.food = 0; initializeStorage(world, village); deposit(village, { stone: 4 });
    expect(takeFood(village, 2)).toEqual({}); expect(stockOf(village, 'stone')).toBe(4);
    expect(takeFood(village, 2, 'consume', ['stone'])).toEqual({ stone: 2 });
    expect(stockOf(village, 'stone')).toBe(2); expect(village.food).toBe(0);
    expect(village.economy!.spent!.stone).toBe(2);
  });

  it.each(['sword', 'axe', 'hammer', 'spear'])('makes a stone %s through its paid workshop order', kind => {
    const { world, worker, village, home } = settlement();
    home.components.dwelling!.level = 2;
    initializeStorage(world, village); deposit(village, { wood: 20, stone: 20 });
    const workshop = world.spawn('core:workshop', { x: 32, y: 22 })!; workshop.components.workplace!.villageId = village.id;
    const order = requestCraft(world, worker, 'weapon', { preferredKinds: [kind] })!;
    expect(order.recipe).toBe(`stone-${kind}`);
    expect(startCraft(world, worker, order, workshop)).toBe(true);
    const point = worker.components.citizen!.path.at(-1)!; arrive(world, worker, point.x, point.y);
    for (let i = 0; i < 8; i++) continueCraft(world, worker);
    expect(order.paid).toBe(true);
    expect(world.equipment.items.filter(i => i.definition === `stone-${kind}`)).toHaveLength(1);
    expect(village.economy!.spent).toMatchObject(EQUIPMENT[order.recipe].recipe.inputs);
    continueCraft(world, worker);
    expect(world.equipment.items.filter(i => i.definition === `stone-${kind}`)).toHaveLength(1);
  });

  it('gives the spear reach and the hammer a slower stunning hit', () => {
    const hit = (kind: string, separation: number) => {
      const world = flatWorld(), fighter = world.spawn('core:person', { x: 20, y: 20 })!, victim = world.spawn('core:person', { x: 20 + separation, y: 20 })!;
      createItem(world, `stone-${kind}`, { kind: 'equipped', entityId: fighter.id });
      return { success: performAttack(world, fighter, victim), cooldown: fighter.components.citizen!.attackIn, stun: victim.components.combat?.statuses.stun };
    };
    expect(hit('axe', 2.4).success).toBe(false); expect(hit('spear', 2.4).success).toBe(true);
    const hammer = hit('hammer', 1.2), axe = hit('axe', 1.2), sword = hit('sword', 1.2);
    expect(hammer.stun).toBeGreaterThan(0); expect(hammer.cooldown).toBeGreaterThan(axe.cooldown);
    expect(sword.cooldown).toBeLessThan(axe.cooldown);
  });
});

describe('stone economy', () => {
  it('generates finite, nonflammable deposits deterministically and lets the player place them on clear land', () => {
    const a = new World(12345), b = new World(12345);
    const deposits = [...a.query('stone')].filter(e => e.typeId === 'core:stone');
    expect(deposits.length).toBeGreaterThan(20);
    expect(deposits).toEqual([...b.query('stone')].filter(e => e.typeId === 'core:stone'));
    expect(deposits.length).toBeLessThanOrEqual(Math.floor(a.terrain.width * a.terrain.height / 240));
    expect(deposits.every(e => STONE_BIOMES.includes(e.components.stone!.biome))).toBe(true);
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
    stocks.wood = 2; stocks.stone = 7; stocks.commonMetal = 2;
    expect(assignConstruction(world, worker)).toBe(false);
    stocks.stone = 8; expect(assignConstruction(world, worker)).toBe(true);
    expect(stocks.wood).toBe(2); expect(stocks.stone).toBe(8);
    expect(home.components.dwelling!.capacity).toBe(5); expect(home.components.health!.max).toBe(180);
    expect(assignConstruction(world, people[1])).toBe(true);
    expect(stocks.stone).toBe(8);
    arrive(world, worker, 22.3, 24);
    worker.components.person!.animation = { stride: 0, moving: 0, heading: 0, work: 0 };
    for (let i = 0; i < 100; i++) { world.tick++; construction(world, STEP); }
    expect(home.components.building!.project!.progress).toBeGreaterThan(0);
    expect(stocks.wood).toBe(0); expect(stocks.stone).toBe(0);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    for (let i = 0; i < 400; i++) {
      world.tick++; restored.tick++; construction(world, STEP); construction(restored, STEP);
    }
    expect(home.components.dwelling!.level).toBe(2);
    expect(home.components.dwelling!.capacity).toBe(7); expect(home.components.health!.max).toBe(300);
    expect(home.components.building!.project).toBeUndefined();
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(assignConstruction(world, worker)).toBe(false);
  });

  it('crafts axes using both materials, delivers them, and equips adults only at the market', () => {
    const { world, worker, stocks, village, home, people } = settlement();
    home.components.dwelling!.level = 2;
    const workshop = world.spawn('core:workshop', { x: 32, y: 28 })!; workshop.components.workplace!.villageId = village.id;
    stocks.tools = 8; stocks.wood = 0; stocks.stone = 2;
    expect(assignVillageWork(world, worker)).toBe(false);
    deposit(village, { wood: 1 }); expect(assignVillageWork(world, worker)).toBe(true);
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
    Object.assign(attacker.components.citizen!, { task: 'fight', targetId: target.id, attackIn: 0, hunger: 10 });
    createItem(world, 'stone-axe', { kind: 'equipped', entityId: attacker.id });
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
    const { world, village, home, people } = settlement();
    // Supply only the ore needed by the house and mill; this scenario still exercises stone weapons.
    economyOf(village).stocks.commonMetal = 3;
    for (const worker of people) worker.components.person!.age = 18;
    // Workplaces now consume wood too; provide enough real trees for both chains.
    for (const y of [30, 34]) for (const x of [8, 12, 16, 20, 28, 32]) world.spawn('core:tree', { x, y });
    for (const x of [12, 20, 28, 36]) world.spawn('core:stone', { x, y: 38 });
    // Building and supplying the workshop now precedes axe production.
    for (let i = 0; i < 6600 && ![...world.query('citizen')].some(e => e.components.citizen!.weapon === 'stone-axe'); i++) world.step();
    expect(home.components.dwelling!.level).toBe(2);
    expect([...world.query('person', 'citizen')].some(e => e.components.citizen!.weapon === 'stone-axe')).toBe(true);
    expect([...world.query('stone')].reduce((total, e) => total + e.components.stone!.remaining, 0)).toBeLessThan(96);
    expect(village.economy!.deliveries).toBeGreaterThan(0);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    advance(world, 3); advance(restored, 3); expect(restored.snapshot()).toEqual(world.snapshot());
    restored.paused = true; const before = restored.snapshot(); advance(restored, 1); expect(restored.snapshot()).toEqual(before);
  });
});
