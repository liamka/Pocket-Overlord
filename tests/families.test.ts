import { describe, expect, it } from 'vitest';
import { flatWorld, migrationWorld } from './helpers';
import { World } from '../src/core/world';
import { familyOf, foundHerd, joinFamily, recordFamilyBirth } from '../src/core/families';
import { decodeSave } from '../src/persistence/schema';
import { husbandry } from '../src/systems/husbandry';
import { followHerd, updateHerd } from '../src/systems/herds';
import { findPath } from '../src/systems/navigation';
import { migrations } from '../src/systems/migration';
import { settlement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { STEP, Terrain } from '../src/core/types';
import { translate } from '../src/i18n';

const resident = (w: World, x = 10) => w.spawn('core:person', { x, y: 20 })!;
const sheep = (w: World, x = 10) => w.spawn('core:sheep', { x, y: 20 })!;

describe('families and herds', () => {
  it('creates a single family on actual births, never on pair selection', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(w, home);
    const a = resident(w, 10), b = resident(w, 14);
    for (const [i, e] of [a, b].entries()) {
      Object.assign(e.components.person!, { age: 25, sex: i ? 'b' : 'a', homeId: home.id, reproduceIn: 100 });
      e.components.citizen!.villageId = village.id;
    }
    settlement(w);
    expect(a.components.citizen!.partnerId).toBe(b.id);
    expect(w.families.records).toHaveLength(0);
    for (let i = 0; i < 2; i++) {
      w.tick += 30;
      Object.assign(a.components.citizen!, { pregnancy: 0.01, fatherId: b.id });
      settlement(w);
    }
    expect(w.families.records).toHaveLength(1);
    expect(w.families.records[0].members).toHaveLength(4);
    expect(w.population).toBe(4);
  });

  it('keeps ancestors and origin families when a child starts a new family', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 12), child = resident(w, 14);
    const old = recordFamilyBirth(w, child, [a.id, b.id])!;
    const mate = resident(w, 16), grandchild = resident(w, 18);
    const next = recordFamilyBirth(w, grandchild, [child.id, mate.id])!;
    expect(next.originFamilyIds).toEqual([old.id, null]);
    expect(old.members).toEqual([a.id, b.id]);
    expect(child.components.citizen!.parents).toEqual([a.id, b.id]);
    w.remove(a.id); w.remove(b.id);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    expect(loaded.families.records[0]).toMatchObject({ members: [], dissolvedAt: w.tick });
    expect(loaded.entities.get(child.id)!.components.citizen!.parents).toEqual([a.id, b.id]);
    expect(loaded.unitHistory.map(m => m.id)).toContain(a.id);
    expect(recordFamilyBirth(loaded, loaded.entities.get(grandchild.id)!, [child.id, mate.id])?.id).toBe(next.id);
    expect(loaded.families.records).toHaveLength(2);
  });

  it('replaces a dead alpha and discards the route to its old position', () => {
    const w = flatWorld(), a = sheep(w, 8), b = sheep(w, 14), c = sheep(w, 20);
    const f = foundHerd(w, a, b)!; joinFamily(w, c, f);
    followHerd(w, c, findPath);
    expect(c.components.kinship!.herd!.followId).toBe(a.id);
    a.components.health!.current = 0; w.die(a.id, { cause: 'hunger' });
    expect(f.alphaId).toBe(b.id);
    expect(c.components.kinship!.herd!.followId).toBeNull();
    expect(c.components.animal!.path).toEqual([]);
    followHerd(w, c, findPath);
    expect(c.components.kinship!.herd!.followId).toBe(b.id);
    expect(c.components.animal!.path.length).toBeGreaterThan(0);
  });

  it('only lets safe adult followers leave a full herd; its child stays', () => {
    const w = flatWorld(), animals = Array.from({ length: 4 }, (_, i) => sheep(w, 10 + i));
    const f = foundHerd(w, animals[0], animals[1])!;
    f.limit = 4; // A saved founding limit survives later species-balance changes.
    for (const e of animals.slice(2)) joinFamily(w, e, f);
    animals[2].components.animal!.age = 2;
    for (const e of animals) e.components.kinship!.herd!.leaveIn = 0;
    updateHerd(w, animals[0], STEP, findPath); updateHerd(w, animals[2], STEP, findPath);
    expect(f.members).toHaveLength(f.limit);
    animals[1].components.thermal!.burning = true;
    updateHerd(w, animals[1], STEP, findPath);
    expect(f.members).toHaveLength(f.limit);
    updateHerd(w, animals[3], STEP, findPath);
    expect(animals[3].components.kinship!.familyId).toBeNull();
    expect(animals[3].components.kinship!.previousFamilyId).toBe(f.id);
    expect(f.members).toContain(animals[2].id);
  });

  it('does not join or claim to follow across an impassable barrier', () => {
    const w = flatWorld(), a = sheep(w, 20), b = sheep(w, 22), c = sheep(w, 26);
    const f = foundHerd(w, a, b)!;
    for (let y = 0; y < 48; y++) w.terrain.set(24, y, Terrain.DeepWater);
    c.components.kinship!.herd!.joinIn = 0;
    updateHerd(w, c, STEP, findPath);
    expect(familyOf(w, c)).toBeUndefined();
    joinFamily(w, c, f); followHerd(w, c, findPath);
    expect(c.components.kinship!.herd!.reason).toBe('No route to the herd');
    expect(c.components.animal!.path).toEqual([]);
  });

  it('retains animal parents and the family after a second lamb is born', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 10, y: 24 })!, v = assignHouse(w, home);
    const a = sheep(w, 9), b = sheep(w, 11);
    for (const e of [a, b]) { e.components.animal!.villageId = v.id; e.components.animal!.breedIn = 0; }
    husbandry(w, STEP);
    const first = [...w.query('animal')].find(e => e.id !== a.id && e.id !== b.id)!;
    expect(first.components.animal!.parents).toEqual([a.id, b.id]);
    a.components.animal!.breedIn = b.components.animal!.breedIn = 0;
    husbandry(w, STEP);
    expect(w.families.records).toHaveLength(1);
    expect(familyOf(w, a)!.members).toHaveLength(4);
    w.remove(a.id);
    expect(w.unitHistory.find(m => m.id === a.id)?.kinship?.familyId).toBe(first.components.kinship!.originFamilyId);
    expect(decodeSave(w.snapshot(), w.registry).entities.find(e => e.id === first.id)!.components.animal!.parents).toContain(a.id);
  });

  it('replays active following through save/load with the same random state and pauses timers', () => {
    const a = flatWorld(), first = sheep(a, 8), second = sheep(a, 15);
    foundHerd(a, first, second); husbandry(a, STEP);
    const b = new World(a.seed, a.registry, decodeSave(a.snapshot(), a.registry));
    for (let i = 0; i < 75; i++) { a.tick++; b.tick++; husbandry(a, STEP); husbandry(b, STEP); }
    expect(b.snapshot()).toEqual(a.snapshot()); expect(b.rng.state).toBe(a.rng.state);
    a.paused = true; const paused = a.snapshot(); a.step(); husbandry(a, STEP);
    expect(a.snapshot()).toEqual(paused);
  });

  it('keeps family identity while a separate migration travels and settles', () => {
    const w = migrationWorld(), [a, b, child] = [...w.query('person')];
    const f = recordFamilyBirth(w, child, [a.id, b.id])!;
    w.tick = 300; migrations(w);
    const group = w.society.migrations[0]; expect(group.familyIds).toEqual([f.id]);
    for (const id of group.members) {
      const e = w.entities.get(id)!; Object.assign(e.components.position!, group.destination); w.spatial.update(e);
    }
    w.tick += 15; migrations(w);
    expect(w.society.migrations).toHaveLength(0);
    expect(familyOf(w, a)?.id).toBe(f.id); expect(f.members).toEqual([a.id, b.id, child.id]);
  });

  it('migrates old couples without inventing a birth or consuming randomness', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 12);
    a.components.citizen!.partnerId = b.id; b.components.citizen!.partnerId = a.id;
    const old = w.snapshot(); old.version = 48; delete old.families;
    for (const e of old.entities) delete e.components.kinship;
    const migrated = decodeSave(old, w.registry);
    expect(migrated.families?.records).toEqual([]); expect(migrated.rngState).toBe(old.rngState);
    expect(migrated.entities[0].components.citizen!.partnerId).toBe(b.id);
  });

  it('rejects dangling members, wrong alpha, cyclic origin and invalid timers', () => {
    const w = flatWorld(), a = sheep(w), b = sheep(w, 12); foundHerd(w, a, b);
    const save = w.snapshot();
    for (const mutate of [
      (s: typeof save) => { s.families!.records[0].members.push(99999); },
      (s: typeof save) => { s.families!.records[0].alphaId = b.id; },
      (s: typeof save) => { s.families!.records[0].originFamilyIds = [1]; },
      (s: typeof save) => { s.entities[0].components.kinship!.herd!.joinIn = -1; },
    ]) { const bad = structuredClone(save); mutate(bad); expect(() => decodeSave(bad, w.registry)).toThrow(); }
  });

  it('localizes the visible herd cause and genealogy navigation', () => {
    expect(translate('No route to the herd', 'ru')).toBe('Нет пути к стаду');
    expect(translate('Open genealogy', 'ru')).toBe('Открыть родословную');
    expect(translate('Mira now leads the herd as its oldest member', 'ru')).toBe('Mira стал старшим и повёл стадо');
  });
});
