import { describe, expect, it } from 'vitest';
import { BEHAVIOUR_CATALOG } from '../src/content/behaviour';
import { beginWait, cancelBehaviour, completeBehaviour, enterBehaviour, reconcileBehaviour } from '../src/core/behaviour';
import { deposit, stockOf } from '../src/core/resource-ledger';
import { cargoContents } from '../src/core/resource-ledger';
import { initializeStorage } from '../src/core/stockpiles';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { declareWar } from '../src/systems/diplomacy';
import { performAttack } from '../src/systems/equipment';
import { intentions, movement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { construction, startConstruction } from '../src/systems/construction';
import { diplomaticWorld, flatWorld } from './helpers';

function mining() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 16, y: 24 })!, village = assignHouse(world, home);
  initializeStorage(world, village); deposit(village, { provisions: 80 });
  const worker = world.spawn('core:person', { x: 18, y: 20 })!, source = world.spawn('core:stone', { x: 30, y: 20 })!;
  Object.assign(worker.components.person!, { age: 30, homeId: home.id, buildIn: 10000, reproduceIn: 10000 });
  Object.assign(worker.components.citizen!, { villageId: village.id, task: 'work', targetId: source.id, hunger: 0,
    work: { good: 'stone', progress: 0, cargo: null } });
  return { world, home, village, worker, source };
}
function arrive(world: World, entity: Entity, target: Entity): void {
  Object.assign(entity.components.position!, { x: target.components.position!.x - 1.8, y: target.components.position!.y });
  entity.components.citizen!.path = []; world.spatial.update(entity);
}
const ownerSystems = [{ id: 'check:existing-work', update: (world: World, dt: number) => {
  movement(world, dt);
  if (world.tick % 15 === 0) for (const e of world.query('citizen', 'position')) {
    if (world.terrain.isLand(e.components.position!.x, e.components.position!.y)) continueVillageWork(world, e);
  }
} }];

describe('behaviour sequences', () => {
  it('reaches the deposit before extraction and credits the same interrupted cargo only once', () => {
    const { world, village, worker, source } = mining(), c = worker.components.citizen!;
    const remaining = source.components.stone!.remaining;
    continueVillageWork(world, worker);
    expect(c.behaviour?.stageId).toBe('approach'); expect(c.work!.progress).toBe(0);
    expect(source.components.stone!.remaining).toBe(remaining); expect(stockOf(village, 'stone')).toBe(0);
    arrive(world, worker, source);
    for (let i = 0; i < 8; i++) { world.tick += 15; continueVillageWork(world, worker); }
    expect(c.behaviour?.stageId).toBe('carry'); expect(c.task).toBe('deliver');
    const cargo = structuredClone(c.work!.cargo!), goods = cargoContents(cargo);
    expect(source.components.stone!.remaining).toBe(remaining - goods.stone!);
    expect(stockOf(village, 'stone')).toBe(0);
    cancelBehaviour(world, worker);
    expect(c.work!.cargo).toEqual(cargo);
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(c.work!.cargo).toEqual(cargo);
    arrive(world, worker, world.entities.get(c.targetId!)!);
    continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(stockOf(village, 'stone')).toBe(goods.stone);
    expect(c.work?.cargo).toBeFalsy(); expect(c.behaviour?.status).toBe('completed');
    expect(village.economy!.deliveries).toBe(1);
  });

  it('cancels an unreachable route without mining, retaining a bounded retry deadline', () => {
    const { world, worker, source } = mining();
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    const remaining = source.components.stone!.remaining;
    continueVillageWork(world, worker);
    expect(worker.components.citizen!.behaviour).toMatchObject({ status: 'cancelled', reason: 'No route to the target', targetId: null, retryAt: world.tick + 30 });
    expect(source.components.stone!.remaining).toBe(remaining);
    expect(source.components.stone!.claims).toEqual([]);
    expect(assignVillageWork(world, worker)).toBe(false);
  });

  it('rejects a removed combat target before the attack transaction', () => {
    const world = diplomaticWorld(2), people = [...world.query('citizen')], attacker = people[0], victim = people[4];
    declareWar(world, attacker.components.citizen!.villageId!, victim.components.citizen!.villageId!);
    Object.assign(victim.components.position!, { x: attacker.components.position!.x + 1, y: attacker.components.position!.y }); world.spatial.update(victim);
    Object.assign(attacker.components.citizen!, { task: 'fight', targetId: victim.id, path: [], attackIn: 0 });
    expect(enterBehaviour(world, attacker, 'combat', 'strike')).toBe(true);
    world.remove(victim.id);
    let attempted = false;
    expect(completeBehaviour(world, attacker, () => { attempted = true; return performAttack(world, attacker, victim); })).toBe(false);
    expect(attempted).toBe(false); expect(attacker.components.citizen!.targetId).toBeNull();
    expect(world.events.some(e => e.kind === 'damage' && e.target === victim.id)).toBe(false);
  });

  it('consumes food at the home once and leaves the eating chain when hunger is satisfied', () => {
    const { world, worker, home, village } = mining(), c = worker.components.citizen!;
    arrive(world, worker, home);
    Object.assign(c, { task: 'eat', targetId: home.id, hunger: 60, reconsiderIn: 0 });
    delete c.work;
    enterBehaviour(world, worker, 'eating', 'approach');
    const food = village.food;
    world.tick = 15; intentions(world);
    expect(village.food).toBe(food - 1); expect(c.hunger).toBeLessThan(20);
    world.tick = 30; intentions(world);
    expect(village.food).toBe(food - 1);
  });

  it('does not restart a wait or consume another random draw, including pause and reload', () => {
    const base = flatWorld(), actor = base.spawn('core:person', { x: 10, y: 10 })!;
    expect(beginWait(base, actor, 'wait5')).toBe(true);
    const deadline = actor.components.citizen!.behaviour!.retryAt, rng = base.rng.state;
    for (let i = 0; i < 10; i++) expect(beginWait(base, actor, 'wait5')).toBe(true);
    expect(actor.components.citizen!.behaviour!.retryAt).toBe(deadline); expect(base.rng.state).toBe(rng);
    const saved = decodeSave(base.snapshot(), base.registry);
    const a = new World(base.seed, base.registry, saved, ownerSystems), b = new World(base.seed, base.registry, saved, ownerSystems);
    b.paused = true; const frozen = b.snapshot(); for (let i = 0; i < 60; i++) b.step();
    expect(b.snapshot()).toEqual(frozen); b.paused = false;
    for (let i = 0; i < deadline; i++) { a.step(); b.step(); }
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.entities.get(actor.id)!.components.citizen!.behaviour!.status).toBe('completed');
    expect(beginWait(b, b.entities.get(actor.id)!, 'wait5')).toBe(false);
  });

  it('resumes an active extraction and delivery with identical state and randomness', () => {
    const { world, worker, source } = mining(); arrive(world, worker, source);
    continueVillageWork(world, worker);
    const a = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry), ownerSystems);
    for (let i = 0; i < 30; i++) a.step();
    const b = new World(a.seed, a.registry, decodeSave(a.snapshot(), a.registry), ownerSystems);
    for (let i = 0; i < 420; i++) { a.step(); b.step(); }
    expect(b.snapshot()).toEqual(a.snapshot()); expect(b.rng.state).toBe(a.rng.state);
    expect(stockOf(b.society.villages[0], 'stone')).toBeGreaterThan(0);
  });

  it('leaves the water and resumes delivery without creating a second cargo', () => {
    const { world, worker, source } = mining(), c = worker.components.citizen!;
    arrive(world, worker, source);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    const cargo = structuredClone(c.work!.cargo!), p = worker.components.position!;
    world.terrain.set(Math.floor(p.x), Math.floor(p.y), Terrain.Water);
    movement(world, STEP);
    expect(c.behaviour?.taskId).toBe('swim_to_island'); expect(c.task).toBe('deliver'); expect(c.work!.cargo).toEqual(cargo);
    for (let i = 0; i < 120 && !world.terrain.isLand(p.x, p.y); i++) { world.tick++; movement(world, STEP); }
    expect(world.terrain.isLand(p.x, p.y)).toBe(true);
    continueVillageWork(world, worker);
    expect(c.task).toBe('deliver'); expect(c.work!.cargo).toEqual(cargo);
    expect(c.behaviour?.stageId).toBe('carry');
  });

  it('cancels a vanished owner and releases claims without granting stock', () => {
    const { world, worker, source, village } = mining(); arrive(world, worker, source);
    continueVillageWork(world, worker); expect(source.components.stone!.claims.length).toBe(1);
    world.society.villages = [];
    reconcileBehaviour(world, worker);
    expect(worker.components.citizen!.behaviour).toMatchObject({ status: 'cancelled', ownerId: null, targetId: null });
    expect(source.components.stone!.claims).toEqual([]); expect(stockOf(village, 'stone')).toBe(0);
  });

  it('keeps paid building progress when its builder is interrupted', () => {
    const world = flatWorld(), worker = world.spawn('core:person', { x: 22.2, y: 24 })!;
    const home = startConstruction(world, { x: 24, y: 24 }, worker)!, village = assignHouse(world, home);
    worker.components.citizen!.villageId = village.id; worker.components.person!.homeId = home.id;
    initializeStorage(world, village); deposit(village, { wood: 4 });
    for (let i = 0; i < 30; i++) { world.tick++; construction(world, STEP); }
    const project = structuredClone(home.components.building!.project!), spent = structuredClone(village.economy!.spent);
    expect(project.paid).toBe(true); expect(project.progress).toBeGreaterThan(0);
    cancelBehaviour(world, worker);
    expect(home.components.building!.project).toEqual(project); expect(village.economy!.spent).toEqual(spent);
    construction(world, STEP); expect(home.components.building!.project).toEqual(project);
  });

  it('rejects unsupported actions and invalid saved stages; old work keeps its cargo and timers', () => {
    const { world, worker } = mining();
    const before = world.snapshot();
    expect(enterBehaviour(world, worker, 'try_affect_dreams', 'effect')).toBe(false);
    expect(world.snapshot()).toEqual(before);
    expect(BEHAVIOUR_CATALOG).toHaveLength(67);
    expect(BEHAVIOUR_CATALOG.find(t => t.id === 'try_affect_dreams')?.support).toBe('unavailable');
    const old = world.snapshot(); old.version = 45;
    expect(decodeSave(old, world.registry).entities).toEqual(old.entities);
    continueVillageWork(world, worker);
    const bad = world.snapshot(); bad.entities.find(e => e.id === worker.id)!.components.citizen!.behaviour!.stageId = 'invented';
    expect(() => decodeSave(bad, world.registry)).toThrow();
  });
});
