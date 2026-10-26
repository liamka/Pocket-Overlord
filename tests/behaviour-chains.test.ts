import { describe, expect, it } from 'vitest';
import { enterBehaviour } from '../src/core/behaviour';
import { reserveDeposit } from '../src/core/deposits';
import { cargoContents, deposit, stockOf } from '../src/core/resource-ledger';
import { initializeStorage } from '../src/core/stockpiles';
import type { Entity } from '../src/core/types';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { assignVillageWork, continueVillageWork } from '../src/systems/economy';
import { assignHouse } from '../src/systems/society';
import { flatWorld } from './helpers';

function settlement() {
  const world = flatWorld();
  const home = world.spawn('core:house', { x: 16, y: 24 })!;
  const village = assignHouse(world, home);
  const worker = world.spawn('core:person', { x: 20, y: 20 })!;
  Object.assign(worker.components.person!, { age: 30, homeId: home.id, reproduceIn: 100000, buildIn: 100000 });
  worker.components.citizen!.villageId = village.id;
  const market = world.spawn('core:market', { x: 22, y: 26 })!;
  market.components.workplace!.villageId = village.id;
  initializeStorage(world, village); deposit(village, { provisions: 60 });
  const source = world.spawn('core:stone', { x: 30, y: 20 })!;
  Object.assign(worker.components.citizen!, { task: 'work', targetId: source.id, work: { good: 'stone', progress: 0, cargo: null } });
  return { world, worker, source, village, market };
}

function arrive(world: World, worker: Entity, target: Entity): void {
  Object.assign(worker.components.position!, { x: target.components.position!.x - 1.8, y: target.components.position!.y });
  worker.components.citizen!.path = [];
  world.spatial.update(worker);
}

describe('behaviour chains and existing action owners', () => {
  it('releases the old claim when the same stage is assigned another target', () => {
    const { world, worker, source } = settlement(), c = worker.components.citizen!;
    expect(enterBehaviour(world, worker, 'gather', 'approach')).toBe(true);
    expect(reserveDeposit(world, source, worker)).toBe(true);
    const replacement = world.spawn('core:stone', { x: 32, y: 24 })!;
    c.targetId = replacement.id;
    expect(enterBehaviour(world, worker, 'gather', 'approach')).toBe(true);
    expect(source.components.stone!.claims).toEqual([]);
    expect(c.behaviour!.targetId).toBe(replacement.id);
  });

  it('carries the final batch through hunger and reload, crediting it only once at storage', () => {
    const { world, worker, source, village } = settlement(), c = worker.components.citizen!;
    source.components.stone!.remaining = 4;
    arrive(world, worker, source);
    for (let i = 0; i < 8; i++) continueVillageWork(world, worker);
    expect(world.entities.has(source.id)).toBe(false);
    expect(c.behaviour).toMatchObject({ taskId: 'gather', stageId: 'carry', status: 'active' });
    const cargo = structuredClone(c.work!.cargo!);
    expect(cargoContents(cargo)).toEqual({ stone: 4 });
    expect(stockOf(village, 'stone')).toBe(0);
    c.hunger = 75;
    continueVillageWork(world, worker);
    expect(c.work!.cargo).toEqual(cargo);
    const saved = decodeSave(world.snapshot(), world.registry);
    const loaded = new World(world.seed, world.registry, saved);
    const carrier = loaded.entities.get(worker.id)!, resident = carrier.components.citizen!;
    resident.hunger = 0;
    expect(assignVillageWork(loaded, carrier)).toBe(true);
    expect(resident.work!.cargo).toEqual(cargo);
    arrive(loaded, carrier, loaded.entities.get(resident.targetId!)!);
    continueVillageWork(loaded, carrier);
    continueVillageWork(loaded, carrier);
    expect(stockOf(loaded.society.villages[0], 'stone')).toBe(4);
    expect(resident.work?.cargo).toBeFalsy();
    expect(loaded.entities.has(source.id)).toBe(false);
  });

  it('rejects a delivery whose saved owner differs from its destination', () => {
    const { world, worker, market, village } = settlement();
    Object.assign(worker.components.citizen!, { task: 'deliver', targetId: market.id,
      work: { good: 'stone', progress: 0, cargo: { good: 'stone', amount: 4, villageId: village.id } } });
    expect(enterBehaviour(world, worker, 'delivery', 'carry')).toBe(true);
    const saved = world.snapshot();
    saved.entities.find(e => e.id === market.id)!.components.workplace!.villageId = null;
    expect(() => decodeSave(saved, world.registry)).toThrow();
  });
});
