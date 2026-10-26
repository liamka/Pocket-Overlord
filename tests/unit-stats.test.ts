import { describe, expect, it } from 'vitest';
import { flatWorld, setFood } from './helpers';
import { World } from '../src/core/world';
import { adultAge, armoredDamage, calculateStats, canBreed, isAdult, nutritionRemaining, projectileDeviation, reconcileStats, rollDamage, setStatModifier, removeStatModifier, unitStats } from '../src/core/unit-stats';
import { createItem, removeEquippedItem } from '../src/core/equipment';
import { equipmentHit, performAttack } from '../src/systems/equipment';
import { unitStatsSystem } from '../src/systems/unit-stats';
import { continueSocializing } from '../src/systems/integration';
import { intentions, settlement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { enterBehaviour } from '../src/core/behaviour';
import { decodeSave } from '../src/persistence/schema';
import { statsInspector } from '../src/ui/unit-stats';
import { RACES, RACE_IDS } from '../src/core/races';
import { SAVE_VERSION } from '../src/core/types';

describe('unit parameters and their consumers', () => {
  it.each(RACE_IDS)('extends the natural lifespan of %s without making it immortal', race => {
    const w = flatWorld(), e = w.spawn(RACES[race].entityId, { x: 10, y: 10 })!, s = e.components.stats!;
    e.components.traits!.entries = [];
    const previous = { human: 85, elf: 150, orc: 65, dwarf: 120 };
    expect(unitStats(w, e).values.lifespan).toBe(previous[race] * (race === 'elf' ? 4 : 2));
    e.components.person!.age = previous[race] + 1;
    s.lastBirthday = e.components.person!.age; s.nextOldAgeAt = w.tick;
    const rng = w.rng.state;
    unitStatsSystem(w, 0);
    expect(w.rng.state).toBe(rng);
    expect(w.events).toEqual([]);
    e.components.person!.age = RACES[race].lifespan * 2;
    s.lastBirthday = e.components.person!.age;
    for (let year = 0; year < 20 && !w.events.some(event => event.kind === 'damage' && event.cause === 'age'); year++) {
      s.nextOldAgeAt = w.tick;
      unitStatsSystem(w, 0);
    }
    expect(w.events).toContainEqual({ kind: 'damage', target: e.id, amount: e.components.health!.current, cause: 'age' });
  });

  it('extends saved default lifespans once while preserving ages, modifiers, animals and custom bases', () => {
    const w = flatWorld(), previous = { human: 85, elf: 150, orc: 65, dwarf: 120 };
    const people = RACE_IDS.map((race, i) => w.spawn(RACES[race].entityId, { x: 8 + i * 8, y: 10 })!);
    for (const [i, e] of people.entries()) {
      e.components.stats!.base.lifespan = previous[RACE_IDS[i]];
      e.components.stats!.modifiers.push({ id: 'long-life', origin: 'personal', flat: { lifespan: 7 }, percent: { lifespan: 10 } });
    }
    const custom = w.spawn('core:elf', { x: 10, y: 20 })!;
    custom.components.stats!.base.lifespan = 333;
    w.spawn('core:sheep', { x: 20, y: 20 });
    const old = w.snapshot(); old.version = 71;
    const expected = structuredClone(old); expected.version = SAVE_VERSION;
    for (const [i, e] of expected.entities.slice(0, 4).entries()) e.components.stats!.base.lifespan = RACES[RACE_IDS[i]].lifespan;
    const migrated = decodeSave(old, w.registry);
    expect(migrated).toEqual(expected);
    expect(decodeSave(migrated, w.registry)).toEqual(expected);
    const restored = new World(w.seed, w.registry, old);
    for (const e of expected.entities) expect(restored.entities.get(e.id)!.components.stats).toEqual(e.components.stats);
    // A current save may intentionally use a formerly standard lifespan.
    migrated.entities[0].components.stats!.base.lifespan = previous.human;
    expect(decodeSave(migrated, w.registry)).toEqual(migrated);
  });

  it('reuses stats through hunger changes but immediately observes in-place base and modifier edits', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    const first = unitStats(w, e);
    e.components.citizen!.hunger += 1;
    expect(unitStats(w, e)).toBe(first);
    e.components.stats!.base.damage += 3;
    expect(unitStats(w, e).values.damage).toBe(first.values.damage + 3);
    const modifier = { id: 'probe', origin: 'personal' as const, flat: { damage: 2 }, percent: {} };
    e.components.stats!.modifiers.push(modifier);
    const second = unitStats(w, e);
    modifier.flat.damage += 4;
    expect(unitStats(w, e).values.damage).toBe(second.values.damage + 4);
  });
  it('grows from base ten times without compounding, healing or duplicating equipment on load', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    createItem(w, 'silver-armor', { kind: 'equipped', entityId: e.id }, undefined, { health: 5 });
    e.components.stats!.level = 11;
    reconcileStats(w, e);
    expect(e.components.health).toEqual({ current: 70, max: 130 });
    expect(unitStats(w, e).values.stamina).toBe(120);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    const body = loaded.entities.get(e.id)!;
    for (let i = 0; i < 5; i++) statsInspector(loaded, body, 'ru', true);
    expect(body.components.health).toEqual({ current: 70, max: 130 });
    removeEquippedItem(loaded, body, 'armor');
    expect(body.components.health).toEqual({ current: 70, max: 105 });
  });

  it('uses one axe contribution, percent armor, integer ranges and a single critical roll', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 10, y: 10 })!, b = w.spawn('core:person', { x: 11, y: 10 })!;
    const bare = unitStats(w, a).values.damage;
    createItem(w, 'stone-axe', { kind: 'equipped', entityId: a.id });
    expect(unitStats(w, a).values.damage - bare).toBe(4);
    a.components.stats!.modifiers.push({ id: 'critical', origin: 'personal', flat: { critical: 150 }, percent: {} });
    const stats = unitStats(w, a); let draws = 0;
    expect(rollDamage(stats, () => { draws++; return 0.999; })).toBe(stats.values.damage * 2);
    expect(draws).toBe(1);
    b.components.stats!.base.armor = 99;
    equipmentHit(w, a.id, b, 10, []);
    expect(b.components.health!.current).toBe(69);
    expect(armoredDamage(17.9, 0)).toBe(17);
    expect(armoredDamage(2, 500)).toBe(1);
    expect(projectileDeviation(10, 20)).toBe(0);
    expect(projectileDeviation(5, 20)).toBe(0.5);
  });

  it('spends energy only for reachable living targets, including saved ranged attacks', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 10, y: 10 })!, b = w.spawn('core:person', { x: 11, y: 10 })!;
    createItem(w, 'druid-staff', { kind: 'equipped', entityId: a.id });
    a.components.stats!.mana = 10;
    const rng = w.rng.state;
    b.components.position!.x = 40;
    expect(performAttack(w, a, b)).toBe(false);
    expect(w.rng.state).toBe(rng);
    expect(a.components.stats!.mana).toBe(10);
    b.components.position!.x = 11; w.spatial.update(b);
    expect(performAttack(w, a, b)).toBe(true);
    expect(a.components.stats!.mana).toBe(7);
    expect(a.components.stats!.stamina).toBe(95);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    expect(loaded.equipment.shots).toEqual(w.equipment.shots);
    const saved = w.snapshot(); w.paused = true; w.step(); unitStatsSystem(w, 1);
    expect(w.tick).toBe(saved.tick);
    expect(a.components.stats!.mana).toBe(7);
    w.remove(b.id); w.paused = false;
    expect(performAttack(w, a, b)).toBe(false);
  });

  it('keeps pause, expiring modifiers and RNG identical after loading an active transition', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    e.components.stats!.modifiers.push({ id: 'temporary', origin: 'status', flat: { health: 100, stamina: 10 }, percent: { mana: 20 }, expiresAt: w.tick + 6 });
    e.components.stats!.stamina = 108;
    reconcileStats(w, e);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (let i = 0; i < 12; i++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot());
    expect(e.components.stats!.modifiers).toEqual([]);
    expect(e.components.stats!.stamina).toBeLessThanOrEqual(100);
    expect(Number.isFinite(e.components.stats!.mana)).toBe(true);
  });

  it('uses the same maturity and nutrition rules with a 200-point stomach', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    e.components.person!.age = 16;
    expect(isAdult(e)).toBe(true); expect(canBreed(e)).toBe(false);
    e.components.stats!.base.lifespan = 20;
    expect(adultAge(e)).toBeCloseTo(1.1 * 20 ** 0.55);
    e.components.stats!.base.nutrition = 200;
    e.components.citizen!.hunger = 70;
    expect(nutritionRemaining(e)).toBeCloseTo(60);
    expect(decodeSave(w.snapshot(), w.registry).entities[0].components.citizen!.hunger).toBe(70);
    e.components.stats!.ageOvergrowth = 20;
    expect(e.components.person!.age).toBe(16);
  });

  it('invalidates calculated values only when inputs change, keeping size and loot independent', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    const first = unitStats(w, e);
    e.components.stats!.stamina -= 1;
    expect(unitStats(w, e)).toBe(first);
    e.components.stats!.modifiers.push({ id: 'shape', origin: 'personal', flat: { hitSize: 2 }, percent: { scale: 50 } });
    const changed = unitStats(w, e);
    expect(changed).not.toBe(first);
    expect(changed.values.mass).toBe(first.values.mass);
    expect(changed.values.hitSize).toBe(2.35);
    expect(changed.values.scale).toBe(1.5);
    e.components.health!.current = 0; w.die(e.id, { cause: 'other' });
    expect([...w.query('resourcePile')][0].components.resourcePile!.goods).toEqual({ meat: 2, bone: 1 });
  });

  it('uses absolute nutrition for conception even when hunger is above 50 percent', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 14, y: 10 })!, village = assignHouse(w, home);
    const a = w.spawn('core:person', { x: 10, y: 10 })!, b = w.spawn('core:person', { x: 11, y: 10 })!;
    for (const [e, other, sex] of [[a, b, 'a'], [b, a, 'b']] as const) {
      Object.assign(e.components.person!, { age: 18, homeId: home.id, sex, reproduceIn: 0 });
      Object.assign(e.components.citizen!, { villageId: village.id, partnerId: other.id, hunger: 70 });
      e.components.stats!.base.nutrition = 200;
    }
    w.tick = 15; settlement(w);
    expect(a.components.citizen!.pregnancy).toBe(8);
    expect(nutritionRemaining(a)).toBeCloseTo(10);
    expect(nutritionRemaining(b)).toBeCloseTo(10);
    expect(village.food).toBe(14);
  });

  it('keeps chronological age separate and spends no old-age lottery before lifespan or for immortals', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!, s = e.components.stats!;
    e.components.person!.age = 30; s.lastBirthday = 30; s.nextOldAgeAt = w.tick;
    const before = w.rng.state;
    unitStatsSystem(w, 0);
    expect(w.rng.state).toBe(before);
    s.ageOvergrowth = 1000; s.immortal = true; s.nextOldAgeAt = w.tick;
    unitStatsSystem(w, 0);
    expect(w.rng.state).toBe(before);
    expect(e.components.person!.age).toBe(30);
    expect(w.events).toEqual([]);
  });

  it('does not create food when nutrition capacity increases or a modifier is replaced', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    const food = nutritionRemaining(e);
    const modifier = { id: 'capacity', origin: 'personal' as const, flat: { nutrition: 100 }, percent: {} };
    expect(setStatModifier(w, e, modifier)).toBe(true);
    expect(nutritionRemaining(e)).toBeCloseTo(food);
    expect(setStatModifier(w, e, modifier)).toBe(true);
    expect(nutritionRemaining(e)).toBeCloseTo(food);
    expect(removeStatModifier(w, e, 'capacity')).toBe(true);
    expect(nutritionRemaining(e)).toBeCloseTo(food);
  });

  it('learns once when a conversation ends, but never when the other participant disappears', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 10, y: 10 })!, b = w.spawn('core:person', { x: 11, y: 10 })!;
    const home = w.spawn('core:house', { x: 14, y: 10 })!, village = assignHouse(w, home);
    w.society.nextMigrationId = 2;
    a.components.citizen!.integration = { villageId: village.id, groupId: 1, arrived: 0, status: 'settling', belonging: 30,
      worked: false, friendId: null, contactId: null, contact: 0, socialAfter: 600, socialUntil: 90, leaveAfter: 2700 };
    b.components.stats!.learned = { diplomacy: 20, warfare: 20, stewardship: 20, intelligence: 20 };
    for (const [e, other] of [[a, b], [b, a]]) Object.assign(e.components.citizen!, { villageId: village.id, task: 'socialize', targetId: other.id,
      conversation: { partnerId: other.id, startedAt: 0, contact: 3 } });
    w.tick = 100; w.rng.state = 0;
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    continueSocializing(w, a); continueSocializing(loaded, loaded.entities.get(a.id)!);
    expect(Object.values(a.components.stats!.learned).some(n => n > 0)).toBe(true);
    expect(loaded.rng.state).toBe(w.rng.state);
    expect(loaded.entities.get(a.id)!.components.stats!.learned).toEqual(a.components.stats!.learned);
    const rng = w.rng.state, learned = { ...a.components.stats!.learned };
    continueSocializing(w, b); continueSocializing(w, a);
    expect(w.rng.state).toBe(rng); expect(a.components.stats!.learned).toEqual(learned);
    w.remove(b.id); continueSocializing(w, a);
    expect(w.rng.state).toBe(rng);
  });

  it('recovers energy once per actual meal and preserves absolute food with a 200-point capacity', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    const home = w.spawn('core:house', { x: 12, y: 10 })!, village = assignHouse(w, home);
    setFood(village, 3);
    e.components.citizen!.villageId = village.id;
    e.components.stats!.base.nutrition = 200; e.components.stats!.stamina = 10; e.components.stats!.mana = 0;
    Object.assign(e.components.citizen!, { task: 'eat', targetId: home.id, hunger: 60, reconsiderIn: 0 });
    expect(enterBehaviour(w, e, 'eating', 'approach')).toBe(true);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = loaded.entities.get(e.id)!;
    for (const [world, unit] of [[w, e], [loaded, actor]] as const) {
      world.tick = 15; intentions(world);
      world.tick = 30; intentions(world);
      expect(world.society.villages[0].food).toBe(2);
      expect(unit.components.stats!.stamina).toBe(20);
      expect(unit.components.stats!.mana).toBe(2);
      expect(nutritionRemaining(unit)).toBeGreaterThan(120);
    }
    expect(actor.components.stats).toEqual(e.components.stats);
    expect(loaded.rng.state).toBe(w.rng.state);
  });

  it('migrates without gifts and rejects invalid or invented derived maxima', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 10 })!;
    createItem(w, 'silver-armor', { kind: 'equipped', entityId: e.id }, undefined, { health: 2 });
    const old = w.snapshot(); old.version = 51; delete old.entities[0].components.stats;
    const migrated = decodeSave(old, w.registry);
    expect(migrated.rngState).toBe(old.rngState);
    expect(migrated.entities[0].components.stats!.level).toBe(1);
    expect(migrated.entities[0].components.stats!.stamina).toBe(0);
    expect(migrated.entities[0].components.health).toEqual(old.entities[0].components.health);
    const damaged = structuredClone(migrated); damaged.entities[0].components.health!.max++;
    expect(() => decodeSave(damaged, w.registry)).toThrow();
    damaged.entities[0].components.stats!.level = Infinity;
    expect(() => decodeSave(damaged, w.registry)).toThrow();
    e.components.stats!.level = 9999; e.components.stats!.base.mana = 1e6;
    const stats = calculateStats(e);
    expect(Number.isFinite(stats.values.health)).toBe(true);
    expect(stats.values.mana).toBeLessThanOrEqual(1e6);
  });
});
