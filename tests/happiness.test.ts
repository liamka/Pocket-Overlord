import { describe, expect, it } from 'vitest';
import { HAPPINESS_EVENTS } from '../src/content/happiness';
import { cancelBehaviour, continueWait, enterBehaviour } from '../src/core/behaviour';
import { recordFamilyBirth } from '../src/core/families';
import { HAPPINESS_HISTORY_LIMIT, happinessPercent, happinessSource, recordHappiness, recordHappinessBatch, syncHappiness } from '../src/core/happiness';
import { startReflection } from '../src/core/unit-tasks';
import { intrinsicStat, unitStats } from '../src/core/unit-stats';
import { governmentOf } from '../src/core/village-life';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { continueSocializing } from '../src/systems/integration';
import { intentions } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { flatWorld, setFood } from './helpers';

const resident = (world: World, x = 10) => world.spawn('core:person', { x, y: 20 })!;

describe('personal happiness', () => {
  it('projects the event-owned value instead of adding a second base or modifier, including after loading', () => {
    const w = flatWorld(), e = resident(w);
    e.components.happiness!.value = -60;
    e.components.stats!.base.happiness = 80;
    e.components.stats!.modifiers.push({ id: 'old-emotion', origin: 'personal', flat: { happiness: 60 }, percent: { happiness: 100 } });
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = loaded.entities.get(e.id)!;
    for (const [world, unit] of [[w, e], [loaded, actor]] as const) {
      expect(intrinsicStat(unit, 'happiness')).toBe(-60);
      expect(unitStats(world, unit).values.happiness).toBe(-60);
      recordHappiness(world, unit, 'meal');
      expect(unitStats(world, unit).values.happiness).toBe(-50);
    }
    expect(loaded.rng.state).toBe(w.rng.state);
    const ufo = w.spawn('core:ufo', { x: 30, y: 30 })!;
    ufo.components.stats!.base.happiness = 100;
    expect(unitStats(w, ufo).values.happiness).toBe(0);
    expect(ufo.components.happiness).toBeUndefined();
  });

  it('never applies old Mood combat, speed or diplomacy bonuses and keeps public trust independent', () => {
    const w = flatWorld(), e = resident(w), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    e.components.citizen!.villageId = village.id;
    const government = governmentOf(village);
    government.leaderId = e.id; government.trust = 23;
    const before = unitStats(w, e).values, rng = w.rng.state;
    for (const value of [-100, 0, 100]) {
      e.components.happiness!.value = value;
      const after = unitStats(w, e).values;
      for (const key of ['damage', 'attackSpeed', 'speed', 'diplomacy'] as const) expect(after[key]).toBe(before[key]);
      expect(government.trust).toBe(23);
    }
    government.trust = 90;
    expect(e.components.happiness!.value).toBe(100);
    expect(w.rng.state).toBe(rng);
  });

  it('resumes one meal as one emotional event without replaying it or resetting happiness on the next meal', () => {
    const w = flatWorld(), e = resident(w), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    e.components.person!.homeId = home.id; e.components.citizen!.villageId = village.id;
    syncHappiness(w, e); e.components.happiness!.value = 0; e.components.happiness!.history = [];
    setFood(village, 3);
    Object.assign(e.components.citizen!, { task: 'eat', targetId: home.id, hunger: 60, reconsiderIn: 0 });
    expect(enterBehaviour(w, e, 'eating', 'approach')).toBe(true);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = loaded.entities.get(e.id)!;
    const beforePause = loaded.snapshot(); loaded.paused = true; loaded.step(); intentions(loaded);
    expect(loaded.tick).toBe(beforePause.tick); expect(loaded.rng.state).toBe(beforePause.rngState);
    expect(actor.components.happiness).toEqual(e.components.happiness);
    loaded.paused = false;
    for (const [world, unit] of [[w, e], [loaded, actor]] as const) {
      world.tick = 15; intentions(world);
      world.tick = 30; intentions(world);
      expect(world.society.villages[0].food).toBe(2);
      expect(unit.components.happiness!.history.map(m => m.type)).toEqual(['meal']);
      expect(unit.components.happiness!.value).toBe(10);
      Object.assign(unit.components.citizen!, { task: 'eat', targetId: home.id, hunger: 60, reconsiderIn: 0 });
      expect(enterBehaviour(world, unit, 'eating', 'approach')).toBe(true);
      world.tick = 45; intentions(world);
      expect(unit.components.happiness!.history.map(m => m.type)).toEqual(['meal', 'meal']);
      expect(unit.components.happiness!.value).toBe(20);
      expect(world.society.villages[0].food).toBe(1);
    }
    expect(actor.components.happiness).toEqual(e.components.happiness);
    expect(loaded.rng.state).toBe(w.rng.state);
  });

  it('awards no meal for a removed, distant or differently owned dining target', () => {
    for (const unavailable of ['removed', 'distant', 'owner-changed'] as const) {
      const w = flatWorld(), e = resident(w), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
      e.components.citizen!.villageId = village.id; setFood(village, 3);
      Object.assign(e.components.citizen!, { task: 'eat', targetId: home.id, hunger: 60, reconsiderIn: 0 });
      enterBehaviour(w, e, 'eating', 'approach');
      if (unavailable === 'removed') w.remove(home.id);
      else if (unavailable === 'distant') e.components.position!.x = 40;
      else e.components.citizen!.villageId = null;
      w.tick = 15; intentions(w);
      expect(e.components.happiness!.history.some(m => m.type === 'meal')).toBe(false);
    }
  });

  it('charges starvation once per episode, including after save/load and journal eviction', () => {
    const w = flatWorld(), e = resident(w), h = e.components.happiness!;
    e.components.citizen!.hunger = 90; syncHappiness(w, e);
    expect(h.value).toBe(-40);
    for (let i = 0; i < HAPPINESS_HISTORY_LIMIT + 1; i++) { w.tick++; recordHappiness(w, e, 'meal'); syncHappiness(w, e); }
    const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = restored.entities.get(e.id)!;
    const value = actor.components.happiness!.value;
    syncHappiness(restored, actor);
    expect(actor.components.happiness!.value).toBe(value);
    actor.components.citizen!.hunger = 40; syncHappiness(restored, actor);
    actor.components.citizen!.hunger = 90; restored.tick++; syncHappiness(restored, actor);
    expect(actor.components.happiness!.value).toBe(value - 40);
  });

  it('records partner and child bereavement separately without generic family duplication', () => {
    const w = flatWorld(), parent = resident(w), partner = resident(w, 12), child = resident(w, 14);
    parent.components.citizen!.partnerId = partner.id; partner.components.citizen!.partnerId = parent.id;
    recordFamilyBirth(w, child, [parent.id, partner.id]);
    parent.components.happiness!.value = 0; parent.components.happiness!.history = [];
    partner.components.health!.current = 0; w.die(partner.id, { cause: 'other' });
    w.die(partner.id, { cause: 'other' });
    expect(parent.components.happiness!.value).toBe(-50);
    child.components.health!.current = 0; w.die(child.id, { cause: 'other' });
    expect(parent.components.happiness!.history.map(m => m.type)).toEqual(['partner-death', 'child-death']);
    expect(parent.components.happiness!.value).toBe(-100);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('retains participant captions after removal and does not treat removal as death', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 12);
    b.components.unit!.customName = 'Mira';
    recordHappiness(w, a, 'conversation', b); w.remove(b.id);
    expect(a.components.happiness!.history).toHaveLength(1);
    expect(a.components.happiness!.history[0].source.name).toBe('Mira');
  });

  it('only exempts marked events for Psychopath, including marked positive ones', () => {
    const w = flatWorld(), e = resident(w), h = e.components.happiness!;
    h.psychopath = true;
    recordHappiness(w, e, 'partner-death'); recordHappiness(w, e, 'love');
    recordHappiness(w, e, 'starving'); recordHappiness(w, e, 'meal');
    expect(h.history.map(m => m.type)).toEqual(['starving', 'meal']); expect(h.value).toBe(-30);
  });

  it('does not change eggs or creatures without emotional capacity', () => {
    const w = flatWorld(), egg = resident(w), ship = w.spawn('core:ship', { x: 20, y: 20 })!;
    egg.components.happiness!.egg = true; egg.components.citizen!.hunger = 100;
    const before = structuredClone(egg.components.happiness);
    recordHappiness(w, egg, 'meal'); syncHappiness(w, egg); recordHappiness(w, ship, 'meal');
    expect(egg.components.happiness).toEqual(before); expect(ship.components.happiness).toBeUndefined();
  });

  it('sums a transaction before clamping and keeps equal contributions as distinct memories', () => {
    const w = flatWorld(), e = resident(w); e.components.happiness!.value = 95;
    recordHappinessBatch(w, e, [{ type: 'meal' }, { type: 'starving' }, { type: 'conversation', source: happinessSource(w, e) }]);
    expect(e.components.happiness!.value).toBe(75);
    expect(e.components.happiness!.history.map(m => m.type)).toEqual(['meal', 'starving', 'conversation']);
    expect([happinessPercent(-100), happinessPercent(100)]).toEqual([0, 100]);
  });

  it('awards a home only on arrival and records its loss only once', () => {
    const w = flatWorld(), e = resident(w), house = w.spawn('core:house', { x: 30, y: 20 })!;
    const village = assignHouse(w, house);
    e.components.person!.homeId = house.id; e.components.citizen!.villageId = village.id;
    syncHappiness(w, e); expect(e.components.happiness!.value).toBe(0);
    e.components.position!.x = 28; syncHappiness(w, e); syncHappiness(w, e);
    expect(e.components.happiness!.value).toBe(35);
    w.remove(house.id); syncHappiness(w, e);
    expect(e.components.happiness!.value).toBe(5); expect(e.components.happiness!.home).toBeNull();
  });

  it('does not reward an interrupted conversation or future reading/gift inputs', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 12);
    a.components.citizen!.task = 'socialize'; a.components.citizen!.targetId = b.id;
    a.components.citizen!.conversation = { partnerId: b.id, startedAt: 0, contact: 0 };
    w.remove(b.id); continueSocializing(w, a);
    recordHappiness(w, a, 'reading'); recordHappiness(w, a, 'gift-sent');
    expect(a.components.happiness!.history).toEqual([]);
    expect(a.components.citizen!.conversation).toBeUndefined();
    expect(HAPPINESS_EVENTS.victory.conquestWindowSeconds).toBe(300);
    expect(HAPPINESS_EVENTS.conquest.conquestWindowSeconds).toBe(400);
    expect(HAPPINESS_EVENTS.caught.support).toBe('unavailable');
  });

  it('resumes an emotional action with the same value, history and random state', () => {
    const w = flatWorld(), e = resident(w);
    e.components.happiness!.value = -80; e.components.citizen!.reflectionAfter = 0;
    expect(startReflection(w, e)).toBe(true);
    w.tick += 15;
    const other = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = other.entities.get(e.id)!;
    const finish = e.components.citizen!.behaviour!.retryAt;
    w.tick = other.tick = finish; continueWait(w, e); continueWait(other, actor);
    expect(actor.components.happiness).toEqual(e.components.happiness); expect(other.rng.state).toBe(w.rng.state);
    const value = e.components.happiness!.value; continueWait(w, e); expect(e.components.happiness!.value).toBe(value);
  });

  it('preserves a home rest in saves and cancels it without reward when the home disappears', () => {
    const w = flatWorld(), e = resident(w), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    e.components.person!.homeId = home.id;
    Object.assign(e.components.citizen!, { villageId: village.id, task: 'visit', targetId: home.id });
    expect(enterBehaviour(w, e, 'home_rest', 'rest')).toBe(true); e.components.citizen!.behaviour!.retryAt = 180;
    const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    const actor = restored.entities.get(e.id)!; restored.remove(home.id); restored.tick = 180; continueWait(restored, actor);
    expect(actor.components.happiness!.history.some(m => m.type === 'rest')).toBe(false);
  });

  it('completes a restored home rest exactly once with the same random state', () => {
    const w = flatWorld(), e = resident(w), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    e.components.person!.homeId = home.id;
    Object.assign(e.components.citizen!, { villageId: village.id, task: 'visit', targetId: home.id });
    syncHappiness(w, e); enterBehaviour(w, e, 'home_rest', 'rest'); e.components.citizen!.behaviour!.retryAt = 180;
    w.tick = 90;
    const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = restored.entities.get(e.id)!;
    w.tick = restored.tick = 180; continueWait(w, e); continueWait(restored, actor); continueWait(restored, actor);
    expect(actor.components.happiness).toEqual(e.components.happiness);
    expect(actor.components.happiness!.history.filter(m => m.type === 'rest')).toHaveLength(1);
    expect(restored.rng.state).toBe(w.rng.state);
  });

  it('keeps paused timers still and gives no points for cancelled expressions', () => {
    const w = flatWorld(), e = resident(w); e.components.citizen!.reflectionAfter = 0;
    e.components.happiness!.value = -80; startReflection(w, e);
    const before = w.snapshot(); w.paused = true;
    w.step(); continueWait(w, e); syncHappiness(w, e);
    expect(w.tick).toBe(before.tick); expect(w.rng.state).toBe(before.rngState);
    expect(e.components.happiness).toEqual(before.entities.find(a => a.id === e.id)!.components.happiness);
    w.paused = false; cancelBehaviour(w, e); w.tick = 500; continueWait(w, e);
    expect(e.components.happiness!.history).toEqual([]);
  });

  it('migrates old saves without rewards and rejects forged or future journal events', () => {
    const w = flatWorld(), e = resident(w); e.components.citizen!.hunger = 95;
    const old = w.snapshot(); old.version = 50;
    for (const entity of old.entities) delete entity.components.happiness;
    const migrated = decodeSave(old, w.registry), restored = new World(w.seed, w.registry, migrated), actor = restored.entities.get(e.id)!;
    syncHappiness(restored, actor);
    expect(actor.components.happiness!.value).toBe(0); expect(restored.rng.state).toBe(old.rngState);
    recordHappiness(restored, actor, 'meal');
    const broken = restored.snapshot(); broken.entities.find(a => a.id === e.id)!.components.happiness!.history[0].change = 100;
    expect(() => decodeSave(broken, w.registry)).toThrow();
  });
});
