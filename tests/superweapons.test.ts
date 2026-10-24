import { beforeAll, describe, expect, it } from 'vitest';
import { createRegistry } from '../src/content/defaults';
import { HAMMER, TSAR, superweaponStrikes } from '../src/content/superweapons';
import { World } from '../src/core/world';
import { FixedClock } from '../src/core/clock';
import { Terrain, type WorldSnapshot } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld } from './helpers';
import { SEA_WAVES, seaWaveShape, seaWaves } from '../src/systems/effects';

const registry = createRegistry();
let empty: WorldSnapshot;
beforeAll(() => {
  empty = flatWorld(registry).snapshot();
  empty.terrain = { width: 128, height: 128, tiles: Array(128 * 128).fill(Terrain.Grass), moisture: Array(128 * 128).fill(0), recovery: [] };
});
const fresh = () => new World(empty.seed, registry, empty);
const use = (world: World, toolId: string, x = 64, y = 64) => world.command({ kind: 'use-tool', toolId, x, y });

function coastalWorld(): World {
  const world = fresh();
  for (let y = 0; y < 128; y++) for (let x = 0; x < 90; x++) world.terrain.set(x, y, Terrain.Water);
  return world;
}

describe('sea waves and tsunamis', () => {
  it.each(['core:dynamite', 'core:rocket', 'core:napalm', TSAR.id])('%s creates waves only when its explosion hits water', id => {
    for (const wet of [false, true]) {
      const world = fresh(); if (wet) world.terrain.tiles.fill(Terrain.Water);
      use(world, id); advance(world, 3.6);
      if (wet) {
        expect(seaWaves(world).length).toBeGreaterThan(0);
        expect(seaWaves(world).every(wave => seaWaveShape(wave.blastRadius).tsunami === (id === TSAR.id))).toBe(true);
      } else expect(seaWaves(world)).toHaveLength(0);
      expect(() => decodeSave(world.snapshot(), registry)).not.toThrow();
      advance(world, 20); expect(seaWaves(world)).toHaveLength(0);
    }
  });

  it('lets small waves wet the beach without destroying buildings or passing inland', () => {
    const world = coastalWorld(), beach = world.spawn('core:tree', { x: 90.25, y: 64 })!;
    const inland = world.spawn('core:house', { x: 93, y: 64 })!;
    use(world, 'core:rocket', 84, 64); advance(world, 3);
    expect(beach.components.thermal!.wetness).toBeGreaterThan(0.8);
    expect(beach.components.health!.current).toBe(80);
    expect(inland.components.thermal!.wetness).toBe(0);
    expect(inland.components.health!.current).toBe(180);
    expect(world.terrain.at(90, 64)).toBe(Terrain.Grass);
  });

  it('hits the coast after travelling across the sea, pushes people and stops farther inland', () => {
    const world = coastalWorld(), original = [...world.terrain.tiles];
    const tree = world.spawn('core:tree', { x: 90.5, y: 58 })!, house = world.spawn('core:house', { x: 92, y: 64 })!;
    const inland = world.spawn('core:house', { x: 102, y: 64 })!, person = world.spawn('core:person', { x: 91, y: 75 })!;
    person.components.health = { current: 1000, max: 1000 }; person.components.motion!.speed = 0;
    person.components.person!.buildIn = 100000; person.components.person!.reproduceIn = 100000;
    use(world, TSAR.id, 20, 64); advance(world, 5.5);
    expect(tree.components.health!.current).toBe(80); expect(house.components.health!.current).toBe(180);
    expect(person.components.position!.x).toBe(91);
    advance(world, 3.5);
    expect(world.entities.has(tree.id)).toBe(false); expect(world.entities.has(house.id)).toBe(false);
    expect(person.components.health!.current).toBeLessThan(1000); expect(person.components.position!.x).toBeGreaterThan(92);
    expect(inland.components.health!.current).toBe(180); expect(inland.components.thermal!.wetness).toBe(0);
    expect(world.terrain.tiles).toEqual(original);
  });

  it.each([Terrain.Mountain, Terrain.Sand])('does not cross a blocking island or mountain ridge (%s)', barrier => {
    const world = coastalWorld();
    for (let y = 0; y < 128; y++) for (let x = 80; x < 84; x++) world.terrain.set(x, y, barrier);
    const protectedHouse = world.spawn('core:house', { x: 92, y: 64 })!;
    use(world, TSAR.id, 20, 64); advance(world, 14);
    expect(protectedHouse.components.health!.current).toBe(180);
    expect(protectedHouse.components.thermal!.wetness).toBe(0);
  });

  it('saves each arriving crest without repeating its damage after pause or reload', () => {
    const world = coastalWorld(), house = world.spawn('core:house', { x: 90.5, y: 64 })!;
    house.components.health = { current: 1000, max: 1000 };
    use(world, TSAR.id, 20, 64); advance(world, 6.3);
    const health = house.components.health!.current; expect(health).toBeLessThan(1000);
    world.paused = true; const saved = world.snapshot(); advance(world, 2); expect(world.snapshot()).toEqual(saved);
    const restored = new World(world.seed, registry, decodeSave(JSON.parse(JSON.stringify(saved)), registry));
    world.paused = restored.paused = false; advance(world, 0.2); advance(restored, 0.2);
    expect(house.components.health!.current).toBe(health); expect(restored.snapshot()).toEqual(world.snapshot());
    advance(world, 3); advance(restored, 3);
    expect(house.components.health!.current).toBeLessThan(health); expect(restored.snapshot()).toEqual(world.snapshot());
    advance(world, 12); expect(world.scenarios).toHaveLength(0);
  });

  it('rejects corrupt wave paths and hit records while accepting older worlds without waves', () => {
    const world = coastalWorld(); expect(decodeSave(world.snapshot(), registry)).toEqual(world.snapshot());
    use(world, TSAR.id, 20, 64); advance(world, 1);
    const wave = seaWaves(world)[0];
    for (const invalid of [{ elapsed: -1 }, { blastRadius: 0 }, { reach: [] }, { shore: Array(SEA_WAVES.rays).fill(-1) },
      { hit: [',1,,1,', '', ''] }, { hit: [',NaN,', '', ''] }, { reach: Array(SEA_WAVES.rays).fill(161) }]) {
      const saved = world.snapshot(); saved.scenarios.find(scenario => scenario.id === SEA_WAVES.id)!.state = { waves: [{ ...wave, ...invalid }] };
      expect(() => decodeSave(saved, registry)).toThrow();
    }
  });
});

describe('Hammer of Dawn', () => {
  it('smoothly follows the aim point and burns a continuous trail instead of teleporting damage', () => {
    const world = fresh(), start = { x: 32, y: 64 };
    const along = world.spawn('core:tree', { x: 44, y: 64 })!, outside = world.spawn('core:tree', { x: 44, y: 73 })!;
    use(world, HAMMER.id, start.x, start.y); advance(world, 0.7);
    const strike = superweaponStrikes(world, HAMMER.id)[0];
    world.command({ kind: 'aim-tool', toolId: HAMMER.id, x: 88, y: 64 });
    expect(strike.x).toBe(start.x); expect(world.entities.has(along.id)).toBe(true);
    world.step(); expect(strike.x).toBeGreaterThan(start.x); expect(strike.x).toBeLessThan(33);
    advance(world, 1);
    expect(strike.x).toBeGreaterThan(42); expect(strike.x).toBeLessThan(43);
    expect(world.entities.has(along.id)).toBe(false); expect(outside.components.health!.current).toBe(80);
    for (let x = 33; x < 42; x++) expect(world.terrain.at(x, 64)).toBe(Terrain.Crater);
    const turn = { x: strike.x, y: strike.y };
    world.command({ kind: 'aim-tool', toolId: HAMMER.id, x: turn.x, y: 40 }); advance(world, 0.5);
    expect(strike.x).toBeCloseTo(turn.x); expect(strike.y).toBeCloseTo(turn.y - 5);
    expect(superweaponStrikes(world, HAMMER.id)).toHaveLength(1);
    advance(world, 2);
    const stopped = { x: strike.x, y: strike.y };
    world.command({ kind: 'aim-tool', toolId: HAMMER.id, x: 90, y: 90 }); advance(world, 0.1);
    expect(strike).toMatchObject(stopped);
  });

  it('preserves a moving beam and its destination across pause and reload', () => {
    const world = fresh(); use(world, HAMMER.id, 32, 64);
    world.command({ kind: 'aim-tool', toolId: HAMMER.id, x: 80, y: 48 }); advance(world, 1);
    const strike = superweaponStrikes(world, HAMMER.id)[0];
    world.paused = true;
    const snapshot = world.snapshot(); advance(world, 1); expect(world.snapshot()).toEqual(snapshot);
    const restored = new World(world.seed, registry, decodeSave(JSON.parse(JSON.stringify(snapshot)), registry));
    expect(superweaponStrikes(restored, HAMMER.id)[0]).toEqual(strike);
    world.paused = restored.paused = false; advance(world, 0.6); advance(restored, 0.6);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(superweaponStrikes(restored, HAMMER.id)[0].x).toBeGreaterThan(47);
    expect(superweaponStrikes(restored, HAMMER.id)[0].x).toBeLessThan(48);
  });

  it('ignores invalid aim commands and rejects corrupt saved destinations', () => {
    const world = fresh(), untouched = world.snapshot();
    world.command({ kind: 'aim-tool', toolId: HAMMER.id, x: 40, y: 40 }); expect(world.snapshot()).toEqual(untouched);
    use(world, HAMMER.id);
    const snapshot = world.snapshot();
    for (const x of [NaN, -1, 128, Infinity]) world.command({ kind: 'aim-tool', toolId: HAMMER.id, x, y: 64 });
    expect(world.snapshot()).toEqual(snapshot);
    for (const targetX of [undefined, NaN, -1, 600]) {
      const invalid = { ...world.snapshot(), scenarios: [{ id: HAMMER.id, state: { strikes: [{ ...superweaponStrikes(world, HAMMER.id)[0], targetX }] } }] };
      expect(() => decodeSave(invalid, registry)).toThrow();
    }
  });

  it('migrates a stationary v16 beam without replaying its previous damage pulses', () => {
    const world = fresh(); use(world, HAMMER.id); use(world, TSAR.id, 90, 90); advance(world, 1);
    const old = world.snapshot(); old.version = 16;
    old.scenarios.find(scenario => scenario.id === HAMMER.id)!.state = {
      strikes: superweaponStrikes(world, HAMMER.id).map(({ targetX: _x, targetY: _y, ...strike }) => strike),
    };
    const restored = new World(world.seed, registry, decodeSave(old, registry));
    expect(restored.snapshot()).toEqual(world.snapshot());
    advance(world, 0.5); advance(restored, 0.5); expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('charges, continuously damages the target, burns terrain and leaves objects outside its radius intact', () => {
    const world = fresh(), house = world.spawn('core:house', { x: 64, y: 64 })!;
    const outside = world.spawn('core:tree', { x: 71, y: 64 })!;
    use(world, HAMMER.id); advance(world, 0.5);
    expect(house.components.health!.current).toBe(180); expect(world.terrain.at(64, 64)).toBe(Terrain.Grass);
    advance(world, 0.1);
    expect(house.components.health!.current).toBeLessThan(180);
    expect(house.components.thermal!.burning).toBe(true); expect(world.terrain.at(64, 64)).toBe(Terrain.Crater);
    advance(world, 0.2); expect(world.entities.has(house.id)).toBe(false);
    const newcomer = world.spawn('core:tree', { x: 65, y: 64 })!;
    advance(world, 0.2); expect(world.entities.has(newcomer.id)).toBe(false);
    expect(outside.components.health!.current).toBe(80); expect(outside.components.thermal!.burning).toBe(false);
    advance(world, 4); expect(superweaponStrikes(world, HAMMER.id)).toHaveLength(0);
    const survivor = world.spawn('core:tree', { x: 64, y: 64 })!;
    advance(world, 1); expect(survivor.components.health!.current).toBe(80);
  });
});

describe('Tsar Bomba 100MT', () => {
  it('detonates once after falling, creates a large crater and destroys objects within the blast boundary', () => {
    const world = fresh(), center = world.spawn('core:house', { x: 64, y: 64 })!;
    const edge = world.spawn('core:tree', { x: 115, y: 64 })!, outside = world.spawn('core:tree', { x: 117, y: 64 })!;
    use(world, TSAR.id); advance(world, 0.8);
    expect(world.entities.has(center.id)).toBe(true); expect(world.terrain.at(64, 64)).toBe(Terrain.Grass);
    advance(world, 0.1);
    expect(world.entities.has(center.id)).toBe(false); expect(world.entities.has(edge.id)).toBe(false);
    expect(outside.components.health!.current).toBe(80);
    expect(world.terrain.at(64, 64)).toBe(Terrain.Crater);
    expect(world.terrain.at(64, 102)).toBe(Terrain.Scorched); expect(world.terrain.at(64, 105)).toBe(Terrain.Grass);
    const survivor = world.spawn('core:tree', { x: 64, y: 94 })!;
    const restored = new World(world.seed, registry, decodeSave(world.snapshot(), registry));
    advance(world, 2); advance(restored, 2);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(survivor.components.health!.current).toBe(80);
  });

  it('leaves temporary fallout that damages new arrivals only inside the contaminated area', () => {
    const world = fresh(); use(world, TSAR.id); advance(world, 1);
    const inside = world.spawn('core:tree', { x: 64, y: 84 })!, outside = world.spawn('core:tree', { x: 64, y: 88 })!;
    world.addRain({ x: 64, y: 84 }, 3.5, 1);
    advance(world, 1);
    expect(inside.components.health!.current).toBeLessThan(80); expect(outside.components.health!.current).toBe(80);
    advance(world, 19); expect(world.scenarios).toHaveLength(0);
    const survivor = world.spawn('core:tree', { x: 64, y: 84 })!;
    advance(world, 1); expect(survivor.components.health!.current).toBe(80);
  });
});

describe('saved superweapon scenarios', () => {
  it.each([0, 0.8, 1.3, 4, 10])('freezes overlapping attacks and restores their exact continuation at %s seconds', seconds => {
    const world = fresh(); use(world, HAMMER.id, 32, 64); use(world, TSAR.id, 90, 64); advance(world, seconds);
    world.paused = true;
    const snapshot = world.snapshot(); advance(world, 1); expect(world.snapshot()).toEqual(snapshot);
    const restored = new World(world.seed, registry, decodeSave(JSON.parse(JSON.stringify(snapshot)), registry));
    expect(restored.snapshot()).toEqual(snapshot);
    world.paused = restored.paused = false; advance(world, 1); advance(restored, 1);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it.each([HAMMER.id, TSAR.id])('%s respects simulation speed, map edges and water', id => {
    for (const speed of [0.2, 2] as const) {
      const world = fresh(), clock = new FixedClock(() => 0);
      use(world, id);
      for (let now = 0; now <= 2000; now += 50) clock.advance(now, true, () => world.step(), speed);
      expect(world.terrain.at(64, 64)).toBe(speed === 0.2 ? Terrain.Grass : Terrain.Crater);
    }
    const world = fresh(); world.terrain.tiles.fill(Terrain.Water);
    use(world, id, 0, 0); use(world, id, 127.9, 127.9); advance(world, 2);
    expect(() => decodeSave(world.snapshot(), registry)).not.toThrow();
    expect(world.terrain.tiles.every(tile => tile === Terrain.Water)).toBe(true);
    advance(world, 20); expect(world.scenarios).toHaveLength(0);
  });

  it('rejects malformed timelines and keeps older worlds unchanged', () => {
    const world = fresh(); expect(decodeSave(world.snapshot(), registry)).toEqual(world.snapshot());
    for (const id of [HAMMER.id, TSAR.id] as const) {
      use(world, id);
      const strike = superweaponStrikes(world, id)[0];
      for (const invalid of [{ elapsed: -1 }, { elapsed: 100 }, { next: 1 }, { seed: NaN }, { x: -1 }]) {
        const snapshot = world.snapshot(); snapshot.scenarios.find(scenario => scenario.id === id)!.state = { strikes: [{ ...strike, ...invalid }] };
        expect(() => decodeSave(snapshot, registry)).toThrow();
      }
    }
  });
});
