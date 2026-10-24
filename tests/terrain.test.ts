import { describe, expect, it } from 'vitest';
import { BIOMES, biomeForSeed } from '../src/core/biomes';
import { generateTerrain, TerrainMap } from '../src/core/terrain';
import { SAVE_VERSION, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { Ocean, OCEAN_COLOR } from '../src/render/ocean';
import { Camera } from '../src/render/camera';
import { componentValidators } from '../src/content/components';

describe('authored world shapes', () => {
  it.each(BIOMES)('creates a playable, reproducible $id surrounded by open sea', biome => {
    const map = generateTerrain(10, undefined, undefined, biome.id);
    expect([map.width, map.height]).toEqual([512, 384]);
    expect(generateTerrain(10, map.width, map.height, biome.id).snapshot()).toEqual(map.snapshot());
    for (const tile of [Terrain.Grass, Terrain.Sand, Terrain.Water, Terrain.DeepWater]) expect(map.tiles).toContain(tile);
    if (biome.id !== 'yin-yang') expect(map.tiles).toContain(Terrain.Mountain);
    expect(map.tiles.filter(tile => tile === Terrain.Grass).length).toBeGreaterThan(2000);
    for (let x = 0; x < map.width; x++) {
      expect(map.at(x, 0)).toBe(Terrain.DeepWater);
      expect(map.at(x, map.height - 1)).toBe(Terrain.DeepWater);
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.at(0, y)).toBe(Terrain.DeepWater);
      expect(map.at(map.width - 1, y)).toBe(Terrain.DeepWater);
    }
    const another = generateTerrain(12, map.width, map.height, biome.id);
    expect(another.tiles).not.toEqual(map.tiles);
    const agreement = map.tiles.filter((tile, i) => (tile >= Terrain.Sand) === (another.tiles[i] >= Terrain.Sand)).length / map.tiles.length;
    expect(agreement).toBeGreaterThan(0.98);
  }, 10000);

  it('keeps the dragon tail, body, head and wing islands recognizable', () => {
    const map = generateTerrain(20, 256, 192, 'dragon');
    const landAt = (x: number, y: number): boolean => map.isLand((x - 50) * 192 * 0.87 / 100 + 128, (y - 50) * 192 * 0.87 / 100 + 96);
    for (const [x, y] of [[40, 36], [65, 67], [35, 97], [32, 5], [80, 23]]) expect(landAt(x, y), `${x},${y}`).toBe(true);
    for (const [x, y] of [[39, 57], [32, 89], [72, 35]]) expect(landAt(x, y), `${x},${y}`).toBe(false);
  });

  it('selects all six templates by seed and honors an explicit choice', () => {
    expect(new Set(Array.from({ length: 12 }, (_, seed) => biomeForSeed(seed)))).toEqual(new Set([
      'dragon', 'turtle', 'phoenix', 'kraken', 'whale', 'yin-yang',
    ]));
    const dragon = generateTerrain(20, 160, 112, 'dragon');
    const turtle = generateTerrain(20, 160, 112, 'turtle');
    expect(dragon.tiles).not.toEqual(turtle.tiles);
  });

  it('separates the Yin and Yang halves and preserves their contrasting island eyes', () => {
    const map = generateTerrain(20, undefined, undefined, 'yin-yang');
    expect(map.tiles).not.toContain(Terrain.Mountain);
    const position = (x: number, y: number) => ({ x: Math.floor((x - 50) * 384 * 0.87 / 100 + 256), y: Math.floor((y - 50) * 384 * 0.87 / 100 + 192) });
    const tileAt = (x: number, y: number): Terrain => { const p = position(x,y); return map.at(p.x,p.y); };
    expect(tileAt(25,50)).toBe(Terrain.Grass);
    expect(tileAt(75,50)).toBe(Terrain.Sand);
    expect(tileAt(50,28.5)).toBe(Terrain.Sand);
    expect(tileAt(50,71.5)).toBe(Terrain.Grass);
    for (const [x, y] of [[50,50],[71.5,28.5],[28.5,71.5],[57,28.5],[43,71.5]]) {
      expect(tileAt(x,y), `${x},${y}`).toBeLessThan(Terrain.Sand);
    }
    const start = position(25,50), reachable = new Set([map.index(start.x,start.y)]), pending = [start];
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const x = p.x + dx, y = p.y + dy, index = map.index(x,y);
        if (map.isLand(x,y) && !reachable.has(index)) { reachable.add(index); pending.push({ x, y }); }
      }
    }
    for (const [x, y] of [[75,50],[50,28.5],[50,71.5]]) {
      const p = position(x,y);
      expect(reachable.has(map.index(p.x,p.y)), `${x},${y} must remain separated by water`).toBe(false);
    }
  });

  it.each(BIOMES)('restores the $id terrain and its mountains without regenerating it', biome => {
    const world = new World(20, undefined, undefined, undefined, biome.id);
    const tile = world.terrain.tiles.findIndex((terrain, i) => terrain === Terrain.Grass && i % world.terrain.width > 256 && Math.floor(i / world.terrain.width) > 192);
    expect(tile).toBeGreaterThan(256 * 192);
    const position = { x: tile % world.terrain.width + 0.5, y: Math.floor(tile / world.terrain.width) + 0.5 };
    const person = world.spawn('core:person', position)!;
    person.components.citizen!.path = [position];
    expect(componentValidators.citizen({ ...person.components.citizen!, task: 'repair', repair: { tile, remaining: 1 } })).toBe(true);
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    expect(new World(snapshot.seed, world.registry, snapshot).snapshot()).toEqual(snapshot);
    for (const outside of [{ x: 512, y: position.y }, { x: position.x, y: 384 }]) {
      const invalid = structuredClone(snapshot);
      invalid.entities.find(entity => entity.id === person.id)!.components.position = outside;
      expect(() => decodeSave(invalid, world.registry)).toThrow();
    }
  });

  it.each([12, 13])('migrates a version %s save without resizing its island', version => {
    const world = new World(20), snapshot = world.snapshot();
    snapshot.version = version;
    snapshot.terrain = generateTerrain(20, 256, 192).snapshot();
    snapshot.entities = [];
    if (version === 12) snapshot.terrain.tiles = snapshot.terrain.tiles.map(tile => tile === Terrain.Mountain ? Terrain.Grass : tile);
    const migrated = decodeSave(snapshot, world.registry);
    expect(migrated).toEqual({ ...snapshot, version: SAVE_VERSION });
    expect(new World(snapshot.seed, world.registry, migrated).terrain.snapshot()).toEqual(snapshot.terrain);
  });
});

describe('larger world camera', () => {
  it.each([[1440, 960], [1024, 768]])('fits the full island in a %s×%s viewport and permits zooming out', (width, height) => {
    const camera = new Camera(); camera.width = width; camera.height = height;
    camera.fit(512, 384);
    const topLeft = camera.worldToScreen(256 - 384 * 0.435, 192 - 384 * 0.435);
    const bottomRight = camera.worldToScreen(256 + 384 * 0.435, 192 + 384 * 0.435);
    expect(topLeft.x).toBeGreaterThan(0); expect(topLeft.y).toBeGreaterThan(0);
    expect(bottomRight.x).toBeLessThan(width); expect(bottomRight.y).toBeLessThan(height - 200);
    const fitted = camera.zoom, before = camera.screenToWorld(width / 2, height / 2);
    camera.zoomAt(0.9, width / 2, height / 2);
    expect(camera.zoom).toBeLessThan(fitted);
    const after = camera.screenToWorld(width / 2, height / 2);
    expect(after.x).toBeCloseTo(before.x); expect(after.y).toBeCloseTo(before.y);
  });
});

describe('ocean shelves', () => {
  it('follows land edits and returns to open ocean when an island disappears', () => {
    const map = new TerrainMap(48, 48), ocean = new Ocean();
    const colors: string[] = [];
    const drawing = { fillStyle: '', fillRect: () => { colors.push(drawing.fillStyle); } };
    const context = drawing as unknown as CanvasRenderingContext2D;
    map.set(24, 24, Terrain.Grass);
    ocean.update(map); map.dirty.clear();
    ocean.drawTile(context, 25, 24, 1);
    expect(colors.some(color => color !== OCEAN_COLOR)).toBe(true);
    colors.length = 0;
    ocean.drawTile(context, 0, 0, 1);
    expect(colors).toEqual([OCEAN_COLOR]);
    map.set(24, 24, Terrain.DeepWater);
    ocean.update(map);
    expect(map.dirty.size).toBe(map.tiles.length);
    colors.length = 0;
    ocean.drawTile(context, 25, 24, 1);
    expect(colors).toEqual([OCEAN_COLOR]);
  });
});
