import type { World } from './world';
import { BIOME_BALANCE, type BiomeMineral } from '../content/biome-profiles';
import { biomeDefinition, NaturalBiome } from './natural-biomes';
import { Random } from './random';
import { Terrain, type Vec2, type Entity } from './types';
import { canPlaceSilver } from '../content/silver';
import { spawnGemSource } from './gems';
import { canPlaceGold, placeGoldOre } from '../content/gold';

/** Mine producers use the same lottery but may reach all four base ores.
 * The returned material is a source choice, never a stock deposit or a delivery. */
export function biomeMineralWeights(biome: NaturalBiome, mine = false): Partial<Record<BiomeMineral, number>> {
  const weights = { ...biomeDefinition(biome).ecology.minerals };
  // Mine revision 22293: relative base weights, plus our existing biome profiles.
  // Keep Corrupted's bone source; natural generation keeps its separate budgets.
  if (mine) for (const [id, weight] of Object.entries({ stone: 20, commonMetal: 10, gold: 4, gems: 1 }) as [BiomeMineral, number][])
    weights[id] = (weights[id] ?? 0) + weight;
  return weights;
}
export function selectBiomeMineral(biome: NaturalBiome, random: Pick<Random, 'next'>, mine = false, rare = false): BiomeMineral | undefined {
  const weights = biomeMineralWeights(biome, mine);
  // Our sparse generation has separate stone/rare budgets. Relative weights apply
  // within each stratum; rare ores do not add any extra stone placement attempts.
  if (rare) delete weights.stone;
  const entries = Object.entries(weights) as [BiomeMineral, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return;
  let draw = random.next() * total;
  for (const [id, weight] of entries) { draw -= weight; if (draw < 0) return id; }
}
export function mineralSite(world: World, p: Vec2): boolean {
  const tile = world.terrain.at(p.x, p.y);
  return (tile === Terrain.Grass || tile === Terrain.Sand) && canPlaceSilver(world, p);
}
export function spawnBiomeMineral(world: World, p: Vec2, random: Pick<Random, 'next'>, origin: 'natural' | 'mine', rare = false): Entity | undefined {
  if (world.paused || !mineralSite(world, p) || origin === 'mine' && !canPlaceGold(world, p)) return;
  const biome = world.terrain.biomeAt(p.x, p.y).id, resource = selectBiomeMineral(biome, random, origin === 'mine', rare);
  return resource && spawnMineral(world, p, resource, origin, biome);
}
export const MINERAL_ENTITIES: Record<BiomeMineral, string> = {
  stone: 'core:stone', commonMetal: 'core:common-metal', gold: 'core:gold-ore', gems: 'core:gem-ore', silver: 'core:silver-ore', bone: 'core:bone-deposit',
};
/** A producer chooses once, using its own anchor biome. No replacement lottery on failure. */
export function spawnMineral(world: World, p: Vec2, resource: BiomeMineral, origin: 'natural' | 'mine', biome: NaturalBiome): Entity | undefined {
  if (world.paused || !world.registry.entities.has(MINERAL_ENTITIES[resource]) || !mineralSite(world, p)
    || origin === 'mine' && !canPlaceGold(world, p) || origin === 'natural' && resource === 'gold') return;
  let entity: Entity | undefined;
  if (resource === 'gems') entity = spawnGemSource(world, p, origin);
  else if (resource === 'gold') entity = placeGoldOre(world, p, 'mine');
  else entity = world.spawn(MINERAL_ENTITIES[resource], p);
  const source = entity && (entity.components.stone ?? entity.components.commonMetal ?? entity.components.gemSource);
  if (source) Object.assign(source, { origin, biome });
  return entity;
}
/** Creation only. Stone retains its original independent stream and /240 budget. */
export function seedBiomeDeposits(world: World): void {
  const random = new Random(world.seed ^ 0xb1044), { width, height } = world.terrain;
  for (let i = 0; i < Math.floor(width * height / BIOME_BALANCE.mineralArea); i++) {
    const p = { x: random.range(1, width - 1), y: random.range(1, height - 1) };
    spawnBiomeMineral(world, p, random, 'natural', true);
  }
  // Crystal plants belong to flora, not the natural ore lottery.
  const plants = new Random(world.seed ^ 0x6e3a);
  for (let i = 0; i < Math.floor(width * height / BIOME_BALANCE.crystalPlantArea); i++) {
    const p = { x: plants.range(1, width - 1), y: plants.range(1, height - 1) };
    if (world.terrain.biomeAt(p.x, p.y).id === NaturalBiome.Crystal) spawnGemSource(world, p, 'natural', 'plant');
  }
}
