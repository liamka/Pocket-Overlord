import { beforeAll, describe, expect, it } from 'vitest';
import { NATURAL_BIOMES, SEED_BIOMES, NaturalBiome } from '../src/core/natural-biomes';
import { BIOMES } from '../src/core/biomes';
import { generateTerrain } from '../src/core/terrain';
import { World } from '../src/core/world';
import { SAVE_VERSION, Terrain, type WorldSnapshot } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { agriculture, assignHouse } from '../src/systems/society';
import { movement } from '../src/systems/people';
import { landscape } from '../src/systems/landscape';
import { flatWorld } from './helpers';

let base: WorldSnapshot;
beforeAll(() => { base = flatWorld().snapshot(); }, 30000);
const biomeWorld = (): World => new World(base.seed, undefined, base);

describe('natural biomes', () => {
  it.each(BIOMES)('generates one reproducible biome across the entire $id world', biome => {
    const choices = new Set<number>();
    for (const seed of [0, 20, 42, 0xffffffff]) {
      const map = generateTerrain(seed, 128, 96, biome.id);
      expect(new Set(map.biomes).size).toBe(1);
      choices.add(map.biomes[0]);
      expect(map.snapshot()).toEqual(generateTerrain(seed, 128, 96, biome.id).snapshot());
      expect(new Set(generateTerrain(seed, 96, 128).biomes)).toEqual(new Set(map.biomes));
      expect(map.tiles).toEqual(generateTerrain(seed, 128, 96, biome.id, NaturalBiome.Grassland).tiles);
      expect(map.tiles).toContain(Terrain.Sand);
      if (biome.id !== 'yin-yang') expect(map.tiles).toContain(Terrain.Mountain);
      const surfaces = map.tiles.flatMap((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain ? [map.surfaces[i]] : []);
      expect(surfaces.filter(surface => surface > 0).length / surfaces.length).toBeGreaterThanOrEqual(0.15);
      expect(new Set(surfaces)).toEqual(new Set([0, 1, 2, 3]));
    }
    expect(choices.size).toBeGreaterThan(1);
  });

  it.each(BIOMES)('leaves at least 15% of permafrost land in clearings on the $id island', biome => {
    const map = generateTerrain(20, 128, 128, biome.id, NaturalBiome.Permafrost);
    const grass = generateTerrain(20, 128, 128, biome.id, NaturalBiome.Grassland);
    expect(map.tiles).toEqual(grass.tiles);
    const land = map.tiles.flatMap((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain ? [i] : []);
    expect(new Set(land.map(i => map.biomes[i]))).toEqual(new Set([NaturalBiome.Permafrost]));
    const clearings = land.filter(i => map.surfaces[i] > 0);
    expect(clearings.length / land.length).toBeGreaterThanOrEqual(0.15);
    expect(land.filter(i => map.surfaces[i] === 0).length / land.length).toBeGreaterThan(0.8);
    const interiors = clearings.filter(i => {
      const x = i % map.width, y = Math.floor(i / map.width);
      return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].every(([nx, ny]) =>
        ![Terrain.Grass, Terrain.Mountain].includes(map.at(nx, ny)) || Boolean(map.surfaceAt(nx, ny)));
    });
    expect(interiors.length / clearings.length).toBeGreaterThan(0.7);
  });

  it('reproduces snow clearings from the seed on rectangular worlds', () => {
    const map = generateTerrain(42, 96, 128, 'turtle', NaturalBiome.Permafrost);
    expect(map.snapshot()).toEqual(generateTerrain(42, 96, 128, 'turtle', NaturalBiome.Permafrost).snapshot());
    expect(map.surfaces).not.toEqual(generateTerrain(43, 96, 128, 'turtle', NaturalBiome.Permafrost).surfaces);
  });

  it.each(NATURAL_BIOMES)('adds three local surfaces to $key without changing its climate', biome => {
    const map = generateTerrain(42, 128, 96, 'phoenix', biome.id);
    expect(new Set(map.biomes)).toEqual(new Set([biome.id]));
    const land = map.tiles.flatMap((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain ? [i] : []);
    expect(new Set(land.map(i => map.biomes[i]))).toEqual(new Set([biome.id]));
    expect(new Set(land.map(i => map.surfaces[i]))).toEqual(new Set([0, 1, 2, 3]));
    expect(land.filter(i => map.surfaces[i] > 0).length / land.length).toBeGreaterThanOrEqual(0.15);
    expect(map.tiles.every((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain || map.surfaces[i] === 0)).toBe(true);
  });

  it('replaces local surfaces even when painting the same biome and refreshes the ground', () => {
    const world = biomeWorld(), map = world.terrain;
    for (const biome of SEED_BIOMES) {
      for (let surface = 1; surface <= 3; surface++) {
        map.biomes.fill(biome.id);
        map.surfaces.fill(surface);
        map.dirty.clear();
        const revision = map.revision;
        world.command({ kind: 'use-tool', toolId: `core:biome-${biome.key}`, x: 20, y: 20 });
        expect(map.surfaceAt(20, 20)).toBeUndefined();
        expect(map.biomeAt(20, 20).id).toBe(biome.id);
        expect(map.surfaces[map.index(30, 20)]).toBe(surface);
        expect(map.dirty.has(map.index(20, 20))).toBe(true);
        expect(map.revision).toBeGreaterThan(revision);
      }
    }
  });

  it.each(SEED_BIOMES)('plants $key over water and beaches while preserving mountains, roads and buildings', biome => {
    const world = biomeWorld(), map = world.terrain;
    const surfaces = [Terrain.Water, Terrain.DeepWater, Terrain.Sand, Terrain.Mountain, Terrain.BridgeHorizontal, Terrain.Road];
    surfaces.forEach((tile, i) => map.set(17 + i, 20, tile));
    const home = world.spawn('core:house', { x: 20, y: 23 })!;
    const field = world.spawn('core:farm', { x: 17, y: 23 })!;
    const tree = world.spawn('core:tree', { x: 22, y: 23 })!;
    tree.components.health!.current = 25;
    const entities = [home, field, tree].map(e => structuredClone(e));
    const before = [...map.tiles]; world.paused = true;
    for (let x = 17; x <= 19; x++) before[map.index(x, 20)] = Terrain.Grass;
    world.command({ kind: 'use-tool', toolId: `core:biome-${biome.key}`, x: 20, y: 20 });
    world.step();
    expect(world.tick).toBe(0);
    expect(map.tiles).toEqual(before);
    expect(map.biomeAt(20, 23).id).toBe(biome.id);
    expect(map.biomeAt(30, 20).id).toBe(NaturalBiome.Grassland);
    for (let x = 17; x <= 19; x++) expect(map.biomeAt(x, 20).id).toBe(biome.id);
    for (let x = 20; x <= 21; x++) expect(map.biomeAt(x, 20).id).toBe(NaturalBiome.Grassland);
    expect(map.biomeAt(22, 20).id).toBe(biome.id);
    expect([home, field, tree]).toEqual(entities);
    for (const e of world.query('solid', 'position')) if (e.typeId === 'core:tree' && e.id !== tree.id) {
      for (const building of [home, field]) expect(Math.hypot(e.components.position!.x - building.components.position!.x, e.components.position!.y - building.components.position!.y)).toBeGreaterThan(4);
    }
  });

  it.each(SEED_BIOMES)('paints $key on pure water or sand, keeps the brush boundary and survives save/load', biome => {
    for (const tile of [Terrain.DeepWater, Terrain.Water, Terrain.Sand]) {
      const world = biomeWorld(), map = world.terrain;
      map.tiles.fill(tile);
      map.biomes.fill(NaturalBiome.Crystal);
      const toolId = `core:biome-${biome.key}`, point = { x: 20, y: 20 };
      expect(world.registry.tools.get(toolId)!.canApply!(world, point)).toBe(true);
      world.command({ kind: 'use-tool', toolId, ...point });
      expect(map.at(20, 20)).toBe(Terrain.Grass);
      expect(map.biomeAt(20, 20).id).toBe(biome.id);
      expect(map.at(26, 20)).toBe(tile);
      expect(map.biomeAt(26, 20).id).toBe(NaturalBiome.Crystal);
      const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
      const restored = new World(world.seed, world.registry, snapshot);
      expect(restored.terrain.snapshot()).toEqual(map.snapshot());
      expect(map.canPaintBiome(-1, 20)).toBe(false);
      expect(map.canPaintBiome(map.width, 20)).toBe(false);
    }
  });

  it('repeated seed strokes do not multiply vegetation, and jungle planting is denser than desert planting', () => {
    const plant = (key: string) => {
      const world = biomeWorld();
      // A single brush can now fall entirely inside a glade; compare the whole region.
      const commands = Array.from({ length: 25 }, (_, i) => ({ kind: 'use-tool', toolId: `core:biome-${key}`, x: 6 + i % 5 * 8, y: 6 + Math.floor(i / 5) * 8 } as const));
      for (const command of commands) world.command(command);
      const snapshot = world.snapshot();
      for (const command of commands) world.command(command);
      expect(world.snapshot()).toEqual(snapshot);
      return [...world.query('solid')].length;
    };
    expect(plant('jungle')).toBeGreaterThan(plant('desert'));
  });

  it('groups trees into groves with open grass glades and preserves their positions when saved', () => {
    const world = new World(20, undefined, undefined, [], 'turtle', NaturalBiome.Grassland);
    const trees = [...world.query('tree', 'position')];
    const positions = trees.map(tree => tree.components.position!);
    expect(positions.length).toBeGreaterThan(100);
    let crowded = 0, solitary = 0;
    for (const p of positions) {
      const neighbors = world.nearby(p, 6).filter(e => e.components.tree).length - 1;
      if (neighbors >= 5) crowded++;
      if (neighbors === 0) solitary++;
      expect(world.nearby(p, 1.64).filter(e => e.components.tree)).toHaveLength(1);
      expect(world.terrain.at(p.x, p.y)).toBe(Terrain.Grass);
      expect(world.terrain.surfaceAt(p.x, p.y)).toBeUndefined();
    }
    expect(crowded / trees.length).toBeGreaterThan(0.25);
    expect(solitary).toBeGreaterThan(10);
    let glades = 0;
    for (let y = 16; y < world.terrain.height - 16; y += 12) for (let x = 16; x < world.terrain.width - 16; x += 12) {
      if (world.terrain.at(x, y) === Terrain.Grass && !world.terrain.surfaceAt(x, y)
        && !world.nearby({ x, y }, 10).some(e => e.components.tree)) glades++;
    }
    expect(glades).toBeGreaterThan(10);
    const restored = new World(world.seed, world.registry, world.snapshot(), []);
    expect([...restored.query('tree', 'position')].map(tree => tree.components.position)).toEqual(positions);
    const repeated = new World(20, undefined, undefined, [], 'turtle', NaturalBiome.Grassland);
    expect([...repeated.query('tree', 'position')].map(tree => tree.components.position)).toEqual(positions);
  });

  it('changes walking speed in wetlands and snow while roads retain their travel benefit', () => {
    const travel = (biome: NaturalBiome, road = false): number => {
      const world = biomeWorld(); world.terrain.setBiome(20, 20, biome);
      if (road) world.terrain.set(20, 20, Terrain.Road);
      const person = world.spawn('core:person', { x: 20.5, y: 20.5 })!;
      Object.assign(person.components.motion!, { heading: 0, decisionIn: 10 });
      movement(world, 0.1);
      return person.components.position!.x - 20.5;
    };
    const normal = travel(NaturalBiome.Grassland);
    expect(travel(NaturalBiome.Swamp) / normal).toBeCloseTo(0.6);
    expect(travel(NaturalBiome.Permafrost) / normal).toBeCloseTo(0.75);
    expect(travel(NaturalBiome.Desert) / normal).toBeCloseTo(0.8);
    expect(travel(NaturalBiome.Enchanted) / normal).toBeCloseTo(1);
    expect(travel(NaturalBiome.Corrupted) / normal).toBeCloseTo(0.7);
    expect(travel(NaturalBiome.Crystal) / normal).toBeCloseTo(0.85);
    expect(travel(NaturalBiome.Candy) / normal).toBeCloseTo(0.9);
    expect(travel(NaturalBiome.Swamp, true) / normal).toBeCloseTo(1.4);
  });

  it('uses local soil for farming while keeping winter dormant in every biome', () => {
    const growth = (biome: NaturalBiome, tick: number): number => {
      const world = biomeWorld(), village = assignHouse(world, world.spawn('core:house', { x: 10, y: 10 })!);
      const field = world.spawn('core:farm', { x: 20, y: 20 })!;
      field.components.farm!.villageId = village.id; world.terrain.setBiome(20, 20, biome);
      world.tick = tick; agriculture(world);
      return field.components.farm!.growth;
    };
    const meadow = growth(NaturalBiome.Grassland, 30);
    expect(growth(NaturalBiome.Jungle, 30)).toBeGreaterThan(meadow);
    expect(growth(NaturalBiome.Desert, 30)).toBeLessThan(meadow);
    expect(growth(NaturalBiome.Permafrost, 30)).toBeGreaterThan(0);
    expect(growth(NaturalBiome.Enchanted, 30)).toBeGreaterThan(meadow);
    expect(growth(NaturalBiome.Mushroom, 30)).toBeGreaterThan(meadow);
    expect(growth(NaturalBiome.Lemon, 30)).toBeGreaterThan(meadow);
    expect(growth(NaturalBiome.Corrupted, 30)).toBeLessThan(meadow);
    expect(growth(NaturalBiome.Infernal, 30)).toBeLessThan(growth(NaturalBiome.Corrupted, 30));
    for (const biome of NATURAL_BIOMES) expect(growth(biome.id, 5400)).toBe(0);
  });

  it('retains the biome underneath craters and roads during recovery and save/load', () => {
    const world = biomeWorld(), map = world.terrain;
    for (const biome of NATURAL_BIOMES) {
      const x = 10 + biome.id * 2;
      map.surfaces[map.index(x, 20)] = 1 + biome.id % 3;
      map.surfaces[map.index(x, 25)] = 1 + biome.id % 3;
      map.setBiome(x, 20, biome.id); map.set(x, 20, Terrain.Crater);
      map.setBiome(x, 25, biome.id); map.set(x, 25, Terrain.Road);
    }
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(world.seed, world.registry, snapshot);
    expect(restored.snapshot()).toEqual(snapshot);
    for (let step = 1; step <= 120; step++) { restored.tick = step * 120; landscape(restored); }
    for (const biome of NATURAL_BIOMES) {
      const x = 10 + biome.id * 2;
      expect(restored.terrain.at(x, 20)).toBe(Terrain.Grass);
      expect(restored.terrain.biomeAt(x, 20).id).toBe(biome.id);
      expect(restored.terrain.biomeAt(x, 25).id).toBe(biome.id);
      expect(restored.terrain.surfaces[map.index(x, 20)]).toBe(1 + biome.id % 3);
      expect(restored.terrain.surfaces[map.index(x, 25)]).toBe(1 + biome.id % 3);
    }
  });

  it('upgrades existing saves without recoloring their terrain or replacing their entities', () => {
    const world = biomeWorld(); world.spawn('core:person', { x: 20, y: 20 });
    const old = world.snapshot(); old.version = 19; delete old.terrain.biomes;
    const upgraded = decodeSave(old, world.registry);
    expect(upgraded.version).toBe(SAVE_VERSION);
    expect(upgraded.terrain.tiles).toEqual(old.terrain.tiles);
    expect(upgraded.entities).toEqual(old.entities);
    expect(upgraded.terrain.biomes).toEqual(Array(48 * 48).fill(NaturalBiome.Grassland));
  });

  it('rejects missing, truncated, sparse and unknown biome values in current saves', () => {
    const world = biomeWorld();
    for (const biomes of [undefined, [], Array(48 * 48), Array(48 * 48).fill(NATURAL_BIOMES.length), Array(48 * 48).fill(-1), Array(48 * 48).fill(1.5)]) {
      const save = world.snapshot(); save.terrain.biomes = biomes;
      expect(() => decodeSave(save, world.registry)).toThrow();
    }
  });

  it('adds base surfaces to older saves without repainting their biomes', () => {
    const world = biomeWorld(); world.terrain.setBiome(20, 20, NaturalBiome.Permafrost);
    const old = world.snapshot(); old.version = 21; delete old.terrain.surfaces;
    const upgraded = decodeSave(old, world.registry);
    expect(upgraded.terrain.biomes).toEqual(old.terrain.biomes);
    expect(upgraded.terrain.surfaces).toEqual(Array(48 * 48).fill(0));
    expect(old.terrain.surfaces).toBeUndefined();
  });

  it('rejects missing, sparse, truncated and unknown surface values', () => {
    const world = biomeWorld();
    for (const surfaces of [undefined, [], Array(48 * 48), Array(48 * 48).fill(4), Array(48 * 48).fill(-1), Array(48 * 48).fill(1.5)]) {
      const save = world.snapshot(); save.terrain.surfaces = surfaces;
      expect(() => decodeSave(save, world.registry)).toThrow();
    }
  });
});
