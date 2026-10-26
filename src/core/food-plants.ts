import { monthTicks } from './calendar';
import { NaturalBiome } from './natural-biomes';
import { noise } from './random';
import { seasonAt } from './seasons';
import { clearStorageApproach } from './stockpiles';
import { Terrain, type Entity, type Vec2 } from './types';
import type { World } from './world';
import type { FoodId } from '../content/food-catalog';
import { SOURCE_PROFILES, type ResourceBundle } from './resources';

// Berries: 18 months and 20% disappearance from Food. Other plant regrowth uses the same local balance.
export const PLANT_FOODS = ['berries', 'bananas', 'coconut', 'desertBerries', 'lemons', 'mushrooms', 'herbs', 'peppers',
  'pineCones', 'snowCucumbers', 'grain', 'candy', 'evilBeets', 'worms'] as const satisfies readonly FoodId[];
export type PlantFood = typeof PLANT_FOODS[number];
export interface FoodPlant { good: PlantFood; remaining: number; ripeAt: number; createdAt: number; harvestedAt: number }
declare module './types' { interface ComponentMap { foodPlant: FoodPlant } }
export const plantYield = (good: PlantFood): number => good === 'berries' ? SOURCE_PROFILES.bush.outputs.berries! : 1;
export const plantContents = (e: Entity): ResourceBundle => ({ [e.components.foodPlant!.good]: e.components.foodPlant!.remaining });
const biomeFoods: Partial<Record<NaturalBiome, readonly PlantFood[]>> = {
  [NaturalBiome.Grassland]: ['berries', 'herbs'], [NaturalBiome.Savanna]: ['grain', 'berries', 'herbs'],
  [NaturalBiome.Desert]: ['desertBerries'], [NaturalBiome.Jungle]: ['bananas', 'berries', 'herbs'],
  [NaturalBiome.Swamp]: ['mushrooms', 'herbs'], [NaturalBiome.Permafrost]: ['pineCones', 'snowCucumbers'],
  [NaturalBiome.Enchanted]: ['berries', 'herbs'], [NaturalBiome.Corrupted]: ['evilBeets'],
  [NaturalBiome.Infernal]: ['peppers'], [NaturalBiome.Mushroom]: ['mushrooms', 'berries'],
  [NaturalBiome.Candy]: ['candy'], [NaturalBiome.Lemon]: ['lemons', 'berries'],
};
export function plantFoodAt(world: World, p: Vec2): PlantFood | undefined {
  if (!world.safeLand(p) || world.terrain.at(p.x, p.y) !== Terrain.Grass && world.terrain.at(p.x, p.y) !== Terrain.Sand) return;
  const biome = world.terrain.biomeAt(p.x, p.y).id;
  if (world.terrain.surfaceAt(p.x, p.y)?.kind === 'soil' && biome !== NaturalBiome.Crystal) return 'worms';
  if (world.terrain.at(p.x, p.y) === Terrain.Sand && [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => world.terrain.isOpenWater(p.x + dx, p.y + dy))) return 'coconut';
  const choices = biomeFoods[biome];
  return choices?.[Math.floor(noise(Math.floor(p.x), Math.floor(p.y), world.seed ^ 5252) * choices.length)];
}
export function plantFood(world: World, p: Vec2): Entity | undefined {
  const good = plantFoodAt(world, p);
  if (!good || !world.canStand(p, .4) || world.nearby(p, 1.4).length) return;
  const e = world.spawn('core:food-plant', p);
  if (e) Object.assign(e.components.foodPlant!, { good, remaining: 0, createdAt: world.tick, harvestedAt: -1,
    ripeAt: world.tick + monthTicks(18) });
  return e;
}
/** New worlds only. Loading never seeds an extra harvest. Density is local balance. */
export function seedFoodPlants(world: World): void {
  let count = 0;
  for (let y = 4; y < world.terrain.height - 4 && count < 240; y += 3) for (let x = 4; x < world.terrain.width - 4 && count < 240; x += 3) {
    if (noise(x, y, world.seed ^ 5200) < .04 && plantFood(world, { x: x + .5, y: y + .5 })) count++;
  }
}
/** One finite handoff. Everyone arriving later observes the same empty plant. */
export function harvestFoodPlant(world: World, actor: Entity, source: Entity, handoff?: (goods: ResourceBundle) => void): ResourceBundle | undefined {
  const p = source.components.foodPlant;
  if (world.paused || !p || p.remaining <= 0 || !actor.components.position || !source.components.position
    || world.entities.get(actor.id) !== actor || world.entities.get(source.id) !== source
    || (actor.components.health?.current ?? 0) <= 0 || (source.components.health?.current ?? 0) <= 0
    || source.components.thermal?.burning || !world.terrain.isLand(source.components.position.x, source.components.position.y)
    || !clearStorageApproach(world, actor.components.position, source)) return;
  const goods = plantContents(source);
  p.remaining = 0; p.harvestedAt = world.tick; p.ripeAt = world.tick + monthTicks(18);
  handoff?.(goods); // Publish carried ownership before removal cancels other source claims.
  if (p.good === 'worms' || p.good === 'berries' && (world.rng.next() < .2)) world.remove(source.id);
  return goods;
}
export function foodPlants(world: World): void {
  if (world.paused || world.tick % 30) return;
  for (const e of world.query('foodPlant', 'position')) {
    const p = e.components.position!, plant = e.components.foodPlant!;
    if (!world.terrain.isLand(p.x, p.y) || (e.components.health?.current ?? 0) <= 0) { world.remove(e.id); continue; }
    if (!plant.remaining && world.tick >= plant.ripeAt && seasonAt(world.tick).growth > 0 && !e.components.thermal?.burning) plant.remaining = plantYield(plant.good);
  }
}
