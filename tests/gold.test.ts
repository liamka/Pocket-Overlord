import { describe, expect, it } from 'vitest';
import { flatWorld, setFood } from './helpers';
import { placeGoldOre, produceGold } from '../src/content/gold';
import { GOLD } from '../src/core/gold';
import { beginProject, buildingCost, transferBuilding } from '../src/core/buildings';
import { walletOf, settleIncome } from '../src/core/currency';
import { reserveDeposit } from '../src/core/deposits';
import { professionOf } from '../src/core/jobs';
import { cargoContents, deposit, stockOf, withdraw } from '../src/core/resource-ledger';
import { harborBerth } from '../src/core/seafaring';
import { attachStorage, initializeStorage, storageRoute, storesOf, syncStocks } from '../src/core/stockpiles';
import { acquireTraits, hasTrait, inheritTraits } from '../src/core/traits';
import { zoneAt } from '../src/core/territory';
import { STEP, Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { assignConstruction, construction } from '../src/systems/construction';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { sail, seafaring } from '../src/systems/seafaring';
import { assignHouse } from '../src/systems/society';
import { traitsSystem } from '../src/systems/traits';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  initializeStorage(world, village); const store = storesOf(village)[0]; store.capacity = 2000;
  setFood(village, 100); deposit(village, { wood: 12, tools: 8 });
  const workers = [18, 20, 26, 28].map(x => world.spawn('core:person', { x, y: 20 })!);
  for (const worker of workers) {
    Object.assign(worker.components.person!, { age: 30, homeId: home.id });
    worker.components.citizen!.villageId = village.id;
  }
  return { world, home, village, store, workers };
}
function arrive(world: World, worker: Entity, target: Entity): void {
  const path = storageRoute(world, worker.components.position!, target)!;
  if (path.length) Object.assign(worker.components.position!, path.at(-1));
  world.spatial.update(worker); worker.components.citizen!.path = [];
}
const restore = (world: World): World => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry), []);

describe('gold mineral economy', () => {
  it('never seeds gold in ordinary worlds and mines a finite mixed source before crediting either product', () => {
    const ordinary = new World(12345);
    expect([...ordinary.query('stone')].filter(e => e.components.stone!.profile === 'goldOre')).toHaveLength(0);
    const { world, home, village, workers: [a, b] } = fixture();
    const ore = placeGoldOre(world, { x: 32, y: 24 }, 'mine')!; ore.components.stone!.remaining = 6;
    expect(assignVillageWork(world, a)).toBe(true); expect(assignVillageWork(world, b)).toBe(true);
    expect(ore.components.stone!.claims.reduce((n, c) => n + c.amount, 0)).toBe(6);
    for (let i = 0; i < 8; i++) continueVillageWork(world, a);
    expect(ore.components.stone!.remaining).toBe(6);
    arrive(world, a, ore); arrive(world, b, ore);
    for (let i = 0; i < 8; i++) { continueVillageWork(world, a); continueVillageWork(world, b); }
    expect(world.entities.has(ore.id)).toBe(false);
    expect(stockOf(village, 'gold')).toBe(0); expect(stockOf(village, 'stone')).toBe(0);
    expect(cargoContents(a.components.citizen!.work!.cargo!)).toEqual({ gold: 4, stone: 4 });
    expect(cargoContents(b.components.citizen!.work!.cargo!)).toEqual({ gold: 2, stone: 2 });
    const loaded = restore(world);
    for (const id of [a.id, b.id]) {
      const worker = loaded.entities.get(id)!; arrive(loaded, worker, loaded.entities.get(home.id)!);
      continueVillageWork(loaded, worker); continueVillageWork(loaded, worker);
    }
    const owner = loaded.society.villages[0];
    expect(stockOf(owner, 'gold')).toBe(6); expect(stockOf(owner, 'stone')).toBe(6);
  });

  it('retains ore when storage cannot accept the whole lot, and loses both carried resources on death', () => {
    const { world, village, store, workers: [a] } = fixture(), ore = placeGoldOre(world, { x: 32, y: 24 })!;
    store.limits = { gold: 20 }; expect(assignVillageWork(world, a)).toBe(false);
    expect(ore.components.stone!.remaining).toBe(GOLD.deposit); expect(ore.components.stone!.claims).toHaveLength(0);
    store.limits = {}; assignVillageWork(world, a); arrive(world, a, ore);
    for (let i = 0; i < 8; i++) continueVillageWork(world, a);
    const goods = cargoContents(a.components.citizen!.work!.cargo!); world.remove(a.id);
    expect(village.economy!.lost).toMatchObject(goods);
    expect(stockOf(village, 'gold')).toBe(0); expect(reserveDeposit(world, ore, a)).toBe(false);
  });

  it('charges a building once across save/load without spending the worker wallet', () => {
    const { world, home, village, workers: [worker] } = fixture();
    deposit(village, buildingCost(home, 'upgrade')); walletOf(world, worker).money = 17;
    beginProject(home, 'upgrade'); expect(assignConstruction(world, worker)).toBe(true); arrive(world, worker, home);
    for (let i = 0; i < 90; i++) { world.tick++; construction(world, STEP); }
    expect(home.components.building!.project!.paid).toBe(true); expect(stockOf(village, 'gold')).toBe(0);
    const loaded = restore(world), loadedHome = loaded.entities.get(home.id)!;
    for (let i = 0; i < 600; i++) { loaded.tick++; construction(loaded, STEP); }
    expect(loadedHome.components.building!.level).toBe(2);
    expect(loaded.society.villages[0].economy!.spent!.gold).toBe(GOLD.building.houseUpgrade);
    expect(walletOf(loaded, loaded.entities.get(worker.id)!).money).toBe(17);
  });

  it('uses gold as a recruitment threshold, preserves serving warriors and never taxes coins into mineral gold', () => {
    const { world, village, workers } = fixture(), worker = workers.find(e => e.id % 3 !== 0)!;
    world.society.wars.push({ id: 1, attackers: [village.id], defenders: [999], started: 0, musterUntil: 240,
      attackTarget: 999, rallyVillage: village.id, initialAttackers: 4, initialDefenders: 4, lossesAttackers: 0, lossesDefenders: 0 });
    deposit(village, { gold: 10 }); expect(professionOf(world, worker).service).toBe('civilian');
    deposit(village, { gold: 1 }); setFood(village, 0); expect(professionOf(world, worker).service).toBe('civilian');
    setFood(village, 10); worker.components.citizen!.profession = professionOf(world, worker);
    expect(worker.components.citizen!.profession.service).toBe('warrior');
    for (let i = 0; i < 5; i++) expect(professionOf(world, worker).service).toBe('warrior');
    expect(stockOf(village, 'gold')).toBe(11); withdraw(village, { gold: 11 });
    expect(professionOf(world, worker).service).toBe('warrior');
    walletOf(world, worker).loot = 20; settleIncome(world, worker);
    expect(stockOf(village, 'gold')).toBe(0); expect(walletOf(world, worker).money).toBe(20);
  });

  it('keeps gold with an intact captured store and records its destruction without copying stock', () => {
    const { world, village, home } = fixture(); deposit(village, { gold: 12 });
    const other = assignHouse(world, world.spawn('core:house', { x: 4, y: 4 })!);
    // Model an established common frontier; acquisition itself still moves the store.
    const adjacent = zoneAt(world, { x: 20, y: 24 });
    village.territory!.zones = village.territory!.zones.filter(z => z !== adjacent);
    if (!other.territory!.zones.includes(adjacent)) other.territory!.zones.push(adjacent);
    expect(transferBuilding(world, home, other)).toBe(true);
    expect(stockOf(village, 'gold')).toBe(0); expect(stockOf(other, 'gold')).toBe(12);
    world.remove(home.id); expect(stockOf(other, 'gold')).toBe(0); expect(other.economy!.lost!.gold).toBe(12);
  });

  it('gates biological production by an inherited trait and preserves its random stream and deadline', () => {
    const { world, workers: [worker] } = fixture(); produceGold(world, worker);
    expect([...world.query('stone')]).toHaveLength(0);
    acquireTraits(world, worker, ['bioproduct-gold'], 'event');
    const entry = worker.components.traits!.entries.find(t => t.id === 'bioproduct-gold')!;
    world.tick = entry.nextAt!; world.paused = true; traitsSystem(world); expect(entry.nextAt).toBe(world.tick);
    world.paused = false; const loaded = restore(world);
    traitsSystem(world); traitsSystem(loaded);
    expect([...loaded.query('stone')]).toEqual([...world.query('stone')]); expect(loaded.rng.state).toBe(world.rng.state);
    const count = [...world.query('stone')].length; traitsSystem(world); expect([...world.query('stone')]).toHaveLength(count);
  });

  it('inherits the producer trait without producing ore at birth or on repeated inheritance', () => {
    const { world, workers: [parent] } = fixture();
    parent.components.traits!.entries = []; acquireTraits(world, parent, ['bioproduct-gold'], 'event');
    const child = world.spawn('core:person', { x: 30, y: 20 })!;
    child.components.traits!.entries = []; child.components.traits!.inherited = false;
    inheritTraits(world, child, [parent]); expect(hasTrait(child, 'bioproduct-gold')).toBe(true);
    const before = structuredClone(child.components.traits); inheritTraits(world, child, [parent]);
    expect(child.components.traits).toEqual(before); expect([...world.query('stone')]).toHaveLength(0);
  });

  it('migrates agreed building prices without gold rewards, food conversion, or wallet changes', () => {
    const { world, village, home, workers: [worker] } = fixture(); walletOf(world, worker).money = 7;
    beginProject(home, 'upgrade'); delete home.components.building!.project!.cost.gold;
    const old = world.snapshot(); old.version = 64; delete old.society.villages[0].economy!.stocks.gold;
    const loaded = new World(world.seed, world.registry, decodeSave(old, world.registry), []);
    expect(loaded.entities.get(home.id)!.components.building!.project!.legacyGoldCost).toBe(true);
    expect(stockOf(loaded.society.villages[0], 'gold')).toBe(0); expect(loaded.society.villages[0].food).toBe(village.food);
    expect(walletOf(loaded, loaded.entities.get(worker.id)!)).toEqual(walletOf(world, worker));
    expect(() => decodeSave(loaded.snapshot(), loaded.registry)).not.toThrow();
    const ore = placeGoldOre(loaded, { x: 32, y: 24 })!; ore.components.stone!.origin = 'natural';
    expect(() => decodeSave(loaded.snapshot(), loaded.registry)).toThrow();
  });

  it('pays an actual trade delivery once across reload, never on movement, pause, or old voyages', () => {
    const world = flatWorld();
    for (let y = 0; y < 48; y++) for (let x = 9; x < 39; x++) world.terrain.set(x, y, Terrain.Water);
    const from = assignHouse(world, world.spawn('core:house', { x: 4.5, y: 12.5 })!);
    const to = assignHouse(world, world.spawn('core:house', { x: 43.5, y: 34.5 })!);
    for (const town of [from, to]) for (let i = 0; i < 4; i++) {
      const resident = world.spawn('core:person', { x: town.x, y: town.y + 2 })!;
      resident.components.person!.age = 30; resident.components.citizen!.villageId = town.id;
    }
    const a = world.spawn('core:harbor', { x: 8.5, y: 12.5 })!, b = world.spawn('core:harbor', { x: 39.5, y: 34.5 })!;
    Object.assign(a.components.harbor!, { villageId: from.id, direction: 0, launchIn: 60 });
    Object.assign(b.components.harbor!, { villageId: to.id, direction: 2, launchIn: 60 });
    initializeStorage(world, from); initializeStorage(world, to); attachStorage(from, a); attachStorage(to, b);
    setFood(from, 0); setFood(to, 0); deposit(from, { bread: 80 }, a.id);
    const ship = world.spawn('core:ship', harborBerth(a))!;
    Object.assign(ship.components.ship!, { homeId: a.id, kind: 'trade', phase: 'docked', wait: 0 });
    seafaring(world, STEP); expect(ship.components.ship!.cargo).toBeGreaterThan(0); expect(stockOf(to, 'gold')).toBe(0);
    Object.assign(ship.components.position!, harborBerth(b)); world.spatial.update(ship);
    ship.components.ship!.path = []; ship.components.ship!.next = 0;
    world.paused = true; sail(world, ship, STEP); expect(stockOf(to, 'gold')).toBe(0); world.paused = false;
    const loaded = restore(world), arriving = loaded.entities.get(ship.id)!;
    sail(loaded, arriving, STEP); expect(stockOf(loaded.society.villages.find(v => v.id === to.id)!, 'gold')).toBe(GOLD.tradeIncome);
    const again = restore(loaded); sail(again, again.entities.get(ship.id)!, STEP);
    expect(stockOf(again.society.villages.find(v => v.id === to.id)!, 'gold')).toBe(GOLD.tradeIncome);
    const old = world.snapshot(); old.version = 64;
    const legacy = new World(world.seed, world.registry, decodeSave(old, world.registry), []);
    sail(legacy, legacy.entities.get(ship.id)!, STEP); expect(stockOf(legacy.society.villages.find(v => v.id === to.id)!, 'gold')).toBe(0);
  });

  it('never creates fractional mineral gold in nearly full stores', () => {
    const { village, store } = fixture(); store.goods = { provisions: 1999.5 }; store.capacity = 2000; syncStocks(village);
    expect(deposit(village, { gold: 5 })).toEqual({}); expect(stockOf(village, 'gold')).toBe(0);
  });
});
