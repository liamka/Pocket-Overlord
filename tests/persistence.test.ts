import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { SAVE_VERSION, SIMULATION_SPEEDS, Terrain } from '../src/core/types';
import { processEvents } from '../src/systems/effects';
import { alliedGroup } from '../src/core/diplomacy';
import { atWar, declareWar, formAlliance } from '../src/systems/diplomacy';
import { IndexedDBBackend, SaveService, packSnapshot, unpackSnapshot } from '../src/persistence/storage';
import { advance, diplomaticWorld, flatWorld, villageWorld } from './helpers';

describe('save compatibility and deterministic continuation', () => {
  it('transfers only changed terrain chunks and reconstructs immutable checkpoints exactly', () => {
    const first = flatWorld().snapshot(), frozen = structuredClone(first);
    const full = packSnapshot(first);
    expect(unpackSnapshot(full.snapshot)).toEqual(first);
    const same = packSnapshot(first, first);
    expect(same.buffers).toHaveLength(0);
    expect(unpackSnapshot(same.snapshot, first)).toEqual(first);
    const next = structuredClone(first);
    next.terrain.tiles[0] = Terrain.Water; next.terrain.moisture[1200] = 0.123456789;
    next.terrain.recovery = [{ index: 20, age: 1.25, target: Terrain.Grass }];
    delete next.terrain.biomes; delete next.terrain.surfaces;
    const delta = packSnapshot(next, first);
    expect(delta.buffers.reduce((n, b) => n + b.byteLength, 0)).toBe(2 * 1024 * 8);
    expect(unpackSnapshot(delta.snapshot, first)).toEqual(next);
    expect(first).toEqual(frozen);
    expect(() => unpackSnapshot(delta.snapshot)).toThrow();
    next.seed++;
    const replacement = packSnapshot(next, first);
    expect(unpackSnapshot(replacement.snapshot)).toEqual(next);
  });
  it('captures queued autosaves immediately while sharing only unchanged terrain arrays', async () => {
    const world = flatWorld(), writes: ReturnType<World['snapshot']>[] = [];
    const service = new SaveService({ read: async () => undefined, write: async snapshot => { writes.push(snapshot); } }, world.registry);
    await service.load();
    const first = service.saveWorld(world);
    world.tick = 3; world.terrain.moisture[0] = 0.125;
    const second = service.saveWorld(world);
    world.tick = 4; world.terrain.moisture[0] = 0.25;
    await Promise.all([first, second]);
    expect(writes.map(s => s.tick)).toEqual([0, 3]);
    expect(writes.map(s => s.terrain.moisture[0])).toEqual([0, 0.125]);
    expect(writes[1].terrain.tiles).toBe(writes[0].terrain.tiles);
    expect(writes[1].terrain.moisture).not.toBe(writes[0].terrain.moisture);
  });
  it('keeps terrain, recovery and entities detached from both the world and later checkpoints', () => {
    const world = flatWorld(), person = world.spawn('core:person', { x: 10, y: 10 })!;
    world.terrain.set(20, 20, Terrain.Crater);
    const saved = world.snapshot(), before = structuredClone(saved);
    world.terrain.tiles[0] = Terrain.Water; world.terrain.moisture[0] = 0.75;
    world.terrain.biomes[0]++; world.terrain.surfaces[0]++;
    world.terrain.recovery.get(world.terrain.index(20, 20))!.age++;
    person.components.position!.x++;
    const next = world.snapshot(); next.terrain.tiles[1] = Terrain.Mountain;
    expect(saved).toEqual(before);
    expect(world.terrain.tiles[1]).toBe(Terrain.Grass);
  });
  it('migrates active dynamite, rockets and rain to their smaller areas', () => {
    const world = flatWorld();
    world.spawn('core:dynamite', { x: 15, y: 20 })!.components.explosive!.radius = 5.5;
    world.spawn('core:rocket', { x: 30, y: 20 })!.components.explosive!.radius = 9;
    world.addRain({ x: 24, y: 30 }, 7, 2);
    const old = world.snapshot(); old.version = 14;
    const migrated = decodeSave(old, world.registry);
    expect(migrated.entities.map(entity => entity.components.explosive!.radius)).toEqual([2.75, 4.5]);
    expect(migrated.effects[0].radius).toBe(3.5);
    expect(old.entities.map(entity => entity.components.explosive!.radius)).toEqual([5.5, 9]);
  });
  it('restores all active state and continues identically', () => {
    const world = flatWorld();
    world.spawn('core:person', { x: 15, y: 15 }); world.spawn('core:person', { x: 17, y: 15 });
    world.spawn('core:tree', { x: 22, y: 20 }); world.spawn('core:dynamite', { x: 20, y: 20 });
    world.spawn('core:rocket', { x: 30, y: 30 }); advance(world, 0.7);
    world.addRain({ x: 23, y: 20 }, 7, 2);
    world.events.push({ kind: 'heat', target: 3, amount: 20 });
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(snapshot.seed, world.registry, snapshot);
    expect(restored.snapshot()).toEqual(world.snapshot());
    advance(world, 8); advance(restored, 8);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });
  it('migrates v1 terrain moisture and rejects future, unknown and damaged data', () => {
    const world = flatWorld();
    const old = { ...world.snapshot(), version: 1, terrain: { ...world.snapshot().terrain, moisture: undefined } };
    expect(decodeSave(old, world.registry).terrain.moisture).toHaveLength(48 * 48);
    expect(old.version).toBe(1);
    expect(() => decodeSave({ ...world.snapshot(), version: 999 }, world.registry)).toThrow(/новой версии/);
    const damaged = world.snapshot(); damaged.terrain.tiles[0] = 99;
    expect(() => decodeSave(damaged, world.registry)).toThrow(/повреждён/);
    const unknown = world.snapshot(); unknown.entities = [{ id: 1, typeId: 'unknown', components: {} }]; unknown.nextEntityId = 2;
    expect(() => decodeSave(unknown, world.registry)).toThrow(/неизвестный тип/);
  });
  it('rejects invalid components, absent components, duplicate IDs and broken homes', () => {
    const world = flatWorld(); world.spawn('core:person', { x: 20, y: 20 });
    const missing = world.snapshot(); delete missing.entities[0].components.motion;
    expect(() => decodeSave(missing, world.registry)).toThrow();
    const nan = world.snapshot(); nan.entities[0].components.position!.x = NaN;
    expect(() => decodeSave(nan, world.registry)).toThrow();
    const duplicate = world.snapshot(); duplicate.entities.push(duplicate.entities[0]);
    expect(() => decodeSave(duplicate, world.registry)).toThrow();
    const home = world.snapshot(); home.entities[0].components.person!.homeId = 999;
    expect(() => decodeSave(home, world.registry)).toThrow();
  });
  it('migrates v2 residents and houses without losing their world', () => {
    const world = flatWorld(), house = world.spawn('core:house', { x: 24, y: 24 })!;
    const person = world.spawn('core:person', { x: 22, y: 24 })!; person.components.person!.homeId = house.id;
    const legacy = { ...world.snapshot(), version: 2, society: undefined, entities: world.snapshot().entities.map(e => ({ ...e, components: {
      ...e.components, ...(e.components.person ? { citizen: undefined } : {}),
      ...(e.components.dwelling ? { dwelling: { capacity: e.components.dwelling.capacity } } : {}),
    } })) };
    const migrated = decodeSave(JSON.parse(JSON.stringify(legacy)), world.registry);
    expect(migrated.version).toBe(SAVE_VERSION); expect(migrated.entities).toHaveLength(2);
    expect(migrated.entities.find(e => e.id === person.id)?.components.person!.homeId).toBe(house.id);
    expect(migrated.entities.find(e => e.id === person.id)?.components.citizen!.hunger).toBe(15);
    const restored = new World(migrated.seed, world.registry, migrated); advance(restored, 1);
    expect(restored.society.villages).toHaveLength(1); expect(restored.population).toBe(1);
    expect(legacy.society).toBeUndefined();
  });
  it('rejects damaged family references, village links, roads and food values', () => {
    const world = villageWorld(); advance(world, 5);
    const family = world.snapshot(); family.entities.find(e => e.components.citizen)!.components.citizen!.partnerId = 999;
    expect(() => decodeSave(family, world.registry)).toThrow();
    const village = world.snapshot(); village.entities.find(e => e.components.citizen)!.components.citizen!.villageId = 999;
    expect(() => decodeSave(village, world.registry)).toThrow();
    const road = world.snapshot(); road.society.roads[0].tiles[1] = -1;
    expect(() => decodeSave(road, world.registry)).toThrow();
    const food = world.snapshot(); food.society.villages[0].food = NaN;
    expect(() => decodeSave(food, world.registry)).toThrow();
  });
  it('migrates v3 pair treaties into alliances and a common war without changing the source', () => {
    const world = diplomaticWorld(5);
    const legacy = { ...world.snapshot(), version: 3 };
    const relation = (a: number, b: number) => legacy.society.relations.find(r => r.a === a && r.b === b)!;
    relation(1, 2).status = relation(2, 3).status = relation(4, 5).status = 'alliance';
    relation(1, 4).status = 'war';
    const raw = JSON.parse(JSON.stringify(legacy)); delete raw.society.wars; delete raw.society.nextWarId;
    const migrated = decodeSave(raw, world.registry), restored = new World(migrated.seed, world.registry, migrated);
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(alliedGroup(restored.society, 1)).toEqual([1, 2, 3]);
    expect(restored.society.wars).toHaveLength(1);
    for (const a of [1, 2, 3]) for (const b of [4, 5]) expect(atWar(restored, a, b)).toBe(true);
    expect(raw.version).toBe(3); expect(raw.society.wars).toBeUndefined();
    expect(raw.society.relations.find((r: { a: number; b: number }) => r.a === 1 && r.b === 3).status).toBe('neutral');
    advance(restored, 10); expect(() => decodeSave(restored.snapshot(), world.registry)).not.toThrow();
  });
  it('preserves old enemies when v3 allies form a contradictory triangle', () => {
    const world = diplomaticWorld(3), legacy = { ...world.snapshot(), version: 3 };
    const [ab, ac, bc] = legacy.society.relations;
    ab.status = ac.status = 'alliance'; ab.affinity = 80; ac.affinity = 30; bc.status = 'war';
    const migrated = decodeSave(legacy, world.registry), restored = new World(migrated.seed, world.registry, migrated);
    expect(alliedGroup(restored.society, 1)).toEqual([1, 2]);
    expect(atWar(restored, 2, 3)).toBe(true); expect(atWar(restored, 1, 3)).toBe(true);
    expect(atWar(restored, 1, 2)).toBe(false);
  });
  it('rejects damaged campaign participants, objectives, duplicate wars and conflicting treaties', () => {
    const world = diplomaticWorld(5); formAlliance(world, 1, 2); formAlliance(world, 4, 5); declareWar(world, 1, 4);
    const bothSides = world.snapshot(); bothSides.society.wars[0].defenders.push(1);
    const missing = world.snapshot(); missing.society.wars[0].attackers = [999];
    const objective = world.snapshot(); objective.society.wars[0].attackTarget = 1;
    const duplicate = world.snapshot(); duplicate.society.wars.push({ ...duplicate.society.wars[0], id: duplicate.society.nextWarId++ });
    const conflict = world.snapshot(); conflict.society.relations.find(r => r.a === 1 && r.b === 4)!.status = 'alliance';
    const absentAlly = world.snapshot(); absentAlly.society.wars[0].attackers = [1];
    const missingTreaty = world.snapshot(); missingTreaty.society.relations.shift();
    for (const raw of [bothSides, missing, objective, duplicate, conflict, absentAlly, missingTreaty]) expect(() => decodeSave(raw, world.registry)).toThrow(/повреждён/);
  });
  it('migrates v4 to normal speed while preserving paused explosives', () => {
    const world = flatWorld(); world.command({ kind: 'speed', speed: 0 });
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    const old = { ...world.snapshot(), version: 4, speed: undefined };
    const migrated = decodeSave(old, world.registry);
    expect(migrated.speed).toBe(1); expect(migrated.paused).toBe(true);
    expect(migrated.entities).toEqual(old.entities); expect(migrated.tick).toBe(0);
    expect(old.speed).toBeUndefined(); expect(old.version).toBe(4);
    const restored = new World(migrated.seed, world.registry, migrated); advance(restored, 10);
    expect(restored.snapshot()).toEqual(migrated);
  });
  it('migrates v8 without changing its selected speed, pause or pending work', () => {
    const world = flatWorld(); world.command({ kind: 'speed', speed: 4 }); world.command({ kind: 'speed', speed: 0 });
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    const old = { ...world.snapshot(), version: 8 };
    expect(decodeSave(old, world.registry)).toEqual({ ...old, version: SAVE_VERSION });
    expect(old.version).toBe(8);
  });
  it.each([false, true])('migrates v11 speeds to at most 20x without changing the world (paused: %s)', paused => {
    const world = flatWorld(); world.paused = paused;
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    for (const speed of [...SIMULATION_SPEEDS, 40, 50, 500, 5000]) {
      const old = { ...world.snapshot(), version: 11, speed };
      const migrated = decodeSave(old, world.registry);
      expect(migrated).toEqual({ ...old, version: SAVE_VERSION, speed: Math.min(speed, 20) });
      const restored = new World(migrated.seed, world.registry, migrated);
      expect(restored.snapshot()).toEqual(migrated);
      expect(old.version).toBe(11); expect(old.speed).toBe(speed);
    }
    for (const speed of [41, 100, 5001, '5000']) expect(() => decodeSave({ ...world.snapshot(), version: 11, speed }, world.registry)).toThrow();
  });
  it.each([false, true])('migrates retired 40x saves to 20x without changing the world (paused: %s)', paused => {
    const world = flatWorld(); world.paused = paused;
    world.command({ kind: 'use-tool', toolId: 'core:dynamite', x: 20, y: 20 });
    const old = { ...world.snapshot(), version: 59, speed: 40 };
    const migrated = decodeSave(old, world.registry);
    expect(migrated).toEqual({ ...old, version: SAVE_VERSION, speed: 20 });
    expect(new World(migrated.seed, world.registry, migrated).snapshot()).toEqual(migrated);
    expect(old.speed).toBe(40); expect(old.version).toBe(59);
  });
  it.each(SIMULATION_SPEEDS)('restores %sx and its paused state and rejects invalid speeds', speed => {
    const world = flatWorld(); world.command({ kind: 'speed', speed }); world.command({ kind: 'speed', speed: 0 });
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    const restored = new World(snapshot.seed, world.registry, snapshot);
    expect(restored.paused).toBe(true); expect(restored.speed).toBe(speed);
    restored.command({ kind: 'pause', paused: false }); expect(restored.speed).toBe(speed);
    for (const invalid of [0, 3, 40, 41, 50, 500, 5000, -1, '4', null, undefined]) expect(() => decodeSave({ ...snapshot, speed: invalid }, world.registry)).toThrow();
  });
  it('preserves partially recovered terrain and continues identically after reload', () => {
    const world = flatWorld(); world.terrain.set(20, 20, Terrain.Sand);
    world.events.push({ kind: 'blast', x: 20, y: 20, radius: 6, power: 0, heat: 0 }); processEvents(world);
    advance(world, 50); world.command({ kind: 'speed', speed: 0 });
    const snapshot = decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry);
    expect(snapshot.terrain.recovery.some(state => state.age > 0)).toBe(true);
    const restored = new World(snapshot.seed, world.registry, snapshot);
    advance(restored, 20); expect(restored.snapshot()).toEqual(snapshot);
    world.command({ kind: 'speed', speed: 4 }); restored.command({ kind: 'speed', speed: 4 });
    advance(world, 320); advance(restored, 320);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(restored.terrain.at(20, 20)).toBe(Terrain.Sand);
    expect(() => decodeSave(restored.snapshot(), world.registry)).not.toThrow();
  });
  it('migrates v5 crater and scorched cells into recoverable terrain without changing the old save', () => {
    const world = flatWorld(); world.terrain.set(20, 20, Terrain.Scorched); world.terrain.set(21, 20, Terrain.Crater);
    const old = { ...world.snapshot(), version: 5, terrain: { ...world.terrain.snapshot(), recovery: undefined } };
    const snapshot = decodeSave(old, world.registry);
    expect(snapshot.version).toBe(SAVE_VERSION); expect(snapshot.terrain.recovery).toHaveLength(2);
    expect(snapshot.terrain.recovery.every(state => state.age === 0)).toBe(true);
    expect(old.terrain.recovery).toBeUndefined(); expect(old.version).toBe(5);
    const restored = new World(snapshot.seed, world.registry, snapshot); advance(restored, 384);
    expect(restored.terrain.recovery.size).toBe(0);
    expect(restored.terrain.at(21, 20)).toBe(Terrain.Grass);
  });
  it('rejects missing, duplicate, out-of-bounds and invalid recovery records', () => {
    const world = flatWorld(); world.terrain.set(20, 20, Terrain.Crater);
    const snapshot = world.snapshot(), record = snapshot.terrain.recovery[0];
    for (const recovery of [undefined, [], [record, record], [{ ...record, index: 99999 }], [{ ...record, index: 0 }], [{ ...record, age: NaN }], [{ ...record, age: 1000 }], [{ ...record, target: Terrain.Water }]]) {
      expect(() => decodeSave({ ...snapshot, terrain: { ...snapshot.terrain, recovery } }, world.registry)).toThrow();
    }
  });
});

async function storeRecord(database: string, value: unknown, key = 'last'): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(database, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('worlds');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds', 'readwrite');
      tx.objectStore('worlds').put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

async function storedRecords(database: string): Promise<Map<IDBValidKey, unknown>> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(database, 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('worlds');
      const keys = tx.objectStore('worlds').getAllKeys(), values = tx.objectStore('worlds').getAll();
      tx.oncomplete = () => { db.close(); resolve(new Map(keys.result.map((key, i) => [key, values.result[i]]))); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

describe('storage protection and transaction ordering', () => {
  it('round-trips through IndexedDB', async () => {
    const world = flatWorld(); const backend = new IndexedDBBackend(`test-${Math.random()}`);
    const service = new SaveService(backend, world.registry);
    expect(await service.load()).toEqual({ status: 'empty' });
    await service.save(world.snapshot());
    expect(await service.load()).toEqual({ status: 'loaded', snapshot: world.snapshot() });
  });
  it.each([null, { version: 999 }, { version: 2 }])('keeps autosaving and archives an unreadable save exactly once: %s', async raw => {
    const world = flatWorld(), database = `test-${Math.random()}`;
    await storeRecord(database, raw);
    const backend = new IndexedDBBackend(database), service = new SaveService(backend, world.registry);
    expect((await service.load()).status).toBe('unavailable');
    await service.save(world.snapshot()); advance(world, 1); await service.save(world.snapshot());
    const entries = await storedRecords(database);
    expect(entries.get('last')).toEqual(world.snapshot());
    expect([...entries].filter(([key]) => String(key).startsWith('backup:')).map(([, value]) => value)).toEqual([raw]);
    expect(await new SaveService(backend, world.registry).load()).toEqual({ status: 'loaded', snapshot: world.snapshot() });
  });
  it('retries saving after a failed read and write while preserving the unread original', async () => {
    const world = flatWorld(), database = `test-${Math.random()}`, raw = { version: 999, valuable: 'keep' };
    await storeRecord(database, raw);
    const backend = new IndexedDBBackend(database);
    let unavailable = true;
    const service = new SaveService({
      read: async () => { throw new Error('Read unavailable'); },
      write: async (snapshot, preserve) => { if (unavailable) throw new Error('Write unavailable'); await backend.write(snapshot, preserve); },
    }, world.registry);
    expect((await service.load()).status).toBe('unavailable');
    await expect(service.save(world.snapshot())).rejects.toThrow('Write unavailable');
    expect(await backend.read()).toEqual(raw);
    unavailable = false;
    await service.save(world.snapshot());
    expect(await backend.read()).toEqual(world.snapshot());
    expect([...(await storedRecords(database)).values()]).toContainEqual(raw);
  });
  it('rolls back replacement if archiving fails and retries the entire transaction', async () => {
    const world = flatWorld(), database = `test-${Math.random()}`, raw = { version: 999, valuable: 'keep' };
    const uuid = '00000000-0000-4000-8000-000000000000';
    await storeRecord(database, raw);
    await storeRecord(database, 'older backup', `backup:${uuid}`);
    const backend = new IndexedDBBackend(database), service = new SaveService(backend, world.registry);
    await service.load();
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
    try { await expect(service.save(world.snapshot())).rejects.toThrow(); }
    finally { randomUUID.mockRestore(); }
    expect(await backend.read()).toEqual(raw);
    expect((await storedRecords(database)).size).toBe(2);
    await service.save(world.snapshot());
    expect(await backend.read()).toEqual(world.snapshot());
    const entries = await storedRecords(database);
    expect(entries.size).toBe(3);
    expect([...entries.values()]).toContainEqual(raw);
    expect(entries.get(`backup:${uuid}`)).toBe('older backup');
  });
  it('surfaces failed writes and can retry without destroying the previous save', async () => {
    const world = flatWorld(); let fail = true; let stored = world.snapshot();
    const service = new SaveService({ read: async () => stored, write: async data => { if (fail) throw new Error('QuotaExceededError'); stored = data; } }, world.registry);
    await service.load(); advance(world, 1);
    await expect(service.save(world.snapshot())).rejects.toThrow(/Quota/); expect(stored.tick).toBe(0);
    fail = false; await service.save(world.snapshot()); expect(stored.tick).toBe(30);
  });
  it('serializes an in-flight save before explicit replacement', async () => {
    const world = flatWorld(); const order: number[] = [];
    const service = new SaveService({ read: async () => undefined, write: async data => { await new Promise(resolve => setTimeout(resolve, data.tick ? 1 : 20)); order.push(data.tick); } }, world.registry);
    await service.load(); const first = service.save(world.snapshot()); advance(world, 1);
    await Promise.all([first, service.replace(world.snapshot())]); expect(order).toEqual([0, 30]);
  });
});
