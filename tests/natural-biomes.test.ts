import { beforeAll, describe, expect, it } from 'vitest';
import { BIOME_SURFACES, NATURAL_BIOMES, NaturalBiome } from '../src/core/natural-biomes';
import { BIOMES } from '../src/core/biomes';
import { generateTerrain } from '../src/core/terrain';
import { World } from '../src/core/world';
import { SAVE_VERSION, Terrain, type WorldSnapshot } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { agriculture, assignHouse, fertilePatch } from '../src/systems/society';
import { movement } from '../src/systems/people';
import { landscape } from '../src/systems/landscape';
import { flatWorld } from './helpers';

let base: WorldSnapshot;
beforeAll(() => { base = flatWorld().snapshot(); }, 30000);
const biomeWorld = (): World => new World(base.seed, undefined, base);

describe('natural biomes', () => {
  it('generates reproducible, contiguous climate regions without replacing shores or island shapes', () => {
    const map = generateTerrain(20), repeat = generateTerrain(20);
    expect(map.snapshot()).toEqual(repeat.snapshot());
    const counts = NATURAL_BIOMES.map(() => 0);
    let neighbors = 0, matches = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.at(x, y) !== Terrain.Grass) continue;
      counts[map.biomeAt(x, y).id]++;
      if (map.at(x + 1, y) === Terrain.Grass) { neighbors++; if (map.biomeAt(x, y).id === map.biomeAt(x + 1, y).id) matches++; }
    }
    expect(counts.every(count => count > 20)).toBe(true);
    expect(matches / neighbors).toBeGreaterThan(0.95);
    expect(map.tiles.some(t => t === Terrain.Sand)).toBe(true);
    expect(map.tiles.some(t => t === Terrain.Mountain)).toBe(true);
    for (const biome of NATURAL_BIOMES) {
      const region = map.tiles.flatMap((tile, i) => (tile === Terrain.Grass || tile === Terrain.Mountain) && map.biomes[i] === biome.id ? [map.surfaces[i]] : []);
      expect(region.filter(surface => surface > 0).length / region.length).toBeGreaterThanOrEqual(0.15);
      expect(new Set(region)).toEqual(new Set([0, 1, 2, 3]));
    }
  }, 30000);

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
    const land = map.tiles.flatMap((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain ? [i] : []);
    expect(new Set(land.map(i => map.biomes[i]))).toEqual(new Set([biome.id]));
    expect(new Set(land.map(i => map.surfaces[i]))).toEqual(new Set([0, 1, 2, 3]));
    expect(land.filter(i => map.surfaces[i] > 0).length / land.length).toBeGreaterThanOrEqual(0.15);
    expect(map.tiles.every((tile, i) => tile === Terrain.Grass || tile === Terrain.Mountain || map.surfaces[i] === 0)).toBe(true);
  });

  it('keeps ice and stone barren and maps painted surfaces to the new biome', () => {
    const world = biomeWorld(), map = world.terrain;
    for (const biome of NATURAL_BIOMES) {
      for (let surface = 1; surface <= 3; surface++) {
        map.surfaces.fill(surface);
        world.command({ kind: 'use-tool', toolId: `core:biome-${biome.key}`, x: 20, y: 20 });
        expect(map.surfaceAt(20, 20)).toEqual(BIOME_SURFACES[biome.id][surface - 1]);
        expect([...world.query('solid')]).toHaveLength(0);
        if (['ice', 'stone', 'water'].includes(map.surfaceAt(20, 20)!.kind)) expect(fertilePatch(world, { x: 20, y: 20 })).toBe(false);
      }
    }
  });

  it.each(NATURAL_BIOMES)('plants $key while paused without changing water, beaches, mountains, roads or buildings', biome => {
    const world = biomeWorld(), map = world.terrain;
    const surfaces = [Terrain.Water, Terrain.DeepWater, Terrain.Sand, Terrain.Mountain, Terrain.BridgeHorizontal, Terrain.Road];
    surfaces.forEach((tile, i) => map.set(17 + i, 20, tile));
    const home = world.spawn('core:house', { x: 20, y: 23 })!;
    const field = world.spawn('core:farm', { x: 17, y: 23 })!;
    const tree = world.spawn('core:tree', { x: 22, y: 23 })!;
    tree.components.health!.current = 25;
    const entities = [home, field, tree].map(e => structuredClone(e));
    const before = [...map.tiles]; world.paused = true;
    world.command({ kind: 'use-tool', toolId: `core:biome-${biome.key}`, x: 20, y: 20 });
    world.step();
    expect(world.tick).toBe(0);
    expect(map.tiles).toEqual(before);
    expect(map.biomeAt(20, 23).id).toBe(biome.id);
    expect(map.biomeAt(30, 20).id).toBe(NaturalBiome.Grassland);
    surfaces.slice(0, -1).forEach((_, i) => expect(map.biomeAt(17 + i, 20).id).toBe(NaturalBiome.Grassland));
    expect(map.biomeAt(22, 20).id).toBe(biome.id);
    expect([home, field, tree]).toEqual(entities);
    for (const e of world.query('solid', 'position')) if (e.typeId === 'core:tree' && e.id !== tree.id) {
      for (const building of [home, field]) expect(Math.hypot(e.components.position!.x - building.components.position!.x, e.components.position!.y - building.components.position!.y)).toBeGreaterThan(4);
    }
  });

  it('repeated seed strokes do not multiply vegetation, and jungle planting is denser than desert planting', () => {
    const plant = (key: string) => {
      const world = biomeWorld();
      const command = { kind: 'use-tool', toolId: `core:biome-${key}`, x: 20, y: 20 } as const;
      world.command(command); const snapshot = world.snapshot(); world.command(command);
      expect(world.snapshot()).toEqual(snapshot);
      return [...world.query('solid')].length;
    };
    expect(plant('jungle')).toBeGreaterThan(plant('desert'));
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
    for (const biome of NATURAL_BIOMES) expect(growth(biome.id, 5400)).toBe(0);
  });

  it('retains the biome underneath craters and roads during recovery and save/load', () => {
    const world = biomeWorld(), map = world.terrain;
    for (const biome of NATURAL_BIOMES) {
      const x = 10 + biome.id * 4;
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
      const x = 10 + biome.id * 4;
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
    for (const biomes of [undefined, [], Array(48 * 48), Array(48 * 48).fill(6), Array(48 * 48).fill(-1), Array(48 * 48).fill(1.5)]) {
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
