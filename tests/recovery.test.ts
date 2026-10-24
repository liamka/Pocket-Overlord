import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent } from '../src/systems/effects';
import { assignHouse } from '../src/systems/society';
import { advance, flatWorld } from './helpers';

function household() {
  const world = flatWorld(), house = world.spawn('core:house', { x: 10, y: 24 })!, town = assignHouse(world, house);
  const resident = world.spawn('core:person', { x: 8.2, y: 24 })!;
  Object.assign(resident.components.person!, { age: 25, sex: 'b', homeId: house.id, buildIn: 10000, reproduceIn: 10000 });
  resident.components.citizen!.villageId = town.id;
  return { world, house, town, resident };
}
const destroy = (world: World, id: number) => applyEvent(world, { kind: 'damage', target: id, amount: 1000 });

describe('settlement recovery', () => {
  it('leaves persistent ruins and records the survivors without counting rubble as housing', () => {
    const { world, house, resident } = household(), rng = world.rng.state;
    destroy(world, house.id); destroy(world, house.id);
    expect(world.houseCount).toBe(0); expect([...world.query('ruin')]).toHaveLength(1);
    expect(world.rng.state).toBe(rng); expect(resident.components.person!.homeId).toBeNull();
    expect(resident.components.person!.displaced).toEqual({ homeId: house.id, since: 0 });
    const save = decodeSave(world.snapshot(), world.registry), copy = new World(world.seed, world.registry, save);
    expect(copy.snapshot()).toEqual(save);
    const ruin = [...copy.query('ruin')][0]; expect(ruin.components.position).toEqual(house.components.position);
    const invalid = structuredClone(save); invalid.entities.find(e => e.components.ruin)!.components.ruin!.destroyedAt = 99;
    expect(() => decodeSave(invalid, world.registry)).toThrow();
  });

  it('rebuilds a safe ruined home in place through the existing construction work', () => {
    const { world, house, resident } = household(); resident.components.motion!.speed = 0;
    destroy(world, house.id); advance(world, 19);
    expect(world.houseCount).toBe(0); expect([...world.query('ruin')]).toHaveLength(1);
    advance(world, 2);
    const rebuilt = [...world.query('dwelling')][0];
    expect(rebuilt.components.position).toEqual(house.components.position);
    expect(rebuilt.components.dwelling!.construction).toBeDefined(); expect([...world.query('ruin')]).toHaveLength(0);
    expect(resident.components.person!.homeId).toBe(rebuilt.id); expect(resident.components.person!.displaced).toBeUndefined();
    advance(world, 16); expect(rebuilt.components.dwelling!.construction).toBeUndefined();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it.each([20, 34])('walks displaced families to available shelter at x=%s without teleporting', x => {
    const { world, house, resident } = household(), shelter = world.spawn('core:house', { x, y: 24 })!;
    assignHouse(world, shelter);
    const child = world.spawn('core:person', { x: 8, y: 26 })!;
    Object.assign(child.components.person!, { age: 5, homeId: house.id, buildIn: 10000 });
    Object.assign(child.components.citizen!, { villageId: resident.components.citizen!.villageId, parents: [resident.id] });
    destroy(world, house.id); advance(world, 5.1);
    expect(world.society.migrations).toHaveLength(1);
    expect(world.society.migrations[0].members).toEqual([resident.id, child.id]);
    expect(resident.components.person!.homeId).toBeNull(); expect(child.components.person!.homeId).toBeNull();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    for (let i = 0; i < 1200 && world.society.migrations.length; i++) world.step();
    for (const e of [resident, child]) {
      expect(e.components.person!.homeId).toBe(shelter.id); expect(e.components.person!.displaced).toBeUndefined();
      expect(Math.hypot(e.components.position!.x - x, e.components.position!.y - 24)).toBeLessThanOrEqual(3.2);
    }
    expect([...world.query('ruin')]).toHaveLength(1);
  });

  it('finds shelter for an orphan and cancels a journey if that shelter is destroyed', () => {
    const { world, house, resident } = household(), shelter = world.spawn('core:house', { x: 34, y: 24 })!;
    assignHouse(world, shelter); resident.components.person!.age = 5;
    destroy(world, house.id); advance(world, 5.1);
    expect(world.society.migrations).toHaveLength(1);
    destroy(world, shelter.id); advance(world, 0.5);
    expect(world.society.migrations).toHaveLength(0); expect(resident.components.person!.homeId).toBeNull();
    expect(resident.components.person!.displaced).toBeDefined();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('does not assign unreachable shelter or rebuild flooded ruins', () => {
    const { world, house, resident } = household(), shelter = world.spawn('core:house', { x: 34, y: 24 })!;
    assignHouse(world, shelter); resident.components.motion!.speed = 0;
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    destroy(world, house.id); world.terrain.set(10, 24, Terrain.Water); advance(world, 25);
    expect(resident.components.person!.homeId).toBeNull(); expect(world.society.migrations).toHaveLength(0);
    expect([...world.query('ruin')]).toHaveLength(1); expect(world.houseCount).toBe(1);
  });

  it('loads older worlds without inventing ruins or displaced residents', () => {
    const { world } = household(), old = world.snapshot(); old.version = 28;
    expect(decodeSave(old, world.registry)).toEqual({ ...old, version: SAVE_VERSION });
  });
});
