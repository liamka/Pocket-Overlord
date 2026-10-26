import { describe, expect, it } from 'vitest';
import { HAMMER_CONTACT, initialResidentAnimation, residentAction } from '../src/core/resident-animation';
import { RACES, RACE_IDS, type RaceId } from '../src/core/races';
import { SAVE_VERSION, STEP, Terrain } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { assignConstruction, construction, startConstruction } from '../src/systems/construction';
import { movement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { applyEvent } from '../src/systems/effects';
import { migrations } from '../src/systems/migration';
import { advance, flatWorld, pioneerWorld } from './helpers';
import { deposit } from '../src/core/resource-ledger';
import { initializeStorage } from '../src/core/stockpiles';

function site(race: RaceId = 'human', distance = 1.8) {
  const world = flatWorld(), worker = world.spawn(RACES[race].entityId, { x: 24 - distance, y: 24 })!;
  Object.assign(worker.components.person!, { sex: 'b', buildIn: 10000, reproduceIn: 10000 });
  const house = startConstruction(world, { x: 24, y: 24 }, worker)!;
  const village = assignHouse(world, house);
  worker.components.person!.homeId = house.id; worker.components.citizen!.villageId = village.id;
  initializeStorage(world, village); deposit(village, { wood: 4 }); assignConstruction(world, worker);
  return { world, worker, house };
}

describe('resident movement and builders', () => {
  it('advances feet with actual travel and plants them when blocked or standing', () => {
    const world = flatWorld(), person = world.spawn('core:person', { x: 20, y: 20 })!;
    Object.assign(person.components.motion!, { heading: 0, decisionIn: 100 });
    movement(world, STEP);
    expect(person.components.person!.animation!.stride).toBeGreaterThan(0);
    expect(person.components.person!.animation!.moving).toBeGreaterThan(0);
    const phase = person.components.person!.animation!.stride;
    person.components.motion!.speed = 0;
    for (let i = 0; i < 30; i++) movement(world, STEP);
    expect(person.components.person!.animation!.stride).toBe(phase);
    expect(person.components.person!.animation!.moving).toBe(0);
    expect(residentAction(world, person)).toBe('idle');
    const p = person.components.position!;
    world.spawn('core:house', { x: p.x + 1.3, y: p.y });
    Object.assign(person.components.motion!, { speed: 1.7, heading: 0, decisionIn: 100 });
    movement(world, STEP);
    expect(person.components.person!.animation!.stride).toBe(phase);
  });

  it.each(RACE_IDS)('%s approaches with materials and finishes its own house by working beside it', race => {
    const { world, worker, house } = site(race, 6);
    worker.components.motion!.speed = 0;
    advance(world, 2);
    expect(house.components.building!.project!.progress).toBe(0);
    worker.components.motion!.speed = RACES[race].speed;
    advance(world, 0.3);
    expect(residentAction(world, worker)).toBe('carry');
    const phases = new Set<number>(); let hits = 0, previous = 0;
    for (let i = 0; i < 900 && house.components.building!.project; i++) {
      world.step();
      const progress = house.components.building!.project?.progress ?? 1;
      if (progress > previous) {
        hits++; phases.add(Math.floor(progress * 4));
        expect(Math.hypot(worker.components.position!.x - 24, worker.components.position!.y - 24)).toBeLessThanOrEqual(2.1);
        expect(progress - previous).toBeCloseTo(1 / 12);
      }
      previous = progress;
    }
    expect(hits).toBe(12); expect(phases.size).toBeGreaterThanOrEqual(4);
    expect(house.components.building!.project).toBeUndefined();
    expect(worker.components.citizen!.task).not.toBe('build');
    expect(house.components.dwelling!.race).toBe(race);
    expect(house.components.health!.max).toBe(RACES[race].houseHealth);
  });

  it('adds a course on hammer contact, not while the arm is still lifting', () => {
    const { world, worker, house } = site();
    worker.components.citizen!.path = [];
    worker.components.person!.animation = initialResidentAnimation(0);
    worker.components.person!.animation.work = HAMMER_CONTACT - 0.05;
    construction(world, STEP);
    expect(house.components.building!.project!.progress).toBe(0);
    world.tick++; construction(world, STEP);
    expect(house.components.building!.project!.progress).toBeCloseTo(1 / 12);
    expect(house.components.building!.project!.struckAt).toBe(world.tick);
  });

  it('keeps abandoned progress and lets another adult finish, without creating another house', () => {
    const { world, worker, house } = site();
    advance(world, 2);
    const progress = house.components.building!.project!.progress;
    expect(progress).toBeGreaterThan(0); world.remove(worker.id); advance(world, 2);
    expect(house.components.building!.project!.progress).toBe(progress);
    const replacement = world.spawn('core:person', { x: 20, y: 24 })!;
    replacement.components.person!.buildIn = 10000;
    replacement.components.citizen!.villageId = house.components.dwelling!.villageId;
    expect(assignConstruction(world, replacement)).toBe(true);
    advance(world, 15);
    expect(house.components.building!.project).toBeUndefined(); expect(world.houseCount).toBe(1);
  });

  it('excludes children and unreachable sites, suspends burning work and releases destroyed sites', () => {
    const { world, worker, house } = site();
    const child = world.spawn('core:person', { x: 20, y: 22 })!; child.components.person!.age = 5;
    expect(assignConstruction(world, child)).toBe(false);
    const other = world.spawn('core:person', { x: 30, y: 24 })!;
    for (let y = 0; y < 48; y++) world.terrain.set(27, y, Terrain.Water);
    expect(assignConstruction(world, other)).toBe(false);
    advance(world, 1); const progress = house.components.building!.project!.progress;
    applyEvent(world, { kind: 'heat', target: house.id, amount: 80 });
    advance(world, 0.5);
    expect(house.components.building!.project!.progress).toBe(progress);
    expect(worker.components.citizen!.task).not.toBe('build');
    world.remove(house.id);
    expect(worker.components.person!.homeId).toBeNull(); expect(worker.components.citizen!.targetId).not.toBe(house.id);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('preserves a mid-swing save, remains deterministic and freezes completely on pause', () => {
    const { world, worker } = site(); advance(world, 2.1);
    expect(worker.components.person!.animation!.work).toBeGreaterThan(0);
    const data = decodeSave(world.snapshot(), world.registry), copy = new World(world.seed, world.registry, data);
    advance(world, 12); advance(copy, 12); expect(copy.snapshot()).toEqual(world.snapshot());
    world.paused = true; const frozen = world.snapshot(); advance(world, 3); expect(world.snapshot()).toEqual(frozen);
    for (const patch of [{ moving: 2 }, { work: NaN }, { heading: Infinity }]) {
      const invalid = structuredClone(data); Object.assign(invalid.entities.find(e => e.components.person)!.components.person!.animation!, patch);
      expect(() => decodeSave(invalid, world.registry)).toThrow();
    }
    const invalid = structuredClone(data); invalid.entities.find(e => e.components.dwelling)!.components.building!.project!.progress = 2;
    expect(() => decodeSave(invalid, world.registry)).toThrow();
  });

  it('loads older complete houses and residents without starting construction or changing their world', () => {
    const world = flatWorld(); world.spawn('core:house', { x: 24, y: 24 }); world.spawn('core:person', { x: 20, y: 24 });
    const old = world.snapshot(); old.version = 23;
    const migrated = decodeSave(old, world.registry);
    expect(migrated).toEqual({ ...old, version: SAVE_VERSION });
    expect(migrated.entities.find(e => e.components.dwelling)!.components.building!.project).toBeUndefined();
  });

  it('gives arriving pioneers a real building site that their adults finish', () => {
    const world = pioneerWorld(); world.tick = 150; migrations(world);
    const group = world.society.migrations[0];
    for (const [index, id] of group.members.entries()) {
      const member = world.entities.get(id)!;
      Object.assign(member.components.position!, { x: group.destination.x + (index % 2 ? 2 : -2), y: group.destination.y + (index < 2 ? 2 : -2) });
      world.spatial.update(member);
    }
    migrations(world);
    const house = [...world.query('dwelling')].find(e => e.components.building!.project)!;
    expect(house).toBeDefined(); expect(house.components.building!.project!.progress).toBe(0);
    expect(world.society.migrations).toHaveLength(0);
    advance(world, 18);
    expect(house.components.building!.project).toBeUndefined();
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
});
