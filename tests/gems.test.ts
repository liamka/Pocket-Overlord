import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { NaturalBiome } from '../src/core/natural-biomes';
import { GEM_BIOMES, GEMS, seedGems, spawnGemSource } from '../src/core/gems';
import { bundleLoad, SOURCE_PROFILES } from '../src/core/resources';
import { cargoContents, deposit, inTransit, stockOf } from '../src/core/resource-ledger';
import { extractSource } from '../src/core/resource-sources';
import { initializeStorage, storesOf, syncStocks } from '../src/core/stockpiles';
import { EQUIPMENT } from '../src/core/equipment-catalog';
import { requestCraft } from '../src/core/crafting';
import { FOREST, newTree, reserveTree } from '../src/core/forestry';
import { economyOf } from '../src/core/village-life';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { operational } from '../src/core/buildings';
import { decodeSave } from '../src/persistence/schema';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { continueCraft, maintainCrafting, startCraft } from '../src/systems/crafting';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { construction, planBuilding } from '../src/systems/construction';
import { flatWorld, setFood, villageWorld } from './helpers';

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
function arrive(world: World, worker: Entity, target: Entity): void {
  Object.assign(worker.components.position!, { x: target.components.position!.x - 1.8, y: target.components.position!.y });
  worker.components.citizen!.path = []; world.spatial.update(worker);
}
function mine(world: World, worker: Entity, source: Entity): void {
  Object.assign(worker.components.citizen!, { task: 'work', targetId: source.id, work: { good: 'gems', progress: 4, cargo: null } });
  arrive(world, worker, source);
}

describe('finite gems and accessory demand', () => {
  it('scatters rare sources reproducibly without advancing simulation randomness or reseeding on load', () => {
    const a = new World(781, undefined, undefined, undefined, undefined, NaturalBiome.Mushroom);
    const b = new World(781, undefined, undefined, undefined, undefined, NaturalBiome.Mushroom);
    const sources = [...a.query('gemSource')];
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.length).toBeLessThan([...a.query('stone')].length);
    expect(sources).toEqual([...b.query('gemSource')]);
    expect(sources.every(e => GEM_BIOMES.includes(e.components.gemSource!.biome))).toBe(true);
    for (const e of sources) a.remove(e.id);
    expect([...reload(a).query('gemSource')]).toEqual([]);
    const rng = b.rng.state; seedGems(b); expect(b.rng.state).toBe(rng);
  });
  it('allows mine ore outside the natural list and preserves its origin across terrain changes and reloads', () => {
    const world = flatWorld(), p = { x: 20, y: 20 };
    expect(spawnGemSource(world, p)).toBeUndefined();
    const ore = spawnGemSource(world, p, 'mine')!;
    world.terrain.setBiome(20, 20, NaturalBiome.Candy);
    const copy = reload(world);
    expect(copy.entities.get(ore.id)!.components.gemSource).toEqual(ore.components.gemSource);
    expect(copy.entities.get(ore.id)!.components.gemSource!.origin).toBe('mine');
    expect(world.registry.tools.has('core:gem-ore')).toBe(false);
    expect(spawnGemSource(world, { x: 25, y: 25 }, 'natural', 'plant')).toBeUndefined();
    const raw = world.snapshot(); raw.entities.find(e => e.id === ore.id)!.components.gemSource!.origin = 'natural';
    expect(() => decodeSave(raw, world.registry)).toThrow();
  });
  it('depletes one mixed batch only after work, delivers physically and loses a dead carrier only once', () => {
    const { world, village, market, worker } = fixture(), ore = spawnGemSource(world, { x: 28, y: 20 }, 'mine')!;
    mine(world, worker, ore); worker.components.citizen!.work!.progress = 3.5;
    expect(extractSource(world, worker, ore)).toBe(false);
    worker.components.citizen!.work!.progress = 4;
    expect(extractSource(world, worker, ore)).toBe(true);
    expect(extractSource(world, worker, ore)).toBe(false);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ gems: 1, stone: 1 });
    expect(stockOf(village, 'gems')).toBe(0);
    expect(ore.components.gemSource!.remaining).toBe(GEMS.batches - 1);
    arrive(world, worker, market); Object.assign(worker.components.citizen!, { task: 'deliver', targetId: market.id });
    continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(stockOf(village, 'gems')).toBe(1); expect(stockOf(village, 'stone')).toBe(1);
    mine(world, worker, ore); extractSource(world, worker, ore);
    const copy = reload(world), carrier = copy.entities.get(worker.id)!;
    copy.remove(carrier.id); copy.remove(carrier.id);
    expect(inTransit(copy, village.id).gems ?? 0).toBe(0);
    expect(copy.society.villages[0].economy!.lost).toMatchObject({ gems: 1, stone: 1 });
    expect(stockOf(copy.society.villages[0], 'gems')).toBe(1);
  });
  it('harvests crystal plants and trees using their shared profiles without a second award', () => {
    const { world, village, worker } = fixture();
    world.terrain.setBiome(28, 20, NaturalBiome.Crystal);
    const plant = spawnGemSource(world, { x: 28, y: 20 }, 'natural', 'plant')!;
    mine(world, worker, plant); expect(extractSource(world, worker, plant)).toBe(true);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual(SOURCE_PROFILES.crystalPlant.outputs);
    expect(extractSource(world, worker, plant)).toBe(false);
    const tree = world.spawn('core:tree', { x: 20, y: 30 })!;
    tree.components.tree = newTree(NaturalBiome.Crystal, 0, 'natural', FOREST.mature);
    economyOf(village).forestPolicy = 'intensive';
    Object.assign(worker.components.citizen!, { task: 'work', targetId: tree.id, work: { good: 'wood', progress: 4, cargo: null } }); arrive(world, worker, tree);
    expect(reserveTree(world, tree, worker)).toBe(true); expect(extractSource(world, worker, tree)).toBe(true);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual(SOURCE_PROFILES.crystalTree.outputs);
    expect(extractSource(world, worker, tree)).toBe(false);
  });
  it('retains the whole gem batch if storage fills during delivery', () => {
    const { world, village, market, worker } = fixture(), ore = spawnGemSource(world, { x: 28, y: 20 }, 'mine')!;
    mine(world, worker, ore); extractSource(world, worker, ore);
    for (const store of storesOf(village)) store.goods.provisions = (store.goods.provisions ?? 0) + store.capacity - bundleLoad(store.goods).volume - 0.5;
    syncStocks(village);
    arrive(world, worker, market); Object.assign(worker.components.citizen!, { task: 'deliver', targetId: market.id });
    continueVillageWork(world, worker);
    expect(stockOf(village, 'gems')).toBe(0); expect(stockOf(village, 'stone')).toBe(0);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ gems: 1, stone: 1 });
  });
  it('keeps basic materials untouched without gems and cannot reserve the last gem twice', () => {
    const { world, village, workshop, worker, workers } = fixture();
    deposit(village, { bone: 2 });
    const first = requestCraft(world, workers[2], 'ring')!, second = requestCraft(world, workers[3], 'amulet')!;
    expect(startCraft(world, worker, first, workshop)).toBe(false);
    expect(stockOf(village, 'bone')).toBe(2); expect(world.equipment.items).toEqual([]);
    deposit(village, { gems: 1 }); arrive(world, worker, workshop);
    const otherShop = world.spawn('core:workshop', { x: 24, y: 30 })!; otherShop.components.workplace!.villageId = village.id;
    expect(startCraft(world, worker, first, workshop)).toBe(true);
    expect(startCraft(world, workers[1], second, otherShop)).toBe(false);
    const copy = reload(world); copy.tick = first.reservedUntil!; maintainCrafting(copy);
    expect(copy.crafting.orders[0].state).toBe('cancelled');
    expect(storesOf(copy.society.villages[0]).flatMap(s => s.reservations)).toEqual([]);
    for (let n = 0; n < 8; n++) continueCraft(world, worker);
    expect(stockOf(village, 'gems')).toBe(0); expect(stockOf(village, 'bone')).toBe(1);
    expect(world.equipment.items).toHaveLength(1);
    for (const d of Object.values(EQUIPMENT).filter(d => d.slot === 'ring' || d.slot === 'amulet')) expect(d.recipe.inputs.gems).toBe(1);
    expect(EQUIPMENT['stone-sword'].recipe.inputs.gems).toBeUndefined();
  });
  it('leaves food available without gems and releases reserves after worker loss', () => {
    const { world, village, worker, workers, workshop } = fixture();
    setFood(village, 0);
    const field = world.spawn('core:farm', { x: 18, y: 30 })!; Object.assign(field.components.farm!, { villageId: village.id, grain: 6 });
    requestCraft(world, worker, 'ring');
    expect(assignVillageWork(world, worker)).toBe(true); expect(worker.components.citizen!.work!.good).toBe('grain');
    arrive(world, worker, field); continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(worker.components.citizen!.work!.cargo?.good).toBe('grain');
    deposit(village, { bone: 1, gems: 1 });
    const order = requestCraft(world, workers[2], 'amulet')!;
    expect(startCraft(world, workers[1], order, workshop)).toBe(true);
    world.remove(workers[1].id); maintainCrafting(world);
    expect(storesOf(village).flatMap(s => s.reservations)).toEqual([]); expect(stockOf(village, 'gems')).toBe(1);
  });
  it('finishes basic housing while accessory orders wait for missing gems', () => {
    const { world, village, worker, workers } = fixture();
    deposit(village, { wood: 4 }); requestCraft(world, workers[2], 'ring');
    const site = planBuilding(world, 'core:house', { x: 20, y: 32 }, village, worker)!;
    expect(site).toBeDefined(); arrive(world, worker, site);
    for (let n = 0; n < 360; n++) { world.tick++; construction(world, STEP); }
    expect(operational(site)).toBe(true); expect(stockOf(village, 'wood')).toBe(0);
    expect(stockOf(village, 'gems')).toBe(0); expect(world.equipment.items).toEqual([]);
  });
  it('does not spend or mine while paused or across an inaccessible bank', () => {
    const { world, worker } = fixture(), ore = spawnGemSource(world, { x: 28, y: 20 }, 'mine')!;
    mine(world, worker, ore); world.paused = true;
    expect(extractSource(world, worker, ore)).toBe(false); world.paused = false;
    world.terrain.set(27, 20, Terrain.Water);
    expect(extractSource(world, worker, ore)).toBe(false); expect(ore.components.gemSource!.remaining).toBe(GEMS.batches);
  });
  it('migrates old active reservations without generating new deposits or stock', () => {
    const { world, worker, workers, village, workshop } = fixture(); deposit(village, { bone: 1, gems: 1 });
    const order = requestCraft(world, workers[2], 'ring')!; startCraft(world, worker, order, workshop);
    const raw = world.snapshot(); raw.version = 40; delete raw.crafting!.orders[0].reservedUntil;
    const loaded = decodeSave(raw, world.registry);
    expect(loaded.entities.some(e => e.components.gemSource)).toBe(false);
    expect(loaded.crafting!.orders[0].reservedUntil).toBe(world.tick + GEMS.reservationTicks);
    expect(loaded.society.villages[0].economy!.stocks.gems).toBe(1);
  });
});

function tradeFixture() {
  const world = villageWorld(), [from, to] = world.society.villages;
  for (const v of [from, to]) { initializeStorage(world, v); setFood(v, 60); }
  const tiles = Array.from({ length: 29 }, (_, i) => 26 * 48 + i + 8);
  for (const i of tiles) world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Road);
  world.society.roads = [{ a: from.id, b: to.id, tiles, built: tiles.length }];
  deposit(from, { gems: 4 });
  const recipient = [...world.query('citizen')].find(e => e.components.citizen!.villageId === to.id)!;
  recipient.components.person!.age = 30; requestCraft(world, recipient, 'ring');
  return { world, from, to };
}
describe('gem caravans', () => {
  it('requires a route, preserves in-transit ownership, and never compensates a destroyed shipment', () => {
    const { world, from, to } = tradeFixture(), road = world.society.roads[0];
    road.built--; expect(dispatchCaravan(world, from.id, to.id, 4, 'gems')).toBe(false); road.built++;
    expect(dispatchCaravan(world, from.id, to.id, 4, 'gems')).toBe(true);
    const wagon = [...world.query('caravan')][0], gems = wagon.components.caravan!.gems!;
    expect(gems).toBeGreaterThan(0); expect(stockOf(from, 'gems')).toBe(4 - gems); expect(stockOf(to, 'gems')).toBe(0);
    const copy = reload(world); copy.remove(wagon.id); copy.remove(wagon.id);
    expect(copy.society.villages[0].economy!.lost!.gems).toBe(gems);
    expect(stockOf(copy.society.villages[1], 'gems')).toBe(0);
    expect(inTransit(copy, from.id).gems ?? 0).toBe(0);
  });
  it('keeps gems through a blocked route and transfers them only once after reopening', () => {
    const { world, from, to } = tradeFixture();
    expect(dispatchCaravan(world, from.id, to.id, 4, 'gems')).toBe(true);
    const wagon = [...world.query('caravan')][0], gems = wagon.components.caravan!.gems!;
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    world.tick = 1;
    for (let n = 0; n < 180; n++) caravans(world, 0.1);
    expect(stockOf(to, 'gems')).toBe(0); expect(wagon.components.caravan!.gems).toBe(gems);
    world.terrain.set(24, 26, Terrain.Road);
    for (let n = 0; n < 450; n++) caravans(world, 0.1);
    expect(stockOf(to, 'gems')).toBe(gems); expect(stockOf(from, 'gems') + stockOf(to, 'gems')).toBe(4);
  });
  it('uses common storage loss accounting without recreating destroyed gems', () => {
    const { world, village } = fixture(); deposit(village, { gems: 3 });
    const store = storesOf(village).find(s => s.goods.gems)!;
    for (const s of storesOf(village)) if (s !== store) { s.goods = {}; syncStocks(village); }
    world.remove(store.buildingId);
    expect(stockOf(village, 'gems')).toBe(0); expect(village.economy!.lost!.gems).toBe(3);
    expect(stockOf(reload(world).society.villages[0], 'gems')).toBe(0);
  });
});
