import { describe, expect, it } from 'vitest';
import { flatWorld, villageWorld } from './helpers';
import { World } from '../src/core/world';
import { deathOf, DEATH_HISTORY_LIMIT, NOTABLE_DEATH_LIMIT } from '../src/core/death';
import { applyEvent, fire, processEvents } from '../src/systems/effects';
import { afflictions } from '../src/systems/afflictions';
import { createItem } from '../src/core/equipment';
import { economyOf } from '../src/core/village-life';
import { makeCargo } from '../src/core/resource-ledger';
import { decodeSave } from '../src/persistence/schema';
import { SAVE_VERSION } from '../src/core/types';

const kill = (world: World, id: number, cause: 'fire' | 'explosion' | 'plague' | 'conflict' = 'fire', sourceId?: number): void =>
  applyEvent(world, { kind: 'damage', target: id, amount: 100000, cause, ...(sourceId ? { sourceId } : {}) });

describe('death lifecycle', () => {
  it('resolves simultaneous lethal events in FIFO order once, including remains and equipment', () => {
    const world = flatWorld(), victim = world.spawn('core:person', { x: 20, y: 20 })!;
    createItem(world, 'stone-axe', { kind: 'equipped', entityId: victim.id });
    world.events.push({ kind: 'damage', target: victim.id, amount: 100000, cause: 'explosion' },
      { kind: 'damage', target: victim.id, amount: 100000, cause: 'fire' });
    processEvents(world); kill(world, victim.id);
    expect(world.deaths.total).toBe(1); expect(world.deaths.causes.explosion).toBe(1); expect(world.deaths.causes.fire).toBe(0);
    expect([...world.query('resourcePile')]).toHaveLength(1);
    expect(world.equipment.items).toHaveLength(1); expect(world.equipment.items[0].location.kind).toBe('ground');
  });

  it('does not count exhausted deposits or departing units as deaths or war casualties', () => {
    const world = flatWorld(), deposit = world.spawn('core:stone', { x: 20, y: 20 })!;
    deposit.components.stone!.remaining = 0; world.remove(deposit.id);
    const person = world.spawn('core:person', { x: 20, y: 20 })!;
    person.components.health!.current = 0; world.remove(person.id);
    expect(world.deaths.total).toBe(0); expect([...world.query('resourcePile')]).toHaveLength(0);
    expect(world.unitHistory.find(m => m.id === person.id)?.died).toBe(false);
  });

  it('keeps blast order and RNG identical after rebuilding the spatial index on load', () => {
    const world = flatWorld(), first = world.spawn('core:person', { x: 21, y: 21 })!;
    world.spawn('core:person', { x: 22, y: 21 });
    // Re-entering a cell changes bucket order, but not saved entity order.
    first.components.position!.x = 30; world.spatial.update(first);
    first.components.position!.x = 21; world.spatial.update(first);
    world.events.push({ kind: 'blast', x: 21, y: 21, radius: 3, power: 10000, heat: 100 });
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    processEvents(world); processEvents(loaded);
    expect(world.deaths.total).toBe(2); expect(world.snapshot()).toEqual(loaded.snapshot());
  });

  it('attributes plague to the disease and leaves equipment on the ground beside an unrelated fighter', () => {
    const world = flatWorld(), victim = world.spawn('core:person', { x: 20, y: 20 })!, neighbor = world.spawn('core:person', { x: 21, y: 20 })!;
    createItem(world, 'stone-axe', { kind: 'equipped', entityId: victim.id });
    victim.components.health!.current = 0.01; victim.components.person!.plague = { age: 3, spreadIn: 0.8 };
    neighbor.components.citizen!.task = 'fight'; neighbor.components.citizen!.targetId = victim.id;
    afflictions(world, 1 / 30);
    expect(deathOf(world, victim.id)).toMatchObject({ cause: 'plague', initiator: null });
    expect(world.equipment.items[0].location.kind).toBe('ground');
    expect(neighbor.components.citizen!.targetId).toBeNull();
  });

  it('preserves an ignition source after departure and across saves without advancing a paused world', () => {
    const world = flatWorld(), source = world.spawn('core:person', { x: 20, y: 20 })!, victim = world.spawn('core:person', { x: 24, y: 20 })!;
    source.components.unit!.customName = 'Ember';
    applyEvent(world, { kind: 'heat', target: victim.id, amount: 200, sourceId: source.id });
    world.remove(source.id); victim.components.health!.current = 0.2;
    const systems = [{ id: 'test:fire', update: fire }, { id: 'test:events', update: processEvents }];
    const snapshot = decodeSave(world.snapshot(), world.registry), a = new World(world.seed, world.registry, snapshot, systems), b = new World(world.seed, world.registry, snapshot, systems);
    b.paused = true; const paused = b.snapshot(); b.step(); expect(b.snapshot()).toEqual(paused); b.paused = false;
    a.step(); b.step();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(deathOf(b, victim.id)).toMatchObject({ cause: 'fire', initiator: { id: source.id, name: 'Ember' } });
    expect(decodeSave(b.snapshot(), b.registry).rngState).toBe(b.rng.state);
  });

  it('loses cargo once, clears partnerships and appoints an elder before the next tick', () => {
    const world = villageWorld([{ x: 24, y: 24 }]), village = world.society.villages[0];
    const victim = world.entities.get(village.government!.leaderId!)!, partner = [...world.query('person')].find(e => e.id !== victim.id)!;
    victim.components.citizen!.partnerId = partner.id; partner.components.citizen!.partnerId = victim.id;
    victim.components.citizen!.work = { good: 'stone', progress: 0, cargo: makeCargo({ stone: 4 }, village.id, 'stone') };
    victim.components.citizen!.task = 'deliver';
    const before = economyOf(village).stocks.stone;
    kill(world, victim.id); kill(world, victim.id);
    expect(economyOf(village).lost?.stone).toBe(4); expect(economyOf(village).stocks.stone).toBe(before);
    expect(partner.components.citizen!.partnerId).toBeNull();
    expect(village.government!.leaderId).not.toBeNull(); expect(village.government!.leaderId).not.toBe(victim.id);
    expect(deathOf(world, victim.id)).toMatchObject({ ruler: true, successor: { id: village.government!.leaderId } });
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('closes the old identity before raising remains and never awards a second biological drop', () => {
    const world = flatWorld(), victim = world.spawn('core:sheep', { x: 20, y: 20 })!;
    victim.components.unit!.favorite = true; kill(world, victim.id);
    const pile = [...world.query('resourcePile')][0], raised = world.raiseRemains(pile.id, 'core:sheep')!;
    expect(raised.id).not.toBe(victim.id); expect(world.entities.has(victim.id)).toBe(false);
    expect(deathOf(world, victim.id)?.transformedInto?.id).toBe(raised.id);
    expect(world.unitHistory.find(m => m.id === victim.id)?.died).toBe(true);
    kill(world, raised.id);
    expect(world.deaths.total).toBe(2); expect([...world.query('resourcePile')]).toHaveLength(0);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('bounds history independently of the total and rejects duplicated or inconsistent records', () => {
    const world = flatWorld();
    for (let i = 0; i < DEATH_HISTORY_LIMIT + 5; i++) {
      const victim = world.spawn('core:person', { x: 20, y: 20 })!; victim.components.unit!.favorite = true;
      kill(world, victim.id);
    }
    expect(world.deaths.total).toBe(DEATH_HISTORY_LIMIT + 5);
    expect(world.deaths.recent).toHaveLength(DEATH_HISTORY_LIMIT); expect(world.deaths.notable).toHaveLength(NOTABLE_DEATH_LIMIT);
    const snapshot = world.snapshot(); expect(() => decodeSave(snapshot, world.registry)).not.toThrow();
    snapshot.deaths!.recent[1] = snapshot.deaths!.recent[0]; expect(() => decodeSave(snapshot, world.registry)).toThrow();
    const invalid = world.snapshot(); invalid.deaths!.total++; expect(() => decodeSave(invalid, world.registry)).toThrow();
  });

  it('migrates without inventing old causes, loot or random draws', () => {
    const world = flatWorld(), victim = world.spawn('core:person', { x: 20, y: 20 })!; kill(world, victim.id);
    const old = world.snapshot(); old.version = 47; delete old.deaths;
    const loaded = decodeSave(old, world.registry);
    expect(loaded.version).toBe(SAVE_VERSION); expect(loaded.deaths!.total).toBe(0);
    expect(loaded.rngState).toBe(old.rngState); expect(loaded.entities).toEqual(old.entities);
  });
});
