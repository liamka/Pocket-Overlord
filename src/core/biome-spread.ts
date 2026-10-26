import type { TerrainMap } from './terrain';
import type { World } from './world';
import { Random, noise } from './random';
import { biomeDefinition, type NaturalBiome } from './natural-biomes';
import { lawEnabled } from './world-rules';

export interface BiomeClimate { age: string; dominant: readonly NaturalBiome[] }
export const DEFAULT_BIOME_CLIMATE: BiomeClimate = { age: 'normal', dominant: [] };
export const biomeGrowthBlocked = (climate: BiomeClimate): boolean => climate.age === 'ice' || climate.age === 'despair';
export function winsBiomeSpread(source: number, target: number, random: Pick<Random, 'next'>): boolean {
  return source === target ? random.next() < 0.05
    : Math.floor(random.next() * (source + 1)) > Math.floor(random.next() * (target + 1));
}
const neighbours = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
// Fixed radix keeps pending save data stable when future biome IDs are appended.
export const BIOME_CHANGE_BASE = 256;
const count = BIOME_CHANGE_BASE;
export const decodeBiomeChange = (value: number) => ({ index: Math.floor(value / (count * count)), before: Math.floor(value / count) % count, after: value % count });
/** Compute from one immutable view. Independent per-source streams and random claim
 * priorities make forward/reverse traversal identical; new conquests cannot spread again. */
export function collectBiomeChanges(map: TerrainMap, seed: number, climate: BiomeClimate = DEFAULT_BIOME_CLIMATE, reverse = false): number[] {
  if (biomeGrowthBlocked(climate)) return [];
  const winners = new Map<number, { before: number; after: number; priority: number; source: number }>();
  for (let n = 0; n < map.biomes.length; n++) {
    const index = reverse ? map.biomes.length - 1 - n : n, x = index % map.width, y = Math.floor(index / map.width);
    const source = map.biomes[index];
    if (!neighbours.some(([dx, dy]) => map.inside(x + dx, y + dy) && map.biomes[map.index(x + dx, y + dy)] !== source)
      || !map.cell(x, y).plantable) continue;
    const random = new Random(Math.floor(noise(x, y, seed) * 0x100000000));
    for (let attempt = 0; attempt < (climate.dominant.includes(source) ? 2 : 1); attempt++) {
      const [dx, dy] = neighbours[Math.floor(random.next() * neighbours.length)], nx = x + dx, ny = y + dy;
      if (!map.inside(nx, ny) || !map.cell(nx, ny).plantable) continue;
      const target = map.index(nx, ny), before = map.biomes[target];
      if (source === before || !winsBiomeSpread(biomeDefinition(source).ecology.strength, biomeDefinition(before).ecology.strength, random)) continue;
      const priority = random.next(), old = winners.get(target);
      if (!old || priority > old.priority || priority === old.priority && index < old.source) winners.set(target, { before, after: source, priority, source: index });
    }
  }
  return [...winners].sort(([a], [b]) => a - b).map(([index, w]) => index * count * count + w.before * count + w.after);
}
export function applyBiomeChange(world: World, encoded: number): void {
  if (world.paused || !lawEnabled(world, 'biomes-overgrowth') || biomeGrowthBlocked(world.registry.biomeClimate(world))) return;
  const { index, before, after } = decodeBiomeChange(encoded), map = world.terrain;
  const x = index % map.width, y = Math.floor(index / map.width);
  // Recheck delayed work: manual edits, ice and removed ground supersede the proposal.
  if (map.biomes[index] === before && map.cell(x, y).plantable) map.setBiome(x, y, after);
}
