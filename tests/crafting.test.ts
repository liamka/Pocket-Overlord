import { describe, expect, it } from 'vitest';
import { craftedModifiers, modifierTries, requestCraft, selectRecipe } from '../src/core/crafting';
import { EQUIPMENT, validModifiers } from '../src/core/equipment-catalog';
import { carriedItems, createItem, equipItem } from '../src/core/equipment';
import { deposit, stockOf } from '../src/core/resource-ledger';
import { initializeStorage, reserveGoods, storesOf, syncStocks } from '../src/core/stockpiles';
import { Terrain, type Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { cancelCraft, continueCraft, maintainCrafting, startCraft } from '../src/systems/crafting';
import { continueVillageWork } from '../src/systems/economy';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(world, home);
  const market = world.spawn('core:market', { x: 16, y: 24 })!, workshop = world.spawn('core:workshop', { x: 24, y: 24 })!;
  market.components.workplace!.villageId = workshop.components.workplace!.villageId = village.id;
  const worker = world.spawn('core:person', { x: 22.3, y: 24 })!, recipient = world.spawn('core:person', { x: 18, y: 20 })!;
  for (const e of [worker, recipient]) { Object.assign(e.components.person!, { age: 30, homeId: home.id }); e.components.citizen!.villageId = village.id; }
  initializeStorage(world, village); deposit(village, { stone: 2, wood: 1 });
  return { world, home, village, market, workshop, worker, recipient, store: storesOf(village)[0] };
}
function arrive(world: World, e: Entity, x: number, y: number): void {
  Object.assign(e.components.position!, { x, y }); world.spatial.update(e); e.components.citizen!.path = [];
}
function finish(world: World, e: Entity): void { for (let i = 0; i < 8; i++) continueCraft(world, e); }
const restore = (world: World): World => new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));

describe('paid workshop orders', () => {
  it.each(['wood', 'stone'] as const)('does not reserve partially or downgrade an order when %s disappears', missing => {
    const { world, worker, recipient, workshop, store, village } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; expect(order.recipe).toBe('stone-axe');
    store.goods[missing] = 0; syncStocks(village);
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    expect(store.reservations).toEqual([]); expect(stockOf(village, missing === 'wood' ? 'stone' : 'wood')).toBe(missing === 'wood' ? 2 : 1);
    expect(order.recipe).toBe('stone-axe'); expect(world.equipment.items).toEqual([]);
  });
  it('reserves the last batch once and cancellation releases exactly that order', () => {
    const { world, worker, recipient, workshop, village, store } = fixture();
    const otherShop = world.spawn('core:workshop', { x: 24, y: 30 })!; otherShop.components.workplace!.villageId = village.id;
    const rival = world.spawn('core:person', { x: 22.3, y: 30 })!; rival.components.person!.age = 30; rival.components.citizen!.villageId = village.id;
    const first = requestCraft(world, recipient, 'weapon')!, second = requestCraft(world, rival, 'weapon')!;
    expect(startCraft(world, worker, first, workshop)).toBe(true);
    expect(startCraft(world, rival, second, otherShop)).toBe(false);
    cancelCraft(world, first); expect(store.reservations).toEqual([]);
    expect(startCraft(world, rival, second, otherShop)).toBe(true);
    cancelCraft(world, first); expect(store.reservations[0].claimant).toBe(rival.id);
    finish(world, rival); expect(stockOf(village, 'stone')).toBe(0); expect(world.equipment.items).toHaveLength(1);
  });
  it('does not release a new food job when an interrupted maker was reassigned', () => {
    const { world, worker, recipient, workshop, village, store } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop);
    const bakery = world.spawn('core:bakery', { x: 28, y: 30 })!; bakery.components.workplace!.villageId = village.id;
    deposit(village, { flour: 2 });
    Object.assign(worker.components.citizen!, { task: 'work', targetId: bakery.id, work: { good: 'bread', progress: 0, cargo: null, reservation: { villageId: village.id, inputs: { flour: 2 } } } });
    reserveGoods(world, village, { flour: 2 }, worker.id); cancelCraft(world, order);
    expect(store.reservations).toEqual([{ claimant: worker.id, goods: { flour: 2 } }]);
  });
  it('does not craft an equal tier to reroll quality and respects curses', () => {
    const { world, recipient, village } = fixture();
    const old = createItem(world, 'stone-axe', { kind: 'equipped', entityId: recipient.id }, undefined, { strength: 2 });
    expect(selectRecipe(world, recipient, 'weapon')).not.toBe('stone-axe');
    deposit(village, { commonMetal: 10 }); old.modifiers.cursed = 1;
    expect(requestCraft(world, recipient, 'weapon')).toBeUndefined();
  });
  it('does not recreate cancelled orders while the recipient has an unfinished home', () => {
    const { world, recipient, home } = fixture();
    home.components.building!.state = 'planned';
    for (let i = 0; i < 5; i++) { requestCraft(world, recipient, 'weapon'); maintainCrafting(world); }
    expect(world.crafting.orders).toHaveLength(0);
  });
  it.each(['hunger', 'fire', 'home', 'workshop', 'recipient', 'migration'] as const)('releases unpaid work on %s', cause => {
    const { world, worker, recipient, workshop, home, village, store } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop); continueCraft(world, worker);
    if (cause === 'hunger') worker.components.citizen!.hunger = 80;
    if (cause === 'fire') workshop.components.thermal!.burning = true;
    if (cause === 'home') world.remove(home.id);
    if (cause === 'workshop') world.remove(workshop.id);
    if (cause === 'recipient') world.remove(recipient.id);
    if (cause === 'migration') recipient.components.citizen!.task = 'migrate';
    maintainCrafting(world);
    expect(order.state).toBe('cancelled'); expect(order.paid).toBe(false);
    expect(store.reservations).toEqual([]); expect(stockOf(village, 'stone')).toBe(2); expect(world.equipment.items).toHaveLength(0);
  });
  it('cannot work through a newly flooded approach and does nothing while paused', () => {
    const { world, worker, recipient, workshop, store } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop);
    world.paused = true; finish(world, worker); expect(order.progress).toBe(0);
    world.paused = false;
    for (let y = 0; y < 48; y++) world.terrain.set(23, y, Terrain.Water);
    continueCraft(world, worker); expect(order.state).toBe('cancelled'); expect(store.reservations).toHaveLength(0);
  });
  it('replays a saved in-progress order with identical author, quality and item id', () => {
    const { world, worker, recipient, workshop } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop); continueCraft(world, worker);
    const copy = restore(world), other = copy.entities.get(worker.id)!;
    // Unrelated random activity cannot reroll an already reserved order.
    copy.rng.next(); finish(world, worker); finish(copy, other);
    expect(copy.equipment.items).toEqual(world.equipment.items); expect(world.equipment.items[0].author.id).toBe(worker.id);
    expect(restore(copy).equipment.items).toEqual(world.equipment.items);
  });
  it('uses preferred types and permits only valid modifiers with bounded skill attempts', () => {
    const { world, recipient, worker, village } = fixture();
    deposit(village, { wood: 4, leather: 3, bone: 2, gems: 2 });
    expect(selectRecipe(world, recipient, 'weapon', { preferredKinds: ['bow'] })).toBe('wood-bow');
    const dwarf = world.spawn('core:dwarf', { x: 30, y: 30 })!;
    expect(modifierTries(worker)).toBe(1); expect(modifierTries(dwarf)).toBe(3); expect(modifierTries(dwarf, true)).toBe(8);
    const high = { recipe: 'leather-armor', seed: 3, tries: 8 }, low = { ...high, tries: 1 };
    const lowMods = craftedModifiers(low), highMods = craftedModifiers(high);
    expect(validModifiers(highMods, 'armor')).toBe(true);
    for (const [id, n] of Object.entries(lowMods)) expect(highMods[id as keyof typeof highMods]).toBeGreaterThanOrEqual(n);
    const ring = requestCraft(world, recipient, 'ring')!;
    expect(ring.recipe).toBe('bone-ring'); expect(ring.inputs).toEqual(EQUIPMENT['bone-ring'].recipe.inputs);
  });
  it('delivers once, keeps the old item in exactly one location and never refunds paid output', () => {
    const { world, worker, recipient, workshop, market, village } = fixture();
    const old = createItem(world, 'wood-axe', { kind: 'equipped', entityId: recipient.id });
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop); finish(world, worker);
    expect(carriedItems(world, worker.id)).toHaveLength(1); expect(stockOf(village, 'stoneAxes')).toBe(0);
    cancelCraft(world, order); expect(stockOf(village, 'stone')).toBe(0);
    arrive(world, worker, 17.8, 24); worker.components.citizen!.targetId = market.id; continueVillageWork(world, worker); continueVillageWork(world, worker);
    expect(stockOf(village, 'stoneAxes')).toBe(1);
    const item = world.equipment.items.find(i => i.id === order.resultId)!;
    arrive(world, recipient, 17.8, 24); expect(equipItem(world, recipient, item)).toBe(true);
    expect(world.equipment.items.filter(i => i.id === old.id)).toHaveLength(1); expect(old.location.kind).toBe('stored');
    expect(restore(world).equipment.items).toHaveLength(2);
  });
  it('keeps a paid accessory with its carrier while storage is full, then delivers one instance', () => {
    const { world, worker, recipient, workshop, village, store, market } = fixture();
    deposit(village, { bone: 1, gems: 1 });
    const order = requestCraft(world, recipient, 'ring')!; startCraft(world, worker, order, workshop); finish(world, worker);
    expect(carriedItems(world, worker.id)[0].definition).toBe('bone-ring');
    const capacity = store.capacity; store.capacity = 1; // No further hand-off is possible.
    arrive(world, worker, 17.8, 24); worker.components.citizen!.targetId = market.id; continueVillageWork(world, worker);
    expect(carriedItems(world, worker.id)).toHaveLength(1); expect(stockOf(village, 'bone')).toBe(0);
    store.capacity = capacity; worker.components.citizen!.task = 'deliver'; worker.components.citizen!.targetId = market.id;
    continueVillageWork(world, worker); maintainCrafting(world);
    expect(order.state).toBe('completed'); expect(store.equipmentVolume).toBe(1); expect(stockOf(village, 'stoneAxes')).toBe(0);
    expect(restore(world).equipment.items).toHaveLength(1);
  });
  it('leaves the paid output as one piece of loot when its maker dies', () => {
    const { world, worker, recipient, workshop, village } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop); finish(world, worker);
    world.remove(worker.id); maintainCrafting(world);
    expect(order.state).toBe('completed'); expect(world.equipment.items).toHaveLength(1);
    expect(world.equipment.items[0].location.kind).toBe('ground'); expect(stockOf(village, 'stone')).toBe(0);
    expect(restore(world).equipment.items).toHaveLength(1);
  });
  it('migrates unfinished axes without a free output and leaves bread work intact', () => {
    const { world, worker, recipient, workshop, village } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop); continueCraft(world, worker);
    const bakery = world.spawn('core:bakery', { x: 28, y: 30 })!; bakery.components.workplace!.villageId = village.id;
    deposit(village, { flour: 2 });
    Object.assign(recipient.components.citizen!, { task: 'work', targetId: bakery.id, work: { good: 'bread', progress: 2, cargo: null, reservation: { villageId: village.id, inputs: { flour: 2 } } } });
    reserveGoods(world, village, { flour: 2 }, recipient.id);
    const raw = world.snapshot(); raw.version = 36; delete raw.crafting; delete raw.entities.find(e => e.id === worker.id)!.components.citizen!.work!.orderId;
    const copy = new World(world.seed, world.registry, decodeSave(raw, world.registry));
    expect(copy.equipment.items).toHaveLength(0); expect(copy.crafting.orders[0].progress).toBe(0.5);
    const baker = copy.entities.get(recipient.id)!; arrive(copy, baker, 26.3, 30);
    for (let i = 0; i < 4; i++) continueVillageWork(copy, baker);
    expect(baker.components.citizen!.work!.cargo?.good).toBe('bread');
    finish(copy, copy.entities.get(worker.id)!); expect(copy.equipment.items).toHaveLength(1);
    expect(restore(copy).equipment.items).toHaveLength(1);
  });
  it('rejects forged paid flags, duplicate workers and mismatched ingredients', () => {
    const { world, worker, recipient, workshop } = fixture();
    const order = requestCraft(world, recipient, 'weapon')!; startCraft(world, worker, order, workshop);
    for (const change of [(s: ReturnType<World['snapshot']>) => { s.crafting!.orders[0].paid = true; },
      (s: ReturnType<World['snapshot']>) => { s.crafting!.orders[0].inputs.wood = 0; },
      (s: ReturnType<World['snapshot']>) => { s.crafting!.orders.push({ ...s.crafting!.orders[0], id: s.crafting!.nextOrderId++ }); }]) {
      const raw = world.snapshot(); change(raw); expect(() => decodeSave(raw, world.registry)).toThrow();
    }
  });
});
