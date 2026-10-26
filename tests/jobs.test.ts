import { describe, expect, it } from 'vitest';
import { diplomaticWorld, flatWorld } from './helpers';
import { World } from '../src/core/world';
import { STEP, type Entity } from '../src/core/types';
import { assignHouse } from '../src/systems/society';
import { declareWar } from '../src/systems/diplomacy';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { emergencies } from '../src/systems/emergencies';
import { initializeStorage } from '../src/core/stockpiles';
import { bundleLoad } from '../src/core/resources';
import { cargoContents, deposit, stockOf } from '../src/core/resource-ledger';
import { transferBuilding } from '../src/core/buildings';
import { claimJob, cancelJob, jobEligibility, jobVacancies, professionOf, reconcileJobs, validJobsSave } from '../src/core/jobs';
import { decodeSave } from '../src/persistence/schema';

function settlement(count = 3) {
  const world = flatWorld(), home = world.spawn('core:house', { x: 22, y: 24 })!, village = assignHouse(world, home);
  village.food = 90; village.migrationAfter = 100000;
  const market = world.spawn('core:market', { x: 16, y: 26 })!; market.components.workplace!.villageId = village.id;
  const people = Array.from({ length: count }, (_, i) => world.spawn('core:person', { x: 18 + i * 2, y: 20 })!);
  for (const e of people) {
    Object.assign(e.components.person!, { homeId: home.id, age: 25, reproduceIn: 100000, buildIn: 100000 });
    e.components.citizen!.villageId = village.id;
  }
  const source = world.spawn('core:stone', { x: 30, y: 24 })!;
  initializeStorage(world, village);
  return { world, home, village, market, people, worker: people[0], source };
}
function arrive(world: World, worker: Entity): void {
  Object.assign(worker.components.position!, { x: 28.5, y: 24.5 });
  worker.components.citizen!.path = []; world.spatial.update(worker);
}

describe('civil jobs and professional roles', () => {
  it('reserves the last vacancy during the approach and rejects duplicate saved slots', () => {
    const { world, worker, people, source } = settlement();
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(worker.components.citizen!.jobAssignment?.kind).toBe('depositMiner');
    expect(claimJob(world, people[1], 'depositMiner', source.id, 'stone')).toBe(false);
    const snapshot = world.snapshot(), a = snapshot.entities.find(e => e.id === worker.id)!, b = snapshot.entities.find(e => e.id === people[1].id)!;
    b.components.citizen = structuredClone(a.components.citizen);
    expect(validJobsSave(snapshot)).toBe(false);
  });

  it('preserves an extracted load when hunger interrupts delivery', () => {
    const { world, worker, source } = settlement();
    expect(assignVillageWork(world, worker)).toBe(true); arrive(world, worker);
    for (let n = 0; n < 8; n++) continueVillageWork(world, worker);
    const c = worker.components.citizen!, cargo = structuredClone(c.work!.cargo);
    expect(cargoContents(cargo!)).toEqual({ stone: 4 });
    c.hunger = 75; continueVillageWork(world, worker);
    expect(c.jobAssignment).toBeUndefined(); expect(c.work!.cargo).toEqual(cargo);
    expect(source.components.stone!.remaining).toBe(20);
    c.hunger = 10; expect(assignVillageWork(world, worker)).toBe(true);
    expect(c.work!.cargo).toEqual(cargo);
  });

  it('releases a mining reservation at a full store without extracting or losing stock', () => {
    const { world, worker, village, source } = settlement();
    expect(assignVillageWork(world, worker)).toBe(true);
    for (const s of village.economy!.storage!) s.capacity = bundleLoad(s.goods).volume + (s.equipmentVolume ?? 0);
    arrive(world, worker); continueVillageWork(world, worker);
    expect(worker.components.citizen!.jobAssignment).toBeUndefined();
    expect(source.components.stone!.remaining).toBe(24); expect(source.components.stone!.claims).toHaveLength(0);
    expect(stockOf(village, 'stone')).toBe(0);
  });

  it('keeps political office separate from service and bans ruler mining and farming', () => {
    const { world, worker, village } = settlement();
    worker.components.citizen!.profession = { villageId: village.id, office: 'king', service: 'civilian' };
    expect(jobEligibility(world, worker, 'depositMiner')).toBe('Ruler duties');
    expect(jobEligibility(world, worker, 'farmer')).toBe('Ruler duties');
    expect(jobEligibility(world, worker, 'builder')).toBeUndefined();
  });

  it('keeps a warrior on duty while eating and frees civil work on demobilization', () => {
    const world = diplomaticWorld(2), [village, other] = world.society.villages;
    const people = [...world.query('person', 'citizen')].filter(e => e.components.citizen!.villageId === village.id);
    const worker = people.find(e => e.id % 3 !== 0)!;
    expect(declareWar(world, village.id, other.id)).toBeDefined(); worker.components.citizen!.task = 'eat';
    expect(professionOf(world, worker).service).toBe('warrior');
    expect(jobEligibility(world, worker, 'blacksmith')).toBe('Military service');
    world.society.wars = []; reconcileJobs(world);
    expect(professionOf(world, worker).service).toBe('civilian');
    expect(jobEligibility(world, worker, 'blacksmith')).toBeUndefined();
  });

  it('removes a source reference and releases the vacancy synchronously', () => {
    const { world, worker, source } = settlement();
    assignVillageWork(world, worker); world.remove(source.id);
    expect(worker.components.citizen!.jobAssignment).toBeUndefined();
    expect(worker.components.citizen!.targetId).toBeNull();
    expect(validJobsSave(world.snapshot())).toBe(true);
  });

  it('does not wet a fire before the firefighter has reached it', () => {
    const { world, worker } = settlement();
    const fire = world.spawn('core:tree', { x: 28, y: 20 })!;
    Object.assign(fire.components.thermal!, { burning: true, temperature: 60, wetness: 0 });
    world.tick = worker.id % 15;
    emergencies(world, STEP);
    expect(worker.components.citizen!.emergency?.kind).toBe('extinguish');
    emergencies(world, STEP); expect(fire.components.thermal!.wetness).toBe(0);
    Object.assign(worker.components.position!, { x: 24.5, y: 20.5 }); world.spatial.update(worker);
    worker.components.citizen!.emergency!.path = [];
    emergencies(world, STEP); expect(fire.components.thermal!.wetness).toBeGreaterThan(0);
  });

  it('resumes the same half-finished extraction after loading without an extra random draw', () => {
    const { world, worker } = settlement();
    assignVillageWork(world, worker); arrive(world, worker);
    continueVillageWork(world, worker); continueVillageWork(world, worker);
    const copy = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    for (let n = 0; n < 6; n++) { continueVillageWork(world, worker); continueVillageWork(copy, copy.entities.get(worker.id)!); }
    expect(copy.snapshot()).toEqual(world.snapshot());
    world.paused = true; const paused = world.snapshot();
    world.step(); continueVillageWork(world, worker); emergencies(world, STEP);
    expect(world.snapshot()).toEqual(paused);
  });

  it('does not open jobs whose sources or buildings do not exist', () => {
    const { world, village } = settlement();
    const vacancies = jobVacancies(world, village);
    for (const kind of ['manureCleaner', 'bushGatherer', 'herbGatherer', 'honeyGatherer', 'miner'])
      expect(vacancies.find(j => j.kind === kind)).toMatchObject({ limit: 0, filled: 0, shortage: 0 });
  });

  it('cancellation retains a carried batch and never refunds already spent resources', () => {
    const { world, worker, village, source } = settlement();
    assignVillageWork(world, worker); arrive(world, worker);
    for (let n = 0; n < 8; n++) continueVillageWork(world, worker);
    const stock = stockOf(village, 'stone'), remaining = source.components.stone!.remaining;
    cancelJob(world, worker, 'Responding to danger'); cancelJob(world, worker, 'Responding to danger');
    expect(worker.components.citizen!.work!.cargo?.amount).toBe(4);
    expect(stockOf(village, 'stone')).toBe(stock); expect(source.components.stone!.remaining).toBe(remaining);
  });

  it('spends a recipe once and retains its product after interruption and station destruction', () => {
    const { world, worker, village } = settlement();
    const bakery = world.spawn('core:bakery', { x: 26, y: 20 })!;
    bakery.components.workplace!.villageId = village.id; deposit(village, { flour: 2 });
    Object.assign(worker.components.position!, { x: 24.5, y: 20.5 }); world.spatial.update(worker);
    Object.assign(worker.components.citizen!, { task: 'work', targetId: bakery.id, path: [], work: { good: 'bread', progress: 0, cargo: null } });
    for (let n = 0; n < 8; n++) continueVillageWork(world, worker);
    expect(worker.components.citizen!.work!.cargo?.amount).toBe(4);
    expect(village.economy!.spent!.flour).toBe(2);
    cancelJob(world, worker, 'Responding to danger'); world.remove(bakery.id);
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(worker.components.citizen!.work!.cargo?.amount).toBe(4);
    expect(village.economy!.spent!.flour).toBe(2); expect(stockOf(village, 'flour')).toBe(0);
  });

  it('cancels a transferred workplace and returns its unspent reservation to the old owner', () => {
    const { world, worker, village } = settlement();
    const bakery = world.spawn('core:bakery', { x: 26, y: 20 })!;
    bakery.components.workplace!.villageId = village.id; deposit(village, { flour: 2 });
    Object.assign(worker.components.position!, { x: 24.5, y: 20.5 }); world.spatial.update(worker);
    Object.assign(worker.components.citizen!, { task: 'work', targetId: bakery.id, path: [], work: { good: 'bread', progress: 0, cargo: null } });
    continueVillageWork(world, worker);
    const other = assignHouse(world, world.spawn('core:house', { x: 4, y: 4 })!);
    transferBuilding(world, bakery, other);
    expect(worker.components.citizen!.jobAssignment).toBeUndefined();
    expect(worker.components.citizen!.targetId).toBeNull();
    expect(village.economy!.storage!.flatMap(s => s.reservations)).toHaveLength(0);
    expect(stockOf(village, 'flour')).toBe(2);
  });
});
