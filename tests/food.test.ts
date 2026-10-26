import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { FOOD_RECIPES, type DishId } from '../src/content/food-catalog';
import { buyMeal, walletOf } from '../src/core/currency';
import { consumeFood } from '../src/core/food';
import { foodPlants, harvestFoodPlant } from '../src/core/food-plants';
import { deposit, stockContents, stockOf, withdraw } from '../src/core/resource-ledger';
import { initializeStorage } from '../src/core/stockpiles';
import { hasStatus } from '../src/core/status-effects';
import { hasTrait } from '../src/core/traits';
import { World } from '../src/core/world';
import { RACES, type RaceId } from '../src/core/races';
import { decodeSave } from '../src/persistence/schema';
import { continueVillageWork } from '../src/systems/economy';
import { assignHouse } from '../src/systems/society';
import { foodInspector } from '../src/ui/food';
import type { ResourceBundle } from '../src/core/resources';

function fixture(race: RaceId = 'human') {
  const world = flatWorld(), home = world.spawn('core:house', { x: 20, y: 20 })!;
  home.components.dwelling!.race = race;
  const village = assignHouse(world, home), actor = world.spawn(RACES[race].entityId, { x: 18.4, y: 20 })!;
  actor.components.person!.age = 30;
  Object.assign(actor.components.citizen!, { villageId: village.id, hunger: 90 });
  initializeStorage(world, village); withdraw(village, stockContents(village), 'transfer');
  return { world, home, village, actor };
}

describe('food transactions', () => {
  it('preserves legacy provisions and bread exactly, with no new plants or random draws', () => {
    const { world, village } = fixture(); deposit(village, { provisions: 6, bread: 4 });
    const old = world.snapshot(); old.version = 70;
    for (const e of old.entities) delete e.components.food;
    const restored = decodeSave(old, world.registry);
    expect(restored.society.villages[0].food).toBe(10);
    expect(restored.society.villages[0].economy!.storage![0].goods).toMatchObject({ provisions: 6, bread: 4 });
    expect(restored.rngState).toBe(old.rngState); expect(restored.entities).toHaveLength(old.entities.length);
  });
  it('falls back from an absent favorite and closes healing, payment and XP before replay', () => {
    const { world, village, actor } = fixture(); deposit(village, { berries: 2 });
    actor.components.food!.favorite = 'pie'; actor.components.health!.current = 10;
    expect(buyMeal(world, actor, village)).toBe(1);
    const after = structuredClone(actor.components), copy = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    expect(buyMeal(world, actor, village)).toBe(0); expect(actor.components).toEqual(after);
    expect(buyMeal(copy, copy.entities.get(actor.id)!, copy.society.villages[0])).toBe(0);
    expect(stockOf(village, 'berries')).toBe(1); expect(actor.components.citizen!.hunger).toBe(60);
    expect(actor.components.stats!.experience.last?.source).toBe('food');
  });
  it('keeps diet permissions when starving and never consumes from a distant store', () => {
    const { world, village, actor } = fixture(); deposit(village, { stone: 2, bread: 2 });
    expect(buyMeal(world, actor, village, 1, ['stone'])).toBe(0);
    actor.components.position!.x = 10;
    expect(buyMeal(world, actor, village)).toBe(0);
    expect(stockOf(village, 'stone')).toBe(2); expect(stockOf(village, 'bread')).toBe(2);
  });
  it('does not spend food or currency on pause, failed payment or a dead consumer', () => {
    const { world, village, actor } = fixture(); deposit(village, { bread: 2 });
    actor.components.citizen!.hunger = 60;
    expect(buyMeal(world, actor, village)).toBe(0); walletOf(world, actor).money = 10;
    world.paused = true; expect(buyMeal(world, actor, village)).toBe(0); world.paused = false;
    expect(walletOf(world, actor).money).toBe(10);
    world.remove(actor.id); expect(buyMeal(world, actor, village)).toBe(0); expect(stockOf(village, 'bread')).toBe(2);
  });
  it('grants poison immunity before attempting poison in the same meal', () => {
    const { world, actor } = fixture(); world.rng.next = () => 0;
    expect(consumeFood(world, actor, { desertBerries: 1 })).toBe(true);
    expect(hasTrait(actor, 'poison-immunity')).toBe(true); expect(hasStatus(actor, 'poisoned')).toBe(false);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('does not mature a saved empty plant early, on pause or during winter', () => {
    const { world, actor } = fixture(); world.tick = 1800;
    const plant = world.spawn('core:food-plant', { x: 16.8, y: 20 })!;
    Object.assign(plant.components.foodPlant!, { createdAt: 1800, ripeAt: 12600, remaining: 3 });
    world.rng.next = () => .9;
    expect(harvestFoodPlant(world, actor, plant)).toEqual({ berries: 3 });
    expect(harvestFoodPlant(world, actor, plant)).toBeUndefined();
    const copy = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    const restored = copy.entities.get(plant.id)!;
    copy.tick = 12570; foodPlants(copy); expect(restored.components.foodPlant!.remaining).toBe(0);
    copy.tick = 12600; foodPlants(copy); expect(restored.components.foodPlant!.remaining).toBe(0);
    copy.tick = 14400; copy.paused = true; foodPlants(copy); expect(restored.components.foodPlant!.remaining).toBe(0);
    copy.paused = false; foodPlants(copy); expect(restored.components.foodPlant!.remaining).toBe(3);
  });
  it('keeps inspection free of food effects, preferences and random draws', () => {
    const { world, actor } = fixture(), before = world.snapshot();
    foodInspector(world, actor, 'ru', true); foodInspector(world, actor, 'ru', true);
    expect(world.snapshot()).toEqual(before);
  });
  for (const dish of Object.keys(FOOD_RECIPES) as DishId[]) {
    const recipe = FOOD_RECIPES[dish];
    it(`cooks ${dish} into cargo, rejects each missing ingredient and a forbidden producer atomically`, () => {
      for (const missing of [undefined, ...Object.keys(recipe.inputs), 'producer']) {
        const allowed = recipe.species[0] as RaceId;
        const { world, village, actor } = fixture(missing === 'producer' ? allowed === 'human' ? 'elf' : 'human' : allowed);
        actor.components.citizen!.hunger = 0;
        const station = world.spawn('core:bakery', { x: 16.8, y: 20 })!;
        station.components.workplace!.villageId = village.id;
        const goods: ResourceBundle = { ...recipe.inputs }; if (missing && missing !== 'producer') delete goods[missing as keyof ResourceBundle];
        deposit(village, goods); const before = stockContents(village);
        Object.assign(actor.components.citizen!, { task: 'work', targetId: station.id, path: [], work: { good: dish, progress: 0, cargo: null } });
        for (let i = 0; i < 10 && !actor.components.citizen!.work?.cargo; i++) { world.tick += 15; continueVillageWork(world, actor); }
        if (missing) { expect(actor.components.citizen!.work?.cargo).toBeFalsy(); expect(stockContents(village)).toEqual(before); }
        else { expect(actor.components.citizen!.work?.cargo).toMatchObject({ good: dish, amount: 1 }); expect(stockOf(village, dish)).toBe(0); }
      }
    });
  }
});
