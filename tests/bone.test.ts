import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { BONE } from '../src/core/bone';
import { NaturalBiome } from '../src/core/natural-biomes';
import { Terrain, type Entity } from '../src/core/types';
import { RESIDENT_DIET, type ResourceId } from '../src/core/resources';
import { cargoContents, deposit, inTransit, reservedStock, stockOf, takeFood } from '../src/core/resource-ledger';
import { extractSource, mayGather, releaseResources } from '../src/core/resource-sources';
import { initializeStorage, storesOf } from '../src/core/stockpiles';
import { newDeposit, reserveDeposit } from '../src/core/deposits';
import { createItem, equipmentBonuses, equippedItem } from '../src/core/equipment';
import { requestCraft } from '../src/core/crafting';
import { economyOf } from '../src/core/village-life';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { continueCraft, startCraft } from '../src/systems/crafting';
import { intentions } from '../src/systems/people';
import { processEvents } from '../src/systems/effects';
import { decodeSave } from '../src/persistence/schema';
import { languages } from '../src/i18n';
import { boneRecipeLines, resourceEntityLines } from '../src/render/resources';
import { flatWorld, setFood } from './helpers';

const reload = (w: World): World => new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!;
  const village = assignHouse(world, home); village.food = 40;
  const market = world.spawn('core:market', { x: 16, y: 24 })!, workshop = world.spawn('core:workshop', { x: 24, y: 24 })!;
  market.components.workplace!.villageId = workshop.components.workplace!.villageId = village.id;
  const workers = [18, 20, 22, 26].map(x => world.spawn('core:person', { x, y: 20 })!);
  for (const e of workers) { Object.assign(e.components.person!, { age: 30, homeId: home.id }); e.components.citizen!.villageId = village.id; }
  initializeStorage(world, village);
  return { world, village, home, market, workshop, workers, worker: workers[0] };
}
function arrive(world: World, worker: Entity, source: Entity): void {
  Object.assign(worker.components.position!, { x: source.components.position!.x - 1.8, y: source.components.position!.y });
  worker.components.citizen!.path = []; world.spatial.update(worker);
}
function start(world: World, worker: Entity, source: Entity, good: ResourceId = 'bone'): void {
  Object.assign(worker.components.citizen!, { task: 'work', targetId: source.id, work: { good, progress: 4, cargo: null } });
  arrive(world, worker, source);
}
function ore(world: World): Entity {
  world.terrain.setBiome(28, 20, NaturalBiome.Corrupted);
  return world.spawn('core:bone-deposit', { x: 28, y: 20 })!;
}
function kill(world: World, e: Entity): Entity {
  e.components.health!.current = 0; world.die(e.id, { cause: 'other' });
  return [...world.query('resourcePile')].find(p => p.components.resourcePile!.originId === e.id)!;
}

describe('bone sources, ownership and lifetime', () => {
  it('seeds finite Corrupted deposits deterministically, never when loading or repainting', () => {
    const a = new World(781, undefined, undefined, undefined, undefined, NaturalBiome.Corrupted);
    const b = new World(781, undefined, undefined, undefined, undefined, NaturalBiome.Corrupted);
    const sources = [...a.query('stone')].filter(e => e.typeId === 'core:bone-deposit');
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).toEqual([...b.query('stone')].filter(e => e.typeId === 'core:bone-deposit'));
    expect(sources.every(e => e.components.stone!.biome === NaturalBiome.Corrupted && e.components.stone!.remaining === BONE.deposit)).toBe(true);
    for (const source of sources) a.remove(source.id);
    expect([...reload(a).query('stone')].filter(e => e.typeId === 'core:bone-deposit')).toEqual([]);
    const blank = flatWorld(); blank.terrain.setBiome(28, 20, NaturalBiome.Corrupted); blank.step();
    expect([...blank.query('stone')]).toEqual([]);
  });
  it('assigns a miner and gives the last bone/stone lot to only one carrier across reload', () => {
    const { world, worker, workers, village, market } = fixture(), source = ore(world);
    source.components.stone!.remaining = 3;
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(worker.components.citizen!.targetId).toBe(source.id);
    const copy = reload(world), miner = copy.entities.get(worker.id)!, target = copy.entities.get(source.id)!;
    start(copy, miner, target); expect(reserveDeposit(copy, target, miner)).toBe(true);
    const competitor = copy.entities.get(workers[1].id)!; start(copy, competitor, target);
    expect(reserveDeposit(copy, target, competitor)).toBe(false);
    expect(extractSource(copy, miner, target)).toBe(true);
    expect(extractSource(copy, competitor, target)).toBe(false);
    expect(cargoContents(miner.components.citizen!.work!.cargo!)).toEqual({ bone: 3, stone: 1 });
    expect(inTransit(copy, village.id)).toEqual({ bone: 3, stone: 1 });
    expect(assignVillageWork(copy, miner)).toBe(true); arrive(copy, miner, copy.entities.get(market.id)!); continueVillageWork(copy, miner);
    expect(stockOf(copy.society.villages[0], 'bone')).toBe(3); expect(stockOf(copy.society.villages[0], 'stone')).toBe(1);
    expect([...reload(copy).query('stone')]).toEqual([]);
  });
  it('does not start mining without room for the complete mixed batch', () => {
    const { world, worker, village } = fixture(), source = ore(world);
    for (const store of storesOf(village)) store.capacity = Object.values(store.goods).reduce((n, v) => n + v, 0);
    expect(assignVillageWork(world, worker)).toBe(false);
    expect(source.components.stone!.remaining).toBe(BONE.deposit);
    expect(source.components.stone!.claims).toEqual([]);
  });
  it('produces one species/mass result and loses a dead carrier cargo exactly once', () => {
    const { world, worker, village } = fixture(), source = ore(world);
    start(world, worker, source); expect(extractSource(world, worker, source)).toBe(true);
    const remains = kill(world, worker);
    releaseResources(world, worker); world.remove(worker.id);
    expect(economyOf(village).lost).toEqual({ bone: 3, stone: 1 });
    expect(remains.components.resourcePile).toMatchObject({ originId: worker.id, villageId: village.id, goods: { meat: 2, bone: 1 } });
    expect([...reload(world).query('resourcePile')]).toHaveLength(1);
    const young = world.spawn('core:sheep', { x: 30, y: 24 })!; young.components.animal!.age = 5;
    expect(kill(world, young).components.resourcePile!.goods).toEqual({ meat: 1, bone: 1, leather: 2 });
  });
  it('blocks all sapient enemies until an explicit policy is saved, then allows physical gathering', () => {
    const { world, worker } = fixture(), enemy = world.spawn('core:orc', { x: 28, y: 20 })!, pile = kill(world, enemy);
    start(world, worker, pile, 'meat');
    expect(mayGather(worker, pile)).toBe(false); expect(extractSource(world, worker, pile)).toBe(false);
    worker.components.resourceConsumer = { diet: [...RESIDENT_DIET], sapientRemains: true };
    const copy = reload(world), collector = copy.entities.get(worker.id)!, remains = copy.entities.get(pile.id)!;
    expect(extractSource(copy, collector, remains)).toBe(true);
    expect(cargoContents(collector.components.citizen!.work!.cargo!).bone).toBe(2);
  });
  it('handles repeated hunting damage once and accounts for gathering another village’s remains', () => {
    const { world, worker, village } = fixture(), otherHome = world.spawn('core:house', { x: 42, y: 42 })!;
    const other = assignHouse(world, otherHome), sheep = world.spawn('core:sheep', { x: 28, y: 20 })!;
    sheep.components.animal!.villageId = other.id;
    world.events.push({ kind: 'damage', target: sheep.id, amount: 1000 }, { kind: 'damage', target: sheep.id, amount: 1000 });
    processEvents(world); releaseResources(world, sheep);
    const piles = [...world.query('resourcePile')]; expect(piles).toHaveLength(1);
    const goods = { ...piles[0].components.resourcePile!.goods };
    start(world, worker, piles[0], 'meat'); expect(extractSource(world, worker, piles[0])).toBe(true);
    expect(economyOf(other).lost).toEqual(goods); expect(inTransit(world, village.id)).toEqual(goods);
    expect([...reload(world).query('resourcePile')]).toEqual([]);
  });
  it('expires only the uncollected part, preserves cargo during pause/reload and records remaining losses once', () => {
    const { world, worker, village } = fixture(), sheep = world.spawn('core:sheep', { x: 28, y: 20 })!;
    sheep.components.animal!.villageId = village.id;
    const pile = kill(world, sheep); pile.components.resourcePile!.goods = { meat: 12, bone: 12, leather: 12 };
    start(world, worker, pile, 'meat'); expect(extractSource(world, worker, pile)).toBe(true);
    const cargo = cargoContents(worker.components.citizen!.work!.cargo!);
    world.tick = BONE.remainsTicks - 1; world.paused = true; world.step();
    expect(world.entities.has(pile.id)).toBe(true);
    const copy = reload(world); copy.paused = false;
    // Run the same registered lifetime system without letting the carrier deliver.
    copy.tick++; copy.systems.find(s => s.id === 'core:remains')!.update(copy, 1 / 30);
    expect(copy.entities.has(pile.id)).toBe(false);
    expect(cargoContents(copy.entities.get(worker.id)!.components.citizen!.work!.cargo!)).toEqual(cargo);
    expect(copy.society.villages[0].economy!.lost).toEqual({ leather: 12 });
    expect(reload(copy).society.villages[0].economy!.lost).toEqual({ leather: 12 });
  });
  it('consumes a particular pile on raising and cannot generate it again after another death or reload', () => {
    const { world, village, worker } = fixture(), sheep = world.spawn('core:sheep', { x: 28, y: 20 })!;
    sheep.components.animal!.villageId = village.id;
    const pile = kill(world, sheep), goods = { ...pile.components.resourcePile!.goods };
    start(world, worker, pile);
    expect(world.raiseRemains(pile.id, 'core:tree')).toBeUndefined();
    const raised = world.raiseRemains(pile.id, 'core:sheep')!;
    expect(raised.components.raisedRemains).toEqual({ originId: sheep.id });
    expect(economyOf(village).spent).toEqual(goods); expect(worker.components.citizen!.targetId).toBeNull();
    expect(world.raiseRemains(raised.id, 'core:sheep')).toBeUndefined();
    const copy = reload(world); kill(copy, copy.entities.get(raised.id)!);
    expect([...copy.query('resourcePile')]).toEqual([]); expect([...reload(copy).query('resourcePile')]).toEqual([]);
  });
  it('keeps existing stock and death time in version 42 without granting deposits or a new collection window', () => {
    const { world, village } = fixture(), sheep = world.spawn('core:sheep', { x: 28, y: 20 })!;
    const pile = kill(world, sheep); world.tick = BONE.remainsTicks + 100;
    const old = world.snapshot(); old.version = 42;
    const copy = new World(world.seed, world.registry, decodeSave(old, world.registry));
    expect(stockOf(copy.society.villages[0], 'bone')).toBe(stockOf(village, 'bone'));
    expect([...copy.query('stone')]).toEqual([]); expect(copy.entities.get(pile.id)!.components.resourcePile!.createdAt).toBe(0);
    copy.step(); expect(copy.entities.has(pile.id)).toBe(false);
  });
  it('rejects invalid bone deposits, non-creature policies and duplicate biological origins', () => {
    const { world, home } = fixture(), source = ore(world);
    source.components.stone!.remaining = 2; expect(() => reload(world)).toThrow();
    source.components.stone = newDeposit(NaturalBiome.Corrupted, 'natural', 'boneDeposit');
    home.components.resourceConsumer = { diet: ['bone'], sapientRemains: true }; expect(() => reload(world)).toThrow();
    delete home.components.resourceConsumer;
    const sheep = world.spawn('core:sheep', { x: 30, y: 24 })!, remains = kill(world, sheep);
    const raised = world.spawn('core:sheep', { x: 32, y: 24 })!; raised.components.raisedRemains = { originId: sheep.id };
    expect(() => reload(world)).toThrow(); world.remove(remains.id); expect(() => reload(world)).not.toThrow();
    world.terrain.set(28, 20, Terrain.Water); world.tick = 30;
    world.systems.find(s => s.id === 'core:stone-deposits')!.update(world, 1 / 30);
    expect(world.entities.has(source.id)).toBe(false);
  });
});

describe('bone consumers', () => {
  it('does not eat bone by default, but an explicit diet feeds a hungry resident from real stock', () => {
    const { world, village, worker, home } = fixture(); setFood(village, 0); deposit(village, { bone: 2 });
    expect(takeFood(village, 1)).toEqual({}); expect(stockOf(village, 'bone')).toBe(2);
    worker.components.resourceConsumer = { diet: ['bone'], sapientRemains: false };
    Object.assign(worker.components.citizen!, { task: 'eat', targetId: home.id, hunger: 60, path: [] });
    arrive(world, worker, home); world.tick = 15; intentions(world);
    expect(worker.components.citizen!.hunger).toBeLessThan(20);
    expect(stockOf(village, 'bone')).toBe(1); expect(village.food).toBe(0); expect(economyOf(village).spent?.bone).toBe(1);
    expect(reload(world).entities.get(worker.id)!.components.resourceConsumer?.diet).toEqual(['bone']);
  });
  it('blocks an amulet without gems without spending bone, then produces one paid individual accessory', () => {
    const { world, village, worker, workers, workshop } = fixture(); deposit(village, { bone: 1 });
    const order = requestCraft(world, workers[1], 'amulet')!; expect(order.recipe).toBe('bone-amulet');
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    expect(stockOf(village, 'bone')).toBe(1); expect(reservedStock(world, village)).toEqual({});
    deposit(village, { gems: 1 }); expect(startCraft(world, worker, order, workshop)).toBe(true);
    arrive(world, worker, workshop); for (let i = 0; i < 8; i++) continueCraft(world, worker);
    expect(order.paid).toBe(true); expect(economyOf(village).spent).toMatchObject({ bone: 1, gems: 1 });
    expect(world.equipment.items.filter(i => i.definition === 'bone-amulet')).toHaveLength(1);
    const wearer = workers[2]; createItem(world, 'bone-amulet', { kind: 'equipped', entityId: wearer.id }, undefined, { health: 1 });
    expect(equippedItem(world, wearer.id, 'amulet')?.definition).toBe('bone-amulet');
    expect(equippedItem(world, wearer.id, 'armor')).toBeUndefined(); expect(equipmentBonuses(world, wearer).health).toBe(5);
    for (const id of ['bone-sword', 'bone-armor', 'bone-helmet']) expect(() => createItem(world, id, { kind: 'equipped', entityId: wearer.id })).toThrow();
  });
  it('explains origin, lifetime, permission and recipe in every supported language', () => {
    const { world } = fixture(), source = ore(world), enemy = world.spawn('core:orc', { x: 30, y: 24 })!, remains = kill(world, enemy);
    for (const language of languages) {
      const lines = [...resourceEntityLines(source, language.id, world), ...resourceEntityLines(remains, language.id, world), ...boneRecipeLines(language.id)];
      expect(lines.join(' ')).not.toMatch(/undefined|\{seconds\}/);
      if (language.id !== 'en') expect(lines.join(' ')).not.toMatch(/Bone deposit|Gather within|Sapient remains|Bone sources/);
    }
  });
});
