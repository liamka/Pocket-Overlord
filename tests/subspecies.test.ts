import { describe, expect, it } from 'vitest';
import { flatWorld, setFood } from './helpers';
import { World } from '../src/core/world';
import { inheritedSubspecies, nearbySubspecies, setIndividualGenes, updateSubspecies } from '../src/core/subspecies';
import { subspeciesOf } from '../src/core/subspecies-state';
import { hasCapability } from '../src/core/capabilities';
import { unitStats } from '../src/core/unit-stats';
import { decodeSave } from '../src/persistence/schema';
import { startReproduction, resolveReproduction } from '../src/core/reproduction';
import { settlement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { hasTrait } from '../src/core/traits';
import { cargoContents } from '../src/core/resource-ledger';
import { startRulingExperience } from '../src/core/unit-levels';

describe('shared subspecies membership', () => {
  it('joins the nearest living member of the same species, breaking ties by entity ID without RNG', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 8, y: 20 })!, b = w.spawn('core:person', { x: 32, y: 20 })!;
    const elf = w.spawn('core:elf', { x: 20, y: 20 })!, rng = w.rng.state;
    expect(nearbySubspecies(w, 'human', { x: 20, y: 20 })?.id).toBe(a.id);
    expect(w.rng.state).toBe(rng);
    const child = w.spawn('core:person', { x: 20, y: 20 })!;
    expect(subspeciesOf(child)).toBe(subspeciesOf(a));
    expect(subspeciesOf(b)?.id).not.toBe(subspeciesOf(a)?.id);
    expect(subspeciesOf(elf)?.id).not.toBe(subspeciesOf(a)?.id);
    w.remove(a.id); w.remove(child.id);
    expect(nearbySubspecies(w, 'human', { x: 8, y: 20 })).toBeUndefined();
    expect(decodeSave(w.snapshot(), w.registry).subspecies).toEqual(w.subspecies);
  });

  it('updates only carriers and keeps personal mutations out of a child and its siblings', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 8, y: 20 })!, b = w.spawn('core:person', { x: 10, y: 20 })!, c = w.spawn('core:person', { x: 36, y: 20 })!;
    const speeds = [a, b, c].map(e => unitStats(w, e).values.speed);
    expect(updateSubspecies(w, subspeciesOf(a)!.id, { genome: { speed: 1 } })).toBe(true);
    expect([a, b, c].map(e => unitStats(w, e).values.speed)).toEqual([speeds[0] + 1, speeds[1] + 1, speeds[2]]);
    expect(setIndividualGenes(w, a, { speed: 2 })).toBe(true);
    const child = w.spawn('core:person', { x: 36, y: 22 }, undefined, 'born', [a.id])!;
    expect(subspeciesOf(child)).toBe(subspeciesOf(a));
    expect(child.components.subspecies!.deviations).toEqual({});
    expect(unitStats(w, b).values.speed).toBe(speeds[1] + 1);
    expect(decodeSave(w.snapshot(), w.registry).entities.find(e => e.id === a.id)?.components.subspecies?.deviations.speed).toBe(2);
  });

  it('births a child to two subspecies and preserves both parents, with guaranteed traits applied first', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    const mother = w.spawn('core:person', { x: 10, y: 20 })!, father = w.spawn('core:person', { x: 36, y: 20 })!;
    expect(subspeciesOf(mother)).not.toBe(subspeciesOf(father));
    for (const [i, e] of [mother, father].entries()) {
      Object.assign(e.components.person!, { age: 25, sex: i ? 'b' : 'a', homeId: home.id, reproduceIn: 100 });
      Object.assign(e.components.citizen!, { villageId: village.id, hunger: 0 });
    }
    Object.assign(father.components.position!, { x: 14, y: 20 }); w.spatial.update(father);
    setFood(village, 30); settlement(w);
    expect(mother.components.citizen!.partnerId).toBe(father.id);
    updateSubspecies(w, subspeciesOf(mother)!.id, { birthTraits: ['strong'] });
    mother.components.reproduction!.cooldowns = {}; father.components.reproduction!.cooldowns = {};
    father.components.position!.x = 11; w.spatial.update(father);
    expect(startReproduction(w, mother, 'sexual', father)).toBe(true);
    w.tick = mother.components.reproduction!.pending!.dueAt; resolveReproduction(w, mother);
    const child = [...w.query('person')].find(e => e.id !== mother.id && e.id !== father.id)!;
    expect(child).toBeDefined();
    expect(child.components.citizen!.parents).toEqual([mother.id, father.id]);
    expect(subspeciesOf(child)).toBe(subspeciesOf(mother));
    expect(hasTrait(child, 'strong')).toBe(true);
    expect(inheritedSubspecies(w, 'elf', [mother.id, father.id])).toBeUndefined();
  });

  it('leaves office and tasks without destroying carried goods or physical state', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    const e = w.spawn('core:person', { x: 10, y: 20 })!, shared = subspeciesOf(e)!;
    e.components.person!.homeId = home.id; e.components.citizen!.villageId = village.id;
    village.government = { leaderId: e.id, trust: 60, electedAt: 0, electionAt: 100, lastHarvest: 0, elections: 1 };
    startRulingExperience(w, e, village);
    e.components.citizen!.work = { good: 'wood', progress: 2, cargo: { good: 'wood', amount: 3, villageId: village.id } };
    const health = { ...e.components.health! }, p = { ...e.components.position! }, age = e.components.person!.age;
    expect(updateSubspecies(w, shared.id, { traits: shared.traits.filter(t => t !== 'sapience') })).toBe(true);
    expect(village.government!.leaderId).toBeNull();
    expect(e.components.stats!.experience!.ruling).toBeUndefined();
    expect(e.components.citizen).toMatchObject({ villageId: null, task: 'idle', targetId: null, work: { cargo: { amount: 3 } } });
    expect(e.components.health).toEqual(health); expect(e.components.position).toEqual(p); expect(e.components.person!.age).toBe(age);
    expect(hasCapability(w.registry, e, 'citizenship')).toBe(false);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    w.tick = 30; settlement(w); expect(e.components.person!.homeId).toBeNull();
  });

  it('preserves a travelling group\'s provisions on real carriers when its members lose sapience', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    const members = [10, 14].map(x => w.spawn('core:person', { x, y: 20 })!);
    for (const e of members) Object.assign(e.components.citizen!, { villageId: village.id, task: 'migrate' });
    w.society.migrations.push({ id: w.society.nextMigrationId++, fromId: village.id, toId: null, destination: { x: 35, y: 20 },
      members: members.map(e => e.id), familyIds: [], homeIds: [], food: 18, foodGoods: { provisions: 18 }, started: 0 });
    const s = subspeciesOf(members[0])!;
    expect(updateSubspecies(w, s.id, { traits: s.traits.filter(t => t !== 'sapience') })).toBe(true);
    expect(w.society.migrations).toEqual([]);
    expect(members.reduce((n, e) => n + (cargoContents(e.components.citizen!.work!.cargo!).provisions ?? 0), 0)).toBe(18);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('migrates one stable baseline per species without changing health, age, energy or RNG', () => {
    const w = flatWorld();
    for (const [i, type] of ['core:person', 'core:elf', 'core:orc', 'core:dwarf', 'core:sheep'].entries()) w.spawn(type, { x: 5 + i * 8, y: 20 });
    const raw = w.snapshot(); raw.version = 54; delete raw.subspecies;
    for (const e of raw.entities) delete e.components.subspecies;
    const before = structuredClone(raw), save = decodeSave(raw, w.registry);
    expect(save.rngState).toBe(before.rngState); expect(save.tick).toBe(before.tick);
    for (const e of save.entities) {
      const old = before.entities.find(o => o.id === e.id)!;
      expect(e.components.health).toEqual(old.components.health);
      expect(e.components.person).toEqual(old.components.person); expect(e.components.stats).toEqual(old.components.stats);
    }
    expect(decodeSave(raw, w.registry)).toEqual(save);
  });

  it('keeps dormant emotional memories when the shared ability is removed and restored', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 8, y: 20 })!, s = subspeciesOf(e)!;
    const original = [...s.traits], memories = structuredClone(e.components.happiness);
    updateSubspecies(w, s.id, { traits: original.filter(t => t !== 'amygdala') });
    expect(hasCapability(w.registry, e, 'amygdala')).toBe(false);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    expect(loaded.entities.get(e.id)!.components.happiness).toEqual(memories);
    updateSubspecies(loaded, s.id, { traits: original });
    expect(hasCapability(loaded.registry, loaded.entities.get(e.id)!, 'amygdala')).toBe(true);
    expect(loaded.entities.get(e.id)!.components.happiness).toEqual(memories);
  });

  it('rejects species mixing, dangling membership and forged counts in saves', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 8, y: 20 })!, b = w.spawn('core:elf', { x: 8, y: 22 })!;
    const wrong = w.snapshot(); wrong.entities.find(e => e.id === b.id)!.components.subspecies!.id = subspeciesOf(a)!.id;
    expect(() => decodeSave(wrong, w.registry)).toThrow();
    const missing = w.snapshot(); missing.subspecies!.records = [];
    expect(() => decodeSave(missing, w.registry)).toThrow();
    const count = w.snapshot(); count.subspecies!.records[0].created++;
    expect(() => decodeSave(count, w.registry)).toThrow();
  });

  it('continues through loading with the same shared changes and RNG; pause freezes transitions', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 8, y: 20 })!, s = subspeciesOf(e)!;
    updateSubspecies(w, s.id, { genome: { damage: 2 }, traits: s.traits.filter(t => t !== 'sapience') });
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (let i = 0; i < 40; i++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot()); expect(loaded.rng.state).toBe(w.rng.state);
    w.paused = true; const before = w.snapshot(); w.step();
    expect(updateSubspecies(w, s.id, { genome: { damage: 3 } })).toBe(false);
    expect(w.snapshot()).toEqual(before);
  });
});
