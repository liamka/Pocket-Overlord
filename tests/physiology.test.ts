import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { Terrain, type Entity } from '../src/core/types';
import { changePhysiology, type PhysiologyId } from '../src/content/subspecies-traits';
import { updateSubspecies } from '../src/core/subspecies';
import { subspeciesOf } from '../src/core/subspecies-state';
import { needsFood, subspeciesRoom } from '../src/core/physiology';
import { consumeMineral, photosynthesize, physiologySystem, produceMineral } from '../src/systems/physiology';
import { nutritionRemaining } from '../src/core/unit-stats';
import { reserveDeposit, releaseDepositClaim } from '../src/core/deposits';
import { assignHouse } from '../src/systems/society';
import { applyStatus } from '../src/core/status-effects';
import { startReproduction } from '../src/core/reproduction';
import { decodeSave } from '../src/persistence/schema';

function add(w: World, e: Entity, ...traits: PhysiologyId[]): void {
  const shared = subspeciesOf(e)!;
  const next = traits.reduce((draft, id) => changePhysiology(draft, id, true), shared.traits);
  expect(updateSubspecies(w, shared.id, { traits: next })).toBe(true);
}

describe('subspecies physiology transitions', () => {
  it('removes every stomach dependency together while retaining photosynthesis and stored nutrition', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 20 })!;
    add(w, e, 'lithotroph', 'big-stomach', 'stone-production', 'photosynthetic-skin');
    const food = nutritionRemaining(e), shared = subspeciesOf(e)!;
    expect(updateSubspecies(w, shared.id, { traits: shared.traits.filter(t => t !== 'stomach') })).toBe(true);
    expect(needsFood(e)).toBe(false);
    expect(shared.traits).toContain('photosynthetic-skin');
    for (const id of ['omnivore', 'lithotroph', 'big-stomach', 'stone-production']) expect(shared.traits).not.toContain(id);
    expect(nutritionRemaining(e)).toBeCloseTo(food);
    expect(applyStatus(w, e, 'starving')).toBe(false);
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('cannot eat a reserved mineral lot or eat twice in one tick', () => {
    const w = flatWorld(), home = w.spawn('core:house', { x: 25, y: 20 })!, village = assignHouse(w, home);
    const miner = w.spawn('core:person', { x: 15, y: 20 })!, eater = w.spawn('core:person', { x: 11.8, y: 20 })!, ore = w.spawn('core:stone', { x: 13.5, y: 20 })!;
    add(w, eater, 'lithotroph');
    miner.components.person!.age = 30;
    Object.assign(miner.components.citizen!, { villageId: village.id, task: 'work', targetId: ore.id, work: { good: 'stone', progress: 0 }, hunger: 0 });
    eater.components.citizen!.hunger = 90; ore.components.stone!.remaining = 4;
    expect(reserveDeposit(w, ore, miner)).toBe(true);
    const food = nutritionRemaining(eater);
    expect(consumeMineral(w, eater, ore)).toBe(false);
    expect(nutritionRemaining(eater)).toBe(food);
    expect(ore.components.stone!.remaining).toBe(4);
    releaseDepositClaim(w, miner.id);
    expect(consumeMineral(w, eater, ore)).toBe(true);
    expect(ore.components.stone!.remaining).toBe(3);
    expect(nutritionRemaining(eater)).toBeCloseTo(food + 20);
    expect(consumeMineral(w, eater, ore)).toBe(false);
  });

  it('does not photosynthesize or consume randomness in dark ages, including without a stomach', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 20 })!;
    add(w, e, 'photosynthetic-skin'); const s = subspeciesOf(e)!;
    updateSubspecies(w, s.id, { traits: s.traits.filter(t => t !== 'stomach') });
    e.components.citizen!.hunger = 80;
    const climate = w.registry.biomeClimate(w), food = nutritionRemaining(e), rng = w.rng.state;
    for (const age of ['dark', 'despair'] as const) {
      w.registry.biomeClimate = () => ({ ...climate, age }); w.tick += 300;
      expect(photosynthesize(w, e)).toBe(false);
      expect(nutritionRemaining(e)).toBe(food); expect(w.rng.state).toBe(rng);
    }
    w.registry.biomeClimate = () => ({ ...climate, age: 'hope' }); w.tick += 300;
    expect(photosynthesize(w, e)).toBe(true);
    expect(nutritionRemaining(e)).toBeGreaterThan(food);
  });

  it('damages an aquatic body on land and rejects drowning in water', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 10, y: 20 })!;
    add(w, e, 'aquatic'); w.tick = 30; physiologySystem(w);
    expect(w.events).toContainEqual({ kind: 'damage', target: e.id, amount: Math.max(1, e.components.health!.max * 0.1), cause: 'water' });
    w.events.length = 0; w.terrain.set(10, 20, Terrain.Water); w.tick = 60; physiologySystem(w);
    expect(w.events.filter(event => event.kind === 'damage')).toEqual([]);
    expect(applyStatus(w, e, 'drowning')).toBe(false);
  });

  it('adds egg requirements atomically and replaces incompatible reproduction methods', () => {
    const w = flatWorld(), e = w.spawn('core:sheep', { x: 10, y: 20 })!;
    add(w, e, 'eyeball-egg'); const s = subspeciesOf(e)!;
    expect(s.traits).toContain('oviparity'); expect(s.traits).not.toContain('viviparity');
    expect(s.reproduction!.form).toBe('oviparity');
    add(w, e, 'fission');
    expect(s.reproduction!.methods).toEqual(['fission']); expect(s.reproduction!.form).toBe('direct');
    expect(s.traits).not.toContain('oviparity'); expect(s.traits).not.toContain('eyeball-egg');
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('blocks the next reproduction at 50 members without deleting existing creatures or drawing RNG', () => {
    const w = flatWorld(), e = w.spawn('core:sheep', { x: 10, y: 20 })!;
    add(w, e, 'minimal-population', 'fission');
    for (let i = 1; i < 50; i++) w.spawn('core:sheep', { x: 10 + i % 5 * 0.1, y: 20 + Math.floor(i / 5) * 0.1 });
    e.components.animal!.age = 100; e.components.animal!.hunger = 0; e.components.health!.current = e.components.health!.max;
    const rng = w.rng.state;
    expect(subspeciesRoom(w, e)).toBe(0); expect(startReproduction(w, e, 'fission')).toBe(false);
    expect(e.components.reproduction!.last?.reason).toBe('Subspecies population limit');
    expect(w.rng.state).toBe(rng); expect([...w.query('animal')]).toHaveLength(50);
    expect(e.components.reproduction!.pending).toBeUndefined();
  });

  it('does not produce a deposit on occupied ground or consume food for failed placement', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 20, y: 20 })!;
    add(w, e, 'stone-production');
    for (let i = 0; i < 8; i++) w.spawn('core:house', { x: 20 + Math.cos(i * Math.PI / 4) * 2.8, y: 20 + Math.sin(i * Math.PI / 4) * 2.8 });
    w.tick = 1800; const food = nutritionRemaining(e);
    expect(produceMineral(w, e)).toBe(false); expect([...w.query('stone')]).toHaveLength(0);
    expect(nutritionRemaining(e)).toBe(food);
  });

  it('resumes an active route deterministically and releases a removed food target', () => {
    const w = flatWorld(), e = w.spawn('core:person', { x: 12, y: 20 })!;
    add(w, e, 'lithotroph', 'photosynthetic-skin'); e.components.citizen!.hunger = 90;
    const ore = w.spawn('core:stone', { x: 20, y: 20 })!;
    w.tick = 30; physiologySystem(w);
    expect(e.components.physiology!.action?.targetId).toBe(ore.id);
    const loaded = new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));
    for (let i = 0; i < 120; i++) { w.step(); loaded.step(); }
    expect(loaded.snapshot()).toEqual(w.snapshot());
    w.paused = true; const paused = w.snapshot();
    for (let i = 0; i < 90; i++) w.step();
    expect(w.snapshot()).toEqual(paused); w.paused = false;
    e.components.physiology!.action = { kind: 'mineral', targetId: ore.id, x: 20, y: 20 };
    w.remove(ore.id); expect(e.components.physiology!.action).toBeUndefined();
    expect(() => decodeSave(w.snapshot(), w.registry)).not.toThrow();
  });

  it('approaches prey within its actual attack range before receiving nutrition', () => {
    const w = flatWorld(), hunter = w.spawn('core:person', { x: 10, y: 20 })!, prey = w.spawn('core:sheep', { x: 14, y: 20 })!;
    add(w, hunter, 'carnivore'); add(w, prey, 'unmoving', 'energy-preserver');
    hunter.components.citizen!.hunger = 80;
    const food = nutritionRemaining(hunter), health = prey.components.health!.current;
    for (let i = 0; i < 300; i++) w.step();
    expect(prey.components.health!.current).toBeLessThan(health);
    expect(nutritionRemaining(hunter)).toBeGreaterThan(food);
  });
});
