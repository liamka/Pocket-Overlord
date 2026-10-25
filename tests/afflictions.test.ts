import { describe, expect, it } from 'vitest';
import { PLAGUE, MADNESS } from '../src/core/afflictions';
import { RACES } from '../src/core/races';
import { Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { enrage, infect } from '../src/systems/afflictions';
import { migrations } from '../src/systems/migration';
import { assignHouse } from '../src/systems/society';
import { advance, flatWorld, migrationWorld } from './helpers';

function resident(world: World, x: number, y = 24, type = 'core:person') {
  const entity = world.spawn(type, { x, y })!;
  entity.components.person!.buildIn = entity.components.person!.reproduceIn = 10000;
  return entity;
}
const use = (world: World, toolId: string, x = 24, y = 24) => world.command({ kind: 'use-tool', toolId, x, y });

describe('plague and madness tools', () => {
  it('affects every resident race inside the brush without affecting scenery or resetting existing symptoms', () => {
    const world = flatWorld(), people = Object.values(RACES).map((race, i) => resident(world, 21 + i * 2, 24, race.entityId));
    const outside = resident(world, 40), tree = world.spawn('core:tree', { x: 24, y: 27 })!;
    world.paused = true;
    use(world, PLAGUE.id); use(world, MADNESS.id);
    expect(people.every(e => e.components.person!.plague && e.components.person!.madness)).toBe(true);
    expect(outside.components.person).not.toHaveProperty('plague'); expect(outside.components.person).not.toHaveProperty('madness');
    expect(tree.components.health!.current).toBe(tree.components.health!.max);
    for (const e of people) { e.components.person!.plague!.age = 7; e.components.person!.madness!.age = 5; }
    use(world, PLAGUE.id); use(world, MADNESS.id);
    expect(people.map(e => [e.components.person!.plague!.age, e.components.person!.madness!.age])).toEqual([[7, 5], [7, 5], [7, 5], [7, 5]]);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('waits through incubation, spreads through contact and kills infected residents while an isolated resident survives', () => {
    const world = flatWorld(), carrier = resident(world, 22), neighbor = resident(world, 24), isolated = resident(world, 40);
    for (const e of [carrier, neighbor, isolated]) e.components.motion!.speed = 0;
    infect(carrier); advance(world, 2);
    expect(neighbor.components.person!.plague).toBeUndefined(); expect(carrier.components.health!.current).toBe(carrier.components.health!.max);
    advance(world, 6);
    expect(neighbor.components.person!.plague).toBeDefined(); expect(carrier.components.health!.current).toBeLessThan(carrier.components.health!.max);
    expect(isolated.components.person!.plague).toBeUndefined();
    advance(world, 22);
    expect(world.entities.has(carrier.id)).toBe(false); expect(world.entities.has(neighbor.id)).toBe(false);
    expect(world.entities.has(isolated.id)).toBe(true); expect(world.population).toBe(1);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('does not spread infection through a mountain wall', () => {
    const world = flatWorld(), carrier = resident(world, 23.5), neighbor = resident(world, 25.5);
    carrier.components.motion!.speed = neighbor.components.motion!.speed = 0;
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Mountain);
    infect(carrier); advance(world, 12);
    expect(carrier.components.health!.current).toBeLessThan(carrier.components.health!.max);
    expect(neighbor.components.person!.plague).toBeUndefined();
  });

  it('makes a resident attack a fellow villager, who fights back, without declaring war', () => {
    const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 20 })!, village = assignHouse(world, home);
    const attacker = resident(world, 21), defender = resident(world, 24);
    for (const e of [attacker, defender]) { e.components.person!.homeId = home.id; e.components.citizen!.villageId = village.id; }
    enrage(world, attacker); const start = { ...attacker.components.position! };
    advance(world, 3);
    expect(attacker.components.citizen!.task).toBe('fight'); expect(defender.components.citizen!.task).toBe('fight');
    expect(attacker.components.citizen!.targetId).toBe(defender.id); expect(defender.components.citizen!.targetId).toBe(attacker.id);
    expect(attacker.components.position).not.toEqual(start);
    expect(attacker.components.health!.current).toBeLessThan(attacker.components.health!.max);
    expect(defender.components.health!.current).toBeLessThan(defender.components.health!.max);
    expect(defender.components.person!.madness).toBeUndefined(); expect(world.society.wars).toHaveLength(0);
    advance(world, 10); expect(world.population).toBeLessThan(2);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it.each([Terrain.Water, Terrain.Mountain])('does not attack residents across an impassable barrier (%s)', barrier => {
    const world = flatWorld(), attacker = resident(world, 23.5), target = resident(world, 25.5);
    attacker.components.motion!.speed = target.components.motion!.speed = 0;
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, barrier);
    enrage(world, attacker); advance(world, 5);
    expect(attacker.components.citizen!.targetId).toBeNull();
    expect(target.components.health!.current).toBe(target.components.health!.max);
  });

  it('detaches a mad traveler from a migration without breaking the remaining family or its saved state', () => {
    const world = migrationWorld(); world.tick = 300; migrations(world);
    const group = world.society.migrations[0], traveler = world.entities.get(group.members[0])!;
    expect(group.members).toHaveLength(3); enrage(world, traveler);
    expect(group.members).toHaveLength(2); expect(group.members).not.toContain(traveler.id);
    expect(traveler.components.citizen!.task).toBe('idle');
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    advance(world, 1);
    expect(traveler.components.citizen!.task).not.toBe('migrate');
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
});

describe('affliction persistence', () => {
  it.each([0, 3, 8])('freezes and resumes infection and combat identically after saving at %s seconds', time => {
    const world = flatWorld();
    for (let i = 0; i < 6; i++) resident(world, 10 + i * 2, 20);
    use(world, PLAGUE.id, 10, 20); enrage(world, [...world.query('person')].at(-1)!); advance(world, time);
    world.paused = true; const save = world.snapshot(); advance(world, 2); expect(world.snapshot()).toEqual(save);
    const decoded = decodeSave(JSON.parse(JSON.stringify(save)), world.registry), restored = new World(world.seed, world.registry, decoded);
    expect(restored.snapshot()).toEqual(save); world.paused = restored.paused = false;
    advance(world, 6); advance(restored, 6); expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('loads residents without afflictions and rejects malformed infection and madness state', () => {
    const world = flatWorld(); resident(world, 24);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    for (const state of [{ plague: { age: -1, spreadIn: 0 } }, { plague: { age: 0, spreadIn: 2 } }, { plague: null }, { madness: { age: NaN } }, { madness: null }]) {
      const save = world.snapshot(); Object.assign(save.entities[0].components.person!, state);
      expect(() => decodeSave(save, world.registry)).toThrow();
    }
  });
});
