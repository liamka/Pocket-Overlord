import type { ResourceBundle, ResourceId } from '../core/resources';
import type { StatusId } from './status-effects';

export const FOOD_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Food?oldid=23158';
export interface FoodProfile {
  nutrition: number; health: number; mana: number; stamina: number; happiness: number; experience: number;
  taste: number; favoriteChance: number; effectChance: number; traits: readonly string[]; statuses: readonly StatusId[];
}
// Reference nutrition/restoration/taste; probabilities and effect durations are Pocket
// Overlord balance. The wiki's GC order is disputed: we grant traits BEFORE statuses.
const food = (nutrition: number, health: number, mana: number, stamina: number, happiness: number, experience: number,
  taste: number, traits: string[] = [], statuses: StatusId[] = [], effectChance = 0): FoodProfile =>
  ({ nutrition, health: health / 100, mana, stamina, happiness, experience, taste, favoriteChance: 0.2, effectChance, traits, statuses });
export const FOODS = {
  bananas: food(25, 40, 15, 10, 10, 5, .55), // No obsolete Unlucky effect.
  coconut: food(30, 45, 15, 10, 15, 10, .55, [], ['shield'], .1),
  berries: food(30, 35, 15, 10, 12, 5, .55),
  desertBerries: food(25, 35, 15, 10, 12, 5, .55, ['poison-immunity'], ['poisoned', 'slowness'], .1),
  lemons: food(20, 30, 10, 10, 10, 5, .2, ['eagle-eyed', 'regeneration'], [], .1),
  mushrooms: food(20, 40, 15, 15, 15, 5, .2, ['madness', 'strong-minded', 'paranoid', 'content'], ['powerup', 'slowness'], .1),
  herbs: food(25, 50, 25, 10, 5, 5, .1),
  peppers: food(30, 40, 25, 15, 20, 5, .3, ['fire-proof', 'fire-blood'], ['burning'], .1),
  pineCones: food(15, 15, 10, 10, 10, 5, .1, ['frost-proof', 'tough', 'strong', 'regeneration'], ['frozen'], .1),
  snowCucumbers: food(30, 35, 25, 10, 10, 5, .2, ['frost-proof'], ['frozen'], .1),
  grain: food(50, 5, 5, 5, 5, 0, .1), bread: food(100, 10, 10, 10, 10, 10, .5),
  candy: food(40, 40, 25, 10, 40, 5, 1, ['tiny', 'giant', 'bloodlust', 'fat'], [], .1),
  celestialAvocado: food(100, 55, 50, 50, 50, 10, 1.1, ['sunblessed'], [], .1),
  evilBeets: food(25, 40, 15, 25, 15, 5, .1, ['pyromaniac', 'evil'], [], .1),
  crystalSalt: food(20, 20, 20, 10, 10, 5, .2, ['madness', 'strong-minded'], ['caffeinated', 'slowness'], .1),
  fish: food(50, 30, 25, 10, 15, 5, .25, ['tough', 'strong'], [], .1),
  meat: food(50, 50, 10, 25, 20, 5, .5, ['tough', 'strong'], [], .1),
  honey: food(15, 45, 10, 25, 35, 10, .5), worms: food(10, 20, 10, 10, -5, 5, .1),
  pie: food(100, 40, 35, 25, 25, 10, .9, ['fat'], ['slowness'], .05),
  cider: food(55, 25, 25, 25, 20, 10, .7),
  jam: food(100, 40, 40, 40, 25, 15, .9, ['regeneration'], [], .1),
  sushi: food(70, 20, 20, 20, 20, 5, .6, ['fast'], [], .1),
  ale: food(45, 20, 20, 20, 20, 10, .6, ['poison-immunity'], ['slowness'], .4),
  burger: food(100, 40, 25, 35, 25, 9, .85, ['fat'], ['slowness'], .05),
  tea: food(20, 25, 40, 10, 10, 10, .3, [], ['caffeinated'], .1),
  wood: food(50, 45, 15, 15, 10, 0, .2),
  // Bone restoration is undocumented. Explicit local balance: 20 nutrition only.
  bone: food(20, 0, 0, 0, 0, 0, .3), gems: food(35, 30, 15, 25, 15, 0, 1),
  stone: food(20, 20, 10, 10, 5, 0, .1), commonMetal: food(35, 30, 15, 15, 10, 0, .2),
  silver: food(35, 30, 25, 15, 20, 0, .4), mythril: food(45, 40, 30, 25, 25, 0, .6),
  adamantine: food(55, 50, 45, 40, 35, 0, .8),
  provisions: food(45, 0, 2, 10, 10, 0, 0), // Preserved legacy stock, never newly seeded.
} satisfies Partial<Record<ResourceId, FoodProfile>>;
export type FoodId = keyof typeof FOODS;
export const isFood = (id: unknown): id is FoodId => typeof id === 'string' && Object.hasOwn(FOODS, id);
const recipe = (species: readonly string[], inputs: ResourceBundle, output: FoodId) =>
  ({ station: 'bakery' as const, species, inputs, work: 4, outputs: { [output]: 1 } as ResourceBundle });
// Species capabilities, not fixed preferences. Cultures can extend this in their owner.
export const FOOD_RECIPES = {
  pie: recipe(['human'], { meat: 1, grain: 1 }, 'pie'),
  cider: recipe(['elf'], { berries: 3 }, 'cider'),
  jam: recipe(['elf'], { berries: 2, herbs: 2 }, 'jam'),
  sushi: recipe(['elf'], { fish: 1, herbs: 1 }, 'sushi'),
  ale: recipe(['dwarf'], { grain: 3 }, 'ale'),
  burger: recipe(['orc'], { meat: 1, bread: 1, herbs: 1 }, 'burger'),
  tea: recipe(['orc'], { herbs: 1 }, 'tea'),
} as const;
export type DishId = keyof typeof FOOD_RECIPES;
export const isDish = (id: string): id is DishId => Object.hasOwn(FOOD_RECIPES, id);
