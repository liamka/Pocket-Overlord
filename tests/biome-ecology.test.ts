import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { applyBiomeOrigin, drawOriginTraits, plantProblem, settlementBiomeProblem } from '../src/core/biome-ecology';
import { applyBiomeChange, collectBiomeChanges, decodeBiomeChange, winsBiomeSpread } from '../src/core/biome-spread';
import { selectBiomeMineral } from '../src/core/biome-minerals';
import { NaturalBiome, NATURAL_BIOMES } from '../src/core/natural-biomes';
import { Random } from '../src/core/random';
import { cargoContents, deposit, stockOf } from '../src/core/resource-ledger';
import { extractSource } from '../src/core/resource-sources';
import { initializeStorage } from '../src/core/stockpiles';
import { subspeciesOf } from '../src/core/subspecies-state';
import { TerrainMap } from '../src/core/terrain';
import { Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { setWorldLaw } from '../src/core/world-rules';
import { runWorldProcesses } from '../src/core/world-processes';
import { decodeSave } from '../src/persistence/schema';
import { continueVillageWork } from '../src/systems/economy';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

const reload = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
const checkerboard = () => {
  const map = new TerrainMap(48, 48); map.tiles.fill(Terrain.Grass);
  for (let i = 0; i < map.biomes.length; i++) map.biomes[i] = (i + Math.floor(i / map.width)) % 2 ? NaturalBiome.Savanna : NaturalBiome.Desert;
  return map;
};
describe('shared biome ecology', () => {
  it('resolves equal strengths without scan-order bias or growth through frozen cells', () => {
    const map = checkerboard(), forward = collectBiomeChanges(map, 123);
    expect(forward.length).toBeGreaterThan(0);
    expect(collectBiomeChanges(map, 123, undefined, true)).toEqual(forward);
    expect(winsBiomeSpread(6, 6, { next: () => 0.0499 })).toBe(true);
    expect(winsBiomeSpread(6, 6, { next: () => 0.05 })).toBe(false);
    for (const age of ['ice', 'despair']) expect(collectBiomeChanges(map, 123, { age, dominant: [NaturalBiome.Savanna, NaturalBiome.Desert] })).toEqual([]);
    const target = decodeBiomeChange(forward[0]).index;
    map.setLayers(target % map.width, Math.floor(target / map.width), { frost: 'snow' });
    expect(collectBiomeChanges(map, 123).some(n => decodeBiomeChange(n).index === target)).toBe(false);
  });
  it('treats Grow Grass and Overgrowth independently and rechecks delayed edits', () => {
    const world = flatWorld(); world.terrain.biomes.splice(0, world.terrain.biomes.length, ...checkerboard().biomes);
    const change = collectBiomeChanges(world.terrain, 123)[0], { index } = decodeBiomeChange(change);
    setWorldLaw(world, 'grow-grass', false);
    const task = world.processes.tasks.find(t => t.id === 'core:biome-spread')!;
    expect(task.enabled).toBe(true);
    setWorldLaw(world, 'biomes-overgrowth', false);
    const before = [...world.terrain.biomes]; applyBiomeChange(world, change); expect(world.terrain.biomes).toEqual(before);
    setWorldLaw(world, 'biomes-overgrowth', true);
    world.terrain.setBiome(index % 48, Math.floor(index / 48), NaturalBiome.Candy);
    applyBiomeChange(world, change); expect(world.terrain.biomes[index]).toBe(NaturalBiome.Candy);
  });
  it('restores an unfinished spread without a fresh lottery or repeated work', () => {
    const world = flatWorld(); world.terrain.biomes.splice(0, world.terrain.biomes.length, ...checkerboard().biomes);
    world.registry.biomeClimate = () => ({ age: 'normal', dominant: [NaturalBiome.Desert, NaturalBiome.Savanna] });
    // Increase the frontier, not the process budget, to force a saved portion.
    const snapshot = world.snapshot(), size = 128;
    snapshot.terrain = { width: size, height: size, tiles: Array(size * size).fill(Terrain.Grass), moisture: Array(size * size).fill(0),
      biomes: Array.from({ length: size * size }, (_, i) => (i + Math.floor(i / size)) % 2 ? NaturalBiome.Savanna : NaturalBiome.Desert),
      surfaces: Array(size * size).fill(0), recovery: [], layers: [], visualSeed: world.seed };
    const active = new World(world.seed, world.registry, snapshot);
    active.tick = active.processes.tasks.find(t => t.id === 'core:biome-spread')!.nextAt!;
    runWorldProcesses(active, 'landscape');
    expect(active.processes.tasks.find(t => t.id === 'core:biome-spread')!.pending).not.toBeNull();
    const copy = reload(active), saved = copy.snapshot();
    runWorldProcesses(copy, 'landscape'); expect(copy.snapshot()).toEqual(saved);
    active.tick++; copy.tick++; runWorldProcesses(active, 'landscape'); runWorldProcesses(copy, 'landscape');
    expect(copy.snapshot()).toEqual(active.snapshot());
  });
  it('keeps surface, height and top separate from living biome identity', () => {
    const world = flatWorld(), map = world.terrain, index = map.index(12, 12);
    map.biomes[index] = NaturalBiome.Swamp; map.surfaces[index] = 2;
    map.setLayers(12, 12, { elevation: 2, top: 'flower-dark' });
    map.setBiome(12, 12, NaturalBiome.Permafrost);
    const restored = reload(world).terrain.cell(12, 12);
    expect(restored.biome.id).toBe(NaturalBiome.Permafrost);
    expect(restored.surface?.kind).toBe('mud'); expect(restored.elevation).toBe(2); expect(restored.top).toBe('flower-dark');
  });
  it('allows two successful draws to select the same trait without duplicates', () => {
    expect(drawOriginTraits(['fast', 'genius'], () => 0.1)).toEqual(['fast']);
  });
  it('grants birth origin and founder adaptation once, without converting visitors', () => {
    const world = flatWorld(), visitor = world.spawn('core:person', { x: 6, y: 6 })!;
    world.terrain.biomes.fill(NaturalBiome.Swamp);
    const native = world.spawn('core:person', { x: 30, y: 30 }, undefined, 'born')!;
    expect(subspeciesOf(native)!.traits).toContain('swamp-adaptation');
    expect(settlementBiomeProblem(world, { x: 30, y: 30 }, visitor)).toBeDefined();
    expect(settlementBiomeProblem(world, { x: 30, y: 30 }, native)).toBeUndefined();
    const traits = structuredClone(native.components.traits), rng = world.rng.state;
    applyBiomeOrigin(world, native); applyBiomeOrigin(world, visitor);
    expect(world.rng.state).toBe(rng); expect(native.components.traits).toEqual(traits);
    const restored = reload(world);
    expect(restored.entities.get(native.id)!.components.traits).toEqual(traits);
    expect(restored.entities.get(visitor.id)!.components.traits!.biomeOrigin).toBe(NaturalBiome.Grassland);
  });
  it('keeps seeds, deposits and remaining harvest stable across reloads', () => {
    const a = new World(715, createRegistry(), undefined, undefined, undefined, NaturalBiome.Desert);
    const b = new World(715, createRegistry(), undefined, undefined, undefined, NaturalBiome.Desert);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect([...a.query('stone')].filter(e => e.components.stone!.profile === 'stone').length).toBeLessThanOrEqual(Math.floor(a.terrain.width * a.terrain.height / 240));
    for (const source of [...a.query('stone')]) a.remove(source.id);
    expect([...reload(a).query('stone')]).toEqual([]);
    expect(selectBiomeMineral(NaturalBiome.Crystal, new Random(12))).toBeUndefined();
    const outputs = new Set(Array.from({ length: 256 }, (_, i) => selectBiomeMineral(NaturalBiome.Crystal, new Random(i), true)));
    for (const id of ['stone', 'commonMetal', 'gems', 'gold']) expect(outputs).toContain(id);
  });
  it('stops incompatible plant growth while keeping its species and finite harvest', () => {
    const world = flatWorld(); world.terrain.biomes.fill(NaturalBiome.Lemon);
    const tree = world.spawn('core:tree', { x: 24, y: 24 }, 'planted')!, saved = structuredClone(tree.components.tree);
    world.terrain.setBiome(24, 24, NaturalBiome.Permafrost);
    expect(plantProblem(world, tree.components.position!, tree.components.tree!.profile)).toBe('This plant does not grow in this biome.');
    world.tick = 30; runWorldProcesses(world, 'resources');
    expect(tree.components.tree).toEqual(saved); expect(reload(world).entities.get(tree.id)!.components.tree).toEqual(saved);
  });
  it('mines and delivers the same material after a biome change without converting stock', () => {
    const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(world, home);
    const worker = world.spawn('core:person', { x: 26.3, y: 24 })!, ore = world.spawn('core:common-metal', { x: 28, y: 24 })!;
    Object.assign(worker.components.person!, { age: 30, homeId: home.id }); worker.components.citizen!.villageId = village.id;
    initializeStorage(world, village); deposit(village, { provisions: 80, silver: 3 });
    Object.assign(worker.components.citizen!, { task: 'work', targetId: ore.id, path: [], work: { good: 'commonMetal', progress: 4, cargo: null } });
    world.terrain.setBiome(28, 24, NaturalBiome.Crystal);
    expect(extractSource(world, worker, ore)).toBe(true);
    expect(stockOf(village, 'commonMetal')).toBe(0);
    expect(cargoContents(worker.components.citizen!.work!.cargo!)).toEqual({ commonMetal: 4, stone: 2 });
    const copy = reload(world), carrier = copy.entities.get(worker.id)!, owner = copy.society.villages[0];
    Object.assign(carrier.components.position!, { x: 13.8, y: 20 }); copy.spatial.update(carrier);
    Object.assign(carrier.components.citizen!, { task: 'deliver', targetId: home.id, path: [] });
    continueVillageWork(copy, carrier); continueVillageWork(copy, carrier);
    expect(stockOf(owner, 'commonMetal')).toBe(4); expect(stockOf(owner, 'silver')).toBe(3);
  });
  it('migrates old worlds without new origins or resources and rejects invalid receipts', () => {
    const world = flatWorld(), actor = world.spawn('core:person', { x: 20, y: 20 })!, old = world.snapshot(); old.version = 65;
    old.processes!.tasks = old.processes!.tasks.filter(t => !['core:biome-spread', 'core:biome-fauna'].includes(t.id));
    const migrated = decodeSave(old, world.registry);
    expect(migrated.rngState).toBe(old.rngState); expect(migrated.entities.length).toBe(old.entities.length);
    expect(migrated.entities.find(e => e.id === actor.id)!.components.traits!.biomeOrigin).toBeNull();
    migrated.entities.find(e => e.id === actor.id)!.components.traits!.biomeOrigin = NATURAL_BIOMES.length;
    expect(() => decodeSave(migrated, world.registry)).toThrow();
  });
});
