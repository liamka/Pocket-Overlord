import { describe, expect, it } from 'vitest';
import { NEURONS, NEURON_BY_ID } from '../src/content/neurons';
import { chooseNeuron, commitNeuron, evaluateNeurons, neuronReady, neuronsOf, recordNeuronAttempt, setNeuronEnabled } from '../src/core/neurons';
import { beginWait, enterBehaviour } from '../src/core/behaviour';
import { World } from '../src/core/world';
import { decodeSave } from '../src/persistence/schema';
import { validNeurons } from '../src/persistence/neurons';
import { intentions, movement, settlement } from '../src/systems/people';
import { emergencies } from '../src/systems/emergencies';
import { findPath, withDecisionRoutes } from '../src/systems/navigation';
import { STEP, Terrain } from '../src/core/types';
import { flatWorld } from './helpers';

function resident() {
  const world = flatWorld(), entity = world.spawn('core:person', { x: 12, y: 12 })!;
  entity.components.person!.age = 30;
  return { world, entity, c: entity.components.citizen! };
}

describe('neuron decisions', () => {
  it('keeps large-world metabolism and staggered decisions deterministic across a mid-cycle save', () => {
    const base = flatWorld(), systems = [{ id: 'test:intentions', update: intentions }];
    const world = new World(base.seed, base.registry, base.snapshot(), systems);
    for (let i = 0; i < 60; i++) world.spawn('core:person', { x: 5 + i % 10 * 3, y: 5 + Math.floor(i / 10) * 3 });
    for (const e of world.query('citizen')) e.components.citizen!.reconsiderIn = 100;
    for (let i = 0; i < 7; i++) world.step();
    const saved = world.snapshot(), restored = new World(world.seed, world.registry, saved, systems);
    for (let i = 0; i < 23; i++) { world.step(); restored.step(); }
    expect(restored.snapshot()).toEqual(world.snapshot());
    for (const e of world.query('citizen')) expect(e.components.citizen!.reconsiderIn).toBe(99);
  });
  it('evaluates without consuming RNG, initializing state or changing the world', () => {
    const { world, entity } = resident(), before = world.snapshot();
    const offers = [{ id: 'try_to_eat_city_food', reason: 'No suitable food' as const }, { id: 'wait5' }];
    expect(evaluateNeurons(world, entity, offers).find(c => c.definition.id === 'try_to_eat_city_food')?.reason).toBe('No suitable food');
    evaluateNeurons(world, entity, offers);
    expect(world.snapshot()).toEqual(before);
  });

  it('uses the 80/20 layer split and stable exponential weights, including extreme finite values', () => {
    const { world, entity } = resident();
    const pool = evaluateNeurons(world, entity, [{ id: 'wait5', weight: Number.MAX_VALUE }, { id: 'try_to_eat_city_food', weight: 0 }]);
    expect(chooseNeuron(pool, 0.79, 0.5)?.definition.id).toBe('try_to_eat_city_food');
    expect(chooseNeuron(pool, 0.8, 0.5)?.definition.id).toBe('wait5');
    const invalid = evaluateNeurons(world, entity, [{ id: 'wait5', weight: Infinity }]);
    expect(chooseNeuron(invalid, 0, 0)).toBeUndefined();
  });

  it('retains disabled intentions and cooldowns across validated save/load and makes the same subsequent choice', () => {
    const { world, entity } = resident();
    setNeuronEnabled(world, entity, 'random_move', false);
    recordNeuronAttempt(world, entity, 'find_city_job', false);
    const saved = decodeSave(world.snapshot(), world.registry);
    const loaded = new World(world.seed, world.registry, saved), copy = loaded.entities.get(entity.id)!;
    expect(neuronReady(loaded, copy, 'random_move')).toBe(false);
    expect(neuronReady(loaded, copy, 'find_city_job')).toBe(false);
    const offers = [{ id: 'wait5' }, { id: 'reflection' }, { id: 'random_move' }];
    const chosen: string[] = [];
    commitNeuron(world, entity, offers, id => { chosen.push(id); return true; });
    commitNeuron(loaded, copy, offers, id => { chosen.push(id); return true; });
    expect(chosen[0]).toBe(chosen[1]);
    expect(loaded.rng.state).toBe(world.rng.state);
    expect(copy.components.citizen!.neurons).toEqual(entity.components.citizen!.neurons);
  });

  it('does not select a failed unreachable high-weight attempt again until its retry, or spend RNG on an empty pool', () => {
    const { world, entity, c } = resident();
    for (let y = 0; y < 48; y++) world.terrain.set(24, y, Terrain.Water);
    const offers = [{ id: 'find_city_job', weight: 1e8 }];
    let attempts = 0;
    const start = () => { attempts++; return findPath(world, entity.components.position!, { x: 32, y: 12 }) !== undefined; };
    expect(commitNeuron(world, entity, offers, start)).toBe(false);
    expect(c.neurons!.retries.find_city_job).toBeGreaterThan(world.tick);
    expect(c.neurons!.cooldowns.find_city_job).toBeUndefined();
    const rng = world.rng.state;
    world.tick += 30;
    expect(commitNeuron(world, entity, offers, start)).toBe(false);
    expect(attempts).toBe(1); expect(world.rng.state).toBe(rng);
    expect(c.targetId).toBeNull();
  });

  it('leaves clocks and randomness unchanged on pause', () => {
    const { world, entity } = resident();
    recordNeuronAttempt(world, entity, 'find_city_job', true);
    world.paused = true;
    const before = world.snapshot();
    intentions(world); movement(world, STEP); settlement(world);
    commitNeuron(world, entity, [{ id: 'wait5' }], () => true);
    expect(world.snapshot()).toEqual(before);
  });

  it('resumes a confirmed wait mid-transition with the same clocks and RNG as uninterrupted movement', () => {
    const { world, entity } = resident();
    commitNeuron(world, entity, [{ id: 'wait5' }], id => beginWait(world, entity, id));
    world.tick += 10;
    movement(world, STEP);
    const loaded = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    for (let i = 0; i < 150; i++) {
      world.tick++; loaded.tick++;
      movement(world, STEP); movement(loaded, STEP);
    }
    expect(loaded.entities.get(entity.id)!.components).toEqual(entity.components);
    expect(loaded.rng.state).toBe(world.rng.state);
    expect(entity.components.citizen!.behaviour?.status).toBe('completed');
  });

  it('does not let a sleeping, stunned or player-controlled resident begin construction', () => {
    for (const block of ['sleeping', 'stunned', 'controlled']) {
      const { world, entity, c } = resident();
      entity.components.person!.buildIn = -1;
      const n = neuronsOf(entity);
      if (block === 'sleeping') n.sleepingUntil = 150;
      if (block === 'controlled') n.playerControlled = true;
      if (block === 'stunned') entity.components.combat = { baseHealth: entity.components.health!.max, immunities: [], statuses: { stun: 1 } };
      settlement(world); intentions(world);
      expect([...world.query('dwelling')]).toHaveLength(0);
      expect(c.task).toBe('idle');
    }
  });

  it('bounds route searches in a decision and shares its budget across residents', () => {
    const { world } = resident(), shared = { remaining: 2 };
    const route = () => findPath(world, { x: 2, y: 2 }, { x: 4, y: 4 });
    withDecisionRoutes(world, shared, () => { expect(route()).toBeDefined(); expect(route()).toBeDefined(); expect(route()).toBeUndefined(); });
    withDecisionRoutes(world, shared, () => expect(route()).toBeUndefined());
    expect(route()).toBeDefined();
  });

  it('suspends mining in danger without changing the physical cargo', () => {
    const { world, entity, c } = resident();
    const source = world.spawn('core:stone', { x: 18, y: 12 })!;
    c.task = 'work'; c.targetId = source.id;
    c.work = { good: 'stone', progress: 1, cargo: { good: 'stone', amount: 2, villageId: 1 } };
    enterBehaviour(world, entity, 'gather', 'approach');
    const cargo = structuredClone(c.work.cargo);
    world.spawn('core:dynamite', { x: 13, y: 12 });
    emergencies(world, STEP);
    expect(c.emergency?.kind).toBe('flee');
    expect(c.behaviour?.status).toBe('suspended');
    expect(c.work.cargo).toEqual(cargo);
    expect(c.neurons?.last?.id).toBe('run_away');
  });

  it('rejects unknown ids, non-finite deadlines, duplicate disabling and impossible future save times', () => {
    const { world, entity } = resident(), n = neuronsOf(entity);
    expect(validNeurons({ ...n, disabled: ['made_up'] })).toBe(false);
    expect(validNeurons({ ...n, disabled: ['wait5', 'wait5'] })).toBe(false);
    expect(validNeurons({ ...n, cooldowns: { wait5: Infinity } })).toBe(false);
    n.nextDecisionAt = world.tick + 31;
    expect(() => decodeSave(world.snapshot(), world.registry)).toThrow();
  });

  it('keeps the complete source catalogue and different attempt clocks without executable placeholders', () => {
    expect(NEURONS).toHaveLength(127); expect(NEURON_BY_ID.size).toBe(127);
    expect(NEURON_BY_ID.get('asexual_reproduction_spores')?.cooldown).toBe(60);
    expect(NEURON_BY_ID.get('give_tax')?.cooldown).toBe(90);
    expect(NEURON_BY_ID.get('check_plot')?.support).toBe('unavailable');
  });
});
