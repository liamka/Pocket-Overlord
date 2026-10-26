import { settlement } from '../src/systems/people';
import { migrations } from '../src/systems/migration';
import { describe, expect, it } from 'vitest';
import { BUILDINGS, applyArchitectureEnvironment, beginProject, buildingOwner, cancelBuildingProject, configureArchitecture, destroyBuilding, hasCapability, housingLimit, maintainBuildings, operational, setBuildingOwner, transferBuilding } from '../src/core/buildings';
import { NaturalBiome } from '../src/core/natural-biomes';
import { deposit, reservedStock, stockOf } from '../src/core/resource-ledger';
import { initializeStorage, storesOf } from '../src/core/stockpiles';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { assignConstruction, construction, planBuilding, requestBuildingWork } from '../src/systems/construction';
import { economy, marketOf } from '../src/systems/economy';
import { agriculture, assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 24 })!, village = assignHouse(world, home);
  const worker = world.spawn('core:person', { x: 18.2, y: 24 })!;
  Object.assign(worker.components.person!, { age: 25, homeId: home.id, buildIn: 10000 });
  Object.assign(worker.components.citizen!, { villageId: village.id, hunger: 10 });
  initializeStorage(world, village); deposit(village, { wood: 40, stone: 40, commonMetal: 4 });
  const site = (type = 'core:market') => planBuilding(world, type, { x: 20, y: 24 }, village, worker)!;
  const hammer = (n = 340) => { worker.components.citizen!.path = []; for (let i = 0; i < n; i++) { world.tick++; construction(world, STEP); } };
  return { world, home, village, worker, site, hammer };
}
const reload = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry), []);

describe('shared building catalogue', () => {
  it.each(Object.keys(BUILDINGS).filter(id => id !== 'core:harbor'))('%s uses one recipe and actual work before activating', kind => {
    const f = fixture();
    if (kind === 'core:temple') deposit(f.village, { gold: 10 });
    const site = f.site(kind), cost = BUILDINGS[kind].cost;
    expect(site).toBeDefined(); expect(operational(site)).toBe(false);
    expect(reservedStock(f.world, f.village)).toEqual(cost);
    expect(stockOf(f.village, 'wood')).toBe(40);
    f.hammer(60); expect(site.components.building!.project!.paid).toBe(true);
    expect(stockOf(f.village, 'wood')).toBe(40 - (cost.wood ?? 0));
    f.hammer(); expect(operational(site)).toBe(true); expect(site.components.building!.project).toBeUndefined();
    expect(f.village.economy!.spent?.wood ?? 0).toBe(cost.wood ?? 0);
    expect(() => reload(f.world)).not.toThrow();
  });
  it('keeps material claims through save and worker death, then charges the replacement exactly once', () => {
    const f = fixture(), site = f.site();
    const restored = reload(f.world), village = restored.society.villages[0], savedSite = restored.entities.get(site.id)!;
    expect(reservedStock(restored, village)).toEqual({ wood: 4 });
    restored.remove(f.worker.id);
    const replacement = restored.spawn('core:person', { x: 18.2, y: 24 })!;
    replacement.components.citizen!.villageId = village.id;
    expect(assignConstruction(restored, replacement)).toBe(true); replacement.components.citizen!.path = [];
    for (let i = 0; i < 340; i++) { restored.tick++; construction(restored, STEP); }
    expect(operational(savedSite)).toBe(true); expect(stockOf(village, 'wood')).toBe(36);
    expect(village.economy!.spent).toEqual({ wood: 4 }); expect(() => reload(restored)).not.toThrow();
  });
  it('cancellation releases an unpaid reserve; paid work and finished demolition never refund materials', () => {
    const f = fixture(), unpaid = f.site();
    cancelBuildingProject(f.world, unpaid);
    expect(stockOf(f.village, 'wood')).toBe(40); expect(reservedStock(f.world, f.village)).toEqual({});
    const paid = f.site(); f.hammer(60); cancelBuildingProject(f.world, paid);
    expect(stockOf(f.village, 'wood')).toBe(36);
    const finished = f.site(); f.hammer(); destroyBuilding(f.world, finished);
    expect(stockOf(f.village, 'wood')).toBe(32);
    const ruin = [...f.world.query('ruin')][0];
    expect(requestBuildingWork(f.world, ruin, 'clear')).toBe(true);
    expect(assignConstruction(f.world, f.worker)).toBe(true); f.hammer();
    expect(f.world.entities.has(ruin.id)).toBe(false); expect(stockOf(f.village, 'wood')).toBe(32);
  });
  it('two plots cannot reserve the same units and a planned market has no effect', () => {
    const f = fixture(); storesOf(f.village)[0].goods.wood = 4;
    // The stock view is rebuilt by storage maintenance before claims are read.
    f.world.snapshot();
    const first = f.site(), second = planBuilding(f.world, 'core:market', { x: 24, y: 24 }, f.village)!;
    expect(marketOf(f.world, f.village.id)).toBeUndefined(); expect(housingLimit(f.world, f.village).bonus).toBe(0);
    f.worker.components.citizen!.task = 'idle';
    expect(reservedStock(f.world, f.village)).toEqual({ wood: 4 });
    expect(second.components.building!.state).toBe('planned');
    expect(storesOf(f.village).some(s => s.buildingId === first.id || s.buildingId === second.id)).toBe(false);
    cancelBuildingProject(f.world, first); expect(reservedStock(f.world, f.village)).toEqual({});
  });
  it('does not work across a water gap and freezes on pause', () => {
    const f = fixture(), site = f.site(); f.hammer(60);
    const progress = site.components.building!.project!.progress;
    f.world.paused = true; const frozen = f.world.snapshot(); f.hammer(60); f.world.tick = frozen.tick;
    expect(f.world.snapshot()).toEqual(frozen);
    f.world.paused = false;
    for (let y = 0; y < 48; y++) f.world.terrain.set(19, y, Terrain.Water);
    f.hammer(); expect(site.components.building!.project!.progress).toBe(progress);
    expect(f.village.economy!.spent).toEqual({ wood: 4 });
  });
  it('repairs with a separate paid project and preserves damage and progress through reload', () => {
    const f = fixture(), site = f.site(); f.hammer(); site.components.health!.current = 30;
    maintainBuildings(f.world); expect(site.components.building!.state).toBe('damaged');
    expect(requestBuildingWork(f.world, site, 'repair')).toBe(true); expect(assignConstruction(f.world, f.worker)).toBe(true);
    f.hammer(60); const restored = reload(f.world), copy = restored.entities.get(site.id)!;
    expect(copy.components.health!.current).toBe(30); expect(copy.components.building!.project!.action).toBe('repair');
    for (let n = 0; n < 180; n++) { f.world.tick++; restored.tick++; construction(f.world, STEP); construction(restored, STEP); }
    expect(copy.components.health!.current).toBe(copy.components.health!.max);
    expect(f.world.snapshot()).toEqual(restored.snapshot()); expect(stockOf(f.village, 'wood')).toBe(35);
  });
  it('capture transfers intact stock and paid work without changing the architecture or charging again', () => {
    const f = fixture(), site = f.site('core:stockpile'); f.hammer();
    deposit(f.village, { gems: 3 }, site.id);
    const home = f.world.spawn('core:house', { x: 42, y: 42 })!, owner = assignHouse(f.world, home);
    initializeStorage(f.world, owner); transferBuilding(f.world, site, owner);
    expect(buildingOwner(site)).toBe(owner.id); expect(stockOf(f.village, 'gems')).toBe(0); expect(stockOf(owner, 'gems')).toBe(3);
    expect(site.components.building!.architecture).toBe('human');
    const saved = reload(f.world); expect(buildingOwner(saved.entities.get(site.id)!)).toBe(owner.id);
    const pending = planBuilding(f.world, 'core:workshop', { x: 24, y: 24 }, f.village, f.worker)!;
    Object.assign(f.worker.components.position!, { x: 22.2, y: 24 }); f.world.spatial.update(f.worker); f.hammer(60);
    transferBuilding(f.world, pending, owner); expect(pending.components.building!.project!.paid).toBe(true);
    expect(reservedStock(f.world, f.village)).toEqual({}); expect(() => reload(f.world)).not.toThrow();
  });
  it('keeps a captured architecture and does not move displaced residents into a foreign settlement', () => {
    const f = fixture(), home = f.world.spawn('core:house', { x: 42, y: 42 })!;
    configureArchitecture(home, 'orc'); const owner = assignHouse(f.world, home);
    transferBuilding(f.world, f.home, owner);
    expect(f.home.components.building!.architecture).toBe('human'); expect(f.worker.components.person!.homeId).toBeNull();
    f.world.tick = 1800; settlement(f.world); migrations(f.world);
    expect(f.worker.components.person!.homeId).toBeNull(); expect(f.worker.components.citizen!.villageId).toBe(f.village.id);
    expect(f.world.society.migrations).toHaveLength(0); expect(() => reload(f.world)).not.toThrow();
  });
  it('ruins lose contents; rebuilding pays anew, and intact abandoned buildings remain usable', () => {
    const f = fixture(), site = f.site('core:stockpile'); f.hammer(); deposit(f.village, { gems: 2 }, site.id);
    destroyBuilding(f.world, site); const ruin = [...f.world.query('ruin')][0];
    expect(operational(ruin)).toBe(false); expect(f.village.economy!.lost!.gems).toBe(2);
    const rebuilt = planBuilding(f.world, 'core:stockpile', { x: 20, y: 24 }, f.village, f.worker, ruin)!;
    f.hammer(); expect(stockOf(f.village, 'wood')).toBe(28); expect(stockOf(f.village, 'gems')).toBe(0);
    f.world.remove(f.worker.id); maintainBuildings(f.world);
    expect(rebuilt.components.building!.state).toBe('abandoned'); expect(operational(rebuilt)).toBe(true);
    expect(() => reload(f.world)).not.toThrow();
  });
  it('reoccupies an intact abandoned workplace after a resident reaches it, without rebuilding or paying again', () => {
    const f = fixture(), workplace = f.site('core:workshop'); f.hammer();
    f.home.components.building!.level = 2; Object.assign(f.home.components.dwelling!, { level: 2, capacity: 7 });
    f.home.components.health = { current: 300, max: 300 };
    setBuildingOwner(workplace, null); workplace.components.building!.state = 'abandoned';
    const wood = stockOf(f.village, 'wood');
    expect(assignConstruction(f.world, f.worker)).toBe(true);
    expect(buildingOwner(workplace)).toBe(f.village.id); expect(operational(workplace)).toBe(true);
    expect(workplace.components.building!.project).toBeUndefined(); expect(stockOf(f.village, 'wood')).toBe(wood);
    expect(() => reload(f.world)).not.toThrow();
  });
  it('losing the market bonus leaves existing houses but refuses another plot, independently of beds', () => {
    const f = fixture(), market = f.site(); f.hammer();
    const limit = housingLimit(f.world, f.village).limit;
    for (let n = 1; n < limit; n++) {
      const h = f.world.spawn('core:house', { x: 5 + n * 4, y: 10 })!; h.components.dwelling!.villageId = f.village.id;
    }
    const homes = f.world.houseCount; destroyBuilding(f.world, market);
    const after = housingLimit(f.world, f.village); expect(after.limit).toBe(limit - 2); expect(after.used).toBe(homes);
    expect(planBuilding(f.world, 'core:house', { x: 30, y: 32 }, f.village)).toBeUndefined();
    f.home.components.dwelling!.capacity = 7; expect(housingLimit(f.world, f.village)).toEqual(after);
  });
  it('destruction of ground and disappearance of the owner preserve a loadable building state', () => {
    const f = fixture(), site = f.site(); f.hammer();
    f.world.terrain.set(20, 24, Terrain.Water); maintainBuildings(f.world);
    expect(f.world.entities.has(site.id)).toBe(false);
    f.world.society.villages = []; f.world.remove(f.worker.id); maintainBuildings(f.world);
    expect(f.home.components.dwelling!.villageId).toBeNull(); expect(f.home.components.building!.state).toBe('abandoned');
    expect(() => reload(f.world)).not.toThrow();
  });
  it('natural sources have no construction obligations; architecture spreading needs explicit law permission', () => {
    const f = fixture(), tree = f.world.spawn('core:tree', { x: 30, y: 10 })!, ore = f.world.spawn('core:stone', { x: 34, y: 10 })!;
    for (const e of [tree, ore]) { expect(e.components.building).toBeUndefined(); expect(hasCapability(e, 'housing')).toBe(false); }
    f.home.components.building!.architecture = 'demon';
    applyArchitectureEnvironment(f.world, f.home, false); expect(f.world.terrain.biomeAt(12, 24).id).toBe(NaturalBiome.Grassland);
    applyArchitectureEnvironment(f.world, f.home, true); expect(f.world.terrain.biomeAt(12, 24).id).toBe(NaturalBiome.Infernal);
    f.world.terrain.setBiome(12, 24, NaturalBiome.Grassland); beginProject(f.home, 'repair');
    applyArchitectureEnvironment(f.world, f.home, true); expect(f.world.terrain.biomeAt(12, 24).id).toBe(NaturalBiome.Grassland);
  });
  it('migrates ready buildings and paid legacy projects without generating buildings or spending historical costs', () => {
    const f = fixture(), port = f.world.spawn('core:harbor', { x: 24, y: 12 })!;
    const old = f.world.snapshot(); old.version = 34;
    for (const e of old.entities) delete e.components.building;
    const home = old.entities.find(e => e.id === f.home.id)!;
    Object.assign(home.components.dwelling!, { construction: { progress: 0.4, struckAt: 0, upgrade: true } });
    old.entities.find(e => e.id === port.id)!.components.harbor!.built = 0.3;
    const migrated = decodeSave(old, f.world.registry);
    expect(migrated.entities).toHaveLength(old.entities.length); expect(migrated.society).toEqual(old.society);
    expect(migrated.entities.find(e => e.id === home.id)!.components.building!.project).toMatchObject({ action: 'upgrade', paid: true, progress: 0.4 });
    expect(migrated.entities.find(e => e.id === port.id)!.components.building!.project).toMatchObject({ action: 'build', paid: true, progress: 0.3 });
    expect(decodeSave(migrated, f.world.registry)).toEqual(migrated);
  });
  it('rejects storage attached to ruins or a building without storage capability', () => {
    const f = fixture(), workshop = f.world.spawn('core:workshop', { x: 30, y: 12 })!;
    setBuildingOwner(workshop, f.village.id);
    const ruin = f.world.spawn('core:ruin', { x: 32, y: 32 })!; setBuildingOwner(ruin, f.village.id);
    const good = f.world.snapshot();
    for (const entity of [workshop, ruin]) {
      const bad = structuredClone(good); bad.society.villages[0].economy!.storage![0].buildingId = entity.id;
      expect(() => decodeSave(bad, f.world.registry)).toThrow();
    }
  });
  it('rejects forged prices, paid flags, levels and work timestamps', () => {
    const f = fixture(); f.site(); f.hammer(60); const good = f.world.snapshot();
    for (const corrupt of [
      (e: Entity) => { e.components.building!.project!.cost.wood = 0; },
      (e: Entity) => { e.components.building!.project!.paid = false; },
      (e: Entity) => { e.components.building!.project!.struckAt = good.tick + 1; },
      (e: Entity) => { e.components.building!.architecture = 'ice'; e.components.building!.level = 2; },
    ]) { const bad = structuredClone(good); corrupt(bad.entities.find(e => e.components.building?.project)!); expect(() => decodeSave(bad, f.world.registry)).toThrow(); }
  });
  it('planned farms never grow and economy creates construction plans, not free workplaces', () => {
    const f = fixture(), field = f.site('core:farm'); f.worker.components.citizen!.task = 'farm'; f.worker.components.citizen!.targetId = field.id;
    f.world.tick = 900; agriculture(f.world); expect(field.components.farm!.growth).toBe(0);
    for (const x of [14, 16]) { const p = f.world.spawn('core:person', { x, y: 22 })!; p.components.citizen!.villageId = f.village.id; }
    f.village.economy!.buildAfter = 0; economy(f.world);
    const market = [...f.world.query('workplace')][0]; expect(market.components.building!.project).toBeDefined(); expect(marketOf(f.world, f.village.id)).toBeUndefined();
  });
});
