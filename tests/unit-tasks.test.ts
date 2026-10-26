import { describe, expect, it } from 'vitest';
import { UNIT_TASK_CATALOG } from '../src/content/unit-tasks';
import { continueWait, resumeBehaviour, taskLifecycle } from '../src/core/behaviour';
import { cancelFerryBoarding } from '../src/core/ferries';
import { cargoContents, deposit, stockOf } from '../src/core/resource-ledger';
import { initializeStorage } from '../src/core/stockpiles';
import { Terrain, type Entity } from '../src/core/types';
import { startReflection, reflectionChoices } from '../src/core/unit-tasks';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { continueVillageWork } from '../src/systems/economy';
import { migrations } from '../src/systems/migration';
import { settlement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

function workerWorld() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 10, y: 24 })!, village = assignHouse(world, home);
  initializeStorage(world, village); deposit(village, { provisions: 40 });
  const worker = world.spawn('core:person', { x: 20.2, y: 20 })!, source = world.spawn('core:stone', { x: 22, y: 20 })!;
  Object.assign(worker.components.person!, { age: 30, homeId: home.id, buildIn: 10000, reproduceIn: 10000 });
  Object.assign(worker.components.citizen!, { villageId: village.id, task: 'work', targetId: source.id, hunger: 0,
    work: { good: 'stone', progress: 0, cargo: null } });
  return { world, home, village, worker, source };
}
function arrive(world: World, actor: Entity, target: Entity): void {
  Object.assign(actor.components.position!, { x: target.components.position!.x - 1.8, y: target.components.position!.y });
  actor.components.citizen!.path = []; world.spatial.update(actor);
}

describe('unit-task lifecycle', () => {
  it('suspends a miner, releases claims and delivers the original load exactly once after resuming', () => {
    const { world, village, worker, source } = workerWorld(), c = worker.components.citizen!;
    continueVillageWork(world, worker);
    const progress = c.work!.progress;
    expect(taskLifecycle.suspend(world, worker, 'Responding to danger', 10)).toBe(false);
    expect(taskLifecycle.suspend(world, worker, 'Responding to danger')).toBe(true);
    expect(c.behaviour?.status).toBe('suspended'); expect(c.work!.progress).toBe(progress);
    expect(source.components.stone!.claims).toEqual([]);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    const actor = restored.entities.get(worker.id)!, citizen = actor.components.citizen!;
    expect(resumeBehaviour(restored, actor)).toBe(true);
    for (let i = 0; i < 8 && !citizen.work?.cargo; i++) { restored.tick += 15; continueVillageWork(restored, actor); }
    const cargo = structuredClone(citizen.work!.cargo!), amount = cargoContents(cargo).stone!;
    expect(amount).toBeGreaterThan(0);
    taskLifecycle.suspend(restored, actor, 'Hungry', 60);
    expect(citizen.work!.cargo).toEqual(cargo);
    expect(resumeBehaviour(restored, actor)).toBe(true);
    arrive(restored, actor, restored.entities.get(citizen.targetId!)!);
    continueVillageWork(restored, actor); continueVillageWork(restored, actor);
    const owner = restored.society.villages.find(v => v.id === village.id)!;
    expect(stockOf(owner, 'stone')).toBe(amount);
    expect(owner.economy!.deliveries).toBe(1); expect(citizen.work?.cargo).toBeFalsy();
  });

  it('cancels a suspended task whose target disappears without applying a result', () => {
    const { world, worker, source } = workerWorld();
    continueVillageWork(world, worker); taskLifecycle.suspend(world, worker, 'Responding to danger');
    world.remove(source.id);
    let applied = 0;
    expect(taskLifecycle.finish(world, worker, () => { applied++; return true; })).toBe(false);
    expect(applied).toBe(0);
    expect(worker.components.citizen!.behaviour).toMatchObject({ status: 'cancelled', targetId: null, ownerId: null, reason: 'Target is no longer available' });
    expect(resumeBehaviour(world, worker)).toBe(false);
  });

  it('releases a boarding seat at the bank and never ejects a traveler in mid-crossing', () => {
    const world = flatWorld(), actor = world.spawn('core:person', { x: 10.5, y: 10.5 })!;
    const tiles = [10, 11, 12, 13].map(x => world.terrain.index(x, 10));
    world.terrain.set(11, 10, Terrain.Water); world.terrain.set(12, 10, Terrain.Water);
    const ferry = { start: 0, end: 3, progress: 0, target: 0 as const, wait: 1, passengers: [actor.id] };
    world.society.roads.push({ a: 1, b: 2, tiles, built: 4, ferries: [ferry] });
    actor.components.citizen!.path = [{ x: 13.5, y: 10.5 }];
    expect(cancelFerryBoarding(world, actor)).toBe(true);
    expect(ferry.passengers).toEqual([]); expect(actor.components.citizen!.path).toEqual([]);
    ferry.passengers = [actor.id]; ferry.progress = 0.5;
    Object.assign(actor.components.position!, { x: 12, y: 10.5 }); world.spatial.update(actor);
    expect(cancelFerryBoarding(world, actor)).toBe(false);
    expect(ferry.passengers).toEqual([actor.id]); expect(actor.components.position!.x).toBe(12);
  });

  it('finishes reflection once, preserves independent statuses and yields to hunger and fire', () => {
    const world = flatWorld(), actor = world.spawn('core:person', { x: 20, y: 20 })!, c = actor.components.citizen!;
    c.reflectionAfter = 0;
    expect(startReflection(world, actor, { happiness: 100, superPositivity: true })).toBe(true);
    const deadline = c.behaviour!.retryAt, rng = world.rng.state;
    expect(startReflection(world, actor)).toBe(false); expect(world.rng.state).toBe(rng);
    actor.components.person!.plague = { age: 0, spreadIn: 2 };
    world.tick = deadline;
    expect(continueWait(world, actor)).toBe(false);
    expect(c.behaviour?.status).toBe('completed'); expect(actor.components.person!.plague).toBeDefined();
    c.reflectionAfter = 0; expect(startReflection(world, actor, { happiness: 100 })).toBe(true);
    c.hunger = 55; continueWait(world, actor);
    expect(c.behaviour).toMatchObject({ status: 'cancelled', reason: 'Hungry' });
    c.hunger = 0; c.reflectionAfter = 0; expect(startReflection(world, actor)).toBe(true);
    actor.components.thermal!.burning = true; taskLifecycle.tick(world, actor);
    expect(c.behaviour).toMatchObject({ status: 'cancelled', reason: 'Responding to danger' });
    expect(actor.components.thermal!.burning).toBe(true);
  });

  it('preserves a running expression, cooldown, RNG and pause through a save', () => {
    const world = flatWorld(), actor = world.spawn('core:person', { x: 20, y: 20 })!;
    actor.components.citizen!.reflectionAfter = 0;
    startReflection(world, actor, { happiness: -100 });
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    restored.paused = true;
    const frozen = restored.snapshot();
    for (let i = 0; i < 30; i++) restored.step();
    expect(restored.snapshot()).toEqual(frozen);
    restored.paused = false;
    for (let i = 0; i < 120; i++) { world.step(); restored.step(); }
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('does not deliver a child while the same parent is building', () => {
    const { world, home, village, worker } = workerWorld();
    const partner = world.spawn('core:person', { x: 12, y: 25 })!;
    Object.assign(partner.components.person!, { age: 30, sex: 'b', homeId: home.id, reproduceIn: 10000 });
    Object.assign(partner.components.citizen!, { villageId: village.id, partnerId: worker.id });
    Object.assign(worker.components.person!, { sex: 'a' });
    Object.assign(worker.components.citizen!, { task: 'build', targetId: home.id, partnerId: partner.id, fatherId: partner.id, pregnancy: 0.01 });
    const population = world.population;
    settlement(world); expect(world.population).toBe(population);
    Object.assign(worker.components.citizen!, { task: 'idle', targetId: null });
    world.tick += 30; settlement(world);
    expect(world.population).toBe(population + 1);
    expect(worker.components.citizen!.familyActionAt).toBe(world.tick);
    settlement(world); expect(world.population).toBe(population + 1);
  });

  it('adapts a migration and commits home assignment once after arrival', () => {
    const { world, village, worker } = workerWorld(), c = worker.components.citizen!;
    const destination = world.spawn('core:house', { x: 38, y: 24 })!, to = assignHouse(world, destination);
    c.task = 'migrate'; c.targetId = null; delete c.work;
    worker.components.person!.homeId = null;
    world.society.migrations.push({ id: 1, fromId: village.id, toId: to.id, destination: { ...destination.components.position! },
      members: [worker.id], homeIds: [destination.id], food: 0, foodGoods: {}, started: world.tick });
    world.society.nextMigrationId = 2;
    migrations(world); expect(c.behaviour?.taskId).toBe('migration');
    arrive(world, worker, destination); migrations(world);
    expect(worker.components.person!.homeId).toBe(destination.id); expect(c.villageId).toBe(to.id);
    expect(c.behaviour).toMatchObject({ status: 'completed', reason: 'Arrived at the new home' });
    expect(world.society.migrations).toHaveLength(0);
    migrations(world); expect(world.society.migrations).toHaveLength(0);
  });

  it('rejects forged suspended context and never registers unsupported catalogue tasks', () => {
    const { world, worker } = workerWorld();
    continueVillageWork(world, worker); taskLifecycle.suspend(world, worker, 'Responding to danger');
    const saved = world.snapshot(), state = saved.entities.find(e => e.id === worker.id)!.components.citizen!.behaviour!;
    state.suspendedAt = saved.tick + 1;
    expect(() => decodeSave(saved, world.registry)).toThrow();
    expect(new Set(UNIT_TASK_CATALOG.map(t => t.id)).size).toBe(UNIT_TASK_CATALOG.length);
    expect(UNIT_TASK_CATALOG.find(t => t.id === 'singing')?.support).toBe('unavailable');
    expect(taskLifecycle.start(world, worker, 'singing', 'forever')).toBe(false);
    expect(reflectionChoices({ happiness: -100, strongMinded: true })).toEqual([{ action: 'wait', weight: 1 }]);
    expect(UNIT_TASK_CATALOG.filter(t => t.group.startsWith('Reproduction')).every(t => t.owner.includes('reproduction'))).toBe(true);
  });
});
