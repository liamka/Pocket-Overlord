import { describe, expect, it } from 'vitest';
import { canPlaceCommonMetal } from '../src/content/common-metals';
import { createRegistry } from '../src/content/defaults';
import { beginProject, cancelBuildingProject, HOUSE_UPGRADE } from '../src/core/buildings';
import { COMMON_METAL_MATERIALS } from '../src/core/common-metals';
import { requestCraft, selectRecipe } from '../src/core/crafting';
import { depositContents, reserveDeposit } from '../src/core/deposits';
import { createItem } from '../src/core/equipment';
import { EQUIPMENT } from '../src/core/equipment-catalog';
import { reserveTree } from '../src/core/forestry';
import { NaturalBiome } from '../src/core/natural-biomes';
import { cargoContents, deposit, inTransit, stockOf } from '../src/core/resource-ledger';
import { extractSource } from '../src/core/resource-sources';
import { initializeStorage, reserveGoods, storesOf } from '../src/core/stockpiles';
import { Terrain, type Entity } from '../src/core/types';
import { economyOf } from '../src/core/village-life';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { cancelCraft, continueCraft, startCraft } from '../src/systems/crafting';
import { continueVillageWork } from '../src/systems/economy';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(world, home);
  const workshop = world.spawn('core:workshop', { x: 24, y: 24 })!;
  workshop.components.workplace!.villageId = village.id;
  const worker = world.spawn('core:person', { x: 22.3, y: 24 })!, other = world.spawn('core:person', { x: 18, y: 20 })!;
  for (const e of [worker, other]) { Object.assign(e.components.person!, { age: 30, homeId: home.id }); e.components.citizen!.villageId = village.id; }
  initializeStorage(world, village); deposit(village, { provisions: 80 });
  return { world, home, village, workshop, worker, other };
}
function arrive(world: World, e: Entity, x: number, y: number): void {
  Object.assign(e.components.position!, { x, y }); world.spatial.update(e); e.components.citizen!.path = [];
}
function mining(worker: Entity, source: Entity): void {
  Object.assign(worker.components.citizen!, { task: 'work', targetId: source.id, path: [], work: { good: 'commonMetal', progress: 4, cargo: null } });
}
const reload = (world: World): World => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));

describe('common ore and its four equipment materials', () => {
  it('uses a separate seeded distribution without changing stone or the simulation random stream', () => {
    const a = new World(12345), b = new World(12345), without = createRegistry();
    without.entities.delete('core:common-metal');
    const original = new World(12345, without);
    expect([...a.query('commonMetal')].length).toBeGreaterThan(0);
    expect([...a.query('commonMetal')]).toEqual([...b.query('commonMetal')]);
    expect([...a.query('stone')]).toEqual([...original.query('stone')]);
    expect(a.rng.state).toBe(original.rng.state);
    for (const e of a.query('commonMetal')) expect([NaturalBiome.Crystal, NaturalBiome.Corrupted]).not.toContain(a.terrain.biomeAt(e.components.position!.x, e.components.position!.y).id);
  });
  it.each([NaturalBiome.Crystal, NaturalBiome.Corrupted])('never generates ordinary ore in biome %i', biome => {
    expect([...new World(12345, createRegistry(), undefined, undefined, undefined, biome).query('commonMetal')]).toHaveLength(0);
    const world = flatWorld(), p = { x: 24, y: 24 };
    world.terrain.setBiome(p.x, p.y, biome); expect(canPlaceCommonMetal(world, p)).toBe(false);
  });
  it('keeps an existing ore identity after a biome change and destroys flooded deposits', () => {
    const world = flatWorld(), ore = world.spawn('core:common-metal', { x: 24, y: 24 })!;
    const original = structuredClone(ore.components.commonMetal);
    world.terrain.setBiome(24, 24, NaturalBiome.Crystal);
    expect(reload(world).entities.get(ore.id)!.components.commonMetal).toEqual(original);
    world.terrain.set(24, 24, Terrain.Water); world.tick = 29; world.step();
    expect(world.entities.has(ore.id)).toBe(false);
  });
  it('carries both products only after arrival, preserves the sum on reload and delivers once', () => {
    const { world, worker, village, home } = fixture(), ore = world.spawn('core:common-metal', { x: 28, y: 24 })!;
    const before = depositContents(ore.components.commonMetal!);
    mining(worker, ore); expect(reserveDeposit(world, ore, worker)).toBe(true);
    expect(extractSource(world, worker, ore)).toBe(false);
    arrive(world, worker, 26.3, 24); expect(extractSource(world, worker, ore)).toBe(true);
    const cargo = cargoContents(worker.components.citizen!.work!.cargo!);
    expect(cargo).toEqual({ commonMetal: 4, stone: 2 }); expect(stockOf(village, 'commonMetal')).toBe(0);
    const copy = reload(world), restored = copy.entities.get(worker.id)!, owner = copy.society.villages[0];
    const rest = depositContents(copy.entities.get(ore.id)!.components.commonMetal!);
    expect(rest.commonMetal! + inTransit(copy, village.id).commonMetal!).toBe(before.commonMetal);
    expect(rest.stone! + inTransit(copy, village.id).stone!).toBe(before.stone);
    arrive(copy, restored, 13.8, 20); Object.assign(restored.components.citizen!, { task: 'deliver', targetId: home.id });
    continueVillageWork(copy, restored); continueVillageWork(copy, restored);
    expect(stockOf(owner, 'commonMetal')).toBe(4); expect(stockOf(owner, 'stone')).toBe(2);
    expect(inTransit(copy, owner.id)).toEqual({}); expect(() => reload(copy)).not.toThrow();
  });
  it('reserves the final mixed batch once and releases it when a miner dies', () => {
    const { world, worker, other } = fixture(), ore = world.spawn('core:common-metal', { x: 28, y: 24 })!;
    ore.components.commonMetal!.remaining = 4;
    mining(worker, ore); mining(other, ore);
    expect(reserveDeposit(world, ore, worker)).toBe(true); expect(reserveDeposit(world, ore, other)).toBe(false);
    world.remove(worker.id); expect(reserveDeposit(world, ore, other)).toBe(true);
    arrive(world, other, 26.3, 24); expect(extractSource(world, other, ore)).toBe(true);
    expect(world.entities.has(ore.id)).toBe(false); expect(extractSource(world, other, ore)).toBe(false);
  });
  it('records both products as lost when their carrier dies and does nothing while paused', () => {
    const { world, worker, village } = fixture(), ore = world.spawn('core:common-metal', { x: 28, y: 24 })!;
    mining(worker, ore); arrive(world, worker, 26.3, 24);
    world.paused = true; const before = ore.components.commonMetal!.remaining;
    expect(extractSource(world, worker, ore)).toBe(false); expect(ore.components.commonMetal!.remaining).toBe(before);
    world.paused = false; expect(extractSource(world, worker, ore)).toBe(true); world.remove(worker.id);
    expect(village.economy!.lost).toMatchObject({ commonMetal: 4, stone: 2 }); expect(stockOf(village, 'commonMetal')).toBe(0);
  });
  it('extracts the same raw ore from crystal trees where ordinary deposits are forbidden', () => {
    const { world, worker, village } = fixture(); economyOf(village).forestPolicy = 'intensive';
    world.terrain.setBiome(28, 24, NaturalBiome.Crystal);
    expect(canPlaceCommonMetal(world, { x: 28, y: 24 })).toBe(false);
    const tree = world.spawn('core:tree', { x: 28, y: 24 })!;
    Object.assign(worker.components.citizen!, { task: 'work', targetId: tree.id, work: { good: 'wood', progress: 4, cargo: null } });
    arrive(world, worker, 26.3, 24); expect(reserveTree(world, tree, worker)).toBe(true);
    expect(extractSource(world, worker, tree)).toBe(true);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ wood: 5, commonMetal: 1, stone: 1, gems: 1 });
    expect(world.entities.has(tree.id)).toBe(false); expect([...world.query('commonMetal')]).toHaveLength(0);
    expect(() => reload(world)).not.toThrow();
  });
  it('gates each metal by experience, keeps silver separate and never rerolls an equal tier', () => {
    const { world, other, village } = fixture(); deposit(village, { commonMetal: 100 });
    for (const [material, d] of Object.entries(COMMON_METAL_MATERIALS)) {
      economyOf(village).metalworking = d.requires;
      expect(selectRecipe(world, other, 'weapon')).toBe(`${material}-axe`);
      expect(EQUIPMENT[`${material}-axe`].recipe.inputs).toEqual({ commonMetal: d.cost });
      expect(EQUIPMENT[`${material}-axe`].durability).toBe(d.durability);
      if (d.requires) { economyOf(village).metalworking = d.requires - 1; expect(selectRecipe(world, other, 'weapon')).not.toBe(`${material}-axe`); }
    }
    expect(EQUIPMENT['silver-axe'].recipe.inputs).toEqual({ silver: 1 });
    economyOf(village).metalworking = 0; createItem(world, 'copper-axe', { kind: 'equipped', entityId: other.id });
    expect(selectRecipe(world, other, 'weapon')).not.toBe('copper-axe');
    expect(stockOf(village, 'commonMetal')).toBe(100);
  });
  it('credits workshop experience once after payment and preserves unfinished work on reload', () => {
    const { world, worker, other, village, workshop } = fixture(); deposit(village, { commonMetal: 4 });
    economyOf(village).metalworking = 3;
    const order = requestCraft(world, other, 'weapon')!;
    expect(order.recipe).toBe('copper-axe'); expect(startCraft(world, worker, order, workshop)).toBe(true);
    worker.components.citizen!.path = []; continueCraft(world, worker);
    const copy = reload(world), maker = copy.entities.get(worker.id)!;
    for (let i = 0; i < 8; i++) continueCraft(copy, maker);
    expect(copy.society.villages[0].economy!.metalworking).toBe(4);
    expect(stockOf(copy.society.villages[0], 'commonMetal')).toBe(3);
    cancelCraft(copy, copy.crafting.orders[0]); continueCraft(copy, maker);
    expect(copy.equipment.items).toHaveLength(1); expect(reload(copy).society.villages[0].economy!.metalworking).toBe(4);
  });
  it('shares the final ore between building and weapon reservations without double spending', () => {
    const { world, home, worker, other, workshop, village } = fixture();
    deposit(village, { wood: 12, stone: 8, commonMetal: 2 });
    const order = requestCraft(world, other, 'weapon')!;
    // Keep the recipient's home operational while a different house is improved.
    const site = world.spawn('core:house', { x: 32, y: 20 })!; site.components.dwelling!.villageId = village.id;
    beginProject(site, 'upgrade'); expect(reserveGoods(world, village, HOUSE_UPGRADE, site.id)).toBe(true);
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    cancelBuildingProject(world, site); expect(startCraft(world, worker, order, workshop)).toBe(true);
    beginProject(home, 'upgrade'); expect(reserveGoods(world, village, HOUSE_UPGRADE, home.id)).toBe(false);
    cancelBuildingProject(world, home); worker.components.citizen!.path = [];
    for (let i = 0; i < 8; i++) continueCraft(world, worker);
    expect(stockOf(village, 'commonMetal')).toBe(1); expect(village.economy!.spent?.commonMetal).toBe(1);
  });
  it('reconsiders an unaffordable waiting recipe when a stronger common metal becomes available', () => {
    const { world, worker, other, village, workshop } = fixture();
    createItem(world, 'copper-axe', { kind: 'equipped', entityId: other.id });
    const order = requestCraft(world, other, 'weapon')!;
    expect(order.inputs.commonMetal ?? 0).toBe(0);
    economyOf(village).metalworking = 4; deposit(village, { commonMetal: 2 });
    expect(startCraft(world, worker, order, workshop)).toBe(true);
    expect(order.recipe).toBe('bronze-axe'); worker.components.citizen!.path = [];
    for (let i = 0; i < 8; i++) continueCraft(world, worker);
    expect(world.equipment.items.filter(i => i.definition === 'bronze-axe')).toHaveLength(1);
    expect(stockOf(village, 'commonMetal')).toBe(0);
  });
  it('migrates old worlds without ore generation, preserving stone, tools and the former metal id', () => {
    const { world, village, worker } = fixture(); deposit(village, { stone: 7, tools: 3 });
    const old = world.snapshot(); old.version = 39;
    const loaded = new World(world.seed, world.registry, decodeSave(old, world.registry));
    expect(stockOf(loaded.society.villages[0], 'commonMetal')).toBe(0);
    expect(stockOf(loaded.society.villages[0], 'stone')).toBe(7); expect(stockOf(loaded.society.villages[0], 'tools')).toBe(3);
    expect([...loaded.query('commonMetal')]).toHaveLength(0);
    deposit(village, { commonMetal: 2 });
    worker.components.citizen!.work = { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 5, villageId: village.id, byproducts: { commonMetal: 1, stone: 1, gems: 1 } } };
    const legacy = world.snapshot(); legacy.version = 39;
    const rename = (bundle: object): void => { const b = bundle as Record<string, number>; b.metal = b.commonMetal; delete b.commonMetal; };
    rename(legacy.society.villages[0].economy!.stocks); rename(storesOf(legacy.society.villages[0])[0].goods);
    rename(legacy.entities.find(e => e.id === worker.id)!.components.citizen!.work!.cargo!.byproducts!);
    const restored = new World(world.seed, world.registry, decodeSave(legacy, world.registry));
    expect(stockOf(restored.society.villages[0], 'commonMetal')).toBe(2);
    expect(inTransit(restored, village.id).commonMetal).toBe(1);
    expect(reload(restored).snapshot()).toEqual(restored.snapshot());
  });
  it('rejects corrupt remaining ore, experience and an inaccessible active recipe', () => {
    const { world, village, other } = fixture(), ore = world.spawn('core:common-metal', { x: 28, y: 24 })!;
    const snapshot = world.snapshot(); snapshot.entities.find(e => e.id === ore.id)!.components.commonMetal!.remaining = 3;
    expect(() => decodeSave(snapshot, world.registry)).toThrow();
    economyOf(village).metalworking = -1; expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
    economyOf(village).metalworking = 20; deposit(village, { commonMetal: 20 }); requestCraft(world, other, 'weapon');
    const invalid = world.snapshot(); invalid.society.villages[0].economy!.metalworking = 0;
    expect(() => decodeSave(invalid, world.registry)).toThrow();
  });
});
