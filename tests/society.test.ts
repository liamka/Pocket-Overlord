import { describe, expect, it } from 'vitest';
import { localizedSettlementName, refreshLegacySettlementNames, settlementName, settlementTextLocalizer } from '../src/content/settlement-names';
import { languages, translate } from '../src/i18n';
import { World } from '../src/core/world';
import { BIOMES } from '../src/core/biomes';
import { buildingCells, buildingRoute, operational } from '../src/core/buildings';
import { raceOf } from '../src/core/races';
import { Terrain, type Village } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent, processEvents } from '../src/systems/effects';
import { intentions, settlement } from '../src/systems/people';
import { startReproduction } from '../src/core/reproduction';
import { assignHouse, diplomacy, fertilePatch, roads, seedSettlements } from '../src/systems/society';
import { findPath } from '../src/systems/navigation';
import { setFood, advance, flatWorld, villageWorld, workRoad } from './helpers';

describe('settlements on new maps', () => {
  it.each(BIOMES)('starts with inhabited, accessible settlements on $id', biome => {
    const world = new World(4, undefined, undefined, undefined, biome.id);
    const landscape = world.terrain.snapshot(), naturalObjects = [...world.entities.values()].map(e => structuredClone(e));
    seedSettlements(world);
    expect(world.tick).toBe(0);
    expect(world.society.villages).toHaveLength(3);
    expect(world.terrain.snapshot()).toEqual(landscape);
    for (const entity of naturalObjects) expect(world.entities.get(entity.id)).toEqual(entity);
    for (const village of world.society.villages) {
      const houses = [...world.query('dwelling')].filter(e => e.components.dwelling!.villageId === village.id);
      const residents = [...world.query('person')].filter(e => e.components.citizen!.villageId === village.id);
      const fields = [...world.query('farm')].filter(e => e.components.farm!.villageId === village.id);
      expect(houses.length).toBeGreaterThanOrEqual(2);
      expect(houses.length).toBeLessThanOrEqual(3);
      expect(residents).toHaveLength(houses.length * 4);
      expect(fields).toHaveLength(1);
      expect(fertilePatch(world, fields[0].components.position!)).toBe(true);
      expect(village.food).toBeGreaterThanOrEqual(residents.length * 4);
      expect(village.economy!.storage!.some(store => (store.goods.provisions ?? 0) > 0)).toBe(true);
      for (const house of houses) {
        expect(operational(house)).toBe(true);
        expect(raceOf(house)).toBe(village.race);
        expect(house.components.building!.project).toBeUndefined();
        for (const p of buildingCells(house)) expect(world.terrain.isLand(p.x, p.y)).toBe(true);
        expect(world.canStand(house.components.position!, 1.1, house.id)).toBe(true);
      }
      for (const resident of residents) {
        const home = world.entities.get(resident.components.person!.homeId!)!;
        expect(houses).toContain(home);
        expect(raceOf(resident)).toBe(village.race);
        expect(world.canStand(resident.components.position!, 0.35, resident.id)).toBe(true);
        expect(buildingRoute(world, resident.components.position!, home)).toBeDefined();
        expect(findPath(world, resident.components.position!, fields[0].components.position!, 1.8)).toBeDefined();
      }
    }
    expect(world.society.relations).toHaveLength(3);
  });

  it('repeats the same starting settlements and restores them without adding more', () => {
    const first = new World(1), second = new World(1);
    seedSettlements(first); seedSettlements(second);
    expect(first.society.villages).toHaveLength(2);
    const snapshot = first.snapshot();
    expect(second.snapshot()).toEqual(snapshot);
    const restored = new World(snapshot.seed, first.registry, decodeSave(snapshot, first.registry));
    seedSettlements(restored);
    expect(restored.snapshot()).toEqual(snapshot);
    advance(restored, 2);
    expect(restored.society.villages).toHaveLength(2);
    expect(restored.population).toBe(first.population);
  });

  it('also allows empty maps and skips terrain without suitable land', () => {
    const empty = new World(0), before = empty.snapshot();
    seedSettlements(empty);
    expect(empty.snapshot()).toEqual(before);
    const sea = new World(4);
    sea.terrain.tiles.fill(Terrain.Water);
    seedSettlements(sea);
    expect(sea.society.villages).toHaveLength(0);
    expect(sea.population).toBe(0);
    expect(sea.houseCount).toBe(0);
  });
});

describe('village life', () => {
  it.each(languages)('generates distinct settlement names reproducibly in $id', ({ id: language }) => {
    const generate = (seed: number): string[] => {
      const names: string[] = [];
      for (let id = 1; id <= 300; id++) names.push(settlementName(seed, id, names, language));
      return names;
    };
    const names = generate(12345);
    expect(generate(12345)).toEqual(names);
    expect(generate(67890)).not.toEqual(names);
    expect(new Set(names).size).toBe(300);
    expect(names.every(name => name.length > 0 && name.length <= 80)).toBe(true);
    if (language !== 'ru') expect(names.join(' ')).not.toMatch(/[А-Яа-яЁё]/);
    if (language === 'en' || language === 'ru') expect(names.some(name => name.includes('-'))).toBe(true);
    expect(settlementName(12345, 1, [names[0]], language)).not.toBe(names[0]);
  });
  it('keeps existing Russian names recognizable and localizes their meaning without mutating saves', () => {
    const legacy = ['Новая заря', 'Дальний утёс', 'Новый Эдем', 'Новая заря', 'Забытый берег', 'Форт рудокопов', 'Нортерзен', 'Селмир', 'Звёздная пыль', 'Северный каньон', 'Тихий перевал', 'Перевалфорд', 'Ланкерхёрст', 'Утёсвик', 'Холмбурн', 'Форт странников', 'Мерарнор-у-долины', 'Марзенвилль', 'Оплот-у-скалы', 'Последний приют'];
    const template = villageWorld().society.villages[0];
    for (const [index, name] of legacy.entries()) {
      const village = { ...template, id: index + 1, name };
      expect(settlementName(12345, village.id, [], 'ru')).toBe(name);
      for (const { id } of languages) expect(localizedSettlementName(12345, village, id)).toBe(settlementName(12345, village.id, [], id));
      expect(village.name).toBe(name);
    }
    const village = { ...template, id: 1, name: 'Новая заря' };
    expect(localizedSettlementName(12345, village, 'en')).toBe('New Dawn');
    expect(localizedSettlementName(12345, village, 'es')).toBe('Nuevo amanecer');
    expect(localizedSettlementName(12345, village, 'zh-CN')).toBe('新曙光');
    expect(localizedSettlementName(12345, village, 'ja')).toBe('新たな夜明け');
    village.name = 'Мой город';
    for (const { id } of languages) expect(localizedSettlementName(12345, village, id)).toBe('Мой город');
  });
  it('keeps localized names unique after collision retries and consistent in old chronicles', () => {
    const template = villageWorld().society.villages[0], villages: Village[] = [];
    for (let id = 1; id <= 300; id++) villages.push({ ...template, id, name: settlementName(12345, id, villages.map(v => v.name)) });
    for (const { id: language } of languages) {
      const names = villages.map(v => localizedSettlementName(12345, v, language));
      expect(new Set(names).size).toBe(300);
      const localize = settlementTextLocalizer(12345, villages, language);
      const source = `Создан союз: ${villages[0].name}, ${villages[1].name}`;
      expect(translate(localize(source), language)).toBe(translate('Создан союз: {side}', language, { side: `${names[0]}, ${names[1]}` }));
      expect(localize(`Prefix${villages[0].name}Suffix`)).toBe(`Prefix${villages[0].name}Suffix`);
    }
  });
  it('localizes numbered collision fallbacks and leaves custom names containing another name intact', () => {
    const template = villageWorld().society.villages[0], used: string[] = [];
    for (let i = 0; i < 100; i++) used.push(settlementName(12345, 1, used, 'ru'));
    const village = { ...template, id: 1, name: used.at(-1)! };
    expect(village.name).toMatch(/ \d+$/);
    for (const { id } of languages) {
      const localized = localizedSettlementName(12345, village, id);
      expect(localized.match(/ \d+$/)?.[0]).toBe(village.name.match(/ \d+$/)?.[0]);
      if (id !== 'ru') expect(localized).not.toMatch(/[А-Яа-яЁё]/);
    }
    village.name = 'New Dawn';
    const custom = { ...template, id: 2, name: 'New Dawn Heights' }, villages = [village, custom];
    const localize = settlementTextLocalizer(12345, villages, 'es');
    expect(localize('New Dawn, New Dawn Heights')).toBe('Nuevo amanecer, New Dawn Heights');
    expect(settlementTextLocalizer(12345, villages, 'es')).toBe(localize);
    village.name = 'My town';
    expect(settlementTextLocalizer(12345, villages, 'es')('My town, New Dawn Heights')).toBe('My town, New Dawn Heights');
  });
  it('assigns a generated name when founding a village without consuming simulation randomness', () => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!;
    const rngState = world.rng.state;
    const village = assignHouse(world, house);
    expect(village.name).toBe(settlementName(world.seed, village.id, []));
    expect(world.rng.state).toBe(rngState);
    expect(world.society.history.at(-1)?.text).toContain(village.name);
  });
  it('updates old automatic names on load while preserving custom names and the rest of the saved world', () => {
    const source = villageWorld(), saved = source.snapshot();
    saved.society.villages[0].name = 'Берёзовка';
    saved.society.villages[1].name = 'Мой город';
    const restored = new World(saved.seed, source.registry, decodeSave(saved, source.registry));
    const updated = restored.snapshot();
    expect(updated.society.villages[0].name).not.toBe('Берёзовка');
    expect(updated.society.villages[1].name).toBe('Мой город');
    expect(updated).toEqual({ ...saved, society: { ...saved.society, villages: updated.society.villages } });
    expect(updated.society.villages[0]).toEqual({ ...saved.society.villages[0], name: updated.society.villages[0].name });
    expect(saved.society.villages[0].name).toBe('Берёзовка');
    expect(settlementTextLocalizer(updated.seed, updated.society.villages, 'en')('Основана деревня Берёзовка')).toBe(`Основана деревня ${updated.society.villages[0].name}`);
    expect(new World(saved.seed, source.registry, decodeSave(updated, source.registry)).snapshot()).toEqual(updated);
  });
  it('also replaces numbered legacy names without colliding with names already saved', () => {
    const template = villageWorld().society.villages[0];
    const occupied = settlementName(12345, 9, []);
    const villages = [{ ...template, id: 9, name: 'Берёзовка 2' }, { ...template, id: 10, name: occupied }];
    refreshLegacySettlementNames(12345, villages);
    expect(villages[0].name).not.toBe('Берёзовка 2');
    expect(villages[0].name).not.toBe(occupied);
    expect(villages[1].name).toBe(occupied);
  });
  it('finds the only fertile patch near a settlement and starts harvesting there', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    world.terrain.tiles.fill(Terrain.Sand);
    for (let y = 23; y <= 25; y++) for (let x = 32; x <= 34; x++) world.terrain.set(x, y, Terrain.Grass);
    advance(world, 4);
    const fields = [...world.query('farm')];
    expect(fields).toHaveLength(1);
    expect(fields[0].components.position).toEqual({ x: 33.5, y: 24.5 });
    advance(world, 25);
    expect(fields[0].components.farm!.harvests).toBeGreaterThan(0);
    expect(world.society.villages[0].harvested).toBeGreaterThan(0);
  });
  it.each([Terrain.Sand, Terrain.Scorched, Terrain.Crater, Terrain.Road])('does not cultivate infertile terrain %s or an isolated grass tile', terrain => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    world.terrain.tiles.fill(terrain); world.terrain.set(30, 24, Terrain.Grass);
    advance(world, 9);
    expect([...world.query('farm')]).toHaveLength(0);
    expect(world.society.villages[0].harvested).toBe(0);
  });
  it('ignores fertile ground across impassable water and farms reachable ground when it appears', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    world.terrain.tiles.fill(Terrain.Sand);
    for (let y = 0; y < 48; y++) world.terrain.set(28, y, Terrain.Water);
    for (let y = 23; y <= 25; y++) for (let x = 32; x <= 34; x++) world.terrain.set(x, y, Terrain.Grass);
    advance(world, 9); expect([...world.query('farm')]).toHaveLength(0);
    for (let y = 23; y <= 25; y++) for (let x = 18; x <= 20; x++) world.terrain.set(x, y, Terrain.Grass);
    advance(world, 5);
    const field = [...world.query('farm')][0];
    expect(field.components.position).toEqual({ x: 19.5, y: 24.5 });
    advance(world, 25); expect(field.components.farm!.harvests).toBeGreaterThan(0);
  });
  it('needs adult workers to establish fields', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    for (const e of world.query('person')) e.components.person!.age = 10;
    advance(world, 4); expect([...world.query('farm')]).toHaveLength(0);
    for (const e of world.query('person')) e.components.person!.age = 18;
    advance(world, 5); expect([...world.query('farm')]).toHaveLength(1);
  });
  it('waits until a fertile patch is clear of solid obstacles', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    world.terrain.tiles.fill(Terrain.Sand);
    for (let y = 23; y <= 25; y++) for (let x = 32; x <= 34; x++) world.terrain.set(x, y, Terrain.Grass);
    const tree = world.spawn('core:tree', { x: 33.5, y: 24.5 })!;
    advance(world, 4); expect([...world.query('farm')]).toHaveLength(0);
    world.remove(tree.id); advance(world, 5);
    expect([...world.query('farm')][0].components.position).toEqual({ x: 33.5, y: 24.5 });
  });
  it('stops farming destroyed soil and selects a new fertile patch', () => {
    const world = villageWorld([{ x: 24, y: 24 }]); advance(world, 4);
    const field = [...world.query('farm')][0], p = field.components.position!;
    const harvested = world.society.villages[0].harvested;
    world.terrain.set(p.x, p.y, Terrain.Crater);
    advance(world, 5);
    expect(world.entities.has(field.id)).toBe(false);
    const replacement = [...world.query('farm')][0];
    expect(replacement.id).not.toBe(field.id);
    expect(world.society.villages[0].harvested).toBe(harvested);
    advance(world, 25); expect(replacement.components.farm!.harvests).toBeGreaterThan(0);
    expect(world.terrain.at(p.x, p.y)).toBe(Terrain.Crater);
  });
  it('founds two villages and builds a continuous land road between them', () => {
    const world = villageWorld();
    expect(world.society.villages).toHaveLength(2);
    expect(new Set([...world.query('citizen')].map(e => e.components.citizen!.villageId)).size).toBe(2);
    workRoad(world);
    const road = world.society.roads[0];
    expect(road.tiles.length).toBeGreaterThan(20);
    expect(road.built).toBe(road.tiles.length);
    expect(road.tiles.every(i => world.terrain.tiles[i] === Terrain.Road)).toBe(true);
    for (let i = 1; i < road.tiles.length; i++) {
      const a = road.tiles[i - 1], b = road.tiles[i];
      expect(Math.abs(a % 48 - b % 48) + Math.abs(Math.floor(a / 48) - Math.floor(b / 48))).toBe(1);
    }
    const i = road.tiles[5]; world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Crater);
    advance(world, 1); expect(world.terrain.tiles[i]).toBe(Terrain.Crater);
  });
  it('does not build roads across deep water, but finds a route around a lake', () => {
    const source = villageWorld();
    const snapshot = source.snapshot(); snapshot.society.roads = [];
    snapshot.society.relations[0].roadAttempt = 0;
    for (let y = 0; y < 48; y++) snapshot.terrain.tiles[y * 48 + 23] = Terrain.DeepWater;
    const disconnected = new World(snapshot.seed, source.registry, snapshot);
    roads(disconnected); expect(disconnected.society.roads).toHaveLength(0);
    for (let x = 22; x < 25; x++) disconnected.terrain.set(x, 10, Terrain.Grass);
    disconnected.society.relations[0].roadAttempt = 0;
    roads(disconnected);
    const path = disconnected.society.roads[0].tiles;
    expect(path).toContain(10 * 48 + 23);
    expect(path.every(i => disconnected.terrain.tiles[i] !== Terrain.Water)).toBe(true);
  });
  it('workers reach fields, harvest food, eat and keep growing crops', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    advance(world, 50);
    const village = world.society.villages[0];
    expect(village.harvested).toBeGreaterThan(0);
    expect([...world.query('farm')].some(e => e.components.farm!.harvests > 0)).toBe(true);
    expect([...world.query('citizen')].some(e => e.components.citizen!.hunger < 40)).toBe(true);
    expect(world.society.history.some(e => e.text.includes('урожай'))).toBe(true);
  });
  it('hunger damages residents without food, and a meal consumes village stores', () => {
    const world = villageWorld([{ x: 24, y: 24 }]);
    const person = [...world.query('person')][0], c = person.components.citizen!, village = world.society.villages[0];
    c.hunger = 95; setFood(village, 0);
    const health = person.components.health!.current;
    world.tick = 45; intentions(world); processEvents(world);
    expect(person.components.health!.current).toBeLessThan(health);
    const house = [...world.query('dwelling')][0];
    person.components.position = { x: 24, y: 26 }; world.spatial.update(person);
    c.task = 'eat'; c.targetId = house.id; c.hunger = 70; setFood(village, 5);
    world.tick = 60; intentions(world);
    expect(c.hunger).toBeLessThan(30); expect(village.food).toBe(4);
  });
  it('forms a couple and cancels its pending birth after the father dies', () => {
    const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
    const mother = world.spawn('core:person', { x: 21, y: 24 })!, father = world.spawn('core:person', { x: 22, y: 24 })!;
    mother.components.person!.sex = 'a'; father.components.person!.sex = 'b';
    for (const e of [mother, father]) {
      e.components.person!.homeId = home.id; e.components.citizen!.villageId = village.id;
      e.components.reproduction!.cooldowns = {}; e.components.citizen!.hunger = 0;
    }
    settlement(world);
    expect(mother.components.citizen!.partnerId).toBe(father.id);
    expect(startReproduction(world, mother, 'sexual', father)).toBe(true);
    expect(mother.components.citizen!.pregnancy).toBeGreaterThan(0);
    const fatherId = father.id; world.remove(fatherId);
    expect(mother.components.citizen!.partnerId).toBeNull();
    advance(world, 17);
    const baby = [...world.query('citizen')].find(e => e.components.citizen!.parents.includes(mother.id));
    expect(baby).toBeUndefined();
    expect(mother.components.reproduction!.pending).toBeUndefined();
    expect(mother.components.citizen!.pregnancy).toBe(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('does not pair siblings or start pregnancies without food', () => {
    const world = flatWorld(); world.spawn('core:house', { x: 24, y: 24 });
    const a = world.spawn('core:person', { x: 22, y: 24 })!, b = world.spawn('core:person', { x: 26, y: 24 })!;
    a.components.person!.sex = 'a'; b.components.person!.sex = 'b';
    for (const e of [a, b]) { e.components.citizen!.parents = [100, 101]; e.components.reproduction!.cooldowns = {}; e.components.citizen!.hunger = 75; }
    advance(world, 1);
    expect(a.components.citizen!.partnerId).toBeNull(); expect(b.components.citizen!.partnerId).toBeNull();
    b.components.citizen!.parents = []; setFood(world.society.villages[0], 0);
    advance(world, 1);
    expect(a.components.citizen!.partnerId).toBe(b.id); expect(a.components.citizen!.pregnancy).toBe(0);
  });
  it('forms alliances under prosperity but waits for a completed road before sending food', () => {
    const world = villageWorld([{ x: 6, y: 6 }, { x: 40, y: 40 }]);
    const [a, b] = world.society.villages, r = world.society.relations[0];
    setFood(a, 60); setFood(b, 30); r.affinity = 18; r.nextDecision = 0;
    diplomacy(world); expect(r.status).toBe('alliance');
    setFood(b, 0); r.affinity = 50; r.nextDecision = 0;
    diplomacy(world); expect(b.food).toBe(0); expect(a.food).toBe(60);
    expect([...world.query('caravan')]).toHaveLength(0);
  });
  it('resource conflict leads to combat damage and a timed truce', () => {
    const world = villageWorld(); advance(world, 15);
    const [a, b] = world.society.villages, r = world.society.relations[0];
    setFood(a, 0); setFood(b, 0); r.affinity = -24; r.nextDecision = 0;
    diplomacy(world); expect(r.status).toBe('war');
    const attacker = [...world.query('citizen')].find(e => e.components.citizen!.villageId === a.id && e.id % 3 !== 0)!;
    const victim = [...world.query('citizen')].find(e => e.components.citizen!.villageId === b.id)!;
    attacker.components.position = { x: 22, y: 24 }; victim.components.position = { x: 23, y: 24 };
    world.spatial.update(attacker); world.spatial.update(victim);
    attacker.components.citizen!.task = 'fight'; attacker.components.citizen!.targetId = victim.id;
    const health = victim.components.health!.current;
    intentions(world); processEvents(world);
    expect(victim.components.health!.current).toBeLessThan(health);
    world.tick = r.since + 2700; r.nextDecision = world.tick; diplomacy(world);
    expect(r.status).toBe('neutral');
    const after = victim.components.health!.current;
    intentions(world); processEvents(world); expect(victim.components.health!.current).toBeGreaterThanOrEqual(after);
  });
  it('fields burn and are destroyed by the existing blast rules', () => {
    const world = villageWorld([{ x: 24, y: 24 }]); advance(world, 5);
    const farm = [...world.query('farm')][0];
    applyEvent(world, { kind: 'heat', target: farm.id, amount: 100 });
    expect(farm.components.thermal!.burning).toBe(true);
    world.addRain(farm.components.position!, 4, 1); advance(world, 0.5);
    expect(farm.components.thermal!.burning).toBe(false);
    applyEvent(world, { kind: 'blast', ...farm.components.position!, radius: 2, power: 1000, heat: 100 }); processEvents(world);
    expect(world.entities.has(farm.id)).toBe(false);
    expect([...world.query('citizen')].every(e => e.components.citizen!.targetId !== farm.id)).toBe(true);
  });
  it('restores roads, families, crops and relations with deterministic continuation', () => {
    const world = villageWorld(); advance(world, 32);
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    expect(snapshot.society.villages.length).toBe(2);
    expect(snapshot.entities.some(e => e.components.farm)).toBe(true);
    const restored = new World(snapshot.seed, world.registry, snapshot);
    advance(world, 80); advance(restored, 80);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
    const paused = world.snapshot(); world.paused = true; advance(world, 10);
    expect(world.snapshot()).toEqual({ ...paused, paused: true });
  });
});
