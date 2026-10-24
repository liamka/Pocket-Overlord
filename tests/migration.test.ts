import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { SAVE_VERSION, Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { migrations, reservedBeds } from '../src/systems/migration';
import { settlement } from '../src/systems/people';
import { declareWar } from '../src/systems/diplomacy';
import { advance, diplomaticWorld, migrationWorld, pioneerWorld } from './helpers';

describe('family migration and pioneering', () => {
  it('moves the same parents and child on foot, reserves housing, and settles on arrival', () => {
    const world = migrationWorld(), people = [...world.query('person')], start = people.map(e => ({ ...e.components.position! }));
    world.tick = 300; migrations(world);
    const group = world.society.migrations[0];
    expect(group.members).toEqual(people.map(e => e.id)); expect(group.toId).toBe(2);
    expect(people.map(e => e.components.position)).toEqual(start);
    expect(people.every(e => e.components.person!.homeId === null && e.components.citizen!.villageId === 1)).toBe(true);
    expect(reservedBeds(world).get(group.homeIds[0])).toBe(3);
    const saved = decodeSave(world.snapshot(), world.registry); expect(saved.society.migrations).toHaveLength(1);
    advance(world, 2); expect(world.society.migrations).toHaveLength(1);
    expect(people.some((e, i) => e.components.position!.x !== start[i].x || e.components.position!.y !== start[i].y)).toBe(true);
    advance(world, 55);
    expect(world.society.migrations).toHaveLength(0);
    expect(world.population).toBe(3);
    expect(people.every(e => e.components.citizen!.villageId === 2 && e.components.person!.homeId === group.homeIds[0])).toBe(true);
    expect(people[2].components.citizen!.parents).toEqual([people[0].id, people[1].id]);
    expect(decodeSave(world.snapshot(), world.registry).society.history.some(e => e.text.includes('Migrants arrived'))).toBe(true);
  });

  it('uses real food for a two-family expedition and only founds the village after travel', () => {
    const world = pioneerWorld(), source = world.society.villages[0];
    world.tick = 150; migrations(world);
    const group = world.society.migrations[0];
    expect(group.toId).toBeNull(); expect(group.members).toHaveLength(4);
    expect(source.food + group.food).toBe(200); expect(world.society.villages).toHaveLength(1);
    expect(source.migrationAfter).toBe(world.tick + 3600);
    expect(Math.hypot(group.destination.x - source.x, group.destination.y - source.y)).toBeGreaterThanOrEqual(24);
    const travelers = group.members.map(id => world.entities.get(id)!);
    advance(world, 55);
    expect(world.society.villages).toHaveLength(2);
    const colony = world.society.villages[1];
    expect(travelers.every(e => e.components.citizen!.villageId === colony.id && e.components.person!.homeId !== null)).toBe(true);
    expect(world.population).toBe(12); expect(colony.food).toBeGreaterThanOrEqual(0);
    expect([...world.query('farm')].some(e => e.components.farm!.villageId === colony.id)).toBe(true);
    expect(world.society.roads.some(r => r.a === source.id && r.b === colony.id)).toBe(true);
    expect(decodeSave(world.snapshot(), world.registry).society.migrations).toHaveLength(0);
  });

  it('does not leave for an inaccessible, occupied or hostile destination', () => {
    for (const kind of ['water', 'housing', 'war'] as const) {
      const world = kind === 'war' ? diplomaticWorld(2) : migrationWorld();
      if (kind === 'water') for (let y = 0; y < 48; y++) world.terrain.set(23, y, Terrain.Water);
      if (kind === 'housing') [...world.query('dwelling')][1].components.dwelling!.capacity = 2;
      if (kind === 'war') {
        expect(declareWar(world, 1, 2)).toBeDefined();
        world.society.villages[0].food = 0; world.society.villages[0].migrationAfter = 0;
        world.society.villages[1].food = 100;
        for (const e of world.query('citizen')) e.components.citizen!.hunger = 70;
      }
      world.tick = 300; migrations(world);
      expect(world.society.migrations, kind).toHaveLength(0);
    }
  });

  it('walks around waiting pioneers and completes the colony after reloading a crowded arrival', () => {
    const world = pioneerWorld(); world.tick = 150; migrations(world);
    const group = world.society.migrations[0], offsets = [[1, 2.98], [1.42, 2.77], [1.79, 2.41], [1.75, 3.04]];
    for (const [index, id] of group.members.entries()) {
      const member = world.entities.get(id)!, [x, y] = offsets[index];
      Object.assign(member.components.position!, { x: group.destination.x + x, y: group.destination.y + y });
      world.spatial.update(member);
    }
    const lastId = group.members.at(-1)!;
    expect(Math.hypot(offsets[3][0], offsets[3][1])).toBeGreaterThan(3.2);
    const save = decodeSave(world.snapshot(), world.registry), restored = new World(save.seed, world.registry, save);
    for (let i = 0; i < 300; i++) {
      const last = world.entities.get(lastId)!, previous = { ...last.components.position! };
      world.step(); restored.step();
      const position = last.components.position!;
      expect(Math.hypot(position.x - previous.x, position.y - previous.y)).toBeLessThanOrEqual(last.components.motion!.speed / 30 + 1e-9);
      expect(world.canStand(position, 0.17, last.id)).toBe(true);
    }
    expect(world.society.migrations).toHaveLength(0);
    expect(world.society.villages).toHaveLength(2);
    expect(group.members.every(id => world.entities.get(id)!.components.citizen!.villageId === world.society.villages[1].id)).toBe(true);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('seeks safe housing during war and when a home is lost even with sufficient food', () => {
    for (const reason of ['war', 'homeless'] as const) {
      const world = reason === 'war' ? diplomaticWorld(3) : migrationWorld(); world.society.villages[0].food = 100;
      world.society.villages[0].migrationAfter = 0; world.society.villages[1].food = 100;
      for (const e of world.query('citizen')) e.components.citizen!.hunger = 10;
      if (reason === 'war') {
        expect(declareWar(world, 1, 3)).toBeDefined();
      } else world.remove([...world.query('dwelling')][0].id);
      world.tick = reason === 'war' ? 450 : 300; migrations(world);
      expect(world.society.migrations).toHaveLength(1);
      expect(world.society.migrations[0].toId).toBe(2);
    }
  });

  it('requires fertile accessible ground, surplus supplies and a warm season to found a colony', () => {
    for (const kind of ['soil', 'food', 'winter', 'water'] as const) {
      const world = pioneerWorld();
      if (kind === 'soil') world.terrain.tiles.fill(Terrain.Sand);
      if (kind === 'food') world.society.villages[0].food = 10;
      if (kind === 'water') for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) if (Math.hypot(x - 16, y - 32) > 16) world.terrain.set(x, y, Terrain.Water);
      world.tick = kind === 'winter' ? 5400 : 150; migrations(world);
      expect(world.society.migrations, kind).toHaveLength(0);
    }
  });

  it('keeps reserved beds free for the arriving family', () => {
    const world = migrationWorld(); world.tick = 300; migrations(world);
    const home = [...world.query('dwelling')][1];
    const extra = Array.from({ length: 3 }, (_, i) => world.spawn('core:person', { x: 33 + i, y: 27 })!);
    for (const e of extra) e.components.person!.buildIn = 100000;
    settlement(world);
    expect(extra.filter(e => e.components.person!.homeId === home.id)).toHaveLength(2);
    expect(decodeSave(world.snapshot(), world.registry).entities).toHaveLength(8);
  });

  it('releases reservations and preserves remaining supplies if the target house is destroyed', () => {
    const world = migrationWorld(); world.society.villages[0].food = 6;
    for (const e of world.query('person')) e.components.person!.homeId = null;
    world.tick = 300; migrations(world);
    const group = world.society.migrations[0]; expect(group.food).toBe(6);
    world.remove(group.homeIds[0]);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    migrations(world);
    expect(world.society.migrations).toHaveLength(0); expect(world.society.villages[0].food).toBe(6);
    expect([...world.query('citizen')].every(e => e.components.citizen!.task !== 'migrate')).toBe(true);
  });

  it('cleans up dead travelers and resumes a paused saved expedition deterministically', () => {
    const world = pioneerWorld(); world.tick = 150; migrations(world); advance(world, 2);
    world.remove(world.society.migrations[0].members[0]);
    world.paused = true;
    const save = decodeSave(world.snapshot(), world.registry), restored = new World(save.seed, world.registry, save);
    advance(restored, 5); expect(restored.snapshot()).toEqual(save);
    world.paused = false; restored.paused = false;
    advance(world, 40); advance(restored, 40);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(() => decodeSave(restored.snapshot(), restored.registry)).not.toThrow();
  });

  it('preserves party membership and valid saves when a traveler is thrown into water', () => {
    const world = migrationWorld(); world.tick = 300; migrations(world);
    const member = world.entities.get(world.society.migrations[0].members[0])!, p = member.components.position!;
    world.terrain.set(Math.floor(p.x), Math.floor(p.y), Terrain.Water);
    for (let i = 0; i < 60; i++) {
      world.step(); expect(member.components.citizen!.task).toBe('migrate');
      expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    }
  });

  it('migrates v10 state without changing people, terrain, stocks or calendar', () => {
    const world = migrationWorld(); world.tick = 5711;
    const raw = JSON.parse(JSON.stringify(world.snapshot())); raw.version = 10;
    delete raw.society.migrations; delete raw.society.nextMigrationId;
    for (const v of raw.society.villages) delete v.migrationAfter;
    const save = decodeSave(raw, world.registry);
    expect(save.version).toBe(SAVE_VERSION); expect(save.tick).toBe(5711);
    expect(save.entities).toEqual(raw.entities); expect(save.terrain).toEqual(raw.terrain);
    expect(save.society.migrations).toEqual([]); expect(save.society.villages[0].food).toBe(0);
    expect(raw.version).toBe(10); expect(raw.society.migrations).toBeUndefined();
  });

  it('rejects malformed migration parties and broken references', () => {
    const world = migrationWorld(); world.tick = 300; migrations(world);
    for (const mutate of [
      (s: ReturnType<World['snapshot']>) => { s.society.migrations[0].members.push(s.society.migrations[0].members[0]); },
      (s: ReturnType<World['snapshot']>) => { s.society.migrations[0].food = 100; },
      (s: ReturnType<World['snapshot']>) => { s.society.migrations[0].destination.x = 500; },
      (s: ReturnType<World['snapshot']>) => { s.society.migrations[0].fromId = 999; },
      (s: ReturnType<World['snapshot']>) => { s.entities.find(e => e.id === s.society.migrations[0].homeIds[0])!.components.dwelling!.capacity = 2; },
      (s: ReturnType<World['snapshot']>) => { s.society.migrations = []; },
    ]) { const save = world.snapshot(); mutate(save); expect(() => decodeSave(save, world.registry)).toThrow(); }
  });
});
