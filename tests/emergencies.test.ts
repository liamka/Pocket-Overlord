import { describe, expect, it } from 'vitest';
import { STEP, Terrain, type Vec2 } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent } from '../src/systems/effects';
import { advance, flatWorld } from './helpers';

function resident(world: World, p: Vec2, age = 25) {
  const e = world.spawn('core:person', p)!;
  Object.assign(e.components.person!, { age, sex: 'b', buildIn: 10000, reproduceIn: 10000 });
  return e;
}

describe('disaster response', () => {
  it('makes children escape a fire by walking on safe land', () => {
    const world = flatWorld(), fire = world.spawn('core:house', { x: 24, y: 24 })!, child = resident(world, { x: 24, y: 19 }, 5);
    applyEvent(world, { kind: 'heat', target: fire.id, amount: 80 });
    world.step(); expect(child.components.citizen!.emergency?.kind).toBe('flee');
    for (let i = 0; i < 150; i++) {
      const before = { ...child.components.position! }; world.step();
      const p = child.components.position!;
      expect(Math.hypot(p.x - before.x, p.y - before.y)).toBeLessThanOrEqual(3.4 * STEP + 1e-8);
      expect(world.terrain.isLand(p.x, p.y)).toBe(true);
    }
    expect(Math.hypot(child.components.position!.x - 24, child.components.position!.y - 24)).toBeGreaterThan(7);
    expect(child.components.health!.current).toBe(child.components.health!.max);
    world.remove(fire.id); world.step(); expect(child.components.citizen!.emergency).toBeUndefined();
  });

  it('interrupts ordinary work immediately to escape an imminent explosion', () => {
    const world = flatWorld(), adult = resident(world, { x: 20, y: 24 });
    Object.assign(adult.components.citizen!, { task: 'visit', path: [{ x: 23, y: 24 }] });
    world.spawn('core:dynamite', { x: 23, y: 24 });
    world.step(); expect(adult.components.citizen!.emergency?.kind).toBe('flee');
    advance(world, 2.2);
    expect(world.entities.has(adult.id)).toBe(true);
    expect(adult.components.health!.current).toBe(adult.components.health!.max);
    expect(adult.components.position!.x).toBeLessThan(18);
  });

  it('sends an adult to extinguish a reachable fire without walking into the flames', () => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!, adult = resident(world, { x: 18, y: 24 });
    applyEvent(world, { kind: 'heat', target: house.id, amount: 80 });
    advance(world, 0.5); expect(adult.components.citizen!.emergency?.kind).toBe('extinguish');
    advance(world, 5);
    expect(world.entities.has(house.id)).toBe(true); expect(house.components.thermal!.burning).toBe(false);
    expect(house.components.health!.current).toBeGreaterThan(100);
    expect(adult.components.health!.current).toBe(adult.components.health!.max);
  });

  it('reaches a wounded neighbor and provides first aid over time', () => {
    const world = flatWorld(), patient = resident(world, { x: 24, y: 24 }), helper = resident(world, { x: 18, y: 24 });
    patient.components.health!.current = 15; patient.components.motion!.speed = 0;
    advance(world, 0.5); expect(helper.components.citizen!.emergency?.kind).toBe('aid');
    expect(patient.components.health!.current).toBeLessThan(17);
    advance(world, 14);
    expect(patient.components.health!.current).toBeGreaterThanOrEqual(patient.components.health!.max * 0.85);
    expect(helper.components.citizen!.emergency).toBeUndefined();
  });

  it('does not send children or helpers across an impassable river to fight a fire', () => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 28, y: 24 })!;
    const adult = resident(world, { x: 21, y: 24 }), child = resident(world, { x: 28, y: 18 }, 5);
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    applyEvent(world, { kind: 'heat', target: house.id, amount: 80 });
    advance(world, 5);
    expect(adult.components.citizen!.emergency?.kind).not.toBe('extinguish');
    expect(child.components.citizen!.emergency?.kind).not.toBe('extinguish');
    expect(adult.components.position!.x).toBeLessThan(24); expect(house.components.thermal!.burning).toBe(true);
  });

  it('preserves active response across save/load, pauses it and releases a removed target', () => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!, adult = resident(world, { x: 18, y: 24 });
    applyEvent(world, { kind: 'heat', target: house.id, amount: 80 }); advance(world, 0.5);
    const save = decodeSave(world.snapshot(), world.registry), copy = new World(world.seed, world.registry, save);
    advance(world, 8); advance(copy, 8); expect(copy.snapshot()).toEqual(world.snapshot());
    copy.paused = true; const paused = copy.snapshot(); advance(copy, 2); expect(copy.snapshot()).toEqual(paused);
    const invalid = structuredClone(save);
    invalid.entities.find(e => e.id === adult.id)!.components.citizen!.emergency!.targetId = 999999;
    expect(() => decodeSave(invalid, world.registry)).toThrow();
    const original = new World(world.seed, world.registry, save); original.remove(house.id);
    expect(original.entities.get(adult.id)!.components.citizen!.emergency).toBeUndefined();
    expect(() => decodeSave(original.snapshot(), original.registry)).not.toThrow();
  });
});
