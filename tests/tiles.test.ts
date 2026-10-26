import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain, SAVE_VERSION } from '../src/core/types';
import { NaturalBiome } from '../src/core/natural-biomes';
import { Random } from '../src/core/random';
import { decodeSave } from '../src/persistence/schema';
import { findPath } from '../src/systems/navigation';
import { enterTile } from '../src/core/world-tiles';
import { igniteTile, tileEffects } from '../src/systems/tiles';
import { GEOHAZARDS, geohazards } from '../src/core/geohazards';
import { FixedClock } from '../src/core/clock';
import { seafaring } from '../src/systems/seafaring';

describe('layered world cells', () => {
  it('retains the water bed through freezing, reload and melting', () => {
    for (const depth of [1, 2, 3] as const) {
      const w = flatWorld(); w.terrain.set(8, 8, Terrain.DeepWater); w.terrain.setLayers(8, 8, { waterDepth: depth });
      expect(w.terrain.freeze(8, 8)).toBe(true); expect(w.terrain.canWalk(8, 8)).toBe(true); expect(w.terrain.isOpenWater(8, 8)).toBe(false);
      const restored = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)); restored.terrain.thaw(8, 8);
      expect(restored.terrain.cell(8, 8).waterDepth).toBe(depth); expect(restored.terrain.at(8, 8)).toBe(Terrain.DeepWater);
      expect(restored.terrain.canWalk(8, 8)).toBe(false); expect(restored.terrain.isOpenWater(8, 8)).toBe(true);
    }
  });
  it('keeps unknown appearance variants out of travel, fertility, burning and gameplay RNG', () => {
    const w = flatWorld(), before = w.terrain.cell(10, 10), revision = w.terrain.revision, rng = w.rng.state;
    w.terrain.setLayers(10, 10, { variant: 65000 });
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry)), after = loaded.terrain.cell(10, 10);
    expect(after.movement).toEqual(before.movement); expect(after.growth).toBe(before.growth); expect(after.burn).toEqual(before.burn);
    expect(after.base).toBe(before.base); expect(after.variant).toBe(65000); expect(w.terrain.revision).toBe(revision); expect(w.rng.state).toBe(rng);
  });
  it('preserves a mine beneath a removed house, but flooding clears incompatible layers and objects together', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 20.5, y: 20.5 })!;
    w.terrain.setLayers(20, 20, { top: 'landmine' }); w.remove(home.id);
    expect(w.terrain.cell(20, 20).top).toBe('landmine'); expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
    const another = w.spawn('core:house', { x: 20.5, y: 20.5 })!, tree = w.spawn('core:tree', { x: 21.5, y: 20.5 })!;
    w.terrain.edit(() => { w.terrain.set(20, 20, Terrain.Water); w.terrain.set(21, 20, Terrain.Water); });
    expect(w.entities.has(another.id)).toBe(false); expect(w.entities.has(tree.id)).toBe(false); expect(w.terrain.cell(20, 20).top).toBeUndefined();
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });
  it('invalidates both a cached search and an assigned route after one mass edit', () => {
    const w = flatWorld(), start = { x: 8.5, y: 8.5 }, target = { x: 30.5, y: 8.5 }, e = w.spawn('core:person', start)!;
    expect(findPath(w, start, target, 0.1)).toBeDefined(); e.components.citizen!.path = [{ x: 20.5, y: 8.5 }];
    w.terrain.edit(() => { for (let y = 0; y < w.terrain.height; y++) w.terrain.setLayers(20, y, { top: 'wall-stone' }); });
    expect(findPath(w, start, target, 0.1)).toBeUndefined(); expect(e.components.citizen!.path).toEqual([]);
    w.terrain.setLayers(20, 8, { top: undefined }); expect(findPath(w, start, target, 0.1)).toBeDefined();
  });
  it('uses one 10% aging roll on entry, with no repeated roll for remaining on the cell or reloading', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 8.5, y: 8.5 })!; e.components.traits!.entries = [];
    w.terrain.setBiome(9, 8, NaturalBiome.Paradox);
    let seed = 0; while (new Random(seed).next() >= 0.1) seed++;
    w.rng.state = seed; e.components.position!.x = 9.5; enterTile(w, e, { x: 8.5, y: 8.5 });
    expect(e.components.stats!.ageOvergrowth).toBe(1);
    const rng = w.rng.state; enterTile(w, e, { x: 9.5, y: 8.5 }); expect(w.rng.state).toBe(rng);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    expect(loaded.entities.get(e.id)!.components.stats!.ageOvergrowth).toBe(1); expect(loaded.rng.state).toBe(rng);
  });
  it('retains a boat destination and its load when ice blocks the route', () => {
    const w = flatWorld(); w.terrain.edit(() => { for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) w.terrain.set(x, y, Terrain.Water); });
    const ship = w.spawn('core:ship', { x: 16.5, y: 16.5 })!, state = ship.components.ship!;
    state.cargo = 5; state.foodGoods = { provisions: 5 }; state.phase = 'sailing'; state.path = [{ x: 20.5, y: 16.5 }];
    w.terrain.freeze(20, 16);
    expect(state.path).toEqual([{ x: 20.5, y: 16.5 }]); expect(state.cargo).toBe(5);
    seafaring(w, 1 / 30); expect(state.cargo).toBe(5); expect(state.foodGoods).toEqual({ provisions: 5 });
    const wagon = w.spawn('core:caravan', { x: 30.5, y: 30.5 })!, cargo = wagon.components.caravan!;
    cargo.path = [{ x: 31.5, y: 30.5 }]; cargo.food = 3; cargo.foodGoods = { provisions: 3 };
    w.terrain.set(31, 30, Terrain.Grass);
    expect(cargo.path).toEqual([{ x: 31.5, y: 30.5 }]); expect(cargo.food).toBe(3);
  });
  it('saves partial burning and consumes fuel by burn rate, independently of ignition chance', () => {
    const w = flatWorld(); w.tick = 30;
    let seed = 0; while (new Random(seed).next() >= 0.05) seed++; w.rng.state = seed;
    expect(igniteTile(w, { x: 8.5, y: 8.5 })).toBe(true); tileEffects(w, 1);
    expect(w.terrain.cell(8, 8).burning).toBe(25);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (let i = 0; i < 5; i++) { tileEffects(w, 1); tileEffects(loaded, 1); }
    expect(w.terrain.at(8, 8)).toBe(Terrain.Scorched); expect(loaded.snapshot()).toEqual(w.snapshot());
  });
  it('applies identical lava damage across different render frequencies and no damage on pause', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 16.5, y: 16.5 })!;
    e.components.traits!.entries = []; e.components.motion!.speed = 0; e.components.stats!.base.speed = 0;
    w.startScenario(GEOHAZARDS.id); geohazards(w)!.lava.push({ x: 16.5, y: 16.5, radius: 2, age: 1, remaining: 10, seed: 1, etched: true });
    const save = decodeSave(w.snapshot(), w.registry), a = new World(w.seed, w.registry, save), b = new World(w.seed, w.registry, save);
    for (const [world, frames] of [[a, 60], [b, 10]] as const) {
      const clock = new FixedClock(() => 0); clock.advance(0, true, () => world.step());
      for (let frame = 1; frame <= frames; frame++) clock.advance(frame * 1000 / frames, true, () => world.step());
    }
    expect(a.tick).toBe(30); expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.entities.get(e.id)!.components.health!.current).toBeLessThan(e.components.health!.current);
    a.paused = true; const paused = a.snapshot(); a.step(); expect(a.snapshot()).toEqual(paused);
  });
  it('migrates existing terrain without rolling resources and rejects incompatible layers', () => {
    const w = flatWorld(), old = w.snapshot(); old.version = 62; delete old.terrain.layers; delete old.terrain.visualSeed;
    const migrated = decodeSave(old, w.registry); expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.terrain.tiles).toEqual(old.terrain.tiles); expect(migrated.rngState).toBe(old.rngState); expect(migrated.terrain.layers).toEqual([]);
    const bad = w.snapshot(); bad.terrain.layers = [{ index: 100, frost: 'ice' }]; expect(() => decodeSave(bad, w.registry)).toThrow();
    expect(w.terrain.setLayers(10, 10, { frost: 'ice' })).toBe(false);
  });
});
