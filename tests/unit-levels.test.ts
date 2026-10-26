import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain } from '../src/core/types';
import { awardExperience, publishExperience, rulingExperience, setLearningCulture, startRulingExperience, xpRequired } from '../src/core/unit-levels';
import { LEVEL_LIMIT, reconcileStats, unitStats } from '../src/core/unit-stats';
import { createItem } from '../src/core/equipment';
import { setRebirth } from '../src/core/metamorphosis';
import { deathOf } from '../src/core/death';
import { equipmentSystem, performAttack } from '../src/systems/equipment';
import { applyEvent } from '../src/systems/effects';
import { assignHouse } from '../src/systems/society';
import { governmentOf } from '../src/core/village-life';
import { decodeSave } from '../src/persistence/schema';
import { statsInspector } from '../src/ui/unit-stats';

const resident = (w: World, x = 10) => w.spawn('core:person', { x, y: 10 })!;

describe('current unit levels', () => {
  it('purchases successive 100/120/140 thresholds, deriving maxima without healing or changing service', () => {
    const w = flatWorld(), e = resident(w), s = e.components.stats!;
    e.components.citizen!.service = 9;
    const rng = w.rng.state;
    for (const [threshold, level] of [[100, 2], [120, 3], [140, 4]]) {
      expect(xpRequired(s.level)).toBe(threshold);
      publishExperience(w, e, 'rule', 'Oak', threshold);
      expect(s.level).toBe(level); expect(s.xpIntoLevel).toBe(0);
    }
    expect(e.components.health!.current).toBe(70);
    expect(e.components.health!.max).toBeCloseTo(80.5);
    expect(unitStats(w, e).values.stamina).toBe(106);
    expect(e.components.citizen!.service).toBe(9);
    expect(w.rng.state).toBe(rng);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = loaded.entities.get(e.id)!;
    for (let i = 0; i < 3; i++) statsInspector(loaded, actor, 'ru', true);
    expect(actor.components.health).toEqual(e.components.health);
  });

  it('rejects duplicate and old result IDs, pauses and removed recipients', () => {
    const w = flatWorld(), e = resident(w);
    const event = { id: 1, source: 'hit' as const, subject: 'Mira', base: 2, tick: w.tick };
    expect(awardExperience(w, e, event)).toBe(true);
    expect(awardExperience(w, e, event)).toBe(false);
    expect(awardExperience(w, e, { ...event, id: 2 })).toBe(true);
    expect(awardExperience(w, e, event)).toBe(false);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = loaded.entities.get(e.id)!;
    expect(awardExperience(loaded, actor, event)).toBe(false);
    loaded.paused = true;
    expect(awardExperience(loaded, actor, { ...event, id: 3 })).toBe(false);
    expect(actor.components.stats!.xpIntoLevel).toBe(4);
    loaded.paused = false; loaded.remove(actor.id);
    expect(awardExperience(loaded, actor, { ...event, id: 3 })).toBe(false);
  });

  it('rewards actual hits and one death, never blocked paths, absent targets or buildings', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 11);
    w.terrain.set(10.5, 10, Terrain.Mountain);
    const rng = w.rng.state;
    expect(performAttack(w, a, b)).toBe(false);
    expect(a.components.stats!.xpIntoLevel).toBe(0); expect(w.rng.state).toBe(rng);
    w.terrain.set(10.5, 10, Terrain.Grass);
    expect(performAttack(w, a, b)).toBe(true);
    expect(a.components.stats!.xpIntoLevel).toBe(2);
    a.components.citizen!.attackIn = 0; b.components.health!.current = 1;
    expect(performAttack(w, a, b)).toBe(true);
    expect(a.components.stats!.xpIntoLevel).toBe(14);
    w.die(b.id, { cause: 'conflict', sourceId: a.id });
    expect(performAttack(w, a, b)).toBe(false);
    expect(a.components.stats!.xpIntoLevel).toBe(14);
    const house = w.spawn('core:house', { x: 11, y: 10 })!;
    a.components.citizen!.attackIn = 0;
    expect(performAttack(w, a, house)).toBe(true);
    expect(a.components.stats!.xpIntoLevel).toBe(14);
  });

  it('preserves a volley receipt and deterministic continuation between projectile impacts', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 11);
    createItem(w, 'druid-staff', { kind: 'equipped', entityId: a.id }); a.components.stats!.mana = 10;
    expect(performAttack(w, a, b)).toBe(true);
    expect(w.equipment.shots).toHaveLength(2);
    // One projectile is already near the target; the sibling is still travelling.
    w.equipment.shots[1].x = 10.8;
    equipmentSystem(w, 0);
    expect(a.components.stats!.xpIntoLevel).toBe(2);
    expect(w.equipment.shots).toHaveLength(1);
    expect(w.equipment.shots[0].experience!.awarded).toBe(true);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (let n = 0; n < 8; n++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot());
    expect(a.components.stats!.xpIntoLevel).toBe(2);
    const paused = loaded.snapshot(); loaded.paused = true; loaded.step(); equipmentSystem(loaded, 1);
    expect(loaded.tick).toBe(paused.tick); expect(loaded.rng.state).toBe(paused.rngState);
  });

  it('applies future culture inputs once, preserving old XP when the culture changes', () => {
    const w = flatWorld(), e = resident(w), s = e.components.stats!;
    publishExperience(w, e, 'rule', 'Oak', 90);
    setLearningCulture(w, e, { name: 'River', fastLearners: true, trainingPotential: true });
    expect(s.xpIntoLevel).toBe(90);
    publishExperience(w, e, 'kill', 'Mira', 10);
    expect(s.level).toBe(3); expect(s.xpIntoLevel).toBe(10);
    expect(s.experience.last!.multiplier).toBe(2); expect(xpRequired(s.level)).toBe(140);
    setLearningCulture(w, e, null);
    publishExperience(w, e, 'kill', 'Mira', 10);
    expect(s.level).toBe(3); expect(s.xpIntoLevel).toBe(20);
    const loaded = decodeSave(w.snapshot(), w.registry);
    expect(loaded.entities[0].components.stats!.xpIntoLevel).toBe(20);
  });

  it('does not credit an absent shooter or removed target when delayed projectiles finish', () => {
    for (const removed of ['source', 'target'] as const) {
      const w = flatWorld(), a = resident(w), b = resident(w, 11);
      createItem(w, 'druid-staff', { kind: 'equipped', entityId: a.id }); a.components.stats!.mana = 10;
      performAttack(w, a, b);
      w.remove(removed === 'source' ? a.id : b.id);
      for (let i = 0; i < 20; i++) equipmentSystem(w, 1 / 30);
      expect(a.components.stats!.xpIntoLevel).toBe(0);
      expect(w.equipment.shots).toHaveLength(0);
      expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    }
  });

  it('caps at 9999 and discards excess without overflowing or healing', () => {
    const w = flatWorld(), e = resident(w), s = e.components.stats!;
    s.level = LEVEL_LIMIT - 1; s.xpIntoLevel = xpRequired(s.level) - 1; reconcileStats(w, e);
    setLearningCulture(w, e, { name: 'River', fastLearners: true, trainingPotential: true });
    publishExperience(w, e, 'rule', 'Oak', 1e9);
    expect(s.level).toBe(LEVEL_LIMIT); expect(s.xpIntoLevel).toBe(0);
    expect(s.experience.last!.gained).toBe(1);
    expect(s.experience.last!.discarded).toBe(1999999999);
    expect(e.components.health!.current).toBe(70);
    publishExperience(w, e, 'hit', 'Mira', 2);
    expect(s.experience.last!.gained).toBe(0);
    expect(statsInspector(w, e, 'en', true)).toContain('Further experience is discarded');
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('credits only completed years of the current office, including across a reload', () => {
    const w = flatWorld(), e = resident(w), home = w.spawn('core:house', { x: 14, y: 10 })!;
    const village = assignHouse(w, home), g = governmentOf(village);
    e.components.citizen!.villageId = village.id; g.leaderId = e.id; g.electionAt = 1800;
    startRulingExperience(w, e, village); w.tick = 99;
    rulingExperience(w, e); expect(e.components.stats!.xpIntoLevel).toBe(0);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), actor = loaded.entities.get(e.id)!;
    w.tick = loaded.tick = 100;
    rulingExperience(w, e); rulingExperience(loaded, actor); rulingExperience(w, e);
    expect(actor.components.stats!.experience).toEqual(e.components.stats!.experience);
    expect(e.components.stats!.xpIntoLevel).toBe(10);
    g.leaderId = null; w.tick = 200; rulingExperience(w, e);
    expect(e.components.stats!.experience.ruling).toBeUndefined();
    expect(e.components.stats!.xpIntoLevel).toBe(10);
  });

  it('keeps progress through an existing rebirth instead of restoring the historical level table', () => {
    const w = flatWorld(), e = resident(w);
    publishExperience(w, e, 'rule', 'Oak', 150);
    const progress = structuredClone(e.components.stats!);
    e.components.person!.age = 90; setRebirth(w, e, 'self');
    applyEvent(w, { kind: 'damage', target: e.id, amount: 1e6, cause: 'age' });
    const body = w.entities.get(deathOf(w, e.id)!.transformedInto!.id)!;
    expect(body.components.stats!.level).toBe(progress.level);
    expect(body.components.stats!.xpIntoLevel).toBe(50);
    expect(body.components.stats!.experience).toEqual(progress.experience);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('migrates levels without XP gifts, preserving RNG and rejecting invalid progress', () => {
    const w = flatWorld(), e = resident(w); e.components.stats!.level = 11;
    const old = w.snapshot(); old.version = 52;
    const raw = old.entities[0].components.stats! as unknown as Record<string, unknown>;
    delete raw.experience; delete raw.xpIntoLevel;
    const migrated = decodeSave(old, w.registry), s = migrated.entities[0].components.stats!;
    expect(s.level).toBe(11); expect(s.xpIntoLevel).toBe(0); expect(s.experience.nextEventId).toBe(1);
    expect(migrated.entities[0].components.health).toEqual(old.entities[0].components.health);
    expect(migrated.rngState).toBe(old.rngState);
    for (const bad of [xpRequired(s.level), -1, Infinity]) {
      const broken = structuredClone(migrated); broken.entities[0].components.stats!.xpIntoLevel = bad;
      expect(() => decodeSave(broken, w.registry)).toThrow();
    }
  });

  it('starts a distinct transformed identity at level one with no inherited XP receipts', () => {
    const w = flatWorld(), e = resident(w);
    w.registry.registerTransformation({ id: 'test:new-identity', label: 'New identity', trigger: 'death', sources: ['core:person'],
      target: 'core:wolf', priority: 100, change: 'body', identity: 'new', items: 'leave', remove: [], eligible: () => true });
    publishExperience(w, e, 'rule', 'Oak', 150);
    applyEvent(w, { kind: 'damage', target: e.id, amount: 1e6, cause: 'age' });
    const body = w.entities.get(deathOf(w, e.id)!.transformedInto!.id)!;
    expect(body.components.stats!.level).toBe(1);
    expect(body.components.stats!.xpIntoLevel).toBe(0);
    expect(body.components.stats!.experience).toEqual({ nextEventId: 1 });
  });
});
