import { describe, expect, it } from 'vitest';
import { flatWorld } from './helpers';
import { World } from '../src/core/world';
import { applyStatus, clearStatuses, hasStatus, removeStatus, statusEffects, statusOf } from '../src/core/status-effects';
import { applyEvent } from '../src/systems/effects';
import { decodeSave } from '../src/persistence/schema';
import { reconcileStats, unitStats } from '../src/core/unit-stats';
import { decisionBlock } from '../src/core/neurons';
import { statusInspector } from '../src/ui/status-effects';
import { statusDefinitions } from '../src/content/status-effects';
import { startReproduction } from '../src/core/reproduction';

const resident = () => {
  const w = flatWorld(), e = w.spawn('core:person', { x: 12, y: 12 })!;
  if (e.components.traits) e.components.traits.entries = [];
  if (e.components.happiness) delete e.components.happiness.psychopath;
  reconcileStats(w, e); e.components.health!.current = e.components.health!.max;
  return { w, e };
};
const load = (w: World) => new World(w.seed, w.registry, decodeSave(w.snapshot(), w.registry));

describe('temporary status lifecycle', () => {
  it('refreshes fire without moving its periodic tick, and water stops the damage', () => {
    const { w, e } = resident();
    applyStatus(w, e, 'burning');
    w.tick = 59; applyStatus(w, e, 'burning');
    expect(statusOf(e, 'burning')!.nextTick).toBe(60);
    const restored = load(w), copy = restored.entities.get(e.id)!;
    for (const world of [w, restored]) { world.tick = 60; statusEffects(world); statusEffects(world); }
    expect(e.components.health!.current).toBe(63);
    expect(copy.components.health).toEqual(e.components.health);
    applyEvent(w, { kind: 'wet', target: e.id, amount: 1 });
    expect(hasStatus(e, 'burning')).toBe(false);
    w.tick = 120; statusEffects(w);
    expect(e.components.health!.current).toBe(63);
    expect(e.components.statuses!.history.at(-1)?.reason).toBe('water');
  });
  it('neutralizes fire and ice in either application order', () => {
    for (const first of ['burning', 'frozen'] as const) {
      const { w, e } = resident();
      applyStatus(w, e, first); applyStatus(w, e, first === 'burning' ? 'frozen' : 'burning');
      expect(e.components.statuses!.active).toEqual([]);
      expect(e.components.thermal!.burning).toBe(false);
      expect(e.components.health!.current).toBe(70);
    }
  });
  it('stuns one actor while world time continues, with no pause or load reward', () => {
    const { w, e } = resident();
    applyStatus(w, e, 'laughing'); applyStatus(w, e, 'stunned', { seconds: 1 });
    expect(hasStatus(e, 'laughing')).toBe(false);
    expect(decisionBlock(w, e)).toBe('Stunned');
    expect(unitStats(w, e).values.speed).toBe(0);
    w.paused = true;
    const before = w.snapshot(); w.step(); statusEffects(w);
    expect(w.snapshot()).toEqual(before);
    w.paused = false; w.tick = 30; statusEffects(w);
    expect(decisionBlock(w, e)).toBeUndefined();
    expect(unitStats(w, e).values.speed).toBeGreaterThan(0);
  });
  it('awards inspiration once on expiry, never on cure, death, removal or reload', () => {
    for (const reason of ['cured', 'death', 'removed', 'conflict'] as const) {
      const { w, e } = resident();
      applyStatus(w, e, 'inspired'); removeStatus(w, e, 'inspired', reason);
      expect(e.components.happiness!.value).toBe(0);
    }
    const { w, e } = resident();
    applyStatus(w, e, 'inspired', { seconds: 1 });
    w.tick = 29; const restored = load(w);
    for (const world of [w, restored]) { world.tick = 30; statusEffects(world); }
    expect(e.components.happiness!.value).toBe(25);
    expect(restored.snapshot()).toEqual(w.snapshot());
    const again = load(w); statusEffects(again);
    expect(again.entities.get(e.id)!.components.happiness!.value).toBe(25);
    expect(again.rng.state).toBe(w.rng.state);
  });
  it('never births a child on death and removes live target links', () => {
    const { w, e } = resident(), father = w.spawn('core:person', { x: 13, y: 12 })!;
    e.components.person!.sex = 'a'; father.components.person!.sex = 'b';
    e.components.reproduction!.cooldowns = {}; father.components.reproduction!.cooldowns = {};
    expect(startReproduction(w, e, 'sexual', father)).toBe(true);
    applyStatus(w, father, 'fell-in-love', { targetId: e.id, source: e });
    const next = w.nextEntityId;
    applyEvent(w, { kind: 'damage', target: e.id, amount: 1e6 });
    w.tick = 30; statusEffects(w);
    expect(w.population).toBe(1);
    expect(hasStatus(father, 'fell-in-love')).toBe(false);
    expect([...w.query('person')].some(e => e.id >= next)).toBe(false);
    expect(() => load(w)).not.toThrow();
  });
  it('draws the same dream after loading and rejects a premature completion reward', () => {
    const { w, e } = resident();
    applyStatus(w, e, 'sleeping', { seconds: 2 });
    expect(removeStatus(w, e, 'sleeping', 'expired')).toBe(false);
    expect(e.components.happiness!.value).toBe(0);
    w.tick = 59; const restored = load(w);
    for (const world of [w, restored]) { world.tick = 60; statusEffects(world); }
    expect(restored.rng.state).toBe(w.rng.state);
    expect(restored.snapshot()).toEqual(w.snapshot());
    const rng = w.rng.state; statusEffects(w);
    expect(w.rng.state).toBe(rng);
  });
  it('explains level rejection and accepts more than nine compatible states', () => {
    const { w, e } = resident(), ufo = w.spawn('core:ufo', { x: 20, y: 20 })!;
    expect(applyStatus(w, ufo, 'stunned')).toBe(false);
    expect(statusInspector(w, ufo, 'ru', true)).toContain('только базовые');
    for (const id of ['plot-recovery', 'spell-recovery', 'social-recovery', 'combat-recovery', 'dodge', 'dash', 'inspired', 'just-ate', 'silenced', 'motivated'] as const) applyStatus(w, e, id);
    expect(e.components.statuses!.active).toHaveLength(10);
    expect(() => load(w)).not.toThrow();
    clearStatuses(w, e, 'removed');
    expect(e.components.happiness!.value).toBe(0);
  });
  it('migrates remaining clocks without rewards, RNG or a second old timer', () => {
    const { w, e } = resident(), raw = w.snapshot();
    raw.version = 53;
    const c = raw.entities.find(x => x.id === e.id)!.components;
    delete c.statuses;
    c.combat = { baseHealth: 70, immunities: [], statuses: { stun: 0.5 } };
    c.person!.plague = { age: 2, spreadIn: 0.3 };
    const decoded = decodeSave(raw, w.registry), copy = decoded.entities.find(x => x.id === e.id)!;
    expect(statusOf(copy, 'stunned')!.expiresAt).toBe(raw.tick + 15);
    expect(statusOf(copy, 'plague')!.nextTick).toBe(raw.tick + 24);
    expect(copy.components.combat!.statuses).toEqual({});
    expect(copy.components.happiness).toEqual(e.components.happiness);
    expect(decoded.rngState).toBe(raw.rngState);
  });
  it('does not pretend that reproduction without its owner can complete', () => {
    const { w, e } = resident();
    expect(Object.keys(statusDefinitions)).toHaveLength(59);
    expect(applyStatus(w, e, 'budding')).toBe(false);
    expect(e.components.statuses!.rejected?.reason).toBe('Cause no longer present');
  });
});
