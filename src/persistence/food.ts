import { monthTicks } from '../core/calendar';
import { FOODS, isFood } from '../content/food-catalog';
import { newFood } from '../core/food';
import { PLANT_FOODS, plantYield, type PlantFood } from '../core/food-plants';
import { integer, number, record, type RecordValue } from '../core/validation';
import type { Entity, WorldSnapshot } from '../core/types';

export function validFood(v: RecordValue): boolean {
  return integer(v.lastAt, -1) && (v.favorite === undefined || isFood(v.favorite))
    && (v.problem === undefined || ['No suitable food', 'Food is unreachable', 'Not enough money'].includes(String(v.problem)))
    && (v.last === undefined || record(v.last) && isFood(v.last.good) && integer(v.last.at) && v.last.at === v.lastAt
      && number(v.last.amount, Number.MIN_VALUE, 24) && v.last.nutrition === FOODS[v.last.good].nutrition * v.last.amount);
}
export function validFoodPlant(v: RecordValue): boolean {
  return PLANT_FOODS.includes(v.good as PlantFood) && integer(v.remaining, 0, plantYield(v.good as PlantFood))
    && integer(v.createdAt) && integer(v.harvestedAt, -1) && integer(v.ripeAt)
    && v.ripeAt === Math.max(v.createdAt, v.harvestedAt) + monthTicks(18);
}
/** Stockpile migration already converts food minus typed meals into provisions.
 * Preserve that physical ledger verbatim; add no plants, food or preference rolls. */
export function migrateFood(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities)) throw new Error('Invalid food migration');
  for (const e of save.entities as Entity[]) if (e.components.citizen || e.components.animal) e.components.food ??= newFood();
  return { ...save, version: 71 };
}
export function validFoodSave(save: WorldSnapshot): boolean {
  return save.entities.every(e => {
    const state = e.components.food, plant = e.components.foodPlant;
    return (!(e.components.citizen || e.components.animal) || !!state)
      && (!state || validFood(state as unknown as RecordValue) && state.lastAt <= save.tick)
      && (!plant || validFoodPlant(plant as unknown as RecordValue) && plant.createdAt <= save.tick && plant.harvestedAt <= save.tick);
  });
}
