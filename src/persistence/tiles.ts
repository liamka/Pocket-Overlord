import { NATURAL_BIOMES, BIOME_SURFACES } from '../core/natural-biomes';
import { integer, number, record } from '../core/validation';
import { isBridge, type TerrainData } from '../core/types';
import { TILE_TOPS, tileCell } from '../core/tiles';
import { validTileTemperature } from '../core/temperature';

export function validTileLayers(terrain: TerrainData): boolean {
  if (!integer(terrain.visualSeed, 0, 0xffffffff) || !Array.isArray(terrain.layers) || terrain.layers.length > terrain.tiles.length) return false;
  const seen = new Set<number>();
  for (const layer of terrain.layers) {
    if (!record(layer) || !integer(layer.index, 0, terrain.tiles.length - 1) || seen.has(layer.index)
      || Object.keys(layer).some(key => !['index', 'surfaceBiome', 'elevation', 'waterDepth', 'frost', 'top', 'variant', 'temperature', 'burning', 'thermalAt', 'thermalBand', 'thermalFrost', 'heatSource', 'thermalChange', 'lavaStage'].includes(key))) return false;
    seen.add(layer.index);
    if (layer.surfaceBiome !== undefined && (!integer(layer.surfaceBiome, 0, NATURAL_BIOMES.length - 1) || !terrain.surfaces![layer.index])) return false;
    const base = tileCell(terrain.tiles[layer.index], terrain.biomes![layer.index], terrain.surfaces![layer.index], { index: layer.index, surfaceBiome: layer.surfaceBiome as number | undefined });
    if (layer.elevation !== undefined && (!integer(layer.elevation, 0, 5) || !base.land)
      || layer.waterDepth !== undefined && (!integer(layer.waterDepth, 1, 3) || !base.water && !isBridge(base.tile))
      || layer.frost !== undefined && (layer.frost !== 'ice' && layer.frost !== 'snow' || (layer.frost === 'ice') !== base.water || !base.land && !base.water || isBridge(base.tile))
      || layer.top !== undefined && (typeof layer.top !== 'string' || !(TILE_TOPS as readonly string[]).includes(layer.top) || !base.land && !base.water || base.water && layer.top !== 'water-bomb')
      || layer.variant !== undefined && !integer(layer.variant, 0, 65535)
      || !validTileTemperature(layer) || layer.lavaStage !== undefined && (!base.land || base.water || !!layer.frost)
      || layer.burning !== undefined && (!number(layer.burning, Number.MIN_VALUE, 30) || !!layer.frost || base.water)) return false;
    if (layer.burning !== undefined && tileCell(terrain.tiles[layer.index], terrain.biomes![layer.index], terrain.surfaces![layer.index], layer).burn.rate === 0) return false;
  }
  const covers = new Map(terrain.layers.map(layer => [layer.index, layer.surfaceBiome]));
  return terrain.surfaces!.every((surface, i) => integer(surface, 0, BIOME_SURFACES[covers.get(i) ?? terrain.biomes![i]]?.length ?? 0));
}
