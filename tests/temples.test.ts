import { describe, expect, it } from 'vitest';
import { BUILDINGS, buildingOwner, cancelBuildingProject, destroyBuilding, housingLimit, operational, setBuildingOwner, transferBuilding } from '../src/core/buildings';
import { deposit, reservedStock, stockOf, withdraw } from '../src/core/resource-ledger';
import { initializeStorage } from '../src/core/stockpiles';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { buildingLines } from '../src/render/buildings';
import { assignConstruction, construction, placementProblem, planBuilding, requestBuildingWork } from '../src/systems/construction';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

const cost = BUILDINGS['core:temple'].cost;
const reload = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry), []);
function hammer(world: World, worker: Entity, ticks = 400): void {
  worker.components.citizen!.path = [];
  for (let n = 0; n < ticks; n++) { world.tick++; construction(world, STEP); }
}
function fixture(funded = true) {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 24 })!, village = assignHouse(world, home);
  const worker = world.spawn('core:person', { x: 18.2, y: 24 })!;
  Object.assign(worker.components.person!, { age: 25, homeId: home.id });
  Object.assign(worker.components.citizen!, { villageId: village.id, hunger: 10 });
  initializeStorage(world, village);
  if (funded) deposit(village, cost);
  return { world, home, village, worker,
    plan: () => planBuilding(world, 'core:temple', { x: 20, y: 24 }, village, worker)! };
}

describe('temple construction and one housing bonus per settlement', () => {
  it('keeps a poor settlement at a plan, then reserves and pays once for real work', () => {
    const f = fixture(false), before = housingLimit(f.world, f.village), site = f.plan();
    expect(site.components.building!.state).toBe('planned');
    expect(assignConstruction(f.world, f.worker)).toBe(false);
    hammer(f.world, f.worker); expect(site.components.building!.project!.progress).toBe(0);
    expect(housingLimit(f.world, f.village)).toEqual(before);
    expect(planBuilding(f.world, 'core:temple', { x: 12, y: 18 }, f.village)).toBeUndefined();
    deposit(f.village, cost); expect(assignConstruction(f.world, f.worker)).toBe(true);
    expect(reservedStock(f.world, f.village)).toEqual(cost);
    hammer(f.world, f.worker, 60); expect(site.components.building!.project!.paid).toBe(true);
    expect(housingLimit(f.world, f.village).limit).toBe(before.limit);
    hammer(f.world, f.worker); expect(operational(site)).toBe(true);
    expect(housingLimit(f.world, f.village).limit).toBe(before.limit + 2);
    expect(f.village.economy!.spent).toEqual(cost);
    expect(f.home.components.dwelling!.capacity).toBe(5); expect(site.components.dwelling).toBeUndefined();
  });
  it('releases only unpaid claims on cancellation and never refunds paid work', () => {
    const f = fixture(), first = f.plan(); cancelBuildingProject(f.world, first);
    expect(stockOf(f.village, 'gold')).toBe(10); expect(reservedStock(f.world, f.village)).toEqual({});
    const next = f.plan(); hammer(f.world, f.worker, 60); cancelBuildingProject(f.world, next);
    expect(stockOf(f.village, 'gold')).toBe(0); expect(housingLimit(f.world, f.village).bonus).toBe(0);
    const last = f.plan(); hammer(f.world, f.worker);
    expect(last.components.building!.project!.progress).toBe(0);
  });
  it('requires the whole footprint inside the village, dry and unobstructed', () => {
    const f = fixture();
    expect(placementProblem(f.world, 'core:temple', { x: 23, y: 24 }, f.village)).toBe('Plot is outside the settlement borders');
    f.world.terrain.set(22, 22, Terrain.Water); expect(f.plan()).toBeUndefined();
    f.world.terrain.set(22, 22, Terrain.Grass);
    f.world.spawn('core:stone', { x: 22.5, y: 22.5 }); expect(f.plan()).toBeUndefined();
  });
  it('requires a reachable builder and stops progress if the route is lost', () => {
    const f = fixture();
    for (let y = 0; y < 48; y++) f.world.terrain.set(17, y, Terrain.Water);
    Object.assign(f.worker.components.position!, { x: 14, y: 24 }); f.world.spatial.update(f.worker);
    expect(f.plan()).toBeUndefined();
    for (let y = 0; y < 48; y++) f.world.terrain.set(17, y, Terrain.Grass);
    Object.assign(f.worker.components.position!, { x: 18.2, y: 24 }); f.world.spatial.update(f.worker);
    const site = f.plan(); hammer(f.world, f.worker, 60);
    const progress = site.components.building!.project!.progress;
    for (let y = 0; y < 48; y++) f.world.terrain.set(19, y, Terrain.Water);
    hammer(f.world, f.worker); expect(site.components.building!.project!.progress).toBe(progress);
    expect(f.village.economy!.spent).toEqual(cost);
  });
  it('keeps paid progress through reload and worker death; pause does no work', () => {
    const f = fixture(), site = f.plan(); hammer(f.world, f.worker, 60);
    const world = reload(f.world), savedSite = world.entities.get(site.id)!, progress = savedSite.components.building!.project!.progress;
    world.remove(f.worker.id);
    const worker = world.spawn('core:person', { x: 18.2, y: 24 })!;
    worker.components.citizen!.villageId = f.village.id;
    expect(assignConstruction(world, worker)).toBe(true);
    world.paused = true; hammer(world, worker); expect(savedSite.components.building!.project!.progress).toBe(progress);
    world.paused = false; hammer(world, worker);
    expect(operational(savedSite)).toBe(true); expect(world.society.villages[0].economy!.spent).toEqual(cost);
    expect(housingLimit(reload(world), world.society.villages[0]).bonus).toBe(2);
  });
  it('preserves unpaid claims across reload without creating additional materials', () => {
    const f = fixture(), site = f.plan(), world = reload(f.world), village = world.society.villages[0];
    expect(reservedStock(world, village)).toEqual(cost);
    hammer(world, world.entities.get(f.worker.id)!);
    expect(operational(world.entities.get(site.id)!)).toBe(true); expect(village.economy!.spent).toEqual(cost);
    expect(stockOf(village, 'gold')).toBe(0); expect(reservedStock(world, village)).toEqual({});
  });
  it('keeps captured temples intact, credits only one, and recomputes after destruction or reload', () => {
    const f = fixture(), temple = f.plan(); hammer(f.world, f.worker);
    const otherHome = f.world.spawn('core:house', { x: 34, y: 24 })!, other = assignHouse(f.world, otherHome);
    const captured = f.world.spawn('core:temple', { x: 26, y: 24 })!; setBuildingOwner(captured, other.id);
    captured.components.building!.architecture = 'elf';
    expect(transferBuilding(f.world, captured, f.village)).toBe(true);
    expect(buildingOwner(captured)).toBe(f.village.id); expect(captured.components.building!.architecture).toBe('elf');
    expect(housingLimit(f.world, f.village).bonus).toBe(2); expect(housingLimit(f.world, other).bonus).toBe(0);
    expect(buildingLines(f.world, captured, 'en')).toContain('Another temple already provides this bonus');
    const world = reload(f.world); expect(housingLimit(world, world.society.villages[0]).bonus).toBe(2);
    destroyBuilding(world, world.entities.get(temple.id)!); expect(housingLimit(world, world.society.villages[0]).bonus).toBe(2);
    destroyBuilding(world, world.entities.get(captured.id)!); expect(housingLimit(world, world.society.villages[0]).bonus).toBe(0);
    expect(world.entities.has(f.home.id)).toBe(true); expect(world.entities.get(f.home.id)!.components.dwelling!.capacity).toBe(5);
  });
  it('blocks new houses above the reduced limit without removing already built housing', () => {
    const f = fixture(), temple = f.plan(); hammer(f.world, f.worker);
    const homes = [{ x: 4, y: 20 }, { x: 4, y: 28 }, { x: 12, y: 32 }, { x: 20, y: 32 }].map(p => {
      const home = f.world.spawn('core:house', p)!; assignHouse(f.world, home); return home;
    });
    expect(housingLimit(f.world, f.village).used).toBe(5);
    expect(placementProblem(f.world, 'core:house', { x: 12, y: 18 }, f.village)).toBeUndefined();
    destroyBuilding(f.world, temple);
    expect(placementProblem(f.world, 'core:house', { x: 12, y: 18 }, f.village)).toBe('Housing limit reached');
    for (const home of homes) { expect(f.world.entities.has(home.id)).toBe(true); expect(home.components.dwelling!.capacity).toBe(5); }
  });
  it('transfers a paid project without billing its new owner and preserves that agreement on reload', () => {
    const f = fixture(), site = f.plan(); hammer(f.world, f.worker, 60);
    const home = f.world.spawn('core:house', { x: 34, y: 24 })!, owner = assignHouse(f.world, home);
    expect(transferBuilding(f.world, site, owner)).toBe(true);
    const worker = f.world.spawn('core:person', { x: 21.8, y: 24 })!;
    worker.components.citizen!.villageId = owner.id;
    expect(assignConstruction(f.world, worker)).toBe(true);
    const world = reload(f.world); hammer(world, world.entities.get(worker.id)!);
    expect(operational(world.entities.get(site.id)!)).toBe(true);
    expect(world.society.villages.find(v => v.id === owner.id)!.economy!.spent?.gold ?? 0).toBe(0);
    expect(housingLimit(world, world.society.villages.find(v => v.id === owner.id)!).bonus).toBe(2);
  });
  it('resists heat and fire damage, loses the bonus to a blast, and rebuilds only after full repayment', () => {
    const f = fixture(), site = f.plan(); hammer(f.world, f.worker);
    f.world.registry.applyEvent(f.world, { kind: 'heat', target: site.id, amount: 10000 });
    f.world.registry.applyEvent(f.world, { kind: 'damage', target: site.id, amount: 10000, cause: 'fire' });
    expect(site.components.thermal!.burning).toBe(false); expect(site.components.health!.current).toBe(1500);
    f.world.registry.applyEvent(f.world, { kind: 'damage', target: site.id, amount: 1500, cause: 'explosion' });
    expect(housingLimit(f.world, f.village).bonus).toBe(0);
    const ruin = [...f.world.query('ruin')][0];
    const rebuilt = planBuilding(f.world, 'core:temple', site.components.position!, f.village, f.worker, ruin)!;
    hammer(f.world, f.worker); expect(rebuilt.components.building!.project!.progress).toBe(0);
    deposit(f.village, cost); expect(assignConstruction(f.world, f.worker)).toBe(true); hammer(f.world, f.worker);
    expect(housingLimit(f.world, f.village).bonus).toBe(2); expect(f.village.economy!.spent!.gold).toBe(20);
    expect(() => reload(f.world)).not.toThrow();
  });
  it('keeps the completed bonus during repairs and removes it when the ground disappears', () => {
    const f = fixture(), site = f.plan(); hammer(f.world, f.worker);
    site.components.health!.current = 500; deposit(f.village, BUILDINGS['core:temple'].repair);
    expect(requestBuildingWork(f.world, site, 'repair')).toBe(true); expect(housingLimit(f.world, f.village).bonus).toBe(2);
    expect(assignConstruction(f.world, f.worker)).toBe(true); hammer(f.world, f.worker);
    expect(site.components.health!.current).toBe(1500);
    f.world.terrain.set(20, 24, Terrain.Water);
    expect(housingLimit(f.world, f.village).bonus).toBe(0);
  });
  it('does not grant old worlds a temple or free resources and rejects invalid temple saves', () => {
    const f = fixture(false), before = f.world.snapshot(), old = reload(f.world);
    expect([...old.query('temple')]).toHaveLength(0); expect(stockOf(old.society.villages[0], 'gold')).toBe(0);
    expect(housingLimit(old, old.society.villages[0]).bonus).toBe(0); expect(before.entities.some(e => e.typeId === 'core:temple')).toBe(false);
    deposit(f.village, cost); const site = f.plan();
    const invalid = f.world.snapshot(); invalid.entities.find(e => e.id === site.id)!.components.temple!.villageId = 999;
    expect(() => decodeSave(invalid, f.world.registry)).toThrow();
    const forged = f.world.snapshot(), project = forged.entities.find(e => e.id === site.id)!.components.building!.project!;
    project.legacyGoldCost = true; delete project.cost.gold;
    expect(() => decodeSave(forged, f.world.registry)).toThrow();
    cancelBuildingProject(f.world, site); expect(withdraw(f.village, cost)).toBe(true);
  });
});
