import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { unitStats } from '../src/core/unit-stats';
import { Terrain, type Entity } from '../src/core/types';
import { SOURCE_SPECIALS } from '../src/content/species-reference';
import { EQUIPMENT } from '../src/core/equipment-catalog';
import { createItem, equipmentBonuses, equipItem, removeEquippedItem, relocateItem } from '../src/core/equipment';
import { requestCraft } from '../src/core/crafting';
import { cancelJob, claimJob } from '../src/core/jobs';
import { huntable, protectedHerd } from '../src/core/hunting';
import { cargoContents, deposit, stockOf } from '../src/core/resource-ledger';
import { collectKillDrops, deathGoods, extractSource, releaseResources } from '../src/core/resource-sources';
import { initializeStorage, storesOf } from '../src/core/stockpiles';
import { economyOf } from '../src/core/village-life';
import { decodeSave } from '../src/persistence/schema';
import { assignHouse } from '../src/systems/society';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { continueCraft, startCraft } from '../src/systems/crafting';
import { equipmentHit, equipmentSystem, performAttack } from '../src/systems/equipment';
import { applyEvent, fire } from '../src/systems/effects';
import { flatWorld } from './helpers';

function fixture() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 12, y: 20 })!, village = assignHouse(world, home);
  village.food = 40;
  const market = world.spawn('core:market', { x: 16, y: 24 })!, workshop = world.spawn('core:workshop', { x: 24, y: 24 })!;
  market.components.workplace!.villageId = workshop.components.workplace!.villageId = village.id;
  const workers = [18, 20, 22, 26].map(x => world.spawn('core:person', { x, y: 20 })!);
  for (const e of workers) { Object.assign(e.components.person!, { age: 30, homeId: home.id }); e.components.citizen!.villageId = village.id; }
  initializeStorage(world, village);
  return { world, village, market, workshop, workers, worker: workers[0] };
}
function animal(world: World, kind = 'sheep', x = 30): Entity {
  const e = world.spawn(`core:${kind}`, { x, y: 12 })!; e.components.animal!.age = 20; return e;
}
function kill(world: World, e: Entity): Entity {
  applyEvent(world, { kind: 'damage', target: e.id, amount: 1e5, cause: 'conflict' });
  return [...world.query('resourcePile')].find(p => p.components.resourcePile!.originId === e.id)!;
}
function arrive(world: World, worker: Entity, source: Entity): void {
  Object.assign(worker.components.position!, { x: source.components.position!.x - 1.8, y: source.components.position!.y });
  worker.components.citizen!.path = []; world.spatial.update(worker);
}
function gather(world: World, worker: Entity, pile: Entity): void {
  arrive(world, worker, pile);
  Object.assign(worker.components.citizen!, { task: 'work', targetId: pile.id, work: { good: 'leather', progress: 1, cargo: null } });
}
const reload = (w: World): World => new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));

describe('leather hunting and protection', () => {
  it('issues sheep and wolf loot only at final death and preserves it across replay and load', () => {
    const { world } = fixture(), sheep = animal(world), wolf = animal(world, 'wolf', 35);
    equipmentHit(world, 1, sheep, 1, []); expect([...world.query('resourcePile')]).toEqual([]);
    const pile = kill(world, sheep); kill(world, wolf);
    expect(pile.components.resourcePile!.goods.leather).toBe(2);
    expect([...world.query('resourcePile')].find(p => p.components.resourcePile!.originId === wolf.id)!.components.resourcePile!.goods.leather).toBe(1);
    releaseResources(world, sheep, true); kill(world, sheep);
    const restored = reload(world); releaseResources(restored, sheep, true);
    expect([...restored.query('resourcePile')]).toHaveLength(2);
    const bad = world.snapshot(); bad.entities.push({ ...structuredClone(pile), id: bad.nextEntityId++ });
    expect(() => decodeSave(bad, world.registry)).toThrow();
  });
  it('uses separate confirmed forms and never borrows an animal profile for an unsupported form', () => {
    const { world } = fixture(), sheep = animal(world);
    expect(deathGoods(world, sheep).leather).toBe(2);
    const source = (id: string) => SOURCE_SPECIALS.find(s => s.id === id)!.baseDrops?.leather ?? 0;
    expect([source('sheep'), source('baakin'), source('dog'), source('barkfolk'), source('wolf'), source('howleer')]).toEqual([2, 1, 1, 0, 1, 1]);
    sheep.components.creature!.speciesId = 'baakin';
    expect(deathGoods(world, sheep)).toEqual({}); // Future body owner must explicitly activate its own drops.
  });
  it('reserves one breeding pair and young animals consistently for overlapping villages', () => {
    const { world, village, workers } = fixture();
    const herd = [28, 29, 30, 31].map(x => animal(world, 'sheep', x));
    herd[3].components.animal!.age = 0;
    expect([...protectedHerd(world, herd[2])]).toEqual([herd[3].id, herd[0].id, herd[1].id]);
    expect(huntable(world, village, herd[2])).toBe(true);
    expect(claimJob(world, workers[0], 'hunter', herd[2].id, 'leather')).toBe(true);
    const otherHome = world.spawn('core:house', { x: 42, y: 30 })!, otherVillage = assignHouse(world, otherHome);
    workers[1].components.citizen!.villageId = otherVillage.id;
    expect(claimJob(world, workers[1], 'hunter', herd[2].id, 'leather')).toBe(false);
    kill(world, herd[2]);
    expect(herd.filter(e => world.entities.has(e.id)).every(e => !huntable(world, village, e))).toBe(true);
    const restored = reload(world);
    expect(huntable(restored, restored.society.villages[0], restored.entities.get(herd[0].id)!)).toBe(false);
  });
  it('assigns leather hunting with enough food, then delivers an interrupted batch only once', () => {
    const { world, village, worker, market } = fixture();
    const herd = [28, 29, 30].map(x => animal(world, 'sheep', x));
    expect(assignVillageWork(world, worker)).toBe(true);
    expect(worker.components.citizen!.work!.good).toBe('leather');
    const pile = kill(world, herd[2]); gather(world, worker, pile);
    expect(extractSource(world, worker, pile)).toBe(true);
    cancelJob(world, worker, 'Responding to danger');
    expect(cargoContents(worker.components.citizen!.work!.cargo!).leather).toBe(2);
    const restored = reload(world), carrier = restored.entities.get(worker.id)!;
    expect(assignVillageWork(restored, carrier)).toBe(true);
    arrive(restored, carrier, restored.entities.get(market.id)!);
    continueVillageWork(restored, carrier); continueVillageWork(restored, carrier);
    expect(stockOf(restored.society.villages.find(v => v.id === village.id)!, 'leather')).toBe(2);
    expect(carrier.components.citizen!.work?.cargo).toBeFalsy();
  });
  it('blocks pickup across water and retains undeliverable cargo at a full store', () => {
    const { world, village, worker } = fixture(), pile = kill(world, animal(world));
    gather(world, worker, pile); world.terrain.set(29, 12, Terrain.Water);
    expect(extractSource(world, worker, pile)).toBe(false);
    expect(collectKillDrops(world, worker, pile)).toBe(false);
    world.terrain.set(29, 12, Terrain.Grass); expect(extractSource(world, worker, pile)).toBe(true);
    const cargo = structuredClone(worker.components.citizen!.work!.cargo);
    for (const store of storesOf(village)) { store.goods = {}; store.capacity = 0; }
    expect(assignVillageWork(world, worker)).toBe(false);
    expect(worker.components.citizen!.work!.cargo).toEqual(cargo);
  });
  it('rechecks a saved hunting arrow when its target becomes part of the breeding reserve', () => {
    const { world, worker } = fixture(), herd = [28, 29, 30, 31].map(x => animal(world, 'sheep', x));
    createItem(world, 'wood-bow', { kind: 'equipped', entityId: worker.id }); assignVillageWork(world, worker);
    const target = world.entities.get(worker.components.citizen!.targetId!)!;
    Object.assign(worker.components.position!, { x: target.components.position!.x - 3, y: 12 }); world.spatial.update(worker);
    expect(performAttack(world, worker, target)).toBe(true);
    const restored = reload(world), savedTarget = restored.entities.get(target.id)!;
    expect(restored.equipment.shots[0].hunting).toBe(true);
    restored.remove(herd[0].id); const health = savedTarget.components.health!.current;
    for (let i = 0; i < 90; i++) equipmentSystem(restored, 1 / 30);
    expect(savedTarget.components.health!.current).toBe(health); expect(restored.equipment.shots).toEqual([]);
    const invalid = world.snapshot(); Object.assign(invalid.equipment!.shots[0], { hunting: 'yes' });
    expect(() => decodeSave(invalid, world.registry)).toThrow();
  });
  it('records burnt hides and dead carrier cargo as a single loss', () => {
    const { world, village, worker } = fixture(), sheep = animal(world);
    sheep.components.animal!.villageId = village.id;
    const pile = kill(world, sheep);
    applyEvent(world, { kind: 'heat', target: pile.id, amount: 100 }); fire(world, 3);
    expect(world.entities.has(pile.id)).toBe(false);
    expect(economyOf(village).lost?.leather).toBe(2);
    const next = kill(world, animal(world, 'sheep', 34)); gather(world, worker, next); extractSource(world, worker, next);
    kill(world, worker); releaseResources(world, worker, true);
    expect(economyOf(village).lost?.leather).toBe(4);
    expect([...reload(world).query('resourcePile')].reduce((n, e) => n + (e.components.resourcePile!.goods.leather ?? 0), 0)).toBe(0);
  });
  it.each(['helmet', 'armor', 'boots'] as const)('pays %s only after the complete leather recipe and preserves item origin', slot => {
    const { world, village, workers, workshop } = fixture(), worker = workers[0], recipient = workers[1];
    const order = requestCraft(world, recipient, slot)!;
    expect(order.recipe).toBe(`leather-${slot}`);
    expect(startCraft(world, worker, order, workshop)).toBe(false);
    expect(order.paid).toBe(false); expect(storesOf(village).flatMap(s => s.reservations)).toEqual([]);
    deposit(village, { leather: 1 }); expect(startCraft(world, worker, order, workshop)).toBe(true);
    arrive(world, worker, workshop); for (let i = 0; i < 8; i++) continueCraft(world, worker);
    const item = world.equipment.items.find(i => i.id === order.resultId)!;
    expect(stockOf(village, 'leather')).toBe(0); expect(item.origin?.orderId).toBe(order.id);
    expect(reload(world).equipment.items.find(i => i.id === item.id)?.origin).toEqual(item.origin);
  });
  it('applies real defense, wear, boots movement and metal replacement without refunding leather', () => {
    const { world, village, workers } = fixture(), wearer = workers[0], attacker = workers[1];
    const item = createItem(world, 'leather-armor', { kind: 'equipped', entityId: wearer.id });
    const health = wearer.components.health!, before = health.current;
    equipmentHit(world, attacker.id, wearer, 10, []); const defended = before - health.current;
    expect(item.durability).toBe(99); expect(equipmentBonuses(world, wearer).armor).toBe(2);
    removeEquippedItem(world, wearer, 'armor'); const naked = health.current;
    equipmentHit(world, attacker.id, wearer, 10, []); expect(naked - health.current).toBeGreaterThan(defended);
    relocateItem(world, item, { kind: 'equipped', entityId: wearer.id }, 'equipped'); item.durability = 1;
    world.paused = true; equipmentHit(world, attacker.id, wearer, 1, []); expect(item.durability).toBe(1);
    world.paused = false; equipmentHit(world, attacker.id, wearer, 1, []);
    expect(equipmentBonuses(world, wearer).armor).toBe(0);
    const brokenHealth = health.current; equipmentHit(world, attacker.id, wearer, 10, []);
    expect(brokenHealth - health.current).toBeGreaterThan(defended);
    const metal = createItem(world, 'copper-armor', { kind: 'ground', ...wearer.components.position! });
    expect(equipItem(world, wearer, metal)).toBe(true);
    expect(equipmentBonuses(world, wearer).armor).toBe(4); expect(stockOf(village, 'leather')).toBe(0);
    const speed = unitStats(world, wearer).values.speed;
    createItem(world, 'leather-boots', { kind: 'equipped', entityId: wearer.id }); expect(equipmentBonuses(world, wearer).speed).toBe(0.03);
    expect(unitStats(world, wearer).values.speed).toBeGreaterThan(speed);
    const restored = reload(world); expect(restored.equipment.items.find(i => i.id === item.id)?.durability).toBe(0);
    expect(Object.values(EQUIPMENT).filter(d => d.material === 'leather').map(d => d.slot)).toEqual(['helmet', 'armor', 'boots']);
  });
  it('adopts v58 remains without generating stock, resetting wear or rerolling drops', () => {
    const { world, village, worker } = fixture(), pile = kill(world, animal(world));
    const item = createItem(world, 'leather-helmet', { kind: 'equipped', entityId: worker.id }); item.durability = 37;
    const old = world.snapshot(); old.version = 58;
    const saved = old.entities.find(e => e.id === pile.id)!; delete saved.components.thermal; delete saved.components.combustible;
    const copy = new World(old.seed, world.registry, decodeSave(old, world.registry));
    expect(copy.entities.get(pile.id)!.components.resourcePile).toEqual(pile.components.resourcePile);
    expect(stockOf(copy.society.villages.find(v => v.id === village.id)!, 'leather')).toBe(0);
    expect(copy.equipment.items.find(i => i.id === item.id)!.durability).toBe(37);
    expect(copy.rng.state).toBe(old.rngState);
    expect(reload(copy).snapshot()).toEqual(copy.snapshot());
  });
});
