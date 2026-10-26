import type { Registry } from '../content/registry';
import { monthTicks } from './calendar';
import { Random } from './random';
import type { World } from './world';

export type ProcessPhase = 'landscape' | 'resources';
export interface WorldProcessDefinition {
  id: string;
  phase: ProcessPhase;
  scope: 'tiles' | 'entities' | 'samples' | 'biomes';
  intervalMonths: readonly [number, number];
  budget: number;
  /** Integration keys for the future world-law/age owners, not a second rules store. */
  dependencies: { laws: readonly string[]; ages: readonly string[] };
  collect: (world: World, random: Random) => number[];
  visit: (world: World, item: number, random: Random) => void;
}
export interface ProcessState {
  id: string;
  enabled: boolean;
  nextAt: number | null;
  scheduleRng: number;
  workRng: number;
  lastStep: number | null;
  pending: { dueAt: number; startedAt: number; items: number[]; cursor: number } | null;
  metrics: { runs: number; completed: number; cancelled: number; processed: number; lastDueAt: number | null; maxDelay: number; totalDelay: number };
}
export interface WorldProcesses { version: 1; tasks: ProcessState[] }

function streamSeed(seed: number, key: string): number {
  let hash = seed ^ 0x811c9dc5;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
function interval(definition: WorldProcessDefinition, state: ProcessState): number {
  const random = new Random(state.scheduleRng), [min, max] = definition.intervalMonths;
  const ticks = min === max ? monthTicks(min) : Math.floor(random.range(monthTicks(min), monthTicks(max) + 1));
  state.scheduleRng = random.state;
  return ticks;
}
export function newWorldProcesses(seed: number, tick: number, registry: Registry): WorldProcesses {
  return { version: 1, tasks: [...registry.worldProcesses.values()].map(definition => {
    const state: ProcessState = { id: definition.id, enabled: true, nextAt: null,
      scheduleRng: streamSeed(seed, definition.id + ':schedule'), workRng: streamSeed(seed, definition.id + ':work'), lastStep: null, pending: null,
      metrics: { runs: 0, completed: 0, cancelled: 0, processed: 0, lastDueAt: null, maxDelay: 0, totalDelay: 0 } };
    state.nextAt = tick + interval(definition, state);
    return state;
  }) };
}

/** Called by a policy owner: cancellation never rolls back completed work or removes its objects. */
export function setWorldProcessEnabled(world: World, id: string, enabled: boolean): boolean {
  const definition = world.registry.worldProcesses.get(id), state = world.processes.tasks.find(task => task.id === id);
  if (!definition || !state || typeof enabled !== 'boolean') return false;
  if (state.enabled === enabled) return true;
  state.enabled = enabled;
  if (state.pending) state.metrics.cancelled++;
  state.pending = null;
  state.nextAt = enabled ? world.tick + interval(definition, state) : null;
  return true;
}

/** Re-evaluate all dependencies together so enabling one law cannot bypass another prohibition. */
export function applyWorldProcessPolicy(world: World, allowsLaw: (id: string) => boolean, allowsAge: (id: string) => boolean): void {
  for (const definition of world.registry.worldProcesses.values()) {
    setWorldProcessEnabled(world, definition.id, definition.dependencies.laws.every(allowsLaw) && definition.dependencies.ages.every(allowsAge));
  }
}

/** One portion per task per saved tick; overdue runs coalesce instead of replaying history. */
export function runWorldProcesses(world: World, phase: ProcessPhase): void {
  if (world.paused) return;
  for (const definition of world.registry.worldProcesses.values()) {
    if (definition.phase !== phase) continue;
    const state = world.processes.tasks.find(task => task.id === definition.id)!;
    if (!state.enabled || state.lastStep === world.tick || !state.pending && world.tick < state.nextAt!) continue;
    state.lastStep = world.tick;
    const random = new Random(state.workRng);
    if (!state.pending) {
      const dueAt = state.nextAt!;
      // Schedule before executing any work. Missed intervals never produce extra runs.
      state.nextAt = world.tick + interval(definition, state);
      state.pending = { dueAt, startedAt: world.tick, items: definition.collect(world, random), cursor: 0 };
      state.metrics.runs++;
      state.metrics.lastDueAt = dueAt;
    }
    const pending = state.pending;
    const end = Math.min(pending.items.length, pending.cursor + definition.budget);
    const visit = () => {
      while (pending.cursor < end) {
        definition.visit(world, pending.items[pending.cursor], random);
        pending.cursor++; state.metrics.processed++;
      }
    };
    // Reconcile paths and building sites once per portion, not once per cell.
    if (definition.scope === 'biomes') world.terrain.edit(visit); else visit();
    state.workRng = random.state;
    if (pending.cursor === pending.items.length) {
      const delay = world.tick - pending.dueAt;
      state.metrics.completed++; state.metrics.maxDelay = Math.max(state.metrics.maxDelay, delay); state.metrics.totalDelay += delay;
      state.pending = null;
    }
  }
}

/** Reading diagnostics cannot advance a deadline, cursor or random stream. */
export function worldProcessMetrics(world: World) {
  return world.processes.tasks.map(state => ({ id: state.id, enabled: state.enabled, nextAt: state.nextAt,
    remaining: state.pending ? state.pending.items.length - state.pending.cursor : 0, ...state.metrics }));
}
