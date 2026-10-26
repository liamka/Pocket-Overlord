import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain } from '../src/core/types';
import { TEMPERATURE } from '../src/core/temperature';
import { applyEvent, fire, rain } from '../src/systems/effects';
import { heatCell, temperatures } from '../src/systems/temperature';
import { decodeSave } from '../src/persistence/schema';
import { hasStatus } from '../src/core/status-effects';

const resident = (w: World, x = 8.5, y = 8.5) => {
  const e = w.spawn('core:person', { x, y })!;
  e.components.traits!.entries = []; return e;
};

describe('independent body and surface temperature', () => {
  it('crosses body thresholds once, resets accumulation and keeps the ground unchanged', () => {
    const w = flatWorld(), e = resident(w), cold = resident(w, 10.5);
    applyEvent(w, { kind: 'heat', target: e.id, amount: 299 });
    expect(e.components.thermal!.burning).toBe(false);
    applyEvent(w, { kind: 'heat', target: e.id, amount: 1 });
    expect(e.components.thermal!.temperature).toBe(0); expect(hasStatus(e, 'burning')).toBe(true);
    const serial = e.components.statuses!.nextSerial, expires = e.components.statuses!.active[0].expiresAt;
    applyEvent(w, { kind: 'heat', target: e.id, amount: 600 });
    expect(e.components.statuses!.nextSerial).toBe(serial); expect(e.components.statuses!.active[0].expiresAt).toBe(expires);
    applyEvent(w, { kind: 'heat', target: cold.id, amount: -200 });
    expect(hasStatus(cold, 'frozen')).toBe(true); expect(cold.components.thermal!.temperature).toBe(0);
    expect(w.terrain.cell(10, 8).temperature).toBe(0); expect(w.terrain.cell(10, 8).frost).toBeUndefined();
  });
  it('uses the calendar to approach zero from either sign, and respects pause', () => {
    const w = flatWorld(), a = resident(w), b = resident(w, 10.5);
    applyEvent(w, { kind: 'heat', target: a.id, amount: 10 }); applyEvent(w, { kind: 'heat', target: b.id, amount: -10 });
    fire(w, TEMPERATURE.bodyRecoveryTicks / 30);
    expect(a.components.thermal!.temperature).toBe(9); expect(b.components.thermal!.temperature).toBe(-9);
    w.paused = true; const before = w.snapshot();
    fire(w, 1); temperatures(w); heatCell(w, { x: 8, y: 8 }, 404); applyEvent(w, { kind: 'heat', target: a.id, amount: 300 }); w.step();
    expect(w.snapshot()).toEqual(before);
  });
  it('cools with rain before the pending surface transition, without creating cold', () => {
    const w = flatWorld(), e = resident(w);
    heatCell(w, { x: 8, y: 8 }, 11); applyEvent(w, { kind: 'heat', target: e.id, amount: 295 });
    w.addRain({ x: 8.5, y: 8.5 }, 2, 2); rain(w, 1);
    applyEvent(w, { kind: 'heat', target: e.id, amount: 10 }); temperatures(w);
    expect(e.components.thermal!.burning).toBe(false); expect(w.terrain.at(8, 8)).toBe(Terrain.Grass);
    expect(w.terrain.cell(8, 8).temperature).toBe(0); expect(w.terrain.thermalActive.size).toBe(0);
  });
  it('separates fire immunity from one direct heat shock and retains a vanished initiator', () => {
    const w = flatWorld(), e = resident(w), source = resident(w, 20.5);
    e.components.statuses!.immunities.push('burning');
    const hp = e.components.health!.current;
    heatCell(w, { x: 8, y: 8 }, 404, { cause: 'fire', sourceId: source.id, sourceName: 'Origin' });
    w.remove(source.id); temperatures(w);
    expect(e.components.health!.current).toBe(hp - 50); expect(e.components.thermal!.burning).toBe(false);
    temperatures(w); expect(e.components.health!.current).toBe(hp - 50);
    expect(w.terrain.cell(8, 8).thermalChange!.source?.sourceName).toBe('Origin');
  });
  it('orders soil to sand to lava, consumes explosives once and resumes the same stage after loading', () => {
    const w = flatWorld(); w.terrain.setLayers(8, 8, { top: 'tnt' });
    heatCell(w, { x: 8, y: 8 }, 31); temperatures(w);
    expect(w.terrain.at(8, 8)).toBe(Terrain.Sand); expect(w.events.filter(e => e.kind === 'blast')).toHaveLength(1);
    heatCell(w, { x: 8, y: 8 }, 100); temperatures(w);
    expect(w.terrain.cell(8, 8).lavaStage).toBe(4); expect(w.events.filter(e => e.kind === 'blast')).toHaveLength(1);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (const value of [25, 15, 5, 0]) {
      for (const world of [w, loaded]) {
        world.terrain.setTemperature(world.terrain.index(8, 8), value, world.tick); temperatures(world);
      }
      expect(loaded.snapshot()).toEqual(w.snapshot());
      expect(w.terrain.cell(8, 8).lavaStage).toBe(value === 25 ? 3 : value === 15 ? 2 : value === 5 ? 1 : undefined);
    }
    expect(w.terrain.thermalActive.size).toBe(0); expect(w.terrain.at(8, 8)).toBe(Terrain.Scorched);
  });
  it('restores water depth and navigation after freezing, loading and natural thaw', () => {
    const w = flatWorld(); w.terrain.set(8, 8, Terrain.DeepWater); w.terrain.setLayers(8, 8, { waterDepth: 2 });
    heatCell(w, { x: 8, y: 8 }, -5); temperatures(w);
    expect(w.terrain.canWalk(8, 8)).toBe(true); expect(w.terrain.isOpenWater(8, 8)).toBe(false);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    loaded.tick += 5 * TEMPERATURE.cellRecoveryTicks; temperatures(loaded);
    expect(loaded.terrain.canWalk(8, 8)).toBe(false); expect(loaded.terrain.isOpenWater(8, 8)).toBe(true);
    expect(loaded.terrain.cell(8, 8).waterDepth).toBe(2); expect(loaded.terrain.thermalActive.size).toBe(0);
  });
  it('keeps rocky substrate until 160 and never melts a bridge into permanent land', () => {
    const w = flatWorld(); w.terrain.surfaces[w.terrain.index(8, 8)] = 2;
    heatCell(w, { x: 8, y: 8 }, 101); temperatures(w);
    expect(w.terrain.cell(8, 8).surface?.kind).toBe('stone'); expect(w.terrain.cell(8, 8).lavaStage).toBeUndefined();
    heatCell(w, { x: 8, y: 8 }, 60); temperatures(w); expect(w.terrain.cell(8, 8).lavaStage).toBe(4);
    w.terrain.set(10, 8, Terrain.DeepWater); w.terrain.setLayers(10, 8, { waterDepth: 2 }); w.terrain.set(10, 8, Terrain.BridgeHorizontal);
    heatCell(w, { x: 10, y: 8 }, 404); temperatures(w);
    expect(w.terrain.at(10, 8)).toBe(Terrain.BridgeHorizontal); expect(w.terrain.cell(10, 8).lavaStage).toBeUndefined();
    expect(w.terrain.cell(10, 8).waterDepth).toBe(2);
  });
  it('does not award retroactive transitions to old inert readings and rejects invalid new values', () => {
    const w = flatWorld(), e = resident(w), old = w.snapshot(); old.version = 66;
    old.entities[0].components.thermal!.temperature = e.components.combustible!.ignition / 2;
    old.terrain.layers = [{ index: w.terrain.index(8, 8), temperature: 1000 }];
    const loaded = new World(w.seed, w.registry, decodeSave(old, w.registry)); temperatures(loaded);
    expect(loaded.entities.get(e.id)!.components.thermal!.temperature).toBe(150);
    expect(loaded.terrain.at(8, 8)).toBe(Terrain.Grass); expect(loaded.terrain.cell(8, 8).lavaStage).toBeUndefined();
    const bad = loaded.snapshot(); bad.terrain.layers![0].temperature = 405;
    expect(() => decodeSave(bad, w.registry)).toThrow();
    expect(w.terrain.setLayers(8, 8, { temperature: NaN })).toBe(false);
  });
  it('keeps every pending boundary across a mass edit, reload and bounded slices', () => {
    const w = flatWorld();
    for (let i = 0; i < w.terrain.tiles.length; i++) w.terrain.setTemperature(i, 404, w.tick);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (let tick = 1; tick <= TEMPERATURE.buckets; tick++) for (const world of [w, loaded]) { world.tick = tick; temperatures(world); }
    expect([...w.terrain.layers.values()].filter(l => l.lavaStage === 4)).toHaveLength(w.terrain.tiles.length);
    expect(loaded.snapshot()).toEqual(w.snapshot());
  });
});
