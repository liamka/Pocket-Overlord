import { describe, expect, it } from 'vitest';
import { RACE_IDS } from '../src/core/races';
import { STEP } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { fragmentFall } from '../src/render/house-collapse';
import { applyEvent, fire, processEvents } from '../src/systems/effects';
import { flatWorld } from './helpers';

describe('destroyed homes', () => {
  it.each(RACE_IDS)('captures the %s home once and immediately releases residents and builders', race => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!;
    house.components.dwelling!.race = race;
    house.components.dwelling!.construction = { progress: 0.5, struckAt: 0 };
    const person = world.spawn('core:person', { x: 22, y: 24 })!;
    person.components.person!.homeId = house.id;
    Object.assign(person.components.citizen!, { task: 'build', targetId: house.id, path: [{ x: 22, y: 24 }] });
    const rng = world.rng.state;
    applyEvent(world, { kind: 'damage', target: house.id, amount: house.components.health!.current - 1 });
    expect(world.visuals).toEqual([]);
    applyEvent(world, { kind: 'damage', target: house.id, amount: 1 });
    applyEvent(world, { kind: 'damage', target: house.id, amount: 1000 });
    expect(world.visuals).toHaveLength(1);
    const visual = world.visuals[0]; expect(visual.kind).toBe('collapse');
    if (visual.kind !== 'collapse') throw new Error('Missing collapse');
    expect(visual.house.components.dwelling).toMatchObject({ race, construction: { progress: 0.5 } });
    house.components.dwelling!.construction!.progress = 1;
    expect(visual.house.components.dwelling!.construction!.progress).toBe(0.5);
    expect(world.houseCount).toBe(0); expect(world.entities.has(house.id)).toBe(false);
    expect(world.canStand({ x: 24, y: 24 }, 1)).toBe(true);
    expect(person.components.person!.homeId).toBe(null);
    expect(person.components.citizen).toMatchObject({ task: 'idle', targetId: null, path: [] });
    expect(world.rng.state).toBe(rng);
    expect(JSON.stringify(world.snapshot())).not.toContain('collapse');
    expect(decodeSave(world.snapshot(), world.registry).entities.some(e => e.id === house.id)).toBe(false);
  });

  it('starts collapse from both burning and blast damage, retaining whether the house was on fire', () => {
    for (const cause of ['fire', 'blast']) {
      const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!;
      if (cause === 'fire') {
        house.components.health!.current = 0.1;
        house.components.thermal!.burning = true;
        fire(world, STEP);
      } else {
        world.events.push({ kind: 'blast', x: 24, y: 24, radius: 9, power: 1000, heat: 0 }); processEvents(world);
      }
      const collapses = world.visuals.filter(v => v.kind === 'collapse');
      expect(collapses).toHaveLength(1); expect(world.houseCount).toBe(0);
      expect(collapses[0].house.components.thermal!.burning).toBe(cause === 'fire');
    }
  });

  it('does not animate administrative removal or destroyed non-houses', () => {
    const world = flatWorld();
    world.remove(world.spawn('core:house', { x: 24, y: 24 })!.id);
    const tree = world.spawn('core:tree', { x: 24, y: 24 })!;
    applyEvent(world, { kind: 'damage', target: tree.id, amount: 10000 });
    expect(world.visuals).toEqual([]);
  });

  it('lands without crossing the ground, rebounds twice with decreasing height and settles', () => {
    const first = fragmentFall(0, 20, 6), impact = first.impact;
    expect(first.height).toBe(20);
    expect(fragmentFall(impact, 20, 6).height).toBeCloseTo(0);
    const speed = Math.sqrt(6 * 6 + 2 * 150 * 20), bounceOne = speed * 0.25 / 150, bounceTwo = speed * 0.09 / 150;
    const high = fragmentFall(impact + bounceOne, 20, 6), low = fragmentFall(impact + bounceOne * 2 + bounceTwo, 20, 6);
    expect(high.height).toBeGreaterThan(low.height); expect(low.height).toBeGreaterThan(0);
    for (let age = 0; age < 3; age += 1 / 60) expect(fragmentFall(age, 20, 6).height).toBeGreaterThanOrEqual(0);
    expect(fragmentFall(3, 20, 6)).toMatchObject({ height: 0, settled: true });
    expect(fragmentFall(5, 20, 6).travel - fragmentFall(3, 20, 6).travel).toBeLessThan(0.00001);
  });
});
