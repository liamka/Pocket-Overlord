import type { TerrainMap } from '../core/terrain';
import { NaturalBiome } from '../core/natural-biomes';
import { Terrain } from '../core/types';
import { OCEAN_COLOR } from './ocean';

export function drawWorldPreview(canvas: HTMLCanvasElement, terrain: TerrainMap): void {
  const ctx = canvas.getContext('2d', { alpha: false })!;
  for (let py = 0; py < canvas.height; py++) for (let px = 0; px < canvas.width; px++) {
    const x = Math.floor((px + 0.5) * terrain.width / canvas.width);
    const y = Math.floor((py + 0.5) * terrain.height / canvas.height);
    const tile = terrain.at(x, y), biome = terrain.biomeAt(x, y), surface = terrain.surfaceAt(x, y);
    ctx.fillStyle = tile === Terrain.DeepWater ? OCEAN_COLOR
      : tile === Terrain.Water ? '#529fe2'
      : tile === Terrain.Sand ? '#e2dba0'
      : tile === Terrain.Mountain ? surface?.colors[0] ?? (biome.id === NaturalBiome.Permafrost ? '#9bb8b8' : '#5b6b59')
      : surface?.colors[0] ?? biome.colors[0];
    ctx.fillRect(px, py, 1, 1);
  }
}
