import { describe, expect, it } from 'vitest';
import { SEASON_TICKS, foodReserve, seasonAt, yearAt } from '../src/core/seasons';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { agriculture, assignHouse, villages } from '../src/systems/society';
import { intentions } from '../src/systems/people';
import { dispatchCaravan } from '../src/systems/caravans';
import { setFood, advance, diplomaticWorld, flatWorld } from './helpers';

function farmWorld(tick: number) {
  const world = flatWorld(), home = world.spawn('core:house', { x: 20, y: 20 })!;
  const village = assignHouse(world, home), field = world.spawn('core:farm', { x: 24, y: 20 })!;
  field.components.farm!.villageId = village.id;
  const worker = world.spawn('core:person', { x: 24, y: 21 })!;
  worker.components.person!.homeId = home.id;
  worker.components.person!.reproduceIn = 100000;
  Object.assign(worker.components.citizen!, { villageId: village.id, task: 'farm', targetId: field.id });
  village.migrationAfter = 100000; world.tick = tick;
  return { world, village, field, worker, home };
}

describe('seasons and food reserves', () => {
  it('cycles four seasons and increments the year on saved simulation time', () => {
    expect([0, 1799, 1800, 3600, 5400, 7200].map(t => seasonAt(t).id)).toEqual(['spring', 'spring', 'summer', 'autumn', 'winter', 'spring']);
    expect(yearAt(7199)).toBe(1); expect(yearAt(7200)).toBe(2);
    expect(SEASON_TICKS).toBe(1800);
  });

  it('grows faster in summer, harvests more in autumn, and leaves winter fields dormant', () => {
    const spring = farmWorld(30), summer = farmWorld(1830), autumn = farmWorld(3630), winter = farmWorld(5400);
    agriculture(spring.world); agriculture(summer.world);
    expect(summer.field.components.farm!.growth).toBeGreaterThan(spring.field.components.farm!.growth);
    for (const scene of [spring, autumn, winter]) {
      scene.field.components.farm!.growth = 1; const before = scene.village.food;
      agriculture(scene.world);
      expect(scene.village.food - before).toBe(scene === spring ? 8 : scene === autumn ? 12 : 0);
    }
    expect(winter.field.components.farm!.growth).toBeLessThan(1);
    expect(winter.field.components.farm!.harvests).toBe(0);
    winter.world.remove(winter.field.id); villages(winter.world);
    expect([...winter.world.query('farm')]).toHaveLength(0);
    winter.world.tick = 7200; villages(winter.world);
    expect([...winter.world.query('farm')]).toHaveLength(1);
  });

  it('consumes stored food in winter and increases hunger without creating supplies', () => {
    const scene = farmWorld(5400), c = scene.worker.components.citizen!;
    Object.assign(scene.worker.components.position!, { x: 22, y: 20 }); scene.world.spatial.update(scene.worker);
    Object.assign(c, { task: 'eat', targetId: scene.home.id, hunger: 60 }); setFood(scene.village, 1);
    intentions(scene.world);
    expect(scene.village.food).toBe(0); expect(c.hunger).toBeCloseTo(15.66);
    c.hunger = 89.9; intentions(scene.world);
    expect(scene.world.events.some(e => e.kind === 'damage' && e.target === scene.worker.id)).toBe(true);
    expect(scene.village.food).toBe(0);
  });

  it('keeps winter food at home and ships only the surplus', () => {
    for (const tick of [3600, 5400]) {
      const world = diplomaticWorld(2); world.tick = tick;
      const from = world.society.villages[0], reserve = foodReserve(tick, 4);
      expect(reserve).toBeGreaterThan(foodReserve(0, 4));
      setFood(from, reserve); expect(dispatchCaravan(world, 1, 2)).toBe(false);
      setFood(from, from.food + 3); expect(dispatchCaravan(world, 1, 2)).toBe(true);
      expect(from.food).toBe(reserve); expect([...world.query('caravan')][0].components.caravan!.food).toBe(3);
    }
  });

  it('freezes the calendar on pause and restores the same winter and spring continuation', () => {
    const { world } = farmWorld(7190); world.paused = true;
    const save = decodeSave(world.snapshot(), world.registry), restored = new World(save.seed, world.registry, save);
    advance(restored, 10); expect(restored.snapshot()).toEqual(save); expect(seasonAt(restored.tick).id).toBe('winter');
    world.paused = false; restored.paused = false;
    advance(world, 10); advance(restored, 10);
    expect(restored.snapshot()).toEqual(world.snapshot()); expect(seasonAt(restored.tick).id).toBe('spring'); expect(yearAt(restored.tick)).toBe(2);
  });
});
