import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { POPULATION_LIMIT, Terrain, type Entity } from '../src/core/types';
import { reproductionSystem, startReproduction, resolveReproduction, setReproductionProfile, cloneOffspring, reproductionHit } from '../src/core/reproduction';
import { reproductionSex, type ReproductionMethod } from '../src/core/reproduction-state';
import { subspeciesOf } from '../src/core/subspecies-state';
import { decodeSave } from '../src/persistence/schema';
import { applyStatus, hasStatus, removeStatus } from '../src/core/status-effects';
import { hasTrait } from '../src/core/traits';
import { intrinsicStat, nutritionRemaining } from '../src/core/unit-stats';
import { assignHouse } from '../src/systems/society';
import { settlement } from '../src/systems/people';

function resident(w: World, x = 20, y = 20): Entity {
  const e = w.spawn('core:person', { x, y })!;
  e.components.reproduction!.cooldowns = {};
  e.components.citizen!.hunger = 0;
  return e;
}
function pair(w: World): [Entity, Entity] {
  const a = resident(w), b = resident(w, 21);
  a.components.person!.sex = 'a'; b.components.person!.sex = 'b';
  a.components.citizen!.partnerId = b.id; b.components.citizen!.partnerId = a.id;
  return [a, b];
}
function configure(w: World, e: Entity, method: ReproductionMethod, form: 'direct' | 'viviparity' | 'oviparity' = 'direct'): void {
  const s = subspeciesOf(e)!;
  expect(setReproductionProfile(w, s.id, { ...s.reproduction!, methods: [method], form })).toBe(true);
}
const children = (w: World, e: Entity): Entity[] => [...w.query('person')].filter(n => n.components.citizen!.parents.includes(e.id));

describe('reproduction transactions', () => {
  it('finishes an existing pregnancy despite hunger, once, with the same replay after saving', () => {
    const w = flatWorld(), [a, b] = pair(w);
    expect(startReproduction(w, a, 'sexual', b)).toBe(true);
    const due = a.components.reproduction!.pending!.dueAt;
    a.components.citizen!.hunger = 99;
    const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    w.tick = restored.tick = due;
    resolveReproduction(w, a); resolveReproduction(restored, restored.entities.get(a.id)!);
    expect(children(w, a)).toHaveLength(1);
    expect(children(w, a)[0].components.citizen!.parents).toEqual([a.id, b.id]);
    const done = w.snapshot(); resolveReproduction(w, a);
    expect(w.snapshot()).toEqual(done); expect(restored.snapshot()).toEqual(done);
  });

  it('rejects cross-species conception without spending food or randomness', () => {
    const w = flatWorld(), a = resident(w), b = w.spawn('core:elf', { x: 21, y: 20 })!;
    a.components.person!.sex = 'a'; b.components.person!.sex = 'b'; b.components.reproduction!.cooldowns = {};
    const food = [a, b].map(nutritionRemaining), rng = w.rng.state;
    expect(startReproduction(w, a, 'sexual', b)).toBe(false);
    expect([a, b].map(nutritionRemaining)).toEqual(food); expect(w.rng.state).toBe(rng);
  });

  it('does not conceive across an impassable gap even when the partner is nearby', () => {
    const w = flatWorld(), [a, b] = pair(w);
    a.components.position = { x: 20.5, y: 20.5 }; b.components.position = { x: 22.5, y: 20.5 };
    for (let y = 0; y < w.terrain.height; y++) w.terrain.tiles[w.terrain.index(21, y)] = Terrain.Water;
    const food = [a, b].map(nutritionRemaining), rng = w.rng.state;
    expect(startReproduction(w, a, 'sexual', b)).toBe(false);
    expect(a.components.reproduction!.last!.reason).toBe('No route to the partner');
    expect([a, b].map(nutritionRemaining)).toEqual(food); expect(w.rng.state).toBe(rng);
  });

  it('forms a same-sex hermaphroditic pair and keeps reciprocal afterglow sources', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 21);
    configure(w, a, 'hermaphroditic', 'viviparity');
    a.components.person!.sex = b.components.person!.sex = 'b';
    const home = w.spawn('core:house', { x: 23, y: 20 })!, village = assignHouse(w, home);
    for (const e of [a, b]) { e.components.person!.homeId = home.id; e.components.citizen!.villageId = village.id; }
    settlement(w);
    expect(a.components.citizen!.partnerId).toBe(b.id);
    expect(startReproduction(w, a, 'hermaphroditic', b)).toBe(true);
    expect(a.components.statuses!.active.find(s => s.id === 'afterglow')!.source.id).toBe(b.id);
    expect(b.components.statuses!.active.find(s => s.id === 'afterglow')!.source.id).toBe(a.id);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('reserves the last population slot and cannot overfill it with twins or player spawns', () => {
    const w = flatWorld(), [a, b] = pair(w), s = subspeciesOf(a)!;
    setReproductionProfile(w, s.id, { ...s.reproduction!, birthRate: 8 });
    while (w.population < POPULATION_LIMIT - 1) resident(w, 5 + w.population % 30, 5 + Math.floor(w.population / 30) % 30);
    expect(startReproduction(w, a, 'sexual', b)).toBe(true);
    expect(a.components.reproduction!.pending!.children).toHaveLength(1);
    expect(w.spawn('core:person', { x: 40, y: 40 })).toBeUndefined();
    const tree = w.spawn('core:tree', { x: 42, y: 42 })!, rng = w.rng.state;
    expect(w.awakenTree(tree.id, 'core:person')).toBeUndefined();
    expect(tree.typeId).toBe('core:tree'); expect(w.rng.state).toBe(rng);
    w.tick = a.components.reproduction!.pending!.dueAt; resolveReproduction(w, a);
    expect(w.population).toBe(POPULATION_LIMIT); expect(children(w, a)).toHaveLength(1);
  });

  it('divides health, nutrition and happiness without duplicating them', () => {
    const w = flatWorld(), a = resident(w);
    configure(w, a, 'fission'); a.components.happiness!.value = 24;
    const health = a.components.health!.current, food = nutritionRemaining(a), happiness = a.components.happiness!.value;
    expect(startReproduction(w, a, 'fission')).toBe(true);
    const child = children(w, a)[0];
    expect(a.components.health!.current + child.components.health!.current).toBe(health);
    expect(nutritionRemaining(a) + nutritionRemaining(child)).toBeCloseTo(food);
    expect(a.components.happiness!.value + child.components.happiness!.value).toBe(happiness);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('lays an actual egg, freezes its growth and hatches the same entity once', () => {
    const w = flatWorld(), [a, b] = pair(w); configure(w, a, 'sexual', 'oviparity');
    expect(startReproduction(w, a, 'sexual', b)).toBe(true);
    const egg = children(w, a)[0], due = egg.components.reproduction!.egg!.hatchAt, count = w.entities.size;
    const snapshot = decodeSave(w.snapshot(), w.registry), loaded = new World(w.seed, w.registry, snapshot);
    for (let i = 0; i < 35; i++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot()); expect(egg.components.person!.age).toBe(0);
    w.tick = due; reproductionSystem(w);
    expect(w.entities.get(egg.id)).toBe(egg); expect(w.entities.size).toBe(count);
    expect(egg.components.reproduction!.egg).toBeUndefined(); expect(hasStatus(egg, 'stunned')).toBe(true);
    expect(egg.components.happiness!.history.filter(h => h.type === 'birth')).toHaveLength(1);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('gives divine birth only once and creates both sexes', () => {
    const w = flatWorld(), a = resident(w); configure(w, a, 'divine');
    a.components.person!.age = intrinsicStat(a, 'lifespan') * 0.7;
    expect(startReproduction(w, a, 'divine')).toBe(true);
    const offspring = children(w, a);
    expect(offspring.map(reproductionSex)).toEqual(expect.arrayContaining(['a', 'b']));
    expect(offspring.every(e => hasTrait(e, 'miracle-born'))).toBe(true); expect(hasTrait(a, 'miracle-bearer')).toBe(true);
    a.components.reproduction!.cooldowns = {}; removeStatus(w, a, 'afterglow', 'removed');
    expect(startReproduction(w, a, 'divine')).toBe(false);
    expect(new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)).entities.get(a.id)!.components.reproduction!.divineUsed).toBe(true);
  });

  it('does not turn a land spore landing in water into a newborn', () => {
    const w = flatWorld(), a = resident(w); configure(w, a, 'spore'); applyStatus(w, a, 'just-ate');
    expect(startReproduction(w, a, 'spore')).toBe(true);
    const p = a.components.reproduction!.pending!;
    for (const slot of p.children) {
      const q = slot.point!, index = w.terrain.index(q.x, q.y);
      w.terrain.tiles[index] = Terrain.Water;
    }
    w.tick = p.dueAt; resolveReproduction(w, a);
    expect(children(w, a)).toHaveLength(0); expect(a.components.reproduction!.pending).toBeUndefined();
  });

  it('cancels a surviving partner\'s pregnancy when a parent is removed and releases capacity', () => {
    const w = flatWorld(), [a, b] = pair(w); startReproduction(w, a, 'sexual', b);
    w.remove(b.id);
    expect(a.components.reproduction!.pending).toBeUndefined(); expect(hasStatus(a, 'pregnant')).toBe(false);
    expect(a.components.reproduction!.last!.reason).toBe('Parent is gone');
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('makes budding and rooting complete through their own saved status owner', () => {
    for (const method of ['budding', 'vegetative'] as const) {
      const w = flatWorld(), a = resident(w); configure(w, a, method);
      expect(startReproduction(w, a, method)).toBe(true);
      const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
      restored.tick = a.components.reproduction!.pending!.dueAt;
      resolveReproduction(restored, restored.entities.get(a.id)!);
      expect(children(restored, a)).toHaveLength(1);
      if (method === 'vegetative') expect(hasStatus(children(restored, a)[0], 'uprooting')).toBe(true);
    }
  });

  it('metamorphs a child in place without adding an entity or resurrecting a dead target', () => {
    const w = flatWorld(), actor = resident(w, 7, 20), victim = resident(w, 38, 20);
    configure(w, actor, 'metamorph'); victim.components.person!.age = 1;
    const count = w.entities.size, id = victim.id;
    reproductionHit(w, actor, victim, 1);
    expect(w.entities.size).toBe(count); expect(w.entities.get(id)!.components.subspecies!.id).toBe(actor.components.subspecies!.id);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    w.remove(id); reproductionHit(w, actor, victim, 1); expect(w.entities.size).toBe(count - 1);
  });

  it('preserves legacy pregnancy deadlines, bodies and RNG, and pauses without advancing', () => {
    const w = flatWorld(), [a, b] = pair(w); startReproduction(w, a, 'sexual', b);
    const raw = w.snapshot(), due = a.components.reproduction!.pending!.dueAt;
    raw.version = 55; for (const e of raw.entities) delete e.components.reproduction;
    for (const s of raw.subspecies!.records) delete s.reproduction;
    const migrated = decodeSave(raw, w.registry);
    expect(migrated.rngState).toBe(raw.rngState);
    expect(migrated.entities[0].components.reproduction!.pending!.dueAt).toBe(due);
    expect(migrated.entities.map(e => e.components.health)).toEqual(raw.entities.map(e => e.components.health));
    w.paused = true; const before = w.snapshot(); w.step(); resolveReproduction(w, a);
    expect(startReproduction(w, a, 'sexual', b)).toBe(false); expect(w.snapshot()).toEqual(before);
  });

  it('tracks clone origin and rejects fabricated parent, reservation and egg references', () => {
    const w = flatWorld(), a = resident(w), child = cloneOffspring(w, a)!;
    expect(child.components.reproduction!.cloneOf).toBe(a.id); expect(child.components.creature!.origin).toBe('cloned');
    expect(child.components.citizen!.parents).toEqual([a.id]); expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    const badClone = w.snapshot(); badClone.entities.find(e => e.id === child.id)!.components.reproduction!.cloneOf = child.id;
    expect(() => decodeSave(badClone, w.registry)).toThrow();
    const home = w.spawn('core:house', { x: 23, y: 20 })!, village = assignHouse(w, home);
    a.components.person!.homeId = home.id; a.components.citizen!.villageId = village.id;
    configure(w, a, 'parthenogenesis', 'viviparity'); a.components.person!.sex = 'a';
    expect(startReproduction(w, a, 'parthenogenesis')).toBe(true);
    const badParent = w.snapshot(); badParent.entities[0].components.reproduction!.pending!.parents = [999999];
    expect(() => decodeSave(badParent, w.registry)).toThrow();
  });
});
