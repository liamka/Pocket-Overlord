import { describe, expect, it } from 'vitest';
import { diplomaticWorld, flatWorld, setFood } from './helpers';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { applyEvent, fire, processEvents } from '../src/systems/effects';
import { World } from '../src/core/world';
import { Terrain, type Entity } from '../src/core/types';
import { economyOf } from '../src/core/village-life';
import { bundleLoad, bundleSize } from '../src/core/resources';
import { cargoContents, deposit, inTransit, reservedStock, stockContents, stockOf, withdraw } from '../src/core/resource-ledger';
import { attachStorage, clearStorageApproach, consumeReservation, initializeStorage, maintainStorage, releaseReservation, reserveGoods, storageRoute, storesOf } from '../src/core/stockpiles';
import { decodeSave } from '../src/persistence/schema';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { STEP } from '../src/core/types';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 24, y: 24 })!, village = assignHouse(world, home);
  village.food = 0;
  const market = world.spawn('core:market', { x: 12, y: 16 })!; market.components.workplace!.villageId = village.id;
  initializeStorage(world, village);
  const store = storesOf(village)[0];
  const workers = [10, 14].map(x => world.spawn('core:person', { x, y: 14 })!);
  for (const e of workers) { e.components.citizen!.villageId = village.id; e.components.person!.age = 25; }
  const workshop = world.spawn('core:workshop', { x: 28, y: 16 })!; workshop.components.workplace!.villageId = village.id;
  function craft(e: Entity) { Object.assign(e.components.citizen!, { task: 'work', targetId: workshop.id,
    work: { good: 'tools', progress: 0, cargo: null, reservation: { villageId: village.id, inputs: { wood: 3 } } } }); }
  function warehouse(x: number, y: number, kind = 'core:stockpile') {
    const e = world.spawn(kind, { x, y })!; e.components.stockpile!.villageId = village.id;
    return { entity: e, store: attachStorage(village, e) };
  }
  function cargo(e = workers[0], amount = 3) {
    Object.assign(e.components.citizen!, { task: 'deliver', targetId: market.id, path: [], work: { good: 'wood', progress: 0, cargo: { good: 'wood', amount, villageId: village.id } } });
    Object.assign(e.components.position!, { x: 10.2, y: 16 }); world.spatial.update(e);
  }
  return { world, home, village, market, store, workers, workshop, craft, warehouse, cargo };
}
const restore = (world: World) => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry), []);

describe('physical stockpiles', () => {
  it('migrates every legacy good and the untyped food remainder exactly once', () => {
    const { world, village, market } = fixture(), old = world.snapshot();
    old.version = 33;
    const v = old.society.villages[0]; delete v.economy!.storage;
    v.food = 147.5; Object.assign(v.economy!.stocks, { bread: 12.5, meat: 5, wood: 2000, stone: 17.25, gems: 3 });
    const migrated = new World(world.seed, world.registry, decodeSave(old, world.registry), []), owner = migrated.society.villages[0];
    expect(stockContents(owner)).toMatchObject({ provisions: 130, bread: 12.5, meat: 5, wood: 2000, stone: 17.25, gems: 3 });
    expect(storesOf(owner)[0].buildingId).toBe(market.id);
    expect(storesOf(owner)[0].capacity).toBe(bundleLoad(stockContents(owner)).volume);
    expect(stockContents(restore(migrated).society.villages[0])).toEqual(stockContents(owner));
    expect(village.food).toBe(0);
  });
  it('reserves distinct physical units; cancellation releases only its own claim and spending is once', () => {
    const { world, village, workers, craft } = fixture();
    deposit(village, { wood: 6 }); workers.forEach(craft);
    expect(reserveGoods(world, village, { wood: 3 }, workers[0].id)).toBe(true);
    expect(reserveGoods(world, village, { wood: 3 }, workers[1].id)).toBe(true);
    expect(withdraw(village, { wood: 1 })).toBe(false);
    expect(reserveGoods(world, village, { wood: 1 }, 999)).toBe(false);
    releaseReservation(village, workers[0].id);
    expect(reservedStock(world, village)).toEqual({ wood: 3 });
    expect(consumeReservation(village, workers[1].id, { wood: 3 })).toBe(true);
    expect(consumeReservation(village, workers[1].id, { wood: 3 })).toBe(false);
    expect(stockOf(village, 'wood')).toBe(3); expect(village.economy!.spent).toEqual({ wood: 3 });
  });
  it('keeps overflow in the carrier and chooses another accessible store', () => {
    const { world, village, store, workers, warehouse, cargo } = fixture();
    store.capacity = 6; deposit(village, { wood: 2 }); cargo();
    continueVillageWork(world, workers[0]);
    expect(stockOf(village, 'wood')).toBe(3); expect(workers[0].components.citizen!.work!.cargo!.amount).toBe(2);
    expect(assignVillageWork(world, workers[0])).toBe(false);
    const next = warehouse(20, 16);
    expect(assignVillageWork(world, workers[0])).toBe(true); expect(workers[0].components.citizen!.targetId).toBe(next.entity.id);
    Object.assign(workers[0].components.position!, { x: 18.2, y: 16 }); workers[0].components.citizen!.path = [];
    continueVillageWork(world, workers[0]);
    expect(next.store.goods.wood).toBe(2); expect(workers[0].components.citizen!.work).toBeUndefined();
    expect(stockOf(village, 'wood')).toBe(5);
  });
  it('does not hand off across a one-tile water gap or a solid obstruction', () => {
    const { world, village, market, workers, cargo } = fixture(); cargo();
    for (let y = 0; y < 48; y++) world.terrain.set(11, y, Terrain.Water);
    expect(clearStorageApproach(world, workers[0].components.position!, market)).toBe(false);
    expect(storageRoute(world, workers[0].components.position!, market)).toBeUndefined();
    continueVillageWork(world, workers[0]); expect(stockOf(village, 'wood')).toBe(0); expect(inTransit(world, village.id)).toEqual({ wood: 3 });
    for (let y = 0; y < 48; y++) world.terrain.set(11, y, Terrain.Grass);
    world.spawn('core:tree', { x: 11.1, y: 16 });
    expect(clearStorageApproach(world, workers[0].components.position!, market)).toBe(false);
  });
  it('destroys only one store and its claims, once, with no reconstruction refund', () => {
    const { world, village, store, market, workers, craft, warehouse } = fixture();
    const second = warehouse(20, 30); deposit(village, { wood: 3 }, market.id); deposit(village, { wood: 3 }, second.entity.id);
    workers.forEach(craft); reserveGoods(world, village, { wood: 3 }, workers[0].id); reserveGoods(world, village, { wood: 3 }, workers[1].id);
    expect(store.reservations[0].claimant).toBe(workers[0].id);
    world.remove(market.id); world.remove(market.id);
    expect(stockOf(village, 'wood')).toBe(3); expect(village.economy!.lost).toEqual({ wood: 3 });
    expect(workers[0].components.citizen!.work).toBeUndefined(); expect(reservedStock(world, village)).toEqual({ wood: 3 });
    warehouse(12, 16); expect(stockOf(village, 'wood')).toBe(3);
    expect(restore(world).society.villages[0].economy!.lost).toEqual({ wood: 3 });
  });
  it.each(['ordinary', 'fireproof', 'acidproof'] as const)('%s protects exactly its hazard, including contents; blasts still destroy', resistance => {
    const { world, village, warehouse } = fixture();
    const { entity, store } = warehouse(34, 32, resistance === 'ordinary' ? 'core:stockpile' : `core:stockpile-${resistance}`);
    deposit(village, { gems: 7 }, entity.id);
    applyEvent(world, { kind: 'heat', target: entity.id, amount: 100 }); fire(world, 1);
    expect(entity.components.health!.current).toBe(resistance === 'fireproof' ? 180 : 169);
    const before = entity.components.health!.current;
    applyEvent(world, { kind: 'damage', target: entity.id, amount: 20, cause: 'acid' });
    expect(entity.components.health!.current).toBe(resistance === 'acidproof' ? before : before - 20);
    expect(store.goods.gems).toBe(7);
    applyEvent(world, { kind: 'blast', x: 34, y: 32, radius: 3, power: 500, heat: 200 }); processEvents(world);
    expect(world.entities.has(entity.id)).toBe(false); expect(village.economy!.lost!.gems).toBe(7);
  });
  it('saves immediately before and after the atomic hand-off; pause stops transfer', () => {
    const { world, village, workers, cargo } = fixture(); cargo(); world.paused = true;
    const before = world.snapshot(); for (let n = 0; n < 10; n++) world.step(); continueVillageWork(world, workers[0]);
    expect(world.snapshot()).toEqual(before);
    const resumed = restore(world), worker = resumed.entities.get(workers[0].id)!; resumed.paused = false;
    continueVillageWork(resumed, worker);
    expect(stockOf(resumed.society.villages[0], 'wood')).toBe(3);
    const after = restore(resumed); continueVillageWork(after, after.entities.get(worker.id)!);
    expect(stockOf(after.society.villages[0], 'wood')).toBe(3); expect(bundleSize(inTransit(after, village.id))).toBe(0);
  });
  it('releases reservations on death, reassignment, target loss and changed tasks', () => {
    for (const action of ['death', 'owner', 'target', 'task']) {
      const { world, village, workers, workshop, craft } = fixture(); deposit(village, { wood: 3 }); craft(workers[0]); reserveGoods(world, village, { wood: 3 }, workers[0].id);
      if (action === 'death') world.remove(workers[0].id);
      if (action === 'owner') workers[0].components.citizen!.villageId = null;
      if (action === 'target') world.remove(workshop.id);
      if (action === 'task') workers[0].components.citizen!.task = 'idle';
      maintainStorage(world); expect(reservedStock(world, village)).toEqual({}); expect(stockOf(village, 'wood')).toBe(3);
    }
  });
  it('rechecks ownership on arrival and keeps cargo when the destination changes owner', () => {
    const { world, village, market, workers, cargo } = fixture(); cargo(); market.components.workplace!.villageId = null;
    continueVillageWork(world, workers[0]); expect(stockOf(village, 'wood')).toBe(0);
    expect(cargoContents(workers[0].components.citizen!.work!.cargo!)).toEqual({ wood: 3 });
  });
  it('rejects overcapacity, duplicate storage, forged summary and oversubscribed reservations', () => {
    const { world, village, workers, craft } = fixture(); deposit(village, { wood: 3 }); craft(workers[0]); reserveGoods(world, village, { wood: 3 }, workers[0].id);
    const good = world.snapshot(); expect(() => decodeSave(good, world.registry)).not.toThrow();
    for (const corrupt of [
      (s: typeof good) => { s.society.villages[0].economy!.storage![0].capacity = 1; },
      (s: typeof good) => { s.society.villages[0].economy!.storage!.push(s.society.villages[0].economy!.storage![0]); },
      (s: typeof good) => { s.society.villages[0].economy!.stocks.wood++; },
      (s: typeof good) => { s.society.villages[0].economy!.storage![0].reservations[0].goods.wood = 4; },
    ]) { const bad = structuredClone(good); corrupt(bad); expect(() => decodeSave(bad, world.registry)).toThrow(); }
    expect(economyOf(village).stocks.wood).toBe(3);
  });
  it('gives a mill finite grain/flour capacity without copying the village balance', () => {
    const { world, village, market } = fixture(); deposit(village, { wood: 3 }, market.id);
    const mill = world.spawn('core:mill', { x: 34, y: 28 })!; mill.components.workplace!.villageId = village.id;
    const store = attachStorage(village, mill);
    expect(deposit(village, { wood: 2 }, mill.id)).toEqual({});
    expect(deposit(village, { grain: 60 }, mill.id)).toEqual({ grain: 48 });
    expect(deposit(village, { flour: 2 }, mill.id)).toEqual({});
    expect(store.goods).toEqual({ grain: 48 }); expect(stockOf(village, 'wood')).toBe(3);
    world.remove(mill.id); expect(stockOf(village, 'wood')).toBe(3); expect(village.economy!.lost!.grain).toBe(48);
  });
  it('keeps a caravan load while all storage is full, then delivers to a newly available warehouse after reload', () => {
    const world = diplomaticWorld(2), [from, to] = world.society.villages;
    setFood(from, 80); setFood(to, 0); initializeStorage(world, from); initializeStorage(world, to);
    storesOf(to)[0].capacity = 1; deposit(to, { grain: 1 });
    expect(dispatchCaravan(world, from.id, to.id)).toBe(true);
    for (let n = 0; n < 600; n++) { world.tick++; caravans(world, STEP); }
    const wagon = [...world.query('caravan')][0];
    expect(wagon.components.caravan!.food).toBe(12); expect(to.food).toBe(0); expect(from.food).toBe(68);
    const resumed = restore(world), recipient = resumed.society.villages[1];
    const warehouse = resumed.spawn('core:stockpile', { x: to.x, y: to.y + 6 })!; warehouse.components.stockpile!.villageId = to.id;
    attachStorage(recipient, warehouse);
    for (let n = 0; n < 600 && !resumed.entities.get(wagon.id)!.components.caravan!.returning; n++) { resumed.tick++; caravans(resumed, STEP); }
    expect(recipient.food).toBe(12); expect(resumed.entities.get(wagon.id)!.components.caravan!.food).toBe(0);
    expect(stockOf(recipient, 'grain')).toBe(1); expect(stockOf(recipient, 'provisions')).toBe(12);
    expect(decodeSave(resumed.snapshot(), resumed.registry).society.villages[1].food).toBe(12);
  });
  it('retains tiny fractional overflow in valid cargo across a save', () => {
    const { world, village, store, workers, cargo } = fixture();
    store.capacity = 5.9998; cargo(); continueVillageWork(world, workers[0]);
    expect(stockOf(village, 'wood')).toBeCloseTo(2.9999);
    expect(workers[0].components.citizen!.work!.cargo!.amount).toBeCloseTo(0.0001);
    expect(() => restore(world)).not.toThrow();
  });
});
