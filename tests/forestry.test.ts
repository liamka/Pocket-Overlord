import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain, type Entity } from '../src/core/types';
import { NaturalBiome } from '../src/core/natural-biomes';
import { FOREST, fellingProblem, newTree, reserveTree, treeYield } from '../src/core/forestry';
import { beginProject } from '../src/core/buildings';
import { EQUIPMENT } from '../src/core/equipment-catalog';
import { economyOf } from '../src/core/village-life';
import { cargoContents, deposit, stockOf } from '../src/core/resource-ledger';
import { extractSource } from '../src/core/resource-sources';
import { consumeReservation, initializeStorage, reserveGoods, storesOf } from '../src/core/stockpiles';
import { decodeSave } from '../src/persistence/schema';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { forestry } from '../src/systems/forestry';
import { requestCraft } from '../src/core/crafting';
import { startCraft } from '../src/systems/crafting';

function settlement() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!;
  const village = assignHouse(world, home); village.food = 40;
  const market = world.spawn('core:market', { x: 16, y: 28 })!;
  market.components.workplace!.villageId = village.id;
  const workers = [18, 20, 26, 28].map(x => world.spawn('core:person', { x, y: 21 })!);
  for (const e of workers) { e.components.person!.age = 25; e.components.citizen!.villageId = village.id; }
  initializeStorage(world, village); economyOf(village).forestPolicy = 'intensive';
  const tree = world.spawn('core:tree', { x: 20, y: 32 })!;
  tree.components.tree = newTree(NaturalBiome.Jungle, 0);
  return { world, village, home, market, tree, workers, worker: workers[0] };
}
function arrive(world: World, worker: Entity, target: Entity) {
  Object.assign(worker.components.position!, { x: target.components.position!.x - 1.8, y: target.components.position!.y });
  worker.components.citizen!.path = []; world.spatial.update(worker);
}
function cut(world: World, worker: Entity, tree: Entity) {
  Object.assign(worker.components.citizen!, { task: 'work', targetId: tree.id, work: { good: 'wood', progress: 0, cargo: null }, path: [] });
  arrive(world, worker, tree);
  return reserveTree(world, tree, worker);
}
const reload = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));

describe('forestry ownership and finite harvests', () => {
  it('reserves one tree, gives one mixed cargo and invalidates competing targets', () => {
    const { world, worker, workers, tree, village } = settlement(), rival = workers[1];
    expect(cut(world, worker, tree)).toBe(true);
    expect(cut(world, rival, tree)).toBe(false);
    rival.components.citizen!.work!.progress = 4;
    expect(extractSource(world, rival, tree)).toBe(false);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(world.entities.has(tree.id)).toBe(false);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ wood: 5, coconut: 1 });
    expect(worker.components.citizen!.work!.cargo!.villageId).toBe(village.id);
    expect(rival.components.citizen!.targetId).toBeNull();
    expect(extractSource(world, rival, tree)).toBe(false);
    expect(stockOf(village, 'wood')).toBe(0);
  });
  it.each([
    [NaturalBiome.Grassland, 0, { wood: 5 }], [NaturalBiome.Jungle, 1, { wood: 5, bananas: 1 }],
    [NaturalBiome.Lemon, 0, { wood: 5, lemons: 3 }], [NaturalBiome.Candy, 0, { wood: 5, candy: 3 }],
    [NaturalBiome.Mushroom, 0, { wood: 5, mushrooms: 1 }], [NaturalBiome.Permafrost, 0, { wood: 5, pineCones: 3 }],
    [NaturalBiome.Crystal, 0, { wood: 5, stone: 1, commonMetal: 1, gems: 1 }],
  ] as const)('keeps the harvest profile for biome %i after soil changes', (biome, variant, goods) => {
    const { world, tree } = settlement(); tree.components.tree = newTree(biome, variant);
    world.terrain.setBiome(20, 32, NaturalBiome.Desert); world.tick = 30; forestry(world);
    expect(treeYield(tree)).toEqual(goods);
    expect(reload(world).entities.get(tree.id)!.components.tree!.biome).toBe(biome);
  });
  it('cannot finish a destroyed or burning tree and cannot restore burnt wood', () => {
    const { world, worker, tree } = settlement(); cut(world, worker, tree);
    worker.components.citizen!.work!.progress = 3.5;
    tree.components.thermal!.burning = true; continueVillageWork(world, worker);
    expect(worker.components.citizen!.work?.cargo).toBeFalsy();
    tree.components.combustible!.fuel = 20; world.tick = 30; forestry(world);
    tree.components.thermal!.burning = false;
    expect(treeYield(tree)).toEqual({ wood: 2 });
    cut(world, worker, tree); world.remove(tree.id); continueVillageWork(world, worker);
    expect(worker.components.citizen!.work?.cargo).toBeFalsy();
  });
  it('hands the same identity to the living-plant integration without a harvest', () => {
    const { world, worker, tree, village } = settlement(); cut(world, worker, tree);
    const nextId = world.nextEntityId;
    const creature = world.awakenTree(tree.id, 'core:sheep');
    expect(creature).toBe(tree); expect(creature!.id).toBe(tree.id); expect(world.nextEntityId).toBe(nextId);
    expect([...world.query('tree')]).not.toContain(creature); expect([...world.query('animal')]).toContain(creature);
    expect(worker.components.citizen!.targetId).toBeNull(); expect(stockOf(village, 'wood')).toBe(0);
    expect(extractSource(world, worker, creature!)).toBe(false);
    expect(() => reload(world)).not.toThrow();
  });
  it('delivers a loaded mixed cargo once across reloads', () => {
    const { world, worker, tree, village } = settlement(); cut(world, worker, tree);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    const copy = reload(world), carrier = copy.entities.get(worker.id)!;
    const destination = copy.entities.get(carrier.components.citizen!.targetId!)!;
    arrive(copy, carrier, destination); continueVillageWork(copy, carrier); continueVillageWork(copy, carrier);
    const owner = copy.society.villages.find(v => v.id === village.id)!;
    expect(stockOf(owner, 'wood')).toBe(5); expect(stockOf(owner, 'coconut')).toBe(1);
    const again = reload(copy); continueVillageWork(again, again.entities.get(worker.id)!);
    expect(stockOf(again.society.villages[0], 'wood')).toBe(5);
  });
  it('preserves the entire cargo when storage fills after felling', () => {
    const { world, worker, tree, village } = settlement(); cut(world, worker, tree);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    for (const s of storesOf(village)) deposit(village, { stone: 2000 }, s.buildingId);
    const cargo = structuredClone(worker.components.citizen!.work!.cargo);
    arrive(world, worker, world.entities.get(worker.components.citizen!.targetId!)!);
    continueVillageWork(world, worker);
    expect(worker.components.citizen!.work!.cargo).toEqual(cargo); expect(stockOf(village, 'wood')).toBe(0);
  });
  it('cancels a claim after its worker changes settlement or dies', () => {
    const { world, worker, tree } = settlement(); cut(world, worker, tree);
    worker.components.citizen!.villageId = null; world.tick = 30; forestry(world);
    expect(tree.components.tree!.claim).toBeNull();
    world.remove(worker.id); expect(treeYield(tree)).toEqual({ wood: 5, coconut: 1 });
  });
});

describe('forest growth and economy limits', () => {
  it('honors forest preservation and hunger before assigning woodcutters', () => {
    const { world, worker, tree, village } = settlement();
    economyOf(village).forestPolicy = 'preserve';
    expect(fellingProblem(world, tree, village, worker.id)).toBe('Forest preservation limit reached');
    economyOf(village).forestPolicy = 'intensive';
    for (const s of storesOf(village)) s.goods = {}; // Empty physical stocks, then resynchronize.
    deposit(village, {}); village.food = 0;
    expect(fellingProblem(world, tree, village, worker.id)).toBe('Workers are needed for food');
    expect(assignVillageWork(world, worker)).toBe(false);
  });
  it('protects housing wood from production while allowing a building reservation', () => {
    const { world, worker, home, village } = settlement(); deposit(village, { wood: FOREST.housingWood });
    expect(reserveGoods(world, village, { wood: 1 }, worker.id)).toBe(false);
    beginProject(home, 'build');
    expect(reserveGoods(world, village, { wood: 4 }, home.id)).toBe(true);
    expect(consumeReservation(village, home.id, { wood: 4 })).toBe(true);
    expect(consumeReservation(village, home.id, { wood: 4 })).toBe(false);
    expect(stockOf(village, 'wood')).toBe(0);
  });
  it('grows planted saplings in simulation time and preserves a paused job', () => {
    const { world, tree, worker } = settlement(); cut(world, worker, tree);
    const sapling = world.spawn('core:tree', { x: 32, y: 32 }, 'planted')!;
    world.paused = true; world.tick = 30; forestry(world); continueVillageWork(world, worker);
    expect(sapling.components.tree!.age).toBe(0); expect(worker.components.citizen!.work!.progress).toBe(0);
    world.paused = false;
    for (let i = 1; i <= FOREST.mature; i++) { world.tick = i * 30; forestry(world); }
    expect(sapling.components.tree!.age).toBe(FOREST.mature);
  });
  it('does not fell trees with an unreachable route or a full warehouse', () => {
    const { world, worker, village, tree } = settlement();
    Object.assign(tree.components.position!, { x: 32, y: 32 }); world.spatial.update(tree);
    for (let y = 0; y < 48; y++) world.terrain.set(30, y, Terrain.Water);
    expect(assignVillageWork(world, worker)).toBe(false); expect(tree.components.tree!.claim).toBeNull();
    for (let y = 0; y < 48; y++) world.terrain.set(30, y, Terrain.Grass);
    for (const store of storesOf(village)) deposit(village, { stone: 2000 }, store.buildingId);
    expect(assignVillageWork(world, worker)).toBe(false); expect(world.entities.has(tree.id)).toBe(true);
  });
  it('cannot finish felling across a newly flooded tile at arm’s length', () => {
    const { world, worker, tree } = settlement(); cut(world, worker, tree);
    world.terrain.set(19, 32, Terrain.Water); worker.components.citizen!.work!.progress = 4;
    expect(extractSource(world, worker, tree)).toBe(false);
    expect(world.entities.has(tree.id)).toBe(true); expect(worker.components.citizen!.work!.cargo).toBeNull();
  });
  it('migrates old trees once and leaves carried wood unchanged', () => {
    const { world, worker, tree } = settlement();
    worker.components.citizen!.work = { good: 'wood', progress: 0, cargo: { good: 'wood', amount: 3, villageId: worker.components.citizen!.villageId! } };
    const old = world.snapshot(); old.version = 37;
    delete old.entities.find(e => e.id === tree.id)!.components.tree;
    const loaded = decodeSave(old, world.registry), forest = loaded.entities.find(e => e.id === tree.id)!.components.tree!;
    expect(forest.origin).toBe('legacy'); expect(forest.age).toBe(FOREST.mature);
    expect(loaded.entities.find(e => e.id === worker.id)!.components.citizen!.work!.cargo!.amount).toBe(3);
    expect(decodeSave(loaded, world.registry)).toEqual(loaded);
    const bad = structuredClone(loaded); bad.entities.find(e => e.id === tree.id)!.components.tree!.remaining = 50;
    expect(() => decodeSave(bad, world.registry)).toThrow();
  });
  it.each(['stick', 'sword', 'axe', 'hammer', 'spear', 'bow'])('makes a wooden %s once through the shared equipment workflow', kind => {
    const { world, worker, workers, village } = settlement(); deposit(village, { wood: 8 });
    const workshop = world.spawn('core:workshop', { x: 32, y: 28 })!; workshop.components.workplace!.villageId = village.id;
    const order = requestCraft(world, workers[1], 'weapon', { preferredKinds: [kind] })!;
    const definition = kind === 'stick' ? kind : `wood-${kind}`;
    expect(order.recipe).toBe(definition); expect(startCraft(world, worker, order, workshop)).toBe(true);
    arrive(world, worker, workshop);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(world.equipment.items.filter(i => i.definition === definition)).toHaveLength(1);
    expect(stockOf(village, 'wood')).toBe(8 - EQUIPMENT[definition].recipe.inputs.wood!);
    const spent = economyOf(village).spent!.wood; continueVillageWork(world, worker);
    expect(economyOf(village).spent!.wood).toBe(spent);
    expect(EQUIPMENT['wood-armor']).toBeUndefined();
  });
});
