import { describe, expect, it } from 'vitest';
import { buyMeal, currency, giveMoney, householdIncome, payWork, settleIncome, stealMoney, walletOf } from '../src/core/currency';
import { requestCraft } from '../src/core/crafting';
import { createItem, repairEquipment } from '../src/core/equipment';
import { NaturalBiome } from '../src/core/natural-biomes';
import { deposit, stockOf } from '../src/core/resource-ledger';
import { foodReserve } from '../src/core/seasons';
import { initializeStorage } from '../src/core/stockpiles';
import { acquireTraits } from '../src/core/traits';
import { Terrain } from '../src/core/types';
import { economyOf, governmentOf } from '../src/core/village-life';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { cancelCraft, continueCraft, startCraft } from '../src/systems/crafting';
import { continueVillageWork } from '../src/systems/economy';
import { assignHouse } from '../src/systems/society';
import { flatWorld, setFood, villageWorld } from './helpers';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(world, home);
  const worker = world.spawn('core:person', { x: 10.3, y: 20 })!, elder = world.spawn('core:person', { x: 10.3, y: 21 })!;
  for (const e of [worker, elder]) {
    Object.assign(e.components.person!, { age: 30, homeId: home.id });
    Object.assign(e.components.citizen!, { villageId: village.id, hunger: 60 });
  }
  governmentOf(village).leaderId = elder.id; initializeStorage(world, village); setFood(village, 20);
  return { world, worker, elder, home, village };
}
const restore = (world: World): World => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
const cash = (world: World): number => [...world.query('citizen')].reduce((sum, e) => sum + walletOf(world, e).money + walletOf(world, e).loot, 0);

describe('personal economy', () => {
  it('settles only earned income with the current leader and saves replay protection independently of history', () => {
    const { world, worker, elder, village } = fixture();
    economyOf(village).taxRate = 70; payWork(world, worker, 'construction', 11);
    const replacement = world.spawn('core:person', { x: 10, y: 22 })!;
    replacement.components.citizen!.villageId = village.id; governmentOf(village).leaderId = replacement.id;
    expect(settleIncome(world, worker)).toBe(true);
    expect(walletOf(world, worker)).toMatchObject({ loot: 0, money: 4 });
    expect(walletOf(world, replacement).loot).toBe(7); expect(walletOf(world, elder).loot).toBe(0);
    expect(worker.components.happiness!.history.at(-1)?.type).toBe('high-tax'); expect(cash(world)).toBe(11);
    const copy = restore(world), actor = copy.entities.get(worker.id)!; copy.moneyHistory.splice(0);
    expect(payWork(copy, actor, 'construction', 11)).toBe(false); expect(settleIncome(copy, actor)).toBe(false);
    expect(cash(copy)).toBe(11);
  });

  it('settles without a recipient after a leader dies, without negative balances or phantom transfers', () => {
    const { world, worker, elder, village } = fixture();
    payWork(world, worker, 'construction', 9); world.remove(elder.id); governmentOf(village).leaderId = null;
    settleIncome(world, worker); expect(walletOf(world, worker).money).toBe(9); expect(cash(world)).toBe(9);
    world.tick++; expect(settleIncome(world, worker)).toBe(false);
    expect(walletOf(world, worker).loot).toBe(0);
  });

  it('withdraws food and coins together, and reassignment cannot renew the starvation exemption', () => {
    const { world, worker, elder, village } = fixture();
    expect(buyMeal(world, worker, village)).toBe(0); expect(village.food).toBe(20);
    worker.components.citizen!.hunger = 90;
    expect(buyMeal(world, worker, village)).toBe(1);
    worker.components.citizen!.hunger = 60; world.tick++;
    expect(buyMeal(world, worker, village)).toBe(0); expect(village.food).toBe(19);
    walletOf(world, worker).money = 10;
    expect(buyMeal(world, worker, village)).toBe(1); expect(buyMeal(world, worker, village)).toBe(0);
    expect(walletOf(world, worker).money).toBe(5);
    expect(buyMeal(world, elder, village)).toBe(1); expect(walletOf(world, elder).money).toBe(0);
    world.tick++; worker.components.person!.age = 2; walletOf(world, worker).money = 0;
    expect(buyMeal(world, worker, village)).toBe(1); expect(stockOf(village, 'gold')).toBe(0);
  });

  it('transfers one gift, one theft and one death estate between real owners', () => {
    const { world, worker, elder } = fixture();
    walletOf(world, worker).money = 20;
    expect(giveMoney(world, worker, elder, 5)).toBe(true); expect(giveMoney(world, worker, elder, 5)).toBe(false);
    expect(cash(world)).toBe(20);
    acquireTraits(world, elder, ['thief'], 'event');
    expect(stealMoney(world, elder, worker)).toBe(true); expect(stealMoney(world, elder, worker)).toBe(false);
    expect(walletOf(world, elder)).toMatchObject({ loot: 15, money: 5 });
    elder.components.health!.current = 0;
    world.die(elder.id, { cause: 'conflict', sourceId: worker.id }); world.die(elder.id, { cause: 'conflict', sourceId: worker.id });
    expect(cash(world)).toBe(20); expect(walletOf(world, worker)).toMatchObject({ loot: 15, money: 5 });
    expect(world.moneyHistory.filter(e => e.reason === 'death')).toHaveLength(1);
  });

  it('pauses saved household/tax deadlines and never awards backdated legacy income', () => {
    const { world, worker, home } = fixture();
    const raw = world.snapshot(); raw.version = 63; raw.tick = 1200; delete raw.moneyHistory;
    for (const e of raw.entities) if (e.components.citizen) { delete e.components.citizen.wallet; e.components.citizen.service = 500; }
    const copy = new World(world.seed, world.registry, decodeSave(raw, world.registry)), actor = copy.entities.get(worker.id)!;
    expect(walletOf(copy, actor)).toMatchObject({ loot: 0, money: 0, homeAfter: 1800, taxAfter: 1800 });
    copy.paused = true; copy.tick = 1800; const before = structuredClone(actor.components.citizen!.wallet); currency(copy);
    expect(actor.components.citizen!.wallet).toEqual(before);
    copy.paused = false; currency(copy); const once = cash(copy); currency(copy); expect(cash(copy)).toBe(once);
    world.terrain.biomes[world.terrain.index(home.components.position!.x, home.components.position!.y)] = NaturalBiome.Corrupted;
    expect(householdIncome(world, worker)).toBe(0);
  });

  it('rejects forged balances, future completion receipts and unsupported tax rates', () => {
    const { world, worker, village } = fixture();
    const invalid = world.snapshot(); invalid.entities.find(e => e.id === worker.id)!.components.citizen!.wallet!.money = -1;
    expect(() => decodeSave(invalid, world.registry)).toThrow();
    walletOf(world, worker).completed.delivery = world.tick + 1;
    expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
    delete walletOf(world, worker).completed.delivery;
    const badRate = world.snapshot(); Object.assign(badRate.society.villages.find(v => v.id === village.id)!.economy!, { taxRate: 99 });
    expect(() => decodeSave(badRate, world.registry)).toThrow();
  });

  it('pays a real extraction once across a save at completion and separately pays physical delivery', () => {
    const { world, worker, village, home } = fixture();
    worker.components.citizen!.hunger = 10;
    const source = world.spawn('core:stone', { x: 16, y: 20 })!;
    Object.assign(worker.components.position!, { x: 14.3, y: 20 }); world.spatial.update(worker);
    Object.assign(worker.components.citizen!, { task: 'work', targetId: source.id, path: [], work: { good: 'stone', progress: 4, cargo: null } });
    const copy = restore(world), miner = copy.entities.get(worker.id)!;
    continueVillageWork(copy, miner); expect(walletOf(copy, miner).loot).toBe(1);
    const resumed = restore(copy), carrier = resumed.entities.get(worker.id)!;
    const target = resumed.entities.get(carrier.components.citizen!.targetId ?? home.id)!;
    Object.assign(carrier.components.position!, carrier.components.citizen!.path.at(-1) ?? { x: target.components.position!.x - 1.7, y: target.components.position!.y });
    resumed.spatial.update(carrier); carrier.components.citizen!.path = [];
    continueVillageWork(resumed, carrier); continueVillageWork(resumed, carrier);
    expect(walletOf(resumed, carrier).loot).toBe(2);
    expect(stockOf(resumed.society.villages.find(v => v.id === village.id)!, 'stone')).toBeGreaterThan(0);
  });

  it('charges special crafting once at completion, keeps gold separate and pays nothing on cancellation', () => {
    const { world, worker, elder, village } = fixture();
    const workshop = world.spawn('core:workshop', { x: 24, y: 24 })!; workshop.components.workplace!.villageId = village.id;
    Object.assign(worker.components.position!, { x: 22.3, y: 24 }); world.spatial.update(worker); worker.components.citizen!.hunger = 10;
    deposit(village, { dragonScale: 4, gold: 7 }); walletOf(world, elder).money = 40;
    const policy = { preferredKinds: ['fire-sword'], specialRecipes: ['fire-sword'] };
    const cancelled = requestCraft(world, elder, 'weapon', policy)!;
    expect(startCraft(world, worker, cancelled, workshop)).toBe(true); cancelCraft(world, cancelled);
    expect(walletOf(world, worker).loot).toBe(0); expect(walletOf(world, elder).money).toBe(40);
    const order = requestCraft(world, elder, 'weapon', policy)!; expect(startCraft(world, worker, order, workshop)).toBe(true);
    worker.components.citizen!.path = [];
    for (let i = 0; i < 7; i++) continueCraft(world, worker);
    const copy = restore(world), maker = copy.entities.get(worker.id)!; continueCraft(copy, maker); continueCraft(copy, maker);
    expect(walletOf(copy, copy.entities.get(elder.id)!).money).toBe(20);
    expect(copy.equipment.items).toHaveLength(1); expect(walletOf(copy, maker).loot).toBe(1);
    expect(stockOf(copy.society.villages.find(v => v.id === village.id)!, 'gold')).toBe(7);
    const broken = createItem(copy, 'fire-sword', { kind: 'equipped', entityId: maker.id }); broken.durability = 1;
    walletOf(copy, maker).money = 10;
    expect(repairEquipment(copy, maker)).toBe(true); expect(repairEquipment(copy, maker)).toBe(false);
    expect(walletOf(copy, maker).money).toBe(0); expect(broken.durability).toBe(broken.maxDurability);
  });

  it('retains the food reserve at the source and never credits a cut-off caravan', () => {
    const world = villageWorld(), [from, to] = world.society.villages;
    const tiles = Array.from({ length: 29 }, (_, i) => 26 * 48 + i + 8);
    for (const i of tiles) world.terrain.set(i % 48, Math.floor(i / 48), Terrain.Road);
    world.society.roads = [{ a: from.id, b: to.id, tiles, built: tiles.length }];
    const population = [...world.query('citizen')].filter(e => e.components.citizen!.villageId === from.id).length;
    const reserve = foodReserve(world.tick, population);
    setFood(from, reserve + 3); setFood(to, 0);
    expect(dispatchCaravan(world, from.id, to.id)).toBe(true);
    const cargo = [...world.query('caravan')][0]?.components.caravan?.food ?? 0;
    expect(cargo).toBe(3); expect(from.food).toBe(reserve);
    expect(dispatchCaravan(world, from.id, to.id)).toBe(false);
    expect(economyOf(from).supplyAfter ?? 0).toBeLessThanOrEqual(world.tick); // Cooldown starts on delivery or cancellation.
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    for (let i = 0; i < 50; i++) { world.tick++; caravans(world, 1); }
    expect(to.food).toBe(0);
  });
});
