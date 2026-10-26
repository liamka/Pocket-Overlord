import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { Terrain } from '../src/core/types';
import { createItem } from '../src/core/equipment';
import { deposit, inTransit, stockOf } from '../src/core/resource-ledger';
import { foodReserve } from '../src/core/seasons';
import { shipmentCarriers, supplyPolicy } from '../src/core/supply';
import { decodeSave } from '../src/persistence/schema';
import { caravans, dispatchCaravan } from '../src/systems/caravans';
import { advance, setFood, villageWorld } from './helpers';

function supplyWorld(): World {
  const source = villageWorld(), snapshot = source.snapshot();
  snapshot.terrain.tiles.fill(Terrain.Grass);
  const tiles = Array.from({ length: 29 }, (_, i) => 26 * 48 + i + 8);
  for (const i of tiles) snapshot.terrain.tiles[i] = Terrain.Road;
  snapshot.society.roads = [{ a: 1, b: 2, tiles, built: tiles.length }];
  const world = new World(snapshot.seed, source.registry, snapshot, [{ id: 'core:caravans', update: caravans }]);
  for (const v of world.society.villages) setFood(v, 24);
  deposit(world.society.villages[0], { stone: 50, wood: 50 });
  return world;
}
const wagon = (world: World) => [...world.query('caravan')][0];

describe('physical supplies', () => {
  it('keeps the seasonal food reserve and gives one sender only one active assignment', () => {
    const world = supplyWorld(), [a, b] = world.society.villages;
    const reserve = foodReserve(world.tick, [...world.query('citizen')].filter(e => e.components.citizen!.villageId === a.id).length);
    setFood(a, reserve + 5); setFood(b, 0);
    expect(dispatchCaravan(world, a.id, b.id, 12)).toBe(true);
    expect(a.food).toBe(reserve); expect(b.food).toBe(0);
    expect(inTransit(world, a.id)).toEqual({ provisions: 5 });
    expect(dispatchCaravan(world, a.id, b.id, 10, 'stone')).toBe(false);
    expect(shipmentCarriers(world)).toHaveLength(1);
    expect(a.economy!.storage!.every(s => !s.reservations.length)).toBe(true);
    expect(decodeSave(world.snapshot(), world.registry).version).toBe(world.snapshot().version);
  });

  it('cannot send materials ahead of a starving recipient and credits stone only on arrival', () => {
    const world = supplyWorld(), [a, b] = world.society.villages;
    setFood(b, 0); expect(dispatchCaravan(world, a.id, b.id, 10, 'stone')).toBe(false);
    setFood(b, 24); expect(dispatchCaravan(world, a.id, b.id, 10, 'stone')).toBe(true);
    expect(stockOf(a, 'stone')).toBe(40); expect(stockOf(b, 'stone')).toBe(0);
    expect(inTransit(world, a.id).stone).toBe(10);
    const carrier = wagon(world);
    for (let i = 0; i < 600 && carrier.components.shipment!.phase !== 'complete'; i++) world.step();
    expect(stockOf(b, 'stone')).toBe(10);
    expect(carrier.components.shipment!.delivered).toBe(10);
    expect(a.economy!.supplyAfter).toBe(world.tick + supplyPolicy(world, a, 'stone').cooldown);
    const saved = decodeSave(world.snapshot(), world.registry);
    const loaded = new World(saved.seed, world.registry, saved, [{ id: 'core:caravans', update: caravans }]);
    advance(loaded, 3);
    expect(stockOf(loaded.society.villages[1], 'stone')).toBe(10);
    expect(stockOf(loaded.society.villages[0], 'stone') + stockOf(loaded.society.villages[1], 'stone')).toBe(50);
  });

  it('preserves item identity, author and wear through transport and reload', () => {
    const world = supplyWorld(), [a, b] = world.society.villages;
    const buildingId = a.economy!.storage![0].buildingId;
    const author = [...world.query('person')][0];
    const axe = createItem(world, 'stone-axe', { kind: 'stored', buildingId }, { id: author.id, name: 'Maker' });
    axe.durability = 7;
    createItem(world, 'stone-axe', { kind: 'stored', buildingId });
    expect(dispatchCaravan(world, a.id, b.id, 1, 'equipment')).toBe(true);
    expect(axe.location).toEqual({ kind: 'carried', entityId: wagon(world).id, villageId: a.id });
    const save = decodeSave(world.snapshot(), world.registry);
    const loaded = new World(save.seed, world.registry, save, [{ id: 'core:caravans', update: caravans }]);
    advance(loaded, 15);
    const delivered = loaded.equipment.items.find(i => i.id === axe.id)!;
    expect(delivered.author).toEqual(axe.author); expect(delivered.durability).toBe(7);
    expect(delivered.location).toEqual({ kind: 'stored', buildingId: b.economy!.storage![0].buildingId });
    expect(loaded.equipment.items).toHaveLength(2);
    expect(() => decodeSave(loaded.snapshot(), loaded.registry)).not.toThrow();
  });

  it('waits at a changed crossing without teleporting or crediting the cargo', () => {
    const world = supplyWorld(); dispatchCaravan(world, 1, 2, 10, 'stone');
    const carrier = wagon(world);
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    advance(world, 14);
    expect(carrier.components.position!.x).toBeLessThan(24);
    expect(carrier.components.shipment!.goods.stone).toBe(10);
    expect(carrier.components.shipment!.reason).toBe('Supply route blocked');
    expect(stockOf(world.society.villages[1], 'stone')).toBe(0);
    world.terrain.set(24, 26, Terrain.Road); advance(world, 15);
    expect(stockOf(world.society.villages[1], 'stone')).toBe(10);
  });

  it('returns the same cargo after war or destruction of the receiving store', () => {
    for (const cause of ['war', 'store']) {
      const world = supplyWorld(); dispatchCaravan(world, 1, 2, 10, 'stone'); advance(world, 3);
      const carrier = wagon(world);
      if (cause === 'war') world.society.relations[0].status = 'war';
      else world.remove(carrier.components.shipment!.destinationId);
      advance(world, 8);
      expect(stockOf(world.society.villages[0], 'stone')).toBe(50);
      expect(stockOf(world.society.villages[1], 'stone')).toBe(0);
      expect(shipmentCarriers(world)).toHaveLength(0);
      expect(world.society.villages[0].economy!.supplyHistory!.some(e => e.reason === 'Supply returned')).toBe(true);
    }
  });

  it('retains cargo at a full store and records carrier destruction exactly once', () => {
    const world = supplyWorld(), [a, b] = world.society.villages;
    dispatchCaravan(world, 1, 2, 10, 'stone');
    const carrier = wagon(world), store = b.economy!.storage![0];
    deposit(b, { provisions: store.capacity - b.food }); advance(world, 14);
    expect(carrier.components.shipment!.reason).toBe('Supply storage full');
    expect(carrier.components.shipment!.goods.stone).toBe(10);
    world.remove(carrier.id); world.remove(carrier.id);
    expect(a.economy!.lost!.stone).toBe(10);
    expect(stockOf(a, 'stone') + (a.economy!.lost!.stone ?? 0)).toBe(50);
    expect(a.economy!.supplyHistory!.at(-1)!.reason).toBe('Supply carrier lost');
  });

  it('rejects cargo duplication in a save', () => {
    const world = supplyWorld(); dispatchCaravan(world, 1, 2, 10, 'stone');
    const save = world.snapshot(), carrier = save.entities.find(e => e.components.shipment)!;
    carrier.components.shipment!.goods.stone = 11;
    expect(() => decodeSave(save, world.registry)).toThrow();
  });
});
