import { describe, expect, it } from 'vitest';
import { flatWorld, villageWorld } from './helpers';
import { createRegistry } from '../src/content/defaults';
import { registerAvailableTransformations } from '../src/content/metamorphosis';
import { createCivilComponents } from '../src/content/peoples';
import { World } from '../src/core/world';
import { deathOf } from '../src/core/death';
import { prepareForm, setRebirth, transformLiving, type TransformationDefinition } from '../src/core/metamorphosis';
import { createItem } from '../src/core/equipment';
import { foundHerd } from '../src/core/families';
import { inspectUnit, unitLink } from '../src/core/units';
import { economyOf } from '../src/core/village-life';
import { makeCargo } from '../src/core/resource-ledger';
import { applyEvent, processEvents } from '../src/systems/effects';
import { decodeSave } from '../src/persistence/schema';
import { NaturalBiome } from '../src/core/natural-biomes';
import { Terrain } from '../src/core/types';

const kill = (world: World, id: number): void => applyEvent(world, { kind: 'damage', target: id, amount: 100000, cause: 'age' });
const rule = (overrides: Partial<TransformationDefinition> = {}): TransformationDefinition => ({
  id: 'test:form', label: 'Test transition', trigger: 'death', sources: ['core:person'], target: 'core:wolf', priority: 30,
  change: 'body', identity: 'continue', items: 'compatible-or-ground', remove: ['infected', 'mush'], eligible: () => true, ...overrides,
});
/** Test-only bodies exercise dormant integrations without adding production species. */
function integrations() {
  const registry = createRegistry(), human = registry.species.get('human')!;
  for (const id of ['zombie', 'mush-humanoid', 'ghost', 'demon', 'baakin']) {
    const profile = registry.species.get(id)!;
    registry.species.delete(id);
    registry.registerSpecies({ ...profile, support: 'partial', runtime: structuredClone(human.runtime) });
    registry.registerEntity({ id: `test:${id}`, speciesId: id, sprite: 'person', create: (p, rng) => createCivilComponents('human', p, rng) });
  }
  registry.registerEntity({ id: 'core:monolith', sprite: 'crate', create: p => ({ position: p }) });
  registerAvailableTransformations(registry);
  return registry;
}

describe('transformations', () => {
  it('does not activate unavailable species or grant old saves a free rebirth', () => {
    const world = flatWorld(), e = world.spawn('core:person', { x: 20, y: 20 })!;
    const snapshot = world.snapshot(); snapshot.version = 49;
    const migrated = decodeSave(snapshot, world.registry);
    expect(migrated.rngState).toBe(snapshot.rngState);
    expect(migrated.entities.find(other => other.id === e.id)!.components.metamorphosis).toBeUndefined();
    expect([...world.registry.transformations.keys()]).toEqual(['core:rebirth', 'core:wolf-rebirth']);
    expect(() => world.registry.registerTransformation(rule({ target: 'core:zombie' }))).toThrow();
  });

  it('chooses one infection by priority and consumes incompatible signs', () => {
    const world = flatWorld(integrations()), e = world.spawn('core:person', { x: 20, y: 20 })!;
    e.components.metamorphosis = { marks: ['infected', 'mush', 'rebirth'], history: [] };
    kill(world, e.id); kill(world, e.id);
    const next = world.entities.get(deathOf(world, e.id)!.transformedInto!.id)!;
    expect(next.typeId).toBe('test:zombie'); expect(next.components.metamorphosis!.marks).toEqual([]);
    expect(world.deaths.total).toBe(1); expect([...world.query('resourcePile')]).toHaveLength(0);
    expect(decodeSave(world.snapshot(), world.registry).deaths!.total).toBe(1);
  });

  it('separates the additional ghost from the primary identity and its possessions', () => {
    const world = flatWorld(integrations()), e = world.spawn('core:person', { x: 20, y: 20 })!;
    world.terrain.setBiome(20, 20, NaturalBiome.Corrupted);
    e.components.metamorphosis = { marks: ['infected'], history: [] };
    createItem(world, 'stone-axe', { kind: 'equipped', entityId: e.id });
    kill(world, e.id);
    const memory = world.unitHistory.find(m => m.id === e.id)!;
    expect(memory.continuedAs).not.toBe(memory.echoId);
    expect(world.entities.get(memory.echoId!)!.typeId).toBe('test:ghost');
    expect(world.entities.get(memory.echoId!)!.components.raisedRemains).toEqual({ originId: e.id });
    expect(world.equipment.items).toHaveLength(1);
    expect(world.equipment.items[0].location).toEqual({ kind: 'equipped', entityId: memory.continuedAs });
    expect(world.deaths.total).toBe(1);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('requires 70 percent of the actual species lifespan and makes rebirth a one-use grant', () => {
    const world = flatWorld(), young = world.spawn('core:elf', { x: 20, y: 20 })!;
    young.components.person!.age = 104.99; setRebirth(world, young, 'self'); kill(world, young.id);
    expect(deathOf(world, young.id)!.transformedInto).toBeNull();
    const old = world.spawn('core:elf', { x: 24, y: 20 })!;
    old.components.person!.age = 105; old.components.person!.plague = { age: 2, spreadIn: 0.5 };
    setRebirth(world, old, 'self'); kill(world, old.id);
    const next = world.entities.get(deathOf(world, old.id)!.transformedInto!.id)!;
    expect(next.components.person!.age).toBe(0); expect(next.components.person!.plague).toBeUndefined();
    expect(next.components.metamorphosis!.marks).not.toContain('rebirth');
    kill(world, next.id); expect(deathOf(world, next.id)!.transformedInto).toBeNull();
  });

  it('retains ancestry and personal bonds across species, releases offices, and drops unusable equipment once', () => {
    const world = villageWorld([{ x: 24, y: 24 }]), village = world.society.villages[0];
    const e = world.entities.get(village.government!.leaderId!)!, partner = [...world.query('person')].find(p => p.id !== e.id)!;
    e.components.unit!.customName = 'Iris'; e.components.unit!.favorite = true; e.components.person!.age = 80;
    e.components.citizen!.partnerId = partner.id; partner.components.citizen!.partnerId = e.id;
    e.components.unit!.bestFriendId = partner.id; partner.components.unit!.bestFriendId = e.id;
    const child = world.spawn('core:person', { x: 30, y: 30 })!; child.components.citizen!.parents = [e.id, partner.id];
    createItem(world, 'stone-axe', { kind: 'equipped', entityId: e.id });
    e.components.citizen!.work = { good: 'stone', progress: 0, cargo: makeCargo({ stone: 4 }, village.id, 'stone') };
    setRebirth(world, e, 'wolf'); kill(world, e.id);
    const next = world.entities.get(deathOf(world, e.id)!.transformedInto!.id)!;
    expect(next.components.citizen).toBeUndefined(); expect(next.components.unit!.customName).toBe('Iris');
    expect(next.components.unit!.partnerId).toBe(partner.id); expect(partner.components.unit!.partnerId).toBe(next.id);
    expect(partner.components.unit!.bestFriendId).toBe(next.id);
    expect(inspectUnit(world, next.id)!.family.some(r => r.relation === 'Child' && r.member.id === child.id)).toBe(true);
    expect(unitLink(world, e.id)!.id).toBe(next.id);
    expect(economyOf(village).lost!.stone).toBe(4); expect(village.government!.leaderId).not.toBe(e.id);
    expect(world.equipment.items[0].location.kind).toBe('ground');
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    expect(loaded.entities.get(next.id)!.components.unit!.partnerId).toBe(partner.id);
    kill(loaded, next.id); expect(loaded.entities.get(partner.id)!.components.unit!.partnerId).toBeNull();
  });

  it('replaces a herd member atomically without dissolving a two-member herd', () => {
    const world = flatWorld(), a = world.spawn('core:sheep', { x: 20, y: 20 })!, b = world.spawn('core:sheep', { x: 22, y: 20 })!;
    const family = foundHerd(world, a, b)!; a.components.animal!.age = 160;
    setRebirth(world, a, 'self'); kill(world, a.id);
    const next = deathOf(world, a.id)!.transformedInto!.id;
    expect(family.members).toEqual([next, b.id]); expect(family.dissolvedAt).toBeNull();
    expect(family.alphaId).toBe(b.id); expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('resumes a queued lethal transition with the same random state and does nothing on pause', () => {
    const world = flatWorld(), e = world.spawn('core:person', { x: 20, y: 20 })!;
    e.components.person!.age = 80; setRebirth(world, e, 'self');
    world.events.push({ kind: 'damage', target: e.id, amount: 100000, cause: 'fire' }, { kind: 'damage', target: e.id, amount: 100000, cause: 'explosion' });
    const saved = decodeSave(world.snapshot(), world.registry), loaded = new World(world.seed, world.registry, saved);
    loaded.paused = true; const before = loaded.snapshot(); loaded.step(); expect(loaded.snapshot()).toEqual(before);
    loaded.paused = false; processEvents(world); processEvents(loaded);
    expect(loaded.snapshot()).toEqual(world.snapshot()); expect(world.deaths.total).toBe(1);
  });

  it('blocks demon eligibility before RNG for blessed and favorite creatures', () => {
    const world = flatWorld(integrations()), e = world.spawn('core:person', { x: 20, y: 20 })!, victim = world.spawn('core:person', { x: 22, y: 20 })!;
    e.components.citizen!.villageId = 1; victim.components.citizen!.villageId = 2;
    victim.components.citizen!.profession = { villageId: 2, office: 'resident', service: 'warrior' };
    world.society.relations.push({ a: 1, b: 2, status: 'war', affinity: -100, since: 0, nextDecision: 0, roadAttempt: 0 });
    applyEvent(world, { kind: 'damage', target: victim.id, amount: 100000, cause: 'conflict', sourceId: e.id });
    e.components.metamorphosis = { marks: ['rage', 'blessed'], history: [] };
    const rng = world.rng.state, context = { trigger: 'enemy-killed' as const, sourceId: victim.id, age: 'chaos' as const, disasters: true };
    expect(prepareForm(world, e, context)).toBeUndefined();
    e.components.metamorphosis.marks = ['rage']; e.components.unit!.favorite = true;
    expect(prepareForm(world, e, context)).toBeUndefined();
    expect(world.rng.state).toBe(rng);
    e.components.unit!.favorite = false;
    expect(world.registry.transformations.get('core:rage-demon')!.eligible(world, e, context)).toBe(true);
  });

  it('rejects Pure, unsupported species and a removed monolith, then evolves a supported body', () => {
    const world = flatWorld(integrations()), e = world.spawn('core:sheep', { x: 20, y: 20 })!, m = world.spawn('core:monolith', { x: 22, y: 20 })!;
    const context = { trigger: 'monolith' as const, sourceId: m.id };
    e.components.metamorphosis = { marks: ['pure'], history: [] };
    expect(transformLiving(world, e.id, context)).toBe(false);
    const dog = world.spawn('core:dog', { x: 24, y: 20 })!; expect(transformLiving(world, dog.id, context)).toBe(false);
    e.components.metamorphosis.marks = []; world.remove(m.id); expect(transformLiving(world, e.id, context)).toBe(false);
    const nextMonolith = world.spawn('core:monolith', { x: 22, y: 20 })!;
    expect(transformLiving(world, e.id, { ...context, sourceId: nextMonolith.id })).toBe(true);
    expect(world.entities.get(e.id)!.typeId).toBe('test:baakin'); expect(world.deaths.total).toBe(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('does not reroll a failed transformation for the same kill after loading', () => {
    const world = flatWorld(), e = world.spawn('core:person', { x: 20, y: 20 })!, victim = world.spawn('core:person', { x: 22, y: 20 })!;
    kill(world, victim.id);
    world.registry.registerTransformation(rule({ trigger: 'enemy-killed', chance: 0 }));
    const context = { trigger: 'enemy-killed' as const, sourceId: victim.id };
    expect(prepareForm(world, e, context)).toBeUndefined();
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry)), rng = loaded.rng.state;
    expect(prepareForm(loaded, loaded.entities.get(e.id)!, context)).toBeUndefined(); expect(loaded.rng.state).toBe(rng);
  });

  it('finds space for a larger body and does not award a transition when every site is blocked', () => {
    const world = flatWorld(), e = world.spawn('core:person', { x: 20.1, y: 20.1 })!;
    world.registry.registerTransformation(rule({ migrate: c => { c.solid = { radius: 1.2 }; } }));
    world.terrain.set(19, 20, Terrain.Water);
    kill(world, e.id);
    const next = world.entities.get(deathOf(world, e.id)!.transformedInto!.id)!;
    expect(next.components.position).not.toEqual({ x: 20.1, y: 20.1 });
    const blocked = world.spawn('core:person', { x: 30, y: 30 })!;
    for (let y = 22; y < 39; y++) for (let x = 22; x < 39; x++) world.terrain.set(x, y, Terrain.Water);
    const rng = world.rng.state; kill(world, blocked.id);
    expect(deathOf(world, blocked.id)!.transformedInto).toBeNull(); expect(world.rng.state).toBe(rng);
  });

  it('distinguishes appearance changes and rejects invalid form history', () => {
    const world = flatWorld(), e = world.spawn('core:person', { x: 20, y: 20 })!;
    world.registry.registerTransformation(rule({ id: 'test:appearance', trigger: 'appearance', change: 'appearance', target: 'self',
      migrate: c => { c.appearance = { variant: 3 }; } }));
    const age = e.components.person!.age;
    expect(transformLiving(world, e.id, { trigger: 'appearance' })).toBe(true);
    const changed = world.entities.get(e.id)!;
    expect(changed.typeId).toBe(e.typeId); expect(changed.components.person!.age).toBe(age); expect(world.deaths.total).toBe(0);
    const bad = world.snapshot(); bad.entities.find(other => other.id === e.id)!.components.metamorphosis!.history[0].fromId = 999999;
    expect(() => decodeSave(bad, world.registry)).toThrow();
  });
});
