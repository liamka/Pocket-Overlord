import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { FixedClock } from '../src/core/clock';
import { EVENT_BUDGET, POPULATION_LIMIT, SIMULATION_SPEEDS, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent, processEvents } from '../src/systems/effects';
import { advance, flatWorld, withCrate } from './helpers';

describe('world and command boundary', () => {
  it('generates reproducible islands with shores, mountains and trees', () => {
    const a = new World(876), b = new World(876), c = new World(877);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.terrain.tiles).not.toEqual(c.terrain.tiles);
    expect(new Set(a.terrain.tiles)).toEqual(new Set([Terrain.DeepWater, Terrain.Water, Terrain.Sand, Terrain.Grass, Terrain.Mountain]));
    expect(a.entities.size).toBeGreaterThan(100);
    expect([...a.query('solid')].every(e => a.terrain.isLand(e.components.position!.x, e.components.position!.y))).toBe(true);
  });
  it('spawns people on land and water, with the population limit', () => {
    const world = flatWorld();
    world.terrain.set(2, 2, Terrain.Water);
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: 2.5, y: 2.5 })).toBeUndefined();
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: 20, y: 20 })).toBeUndefined();
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: 20, y: 20 })).toBeUndefined();
    for (let i = 0; i < POPULATION_LIMIT + 10; i++) world.spawn('core:person', { x: 10, y: 10 });
    expect(world.population).toBe(POPULATION_LIMIT);
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: 35, y: 35 })).toBeTruthy();
    expect(world.population).toBe(POPULATION_LIMIT);
  });
  it.each([false, true])('spawns ten people from ten rapid clicks at one point (paused: %s)', paused => {
    const world = flatWorld(); world.paused = paused;
    const results = [];
    for (let i = 0; i < 10; i++) {
      results.push(world.command({ kind: 'use-tool', toolId: 'core:human', x: 20, y: 20 }));
      advance(world, 0.2);
    }
    expect(world.population).toBe(10);
    expect(results).toEqual(Array(10).fill(undefined));
    for (const person of world.query('person')) {
      expect(world.canStand(person.components.position!, 0.17, person.id)).toBe(true);
    }
  });
  it('places nearby people clear of water, trees and houses without changing state during preview', () => {
    const world = flatWorld(), target = { x: 20.5, y: 20.5 };
    for (let y = 0; y < 48; y++) for (let x = 21; x < 48; x++) world.terrain.set(x, y, Terrain.Water);
    world.spawn('core:house', target);
    world.spawn('core:tree', { x: 18, y: 20 });
    const before = world.snapshot(), preview = world.findFreePosition(target, 0.6);
    expect(preview).toBeDefined();
    expect(world.findFreePosition(target, 0.6)).toEqual(preview);
    expect(world.snapshot()).toEqual(before);
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', ...target })).toBeUndefined();
    const person = [...world.query('person')][0], p = person.components.position!;
    expect(p).toEqual(preview);
    expect(world.canStand(p, 0.6, person.id)).toBe(true);
    expect(Math.hypot(p.x - target.x, p.y - target.y)).toBeLessThanOrEqual(3);
  });
  it('rejects placement when no nearby land is free', () => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.Water);
    world.terrain.set(20, 20, Terrain.Grass);
    world.terrain.set(30, 20, Terrain.Grass);
    world.spawn('core:house', { x: 20.5, y: 20.5 });
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: 20.5, y: 20.5 })).toBeTruthy();
    expect(world.population).toBe(0);
  });
  it('does not advance the simulation or a fuse while paused', () => {
    const world = flatWorld(); world.spawn('core:dynamite', { x: 20, y: 20 });
    world.command({ kind: 'pause', paused: true });
    const saved = world.snapshot(); advance(world, 5);
    expect(world.snapshot()).toEqual(saved);
    world.command({ kind: 'pause', paused: false }); advance(world, 2);
    expect([...world.query('explosive')]).toHaveLength(0);
  });
  it('drops hidden/long-frame elapsed time without catch-up', () => {
    const clock = new FixedClock(() => 0); let steps = 0;
    clock.advance(0, true, () => steps++); clock.advance(100, true, () => steps++);
    expect(steps).toBe(3);
    clock.advance(200, false, () => steps++); clock.advance(90000, true, () => steps++);
    expect(steps).toBe(3);
    clock.advance(180000, true, () => steps++); expect(steps).toBe(3);
    clock.advance(180034, true, () => steps++); expect(steps).toBe(4);
  });
  it.each(SIMULATION_SPEEDS)('runs fixed simulation steps at %sx without a backlog after pause', speed => {
    const clock = new FixedClock(() => 0); let steps = 0;
    const step = (): void => { steps++; };
    clock.advance(0, true, step, speed);
    for (let i = 1; i <= 60; i++) clock.advance(i * 1000 / 60, true, step, speed);
    expect(steps).toBe(30 * speed);
    clock.advance(1100, false, step, speed);
    clock.advance(90000, true, step, speed);
    expect(steps).toBe(30 * speed);
    clock.advance(90000 + 1000 / 60, true, step, speed);
    expect(steps).toBe(Math.floor(30.5 * speed));
    clock.advance(100000, true, step, speed);
    expect(steps).toBe(Math.floor(30.5 * speed));
  });
  it('yields within a frame budget at maximum speed and discards overdue steps', () => {
    let work = 0, steps = 0;
    const clock = new FixedClock(() => work);
    const step = (): void => { work += 2; steps++; };
    clock.advance(0, true, step, 40);
    expect(clock.advance(1000 / 60, true, step, 40)).toBe(3);
    expect(work).toBe(6);
    // A zero-time frame cannot execute overdue simulation steps.
    expect(clock.advance(1000 / 60, true, step, 40)).toBe(0);
    clock.advance(200, false, step, 40);
    clock.advance(50000, true, step, 1);
    clock.advance(50100, true, step, 1);
    expect(steps).toBe(6);
  });
  it('bounds step count even when the timer has insufficient precision', () => {
    const clock = new FixedClock(() => 0);
    clock.advance(0, true, () => {}, 40);
    expect(clock.advance(200, true, () => {}, 40)).toBe(240);
    expect(clock.advance(200, true, () => {}, 40)).toBe(0);
  });
  it.each(SIMULATION_SPEEDS)('queues bombs while stopped and detonates them at %sx', speed => {
    const world = flatWorld(), clock = new FixedClock(() => 0);
    world.command({ kind: 'speed', speed: 0 });
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 12, y: 20 });
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    world.command({ kind: 'use-tool', toolId: 'core:rocket', x: 35, y: 35 });
    const stopped = world.snapshot(); advance(world, 10);
    expect(world.snapshot()).toEqual(stopped);
    world.command({ kind: 'speed', speed });
    clock.advance(0, !world.paused, () => world.step(), world.speed);
    for (let i = 1; i <= 60; i++) clock.advance(i * 1000 / (30 * speed), !world.paused, () => world.step(), world.speed);
    expect(world.tick).toBe(60);
    expect([...world.query('explosive')]).toHaveLength(0);
    for (const [x, y] of [[12, 20], [20, 20], [35, 35]]) expect(world.terrain.at(x, y)).toBe(Terrain.Crater);
  });
  it.each([false, true])('ignores unsupported speed commands without changing pause (paused: %s)', paused => {
    const world = flatWorld(); world.command({ kind: 'speed', speed: 40 }); world.paused = paused;
    for (const speed of [41, 50, 500, 5000]) {
      // @ts-expect-error JavaScript callers can send unsupported speeds.
      world.command({ kind: 'speed', speed });
      expect(world.speed).toBe(40); expect(world.paused).toBe(paused);
    }
  });
  it('resumes the previous speed after pausing and returns to normal speed on start', () => {
    const world = flatWorld(); world.command({ kind: 'speed', speed: 4 });
    world.command({ kind: 'speed', speed: 0 });
    expect(world.paused).toBe(true); expect(world.speed).toBe(4);
    world.command({ kind: 'pause', paused: false });
    expect(world.paused).toBe(false); expect(world.speed).toBe(4);
    world.command({ kind: 'speed', speed: 1 });
    expect(world.paused).toBe(false); expect(world.speed).toBe(1);
  });
});

describe('life and explosions at sea', () => {
  it.each([Terrain.Water, Terrain.DeepWater])('accepts ten rapid placements in water terrain %s while stopped', terrain => {
    const world = flatWorld(); world.terrain.tiles.fill(terrain); world.paused = true;
    const initialRng = world.rng.state;
    for (let i = 0; i < 10; i++) expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: 20, y: 20 })).toBeUndefined();
    expect(world.population).toBe(10); expect(world.rng.state).not.toBe(initialRng);
    for (const e of world.query('person')) expect(world.canStand(e.components.position!, 0.6, e.id, true)).toBe(true);
    const stopped = world.snapshot(); advance(world, 20); expect(world.snapshot()).toEqual(stopped);
    expect(world.command({ kind: 'use-tool', toolId: 'core:human', x: -1, y: 20 })).toBeTruthy();
    expect(world.population).toBe(10);
  });
  it('swims to nearby shore, survives, and keeps walking on land', () => {
    const world = flatWorld();
    for (let y = 0; y < 48; y++) for (let x = 24; x < 48; x++) world.terrain.set(x, y, Terrain.Water);
    world.command({ kind: 'use-tool', toolId: 'core:human', x: 26.5, y: 20.5 });
    const person = [...world.query('person')][0]; person.components.person!.buildIn = 100;
    advance(world, 1);
    expect(person.components.position!.x).toBeLessThan(26.5);
    expect(person.components.health!.current).toBeLessThan(70);
    advance(world, 3);
    expect(world.terrain.isLand(person.components.position!.x, person.components.position!.y)).toBe(true);
    const rescuedHealth = person.components.health!.current;
    advance(world, 10);
    expect(world.population).toBe(1); expect(person.components.health!.current).toBeGreaterThanOrEqual(rescuedHealth);
    expect(world.terrain.isLand(person.components.position!.x, person.components.position!.y)).toBe(true);
  });
  it('drowns far from shore without building, healing or leaving stale entities', () => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.DeepWater);
    world.command({ kind: 'use-tool', toolId: 'core:human', x: 20, y: 20 });
    const person = [...world.query('person')][0]; person.components.person!.buildIn = 0;
    advance(world, 5); expect(world.population).toBe(1); expect(person.components.health!.current).toBeCloseTo(35);
    advance(world, 5.1);
    expect(world.population).toBe(0); expect(world.houseCount).toBe(0); expect(world.entities.size).toBe(0);
    expect(world.nearby(person.components.position!, 2)).toHaveLength(0); expect(world.events).toHaveLength(0);
  });
  it('preserves swimming routes, exhaustion and underwater fuses through save and pause', () => {
    const world = flatWorld();
    for (let y = 0; y < 48; y++) for (let x = 24; x < 48; x++) world.terrain.set(x, y, Terrain.Water);
    world.command({ kind: 'use-tool', toolId: 'core:human', x: 29.5, y: 20.5 });
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 40, y: 40 }); advance(world, 0.7);
    expect([...world.query('person')][0].components.citizen!.path.length).toBeGreaterThan(0);
    world.paused = true;
    const saved = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(saved.seed, world.registry, saved); advance(restored, 20);
    expect(restored.snapshot()).toEqual(saved);
    world.paused = false; restored.paused = false; advance(world, 12); advance(restored, 12);
    expect(restored.snapshot()).toEqual(world.snapshot()); expect(restored.population).toBe(1);
    expect([...restored.query('explosive')]).toHaveLength(0);
  });
  it.each(['core:dynamite', 'core:rocket'])('%s explodes underwater, damages targets and preserves the sea', toolId => {
    const world = flatWorld(withCrate()); world.terrain.tiles.fill(Terrain.DeepWater);
    const target = world.spawn('test:wooden-crate', { x: 21, y: 20 })!;
    const far = world.spawn('test:wooden-crate', { x: 40, y: 20 })!;
    expect(world.command({ kind: 'use-tool', toolId, x: 20, y: 20 })).toBeUndefined();
    const fuse = toolId === 'core:dynamite' ? 2 : 1.25;
    advance(world, Math.floor(fuse * 30) / 30 - 1 / 30); expect([...world.query('explosive')]).toHaveLength(1);
    advance(world, 2 / 30);
    expect([...world.query('explosive')]).toHaveLength(0); expect(world.entities.has(target.id)).toBe(false);
    expect(far.components.health!.current).toBe(100); expect(far.components.thermal!.burning).toBe(false);
    expect(world.visuals.some(v => v.kind === 'blast')).toBe(true);
    expect(world.terrain.tiles.every(t => t === Terrain.DeepWater)).toBe(true); expect(world.terrain.recovery.size).toBe(0);
  });
  it('extinguishes any submerged flammable object and supports underwater chain reactions', () => {
    const world = flatWorld(withCrate()); world.terrain.tiles.fill(Terrain.Water);
    const crate = world.spawn('test:wooden-crate', { x: 35, y: 20 })!;
    crate.components.thermal!.burning = true; crate.components.thermal!.temperature = 100;
    world.step(); expect(crate.components.thermal!.burning).toBe(false);
    applyEvent(world, { kind: 'heat', target: crate.id, amount: 500 });
    expect(crate.components.thermal!.burning).toBe(false); expect(crate.components.health!.current).toBe(100);
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 }); advance(world, 1);
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 22, y: 20 }); advance(world, 1);
    expect([...world.query('explosive')]).toHaveLength(0); expect(world.visuals.filter(v => v.kind === 'blast')).toHaveLength(2);
    expect(world.terrain.tiles.every(t => t === Terrain.Water)).toBe(true);
  });
});

describe('property-based effects and tools', () => {
  it.each([['core:dynamite', 2.75], ['core:rocket', 4.5]] as const)('%s uses half its former radius for both the preview and damage', (toolId, radius) => {
    const world = flatWorld(withCrate());
    const inside = world.spawn('test:wooden-crate', { x: 20.5, y: 20 })!;
    const outside = world.spawn('test:wooden-crate', { x: 20 + radius + 0.5, y: 20 })!;
    world.command({ kind: 'use-tool', toolId, x: 20, y: 20 });
    expect(world.registry.tools.get(toolId)!.radius).toBe(radius);
    expect([...world.query('explosive')][0].components.explosive!.radius).toBe(radius);
    advance(world, 2);
    expect(world.entities.has(inside.id)).toBe(false);
    expect(outside.components.health!.current).toBe(100);
    expect(outside.components.thermal!.burning).toBe(false);
  });
  it('saved rain wets only its original area', () => {
    const world = flatWorld();
    const inside = world.spawn('core:tree', { x: 23, y: 20 })!;
    const outside = world.spawn('core:tree', { x: 24, y: 20 })!;
    world.addRain({ x: 20, y: 20 }, 3.5, 0.3);
    expect(world.effects[0].radius).toBe(3.5);
    advance(world, 0.2);
    expect(inside.components.thermal!.wetness).toBeGreaterThan(0);
    expect(outside.components.thermal!.wetness).toBe(0);
  });
  it('detonates dynamite exactly after two seconds and leaves walkable craters', () => {
    const world = flatWorld();
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    advance(world, 59 / 30);
    expect([...world.query('explosive')]).toHaveLength(1);
    world.step();
    expect([...world.query('explosive')]).toHaveLength(0);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Crater);
    expect(world.canStand({ x: 20, y: 20 })).toBe(true);
    expect(world.terrain.at(22, 20)).toBe(Terrain.Scorched);
    expect(world.terrain.at(23, 20)).toBe(Terrain.Grass);
  });
  it('uses the same blast system for a larger incoming rocket', () => {
    const dynamite = flatWorld(), rocket = flatWorld();
    dynamite.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    rocket.command({ kind: 'use-tool', toolId: 'core:rocket', x: 20, y: 20 });
    advance(rocket, 1); expect([...rocket.query('projectile')]).toHaveLength(1);
    advance(rocket, 0.3); advance(dynamite, 2);
    expect([...rocket.query('projectile')]).toHaveLength(0);
    const craters = (w: World): number => w.terrain.tiles.filter(t => t === Terrain.Crater).length;
    expect(craters(rocket)).toBeGreaterThan(craters(dynamite));
  });
  it('damages people, houses, trees and a registered crate, excluding distant targets', () => {
    const world = flatWorld(withCrate());
    for (const type of ['core:person', 'core:house', 'core:tree', 'test:wooden-crate']) world.spawn(type, { x: 20, y: 20 });
    const far = world.spawn('test:wooden-crate', { x: 40, y: 40 })!;
    world.events.push({ kind: 'blast', x: 20, y: 20, radius: 6, power: 500, heat: 100 });
    processEvents(world);
    expect([...world.entities.keys()]).toEqual([far.id]);
    expect(world.nearby({ x: 20, y: 20 }, 6)).toHaveLength(0);
    expect(world.population).toBe(0); expect(world.houseCount).toBe(0);
  });
  it('spreads fire to a new registered flammable type and rain suppresses it', () => {
    const world = flatWorld(withCrate());
    const tree = world.spawn('core:tree', { x: 20, y: 20 })!;
    const crate = world.spawn('test:wooden-crate', { x: 22, y: 20 })!;
    applyEvent(world, { kind: 'heat', target: tree.id, amount: 100 }); advance(world, 1.5);
    expect(crate.components.thermal!.burning).toBe(true);
    expect(crate.components.health!.current).toBeLessThan(100);
    world.addRain({ x: 21, y: 20 }, 7, 4); advance(world, 1);
    expect(tree.components.thermal!.burning).toBe(false);
    expect(crate.components.thermal!.burning).toBe(false);
    const health = crate.components.health!.current; advance(world, 1);
    expect(crate.components.health!.current).toBe(health);
  });
  it('restores only scorched grass after sustained rain, retaining craters and losses', () => {
    const world = flatWorld();
    world.terrain.set(20, 20, Terrain.Scorched); world.terrain.set(21, 20, Terrain.Crater);
    world.addRain({ x: 20, y: 20 }, 7, 13); advance(world, 6);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Scorched);
    advance(world, 6.2);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Grass);
    expect(world.terrain.at(21, 20)).toBe(Terrain.Crater);
    expect(world.population + world.houseCount).toBe(0);
  });
  it('propagates chain detonations and bounds event work per step', () => {
    const world = flatWorld();
    const first = world.spawn('core:dynamite', { x: 20, y: 20 })!;
    const second = world.spawn('core:dynamite', { x: 22, y: 20 })!;
    first.components.explosive!.fuse = 0;
    advance(world, 0.2);
    expect(world.entities.has(second.id)).toBe(false);
    expect(world.visuals.filter(v => v.kind === 'blast')).toHaveLength(2);
    for (let i = 0; i < EVENT_BUDGET * 3; i++) world.events.push({ kind: 'damage', target: 9999, amount: 1 });
    processEvents(world); expect(world.events.length).toBe(EVENT_BUDGET * 2);
    world.step(); expect(world.events.length).toBe(EVENT_BUDGET);
    world.step(); expect(world.events).toHaveLength(0);
  });
  it('extinguishes exhausted fuel and removes dead entities from every index', () => {
    const world = flatWorld(withCrate());
    const crate = world.spawn('test:wooden-crate', { x: 20, y: 20 })!;
    crate.components.combustible!.fuel = 0.01;
    applyEvent(world, { kind: 'heat', target: crate.id, amount: 100 }); advance(world, 0.1);
    expect(crate.components.thermal!.burning).toBe(false);
    applyEvent(world, { kind: 'damage', target: crate.id, amount: 500 });
    expect(world.entities.size).toBe(0); expect([...world.query('combustible')]).toHaveLength(0);
    expect(world.nearby({ x: 20, y: 20 }, 1)).toHaveLength(0);
  });
  it('supports more than 400 registered types without touching effect systems', () => {
    const registry = createRegistry();
    for (let i = 0; i < 420; i++) registry.registerEntity({ id: `test:variant-${i}`, sprite: 'crate', create: position => ({ position, health: { current: 1, max: 1 } }) });
    const world = flatWorld(registry);
    for (let i = 0; i < 420; i++) world.spawn(`test:variant-${i}`, { x: 20, y: 20 });
    world.events.push({ kind: 'blast', x: 20, y: 20, radius: 3, power: 10, heat: 10 });
    advance(world, 0.2); expect(world.entities.size).toBe(0);
  });
});

describe('people and settlements', () => {
  it('keeps wandering and blast impulses on land', () => {
    const world = flatWorld();
    world.terrain.tiles.fill(Terrain.Water);
    for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) world.terrain.set(x, y, Terrain.Grass);
    const human = world.spawn('core:person', { x: 20, y: 20 })!;
    applyEvent(world, { kind: 'impulse', target: human.id, x: 150, y: 0 });
    for (let i = 0; i < 900; i++) { world.step(); const p = human.components.position!; expect(world.terrain.isLand(p.x, p.y)).toBe(true); }
  });
  it.each(['dynamite', 'rocket', 'fire'])('keeps walking normally near %s without fleeing or abandoning its route', danger => {
    const world = flatWorld();
    const human = world.spawn('core:person', { x: 20, y: 20 })!;
    const home = world.spawn('core:house', { x: 28, y: 20 })!;
    human.components.motion!.heading = 0; human.components.motion!.decisionIn = 10;
    const citizen = human.components.citizen!;
    citizen.task = 'visit'; citizen.targetId = home.id; citizen.path = [{ x: 28, y: 20 }]; citizen.reconsiderIn = 10;
    const hazard = world.spawn(danger === 'fire' ? 'core:tree' : `core:${danger}`, { x: 23, y: 20 })!;
    if (danger === 'fire') applyEvent(world, { kind: 'heat', target: hazard.id, amount: 100 });
    advance(world, 0.8);
    expect(human.components.position!.x).toBeCloseTo(20 + human.components.motion!.speed * 0.8);
    expect(human.components.position!.y).toBeCloseTo(20);
    expect(human.components.motion!.heading).toBe(0);
    expect(citizen.task).toBe('visit'); expect(citizen.targetId).toBe(home.id);
    expect(citizen.path).toEqual([{ x: 28, y: 20 }]);
  });
  it('builds, shares housing and produces children with a pair and free space', () => {
    const world = flatWorld();
    const a = world.spawn('core:person', { x: 20, y: 20 })!;
    const b = world.spawn('core:person', { x: 22, y: 20 })!;
    for (const [i, p] of [a, b].entries()) {
      p.components.person!.sex = i ? 'b' : 'a'; p.components.person!.buildIn = 0;
      p.components.person!.reproduceIn = 0;
    }
    advance(world, 0.5);
    expect(world.houseCount).toBe(0); expect(a.components.citizen!.partnerId).toBeNull();
    advance(world, 0.5);
    expect(world.houseCount).toBe(1); expect(a.components.citizen!.partnerId).toBe(b.id);
    const site = [...world.query('dwelling')][0];
    expect(site.components.dwelling!.construction).toBeDefined();
    expect(a.components.citizen!.pregnancy).toBe(0);
    for (let i = 0; i < 30 && a.components.citizen!.pregnancy === 0; i++) advance(world, 1);
    expect(site.components.dwelling!.construction).toBeUndefined();
    expect(a.components.citizen!.pregnancy).toBeGreaterThan(0);
    advance(world, 8);
    expect(world.population).toBe(2);
    advance(world, 9);
    expect(world.houseCount).toBe(1); expect(world.population).toBe(3);
    expect(a.components.person!.homeId).toBe(b.components.person!.homeId);
    const child = [...world.query('person')].find(e => e.id !== a.id && e.id !== b.id)!;
    expect(child.components.person!.age).toBeLessThan(1);
    const home = world.entities.get(a.components.person!.homeId!)!;
    home.components.dwelling!.capacity = 3;
    a.components.person!.buildIn = 1000;
    advance(world, 60); expect(world.population).toBe(3);
    world.remove(home.id); expect(a.components.person!.homeId).toBeNull(); expect(child.components.person!.homeId).toBeNull();
  });
  it('does not reproduce without a pair', () => {
    const world = flatWorld();
    const a = world.spawn('core:person', { x: 20, y: 20 })!;
    a.components.person!.buildIn = 4; a.components.person!.reproduceIn = 0;
    advance(world, 4); expect(world.houseCount).toBe(0);
    advance(world, 4); expect(world.houseCount).toBe(1);
    advance(world, 32); expect(world.houseCount).toBe(1); expect(world.population).toBe(1);
  });
});

describe('gradual landscape recovery', () => {
  it.each(['core:dynamite', 'core:rocket'])('heals damage from %s in stages without rain', toolId => {
    const world = flatWorld();
    world.command({ kind: 'use-tool', toolId, x: 20, y: 20 }); advance(world, 2);
    const damaged = (): number => world.terrain.tiles.filter(t => t === Terrain.Crater || t === Terrain.Scorched).length;
    const initial = damaged(); expect(initial).toBeGreaterThan(20);
    advance(world, 40); expect(damaged()).toBe(initial);
    advance(world, 72);
    expect(damaged()).toBeGreaterThan(0); expect(damaged()).toBeLessThan(initial);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Crater);
    advance(world, 112);
    expect(world.terrain.tiles).not.toContain(Terrain.Crater);
    expect(world.terrain.tiles).toContain(Terrain.Scorched);
    advance(world, 160);
    expect(damaged()).toBe(0); expect(world.terrain.recovery.size).toBe(0);
    expect(world.terrain.tiles.every(t => t === Terrain.Grass)).toBe(true);
  });
  it('recovers burned ground only after the fire goes out', () => {
    const world = flatWorld(), tree = world.spawn('core:tree', { x: 20.5, y: 20.5 })!;
    tree.components.health = { current: 100000, max: 100000 }; tree.components.combustible!.fuel = 1000;
    applyEvent(world, { kind: 'heat', target: tree.id, amount: 100 }); advance(world, 70);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Scorched);
    expect(world.terrain.recovery.get(world.terrain.index(20, 20))!.age).toBe(0);
    world.addRain({ x: 20.5, y: 20.5 }, 2, 1); advance(world, 1);
    expect(tree.components.thermal!.burning).toBe(false);
    advance(world, 144); expect(world.terrain.at(20, 20)).toBe(Terrain.Grass);
  });
  it('restarts recovery after repeated blasts, including an existing crater in the outer blast ring', () => {
    const world = flatWorld();
    world.events.push({ kind: 'blast', x: 20, y: 20, radius: 6, power: 0, heat: 0 }); processEvents(world);
    advance(world, 15);
    const center = world.terrain.index(20, 20), edge = world.terrain.index(24, 20);
    expect(world.terrain.recovery.get(center)!.age).toBe(3); expect(world.terrain.recovery.get(edge)!.age).toBe(3);
    world.events.push({ kind: 'blast', x: 24, y: 20, radius: 6, power: 0, heat: 0 }); processEvents(world);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Crater);
    expect(world.terrain.recovery.get(center)!.age).toBe(0); expect(world.terrain.recovery.get(edge)!.age).toBe(0);
    advance(world, 10); expect(world.terrain.at(20, 20)).toBe(Terrain.Crater);
  });
  it('restores a sandy beach without filling water or recreating destroyed residents and buildings', () => {
    const world = flatWorld();
    for (let y = 14; y <= 26; y++) for (let x = 14; x <= 26; x++) world.terrain.set(x, y, x < 18 ? Terrain.Water : Terrain.Sand);
    world.terrain.set(35, 35, Terrain.Road);
    const original = [...world.terrain.tiles];
    for (const type of ['core:person', 'core:tree', 'core:house']) world.spawn(type, { x: 20, y: 20 });
    world.events.push({ kind: 'blast', x: 20, y: 20, radius: 6, power: 500, heat: 100 }); processEvents(world);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Crater);
    advance(world, 384);
    expect(world.terrain.tiles).toEqual(original);
    expect(world.entities.size).toBe(0); expect(world.terrain.recovery.size).toBe(0);
  });
  it('rain restores the remembered beach surface after its crater has closed', () => {
    const world = flatWorld(); world.terrain.set(20, 20, Terrain.Sand); world.terrain.set(20, 20, Terrain.Crater);
    advance(world, 220); expect(world.terrain.at(20, 20)).toBe(Terrain.Scorched);
    world.addRain({ x: 20, y: 20 }, 2, 13); advance(world, 12.2);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Sand); expect(world.terrain.recovery.size).toBe(0);
  });
  it.each([1, 2, 4] as const)('landscape uses simulation time at %sx and stops aging on pause', speed => {
    const world = flatWorld(), clock = new FixedClock(() => 0);
    world.terrain.set(20, 20, Terrain.Crater); world.terrain.set(21, 20, Terrain.Scorched);
    world.command({ kind: 'speed', speed: 0 }); const paused = world.snapshot(); advance(world, 100);
    expect(world.snapshot()).toEqual(paused);
    world.command({ kind: 'speed', speed });
    clock.advance(0, true, () => world.step(), speed);
    for (let i = 1; i <= 3840 / speed; i++) clock.advance(i * 100, true, () => world.step(), speed);
    expect(world.tick).toBe(11520);
    expect(world.terrain.at(20, 20)).toBe(Terrain.Grass); expect(world.terrain.at(21, 20)).toBe(Terrain.Grass);
  });
});
