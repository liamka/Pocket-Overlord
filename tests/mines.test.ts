import { describe, expect, it } from 'vitest';
import { BUILDINGS, cancelBuildingProject, destroyBuilding, setBuildingOwner, transferBuilding } from '../src/core/buildings';
import { biomeMineralWeights, selectBiomeMineral } from '../src/core/biome-minerals';
import { mineDemand, mineDepositSite, mineWorkers, insideMine, MINE } from '../src/core/mines';
import { NaturalBiome } from '../src/core/natural-biomes';
import { mineralDeposit } from '../src/core/deposits';
import { deposit, stockContents, stockOf } from '../src/core/resource-ledger';
import { Random } from '../src/core/random';
import { initializeStorage } from '../src/core/stockpiles';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { assignConstruction, construction, continueConstruction, placementProblem, planBuilding } from '../src/systems/construction';
import { assignMineWork, continueMineWork, economy } from '../src/systems/economy';
import { movement } from '../src/systems/people';
import { assignHouse } from '../src/systems/society';
import { flatWorld, setFood } from './helpers';

function fixture(adults = 6, funded = true) {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 24 })!, village = assignHouse(world, home);
  const workers: Entity[] = [];
  for (let i = 0; i < adults; i++) {
    const worker = world.spawn('core:person', { x: 16 + i % 2, y: 24 + Math.floor(i / 2) % 3 })!;
    Object.assign(worker.components.person!, { age: 25, homeId: i < 5 ? home.id : null });
    Object.assign(worker.components.citizen!, { villageId: village.id, hunger: 5 }); workers.push(worker);
  }
  initializeStorage(world, village); setFood(village, adults * 4);
  if (funded) deposit(village, BUILDINGS['core:mine'].cost);
  const mine = planBuilding(world, 'core:mine', { x: 20, y: 24 }, village, workers[0])!;
  return { world, home, village, workers, mine };
}
function build(f: ReturnType<typeof fixture>): void {
  for (let i = 0; i < 900 && f.mine.components.building!.project; i++) {
    f.world.tick++; continueConstruction(f.world, f.workers[0]); movement(f.world, STEP); construction(f.world, STEP);
  }
  expect(f.mine.components.building!.project).toBeUndefined();
}
function enter(f: ReturnType<typeof fixture>, worker = f.workers[1]): void {
  expect(assignMineWork(f.world, worker, f.village)).toBe(true);
  expect(insideMine(worker)).toBe(false);
  for (let i = 0; i < 900 && !insideMine(worker); i++) { f.world.tick++; movement(f.world, STEP); continueMineWork(f.world, worker); }
  expect(insideMine(worker)).toBe(true);
}
function successfulRoll(world: World): void {
  for (let seed = 1; ; seed++) if (new Random(seed).next() < MINE.success) { world.rng.state = seed; return; }
}
function finish(world: World, worker: Entity): void {
  const shift = worker.components.citizen!.work!.mine!;
  world.tick = shift.enteredAt! + shift.duration; continueMineWork(world, worker);
}

describe('mine construction, shifts and finite ore', () => {
  it('reserves and pays the recipe once, excludes duplicate projects and releases unpaid claims', () => {
    const f = fixture(6, false);
    expect(f.mine.components.building!.state).toBe('planned');
    expect(assignConstruction(f.world, f.workers[0])).toBe(false);
    expect(placementProblem(f.world, 'core:mine', { x: 12, y: 18 }, f.village)).toContain('already has a mine');
    cancelBuildingProject(f.world, f.mine);
    expect(stockOf(f.village, 'gold')).toBe(0);
    const funded = fixture(); build(funded);
    expect(funded.village.economy!.spent?.gold).toBe(15);
    expect(stockOf(funded.village, 'gold')).toBe(0);
    construction(funded.world, STEP);
    expect(funded.village.economy!.spent?.gold).toBe(15);
  });

  it('requires an actual journey, caps five slots and cancels hunger, fire, capture and removal safely', () => {
    const f = fixture(36); build(f);
    for (const worker of f.workers.slice(1, 6)) enter(f, worker);
    expect(assignMineWork(f.world, f.workers[6], f.village)).toBe(false);
    expect(mineWorkers(f.world, f.mine).filter(insideMine)).toHaveLength(5);
    const hungry = f.workers[1]; hungry.components.citizen!.hunger = 70;
    continueMineWork(f.world, hungry);
    expect(insideMine(hungry)).toBe(false); expect(f.world.entities.has(hungry.id)).toBe(true);
    expect(assignMineWork(f.world, f.workers[6], f.village)).toBe(true);
    f.mine.components.thermal!.burning = true; economy(f.world);
    expect(mineWorkers(f.world, f.mine)).toHaveLength(0);
    f.mine.components.thermal!.burning = false;
    enter(f, f.workers[2]);
    const home = f.world.spawn('core:house', { x: 36, y: 24 })!, other = assignHouse(f.world, home);
    // Ownership change also cancels before the next simulation tick.
    other.territory!.zones.push(...f.village.territory!.zones); f.village.territory!.zones = [];
    expect(transferBuilding(f.world, f.mine, other)).toBe(true);
    expect(insideMine(f.workers[2])).toBe(false);
    setBuildingOwner(f.mine, f.village.id); f.village.territory!.zones = other.territory!.zones; other.territory!.zones = [];
    enter(f, f.workers[3]); destroyBuilding(f.world, f.mine);
    expect(insideMine(f.workers[3])).toBe(false); expect(f.world.entities.has(f.workers[3].id)).toBe(true);
  });

  it('exposes a finite source without crediting stock or cargo and never repeats a saved roll', () => {
    const f = fixture(); build(f); enter(f);
    const worker = f.workers[1], before = structuredClone(stockContents(f.village));
    successfulRoll(f.world);
    const saved = decodeSave(f.world.snapshot(), f.world.registry);
    const loaded = new World(saved.seed, f.world.registry, saved, []), replacement = loaded.entities.get(worker.id)!;
    finish(f.world, worker); finish(loaded, replacement);
    const sources = (world: World) => [...world.entities.values()].filter(e => e.components.mineOrigin);
    expect(sources(f.world)).toHaveLength(1); expect(sources(loaded)).toEqual(sources(f.world));
    const source = sources(f.world)[0];
    expect(mineralDeposit(source)?.remaining ?? source.components.gemSource?.remaining).toBeGreaterThan(0);
    expect(stockContents(f.village)).toEqual(before); expect(worker.components.citizen!.work?.cargo).toBeUndefined();
    const after = decodeSave(f.world.snapshot(), f.world.registry), resumed = new World(after.seed, f.world.registry, after, []);
    const rng = resumed.rng.state; continueMineWork(resumed, resumed.entities.get(worker.id)!);
    expect(sources(resumed)).toHaveLength(1); expect(resumed.rng.state).toBe(rng);
  });

  it('uses normalized base plus biome weights, including Corrupted bones', () => {
    const weights = biomeMineralWeights(NaturalBiome.Grassland, true);
    const total = Object.values(weights).reduce((sum, n) => sum + n, 0);
    let cursor = 0;
    for (const [resource, weight] of Object.entries(weights)) {
      expect(selectBiomeMineral(NaturalBiome.Grassland, { next: () => (cursor + weight / 2) / total }, true)).toBe(resource);
      cursor += weight;
    }
    expect(total).toBe(42);
    expect(selectBiomeMineral(NaturalBiome.Corrupted, { next: () => 0 }, true)).toBe('bone');
    expect(biomeMineralWeights(NaturalBiome.Grassland).gold).toBeUndefined();
  });

  it('rechecks blocked entrances, water and occupied surroundings without creating ore', () => {
    const f = fixture(); build(f); enter(f);
    f.world.spawn('core:stone', { x: 20, y: 25.8 });
    finish(f.world, f.workers[1]);
    expect(insideMine(f.workers[1])).toBe(false);
    expect([...f.world.entities.values()].some(e => e.components.mineOrigin)).toBe(false);
    for (const e of [...f.world.query('stone')]) f.world.remove(e.id);
    while (mineDepositSite(f.world, f.mine)) f.world.spawn('core:stone', mineDepositSite(f.world, f.mine)!);
    expect(mineDemand(f.world, f.mine, f.village).limit).toBe(0);
    for (const e of [...f.world.query('stone')]) f.world.remove(e.id);
    enter(f); f.world.terrain.set(20, 25, Terrain.Water); economy(f.world);
    expect(insideMine(f.workers[1])).toBe(false); expect(f.world.entities.has(f.workers[1].id)).toBe(true);
  });

  it('reads the saved anchor biome for new output while retaining old material and reserves', () => {
    const f = fixture(); build(f); enter(f); successfulRoll(f.world); finish(f.world, f.workers[1]);
    const source = [...f.world.entities.values()].find(e => e.components.mineOrigin)!, previous = structuredClone(source.components);
    const anchor = f.mine.components.mine!.anchor;
    f.world.terrain.setBiome(anchor.x, anchor.y, NaturalBiome.Corrupted);
    expect(biomeMineralWeights(f.world.terrain.biomeAt(anchor.x, anchor.y).id, true).bone).toBe(7);
    expect(source.components).toEqual(previous);
    const save = f.world.snapshot(); expect(() => decodeSave(save, f.world.registry)).not.toThrow();
  });

  it('does no work on pause and rejects forged shifts and duplicate slots', () => {
    const f = fixture(); build(f); enter(f);
    f.world.paused = true;
    const before = f.world.snapshot(); f.world.step(); continueMineWork(f.world, f.workers[1]); economy(f.world);
    expect(f.world.snapshot()).toEqual(before);
    const corrupt = structuredClone(before), worker = corrupt.entities.find(e => e.id === f.workers[1].id)!;
    worker.components.citizen!.work!.mine!.enteredAt = corrupt.tick + 1;
    expect(() => decodeSave(corrupt, f.world.registry)).toThrow();
    const duplicate = structuredClone(before), other = duplicate.entities.find(e => e.id === f.workers[2].id)!;
    other.components.citizen = structuredClone(duplicate.entities.find(e => e.id === f.workers[1].id)!.components.citizen);
    other.components.position = { ...f.workers[1].components.position! };
    expect(() => decodeSave(duplicate, f.world.registry)).toThrow();
  });
});
