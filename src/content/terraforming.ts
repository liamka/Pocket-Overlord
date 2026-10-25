import type { PixelSprite, Registry } from './registry';
import type { World } from '../core/world';
import { Terrain, type Entity, type Vec2, type LandChange, type LandEdit } from '../core/types';
import { destroyHome } from '../systems/recovery';

export const LAND_BRUSH_RADIUS = 4;

function landIcon(raise: boolean): PixelSprite {
  const pixels = Array.from({ length: 28 }, () => Array<string>(28).fill('.'));
  const rect = (x: number, y: number, width: number, height: number, color: string): void => {
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) pixels[row][column] = color;
  };
  // Both icons share a waterline; their silhouettes show land being added or removed.
  rect(3, 19, 22, 6, 'w'); rect(1, 21, 26, 3, 'w'); rect(5, 25, 18, 1, 'o');
  rect(2, 20, 5, 1, 'f'); rect(20, 23, 5, 1, 'f'); rect(7, 24, 8, 1, 'b');
  if (raise) {
    // A solid grassy island stands above the sea, with exposed layers of earth.
    rect(6, 17, 16, 6, 'd'); rect(8, 23, 12, 1, 'd');
    rect(5, 14, 17, 6, 'r'); rect(5, 18, 10, 3, 's'); rect(16, 15, 6, 7, 'd');
    rect(7, 18, 7, 1, 'r'); rect(8, 21, 6, 1, 'r'); rect(18, 18, 2, 1, 'r');
    rect(5, 11, 15, 2, 's'); rect(3, 13, 20, 3, 's'); rect(5, 16, 16, 1, 's');
    rect(7, 8, 9, 2, 'g'); rect(5, 10, 14, 2, 'g'); rect(4, 12, 17, 3, 'g');
    rect(7, 8, 8, 1, 'h'); rect(5, 10, 11, 1, 'h'); rect(4, 12, 6, 1, 'h');
    rect(8, 13, 3, 1, 'h'); rect(18, 13, 3, 2, 'G');
    rect(3, 19, 3, 1, 'f'); rect(22, 20, 3, 1, 'f');
    // The large outlined plus remains readable at the toolbar's smallest icon size.
    rect(20, 0, 5, 11, 'k'); rect(17, 3, 11, 5, 'k');
    rect(21, 1, 3, 9, 'a'); rect(18, 4, 9, 3, 'a');
    rect(21, 1, 1, 3, 'A'); rect(18, 4, 9, 1, 'A');
  } else {
    // Broken grassy banks frame the blue opening left by the sunken ground.
    rect(4, 10, 19, 11, 'd'); rect(2, 12, 24, 6, 'r');
    rect(7, 13, 14, 9, 'o'); rect(9, 12, 10, 1, 'd');
    rect(5, 9, 13, 3, 'g'); rect(2, 12, 6, 3, 'g'); rect(21, 12, 5, 4, 'g');
    rect(5, 9, 11, 1, 'h'); rect(2, 12, 5, 1, 'h'); rect(22, 12, 4, 1, 'h');
    rect(3, 15, 4, 2, 's'); rect(22, 16, 3, 2, 's'); rect(4, 18, 2, 2, 'd');
    rect(10, 13, 8, 3, 'b'); rect(8, 16, 12, 3, 'b'); rect(6, 19, 16, 5, 'b');
    rect(10, 13, 3, 1, 'f'); rect(14, 16, 5, 1, 'f'); rect(8, 20, 5, 1, 'f');
    rect(7, 23, 14, 1, 'w'); rect(15, 22, 3, 1, 'f');
    rect(17, 3, 11, 5, 'k'); rect(18, 4, 9, 3, 'a'); rect(18, 4, 9, 1, 'A');
  }
  return { pixels: pixels.map(row => row.join('')),
    palette: { k: '#172c30', a: raise ? '#f3c954' : '#ef9162', A: raise ? '#fff1a9' : '#ffdb9d',
      h: '#b3d86b', g: '#6fa946', G: '#447439', s: '#dfbf7b', r: '#a97843', d: '#60482f',
      o: '#184766', w: '#276f9f', b: '#469fd3', f: '#a7e7ee' }, anchor: { x: 14, y: 14 } };
}

/** Apply the ground immediately; the visual transition never delays navigation or saving. */
export function shapeLand(world: World, point: Vec2, mode: LandEdit['mode']): void {
  const map = world.terrain, tiles: LandChange[] = [];
  map.circle(point.x, point.y, LAND_BRUSH_RADIUS, (x, y, index) => {
    const from = map.tiles[index];
    if ((from < Terrain.Sand) !== (mode === 'raise')) return;
    const to = mode === 'raise' ? Terrain.Grass : Terrain.Water;
    tiles.push({ x, y, from, to });
    map.surfaces[index] = 0;
    map.set(x, y, to);
  });
  if (!tiles.length) return;
  if (mode === 'raise') {
    // New islands get a sandy rim; existing inland ground keeps its terrain and biome.
    for (const tile of tiles) if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => !map.isLand(tile.x + dx, tile.y + dy))) {
      tile.to = Terrain.Sand; map.set(tile.x, tile.y, tile.to);
    }
  } else {
    const submerged = new Set(tiles.map(tile => map.index(tile.x, tile.y)));
    const lost: Entity[] = [];
    for (const entity of world.query('position')) {
      const p = entity.components.position!, c = entity.components;
      if (submerged.has(map.index(p.x, p.y)) && (c.dwelling || c.farm || c.ruin || c.harbor || c.workplace || entity.typeId === 'core:tree')) lost.push(entity);
    }
    for (const entity of lost) {
      if (entity.components.dwelling) destroyHome(world, entity);
      else world.remove(entity.id);
    }
  }
  world.visual({ kind: 'terraform', ...point, radius: LAND_BRUSH_RADIUS, mode, tiles });
}

export function registerTerraforming(registry: Registry): void {
  for (const mode of ['raise', 'lower'] as const) registry.registerTool({
    id: `core:${mode}-land`, category: 'biomes', label: mode === 'raise' ? 'Raise land' : 'Lower land',
    hint: mode === 'raise' ? 'Click or drag to raise islands from the sea.' : 'Click or drag to sink land and open waterways.',
    paintHint: 'Wheel: zoom · Left-drag: shape land · Right-drag: pan',
    radius: LAND_BRUSH_RADIUS, color: mode === 'raise' ? '#c4dc86' : '#8ae1ee', icon: landIcon(mode === 'raise'),
    paint: true, continuous: true,
    canApply: (world, p) => {
      let suitable = false;
      world.terrain.circle(p.x, p.y, LAND_BRUSH_RADIUS, (_x, _y, i) => {
        if ((world.terrain.tiles[i] < Terrain.Sand) === (mode === 'raise')) suitable = true;
      });
      return suitable;
    },
    apply: (world, p) => shapeLand(world, p, mode),
  });
}
