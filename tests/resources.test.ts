import { storesOf } from '../src/core/stockpiles';
import { describe, expect, it } from 'vitest';
import { flatWorld, advance, diplomaticWorld } from './helpers';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { assignConstruction } from '../src/systems/construction';
import { processEvents } from '../src/systems/effects';
import { enrage } from '../src/systems/afflictions';
import { economyOf } from '../src/core/village-life';
import { World } from '../src/core/world';
import { Terrain, type Entity } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { bundleSize, canCollectRemains, canConsume, creatureDrops, creatureMass, extractBundle, RESIDENT_DIET, RESOURCE_IDS, RESOURCES, SOURCE_PROFILES, SPECIAL_CHAINS, validSourceProfile, validSpecialChains, type ResourceBundle, type ResourceId } from '../src/core/resources';
import { availableStock, cargoContents, deposit, inTransit, packedFood, recordLoss, reservedStock, stockOf, takeFood, withdraw } from '../src/core/resource-ledger';
import { extractSource } from '../src/core/resource-sources';
import { resourceEntityLines, resourceText } from '../src/render/resources';
import { languages } from '../src/i18n';
import { dispatchCaravan, caravans } from '../src/systems/caravans';

function settlement() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  village.food = 120; village.migrationAfter = 100000;
  const people = [18, 20, 26, 28, 30, 32].map(x => world.spawn('core:person', { x, y: 21 })!);
  people.forEach(e => {
    Object.assign(e.components.person!, { sex: 'b', reproduceIn: 100000, buildIn: 100000 });
    e.components.citizen!.villageId = village.id;
  });
  const market = world.spawn('core:market', { x: 16, y: 28 })!; market.components.workplace!.villageId = village.id;
  return { world, home, village, people, worker: people[0], market, stocks: economyOf(village).stocks };
}
function arrive(world: World, e: Entity, target: Entity) {
  Object.assign(e.components.position!, { x: target.components.position!.x - 1.8, y: target.components.position!.y });
  e.components.citizen!.path = []; world.spatial.update(e);
}
function kill(world: World, target: Entity) {
  world.events.push({ kind: 'damage', target: target.id, amount: 10000 }); processEvents(world);
  return [...world.query('resourcePile')].find(e => e.components.resourcePile!.originId === target.id)!;
}
function start(e: Entity, target: Entity, good: ResourceId) {
  Object.assign(e.components.citizen!, { task: 'work', targetId: target.id, work: { good, progress: 0, cargo: null }, path: [] });
}
const restore = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));

describe('resource catalogue and contracts', () => {
  it('declares stable goods without treating equipment grades or money as ores', () => {
    expect(new Set(RESOURCE_IDS).size).toBe(RESOURCE_IDS.length);
    expect(RESOURCE_IDS).not.toContain('steel'); expect(RESOURCE_IDS).not.toContain('money');
    expect(Object.values(RESOURCES).filter(r => r.kind === 'food')).toHaveLength(27);
    expect(Object.values(RESOURCES).every(r => r.weight > 0 && r.volume > 0 && r.source && r.storable && r.transportable)).toBe(true);
    expect(Object.values(SOURCE_PROFILES).every(validSourceProfile)).toBe(true);
    expect(SOURCE_PROFILES.crystalTree.outputs).toEqual({ wood: 5, stone: 1, commonMetal: 1, gems: 1 });
    expect(SOURCE_PROFILES.crystalPlant.outputs).toEqual({ commonMetal: 2, gems: 1, crystalSalt: 1 });
    expect(validSpecialChains(SPECIAL_CHAINS)).toBe(true);
    const bad = structuredClone(SPECIAL_CHAINS); Object.assign(bad.fertilizer, { fertilityGain: 2 });
    expect(validSpecialChains(bad)).toBe(false);
    expect(validSpecialChains({ ...SPECIAL_CHAINS, dragonScale: { ...SPECIAL_CHAINS.dragonScale, outputs: { dragonScale: 0 } } } as unknown as typeof SPECIAL_CHAINS)).toBe(false);
  });
  it.each([['meat', 50], ['mushrooms', 40], ['peppers', 40], ['bone', 100], ['leather', 100], ['crystalSalt', 150], ['stone', 150], ['gems', 200]] as const)('scales %s once at its threshold %i', (good, threshold) => {
    const profile = { baseMass: threshold - 0.001, modifier: 0, size: 0.1, child: false };
    expect(creatureDrops({ [good]: 2 }, profile)[good]).toBe(2);
    profile.baseMass = threshold;
    expect(creatureDrops({ [good]: 2 }, profile)[good]).toBe(4);
    expect(creatureDrops({ [good]: 2 }, { ...profile, child: true })[good]).toBe(2);
    expect(creatureMass({ ...profile, modifier: 0.3, size: 0.2, child: true })).toBeCloseTo(threshold * 1.3 * 2 * 0.4);
    expect(creatureDrops({ [good]: 2 }, { ...profile, baseMass: 1e6 })[good]).toBe(30);
    expect(creatureDrops({ [good]: 0 }, profile)).toEqual({});
  });
  it('requires a diet and permission for same-species remains', () => {
    expect(canConsume('commonMetal', RESIDENT_DIET)).toBe(false);
    expect(canConsume('commonMetal', ['commonMetal'])).toBe(true);
    expect(canConsume('fertilizer', ['fertilizer'])).toBe(false);
    const policy = { species: 'human', savage: false, scavenges: true, diet: RESIDENT_DIET };
    expect(canCollectRemains('human', { meat: 2 }, policy)).toBe(false);
    expect(canCollectRemains('human', { meat: 2 }, { ...policy, savage: true })).toBe(true);
    expect(canCollectRemains('sheep', { meat: 2 }, { ...policy, scavenges: false })).toBe(false);
    expect(canCollectRemains('sheep', { commonMetal: 2 }, policy)).toBe(false);
  });
  it('atomically exhausts mixed remaining goods without inventing zero outputs', () => {
    const remaining = { wood: 3, gems: 1, stone: 0 };
    expect(extractBundle(remaining, { wood: 3, gems: 1, stone: 1 })).toEqual({ wood: 3, gems: 1 });
    expect(extractBundle(remaining, { wood: 3, gems: 1 })).toEqual({});
  });
});

describe('resource ownership in the running economy', () => {
  it('creates one mixed death pile, requires arrival, retains byproducts on partial delivery and reload', () => {
    const { world, worker, village, stocks, market } = settlement();
    const sheep = world.spawn('core:sheep', { x: 32, y: 28 })!;
    const remains = kill(world, sheep), original = { ...remains.components.resourcePile!.goods };
    world.remove(sheep.id); processEvents(world);
    expect([...world.query('resourcePile')]).toHaveLength(1);
    expect(assignVillageWork(world, worker)).toBe(true);
    continueVillageWork(world, worker); expect(worker.components.citizen!.work!.cargo).toBeNull();
    arrive(world, worker, remains); continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(world.entities.has(remains.id)).toBe(false);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual(original);
    expect(stocks.meat ?? 0).toBe(0); expect(inTransit(world, village.id)).toEqual(original);
    storesOf(village)[0].capacity = 2200; deposit(village, { leather: 2000 }); arrive(world, worker, market); continueVillageWork(world, worker);
    expect(stocks.meat).toBe(original.meat); expect(stocks.bone).toBe(original.bone);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ leather: original.leather });
    const saved = restore(world), carried = saved.entities.get(worker.id)!;
    withdraw(saved.society.villages[0], { leather: 2 });
    expect(assignVillageWork(saved, carried)).toBe(true); arrive(saved, carried, saved.entities.get(market.id)!); continueVillageWork(saved, carried);
    expect(carried.components.citizen!.work).toBeUndefined(); expect(saved.society.villages[0].economy!.stocks.leather).toBe(2000);
    expect([...restore(saved).query('resourcePile')]).toHaveLength(0);
  });
  it('two miners share the last finite batch even when both jobs were assigned', () => {
    const { world, people } = settlement(), deposit = world.spawn('core:stone', { x: 32, y: 28 })!;
    deposit.components.stone!.remaining = 4;
    for (const worker of people.slice(0, 2)) { start(worker, deposit, 'stone'); arrive(world, worker, deposit); }
    for (let i = 0; i < 8; i++) for (const worker of people.slice(0, 2)) continueVillageWork(world, worker);
    expect(people.slice(0, 2).reduce((n, e) => n + (e.components.citizen!.work?.cargo?.amount ?? 0), 0)).toBe(4);
    expect(world.entities.has(deposit.id)).toBe(false);
  });
  it('makes repeated physical trips for a large mixed pile, including the non-food remainder', () => {
    const { world, worker, stocks, market } = settlement();
    const sheep = world.spawn('core:sheep', { x: 32, y: 28 })!, remains = kill(world, sheep);
    remains.components.resourcePile!.goods = { meat: 12, bone: 12, leather: 12 };
    expect(assignVillageWork(world, worker)).toBe(true); arrive(world, worker, remains);
    continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(remains.components.resourcePile!.goods).toEqual({ meat: 0, bone: 0, leather: 12 });
    arrive(world, worker, market); continueVillageWork(world, worker);
    expect(assignVillageWork(world, worker)).toBe(true); arrive(world, worker, remains);
    continueVillageWork(world, worker); continueVillageWork(world, worker);
    arrive(world, worker, market); continueVillageWork(world, worker);
    expect(stocks).toMatchObject({ meat: 12, bone: 12, leather: 12 });
    expect(world.entities.has(remains.id)).toBe(false); expect(() => restore(world)).not.toThrow();
  });
  it('reserves recipe inputs, leaves housing wood, releases cancellation, and spends once after work', () => {
    const { world, worker, people, village, stocks, market } = settlement();
    stocks.stone = 0; stocks.wood = 7;
    const workshop = world.spawn('core:workshop', { x: 32, y: 28 })!; workshop.components.workplace!.villageId = village.id;
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(reservedStock(world, village)).toEqual({ wood: 3 }); expect(stocks.wood).toBe(7);
    expect(availableStock(world, village, 'wood')).toBe(4);
    expect(assignConstruction(world, people[1])).toBe(false);
    expect(assignVillageWork(world, people[1])).toBe(false);
    worker.components.citizen!.hunger = 80; continueVillageWork(world, worker);
    expect(reservedStock(world, village)).toEqual({}); expect(stocks.wood).toBe(7);
    worker.components.citizen!.hunger = 10; expect(assignVillageWork(world, worker)).toBe(true);
    const copy = restore(world); expect(reservedStock(copy, copy.society.villages[0])).toEqual({ wood: 3 });
    arrive(world, worker, workshop); for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(stocks.wood).toBe(4); expect(stocks.tools).toBe(0); expect(economyOf(village).spent).toEqual({ wood: 3 });
    arrive(world, worker, market); continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(stocks.tools).toBe(2); expect(stocks.wood).toBe(4);
  });
  it('keeps interrupted cargo physical, accounts for carrier loss and never puts it in death drops', () => {
    const { world, worker, village, stocks } = settlement();
    const deposit = world.spawn('core:stone', { x: 32, y: 28 })!;
    start(worker, deposit, 'stone'); arrive(world, worker, deposit); expect(extractSource(world, worker, deposit)).toBe(true);
    enrage(world, worker); expect(worker.components.citizen!.work!.cargo!.amount).toBe(4);
    const remains = kill(world, worker); expect(remains.components.resourcePile!.goods.stone).toBeUndefined();
    expect(economyOf(village).lost?.stone).toBe(4); expect(stocks.stone).toBe(0);
    const restored = restore(world); expect(restored.society.villages[0].economy!.lost?.stone).toBe(4);
    expect([...restored.query('resourcePile')]).toHaveLength(1);
  });
  it('market destruction loses stored goods but preserves cargo, and reconstruction never refunds the loss', () => {
    const { world, worker, village, market, stocks, people } = settlement();
    stocks.wood = 9; stocks.stone = 4;
    worker.components.citizen!.work = { good: 'stone', progress: 0, cargo: { good: 'stone', amount: 4, villageId: village.id } };
    const workshop = world.spawn('core:workshop', { x: 32, y: 28 })!; workshop.components.workplace!.villageId = village.id;
    expect(assignVillageWork(world, people[1])).toBe(true);
    expect(reservedStock(world, village)).toEqual({ wood: 3 });
    world.remove(market.id);
    expect(reservedStock(world, village)).toEqual({}); expect(() => restore(world)).not.toThrow();
    expect(stocks.wood).toBe(0); expect(stocks.stone).toBe(0); expect(economyOf(village).lost).toMatchObject({ wood: 9, stone: 4, provisions: 120 });
    expect(assignVillageWork(world, worker)).toBe(false); expect(inTransit(world, village.id)).toEqual({ stone: 4 });
    const replacement = world.spawn('core:market', { x: 16, y: 28 })!; replacement.components.workplace!.villageId = village.id;
    expect(assignVillageWork(world, worker)).toBe(true); arrive(world, worker, replacement); continueVillageWork(world, worker);
    expect(stocks.stone).toBe(4); expect(stocks.wood).toBe(0); expect(restore(world).society.villages[0].economy!.lost?.wood).toBe(9);
  });
  it('a changed settlement returns cargo to its original owner; unreachable routes retain it', () => {
    const { world, worker, village, market } = settlement();
    const secondHome = world.spawn('core:house', { x: 43, y: 43 })!, second = assignHouse(world, secondHome);
    expect(second.id).not.toBe(village.id);
    worker.components.citizen!.villageId = second.id;
    worker.components.citizen!.work = { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 3, villageId: village.id } };
    for (let y = 0; y < 48; y++) world.terrain.set(17, y, Terrain.Water);
    expect(assignVillageWork(world, worker)).toBe(false); expect(stockOf(village, 'wood')).toBe(0);
    for (let y = 0; y < 48; y++) world.terrain.set(17, y, Terrain.Grass);
    expect(assignVillageWork(world, worker)).toBe(true); arrive(world, worker, market); continueVillageWork(world, worker);
    expect(stockOf(village, 'wood')).toBe(3); expect(stockOf(second, 'wood')).toBe(0);
  });
  it('same-species remains and administrative despawns give no free harvest', () => {
    const { world, worker, people } = settlement();
    const remains = kill(world, people[1]);
    start(worker, remains, 'meat'); arrive(world, worker, remains);
    expect(extractSource(world, worker, remains)).toBe(false);
    world.remove(people[2].id); expect([...world.query('resourcePile')]).toHaveLength(1);
  });
  it('consumption cannot eat metal or count bread twice; trade keeps bread in a real load', () => {
    const world = diplomaticWorld(2), from = world.society.villages[0], to = world.society.villages[1];
    from.food = 0; to.food = 0;
    deposit(from, { bread: 80, commonMetal: 5 }); expect(from.food).toBe(80); expect(stockOf(from, 'provisions')).toBe(0);
    expect(bundleSize(takeFood(from, 1))).toBe(1); expect(economyOf(from).stocks.bread).toBe(79); expect(stockOf(from, 'commonMetal')).toBe(5);
    expect(dispatchCaravan(world, from.id, to.id, 12)).toBe(true);
    const caravan = [...world.query('caravan')][0], load = caravan.components.caravan!;
    expect(load.foodGoods).toEqual({ bread: 12 }); expect(from.food).toBe(67); expect(to.food).toBe(0);
    const copy = restore(world); expect(copy.entities.get(caravan.id)!.components.caravan!.foodGoods).toEqual({ bread: 12 });
    for (let i = 0; i < 700; i++) { world.tick++; caravans(world, 1 / 30); }
    expect(economyOf(to).stocks.bread).toBe(12); expect(to.food).toBe(12);
    expect(economyOf(from).stocks.bread + economyOf(to).stocks.bread).toBe(79);
  });
  it('carrier destruction records a food shipment once, never refunds it remotely', () => {
    const world = diplomaticWorld(2), from = world.society.villages[0]; from.food = 80; world.society.villages[1].food = 0;
    expect(dispatchCaravan(world, 1, 2)).toBe(true);
    const caravan = [...world.query('caravan')][0]; world.remove(caravan.id); world.remove(caravan.id);
    expect(from.food).toBe(68); expect(economyOf(from).lost).toEqual({ provisions: 12 });
  });
  it('migrates all seven quantities once, with neither map seeding nor double food/equipment awards', () => {
    const { world, worker, village, stocks } = settlement();
    Object.assign(stocks, { grain: 7, flour: 6, bread: 5, wood: 4, tools: 3, stone: 2, stoneAxes: 1 });
    worker.components.citizen!.weapon = 'stone-axe';
    world.spawn('core:tree', { x: 32, y: 28 });
    const old = world.snapshot(); old.version = 32;
    const copy = new World(world.seed, world.registry, decodeSave(old, world.registry));
    expect(copy.society.villages[0].economy!.stocks).toEqual(stocks);
    expect(stockOf(copy.society.villages[0], 'provisions')).toBe(village.food - 5);
    expect(copy.entities.get(worker.id)!.components.citizen!.weapon).toBe('stone-axe');
    expect(restore(copy).snapshot()).toEqual(copy.snapshot());
    expect([...copy.query('resourcePile')]).toHaveLength(0);
  });
  it('does not restore already-eaten food from a stale legacy bread counter', () => {
    const { world, village, stocks } = settlement();
    const old = world.snapshot(); old.version = 32;
    delete old.society.villages[0].economy!.storage;
    old.society.villages[0].food = 1; old.society.villages[0].economy!.stocks.bread = 5;
    const migrated = decodeSave(old, world.registry);
    expect(migrated.society.villages[0].food).toBe(1);
    expect(migrated.society.villages[0].economy!.stocks.bread).toBe(1);
    village.food = 1; stocks.bread = 5;
    expect(() => restore(world)).toThrow();
  });
  it('rejects corrupt mixtures, reservations, losses, food shipments and duplicate death claims', () => {
    const { world, worker, village } = settlement();
    worker.components.citizen!.work = { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 3, villageId: village.id, byproducts: { stone: -1 } } };
    expect(() => restore(world)).toThrow();
    worker.components.citizen!.work.cargo!.byproducts = { wood: 3 }; expect(() => restore(world)).toThrow();
    worker.components.citizen!.work.cargo!.byproducts = { stone: 12 }; expect(() => restore(world)).toThrow();
    delete worker.components.citizen!.work;
    recordLoss(village, { stone: 1 }); economyOf(village).lost!.stone = NaN; expect(() => restore(world)).toThrow(); delete economyOf(village).lost;
    worker.components.citizen!.work = { good: 'tools', progress: 1, cargo: null, reservation: { villageId: village.id, inputs: { wood: 1 } } };
    expect(() => restore(world)).toThrow(); delete worker.components.citizen!.work;
    const sheep = world.spawn('core:sheep', { x: 32, y: 28 })!, pile = kill(world, sheep);
    const second = world.spawn('core:resource-pile', { x: 33, y: 28 })!; second.components.resourcePile = structuredClone(pile.components.resourcePile);
    expect(() => restore(world)).toThrow();
    const caravan = world.spawn('core:caravan', { x: 20, y: 28 })!;
    Object.assign(caravan.components.caravan!, { fromId: village.id, toId: null, returning: true, food: 2, foodGoods: { bread: 3 } });
    world.remove(second.id); expect(() => restore(world)).toThrow();
    caravan.components.caravan!.foodGoods = packedFood(2); expect(() => restore(world)).not.toThrow();
  });
  it('rejects saved reservations that claim the same last inputs twice', () => {
    const { world, people, village, stocks } = settlement(); stocks.wood = 3;
    const workshop = world.spawn('core:workshop', { x: 32, y: 28 })!; workshop.components.workplace!.villageId = village.id;
    for (const e of people.slice(0, 2)) {
      start(e, workshop, 'tools'); e.components.citizen!.work!.reservation = { villageId: village.id, inputs: { wood: 3 } };
    }
    expect(() => restore(world)).toThrow();
    people[1].components.citizen!.task = 'idle'; expect(() => restore(world)).not.toThrow();
  });
  it('uses the normal pause/step and reproduces the actual collection chain after a mid-route save', () => {
    const { world, village } = settlement();
    const sheep = world.spawn('core:sheep', { x: 32, y: 28 })!; kill(world, sheep);
    world.paused = true; const paused = world.snapshot(); advance(world, 2); expect(world.snapshot()).toEqual(paused);
    world.paused = false; advance(world, 2); const copy = restore(world);
    advance(world, 22); advance(copy, 22); expect(copy.snapshot()).toEqual(world.snapshot());
    expect(economyOf(village).deliveries).toBeGreaterThan(0);
    expect(stockOf(village, 'bone')).toBeGreaterThan(0); expect(stockOf(village, 'leather')).toBeGreaterThan(0);
  });
  it('localizes cargo, mixed sources and costs through every supported language', () => {
    const { world, worker, village } = settlement();
    worker.components.citizen!.work = { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 3, villageId: village.id, byproducts: { gems: 1 } } };
    expect(resourceEntityLines(worker, 'ru')[0]).toBe('Груз: Древесина 3, Самоцветы 1');
    const goods: ResourceBundle = Object.fromEntries(RESOURCE_IDS.map(id => [id, 1]));
    for (const language of languages) {
      expect(resourceText(goods, language.id)).not.toContain('undefined');
      if (language.id !== 'en') expect(resourceEntityLines(worker, language.id)[0]).not.toContain('Cargo:');
    }
    expect(world.registry.entities.has('core:resource-pile')).toBe(true);
    expect(withdraw(village, { commonMetal: 1 })).toBe(false);
  });
});
