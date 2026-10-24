import { describe, expect, it } from 'vitest';
import { RACES, RACE_IDS, raceOf, type RaceId } from '../src/core/races';
import { World } from '../src/core/world';
import { SAVE_VERSION, type Vec2 } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { declareWar } from '../src/systems/diplomacy';
import { processEvents } from '../src/systems/effects';
import { migrations } from '../src/systems/migration';
import { intentions, settlement } from '../src/systems/people';
import { assignHouse, buildHouse } from '../src/systems/society';
import { advance, diplomaticWorld, flatWorld, migrationWorld, pioneerWorld, villageWorld } from './helpers';

function couple(world: World, race: RaceId, center: Vec2) {
  const home = buildHouse(world, center, race)!;
  const village = assignHouse(world, home);
  const people = [-2, 2].map(dx => world.spawn(RACES[race].entityId, { x: center.x + dx, y: center.y + 2 })!);
  people.forEach((e, i) => {
    Object.assign(e.components.person!, { sex: i ? 'b' : 'a', homeId: home.id, reproduceIn: 0 });
    e.components.citizen!.villageId = village.id;
  });
  return { home, village, people };
}

function changeVillage(world: World, id: number, race: RaceId): void {
  world.society.villages.find(v => v.id === id)!.race = race;
  for (const e of world.query('person', 'citizen')) if (e.components.citizen!.villageId === id) {
    e.typeId = RACES[race].entityId; e.components.person!.race = race;
  }
  for (const e of world.query('dwelling')) if (e.components.dwelling!.villageId === id) e.components.dwelling!.race = race;
}

describe('civilized peoples', () => {
  it('places each people through its tool and includes everyone in the population', () => {
    const world = flatWorld();
    for (const [i, race] of RACE_IDS.entries()) {
      const tool = world.registry.tools.get(`core:${race}`)!;
      expect(tool.category).toBe('people');
      expect(world.command({ kind: 'use-tool', toolId: tool.id, x: 10 + i * 6, y: 20 })).toBeUndefined();
    }
    expect(world.population).toBe(4);
    const people = [...world.query('person')];
    expect(people.map(raceOf)).toEqual(RACE_IDS);
    expect(people[1].components.motion!.speed).toBeGreaterThan(people[0].components.motion!.speed);
    expect(people[2].components.health!.max).toBeGreaterThan(people[0].components.health!.max);
    expect(people[3].components.motion!.speed).toBeLessThan(people[0].components.motion!.speed);
  });

  it.each(RACE_IDS)('%s builds its own homes, forms a family and passes its people to children', race => {
    const world = flatWorld();
    const people = [-2, 2].map(dx => world.spawn(RACES[race].entityId, { x: 24 + dx, y: 24 })!);
    people.forEach((e, i) => { Object.assign(e.components.person!, { sex: i ? 'b' : 'a', buildIn: 0, reproduceIn: 0 }); });
    advance(world, 1);
    expect(world.society.villages).toHaveLength(1);
    expect(world.society.villages[0].race).toBe(race);
    expect([...world.query('dwelling')].every(e => raceOf(e) === race)).toBe(true);
    expect(people[0].components.citizen!.partnerId).toBe(people[1].id);
    expect(people[0].components.citizen!.pregnancy).toBe(0);
    for (let i = 0; i < 30 && people[0].components.citizen!.pregnancy === 0; i++) advance(world, 1);
    expect([...world.query('dwelling')].every(e => !e.components.dwelling!.construction)).toBe(true);
    expect(people[0].components.citizen!.pregnancy).toBeGreaterThan(0);
    const father = people[1].id; world.remove(father);
    advance(world, 17);
    const child = [...world.query('person')].find(e => e.components.citizen!.parents.includes(people[0].id))!;
    expect(child).toBeDefined(); expect(raceOf(child)).toBe(race);
    expect(child.typeId).toBe(RACES[race].entityId);
    expect(child.components.citizen!.parents).toEqual([people[0].id, father]);
    expect(child.components.person!.homeId).toBe(people[0].components.person!.homeId);
    expect([...world.query('farm')].length).toBeGreaterThan(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('keeps neighboring peoples in distinct villages and never moves them into another people’s homes', () => {
    const world = flatWorld();
    const human = couple(world, 'human', { x: 18, y: 24 });
    const elf = couple(world, 'elf', { x: 26, y: 24 });
    expect(human.village.id).not.toBe(elf.village.id);
    const orc = world.spawn('core:orc', { x: 22, y: 24 })!;
    orc.components.person!.buildIn = 1000;
    world.tick = 30; settlement(world);
    expect(orc.components.person!.homeId).toBeNull();
    expect(human.people[0].components.citizen!.partnerId).toBe(human.people[1].id);
    expect(elf.people[0].components.citizen!.partnerId).toBe(elf.people[1].id);
  });

  it('gives elves and dwarves longer lives and orcs faster recovery', () => {
    const world = flatWorld();
    const people = RACE_IDS.map((race, i) => world.spawn(RACES[race].entityId, { x: 8 + i * 8, y: 24 })!);
    for (const e of people) { e.components.health!.current = 30; e.components.person!.age = 30; }
    world.tick = 15; intentions(world);
    expect(people[2].components.health!.current).toBeGreaterThan(people[0].components.health!.current);
    for (const e of people) e.components.person!.age = 90;
    world.tick = 30; intentions(world); processEvents(world);
    expect([...world.query('person')].map(raceOf)).toEqual(['elf', 'dwarf']);
  });

  it.each(RACE_IDS)('%s uses its own attack strength and recovery time in battle', race => {
    const world = diplomaticWorld(2); changeVillage(world, 1, race);
    expect(declareWar(world, 1, 2)).toBeDefined();
    const attacker = [...world.query('citizen')].find(e => e.components.citizen!.villageId === 1)!;
    const victim = [...world.query('citizen')].find(e => e.components.citizen!.villageId === 2)!;
    attacker.components.position = { x: 22, y: 24 }; victim.components.position = { x: 23, y: 24 };
    world.spatial.update(attacker); world.spatial.update(victim);
    Object.assign(attacker.components.citizen!, { task: 'fight', targetId: victim.id, attackIn: 0 });
    victim.components.citizen!.hunger = 60;
    const before = victim.components.health!.current;
    intentions(world); processEvents(world);
    expect(before - victim.components.health!.current).toBe(RACES[race].damage);
    expect(attacker.components.citizen!.attackIn).toBe(RACES[race].attackInterval);
  });

  it('starts relations according to the peoples without forcing immediate war', () => {
    const world = flatWorld();
    for (const [i, race] of RACE_IDS.entries()) assignHouse(world, buildHouse(world, { x: 6 + i * 10, y: 24 }, race)!);
    const relation = (a: number, b: number) => world.society.relations.find(r => r.a === a && r.b === b)!;
    expect(relation(1, 3).affinity).toBeLessThan(relation(1, 2).affinity);
    expect(relation(2, 4).affinity).toBeLessThan(0);
    expect(world.society.relations.every(r => r.status === 'neutral')).toBe(true);
  });

  it('rejects migration into another people’s home, then settles the family among its own people', () => {
    const world = migrationWorld(); changeVillage(world, 1, 'elf');
    world.tick = 300; migrations(world);
    expect(world.society.migrations).toHaveLength(0);
    changeVillage(world, 2, 'elf'); migrations(world);
    expect(world.society.migrations).toHaveLength(1);
    advance(world, 55);
    expect(world.society.migrations).toHaveLength(0);
    expect([...world.query('person')].every(e => raceOf(e) === 'elf' && e.components.citizen!.villageId === 2)).toBe(true);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('pioneers retain their people in the new colony and build its architecture', () => {
    const world = pioneerWorld(); changeVillage(world, 1, 'dwarf');
    world.tick = 150; migrations(world);
    expect(world.society.migrations).toHaveLength(1);
    advance(world, 55);
    const colony = world.society.villages.find(v => v.id !== 1)!;
    expect(colony.race).toBe('dwarf');
    const home = [...world.query('dwelling')].find(e => e.components.dwelling!.villageId === colony.id)!;
    expect(raceOf(home)).toBe('dwarf'); expect(home.components.health!.max).toBeGreaterThan(180);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('upgrades previous human worlds without resetting their residents or progress', () => {
    const world = villageWorld(), before = world.snapshot(), legacy = structuredClone(before);
    legacy.version = 18;
    for (const e of legacy.entities) {
      if (e.components.person) delete e.components.person.race;
      if (e.components.dwelling) delete e.components.dwelling.race;
    }
    for (const v of legacy.society.villages) delete v.race;
    const loaded = decodeSave(legacy, world.registry);
    expect(loaded).toEqual(before); expect(loaded.version).toBe(SAVE_VERSION);
    expect(legacy.version).toBe(18);
  });

  it('preserves all four peoples and their deterministic continuation through a save', () => {
    const world = flatWorld();
    RACE_IDS.forEach((race, i) => couple(world, race, { x: i % 2 ? 36 : 10, y: i < 2 ? 10 : 36 }));
    advance(world, 2);
    const saved = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(saved.seed, world.registry, saved);
    advance(world, 20); advance(restored, 20);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(new Set([...restored.query('person')].map(raceOf)).size).toBe(4);
    expect(() => decodeSave(restored.snapshot(), world.registry)).not.toThrow();
  });

  it('rejects unknown peoples and mismatched saved residents, buildings and villages', () => {
    const world = flatWorld(); couple(world, 'elf', { x: 24, y: 24 });
    const wrongType = world.snapshot(); wrongType.entities.find(e => e.components.person)!.typeId = 'core:orc';
    expect(() => decodeSave(wrongType, world.registry)).toThrow();
    const wrongHome = world.snapshot(); wrongHome.entities.find(e => e.components.dwelling)!.components.dwelling!.race = 'dwarf';
    expect(() => decodeSave(wrongHome, world.registry)).toThrow();
    const wrongVillage = world.snapshot(); wrongVillage.society.villages[0].race = 'human';
    expect(() => decodeSave(wrongVillage, world.registry)).toThrow();
    const unknown = JSON.parse(JSON.stringify(world.snapshot())); unknown.entities[0].components.dwelling.race = 'unknown';
    expect(() => decodeSave(unknown, world.registry)).toThrow();
  });
});
