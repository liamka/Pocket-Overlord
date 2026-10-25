import { describe, expect, it } from 'vitest';
import { ACID, GEOHAZARDS, VOLCANO, bombPose, geohazards } from '../src/core/geohazards';
import { Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent } from '../src/systems/effects';
import { advance, flatWorld } from './helpers';

const use = (world: World, toolId: string, x = 24, y = 24) => world.command({ kind: 'use-tool', toolId, x, y });

describe('acid', () => {
  it('corrodes residents, trees, houses and ground, then evaporates', () => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!, tree = world.spawn('core:tree', { x: 25, y: 24 })!;
    const person = world.spawn('core:person', { x: 23, y: 24 })!;
    person.components.motion!.speed = 0; person.components.person!.buildIn = 10000;
    const outside = world.spawn('core:tree', { x: 32, y: 24 })!;
    use(world, ACID.id); expect(house.components.health!.current).toBe(180);
    advance(world, 0.5); expect(house.components.health!.current).toBeLessThan(180); expect(world.terrain.at(24, 24)).toBe(Terrain.Crater);
    advance(world, 8);
    for (const e of [house, tree, person]) expect(world.entities.has(e.id)).toBe(false);
    expect(outside.components.health!.current).toBe(outside.components.health!.max);
    advance(world, 1); expect(geohazards(world)).toBeUndefined(); expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('does not multiply corrosion when a held brush repeatedly covers the same area', () => {
    const world = flatWorld(), tree = world.spawn('core:tree', { x: 24, y: 24 })!;
    use(world, ACID.id); const save = world.snapshot(), other = new World(world.seed, world.registry, save);
    for (let i = 0; i < 20; i++) use(world, ACID.id);
    expect(geohazards(world)!.acid).toHaveLength(1);
    advance(world, 1); advance(other, 1);
    expect(tree.components.health!.current).toBe(other.entities.get(tree.id)!.components.health!.current);
  });

  it('dilutes in rain and water without burning or converting the sea to land', () => {
    const world = flatWorld(); use(world, ACID.id, 10, 24); use(world, ACID.id, 24, 24);
    world.terrain.circle(38, 24, 5, (x, y) => world.terrain.set(x, y, Terrain.Water)); use(world, ACID.id, 38, 24);
    world.addRain({ x: 10, y: 24 }, 4, 4); advance(world, 2.5);
    expect(geohazards(world)!.acid.map(p => p.x)).toEqual([24]); expect(world.terrain.at(38, 24)).toBe(Terrain.Water);
  });

  it('makes a resident walk away from an acid puddle', () => {
    const world = flatWorld(), person = world.spawn('core:person', { x: 25, y: 24 })!;
    person.components.person!.buildIn = 10000; use(world, ACID.id);
    advance(world, 0.3); expect(person.components.citizen!.emergency?.kind).toBe('flee');
    advance(world, 2); expect(world.entities.has(person.id)).toBe(true);
    expect(Math.hypot(person.components.position!.x - 24, person.components.position!.y - 24)).toBeGreaterThan(ACID.radius);
  });
});

describe('volcano', () => {
  it('grows, throws rocks along ballistic arcs, damages their landing sites and produces cooling lava', () => {
    const world = flatWorld(); use(world, VOLCANO.id);
    const volcano = [...world.query('volcano')][0]; expect(volcano).toBeDefined();
    advance(world, 1); expect(geohazards(world)!.bombs).toHaveLength(0);
    advance(world, 1.2); const state = geohazards(world)!;
    expect(state.bombs).toHaveLength(8); expect(state.flows).toHaveLength(3);
    const bomb = state.bombs[0], pose = bombPose(bomb);
    expect(pose.z).toBeGreaterThan(5); expect(bombPose({ ...bomb, age: bomb.life })).toEqual({ x: bomb.tx, y: bomb.ty, z: 0 });
    const tree = world.spawn('core:tree', { x: bomb.tx, y: bomb.ty })!;
    advance(world, 3); expect(world.entities.has(tree.id)).toBe(false); expect(state.bombs).toHaveLength(0);
    expect(state.lava.length).toBeGreaterThan(15); expect(state.lava.some(p => Math.hypot(p.x - 24, p.y - 24) > 8)).toBe(true);
    expect(volcano.components.health!.current).toBe(volcano.components.health!.max);
    applyEvent(world, { kind: 'damage', target: volcano.id, amount: 2000 });
    advance(world, 15); expect(geohazards(world)).toBeUndefined(); expect(world.terrain.at(24, 24)).toBe(Terrain.Mountain);
  });

  it('erupts again, rejects duplicate or underwater placement, and stops when submerged', () => {
    const world = flatWorld(); use(world, VOLCANO.id); use(world, VOLCANO.id, 25, 24);
    world.terrain.set(5, 5, Terrain.Water); use(world, VOLCANO.id, 5, 5);
    expect([...world.query('volcano')]).toHaveLength(1);
    advance(world, 12.2); expect(geohazards(world)!.bombs).toHaveLength(8);
    world.terrain.set(24, 24, Terrain.Water); advance(world, 0.1);
    expect([...world.query('volcano')]).toHaveLength(0);
    advance(world, 20); expect(geohazards(world)).toBeUndefined();
  });
});

describe('geohazard saves', () => {
  it.each([0, 2.8, 6, 13])('freezes and resumes corrosion, eruptions and lava identically at %s seconds', time => {
    const world = flatWorld(); use(world, ACID.id, 10, 24); use(world, VOLCANO.id, 32, 24);
    world.spawn('core:tree', { x: 10, y: 24 }); advance(world, time);
    world.paused = true; const snapshot = world.snapshot(); advance(world, 2); expect(world.snapshot()).toEqual(snapshot);
    const decoded = decodeSave(JSON.parse(JSON.stringify(snapshot)), world.registry), restored = new World(world.seed, world.registry, decoded);
    expect(restored.snapshot()).toEqual(snapshot); world.paused = restored.paused = false;
    advance(world, 5); advance(restored, 5); expect(restored.snapshot()).toEqual(world.snapshot());
    expect(() => decodeSave(restored.snapshot(), restored.registry)).not.toThrow();
  });

  it('bounds painted pools and rejects malformed hazard state', () => {
    const world = flatWorld();
    for (let y = 2; y < 46; y += 4) for (let x = 2; x < 46; x += 4) use(world, ACID.id, x, y);
    expect(geohazards(world)!.acid).toHaveLength(GEOHAZARDS.acids);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    for (const invalid of [{ radius: 100 }, { remaining: -1 }, { age: Infinity }, { seed: -1 }]) {
      const save = world.snapshot(), state = save.scenarios.find(s => s.id === GEOHAZARDS.id)!.state as { acid: Record<string, unknown>[] };
      Object.assign(state.acid[0], invalid); expect(() => decodeSave(save, world.registry)).toThrow();
    }
  });

  it('keeps a crowded eruption within saved-state limits', () => {
    const world = flatWorld();
    for (const y of [6, 24, 42]) for (const x of [4, 17, 30, 43]) use(world, VOLCANO.id, x, y);
    use(world, VOLCANO.id, 24, 12); expect([...world.query('volcano')]).toHaveLength(VOLCANO.limit);
    advance(world, 6); const state = geohazards(world)!;
    expect(state.lava.length).toBeGreaterThan(100); expect(state.lava.length).toBeLessThanOrEqual(GEOHAZARDS.lava);
    expect(state.bombs.length).toBeLessThanOrEqual(GEOHAZARDS.bombs); expect(state.flows.length).toBeLessThanOrEqual(GEOHAZARDS.flows);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
});
