import { describe, expect, it } from 'vitest';
import { calendarAt, DAY_TICKS, MONTH_TICKS, MONTHS, YEAR_TICKS } from '../src/core/calendar';
import { FixedClock } from '../src/core/clock';
import { seasonAt } from '../src/core/seasons';
import { initializeStorage } from '../src/core/stockpiles';
import { World } from '../src/core/world';
import { languages, translate } from '../src/i18n';
import { decodeSave } from '../src/persistence/schema';
import { governance } from '../src/systems/governance';
import { agriculture, assignHouse } from '../src/systems/society';
import { calendarDate } from '../src/ui/calendar';
import { flatWorld } from './helpers';

function settlement(tick: number) {
  const world = flatWorld(), home = world.spawn('core:house', { x: 20, y: 20 })!;
  const village = assignHouse(world, home), field = world.spawn('core:farm', { x: 24, y: 20 })!;
  field.components.farm!.villageId = village.id;
  const worker = world.spawn('core:person', { x: 24, y: 21 })!;
  Object.assign(worker.components.person!, { age: 24, homeId: home.id, reproduceIn: 100000, buildIn: 100000 });
  Object.assign(worker.components.citizen!, { villageId: village.id, task: 'farm', targetId: field.id });
  const elder = world.spawn('core:person', { x: 20, y: 22 })!;
  Object.assign(elder.components.person!, { age: 30, homeId: home.id, reproduceIn: 100000, buildIn: 100000 });
  Object.assign(elder.components.citizen!, { villageId: village.id, service: 100 });
  initializeStorage(world, village);
  village.migrationAfter = 100000; world.tick = tick;
  return { world, village, field, worker };
}

const reload = (world: World): World => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));

describe('saved-tick calendar', () => {
  it('crosses every month and the year exactly once, preserving the old season boundaries', () => {
    expect(calendarAt(0)).toEqual({ day: 1, month: 1, year: 1 });
    for (let month = 1; month <= MONTHS.length; month++) {
      const boundary = month * MONTH_TICKS;
      expect(calendarAt(boundary - DAY_TICKS)).toEqual({ day: 30, month, year: 1 });
      expect(calendarAt(boundary - 1)).toEqual({ day: 30, month, year: 1 });
      const next = { day: 1, month: month % 12 + 1, year: month === 12 ? 2 : 1 };
      expect(calendarAt(boundary)).toEqual(next);
      expect(calendarAt(boundary + DAY_TICKS - 1)).toEqual(next);
    }
    expect([0, 1799, 1800, 3600, 5400, 7199, 7200].map(t => seasonAt(t).id))
      .toEqual(['spring', 'spring', 'summer', 'autumn', 'winter', 'winter', 'spring']);
  });

  it('reads a pre-month save without changing the origin, RNG, ages or active timers', () => {
    const { world } = settlement(YEAR_TICKS - 1), before = world.snapshot();
    const restored = reload(world);
    expect(restored.snapshot()).toEqual(before);
    expect(calendarAt(restored.tick)).toEqual({ day: 30, month: 12, year: 1 });
    const original = JSON.stringify(world.snapshot());
    for (const language of languages) for (let month = 0; month < MONTHS.length; month++) {
      expect(calendarDate(month * MONTH_TICKS, language.id)).not.toMatch(/[{}]/);
    }
    expect(calendarDate(world.tick, 'ru')).not.toBe(calendarDate(world.tick, 'en'));
    expect(calendarDate(world.tick, 'en')).toBe('30 Endember, year 1');
    expect(calendarDate(world.tick, 'ru')).toBe('30 Эндембер, год 1');
    expect(translate('Untranslated sample', 'zh-CN')).toBe('Untranslated sample');
    expect(JSON.stringify(world.snapshot())).toBe(original);
    world.step(); restored.step();
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(calendarAt(restored.tick)).toEqual({ day: 1, month: 1, year: 2 });
  });

  it('freezes the date, harvest and election deadline while paused, including after loading', () => {
    const { world, field } = settlement(MONTH_TICKS);
    field.components.farm!.growth = 1;
    world.paused = true;
    const restored = reload(world), before = restored.snapshot();
    restored.step(); governance(restored); agriculture(restored);
    expect(restored.snapshot()).toEqual(before);
  });

  it('does not replay a harvest or an election after loading at a month boundary', () => {
    const { world, village, field } = settlement(MONTH_TICKS - 30);
    field.components.farm!.growth = 1;
    agriculture(world); governance(world);
    expect(field.components.farm!.harvests).toBe(1);
    village.government!.electionAt = MONTH_TICKS;
    world.tick = MONTH_TICKS - 1;
    const loaded = reload(world);
    world.tick++; loaded.tick++;
    agriculture(world); governance(world); agriculture(loaded); governance(loaded);
    expect(loaded.snapshot()).toEqual(world.snapshot());
    const again = reload(loaded), previous = again.society.villages[0];
    const food = previous.food, elections = previous.government!.elections;
    agriculture(again); governance(again);
    expect(previous.food).toBe(food);
    expect(previous.government!.elections).toBe(elections);
    expect(again.entities.get(field.id)!.components.farm!.harvests).toBe(1);
    expect(previous.government!.electionAt).toBe(4 * MONTH_TICKS);
  });

  it('coalesces a long overdue term into one election and persists a future deadline', () => {
    const { world, village } = settlement(MONTH_TICKS);
    governance(world);
    const elections = village.government!.elections;
    world.tick += YEAR_TICKS * 10000;
    governance(world);
    expect(village.government!.elections).toBe(elections + 1);
    expect(village.government!.electionAt).toBe(world.tick + 3 * MONTH_TICKS);
    const loaded = reload(world); governance(loaded);
    expect(loaded.society.villages[0].government!.elections).toBe(elections + 1);
  });

  it('reaches the same state at 1× and 10× across the year boundary', () => {
    const { world: slow } = settlement(YEAR_TICKS - 30), fast = reload(slow);
    fast.speed = 10;
    for (const world of [slow, fast]) {
      const clock = new FixedClock(() => 0);
      clock.advance(0, true, () => world.step(), world.speed);
      for (let frame = 1; frame <= 60 / world.speed; frame++) clock.advance(frame * 1000 / 30, true, () => world.step(), world.speed);
    }
    expect(slow.tick).toBe(YEAR_TICKS + 30);
    expect({ ...fast.snapshot(), speed: 1 }).toEqual(slow.snapshot());
  });
});
