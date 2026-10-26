import { FOODS, FOOD_RECIPES, isFood } from '../content/food-catalog';
import { canCook, mealStores } from '../core/food';
import { physiologyDiet } from '../core/physiology';
import { entries, type ResourceBundle } from '../core/resources';
import { reservedAt, storesOf } from '../core/stockpiles';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { resourceName, resourceText } from '../render/resources';
import { translate, type Language } from '../i18n';

const escape = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function foodInspector(world: World, actor: Entity, language: Language, open: boolean): string {
  const state = actor.components.food;
  if (!state) return '';
  const tr = (s: string, values?: Record<string, string | number>) => escape(translate(s, language, values));
  const diet = physiologyDiet(actor), village = world.society.villages.find(v => v.id === (actor.components.citizen?.villageId ?? actor.components.animal?.villageId));
  const available: ResourceBundle = {};
  if (village) for (const store of storesOf(village)) {
    const held = reservedAt(store);
    for (const [id, n] of entries(store.goods)) available[id] = (available[id] ?? 0) + Math.max(0, n - (held[id] ?? 0));
  }
  let html = `<details data-food${open ? ' open' : ''}><summary>${tr('Food and diet')}</summary>`;
  html += `<p>${tr('Diet: {goods}', { goods: diet.map(id => resourceName(id, language)).join(', ') || translate('No suitable food', language) })}</p>`;
  html += `<p>${tr('Favorite food: {food}', { food: state.favorite ? resourceName(state.favorite, language) : translate('None yet', language) })}</p>`;
  if (state.favorite && !(available[state.favorite]! >= 1)) html += `<p>${tr('Favorite unavailable: other permitted food is accepted.')}</p>`;
  if (village && !mealStores(world, actor, village).length) html += `<p>${tr('No suitable food')}</p>`;
  if (state.problem) html += `<p>${tr(state.problem)}</p>`;
  if (state.last) html += `<p>${tr('Last meal: {food} · Nutrition +{amount}', { food: resourceName(state.last.good, language), amount: Math.round(state.last.nutrition * 100) / 100 })}</p>`;
  html += `<details data-food-values><summary>${tr('Food properties')}</summary>`;
  for (const id of diet.filter(isFood)) {
    const p = FOODS[id];
    html += `<p>${escape(resourceName(id, language))}: ${tr('Nutrition {n} · Health {h}% · Mana {m} · Stamina {s} · Happiness {v} · Experience {x}',
      { n: p.nutrition, h: Math.round(p.health * 100), m: p.mana, s: p.stamina, v: p.happiness, x: p.experience })}</p>`;
  }
  html += '</details>';
  if (actor.components.citizen) {
    html += `<details data-food-recipes><summary>${tr('Cooking')}</summary>`;
    for (const [id, recipe] of Object.entries(FOOD_RECIPES)) {
      const missing = Object.fromEntries(entries(recipe.inputs).map(([id, n]) => [id, Math.max(0, n - (available[id] ?? 0))])) as ResourceBundle;
      const reason = !canCook(actor, id) ? tr('This species cannot prepare this dish') : entries(missing).some(([, n]) => n > 0)
        ? tr('Missing cooking ingredients: {goods}', { goods: resourceText(missing, language) }) : tr('Ingredients available; requires a working bakery');
      html += `<p>${escape(resourceName(id as keyof typeof FOOD_RECIPES, language))} · ${escape(resourceText(recipe.inputs, language))} · ${reason}</p>`;
    }
    html += '</details>';
  }
  return html + '</details>';
}
