import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { COLLECTIVE_PROFILES, TAXA, taxonomyPath } from '../src/content/taxonomy';
import { collectivePolicy, familyOf, foundHerd, joinFamily, leaveFamily, migrationFamilies, parentsOf, recordFamilyBirth } from '../src/core/families';
import { World } from '../src/core/world';
import { STEP, Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { defendHerd, followHerd, forageHerd } from '../src/systems/herds';
import { husbandry } from '../src/systems/husbandry';
import { findPath } from '../src/systems/navigation';
import { familyDetails } from '../src/ui/families';
import { taxonomyInspector } from '../src/ui/taxonomy';
import { setRebirth } from '../src/core/metamorphosis';
import { applyEvent } from '../src/systems/effects';

describe('taxonomy and collective policies', () => {
  it('covers only supported forms and keeps names independent of family identity', () => {
    const w = flatWorld();
    expect(Object.keys(COLLECTIVE_PROFILES).sort()).toEqual([...w.registry.species.values()].filter(p => p.runtime).map(p => p.id).sort());
    const a = w.spawn('core:dog', { x: 10, y: 20 })!, b = w.spawn('core:dog', { x: 12, y: 20 })!;
    const f = foundHerd(w, a, b)!, before = w.snapshot();
    const renamed = TAXA.map(t => ({ ...t, label: `translated ${t.label}` }));
    expect(taxonomyPath('dog', renamed).map(t => t.id)).toEqual(taxonomyPath('dog').map(t => t.id));
    expect(taxonomyPath('dog')).toEqual(taxonomyPath('wolf'));
    const wolf = w.spawn('core:wolf', { x: 14, y: 20 })!;
    expect(joinFamily(w, wolf, f)).toBe(false);
    expect(w.families).toEqual(before.families);
    expect(taxonomyPath('dragon')).toEqual([]);
    expect(taxonomyPath('human', TAXA.filter(t => t.rank !== 'order')).map(t => t.rank)).toEqual(['family', 'genus', 'species']);
  });

  it.each([['core:person', 10], ['core:elf', 20], ['core:dwarf', 30], ['core:orc', 50], ['core:sheep', 100], ['core:dog', 20], ['core:wolf', 20]] as const)('applies the founding limit for %s', (typeId, limit) => {
    const w = flatWorld(), a = w.spawn(typeId, { x: 10, y: 20 })!, b = w.spawn(typeId, { x: 12, y: 20 })!, child = w.spawn(typeId, { x: 14, y: 20 })!;
    expect(recordFamilyBirth(w, child, [a.id, b.id])?.limit).toBe(limit);
    expect(decodeSave(w.snapshot(), w.registry).families!.records[0].limit).toBe(limit);
  });

  it('fills the last place, then splits a completed birth without losing child, ancestry or members', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 10, y: 20 })!, b = w.spawn('core:person', { x: 12, y: 20 })!;
    const births = Array.from({ length: 9 }, (_, i) => w.spawn('core:person', { x: 14 + i, y: 20 })!);
    const f = recordFamilyBirth(w, births[0], [a.id, b.id])!;
    for (const child of births.slice(1, 8)) recordFamilyBirth(w, child, [a.id, b.id]);
    expect(f.members).toHaveLength(10);
    const child = births[8], split = recordFamilyBirth(w, child, [a.id, b.id])!;
    expect(split.id).not.toBe(f.id); expect(split.members).toEqual([a.id, b.id, child.id]);
    expect(child.components.kinship!.originFamilyId).toBe(f.id);
    expect(parentsOf(child)).toEqual([a.id, b.id]);
    expect(f.members).toEqual(births.slice(0, 8).map(e => e.id));
    const saved = w.snapshot(); recordFamilyBirth(w, child, [a.id, b.id]);
    expect(w.snapshot()).toEqual(saved);
    expect(decodeSave(saved, w.registry).families!.records).toHaveLength(2);
  });

  it('retains a singleton, elects one successor and dissolves only on the last departure', () => {
    const w = flatWorld(), a = w.spawn('core:dog', { x: 10, y: 20 })!, b = w.spawn('core:dog', { x: 12, y: 20 })!;
    const f = foundHerd(w, a, b)!;
    w.remove(a.id);
    expect(f).toMatchObject({ alphaId: b.id, members: [b.id], dissolvedAt: null });
    expect(decodeSave(w.snapshot(), w.registry).families!.records[0].alphaId).toBe(b.id);
    leaveFamily(w, b); expect(f).toMatchObject({ alphaId: null, members: [], dissolvedAt: w.tick });
    expect(migrationFamilies(w, [a.id, b.id])).toEqual([]);
  });

  it('keeps parents when an adult transfers and refuses foreign family records', () => {
    const w = flatWorld(), animals = [10, 12, 14, 16, 18].map(x => w.spawn('core:dog', { x, y: 20 })!);
    const origin = recordFamilyBirth(w, animals[2], animals.slice(0, 2).map(e => e.id))!, next = foundHerd(w, animals[3], animals[4])!;
    expect(joinFamily(w, animals[2], { ...next, members: [] })).toBe(false);
    expect(joinFamily(w, animals[2], next)).toBe(true);
    expect(animals[2].components.kinship!.originFamilyId).toBe(origin.id);
    expect(parentsOf(animals[2])).toEqual(animals.slice(0, 2).map(e => e.id));
    expect(migrationFamilies(w, [animals[2].id, 99999])).toEqual([next.id]);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('does not count proximity across a narrow strait as gathering', () => {
    const w = flatWorld(), a = w.spawn('core:sheep', { x: 20.8, y: 20 })!, b = w.spawn('core:sheep', { x: 22.2, y: 20 })!;
    foundHerd(w, a, b);
    for (let y = 0; y < 48; y++) w.terrain.set(21, y, Terrain.DeepWater);
    followHerd(w, b, findPath);
    expect(b.components.kinship!.herd!.reason).toBe('No route to the herd');
    expect(b.components.animal!.path).toEqual([]);
    expect(familyDetails(w, b.id, null, 'en', v => v.name)).toContain('Near the leader: 1 / 2');
  });

  it('routes to safe pasture and actually reduces hunger after arrival', () => {
    const w = flatWorld(), a = w.spawn('core:sheep', { x: 10.5, y: 20.5 })!, b = w.spawn('core:sheep', { x: 12.5, y: 20.5 })!;
    foundHerd(w, a, b); w.terrain.set(10, 20, Terrain.Sand); a.components.animal!.hunger = 50;
    expect(forageHerd(w, a, findPath)).toBe(true); expect(a.components.animal!.path.length).toBeGreaterThan(0);
    const before = a.components.animal!.hunger;
    for (let i = 0; i < 180; i++) { w.tick++; husbandry(w, STEP); }
    expect(w.terrain.at(a.components.position!.x, a.components.position!.y)).toBe(Terrain.Grass);
    expect(a.components.animal!.hunger).toBeLessThan(before);
  });

  it('defends a targeted member through the existing combat owner and clears removed targets', () => {
    const w = flatWorld(), a = w.spawn('core:dog', { x: 10.5, y: 20.5 })!, b = w.spawn('core:dog', { x: 12.5, y: 20.5 })!, attacker = w.spawn('core:wolf', { x: 11.5, y: 20.5 })!;
    foundHerd(w, a, b); attacker.components.animal!.targetId = b.id;
    expect(defendHerd(w, a, findPath)).toBe(true); expect(a.components.animal!.targetId).toBe(attacker.id);
    husbandry(w, STEP); expect(a.components.creature!.result?.kind).toBe('hit');
    expect(a.components.kinship!.herd!.reason).toBe('Defending a herd member');
    w.remove(attacker.id); expect(a.components.animal!.targetId).toBeNull();
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('replays active grazing and following through save/load without extra randomness, and freezes on pause', () => {
    const a = flatWorld(), first = a.spawn('core:sheep', { x: 10.5, y: 20.5 })!, second = a.spawn('core:sheep', { x: 16.5, y: 20.5 })!;
    foundHerd(a, first, second); first.components.animal!.hunger = 50;
    a.terrain.set(10, 20, Terrain.Sand); husbandry(a, STEP);
    const b = new World(a.seed, a.registry, decodeSave(a.snapshot(), a.registry));
    for (let i = 0; i < 90; i++) { a.tick++; b.tick++; husbandry(a, STEP); husbandry(b, STEP); }
    expect(b.snapshot()).toEqual(a.snapshot()); expect(b.rng.state).toBe(a.rng.state);
    a.paused = true; const before = a.snapshot(); husbandry(a, STEP); forageHerd(a, first, findPath); followHerd(a, second, findPath);
    expect(a.snapshot()).toEqual(before);
  });

  it('does not infer a family from a boat owner and localizes the separate tree', () => {
    const w = flatWorld();
    w.terrain.set(30, 30, Terrain.DeepWater);
    const boat = w.spawn('core:ship', { x: 30.5, y: 30.5 })!, harbor = w.spawn('core:harbor', { x: 29.5, y: 30.5 })!;
    boat.components.ship!.homeId = harbor.id;
    expect(collectivePolicy(w.registry, boat)).toBeUndefined(); expect(familyOf(w, boat)).toBeUndefined();
    expect(boat.components.kinship).toBeUndefined(); expect(w.families.records).toEqual([]);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    for (const language of ['en', 'ru', 'zh-CN', 'ja', 'es'] as const) {
      expect(taxonomyInspector('human', language)).toContain('data-taxon="hominidae"');
      expect(taxonomyInspector('boat', language)).not.toContain('data-taxon=');
    }
  });

  it('changes taxonomy and membership on wolf rebirth while preserving human ancestry', () => {
    const w = flatWorld(), a = w.spawn('core:person', { x: 10, y: 20 })!, b = w.spawn('core:person', { x: 12, y: 20 })!, child = w.spawn('core:person', { x: 14, y: 20 })!;
    const origin = recordFamilyBirth(w, child, [a.id, b.id])!;
    child.components.person!.age = 200; setRebirth(w, child, 'wolf');
    applyEvent(w, { kind: 'damage', target: child.id, amount: 100000, cause: 'age' });
    const wolf = [...w.query('animal')][0];
    expect(wolf.components.creature!.speciesId).toBe('wolf');
    expect(wolf.components.kinship).toMatchObject({ familyId: null, originFamilyId: origin.id });
    expect(parentsOf(wolf)).toEqual([a.id, b.id]); expect(origin.members).toEqual([a.id, b.id]);
    expect(taxonomyPath(wolf.components.creature!.speciesId).at(-1)?.id).toBe('canis-lupus');
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('loads saved founding limits without expanding groups or consuming randomness', () => {
    const w = flatWorld(), a = w.spawn('core:sheep', { x: 10, y: 20 })!, b = w.spawn('core:sheep', { x: 12, y: 20 })!;
    foundHerd(w, a, b)!.limit = 8;
    const saved = w.snapshot(), loaded = new World(w.seed, w.registry, decodeSave(saved, w.registry));
    expect(loaded.snapshot()).toEqual(saved); expect(loaded.families.records[0].limit).toBe(8);
  });
});
