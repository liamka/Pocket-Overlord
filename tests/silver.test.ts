import { describe, expect, it } from 'vitest';
import { flatWorld, setFood } from './helpers';
import { World } from '../src/core/world';
import { NaturalBiome } from '../src/core/natural-biomes';
import { Terrain, type Entity } from '../src/core/types';
import { SILVER, SILVER_WEIGHTS } from '../src/core/silver';
import { seedSilver } from '../src/content/silver';
import { EQUIPMENT, equipmentScore } from '../src/core/equipment-catalog';
import { createItem, equipItem, equipmentBonuses, equippedItem, itemValue, removeEquippedItem, replacementReason } from '../src/core/equipment';
import { metalRecipeAllowed, requestCraft } from '../src/core/crafting';
import { deposit, cargoContents, stockOf } from '../src/core/resource-ledger';
import { initializeStorage, storageRoute, storesOf, syncStocks } from '../src/core/stockpiles';
import { sourceContents } from '../src/core/resource-sources';
import { economyOf } from '../src/core/village-life';
import { decodeSave } from '../src/persistence/schema';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { cancelCraft, continueCraft, startCraft } from '../src/systems/crafting';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  const market = world.spawn('core:market', { x: 16, y: 24 })!;
  market.components.workplace!.villageId = village.id;
  initializeStorage(world, village);
  const store = storesOf(village)[0]; store.capacity = 2000;
  setFood(village, 100); deposit(village, { stone: 24, wood: 12, tools: 8 });
  const workers = [18, 20, 26, 28].map(x => world.spawn('core:person', { x, y: 20 })!);
  for (const worker of workers) {
    Object.assign(worker.components.person!, { age: 30, homeId: home.id });
    worker.components.citizen!.villageId = village.id;
  }
  const ore = world.spawn('core:silver-ore', { x: 32, y: 24 })!;
  ore.components.stone!.origin = 'placed';
  return { world, village, store, market, workers, ore };
}
function arrive(world: World, worker: Entity, target: Entity): void {
  const path = storageRoute(world, worker.components.position!, target)!;
  if (path.length) Object.assign(worker.components.position!, path.at(-1));
  world.spatial.update(worker); worker.components.citizen!.path = [];
}
function craftFixture() {
  const f = fixture();
  const workshop = f.world.spawn('core:workshop', { x: 24, y: 30 })!;
  workshop.components.workplace!.villageId = f.village.id;
  economyOf(f.village).metalworking = SILVER.requires;
  deposit(f.village, { silver: 2, gems: 2 });
  return { ...f, workshop, worker: f.workers[0], recipient: f.workers[1] };
}
const restore = (world: World): World => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry), []);

describe('silver production and equipment', () => {
  it('seeds only eligible biomes deterministically without advancing simulation randomness or reseeding saves', () => {
    const a = flatWorld(), b = flatWorld();
    a.terrain.biomes.fill(NaturalBiome.Enchanted); b.terrain.biomes.fill(NaturalBiome.Enchanted);
    const rng = a.rng.state; seedSilver(a); seedSilver(b);
    expect([...a.query('stone')]).toEqual([...b.query('stone')]);
    expect([...a.query('stone')].length).toBeGreaterThan(0); expect(a.rng.state).toBe(rng);
    expect(restore(a).snapshot().entities).toEqual(a.snapshot().entities);
    const grass = flatWorld(); seedSilver(grass); expect([...grass.query('stone')]).toHaveLength(0);
    expect(SILVER_WEIGHTS[NaturalBiome.Desert]).toBeLessThan(SILVER_WEIGHTS[NaturalBiome.Enchanted]!);
    for (const e of [...a.query('stone')]) a.remove(e.id);
    expect([...restore(a).query('stone')]).toHaveLength(0);
  });

  it('reserves a finite mixed batch for two miners, preserves cargo across biome changes, and delivers both products once', () => {
    const { world, village, store, workers: [a, b], ore, market } = fixture();
    store.goods.stone = 0; syncStocks(village);
    ore.components.stone!.remaining = 6;
    expect(assignVillageWork(world, a)).toBe(true);
    expect(assignVillageWork(world, b)).toBe(true);
    expect(ore.components.stone!.claims.reduce((n, c) => n + c.amount, 0)).toBe(6);
    for (let i = 0; i < 8; i++) continueVillageWork(world, a);
    expect(ore.components.stone!.remaining).toBe(6);
    arrive(world, a, ore); arrive(world, b, ore);
    for (let i = 0; i < 8; i++) { continueVillageWork(world, a); continueVillageWork(world, b); }
    expect(world.entities.has(ore.id)).toBe(false);
    expect(stockOf(village, 'silver')).toBe(0); expect(stockOf(village, 'stone')).toBe(0);
    expect(cargoContents(a.components.citizen!.work!.cargo!)).toEqual({ silver: 4, stone: 4 });
    expect(cargoContents(b.components.citizen!.work!.cargo!)).toEqual({ silver: 2, stone: 2 });
    world.terrain.biomes.fill(NaturalBiome.Corrupted);
    expect(restore(world).entities.get(a.id)!.components.citizen!.work!.cargo).toEqual(a.components.citizen!.work!.cargo);
    for (const worker of [a, b]) { arrive(world, worker, market); continueVillageWork(world, worker); continueVillageWork(world, worker); }
    expect(stockOf(village, 'silver')).toBe(6); expect(stockOf(village, 'stone')).toBe(6);
    expect(stockOf(village, 'commonMetal')).toBe(0);
  });

  it('requires a route and storage for the whole mixed batch', () => {
    const { world, store, village, workers: [worker], ore } = fixture();
    store.limits = { silver: 20 }; store.goods = { provisions: 100 }; syncStocks(village);
    expect(assignVillageWork(world, worker)).toBe(false);
    expect(ore.components.stone!.remaining).toBe(SILVER.deposit);
    store.limits = {}; setFood(village, 100);
    for (let y = 0; y < world.terrain.height; y++) world.terrain.set(23, y, Terrain.Water);
    expect(assignVillageWork(world, worker)).toBe(false);
    expect(ore.components.stone!.claims).toHaveLength(0);
  });

  it('keeps mining time on pause and reload; death loses both carried products', () => {
    const { world, workers: [worker], ore, village } = fixture();
    assignVillageWork(world, worker); arrive(world, worker, ore); continueVillageWork(world, worker);
    world.paused = true;
    const before = world.snapshot(); continueVillageWork(world, worker); world.step();
    expect(world.snapshot()).toEqual(before);
    const loaded = restore(world), miner = loaded.entities.get(worker.id)!;
    expect(miner.components.citizen!.work!.progress).toBe(0.5);
    loaded.paused = false;
    for (let i = 0; i < 7; i++) continueVillageWork(loaded, miner);
    const goods = cargoContents(miner.components.citizen!.work!.cargo!);
    loaded.remove(miner.id);
    expect(loaded.society.villages.find(v => v.id === village.id)!.economy!.lost).toMatchObject(goods);
    expect(sourceContents(loaded.entities.get(ore.id)!)).toEqual({ silver: 20, stone: 20 });
  });

  it('does not spend ordinary ore in place of silver and releases cancelled reservations', () => {
    const { world, village, store, worker, recipient, workshop } = craftFixture();
    const order = requestCraft(world, recipient, 'weapon', { preferredKinds: ['sword'] })!;
    expect(order.recipe).toBe('silver-sword');
    store.goods.silver = 0; store.goods.commonMetal = 100; syncStocks(village);
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    expect(order.recipe).toBe('silver-sword'); expect(order.reason).toBe('materials');
    expect(store.reservations).toEqual([]); expect(stockOf(village, 'commonMetal')).toBe(100);
    deposit(village, { silver: 1 });
    expect(startCraft(world, worker, order, workshop)).toBe(true);
    expect(store.reservations.some(r => r.claimant === worker.id && r.goods.silver === 1)).toBe(true);
    cancelCraft(world, order);
    expect(store.reservations).toEqual([]); expect(stockOf(village, 'silver')).toBe(1);
  });

  it('gates silver by local experience and rejects locked unpaid work without charging materials', () => {
    const { world, village, worker, recipient, workshop, store } = craftFixture();
    const order = requestCraft(world, recipient, 'weapon', { preferredKinds: ['sword'] })!;
    deposit(village, { commonMetal: 100 });
    economyOf(village).metalworking = SILVER.requires - 1;
    expect(metalRecipeAllowed(world, village.id, order.recipe)).toBe(false);
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    expect(order.reason).toBe('knowledge'); expect(store.reservations).toEqual([]);
    expect(stockOf(village, 'silver')).toBe(2);
    expect(stockOf(village, 'commonMetal')).toBe(100); expect(order.recipe).toBe('silver-sword');
  });

  it('still replaces a waiting silver weapon with an unlocked, available iron upgrade', () => {
    const { world, village, worker, recipient, workshop } = craftFixture();
    const order = requestCraft(world, recipient, 'weapon', { preferredKinds: ['sword'] })!;
    economyOf(village).metalworking = 10; deposit(village, { commonMetal: 3 });
    expect(startCraft(world, worker, order, workshop)).toBe(true);
    expect(order.recipe).toBe('iron-sword'); expect(order.inputs).toEqual({ commonMetal: 3 });
    expect(stockOf(village, 'silver')).toBe(2);
    cancelCraft(world, order); expect(stockOf(village, 'commonMetal')).toBe(3);
  });

  it('does not spend silver or reserve it when the ring is missing its gem', () => {
    const { world, village, store, worker, recipient, workshop } = craftFixture();
    const order = requestCraft(world, recipient, 'ring')!;
    store.goods.gems = 0; syncStocks(village);
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    expect(order.recipe).toBe('silver-ring'); expect(order.inputs).toEqual({ silver: 1, gems: 1 });
    expect(order.reason).toBe('materials'); expect(store.reservations).toEqual([]);
    expect(stockOf(village, 'silver')).toBe(2);
    expect(restore(world).crafting.orders.find(o => o.id === order.id)?.paid).toBe(false);
  });

  it('keeps accessory gems, progress, payment and the individual item through pause and saving', () => {
    const { world, village, worker, recipient, workshop } = craftFixture();
    const order = requestCraft(world, recipient, 'ring')!;
    expect(order.recipe).toBe('silver-ring'); expect(order.inputs).toEqual({ silver: 1, gems: 1 });
    expect(startCraft(world, worker, order, workshop)).toBe(true);
    arrive(world, worker, workshop); continueCraft(world, worker);
    world.paused = true; continueCraft(world, worker); expect(order.progress).toBe(0.5);
    const loaded = restore(world), maker = loaded.entities.get(worker.id)!;
    loaded.paused = false; for (let i = 0; i < 8; i++) continueCraft(loaded, maker);
    const v = loaded.society.villages.find(v => v.id === village.id)!;
    expect(stockOf(v, 'silver')).toBe(1); expect(stockOf(v, 'gems')).toBe(1);
    expect(loaded.equipment.items).toHaveLength(1);
    expect(restore(loaded).equipment.items).toEqual(loaded.equipment.items);
  });

  it.each(['sword', 'axe', 'hammer', 'spear', 'bow', 'helmet', 'armor', 'boots', 'ring', 'amulet'])('applies and removes %s effects for humans and elves equally', kind => {
    const { world, workers: [human] } = fixture();
    const elf = world.spawn('core:elf', { x: 36, y: 20 })!; elf.components.person!.age = 30;
    const d = EQUIPMENT[`silver-${kind}`], before = equipmentBonuses(world, human);
    for (const e of [human, elf]) createItem(world, d.id, { kind: 'equipped', entityId: e.id });
    const bonuses = equipmentBonuses(world, human);
    expect(bonuses).toEqual(equipmentBonuses(world, elf));
    expect(bonuses.damage).toBe(d.damage); expect(bonuses.armor).toBe(d.armor); expect(bonuses.critical).toBe(d.critical ?? 0);
    expect(equippedItem(world, human.id, d.slot)?.definition).toBe(d.id);
    expect(removeEquippedItem(world, human, d.slot)).toBe(true);
    expect(equipmentBonuses(world, human)).toEqual(before);
  });

  it('compares the matching slot and effective modifiers instead of material price', () => {
    const { world, workers: [worker] } = fixture();
    const old = createItem(world, 'silver-sword', { kind: 'equipped', entityId: worker.id });
    const better = createItem(world, 'bronze-sword', { kind: 'ground', ...worker.components.position! }, undefined, { strength: 5 });
    expect(itemValue(better)).toBeLessThanOrEqual(itemValue(old));
    expect(replacementReason(world, worker, better)).toBeUndefined();
    expect(equipItem(world, worker, better)).toBe(true);
    expect(equipmentBonuses(world, worker).damage).toBe(11);
    expect(equipmentScore('silver-sword')).toBeGreaterThan(equipmentScore('bronze-sword'));
    expect(equipmentScore('silver-sword')).toBeLessThan(equipmentScore('iron-sword'));
    expect(EQUIPMENT['silver-sword'].durability).toBeLessThan(EQUIPMENT['bronze-sword'].durability);
  });

  it('migrates existing worlds without silver rewards or generation and rejects invalid deposits', () => {
    const { world, village, ore } = fixture(); world.remove(ore.id);
    const old = world.snapshot(); old.version = 41; delete old.society.villages[0].economy!.stocks.silver;
    const loaded = new World(world.seed, world.registry, decodeSave(old, world.registry), []);
    expect(stockOf(loaded.society.villages.find(v => v.id === village.id)!, 'silver')).toBe(0);
    expect(loaded.snapshot().entities).toEqual(old.entities); expect(loaded.rng.state).toBe(old.rngState);
    const source = loaded.spawn('core:silver-ore', { x: 32, y: 24 })!; source.components.stone!.origin = 'placed';
    const bad = loaded.snapshot();
    bad.entities.find(e => e.id === source.id)!.components.stone!.remaining = SILVER.deposit + 1;
    expect(() => decodeSave(bad, world.registry)).toThrow();
  });

  it('validates the saved silver identity and original biome without changing it when terrain is repainted', () => {
    const { world, ore } = fixture();
    const invalid = world.snapshot(); invalid.entities.find(e => e.id === ore.id)!.typeId = 'core:stone';
    expect(() => decodeSave(invalid, world.registry)).toThrow();
    ore.components.stone!.origin = 'natural'; expect(() => restore(world)).toThrow();
    ore.components.stone!.biome = NaturalBiome.Desert;
    world.terrain.setBiome(32, 24, NaturalBiome.Corrupted);
    expect(restore(world).entities.get(ore.id)!.components.stone).toMatchObject({ biome: NaturalBiome.Desert, origin: 'natural', remaining: 24 });
    ore.components.stone!.origin = 'meteorite'; expect(() => restore(world)).toThrow();
  });

  it('preserves paid legacy silver items and existing stock without minting replacements', () => {
    const { world, village, recipient } = craftFixture();
    const item = createItem(world, 'silver-armor', { kind: 'equipped', entityId: recipient.id });
    item.maxDurability = 100; item.durability = 45;
    const old = world.snapshot(); old.version = 41;
    const loaded = new World(world.seed, world.registry, decodeSave(old, world.registry), []);
    expect(loaded.equipment.items).toEqual([item]); expect(stockOf(loaded.society.villages[0], 'silver')).toBe(stockOf(village, 'silver'));
    expect(restore(loaded).equipment.items).toEqual([item]);
  });

  it('releases an old unpaid silver order when its workshop lacks the required experience', () => {
    const { world, village, worker, recipient, workshop } = craftFixture();
    const order = requestCraft(world, recipient, 'weapon', { preferredKinds: ['sword'] })!;
    startCraft(world, worker, order, workshop); arrive(world, worker, workshop); continueCraft(world, worker);
    const old = world.snapshot(); old.version = 41;
    old.society.villages.find(v => v.id === village.id)!.economy!.metalworking = 0;
    const loaded = new World(world.seed, world.registry, decodeSave(old, world.registry), []);
    expect(loaded.crafting.orders.find(o => o.id === order.id)!.reason).toBe('knowledge');
    const v = loaded.society.villages.find(v => v.id === village.id)!;
    expect(storesOf(v).flatMap(s => s.reservations)).toEqual([]);
    expect(stockOf(v, 'silver')).toBe(2); expect(loaded.equipment.items).toHaveLength(0);
  });
});
