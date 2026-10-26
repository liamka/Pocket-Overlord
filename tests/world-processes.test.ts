import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { FixedClock } from '../src/core/clock';
import { monthTicks } from '../src/core/calendar';
import { Random } from '../src/core/random';
import { World } from '../src/core/world';
import { applyWorldProcessPolicy, runWorldProcesses, setWorldProcessEnabled, worldProcessMetrics } from '../src/core/world-processes';
import { ROAD_OVERGROWTH_SECONDS, STEP, Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { GEOHAZARDS, geohazards } from '../src/core/geohazards';
import { findPath } from '../src/systems/navigation';
import { flatWorld } from './helpers';

const task = (world: World, id = 'core:tree-growth') => world.processes.tasks.find(state => state.id === id)!;
const reload = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
function saplings(count: number) {
  const world = flatWorld();
  for (let i = 0; i < count; i++) world.spawn('core:tree', { x: 5 + i % 20, y: 5 + Math.floor(i / 20) }, 'planted');
  return world;
}

describe('bounded world processes', () => {
  it('resumes a saved portion without growing any tree twice, even on the same tick', () => {
    const world = saplings(300); world.tick = 30; runWorldProcesses(world, 'resources');
    expect(task(world).pending?.cursor).toBe(256);
    expect([...world.query('tree')].filter(e => e.components.tree!.age === 1)).toHaveLength(256);
    const restored = reload(world), before = restored.snapshot();
    runWorldProcesses(restored, 'resources'); expect(restored.snapshot()).toEqual(before);
    world.tick++; restored.tick++;
    runWorldProcesses(world, 'resources'); runWorldProcesses(restored, 'resources');
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect([...restored.query('tree')].every(e => e.components.tree!.age === 1)).toBe(true);
    expect(task(restored).pending).toBeNull();
    expect(task(restored).metrics).toMatchObject({ runs: 1, completed: 1, processed: 300, maxDelay: 1 });
  });

  it('cancels pending growth, honors all dependencies, and resumes only after a fresh interval', () => {
    const world = saplings(300); world.tick = 30; runWorldProcesses(world, 'resources');
    applyWorldProcessPolicy(world, id => id !== 'trees-growth' && id !== 'random-seeds', () => true);
    expect(task(world).pending).toBeNull();
    const before = [...world.query('tree')].map(e => e.components.tree!.age), rng = task(world).scheduleRng;
    world.tick = 6000000; runWorldProcesses(world, 'resources');
    expect([...world.query('tree')].map(e => e.components.tree!.age)).toEqual(before);
    expect(task(world).scheduleRng).toBe(rng);
    applyWorldProcessPolicy(world, id => id !== 'random-seeds', () => true);
    expect(task(world).nextAt).toBe(world.tick + 30);
    expect(task(world, 'core:spread-vegetation').enabled).toBe(false);
    runWorldProcesses(world, 'resources');
    expect([...world.query('tree')].map(e => e.components.tree!.age)).toEqual(before);
    const restored = reload(world);
    expect(restored.processes).toEqual(world.processes);
    restored.tick += 30; runWorldProcesses(restored, 'resources');
    expect(task(restored).metrics.runs).toBe(2);
    expect(restored.entities.size).toBe(300);
  });

  it('resumes damaged cells after saving between terrain portions', () => {
    const source = flatWorld(), save = source.snapshot();
    save.terrain = { width: 100, height: 100, tiles: Array(10000).fill(Terrain.Grass), moisture: Array(10000).fill(0), recovery: [] };
    const world = new World(save.seed, source.registry, save);
    for (let i = 0; i < 5000; i++) world.terrain.set(i % 100, Math.floor(i / 100), Terrain.Scorched);
    world.tick = 120; runWorldProcesses(world, 'landscape');
    expect(task(world, 'core:burned-tiles').pending?.cursor).toBe(4096);
    const restored = reload(world); restored.tick++;
    runWorldProcesses(restored, 'landscape');
    expect([...restored.terrain.recovery.values()].every(cell => cell.age === 1)).toBe(true);
    expect(task(restored, 'core:burned-tiles').metrics.processed).toBe(5000);
  });

  it('coalesces a large time gap and does not spend paused intervals or RNG', () => {
    const world = saplings(1); world.tick = 6000000;
    runWorldProcesses(world, 'resources');
    expect(task(world).metrics.runs).toBe(1);
    expect(task(world).nextAt).toBe(6000030);
    world.paused = true;
    const before = world.snapshot();
    world.step(); runWorldProcesses(world, 'resources'); runWorldProcesses(world, 'landscape');
    expect(world.snapshot()).toEqual(before);
  });

  it('migrates old ticks to future deadlines without changing existing RNG or trees', () => {
    const world = saplings(2); world.tick = 599;
    const legacy = world.snapshot(); legacy.version = 60; delete legacy.processes;
    const save = decodeSave(legacy, world.registry);
    expect(save.processes!.tasks.every(state => state.nextAt! > legacy.tick && state.pending === null)).toBe(true);
    expect(save.entities).toEqual(legacy.entities); expect(save.rngState).toBe(legacy.rngState);
    expect(save.tick).toBe(legacy.tick); expect(save.speed).toBe(legacy.speed);
  });

  it('rejects corrupt deadlines, duplicate targets and unknown processes', () => {
    const world = saplings(300); world.tick = 30; runWorldProcesses(world, 'resources');
    for (const corrupt of [
      (save: ReturnType<World['snapshot']>) => { save.processes!.tasks[0].nextAt = NaN; },
      (save: ReturnType<World['snapshot']>) => { const pending = save.processes!.tasks.find(s => s.pending)!.pending!; pending.items[1] = pending.items[0]; },
      (save: ReturnType<World['snapshot']>) => { save.processes!.tasks[0].id = 'unknown'; },
      (save: ReturnType<World['snapshot']>) => { save.processes!.tasks[2].pending!.cursor = -1; },
    ]) {
      const save = world.snapshot(); corrupt(save);
      expect(() => decodeSave(save, world.registry)).toThrow();
    }
  });

  it('isolates schedule/work streams, tree factories and diagnostics from simulation RNG', () => {
    const world = flatWorld(), random = new Random(7), before = world.rng.state;
    world.spawn('core:tree', { x: 20, y: 20 }, undefined, 'natural', [], undefined, random);
    expect(world.rng.state).toBe(before);
    const other = reload(world), checkpoint = world.snapshot();
    worldProcessMetrics(world); worldProcessMetrics(world);
    expect(world.snapshot()).toEqual(checkpoint);
    task(other).workRng = 1;
    world.tick = 300; other.tick = 300;
    runWorldProcesses(world, 'resources'); runWorldProcesses(other, 'resources');
    expect(task(world, 'core:spread-vegetation').nextAt).toBe(task(other, 'core:spread-vegetation').nextAt);
    expect(task(world, 'core:spread-vegetation').workRng).toBe(task(other, 'core:spread-vegetation').workRng);
    expect(world.rng.state).toBe(before); expect(other.rng.state).toBe(before);
  });

  it('invalidates road connectivity when an active road cell completes decay', () => {
    const world = flatWorld(), map = world.terrain;
    map.set(10, 10, Terrain.Road); map.roadWear.get(map.index(10, 10))!.age = ROAD_OVERGROWTH_SECONDS - 1;
    const revision = map.revision;
    world.tick = 30; runWorldProcesses(world, 'landscape');
    expect(map.at(10, 10)).toBe(Terrain.Grass);
    expect(map.revision).toBeGreaterThan(revision);
    expect(map.roadWear.get(map.index(10, 10))!.age).toBe(ROAD_OVERGROWTH_SECONDS);
  });

  it('lets decorative work consume its own random stream without shifting resource work', () => {
    const registry = createRegistry([{ id: 'test:sparks', install: r => r.registerWorldProcess({ id: 'test:sparks', phase: 'resources', scope: 'samples',
      intervalMonths: [0.01, 0.02], budget: 1, dependencies: { laws: [], ages: [] }, collect: () => [1],
      visit: (_world, _id, random) => { for (let i = 0; i < 20; i++) random.next(); },
    }) }]);
    const lit = flatWorld(registry); lit.spawn('core:tree', { x: 24, y: 24 });
    const quiet = reload(lit); setWorldProcessEnabled(quiet, 'test:sparks', false);
    for (let tick = 1; tick <= 600; tick++) for (const world of [lit, quiet]) { world.tick = tick; runWorldProcesses(world, 'resources'); }
    expect(task(lit, 'test:sparks').metrics.runs).toBeGreaterThan(1);
    expect(lit.rng.state).toBe(quiet.rng.state);
    expect(task(lit, 'core:spread-vegetation')).toEqual(task(quiet, 'core:spread-vegetation'));
    expect([...lit.query('tree')]).toEqual([...quiet.query('tree')]);
  });

  it('keeps fire and lava before route planning, and growth before gathering', () => {
    const order = createRegistry().resolveSystems().map(s => s.id);
    expect(order.indexOf('core:geohazards')).toBeLessThan(order.indexOf('core:movement'));
    expect(order.indexOf('core:fire')).toBeLessThan(order.indexOf('core:landscape'));
    expect(order.indexOf('core:forestry')).toBeLessThan(order.indexOf('core:economy'));
  });

  it('reopens a cooled lava footprint before the next path is assigned', () => {
    const world = flatWorld(); world.startScenario(GEOHAZARDS.id);
    geohazards(world)!.lava.push({ x: 20.5, y: 20.5, radius: 1.6, age: 2, remaining: 1.02, seed: 7, etched: true });
    const start = { x: 16.5, y: 20.5 }, destination = { x: 24.5, y: 20.5 };
    const before = findPath(world, start, destination, 0)!;
    expect(before.some(p => p.x === 20.5 && p.y === 20.5)).toBe(false);
    // The cache can already exist when hazards change later in the same fixed step.
    world.systems.find(system => system.id === GEOHAZARDS.id)!.update(world, STEP);
    const after = findPath(world, start, destination, 0)!;
    expect(after.every(p => p.y === 20.5)).toBe(true);
    expect(after.length).toBeLessThan(before.length);
  });

  it('matches at a fixed tick for 1× and the current 20×, and for batches of 40 steps', () => {
    const slow = saplings(2), fast = reload(slow), batched = reload(slow);
    fast.speed = 20;
    for (const world of [slow, fast]) {
      const clock = new FixedClock(() => 0); clock.advance(0, true, () => world.step(), world.speed);
      for (let frame = 1; frame <= 600 / world.speed; frame++) clock.advance(frame * 1000 / 30, true, () => world.step(), world.speed);
    }
    for (let frame = 0; frame < 15; frame++) for (let step = 0; step < 40; step++) batched.step();
    expect({ ...fast.snapshot(), speed: 1 }).toEqual(slow.snapshot());
    expect(batched.snapshot()).toEqual(slow.snapshot());
    expect(monthTicks(0.5)).toBe(300);
    expect(setWorldProcessEnabled(slow, 'missing', false)).toBe(false);
  });
});
