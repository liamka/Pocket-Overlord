import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { FixedClock } from '../src/core/clock';
import { Terrain } from '../src/core/types';
import { NAPALM, NAPALM_END, NAPALM_LAST_DROP, napalmPlanePosition, napalmBombPose, napalmStrikes } from '../src/content/napalm';
import { flightPoint } from '../src/core/flight';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld } from './helpers';

function strikeWorld(): World {
  const source = flatWorld(), data = source.snapshot();
  data.terrain = { width: 128, height: 64, tiles: Array(128 * 64).fill(Terrain.Grass), moisture: Array(128 * 64).fill(0), recovery: [] };
  return new World(data.seed, source.registry, data);
}
const useNapalm = (world: World, x = 64, y = 32) => world.command({ kind: 'use-tool', toolId: 'core:napalm', x, y });
const fires = (world: World) => [...world.entities.values()].filter(entity => entity.typeId === 'core:napalm-fire');
const blasts = (world: World) => world.visuals.filter(event => event.kind === 'blast');

describe('Napalm Airstrike', () => {
  it('sweeps along the flight direction in 15 delayed blasts and leaves burning ground', () => {
    const world = strikeWorld();
    const targets = Array.from({ length: 15 }, (_, i) => world.spawn('core:tree', { x: 64 + (i - 7) * 7 / 3, y: 32 })!);
    const far = world.spawn('core:tree', { x: 64, y: 61 })!;
    expect(useNapalm(world)).toBeUndefined();
    const strike = napalmStrikes(world)[0], heading = strike.heading;
    const along = (x: number, y: number) => (x - 64) * Math.cos(heading) + (y - 32) * Math.sin(heading);
    const across = (x: number, y: number) => -(x - 64) * Math.sin(heading) + (y - 32) * Math.cos(heading);
    expect(blasts(world)).toHaveLength(0);
    advance(world, 1.2);
    expect(blasts(world)).toHaveLength(0);
    expect(fires(world)).toHaveLength(0);
    expect(napalmStrikes(world)[0].bombs).toHaveLength(1);
    advance(world, 0.6);
    expect(blasts(world)).toHaveLength(0);
    advance(world, 2 / 30);
    expect(blasts(world)).toHaveLength(1);
    const first = blasts(world)[0], last = flightPoint(strike, heading, 7 * NAPALM.spacing);
    expect(world.terrain.at(first.x, first.y)).not.toBe(Terrain.Grass);
    expect(world.terrain.at(last.x, last.y)).toBe(Terrain.Grass);
    advance(world, 1.6);
    expect(blasts(world)).toHaveLength(15);
    for (const [i, blast] of blasts(world).entries()) expect(along(blast.x, blast.y)).toBeCloseTo((i - 7) * NAPALM.spacing);
    expect(blasts(world).every(blast => Math.abs(across(blast.x, blast.y)) <= 2 + 1e-9 && blast.radius <= 16 / 3)).toBe(true);
    expect(targets.some(target => !world.entities.has(target.id))).toBe(true);
    expect(far.components.health!.current).toBe(80);
    expect(far.components.thermal!.burning).toBe(false);
    expect(fires(world).length).toBeGreaterThan(0);
    expect(fires(world).every(entity => entity.components.thermal!.burning)).toBe(true);
    expect(napalmStrikes(world)[0].bombs).toHaveLength(0);
    advance(world, 1);
    expect(world.scenarios).toHaveLength(0);
    const damaged = world.terrain.tiles.flatMap((tile, i) => tile === Terrain.Crater || tile === Terrain.Scorched ? [i] : []);
    expect(damaged.every(i => Math.abs(along(i % 128 + 0.5, Math.floor(i / 128) + 0.5)) <= 65 / 3
      && Math.abs(across(i % 128 + 0.5, Math.floor(i / 128) + 0.5)) <= 22 / 3)).toBe(true);
  });

  it('keeps igniting nearby objects after the explosions and expires without leaving invisible fires', () => {
    const world = strikeWorld(); useNapalm(world); advance(world, 3.5);
    const fire = fires(world)[0];
    const tree = world.spawn('core:tree', fire.components.position!)!;
    advance(world, 1);
    expect(tree.components.thermal!.burning).toBe(true);
    world.step();
    expect(tree.components.health!.current).toBeLessThan(80);
    advance(world, 3);
    expect(fires(world)).toHaveLength(0);
  });

  it('lets rain extinguish the ground fire and never leaves fire or land in the sea', () => {
    const world = strikeWorld(); useNapalm(world); advance(world, 3.5);
    const position = { ...fires(world)[0].components.position! };
    world.addRain(position, 3.5, 0.3); advance(world, 0.2);
    expect(fires(world).some(entity => Math.hypot(entity.components.position!.x - position.x, entity.components.position!.y - position.y) <= 3.5)).toBe(false);
    expect(fires(world).length).toBeGreaterThan(0);
    const sea = strikeWorld(); sea.terrain.tiles.fill(Terrain.Water);
    useNapalm(sea); advance(sea, 3.5);
    expect(blasts(sea)).toHaveLength(15);
    expect(fires(sea)).toHaveLength(0);
    expect(sea.terrain.tiles.every(tile => tile === Terrain.Water)).toBe(true);
  });

  it('pauses and restores overlapping strikes and burning ground with deterministic continuation', () => {
    const world = strikeWorld();
    useNapalm(world); advance(world, 1.4); useNapalm(world, 70, 35); advance(world, 0.8);
    expect(napalmStrikes(world)[0].bombs.length).toBeGreaterThan(0);
    expect(fires(world).length).toBeGreaterThan(0);
    world.paused = true;
    const saved = world.snapshot(); advance(world, 1);
    expect(world.snapshot()).toEqual(saved);
    const restored = new World(world.seed, world.registry, decodeSave(JSON.parse(JSON.stringify(saved)), world.registry));
    expect(restored.snapshot()).toEqual(saved);
    world.paused = restored.paused = false;
    advance(world, 0.6); advance(restored, 0.6);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(fires(restored).length).toBeGreaterThan(0);
    advance(world, 7); advance(restored, 7);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(fires(restored)).toHaveLength(0);
    expect(restored.scenarios).toHaveLength(0);
  });

  it('follows the selected game speed through the normal clock', () => {
    for (const speed of [0.2, 2] as const) {
      const world = strikeWorld(), clock = new FixedClock(() => 0);
      useNapalm(world);
      for (let now = 0; now <= 2000; now += 50) clock.advance(now, true, () => world.step(), speed);
      if (speed === 0.2) expect(blasts(world).length).toBeLessThan(15);
      else expect(blasts(world)).toHaveLength(15);
    }
  });

  it.each([[0, 32], [127.9, 32], [64, 0], [64, 63.9]])('clips strikes at the map edge (%s, %s) and keeps saves valid', (x, y) => {
    const world = strikeWorld(); useNapalm(world, x, y);
    for (let i = 0; i < 130; i++) {
      world.step();
      if (i % 10 === 0) expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    }
    expect(blasts(world).length).toBeGreaterThan(0);
    expect(blasts(world).every(blast => world.terrain.inside(blast.x, blast.y))).toBe(true);
    expect(world.scenarios).toHaveLength(0);
  });

  it('rejects damaged saved strike state', () => {
    const world = strikeWorld(); useNapalm(world);
    for (const strike of [{ x: 64, y: 32, next: 16, elapsed: 0, bombs: [] }, { x: 64, y: 32, next: 0, elapsed: -1, bombs: [] },
      { x: NaN, y: 32, next: 0, elapsed: 0, bombs: [] }, { x: 64, y: 32, next: 1, elapsed: 0, bombs: [{ x: 48, y: 32, index: 0 }] }]) {
      const saved = world.snapshot(); saved.scenarios[0].state = { strikes: [{ heading: 0, ...strike }] };
      expect(() => decodeSave(saved, world.registry)).toThrow();
    }
  });

  it('releases canisters beneath the bomber and keeps the aircraft flying until it leaves the map', () => {
    const world = strikeWorld(); useNapalm(world);
    const strike = napalmStrikes(world)[0];
    for (let direction = 0; direction < 8; direction++) {
      const pass = { ...strike, heading: direction * Math.PI / 4 };
      const start = napalmPlanePosition(pass, 128, 64), end = napalmPlanePosition({ ...pass, elapsed: NAPALM_END }, 128, 64);
      expect(world.terrain.inside(start.x, start.y)).toBe(false);
      expect(world.terrain.inside(end.x, end.y)).toBe(false);
      for (let index = 0; index < NAPALM.count; index++) {
        const release = { ...pass, elapsed: NAPALM.approach + index * NAPALM.interval };
        const bomb = { ...flightPoint(pass, pass.heading, (index - 7) * NAPALM.spacing, 1), index };
        const plane = napalmPlanePosition(release, 128, 64), falling = napalmBombPose(release, bomb, 0);
        expect(falling.x).toBeCloseTo(plane.x); expect(falling.y).toBeCloseTo(plane.y - NAPALM.altitude);
        const landing = napalmBombPose(release, bomb, 1);
        expect(landing.x).toBeCloseTo(bomb.x); expect(landing.y).toBeCloseTo(bomb.y);
      }
    }
    advance(world, NAPALM_LAST_DROP + NAPALM.fall + 0.1);
    expect(blasts(world)).toHaveLength(15);
    expect(napalmStrikes(world)).toHaveLength(1);
  });

  it('migrates an older airstrike without replaying impacts that already happened', () => {
    const world = strikeWorld(), old = world.snapshot(); old.version = 14;
    old.scenarios = [{ id: 'core:napalm-strike', state: { strikes: [{ x: 64, y: 32, next: 10, remaining: 0.03 }] } }];
    const restored = new World(world.seed, world.registry, decodeSave(old, world.registry));
    expect(napalmStrikes(restored)[0].next).toBe(10);
    advance(restored, 5);
    expect(blasts(restored)).toHaveLength(5);
    expect(blasts(restored).every(blast => blast.x > 64)).toBe(true);
  });
});
