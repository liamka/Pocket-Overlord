import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { CREATURE_BINDINGS, CREATURE_CATALOGUE } from '../src/content/creatures';
import { canMove, recordCreatureResult } from '../src/core/creatures';
import { BASIC_CAPABILITIES } from '../src/core/capabilities';
import { ENTITY_LIMIT, POPULATION_LIMIT, SAVE_VERSION, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { movement } from '../src/systems/people';
import { husbandry } from '../src/systems/husbandry';
import { processEvents } from '../src/systems/effects';
import { flatWorld } from './helpers';

describe('species contracts', () => {
  it('keeps unsupported, historical and alternate forms out of executable entity bindings', () => {
    const registry = createRegistry();
    expect(CREATURE_CATALOGUE.filter(p => p.sourceName.startsWith('Fire Elemental'))).toHaveLength(5);
    expect(CREATURE_CATALOGUE.filter(p => p.group === 'animals' && p.form === 'ordinary')).toHaveLength(29);
    expect(CREATURE_CATALOGUE.filter(p => p.group === 'animals' && p.form === 'ascended')).toHaveLength(28);
    for (const p of registry.species.values()) {
      expect(p.ownerPlan).toBeGreaterThan(0);
      expect(p.source).toContain('oldid=23045');
      if (p.support !== 'partial') {
        expect(p.runtime).toBeUndefined();
        expect(() => registry.bindSpecies('core:person', p.id)).toThrow('Unavailable species');
      }
    }
    expect(registry.species.get('bee')?.socialForm).toBe('same-body');
    expect(registry.species.get('beetle')?.counterpart).toBe('dunglord');
  });

  it('separates swimming from citizenship in actual movement', () => {
    const registry = createRegistry();
    const source = registry.entities.get('core:person')!, profile = registry.species.get('human')!;
    registry.registerSpecies({ ...structuredClone(profile), id: 'swimmer', runtime: { ...structuredClone(profile.runtime!), ...BASIC_CAPABILITIES, owner: 'movement', movement: ['walk', 'swim'] } });
    registry.registerSpecies({ ...structuredClone(profile), id: 'land-citizen', runtime: { ...structuredClone(profile.runtime!), movement: ['walk'] } });
    registry.registerEntity({ ...source, id: 'test:swimmer', speciesId: 'swimmer', create: (p, rng) => {
      const components = source.create(p, rng); delete components.citizen; delete components.person; return components;
    } }).bindSpecies('test:swimmer', 'swimmer');
    registry.registerEntity({ ...source, id: 'test:land-citizen', speciesId: 'land-citizen' }).bindSpecies('test:land-citizen', 'land-citizen');
    const world = flatWorld(registry);
    for (let y = 18; y < 23; y++) for (let x = 18; x < 27; x++) world.terrain.set(x, y, Terrain.Water);
    const swimmer = world.spawn('test:swimmer', { x: 20, y: 20 })!;
    const citizen = world.spawn('test:land-citizen', { x: 25, y: 20 })!;
    expect(swimmer.components.citizen).toBeUndefined();
    expect(canMove(registry, swimmer, 'swim')).toBe(true);
    expect(citizen.components.citizen).toBeDefined();
    expect(canMove(registry, citizen, 'swim')).toBe(false);
    const before = structuredClone([swimmer.components.position, citizen.components.position]);
    movement(world, 1 / 30);
    expect(swimmer.components.position).not.toEqual(before[0]);
    expect(citizen.components.position).toEqual(before[1]);
  });

  it('uses prey contracts for hunting and cancels a removed target without another reward', () => {
    const world = flatWorld(), wolf = world.spawn('core:wolf', { x: 20, y: 20 })!, sheep = world.spawn('core:sheep', { x: 20.8, y: 20 })!;
    wolf.components.animal!.hunger = 40;
    husbandry(world, 1 / 30);
    expect(wolf.components.animal!.targetId).toBe(sheep.id);
    expect(wolf.components.creature!.result?.kind).toBe('hit');
    world.remove(sheep.id);
    const equipment = structuredClone(world.equipment), resources = [...world.query('resourcePile')].map(e => structuredClone(e));
    world.remove(sheep.id);
    expect(wolf.components.animal!.targetId).toBeNull();
    expect(wolf.components.animal!.path).toEqual([]);
    expect(wolf.components.creature!.result).toMatchObject({ kind: 'lost-target', targetId: null });
    expect(world.equipment).toEqual(equipment);
    expect([...world.query('resourcePile')]).toEqual(resources);
  });

  it('does not start a hunt when the profile has no hunting capability', () => {
    const registry = createRegistry(), profile = structuredClone(registry.species.get('wolf')!);
    profile.id = 'non-hunter'; profile.runtime!.food = [];
    registry.registerSpecies(profile).registerEntity({ ...registry.entities.get('core:wolf')!, id: 'test:non-hunter', speciesId: profile.id });
    const world = flatWorld(registry), wolf = world.spawn('test:non-hunter', { x: 20, y: 20 })!;
    world.spawn('core:sheep', { x: 22, y: 20 }); wolf.components.animal!.hunger = 40;
    husbandry(world, 1 / 30);
    expect(wolf.components.animal!.targetId).toBeNull();
    expect(wolf.components.creature!.result).toBeUndefined();
  });

  it('migrates existing IDs without respawning or changing active phases and RNG', () => {
    const world = flatWorld();
    for (const [i, id] of Object.keys(CREATURE_BINDINGS).entries()) world.spawn(id, { x: 4 + i * 3, y: 10 });
    const ufo = [...world.query('ufo')][0]; ufo.components.ufo!.phase = 'charge'; ufo.components.ufo!.phaseTime = 0.2;
    const save = world.snapshot(); save.version = 44;
    for (const e of save.entities) delete e.components.creature;
    const migrated = decodeSave(save, world.registry);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.entities.map(e => [e.id, e.typeId])).toEqual(save.entities.map(e => [e.id, e.typeId]));
    expect(migrated.rngState).toBe(save.rngState);
    expect(migrated.events).toEqual(save.events);
    expect(migrated.entities.find(e => e.id === ufo.id)!.components.ufo).toEqual(ufo.components.ufo);
    expect(migrated.entities.every(e => e.components.creature?.origin === 'legacy')).toBe(true);
    const loaded = new World(world.seed, world.registry, migrated);
    expect(loaded.rng.next()).toBe(world.rng.next());
  });

  it('preserves actions on pause and save; target removal cancels a charged attack', () => {
    const world = flatWorld(), target = world.spawn('core:sheep', { x: 20, y: 20 })!, attacker = world.spawn('core:ufo', { x: 20, y: 21 })!;
    Object.assign(attacker.components.ufo!, { targetId: target.id, phase: 'charge', phaseTime: 0.2 });
    world.paused = true;
    const before = world.snapshot(); world.step();
    expect(world.snapshot()).toEqual(before);
    const loaded = new World(world.seed, world.registry, decodeSave(before, world.registry));
    expect(loaded.entities.get(attacker.id)!.components.ufo).toEqual(attacker.components.ufo);
    loaded.remove(target.id);
    expect(loaded.entities.get(attacker.id)!.components.ufo).toMatchObject({ targetId: null, phase: 'recover', phaseTime: 0 });
    processEvents(loaded);
    expect(loaded.events).toEqual([]);
  });

  it('rejects mismatched identities, future provenance and dangling result references', () => {
    const world = flatWorld(), e = world.spawn('core:person', { x: 20, y: 20 })!;
    const badSpecies = world.snapshot(); badSpecies.entities[0].components.creature!.speciesId = 'wolf';
    expect(() => decodeSave(badSpecies, world.registry)).toThrow();
    const future = world.snapshot(); future.entities[0].components.creature!.since = world.tick + 1;
    expect(() => decodeSave(future, world.registry)).toThrow();
    recordCreatureResult(world, e, 'fed', 99999);
    expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
  });

  it('rejects creature placement beyond bounds and at capacity without consuming IDs or RNG', () => {
    const world = flatWorld();
    for (let i = 0; i < POPULATION_LIMIT; i++) world.spawn('core:person', { x: 4 + i % 35, y: 4 + Math.floor(i / 35) });
    let state = world.rng.state, next = world.nextEntityId;
    expect(world.spawn('core:person', { x: 20, y: 20 })).toBeUndefined();
    expect(world.rng.state).toBe(state); expect(world.nextEntityId).toBe(next);
    for (let i = world.entities.size; i < ENTITY_LIMIT; i++) world.spawn('core:tree', { x: 40, y: 40 });
    state = world.rng.state; next = world.nextEntityId;
    expect(world.spawn('core:dog', { x: 20, y: 20 })).toBeUndefined();
    expect(world.rng.state).toBe(state); expect(world.nextEntityId).toBe(next);
    const fresh = flatWorld(), rng = fresh.rng.state;
    expect(fresh.spawn('core:dragon', { x: -1, y: 4 })).toBeUndefined();
    expect(fresh.spawn('core:sheep', { x: 48, y: 4 })).toBeUndefined();
    expect(fresh.rng.state).toBe(rng);
  });
});
