import { bundleLoad } from '../src/core/resources';
import { deposit } from '../src/core/resource-ledger';
import { describe, expect, it, vi } from 'vitest';
import { EQUIPMENT, EQUIPMENT_SLOTS, PROJECTILES, itemRarity } from '../src/core/equipment-catalog';
import { assignItem, carriedItems, continueItemPickup, createItem, editItem, equipmentBonuses, equipItem, equippedItem, equippedItems, giftEquipment, relocateItem, removeEquippedItem, transferMoney } from '../src/core/equipment';
import { attackReach, combatStopped, equipmentSystem, performAttack } from '../src/systems/equipment';
import { decodeSave } from '../src/persistence/schema';
import { World } from '../src/core/world';
import { Terrain, STEP } from '../src/core/types';
import { initializeStorage, storesOf } from '../src/core/stockpiles';
import { assignHouse } from '../src/systems/society';
import { transferBuilding } from '../src/core/buildings';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { flatWorld } from './helpers';
import { equipmentMessages } from '../src/content/equipment-text';
import { translate, languages } from '../src/i18n';

function person(world: World, x = 20, y = 20) {
  const e = world.spawn('core:person', { x, y })!;
  e.components.person!.age = 30; return e;
}
function restore(world: World): World { return new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry)); }
function settlement() {
  const world = flatWorld(), home = world.spawn('core:house', { x: 20, y: 20 })!, village = assignHouse(world, home);
  const resident = person(world, 16, 20); resident.components.citizen!.villageId = village.id;
  initializeStorage(world, village);
  return { world, home, village, resident, store: storesOf(village)[0] };
}
describe('individual equipment', () => {
  it('looks up owners without scanning unrelated loot and updates ownership immediately', () => {
    const world = flatWorld(), a = person(world), b = person(world, 24);
    const axe = createItem(world, 'stone-axe', { kind: 'equipped', entityId: a.id });
    for (let i = 0; i < 100; i++) createItem(world, 'stone-axe', { kind: 'ground', x: 10, y: 10 });
    const filter = vi.spyOn(world.equipment.items, 'filter');
    for (let i = 0; i < 20; i++) expect(equippedItem(world, a.id, 'weapon')).toBe(axe);
    expect(filter).not.toHaveBeenCalled(); filter.mockRestore();
    relocateItem(world, axe, { kind: 'carried', entityId: b.id, villageId: 1 }, 'gift');
    expect(equippedItem(world, a.id, 'weapon')).toBeUndefined();
    expect(carriedItems(world, b.id)).toEqual([axe]);
    relocateItem(world, axe, { kind: 'equipped', entityId: b.id }, 'equipped');
    expect(carriedItems(world, b.id)).toEqual([]);
    expect(equippedItems(world, b.id)).toEqual([axe]);
    const replacement = structuredClone(world.equipment.items);
    world.equipment.items = replacement;
    expect(equippedItem(world, b.id, 'weapon')).toBe(replacement[0]);
    const detached = equippedItems(world, b.id); detached.length = 0;
    expect(equippedItem(world, b.id, 'weapon')).toBe(replacement[0]);
  });
  it('migrates exactly one legacy axe and retains its +4 in actual combat after repeated reloads', () => {
    const world = flatWorld(), attacker = person(world), victim = person(world, 21);
    const raw = world.snapshot(); raw.version = 35; delete raw.equipment;
    raw.entities.find(e => e.id === attacker.id)!.components.citizen!.weapon = 'stone-axe';
    let copy = new World(world.seed, world.registry, decodeSave(raw, world.registry));
    copy = restore(restore(copy));
    expect(copy.equipment.items).toHaveLength(1);
    const target = copy.entities.get(victim.id)!, health = target.components.health!.current;
    expect(performAttack(copy, copy.entities.get(attacker.id)!, target)).toBe(true);
    expect(health - target.components.health!.current).toBe(16);
  });
  it('rejects stone bows, invalid slots, poison and excessive modifier levels', () => {
    const world = flatWorld(), e = person(world);
    for (const id of ['stone-bow', 'stone-armor', 'wood-ring']) expect(() => createItem(world, id, { kind: 'equipped', entityId: e.id })).toThrow();
    expect(() => createItem(world, 'stone-axe', { kind: 'equipped', entityId: e.id }, undefined, { health: 1 })).toThrow();
    const axe = createItem(world, 'stone-axe', { kind: 'equipped', entityId: e.id });
    const raw = world.snapshot(); Object.assign(raw.equipment!.items[0].modifiers, { poison: 1 });
    expect(() => decodeSave(raw, world.registry)).toThrow();
    axe.modifiers.strength = 6; expect(() => restore(world)).toThrow();
    expect(itemRarity({ strength: 2 })).toBe('Rare');
    expect(itemRarity({ eternal: 1 })).toBe('Unmodified');
    expect(EQUIPMENT['copper-ring'].recipe.inputs).not.toEqual(EQUIPMENT['bronze-ring'].recipe.inputs);
  });
  it('recomputes six independent slots from base without healing or accumulating health', () => {
    const world = flatWorld(), e = person(world), base = e.components.health!.max;
    const helmet = createItem(world, 'leather-helmet', { kind: 'ground', x: 20, y: 20 }, undefined, { health: 3, speed: 2 });
    for (let n = 0; n < 100; n++) {
      expect(equipItem(world, e, helmet)).toBe(true);
      expect(e.components.health!.max).toBe(base + 15);
      expect(equipmentBonuses(world, e).speed).toBe(0.1);
      expect(removeEquippedItem(world, e, 'helmet')).toBe(true);
      expect(e.components.health!.max).toBe(base); expect(e.components.health!.current).toBe(base);
    }
    for (const slot of EQUIPMENT_SLOTS) createItem(world, slot === 'weapon' ? 'stone-axe' : `${['ring', 'amulet'].includes(slot) ? 'bone' : 'leather'}-${slot}`, { kind: 'equipped', entityId: e.id });
    expect(EQUIPMENT_SLOTS.every(slot => equippedItem(world, e.id, slot))).toBe(true);
    expect(() => restore(world)).not.toThrow();
  });
  it('reserves a single stored instance, resumes a walk after reload and respects pause', () => {
    const { world, home, village, resident, store } = settlement(), rival = person(world, 15, 19);
    rival.components.citizen!.villageId = village.id;
    createItem(world, 'stone-axe', { kind: 'stored', buildingId: home.id });
    expect(assignItem(world, resident)).toBe(true); expect(assignItem(world, rival)).toBe(false);
    const copy = restore(world), walker = copy.entities.get(resident.id)!;
    walker.components.position = { x: 18.3, y: 20 }; walker.components.citizen!.path = [];
    copy.paused = true; continueItemPickup(copy, walker); copy.step();
    expect(copy.equipment.items[0].location.kind).toBe('stored');
    copy.paused = false; continueItemPickup(copy, walker); continueItemPickup(copy, walker);
    expect(copy.equipment.items).toHaveLength(1); expect(copy.equipment.items[0].location).toEqual({ kind: 'equipped', entityId: walker.id });
    expect(copy.society.villages[0].economy!.stocks.stoneAxes).toBe(0);
    expect(store.goods.stoneAxes).toBe(1); expect(() => restore(copy)).not.toThrow();
  });
  it('blocks ordinary replacement of a curse and preserves eternal favorites when storage is full', () => {
    const { world, village, resident, store } = settlement();
    resident.components.position = { x: 18.3, y: 20 };
    const old = createItem(world, 'stone-axe', { kind: 'equipped', entityId: resident.id }, undefined, { cursed: 1, eternal: 1 }); old.favorite = true;
    const better = createItem(world, 'steel-spear', { kind: 'ground', x: 18, y: 20 });
    expect(equipItem(world, resident, better)).toBe(false); expect(removeEquippedItem(world, resident, 'weapon')).toBe(false);
    delete old.modifiers.cursed;
    store.capacity = Math.max(1, bundleLoad(store.goods).volume);
    deposit(village, { tools: 1 });
    expect(equipItem(world, resident, better)).toBe(true);
    expect(old.location.kind).toBe('ground'); expect(old.favorite).toBe(true); expect(old.modifiers.eternal).toBe(1);
  });
  it('gifts only after eligible contact and keeps declined gifts with their owner; wallets stay separate', () => {
    const world = flatWorld(), giver = person(world), receiver = person(world, 21); receiver.components.person!.age = 50;
    const item = createItem(world, 'stone-axe', { kind: 'equipped', entityId: giver.id });
    expect(giftEquipment(world, giver, receiver, item, { completed: false, rule: 'elders', relation: 'family' })).toBe(false);
    expect(giftEquipment(world, giver, receiver, item, { completed: true, rule: null, relation: 'family' })).toBe(false);
    const original = { ...item.location };
    let accepted = false;
    for (let attempt = 0; attempt < 100 && !accepted; attempt++) {
      accepted = giftEquipment(world, giver, receiver, item, { completed: true, rule: 'elders', relation: 'family' });
      if (!accepted) expect(item.location).toEqual(original);
    }
    expect(accepted).toBe(true); expect(world.equipment.items).toHaveLength(1);
    expect(item.location).toEqual({ kind: 'equipped', entityId: receiver.id });
    const a = { money: 20 }, b = { money: 1 }; expect(transferMoney(a, b, 5)).toBe(true);
    expect(a.money + b.money).toBe(21); expect(transferMoney(a, b, 30)).toBe(false);
  });
  it('routes death once to a capable nearby killer; natural attacks never become loot', () => {
    const world = flatWorld(), victim = person(world), killer = person(world, 21);
    const item = createItem(world, 'stone-axe', { kind: 'equipped', entityId: victim.id });
    victim.components.health!.current = 0;
    world.die(victim.id, { cause: 'conflict', sourceId: killer.id }); world.die(victim.id, { cause: 'conflict', sourceId: killer.id });
    expect(item.location).toEqual({ kind: 'equipped', entityId: killer.id }); expect(world.equipment.items).toHaveLength(1);
    const wolf = world.spawn('core:wolf', { x: 25, y: 20 })!; wolf.components.health!.current = 0; world.die(wolf.id, { cause: 'conflict', sourceId: killer.id });
    expect(world.equipment.items).toHaveLength(1); expect(() => restore(world)).not.toThrow();
  });
  it('keeps identity, author, condition and favorite through player edits, and rejects duplicate ownership', () => {
    const world = flatWorld(), e = person(world), item = createItem(world, 'stone-axe', { kind: 'equipped', entityId: e.id }, { id: e.id, name: 'Rowan' });
    item.favorite = true; item.durability = 42;
    expect(editItem(world, item.id, 'reforge')).toBe(true); expect(editItem(world, item.id, 'transmute', 'wood-bow')).toBe(true);
    expect(item).toMatchObject({ id: 1, author: { name: 'Rowan' }, durability: 42, favorite: true, playerMarked: true });
    expect(editItem(world, item.id, 'transmute', 'leather-boots')).toBe(false);
    expect(() => restore(world)).not.toThrow();
    const raw = world.snapshot(); raw.equipment!.items.push(structuredClone(item)); expect(() => decodeSave(raw, world.registry)).toThrow();
  });
  it('transmutes a carried axe without a phantom resource, then physically delivers the same item', () => {
    const { world, village, resident, home, store } = settlement();
    const item = createItem(world, 'stone-axe', { kind: 'carried', entityId: resident.id, villageId: village.id });
    expect(resident.components.citizen!.work!.cargo!.amount).toBe(1);
    editItem(world, item.id, 'transmute', 'white-staff');
    expect(resident.components.citizen!.work!.cargo).toBeNull();
    const copy = restore(world); expect(copy.equipment.items).toHaveLength(1);
    expect(assignVillageWork(world, resident)).toBe(true);
    resident.components.position = { x: 18.3, y: 20 }; resident.components.citizen!.path = [];
    continueVillageWork(world, resident);
    expect(item.location).toEqual({ kind: 'stored', buildingId: home.id });
    expect(store.goods.stoneAxes).toBe(0); expect(store.equipmentVolume).toBe(1);
    expect(() => restore(world)).not.toThrow();
  });
  it('keeps stored identity through capture and drops a favorite exactly once on collapse', () => {
    const { world, home, resident } = settlement();
    const item = createItem(world, 'stone-axe', { kind: 'stored', buildingId: home.id }, undefined, { eternal: 1 }); item.favorite = true;
    expect(assignItem(world, resident)).toBe(true);
    const secondHome = world.spawn('core:house', { x: 40, y: 40 })!, other = assignHouse(world, secondHome);
    transferBuilding(world, home, other);
    expect(item.location).toEqual({ kind: 'stored', buildingId: home.id });
    world.snapshot(); expect(item.claim).toBeUndefined();
    world.remove(home.id); world.remove(home.id);
    expect(item.location.kind).toBe('ground'); expect(world.equipment.items).toHaveLength(1);
    expect(item.favorite).toBe(true); expect(item.modifiers.eternal).toBe(1);
  });
});
describe('equipment combat', () => {
  it('gives spears reach and hammers multiple targets with stun', () => {
    const world = flatWorld(), e = person(world), target = person(world, 22.5), other = person(world, 21.2, 20.5);
    createItem(world, 'wood-spear', { kind: 'equipped', entityId: e.id });
    expect(attackReach(world, e)).toBe(2.7); expect(performAttack(world, e, target)).toBe(true);
    editItem(world, 1, 'transmute', 'wood-hammer'); e.components.citizen!.attackIn = 0; target.components.position!.x = 21;
    world.spatial.update(target); expect(performAttack(world, e, target)).toBe(true);
    expect(combatStopped(target)).toBe(true); expect(combatStopped(other)).toBe(true);
  });
  it('saves real projectile flight, freezes it on pause, and applies its hit once after reload', () => {
    const world = flatWorld(), e = person(world, 16), target = person(world, 23);
    createItem(world, 'wood-bow', { kind: 'equipped', entityId: e.id });
    const before = target.components.health!.current;
    expect(performAttack(world, e, target)).toBe(true); expect(target.components.health!.current).toBe(before);
    for (let n = 0; n < 5; n++) equipmentSystem(world, STEP);
    const copy = restore(world); copy.paused = true;
    const position = { ...copy.equipment.shots[0] }; equipmentSystem(copy, STEP); expect(copy.equipment.shots[0]).toEqual(position);
    copy.paused = false;
    for (let n = 0; n < 45; n++) { equipmentSystem(world, STEP); equipmentSystem(copy, STEP); }
    expect(copy.entities.get(target.id)!.components.health!.current).toBeLessThan(before);
    expect(copy.snapshot()).toEqual(world.snapshot()); expect(copy.equipment.shots).toHaveLength(0);
    const hit = copy.entities.get(target.id)!.components.health!.current; equipmentSystem(copy, STEP);
    expect(copy.entities.get(target.id)!.components.health!.current).toBe(hit);
  });
  it('lets immunity block a staff status while the impact still causes damage', () => {
    const world = flatWorld(), e = person(world, 16), target = person(world, 23);
    target.components.combat = { baseHealth: 70, immunities: ['ice'], statuses: {} };
    createItem(world, 'white-staff', { kind: 'equipped', entityId: e.id });
    performAttack(world, e, target);
    for (let n = 0; n < 40; n++) equipmentSystem(world, STEP);
    expect(target.components.health!.current).toBeLessThan(70); expect(target.components.combat.statuses.ice).toBeUndefined();
    expect(Object.keys(PROJECTILES)).toHaveLength(13);
  });
  it('preserves gear while swimming and denies a handoff across water', () => {
    const world = flatWorld(), e = person(world), item = createItem(world, 'stone-axe', { kind: 'equipped', entityId: e.id });
    world.terrain.set(20, 20, Terrain.Water);
    expect(restore(world).equipment.items[0].id).toBe(item.id);
    const receiver = person(world, 21); const owner = { ...item.location };
    expect(equipItem(world, receiver, item, 'gift')).toBe(false); expect(item.location).toEqual(owner);
  });
  it('localizes every item label and property without losing placeholders', () => {
    for (const [source, translations] of Object.entries(equipmentMessages)) {
      for (const [index, language] of languages.entries()) {
        expect(translate(source, language.id)).toBe(translations[index]);
        const tokens = (s: string) => [...s.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
        expect(tokens(translations[index])).toEqual(tokens(translations[0]));
      }
    }
  });
});
