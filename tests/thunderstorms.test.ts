import { describe, expect, it } from 'vitest';
import { STORM, stormClouds } from '../src/content/thunderstorms';
import { CLOUDS, cloudState, summonCloud } from '../src/core/clouds';
import { Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { applyEvent } from '../src/systems/effects';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld, withCrate } from './helpers';

const point = { x: 24.5, y: 24.5 };
const summon = (world: World) => world.command({ kind: 'use-tool', toolId: STORM.toolId, ...point });

describe('moving thunderstorms', () => {
  it.each(['core:person', 'core:elf', 'core:house', 'core:tree', 'core:farm', 'test:wooden-crate'])(
    'a physical lightning drop ignites %s and leaves distant objects untouched', type => {
      const world = flatWorld(withCrate()), target = world.spawn(type, point)!;
      if (target.components.traits) target.components.traits.entries = [];
      const distant = world.spawn('test:wooden-crate', { x: 40, y: 40 })!;
      target.components.thermal!.wetness = 0.9;
      applyEvent(world, { kind: 'precipitation', ...point, type: 'lightning', seed: 1, player: true });
      expect(target.components.thermal!.burning).toBe(true);
      expect(target.components.thermal!.wetness).toBe(0);
      expect(distant.components.thermal!.burning).toBe(false);
      expect(distant.components.health!.current).toBe(100);
    },
  );
  it('does not ignite submerged fuel', () => {
    const world = flatWorld(withCrate()); world.terrain.tiles.fill(Terrain.DeepWater);
    const target = world.spawn('test:wooden-crate', point)!;
    applyEvent(world, { kind: 'precipitation', ...point, type: 'lightning', seed: 1, player: true });
    expect(target.components.thermal!.burning).toBe(false);
    expect(world.terrain.tiles.every(tile => tile === Terrain.DeepWater)).toBe(true);
  });
  it('holding at the source does not reset its lifetime or drop timer', () => {
    const world = flatWorld(); summon(world); advance(world, 0.1);
    const before = structuredClone(stormClouds(world)[0]); summon(world);
    expect(stormClouds(world)).toEqual([before]);
    expect(before.x).toBeGreaterThan(point.x);
    advance(world, STORM.duration); expect(stormClouds(world)).toHaveLength(0);
  });
  it('saves the exact movement and drop cadence through a pause', () => {
    const world = flatWorld(); summon(world); advance(world, 0.3); world.paused = true;
    const save = world.snapshot(); advance(world, 2); expect(world.snapshot()).toEqual(save);
    const restored = new World(world.seed, world.registry, decodeSave(save, world.registry));
    world.paused = restored.paused = false; advance(world, 2); advance(restored, 2);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });
  it('migrates a legacy storm without extending its deadline or issuing a drop', () => {
    const world = flatWorld(); const save = world.snapshot(); save.version = 69;
    save.scenarios = [{ id: STORM.id, state: { clouds: [{ ...point, remaining: 3, strikeIn: 0.5, bolt: null }] } }];
    const restored = new World(world.seed, world.registry, decodeSave(save, world.registry));
    expect(stormClouds(restored)[0]).toMatchObject({ remaining: 3, dropIn: 0.5, lastDrop: null });
    expect(restored.rng.state).toBe(save.rngState); expect(restored.events).toEqual(save.events);
  });
  it('rejects invalid bolt state and limits every cloud type together', () => {
    const world = flatWorld(); summon(world); const save = world.snapshot(), state = cloudState(world)!;
    const bad = { ...state.clouds[0], bolt: { ...point, seed: 1, remaining: 30 } };
    expect(() => decodeSave({ ...save, scenarios: [{ id: STORM.id, state: { ...state, clouds: [bad] } }] }, world.registry)).toThrow();
    for (let i = 0; i < 40; i++) summonCloud(world, 'rain', { x: 1 + i % 8 * 5, y: 1 + Math.floor(i / 8) * 5 });
    expect(cloudState(world)!.clouds).toHaveLength(CLOUDS.limit);
  });
});
