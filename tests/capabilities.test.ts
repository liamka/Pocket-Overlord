import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { createCivilComponents } from '../src/content/peoples';
import { Registry } from '../src/content/registry';
import { BASIC_CAPABILITIES, CIVIL_CAPABILITIES, canGovern, canOpenUnitEditor, hasCapability, touchesGround } from '../src/core/capabilities';
import type { SpeciesProfile } from '../src/core/creatures';
import { requestCraft } from '../src/core/crafting';
import { createItem } from '../src/core/equipment';
import { deposit } from '../src/core/resource-ledger';
import { initializeStorage, storesOf } from '../src/core/stockpiles';
import { STEP, Terrain } from '../src/core/types';
import { governmentOf } from '../src/core/village-life';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { enrage } from '../src/systems/afflictions';
import { reconcileOffices } from '../src/systems/capabilities';
import { startCraft } from '../src/systems/crafting';
import { governance } from '../src/systems/governance';
import { creaturePath } from '../src/systems/navigation';
import { movement, settlement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

function flightFixture() {
  const registry = createRegistry(), profile = structuredClone(registry.species.get('human')!);
  Object.assign(profile, { id: 'test-insect', group: 'insects' });
  profile.runtime = { ...profile.runtime!, ...BASIC_CAPABILITIES, owner: 'movement', movement: ['fly'], families: ['insect', 'flying-insect'] };
  registry.registerSpecies(profile).registerEntity({ id: 'test:insect', speciesId: profile.id, sprite: 'crate', create: p => ({
    position: { ...p }, health: { current: 10, max: 10 },
    motion: { vx: 0, vy: 0, speed: 2, heading: 0, decisionIn: 2 },
  }) });
  return { registry, profile };
}

describe('independent creature capabilities', () => {
  it('rejects incompatible profiles, competing handlers and absent providers before a world starts', () => {
    const { registry, profile } = flightFixture();
    const invalid = (runtime: Partial<NonNullable<SpeciesProfile['runtime']>>) => ({ ...structuredClone(profile), id: 'invalid', runtime: { ...profile.runtime!, ...runtime } });
    expect(() => registry.registerSpecies(invalid({ governance: true }))).toThrow('governance requires citizenship and sapience');
    expect(() => registry.registerSpecies(invalid({ citizenship: true }))).toThrow('citizenship requires');
    expect(() => registry.registerEntity({ id: 'test:missing', speciesId: profile.id, sprite: 'crate', create: p => ({ position: p, health: { current: 1, max: 1 } }) })).toThrow('requires component motion');
    expect(() => registry.registerEntity({ id: 'test:conflict', speciesId: profile.id, sprite: 'crate', create: (p, rng) => createCivilComponents('human', p, rng) })).toThrow('conflicts with movement');
    const incomplete = new Registry().registerSpecies(profile);
    expect(() => incomplete.resolveSystems()).toThrow('requires system core:movement');
    expect(() => registry.registerSpecies({ ...invalid({ genomeBudget: true }), parameters: undefined })).toThrow('genome capability requires a species budget');
    registry.registerSpecies(invalid({ genomeBudget: true }));
    expect(() => registry.resolveSystems()).not.toThrow();
  });

  it('flies across a ground barrier without city duties, and refuses a route outside the world', () => {
    const { registry } = flightFixture(), world = flatWorld(registry);
    const insect = world.spawn('test:insect', { x: 20, y: 20 })!;
    for (let y = 0; y < 48; y++) world.terrain.set(21, y, Terrain.Mountain);
    expect(creaturePath(world, insect, { x: 23, y: 20 }, 0)).toEqual([{ x: 23, y: 20 }]);
    expect(creaturePath(world, insect, { x: 48, y: 20 }, 0)).toBeUndefined();
    movement(world, 1);
    expect(insect.components.position).toEqual({ x: 22, y: 20 });
    expect(touchesGround(registry, insect)).toBe(false);
    expect(insect.components.citizen).toBeUndefined();
    expect(canOpenUnitEditor(registry, insect, 'equipment')).toBe(false);
    expect(canOpenUnitEditor(registry, insect, 'genealogy')).toBe(false);
    expect(canGovern(registry, insect)).toBe(false);
    world.paused = true;
    const before = world.snapshot(); movement(world, STEP); world.step();
    expect(world.snapshot()).toEqual(before);
  });

  it('keeps species identity and gene-free saves independent of mutable input profiles', () => {
    const { registry, profile } = flightFixture(), world = flatWorld(registry), insect = world.spawn('test:insect', { x: 20, y: 20 })!;
    const before = world.snapshot();
    profile.id = 'changed'; profile.runtime!.genomeEditor = true;
    expect(registry.species.get('test-insect')!.runtime!.genomeEditor).toBe(false);
    expect(() => registry.bindSpecies('test:insect', 'human')).toThrow('Species identity already bound');
    const saved = decodeSave(before, registry), restored = saved.entities.find(e => e.id === insect.id)!;
    expect(restored.components.creature).toEqual(insect.components.creature);
    expect(Object.keys(restored.components)).not.toContain('genome');
    expect(Object.keys(restored.components)).not.toContain('genomeBudget');
    expect(saved.rngState).toBe(before.rngState);
    const bad = world.snapshot();
    bad.entities[0].components.citizen = registry.entities.get('core:person')!.create({ x: 20, y: 20 }, world.rng).citizen;
    expect(() => decodeSave(bad, registry)).toThrow();
  });

  it('gives an intelligent animal the existing home, leadership and equipment contracts', () => {
    const registry = createRegistry(), profile = structuredClone(registry.species.get('human')!);
    Object.assign(profile, { id: 'test-civil-animal', group: 'animals' });
    profile.runtime = { ...profile.runtime!, ...CIVIL_CAPABILITIES, families: ['animal-civil'] };
    registry.registerSpecies(profile).registerEntity({ id: 'test:civil-animal', speciesId: profile.id, sprite: 'person', create: (p, rng) => createCivilComponents('human', p, rng) });
    const world = flatWorld(registry), home = world.spawn('core:house', { x: 20, y: 20 })!, village = assignHouse(world, home);
    const animal = world.spawn('test:civil-animal', { x: 22, y: 20 })!;
    settlement(world); governance(world);
    expect(animal.components.person!.homeId).toBe(home.id);
    expect(animal.components.citizen!.villageId).toBe(village.id);
    expect(village.government!.leaderId).toBe(animal.id);
    const item = createItem(world, 'stone-axe', { kind: 'equipped', entityId: animal.id });
    expect(item.location).toEqual({ kind: 'equipped', entityId: animal.id });
    expect(canOpenUnitEditor(registry, animal, 'equipment')).toBe(true);
    expect(animal.components.animal).toBeUndefined();
    expect(decodeSave(world.snapshot(), registry).entities.find(e => e.id === animal.id)!.components.creature!.speciesId).toBe(profile.id);
    world.remove(animal.id); reconcileOffices(world);
    expect(village.government!.leaderId).toBeNull();
    expect(item.location.kind).toBe('ground');
  });

  it('releases an elder and unpaid work immediately on pause without refunds or duplicate events', () => {
    const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(world, home);
    const workshop = world.spawn('core:workshop', { x: 24, y: 24 })!; workshop.components.workplace!.villageId = village.id;
    const elder = world.spawn('core:person', { x: 22.3, y: 24 })!, recipient = world.spawn('core:person', { x: 18, y: 20 })!;
    for (const e of [elder, recipient]) { e.components.person!.homeId = home.id; e.components.citizen!.villageId = village.id; }
    governmentOf(village).leaderId = elder.id;
    initializeStorage(world, village); deposit(village, { stone: 2, wood: 1 });
    const order = requestCraft(world, recipient, 'weapon')!;
    expect(startCraft(world, elder, order, workshop)).toBe(true);
    const item = createItem(world, 'stone-axe', { kind: 'ground', x: 22, y: 24 }); item.claim = elder.id;
    const before = structuredClone(storesOf(village).map(s => s.goods)), identity = structuredClone(elder.components.creature), rng = world.rng.state;
    world.paused = true; enrage(world, elder);
    expect(village.government!.leaderId).toBeNull();
    expect(hasCapability(world.registry, elder, 'sapience', true)).toBe(false);
    expect(order).toMatchObject({ state: 'cancelled', paid: false, reason: 'unsafe' });
    expect(storesOf(village).flatMap(s => s.reservations)).toEqual([]);
    expect(storesOf(village).map(s => s.goods)).toEqual(before);
    expect(item.claim).toBeUndefined(); expect(elder.components.creature).toEqual(identity);
    expect(elder.components.person!.homeId).toBe(home.id);
    const after = world.snapshot(); enrage(world, elder); world.step();
    expect(world.snapshot()).toEqual(after); expect(world.rng.state).toBe(rng);
    const loaded = decodeSave(after, world.registry);
    expect(loaded.society.villages[0].government!.leaderId).toBeNull();
    const legacy = world.snapshot(); legacy.society.villages[0].government!.leaderId = elder.id;
    expect(decodeSave(legacy, world.registry).society.villages[0].government!.leaderId).toBeNull();
  });

  it('retains carried materials when civil duties are suspended', () => {
    const world = flatWorld(), home = world.spawn('core:house', { x: 18, y: 20 })!, village = assignHouse(world, home);
    const person = world.spawn('core:person', { x: 20, y: 20 })!;
    person.components.person!.homeId = home.id; person.components.citizen!.villageId = village.id;
    person.components.citizen!.work = { good: 'wood', progress: 1, cargo: { good: 'wood', amount: 2, villageId: village.id } };
    const cargo = structuredClone(person.components.citizen!.work!.cargo);
    enrage(world, person); enrage(world, person);
    expect(person.components.citizen!.work?.cargo).toEqual(cargo);
    expect(world.equipment.items).toEqual([]);
  });

  it('continues flight and a dragon breath with the same RNG after saving, and cleans removed targets', () => {
    const { registry } = flightFixture(), world = flatWorld(registry);
    world.spawn('test:insect', { x: 20, y: 20 });
    const sheep = world.spawn('core:sheep', { x: 30, y: 30 })!, dragon = world.spawn('core:dragon', { x: 28, y: 30 })!;
    Object.assign(dragon.components.dragon!, { targetId: sheep.id, breath: 0.6, pulseIn: 0.1 });
    world.paused = true; const before = world.snapshot(); world.step(); expect(world.snapshot()).toEqual(before);
    const resumed = new World(world.seed, registry, decodeSave(before, registry));
    world.paused = resumed.paused = false;
    for (let i = 0; i < 60; i++) { world.step(); resumed.step(); }
    expect(resumed.snapshot()).toEqual(world.snapshot()); expect(resumed.rng.state).toBe(world.rng.state);
    world.remove(sheep.id);
    expect(dragon.components.dragon!.targetId).not.toBe(sheep.id);
    expect(dragon.components.motion).toBeUndefined();
  });
});
