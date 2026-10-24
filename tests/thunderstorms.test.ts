import { describe, expect, it } from 'vitest';
import { STORM, stormClouds } from '../src/content/thunderstorms';
import { Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld, withCrate } from './helpers';

const summon = (world: World, x = 24, y = 24) => world.command({ kind: 'use-tool', toolId: STORM.toolId, x, y });

describe('thunderstorms', () => {
  it.each(['core:person', 'core:elf', 'core:house', 'core:tree', 'core:farm', 'test:wooden-crate'])(
    'lightning ignites %s, causes damage and leaves distant objects untouched', type => {
      const world = flatWorld(withCrate()), target = world.spawn(type, { x: 24, y: 24 })!;
      if (target.components.motion) target.components.motion.speed = 0;
      const health = target.components.health!.current;
      const distant = world.spawn('test:wooden-crate', { x: 40, y: 40 })!;
      summon(world); expect(target.components.thermal!.burning).toBe(false);
      advance(world, 0.3);
      expect(target.components.thermal!.burning).toBe(true);
      expect(target.components.health!.current).toBeLessThan(health);
      expect(stormClouds(world)[0].bolt).toMatchObject({ x: 24, y: 24 });
      expect(world.terrain.at(24, 24)).toBe(Terrain.Scorched);
      advance(world, 0.3);
      expect(target.components.thermal!.burning).toBe(true);
      expect(world.effects).toHaveLength(0);
      expect(distant.components.thermal!.burning).toBe(false);
      expect(distant.components.health!.current).toBe(100);
    },
  );

  it('evaporates moisture on struck objects and ignites nearby fuel with the same bolt', () => {
    const world = flatWorld(withCrate());
    const targets = ['core:person', 'core:house', 'core:tree', 'test:wooden-crate'].map(type => world.spawn(type, { x: 24, y: 24 })!);
    for (const entity of targets) {
      entity.components.thermal!.wetness = 0.9;
      if (entity.components.motion) entity.components.motion.speed = 0;
    }
    summon(world); advance(world, 0.3);
    expect(targets.every(entity => entity.components.thermal!.burning)).toBe(true);
    expect(targets.every(entity => entity.components.thermal!.wetness === 0)).toBe(true);
  });

  it('shows lightning over water without igniting submerged fuel or changing the sea', () => {
    const world = flatWorld(withCrate()); world.terrain.tiles.fill(Terrain.DeepWater);
    const target = world.spawn('test:wooden-crate', { x: 24, y: 24 })!;
    summon(world); advance(world, 0.3);
    expect(stormClouds(world)[0].bolt).not.toBeNull();
    expect(target.components.thermal!.burning).toBe(false);
    expect(world.terrain.tiles.every(tile => tile === Terrain.DeepWater)).toBe(true);
  });

  it('repeated holding refreshes one cloud without postponing or multiplying its lightning', () => {
    const world = flatWorld(), flashes = new Set<number>();
    for (let i = 0; i < 18; i++) {
      summon(world); advance(world, 0.1);
      const cloud = stormClouds(world)[0];
      if (cloud.bolt) flashes.add(cloud.bolt.seed);
      expect(stormClouds(world)).toHaveLength(1);
    }
    expect(flashes.size).toBe(3);
    advance(world, STORM.duration);
    expect(stormClouds(world)).toHaveLength(0);
    expect(world.scenarios.some(s => s.id === STORM.id)).toBe(false);
  });

  it('freezes on pause and restores the exact lightning cadence and burning objects after reload', () => {
    const world = flatWorld(); world.spawn('core:tree', { x: 24, y: 24 });
    summon(world); advance(world, 0.3);
    world.paused = true;
    const snapshot = world.snapshot(); advance(world, 2);
    expect(world.snapshot()).toEqual(snapshot);
    const restored = new World(world.seed, world.registry, decodeSave(snapshot, world.registry));
    expect(stormClouds(restored)).toEqual(stormClouds(world));
    world.paused = false; restored.paused = false;
    advance(world, 2); advance(restored, 2);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('rejects invalid cloud and bolt timers in saves', () => {
    const world = flatWorld(); summon(world); advance(world, 0.3);
    const snapshot = world.snapshot(), cloud = stormClouds(world)[0];
    for (const invalid of [{ ...cloud, strikeIn: -1 }, { ...cloud, remaining: Infinity },
      { ...cloud, bolt: { ...cloud.bolt!, remaining: 30 } }]) {
      expect(() => decodeSave({ ...snapshot, scenarios: [{ id: STORM.id, state: { clouds: [invalid] } }] }, world.registry)).toThrow();
    }
  });
});
