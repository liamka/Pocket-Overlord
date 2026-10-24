import { describe, expect, it } from 'vitest';
import { SHIP_ID, HARBOR_ID, angleDelta, canSail, clearSeaSegment, distance, harborBerth, harborSite, seaRoute } from '../src/core/seafaring';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent, water } from '../src/systems/effects';
import { assignHouse } from '../src/systems/society';
import { buildHarbor, seafaring } from '../src/systems/seafaring';
import { flatWorld } from './helpers';

function seaWorld(): World {
  const world = flatWorld();
  for (let y = 0; y < 48; y++) for (let x = 9; x < 39; x++) world.terrain.set(x, y, Terrain.Water);
  return world;
}
function tick(world: World, seconds: number, check?: () => void): void {
  for (let i = 0; i < Math.round(seconds / STEP); i++) { world.tick++; seafaring(world, STEP); check?.(); }
}
function ports(world: World) {
  const first = assignHouse(world, world.spawn('core:house', { x: 4.5, y: 12.5 })!);
  const second = assignHouse(world, world.spawn('core:house', { x: 43.5, y: 34.5 })!);
  const a = buildHarbor(world, { x: 8.5, y: 12.5 }, first.id)!;
  const b = buildHarbor(world, { x: 39.5, y: 34.5 }, second.id)!;
  for (const port of [a, b]) Object.assign(port.components.harbor!, { built: 1, launchIn: 60 });
  return { a, b, first, second };
}
function launch(world: World, port: Entity, kind: 'fishing' | 'trade' = 'fishing'): Entity {
  const ship = world.spawn(SHIP_ID, harborBerth(port))!;
  Object.assign(ship.components.ship!, { homeId: port.id, kind, heading: 0, phase: 'docked', wait: 0 });
  return ship;
}

describe('harbors and ships', () => {
  it('places harbors only on usable coasts and ships only where the whole hull fits', () => {
    const world = seaWorld();
    expect(world.command({ kind: 'use-tool', toolId: HARBOR_ID, x: 3, y: 22 })).toContain('coast');
    expect(world.command({ kind: 'use-tool', toolId: HARBOR_ID, x: 8, y: 22 })).toBeUndefined();
    const harbor = [...world.query('harbor')][0];
    expect(harbor.components.harbor!.direction).toBe(0);
    expect(harborSite(world, { x: 8.5, y: 23.5 })).toBeUndefined();
    for (const p of [{ x: 4, y: 20 }, { x: 10, y: 20 }, { x: 24, y: 0.5 }]) {
      expect(world.command({ kind: 'use-tool', toolId: SHIP_ID, ...p })).toContain('water');
    }
    expect(world.command({ kind: 'use-tool', toolId: SHIP_ID, x: 24, y: 24 })).toBeUndefined();
    expect([...world.query('ship')]).toHaveLength(1);
    expect(world.population).toBe(0);
  });

  it('builds a coastal village harbor, completes the pier and launches its fishing boat', () => {
    const world = seaWorld(), house = world.spawn('core:house', { x: 4.5, y: 24.5 })!, town = assignHouse(world, house);
    for (let i = 0; i < 3; i++) {
      const person = world.spawn('core:person', { x: 3.5 + i, y: 27.5 })!;
      person.components.person!.age = 25; person.components.citizen!.villageId = town.id;
    }
    world.tick = 449; tick(world, STEP);
    const port = [...world.query('harbor')][0];
    expect(port).toBeDefined(); expect(port.components.harbor!.villageId).toBe(town.id);
    expect(port.components.harbor!.built).toBe(0);
    tick(world, 8.1);
    expect(port.components.harbor!.built).toBe(1);
    const fleet = [...world.query('ship')];
    expect(fleet).toHaveLength(1); expect(fleet[0].components.ship!.homeId).toBe(port.id);
    tick(world, 5); expect(fleet[0].components.ship!.phase).toBe('sailing');
    expect(distance(fleet[0].components.position!, harborBerth(port))).toBeGreaterThan(1);
  });

  it('routes around an island and rejects land barriers and narrow channels', () => {
    const world = seaWorld(), start = { x: 14, y: 12.5 }, end = { x: 34, y: 12.5 };
    for (let y = 5; y <= 27; y++) for (let x = 22; x <= 26; x++) world.terrain.set(x, y, Terrain.Grass);
    const route = seaRoute(world, start, end)!;
    expect(route.length).toBeGreaterThan(1);
    for (let n = 0; n < route.length; n++) expect(clearSeaSegment(world, n ? route[n - 1] : start, route[n])).toBe(true);
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Mountain);
    expect(seaRoute(world, start, end)).toBeUndefined();
    world.terrain.set(24, 20, Terrain.Water); world.terrain.set(24, 21, Terrain.Water);
    expect(seaRoute(world, start, end)).toBeUndefined();
  });

  it('sails a detour without touching land, accelerates and turns continuously, then docks and delivers real cargo', () => {
    const world = seaWorld(), { a, b, first, second } = ports(world);
    first.food = 100; second.food = 0;
    for (let y = 20; y <= 27; y++) for (let x = 22; x <= 26; x++) world.terrain.set(x, y, Terrain.Grass);
    const ship = launch(world, a, 'trade'), state = ship.components.ship!;
    tick(world, STEP);
    expect(state.targetId).toBe(b.id); expect(state.cargo).toBe(24);
    expect(first.food).toBe(76); expect(second.food).toBe(0);
    let previous = { ...ship.components.position! }, heading = state.heading, speed = state.speed, arrived = false;
    for (let i = 0; i < 2400 && !arrived; i++) {
      tick(world, STEP);
      const p = ship.components.position!;
      expect(canSail(world, p)).toBe(true);
      expect(distance(p, previous)).toBeLessThanOrEqual(2.5 * STEP + 1e-8);
      expect(Math.abs(angleDelta(state.heading, heading))).toBeLessThanOrEqual(2.5 * STEP + 1e-8);
      expect(state.speed - speed).toBeLessThanOrEqual(0.8 * STEP + 1e-8);
      previous = { ...p }; heading = state.heading; speed = state.speed;
      arrived = second.food > 0;
    }
    expect(arrived, JSON.stringify({ position: ship.components.position, state })).toBe(true);
    expect(second.food).toBe(24); expect(state.cargo).toBe(0); expect(state.phase).toBe('docked');
    expect(distance(ship.components.position!, harborBerth(b))).toBeLessThan(0.1);
    expect(first.food + second.food).toBe(100);
  });

  it('catches fish offshore and credits food only after returning to its harbor', () => {
    const world = seaWorld(), { a, b, first } = ports(world); world.remove(b.id);
    const ship = launch(world, a); first.food = 0;
    let caught = false;
    for (let i = 0; i < 3000 && first.food === 0; i++) {
      tick(world, STEP);
      if (ship.components.ship!.phase === 'returning') {
        caught = true; expect(ship.components.ship!.cargo).toBeGreaterThan(0); expect(first.food).toBe(0);
      }
    }
    expect(caught).toBe(true); expect(first.food).toBeGreaterThan(0);
    expect(ship.components.ship!.phase).toBe('docked'); expect(first.harvested).toBe(first.food);
    expect(ship.components.ship!.cargo).toBe(0);
  });

  it('waits clear of an occupied berth, then lets the departing ship pass before unloading', () => {
    const world = seaWorld(), { a, b, first } = ports(world);
    world.remove(b.id); a.components.harbor!.launchIn = 60; first.food = 0;
    const berth = harborBerth(a), docked = launch(world, a);
    docked.components.ship!.wait = 30;
    const incoming = world.spawn(SHIP_ID, { x: berth.x + 12, y: berth.y })!;
    Object.assign(incoming.components.ship!, { homeId: a.id, targetId: a.id, phase: 'returning',
      heading: Math.PI, speed: 2.1, cargo: 8, path: [berth] });
    const separated = () => expect(distance(docked.components.position!, incoming.components.position!)).toBeGreaterThanOrEqual(5.2);
    tick(world, 15, separated);
    expect(incoming.components.ship!.speed).toBe(0);
    expect(incoming.components.ship!.cargo).toBe(8); expect(first.food).toBe(0);
    const waiting = { ...incoming.components.position! };
    tick(world, 2, separated);
    expect(incoming.components.position).toEqual(waiting);
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    // Leave straight toward the waiting ship to exercise the departure lane.
    for (const instance of [world, loaded]) Object.assign(instance.entities.get(docked.id)!.components.ship!, {
      phase: 'sailing', wait: 0, heading: 0, path: [{ x: berth.x + 20, y: berth.y }], next: 0 });
    for (let i = 0; i < 1200 && first.food === 0; i++) { tick(world, STEP, separated); tick(loaded, STEP); }
    expect(first.food).toBe(8); expect(incoming.components.ship!.phase).toBe('docked');
    expect(distance(incoming.components.position!, berth)).toBeLessThan(0.1);
    expect(loaded.snapshot()).toEqual(world.snapshot());
  });

  it.each(['same route', 'opposite sides'])('admits arrivals from %s one at a time and keeps them separated', approach => {
    const world = seaWorld(), { a, b, first } = ports(world);
    world.remove(b.id); first.food = 0;
    const berth = harborBerth(a);
    const starts = approach === 'same route'
      ? [8, 14, 20].map(offset => ({ x: berth.x + offset, y: berth.y }))
      : [{ x: berth.x + 8, y: berth.y }, { x: berth.x, y: berth.y - 8 }, { x: berth.x, y: berth.y + 8 }];
    const fleet = starts.map((start, i) => {
      const ship = world.spawn(SHIP_ID, start)!;
      Object.assign(ship.components.ship!, { homeId: a.id, targetId: a.id, phase: 'returning',
        heading: Math.atan2(berth.y - start.y, berth.x - start.x), speed: 2.1, cargo: 4 + i, path: [berth] });
      return ship;
    });
    const arrivals: number[] = [];
    for (let i = 0; i < 1800 && arrivals.length < fleet.length; i++) {
      tick(world, STEP);
      for (let j = 0; j < fleet.length; j++) {
        if (!world.entities.has(fleet[j].id)) continue;
        for (let k = j + 1; k < fleet.length; k++) {
          if (!world.entities.has(fleet[k].id)) continue;
          expect(distance(fleet[j].components.position!, fleet[k].components.position!)).toBeGreaterThanOrEqual(5.2);
        }
        if (fleet[j].components.ship!.cargo === 0 && !arrivals.includes(fleet[j].id)) {
          arrivals.push(fleet[j].id);
          world.remove(fleet[j].id);
        }
      }
    }
    expect(arrivals).toEqual(fleet.map(ship => ship.id));
    expect(first.food).toBe(15);
  });

  it('returns undelivered cargo after war or harbor destruction without teleporting', () => {
    for (const destroy of [false, true]) {
      const world = seaWorld(), { a, b, first, second } = ports(world);
      first.food = 100; second.food = 0;
      const ship = launch(world, a, 'trade'); tick(world, 5);
      const before = { ...ship.components.position! };
      if (destroy) world.remove(b.id); else world.society.relations[0].status = 'war';
      tick(world, STEP);
      expect(ship.components.ship!.phase).toBe('returning');
      expect(distance(before, ship.components.position!)).toBeLessThan(0.1);
      for (let i = 0; i < 1800 && first.food < 100; i++) tick(world, STEP);
      expect(first.food).toBe(100); expect(second.food).toBe(0);
    }
  });

  it('stops safely when terrain blocks its route and handles a destroyed home', () => {
    const world = seaWorld(), { a, b } = ports(world), ship = launch(world, a, 'trade');
    tick(world, 3);
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Mountain);
    tick(world, 12, () => expect(canSail(world, ship.components.position!)).toBe(true));
    expect(ship.components.position!.x).toBeLessThan(24);
    world.remove(a.id); world.remove(b.id); tick(world, 1);
    expect(ship.components.ship!.homeId).toBeNull(); expect(ship.components.ship!.targetId).toBeNull();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('preserves voyages, sail deployment and curved wakes across save/load and pause', () => {
    const world = seaWorld(), { a } = ports(world), ship = launch(world, a, 'trade'); tick(world, 5);
    expect(ship.components.ship!.wake.length).toBeGreaterThan(2);
    const save = decodeSave(world.snapshot(), world.registry), loaded = new World(world.seed, world.registry, save);
    tick(world, 12); tick(loaded, 12);
    expect(loaded.snapshot()).toEqual(world.snapshot());
    world.paused = true; const paused = world.snapshot();
    for (let i = 0; i < 10; i++) world.step();
    expect(world.snapshot()).toEqual(paused);
    const malformed = structuredClone(save);
    malformed.entities.find(e => e.components.ship)!.components.ship!.speed = NaN;
    expect(() => decodeSave(malformed, world.registry)).toThrow();
  });

  it('floats without drowning, can burn above water, and is removed by destructive damage', () => {
    const world = seaWorld(), ship = world.spawn(SHIP_ID, { x: 24, y: 24 })!;
    applyEvent(world, { kind: 'heat', target: ship.id, amount: 100 });
    water(world, 1);
    expect(ship.components.thermal!.burning).toBe(true);
    expect(ship.components.health!.current).toBe(180);
    applyEvent(world, { kind: 'damage', target: ship.id, amount: 1000 });
    expect(world.entities.has(ship.id)).toBe(false);
  });
});
