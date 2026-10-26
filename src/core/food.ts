import { FOODS, FOOD_RECIPES, isDish, isFood, type FoodId } from '../content/food-catalog';
import { operational } from './buildings';
import { recordCreatureResult } from './creatures';
import { recordMealHappiness, syncHappiness } from './happiness';
import { metabolizes, physiologyDiet } from './physiology';
import { raceOf } from './races';
import { entries, type Diet, type ResourceBundle, type ResourceId } from './resources';
import { clearStorageApproach, reservedAt, storageOwner, storesOf } from './stockpiles';
import { applyStatus, removeStatus } from './status-effects';
import { acquireTraits } from './traits';
import { nutritionRemaining, preserveNutrition, unitStats } from './unit-stats';
import { publishExperience } from './unit-levels';
import type { Entity, Village } from './types';
import type { World } from './world';

export interface FoodState {
  lastAt: number; favorite?: FoodId;
  last?: { good: FoodId; amount: number; nutrition: number; at: number };
  problem?: 'No suitable food' | 'Food is unreachable' | 'Not enough money';
}
declare module './types' { interface ComponentMap { food: FoodState } }
export const newFood = (): FoodState => ({ lastAt: -1 });
export const canCook = (actor: Entity, good: string): boolean => !isDish(good)
  || FOOD_RECIPES[good].species.includes(actor.components.creature?.speciesId ?? raceOf(actor));
/** Time, combat and reproduction use the same remaining-nutrition scale. */
export function spendNutrition(actor: Entity, amount: number): void {
  if (metabolizes(actor) && Number.isFinite(amount) && amount > 0) preserveNutrition(actor, nutritionRemaining(actor) - amount);
}
export function canEatNow(world: World, actor: Entity): boolean {
  return !world.paused && world.entities.get(actor.id) === actor && (actor.components.health?.current ?? 0) > 0
    && !!(actor.components.citizen || actor.components.animal) && (actor.components.food?.lastAt ?? -1) < world.tick;
}
export function foodOrder(actor: Entity, diet: Diet = physiologyDiet(actor)): FoodId[] {
  const allowed = physiologyDiet(actor), favorite = actor.components.food?.favorite;
  return [...new Set(diet)].filter((id): id is FoodId => isFood(id) && allowed.includes(id))
    .sort((a, b) => Number(b === favorite) - Number(a === favorite) || FOODS[b].taste - FOODS[a].taste);
}
export function foodAt(_world: World, actor: Entity, village: Village, building: Entity, diet: Diet = physiologyDiet(actor)): FoodId | undefined {
  if (storageOwner(building) !== village.id || !operational(building) || building.components.thermal?.burning) return;
  const store = storesOf(village).find(s => s.buildingId === building.id);
  if (!store) return;
  const reserved = reservedAt(store);
  return foodOrder(actor, diet).find(id => (store.goods[id] ?? 0) - (reserved[id] ?? 0) >= 1);
}
export function mealStores(world: World, actor: Entity, village: Village): Entity[] {
  return storesOf(village).map(s => world.entities.get(s.buildingId)).filter((e): e is Entity => !!e && !!foodAt(world, actor, village, e));
}
export function nearbyMeal(world: World, actor: Entity, village: Village, diet?: Diet): { building: Entity; good: FoodId } | undefined {
  if (!actor.components.position) return;
  for (const building of mealStores(world, actor, village)) {
    const good = foodAt(world, actor, village, building, diet);
    if (good && clearStorageApproach(world, actor.components.position, building)) return { building, good };
  }
}
/** Caller owns the finite withdrawal. This single saved receipt closes all meal rewards
 * before traits/status callbacks, healing, preferences and XP can run. No UI calls this. */
export function consumeFood(world: World, actor: Entity, goods: ResourceBundle): boolean {
  const rows = entries(goods).filter(([, n]) => n > 0), allowed = physiologyDiet(actor);
  if (!canEatNow(world, actor) || !rows.length || rows.some(([id, n]) => !isFood(id) || !allowed.includes(id) || !Number.isFinite(n) || n > 24)) return false;
  const state = actor.components.food ??= newFood();
  state.lastAt = world.tick; delete state.problem;
  let nutrition = 0, mood = 0, xp = 0;
  for (const [id, amount] of rows) {
    const good = id as FoodId, profile = FOODS[good];
    // One effect draw per consumed product, independent of portion splitting.
    if (profile.effectChance && (world.rng.next() < profile.effectChance)) {
      if (profile.traits.length && (world.rng.next() < .5)) acquireTraits(world, actor,
        [profile.traits[Math.floor(world.rng.next() * profile.traits.length)]!], 'event', 'Food');
      if (profile.statuses.length && (world.rng.next() < .5)) applyStatus(world, actor,
        profile.statuses[Math.floor(world.rng.next() * profile.statuses.length)]!);
    }
    const stats = unitStats(world, actor).values, health = actor.components.health!, energy = actor.components.stats;
    health.current = Math.min(health.max, health.current + stats.health * profile.health * amount);
    if (energy) {
      energy.mana = Math.min(stats.mana, energy.mana + profile.mana * amount);
      energy.stamina = Math.min(stats.stamina, energy.stamina + profile.stamina * amount);
    }
    nutrition += profile.nutrition * amount; mood += profile.happiness * amount; xp += profile.experience * amount;
    if ((!state.favorite || profile.taste > FOODS[state.favorite].taste) && (world.rng.next() < profile.favoriteChance)) state.favorite = good;
    state.last = { good, amount, nutrition: profile.nutrition * amount, at: world.tick };
  }
  preserveNutrition(actor, nutritionRemaining(actor) + nutrition);
  if (actor.components.physiology) actor.components.physiology.lastMealAt = world.tick;
  recordMealHappiness(world, actor, mood); syncHappiness(world, actor);
  if (xp >= 1) publishExperience(world, actor, 'food', 'Food', Math.floor(xp));
  applyStatus(world, actor, 'just-ate');
  if ((actor.components.citizen?.hunger ?? actor.components.animal?.hunger ?? 0) < 90) removeStatus(world, actor, 'starving', 'condition-ended');
  recordCreatureResult(world, actor, 'fed', null);
  return true;
}
/** A saved travelling bundle is consumed by composition, using the same permissions. */
export function consumePackedFood(world: World, actor: Entity, goods: ResourceBundle, owner?: Village): number {
  if (!canEatNow(world, actor)) return 0;
  const good = foodOrder(actor).find(id => (goods[id] ?? 0) >= 1);
  if (!good) return 0;
  goods[good]!--;
  if (owner?.economy) { owner.economy.spent ??= {}; owner.economy.spent[good] = (owner.economy.spent[good] ?? 0) + 1; }
  consumeFood(world, actor, { [good]: 1 }); return 1;
}
export const foodProfile = (id: ResourceId) => isFood(id) ? FOODS[id] : undefined;
