import { describe, expect, it } from 'vitest';
import { LAND_BRUSH_RADIUS } from '../src/content/terraforming';
import { NaturalBiome } from '../src/core/natural-biomes';
import { canSail, SHIP_ID } from '../src/core/seafaring';
import { Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { seafaring } from '../src/systems/seafaring';
import { water } from '../src/systems/effects';
import { flatWorld, villageWorld } from './helpers';

const use = (world: World, mode: 'raise' | 'lower', x = 24, y = 24) => world.command({ kind: 'use-tool', toolId: `core:${mode}-land`, x, y });

describe('land shaping', () => {
  it('raises a usable island with a sandy coast and preserves water outside the brush', () => {
    const world = flatWorld(); world.paused = true;
    world.terrain.tiles.fill(Terrain.DeepWater);
    const rng = world.rng.state;
    use(world, 'raise');
    expect(world.terrain.at(24, 24)).toBe(Terrain.Grass);
    expect(world.canStand({ x: 24, y: 24 })).toBe(true);
    expect(world.terrain.tiles).toContain(Terrain.Sand);
    expect(world.terrain.at(29, 24)).toBe(Terrain.DeepWater);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
      const inside = Math.hypot(x + 0.5 - 24, y + 0.5 - 24) <= LAND_BRUSH_RADIUS;
      expect(world.terrain.isLand(x, y)).toBe(inside);
    }
    expect(world.tick).toBe(0); expect(world.rng.state).toBe(rng);
    const unchanged = world.snapshot(), visuals = world.visuals.length;
    use(world, 'raise');
    expect(world.snapshot()).toEqual(unchanged); expect(world.visuals).toHaveLength(visuals);
    expect(world.registry.tools.get('core:raise-land')!.canApply!(world, { x: 24, y: 24 })).toBe(false);
  });

  it('sinks every land type, clears recovery and surface records, and leaves unrelated ground alone', () => {
    const world = flatWorld(), map = world.terrain;
    const kinds = [Terrain.Grass, Terrain.Sand, Terrain.Scorched, Terrain.Crater, Terrain.Road, Terrain.Mountain, Terrain.BridgeHorizontal, Terrain.BridgeVertical];
    for (const [i, kind] of kinds.entries()) {
      const x = 22 + i % 4, y = 23 + Math.floor(i / 4);
      map.set(x, y, kind); map.moisture[map.index(x, y)] = 0.6;
      map.surfaces[map.index(x, y)] = 1;
    }
    map.set(40, 40, Terrain.Road); map.setBiome(40, 40, NaturalBiome.Swamp);
    use(world, 'lower');
    for (const [i] of kinds.entries()) {
      const x = 22 + i % 4, y = 23 + Math.floor(i / 4), index = map.index(x, y);
      expect(map.at(x, y)).toBe(Terrain.Water); expect(map.moisture[index]).toBe(0); expect(map.surfaces[index]).toBe(0);
      expect(map.recovery.has(index)).toBe(false); expect(map.roadWear.has(index)).toBe(false); expect(map.roadTiles.has(index)).toBe(false);
    }
    expect(map.at(40, 40)).toBe(Terrain.Road); expect(map.biomeAt(40, 40).id).toBe(NaturalBiome.Swamp);
    const before = world.snapshot(), visuals = world.visuals.length;
    use(world, 'lower');
    expect(world.snapshot()).toEqual(before); expect(world.visuals).toHaveLength(visuals);
    use(world, 'raise');
    expect(map.at(24, 24)).toBe(Terrain.Grass); expect(map.surfaceAt(24, 24)).toBeUndefined();
  });

  it('removes flooded buildings and trees, releases households and lets residents swim', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    const home = [...world.query('dwelling')][0], people = [...world.query('person')];
    const tree = world.spawn('core:tree', { x: 24, y: 22 })!;
    const farm = world.spawn('core:farm', { x: 25, y: 24 })!;
    const workshop = world.spawn('core:workshop', { x: 25, y: 25 })!;
    farm.components.farm!.villageId = world.society.villages[0].id;
    use(world, 'lower');
    expect(world.entities.has(home.id)).toBe(false); expect(world.entities.has(tree.id)).toBe(false); expect(world.entities.has(farm.id)).toBe(false);
    expect(world.entities.has(workshop.id)).toBe(false);
    expect([...world.query('ruin')]).toHaveLength(0); expect(world.population).toBe(people.length);
    for (const person of people) {
      expect(person.components.person!.homeId).toBeNull();
      expect(person.components.person!.displaced?.homeId).toBe(home.id);
    }
    const health = people.map(person => person.components.health!.current);
    water(world, 0.5);
    expect(people.some((person, i) => person.components.health!.current < health[i])).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('grounds a ship when land rises and makes the channel navigable again when lowered', () => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.Water);
    const ship = world.spawn(SHIP_ID, { x: 24, y: 24 })!;
    Object.assign(ship.components.ship!, { speed: 2, sail: 1 });
    expect(canSail(world, ship.components.position!)).toBe(true);
    use(world, 'raise'); seafaring(world, 0.1);
    expect(canSail(world, ship.components.position!)).toBe(false);
    expect(ship.components.ship!.speed).toBe(0); expect(ship.components.position).toEqual({ x: 24, y: 24 });
    use(world, 'lower'); expect(canSail(world, ship.components.position!)).toBe(true);
    expect(world.entities.has(ship.id)).toBe(true);
  });

  it('saves raised and lowered terrain without changing the save schema or persisting animation', () => {
    const world = flatWorld(); world.paused = true;
    use(world, 'lower', 14, 24); use(world, 'raise', 16, 24); use(world, 'lower', 32, 24);
    const snapshot = world.snapshot(), restored = new World(world.seed, world.registry, decodeSave(snapshot, world.registry));
    expect(restored.snapshot()).toEqual(snapshot); expect(restored.visuals).toEqual([]);
    expect(restored.terrain.isLand(16, 24)).toBe(true); expect(restored.terrain.isLand(32, 24)).toBe(false);
  });

  it('clips edge strokes to the map and ignores invalid coordinates', () => {
    const world = flatWorld();
    use(world, 'lower', 0, 0); use(world, 'lower', 47.9, 47.9);
    expect(world.terrain.tiles).toHaveLength(48 * 48);
    expect(world.terrain.at(0, 0)).toBe(Terrain.Water); expect(world.terrain.at(47, 47)).toBe(Terrain.Water);
    const snapshot = world.snapshot();
    for (const x of [-1, 48, NaN, Infinity]) use(world, 'raise', x, 0);
    expect(world.snapshot()).toEqual(snapshot);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
});
