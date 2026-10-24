import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { testContent as pack } from './fixtures/content-pack';
import { World } from '../src/core/world';
import { EVENT_BUDGET, SAVE_VERSION, STEP, Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent, processEvents, rain } from '../src/systems/effects';
import { advance, flatWorld } from './helpers';

describe('content registration through the engine interface', () => {
  it('adds a type, tool, component, ordered system and effect from one pack', () => {
    const world = flatWorld(createRegistry([pack]));
    world.command({ kind: 'use-tool', toolId: 'test:lantern', x: 20, y: 20 });
    const [entity] = world.query('test:charge');
    expect(entity.typeId).toBe('test:lantern');
    world.events.push({ kind: 'test:charge', target: entity.id, amount: 4 });
    world.step();
    expect(entity.components['test:charge']!.value).toBeCloseTo(4 + STEP);
    const ids = world.systems.map(system => system.id);
    expect(ids.indexOf('test:charging')).toBeGreaterThan(ids.indexOf('core:fire'));
    expect(ids.indexOf('test:charging')).toBeLessThan(ids.indexOf('core:landscape'));
    expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
  });

  it('uses existing fire, rain and blast rules for new types', () => {
    const world = flatWorld(createRegistry([pack]));
    const entity = world.spawn('test:lantern', { x: 20, y: 20 })!;
    applyEvent(world, { kind: 'heat', target: entity.id, amount: 40 });
    expect(entity.components.thermal!.burning).toBe(true);
    world.step(); expect(entity.components.health!.current).toBeLessThan(100);
    world.addRain({ x: 20, y: 20 }, 3, 1); rain(world, 0.5);
    expect(entity.components.thermal!.burning).toBe(false);
    world.events.push({ kind: 'blast', x: 20, y: 20, radius: 4, power: 200, heat: 50 });
    processEvents(world);
    expect(world.entities.has(entity.id)).toBe(false);
    expect([...world.query('test:charge')]).toEqual([]);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Crater);
  });

  it('preserves the event budget, custom pending effects and their order across saves', () => {
    const world = flatWorld(createRegistry([pack]));
    const entity = world.spawn('test:lantern', { x: 20, y: 20 })!;
    for (let i = 0; i < EVENT_BUDGET + 3; i++) world.events.push({ kind: 'test:charge', target: entity.id, amount: 1 });
    processEvents(world);
    expect(entity.components['test:charge']!.value).toBe(EVENT_BUDGET);
    expect(world.events).toHaveLength(3);
    const snapshot = decodeSave(world.snapshot(), world.registry);
    const restored = new World(world.seed, createRegistry([pack]), snapshot);
    world.step(); restored.step();
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('rejects corrupt or unregistered custom components and effects', () => {
    const world = flatWorld(createRegistry([pack]));
    const entity = world.spawn('test:lantern', { x: 20, y: 20 })!;
    const invalid = world.snapshot(); invalid.entities[0].components['test:charge']!.value = -1;
    expect(() => decodeSave(invalid, world.registry)).toThrow();
    const missing = world.snapshot(); delete missing.entities[0].components['test:charge'];
    expect(() => decodeSave(missing, world.registry)).toThrow();
    world.events.push({ kind: 'test:charge', target: entity.id, amount: -1 });
    expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
    const standard = flatWorld(); standard.events.push({ kind: 'test:charge', target: 1, amount: 1 });
    expect(() => decodeSave(standard.snapshot(), standard.registry)).toThrow();
    expect(() => applyEvent(standard, { kind: 'test:charge', target: 1, amount: 1 })).toThrow(/Unknown event/);
  });

  it('keeps registries isolated and fails on duplicate registrations', () => {
    const registry = createRegistry([pack]);
    expect(createRegistry().entities.has('test:lantern')).toBe(false);
    expect(() => registry.use(pack)).toThrow(/Duplicate content pack/);
    expect(() => registry.registerEntity(registry.entities.get('test:lantern')!)).toThrow(/Duplicate entity/);
    expect(() => registry.registerTool(registry.tools.get('test:lantern')!)).toThrow(/Duplicate tool/);
    expect(() => registry.registerComponent('test:charge', () => true)).toThrow(/Duplicate component/);
    expect(() => registry.registerEvent({ kind: 'test:charge', validate: () => true, apply: () => {} })).toThrow(/Duplicate event/);
    expect(() => registry.registerSystem({ id: 'test:charging', update: () => {} })).toThrow(/Duplicate system/);
    expect(() => registry.registerScenario(registry.scenarios.get('test:lantern-rain')!)).toThrow(/Duplicate scenario/);
  });

  it('rejects missing ordering dependencies and cycles before simulation starts', () => {
    expect(() => createRegistry([{ id: 'missing', install: r => { r.registerSystem({ id: 'test', after: ['missing'], update: () => {} }); } }])).toThrow(/Unknown system dependency/);
    expect(() => createRegistry([{ id: 'cycle', install: r => {
      r.registerSystem({ id: 'test', after: ['core:events'], before: ['core:fire'], update: () => {} });
    } }])).toThrow(/cycle/);
  });

  it('supports 400 additional types without changing systems or save decoding', () => {
    const registry = createRegistry([pack]), base = registry.entities.get('test:lantern')!;
    for (let i = 0; i < 400; i++) registry.registerEntity({ ...base, id: `test:item-${i}` });
    const world = flatWorld(registry);
    for (let i = 0; i < 400; i++) world.spawn(`test:item-${i}`, { x: 4 + i % 20 * 2, y: 4 + Math.floor(i / 20) * 2 });
    world.step();
    expect([...world.query('test:charge')]).toHaveLength(400);
    expect(decodeSave(world.snapshot(), registry).entities).toHaveLength(400);
  });
});

describe('scenario lifecycle', () => {
  it('starts on command, respects pause, restores state and RNG, and completes once', () => {
    const world = flatWorld(createRegistry([pack]));
    world.command({ kind: 'pause', paused: true });
    world.command({ kind: 'start-scenario', scenarioId: 'test:lantern-rain' });
    expect(world.startScenario('test:lantern-rain')).toBe(false);
    const paused = world.snapshot(); advance(world, 2);
    expect(world.snapshot()).toEqual(paused);
    world.command({ kind: 'pause', paused: false }); advance(world, 0.7);
    expect(world.scenarios[0].state).toEqual({ nextTick: 30, remaining: 2 });
    const registry = createRegistry([pack]), saved = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), registry);
    const restored = new World(saved.seed, registry, saved);
    advance(world, 2); advance(restored, 2);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(world.scenarios).toEqual([]); expect([...world.query('test:charge')]).toHaveLength(3);
    advance(world, 2); expect([...world.query('test:charge')]).toHaveLength(3);
  });

  it('rejects unknown, malformed and duplicate scenario state and preserves the source', () => {
    const world = flatWorld(createRegistry([pack])); world.startScenario('test:lantern-rain');
    const snapshot = world.snapshot();
    expect(() => decodeSave(snapshot, createRegistry())).toThrow(/пакет контента/);
    expect(() => decodeSave({ ...snapshot, contentPacks: ['core'] }, createRegistry())).toThrow(/неизвестный сценарий/);
    expect(snapshot.scenarios[0].state).toEqual({ nextTick: 15, remaining: 3 });
    for (const state of [{ nextTick: -1, remaining: 3 }, { nextTick: 15, remaining: 0 }, null, { nextTick: 15, remaining: 3, fn: () => {} }]) {
      expect(() => decodeSave({ ...snapshot, scenarios: [{ id: 'test:lantern-rain', state }] }, world.registry)).toThrow();
    }
    expect(() => decodeSave({ ...snapshot, scenarios: [snapshot.scenarios[0], snapshot.scenarios[0]] }, world.registry)).toThrow();
    expect(() => world.startScenario('missing')).toThrow(/Unknown scenario/);
  });

  it('migrates v9 saves without changing active bombs, residents, terrain or pause', () => {
    const world = flatWorld(); world.spawn('core:dynamite', { x: 20, y: 20 }); world.paused = true;
    const { scenarios: _, ...old } = { ...world.snapshot(), version: 9 };
    const migrated = decodeSave(old, world.registry);
    expect(migrated).toEqual({ ...old, version: SAVE_VERSION, scenarios: [] });
    expect(old.version).toBe(9); expect('scenarios' in old).toBe(false);
  });
});
