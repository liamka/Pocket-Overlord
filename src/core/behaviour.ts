import type { Entity } from './types';
import type { World } from './world';
import { releaseTreeClaim } from './forestry';
import { releaseDepositClaim } from './deposits';
import { releaseReservation, storageOwner } from './stockpiles';
import { aboardFerry, cancelFerryBoarding } from './ferries';
import { releaseJob } from './jobs';
import { recordHappinessBatch } from './happiness';
import { removeStatus } from './status-effects';

export const TASK_REASONS = ['Action interrupted', 'Target is no longer available', 'No route to the target',
  'Settlement is no longer available', 'Responding to danger', 'Hungry', 'Action completed', 'Arrived at the new home'] as const;
export type TaskReason = typeof TASK_REASONS[number];
export type TaskIntent = NonNullable<Entity['components']['citizen']>['task'];

export interface BehaviourState {
  taskId: string;
  stageId: string;
  targetId: number | null;
  ownerId: number | null;
  /** Display progress; resources and work counters remain with their owning systems. */
  progress: number;
  startedAt: number;
  retryAt: number;
  status: 'active' | 'suspended' | 'completed' | 'cancelled';
  reason?: TaskReason;
  /** Selected intent; resources and their remaining work stay with the existing owner. */
  intent?: TaskIntent;
  suspendedAt?: number;
}
export interface TaskContext { world: World; entity: Entity; state: BehaviourState }
export interface TaskStage {
  id: string;
  label: string;
  canStart: (context: TaskContext) => boolean;
  canContinue: (context: TaskContext) => boolean;
  /** The owning system supplies its existing, synchronous transaction. */
  complete: (context: TaskContext, effect: () => boolean) => boolean;
  cancel: (context: TaskContext) => void;
}
export interface TaskDefinition { id: string; label: string; stages: readonly TaskStage[]; waitSeconds?: readonly [number, number]; priority?: number }

export const taskPriority = (world: World, id: string): number => world.registry.tasks.get(id)?.priority
  ?? (id === 'swim_to_island' ? 100 : id === 'eating' ? 60 : id === 'combat' ? 50 : id === 'migration' ? 40 : 20);
const interruptedBy = (entity: Entity): TaskReason | undefined => entity.components.citizen?.emergency || entity.components.thermal?.burning
  ? 'Responding to danger' : (entity.components.citizen?.hunger ?? 0) >= 70 ? 'Hungry' : undefined;

export function releaseBehaviourClaims({ world, entity }: TaskContext): void {
  if (entity.components.citizen?.jobAssignment?.targetId === entity.components.citizen?.behaviour?.targetId) releaseJob(entity);
  releaseTreeClaim(world, entity.id); releaseDepositClaim(world, entity.id);
  for (const village of world.society.villages) releaseReservation(village, entity.id);
  // A building's reservation belongs to the site, not to an individual builder.
  const work = entity.components.citizen?.work;
  if (work) delete work.reservation;
}

export function cancelBehaviour(world: World, entity: Entity, reason: BehaviourState['reason'] = 'Action interrupted', clearIntent = true): void {
  const c = entity.components.citizen, state = c?.behaviour;
  if (!c || !state || state.status !== 'active' && state.status !== 'suspended') return;
  if (state.taskId === 'wait5') removeStatus(world, entity, 'sleeping', 'removed');
  if (state.taskId === 'reflection') for (const id of ['laughing', 'crying', 'singing', 'tantrum'] as const) removeStatus(world, entity, id, 'removed');
  world.registry.tasks.get(state.taskId)?.stages.find(s => s.id === state.stageId)?.cancel({ world, entity, state });
  if (state.taskId === 'wait5' && c.neurons?.sleepingUntil === state.retryAt) delete c.neurons.sleepingUntil;
  state.status = 'cancelled'; state.reason = reason; state.targetId = state.ownerId = null;
  delete state.suspendedAt;
  state.retryAt = world.tick + (reason === 'No route to the target' ? 30 : 0);
  if (clearIntent) {
    cancelFerryBoarding(world, entity);
    c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null; c.reconsiderIn = 0;
    if (entity.components.person?.animation) entity.components.person.animation.work = 0;
  }
}

/** Keep physical cargo; release unspent claims so another worker can use them. */
export function suspendBehaviour(world: World, entity: Entity, reason: TaskReason, priority = 101): boolean {
  const c = entity.components.citizen, state = c?.behaviour;
  if (world.paused || !c || !state || state.status !== 'active' || priority <= taskPriority(world, state.taskId)) return false;
  if (world.registry.tasks.get(state.taskId)?.waitSeconds) { cancelBehaviour(world, entity, reason); return true; }
  state.intent = c.task; state.status = 'suspended'; state.suspendedAt = world.tick; state.reason = reason;
  releaseBehaviourClaims({ world, entity, state });
  cancelFerryBoarding(world, entity);
  if (c.task !== 'migrate') { c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null; }
  c.reconsiderIn = 0;
  if (entity.components.person?.animation) entity.components.person.animation.work = 0;
  return true;
}

export function resumeBehaviour(world: World, entity: Entity): boolean {
  const c = entity.components.citizen, state = c?.behaviour;
  if (world.paused || !c || !state || state.status !== 'suspended' || interruptedBy(entity) || aboardFerry(world, entity.id)) return false;
  if (state.reason === 'No route to the target' && c.reconsiderIn > 0) return false;
  if (state.targetId !== null && !world.entities.has(state.targetId)) { cancelBehaviour(world, entity, 'Target is no longer available'); return false; }
  if (state.ownerId !== null && !world.society.villages.some(v => v.id === state.ownerId)) { cancelBehaviour(world, entity, 'Settlement is no longer available'); return false; }
  const definition = world.registry.tasks.get(state.taskId);
  if (!definition || !state.intent || c.task !== 'idle' && c.task !== state.intent) return false;
  c.task = state.intent; c.targetId = state.targetId; c.path = []; c.reconsiderIn = 0;
  // Workers may have fled far from the target; they must approach it again.
  if (state.stageId !== 'carry' && state.stageId !== 'unload' && definition.stages.some(s => s.id === 'approach')) state.stageId = 'approach';
  else if (state.stageId === 'unload') state.stageId = 'carry';
  const elapsed = world.tick - state.suspendedAt!;
  state.startedAt += elapsed; state.retryAt += elapsed; state.status = 'active';
  delete state.suspendedAt; delete state.reason;
  if (!definition.stages.find(s => s.id === state.stageId)?.canContinue({ world, entity, state })) { cancelBehaviour(world, entity); return false; }
  return true;
}

/** Enter/revisit an owner-selected stage. Revisits never reset its clock. */
export function enterBehaviour(world: World, entity: Entity, taskId: string, stageId: string, progress = 0): boolean {
  if (world.paused || world.entities.get(entity.id) !== entity) return false;
  const c = entity.components.citizen, definition = world.registry.tasks.get(taskId), stage = definition?.stages.find(s => s.id === stageId);
  if (!c || !stage) return false;
  const targetId = taskId === 'swim_to_island' || definition?.waitSeconds && taskId !== 'home_rest' ? null : c.targetId;
  const destination = world.entities.get(targetId ?? -1);
  const ownerId = taskId === 'swim_to_island' || definition?.waitSeconds && taskId !== 'home_rest' ? null : c.task === 'deliver'
    ? c.work?.cargo?.villageId ?? (destination ? storageOwner(destination) : c.villageId) : c.villageId;
  const previous = c.behaviour;
  const same = previous?.taskId === taskId && previous.stageId === stageId && previous.targetId === targetId && previous.ownerId === ownerId;
  if (same && previous.status === 'completed' && definition?.waitSeconds) return false;
  if (previous?.status === 'cancelled' && previous.taskId === taskId && world.tick < previous.retryAt) return false;
  if (previous && (previous.status === 'active' || previous.status === 'suspended') && (previous.taskId !== taskId || previous.ownerId !== ownerId || previous.targetId !== targetId)) cancelBehaviour(world, entity, 'Action interrupted', false);
  const continuing = same && previous.status === 'active';
  const state: BehaviourState = continuing ? previous : { taskId, stageId, targetId, ownerId, progress: 0, startedAt: world.tick, retryAt: world.tick, status: 'active', intent: c.task };
  c.behaviour = state;
  if (!(continuing ? stage.canContinue : stage.canStart)({ world, entity, state })) {
    cancelBehaviour(world, entity, targetId !== null && !world.entities.has(targetId) ? 'Target is no longer available' : 'Action interrupted');
    return false;
  }
  state.progress = Math.max(0, Math.min(1, progress));
  return true;
}

/** Guard and commit exactly once; no snapshot can observe a half-applied transaction. */
export function completeBehaviour(world: World, entity: Entity, effect: () => boolean, repeat = false): boolean {
  const state = entity.components.citizen?.behaviour;
  if (world.paused || !state || state.status !== 'active' || world.tick < state.retryAt) return false;
  const stage = world.registry.tasks.get(state.taskId)?.stages.find(s => s.id === state.stageId);
  if (!stage?.canContinue({ world, entity, state })) { cancelBehaviour(world, entity, 'Target is no longer available'); return false; }
  // Exclude the actor from target-removal cancellation during extraction/clearing.
  state.status = 'completed';
  if (!stage.complete({ world, entity, state }, effect)) {
    state.status = 'active'; cancelBehaviour(world, entity); return false;
  }
  state.progress = 1; state.reason = 'Action completed';
  if (state.taskId === 'reflection' && ['crying', 'happy_laughing', 'singing', 'play_jump', 'play_spin', 'play_dance'].includes(state.stageId)) {
    recordHappinessBatch(world, entity, [{ type: state.stageId === 'crying' ? 'crying' : state.stageId === 'singing' ? 'singing' : 'laughter' }]);
  }
  const c = entity.components.citizen!;
  if (state.taskId === 'wait5' && c.neurons?.sleepingUntil === state.retryAt) {
    const home = world.entities.get(entity.components.person?.homeId ?? -1), p = entity.components.position, q = home?.components.position;
    const indoors = !!home?.components.dwelling && !home.components.building?.project && !home.components.thermal?.burning
      && !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) < 2.4;
    recordHappinessBatch(world, entity, indoors ? [{ type: 'rest' }] : [{ type: 'rest' }, { type: 'sleep-outside' }]);
    delete c.neurons.sleepingUntil;
  }
  if (repeat && entity.components.citizen?.behaviour === state && stage.canContinue({ world, entity, state })) {
    state.status = 'active'; state.startedAt = state.retryAt = world.tick; state.progress = 0; delete state.reason;
  } else if (entity.components.citizen?.behaviour === state) state.targetId = state.ownerId = null;
  return true;
}

/** Other owners (emergencies, ferries, migration) may interrupt an ordinary chain. */
export function reconcileBehaviour(world: World, entity: Entity): void {
  if (world.paused) return;
  const state = entity.components.citizen?.behaviour;
  if (!state || state.status !== 'active' && state.status !== 'suspended') return;
  if (state.ownerId !== null && !world.society.villages.some(v => v.id === state.ownerId)) {
    cancelBehaviour(world, entity, 'Settlement is no longer available'); return;
  }
  if (state.targetId !== null && !world.entities.has(state.targetId)) { cancelBehaviour(world, entity, 'Target is no longer available'); return; }
  if (state.status === 'suspended') { resumeBehaviour(world, entity); return; }
  const reason = interruptedBy(entity);
  if (reason && suspendBehaviour(world, entity, reason, reason === 'Hungry' ? 60 : 101)) return;
  const stage = world.registry.tasks.get(state.taskId)?.stages.find(s => s.id === state.stageId);
  if (!stage?.canContinue({ world, entity, state })) {
    const missing = state.targetId !== null && !world.entities.has(state.targetId);
    cancelBehaviour(world, entity, missing ? 'Target is no longer available' : 'Action interrupted', missing);
  }
}

export function removeBehaviourTarget(world: World, id: number): void {
  for (const entity of world.query('citizen')) {
    const state = entity.components.citizen!.behaviour;
    if (entity.id === id || state?.targetId === id) cancelBehaviour(world, entity, 'Target is no longer available');
  }
}

/** Explicit waits are available to decisions; no additional job/decision selector. */
export function beginWait(world: World, entity: Entity, id: string): boolean {
  const definition = world.registry.tasks.get(id), c = entity.components.citizen;
  if (!c || !definition?.waitSeconds || world.paused) return false;
  if (c.behaviour?.taskId === id) return c.behaviour.status === 'active';
  cancelBehaviour(world, entity);
  c.task = 'idle'; c.targetId = null; c.path = [];
  if (!enterBehaviour(world, entity, id, 'wait')) return false;
  const [min, max] = definition.waitSeconds;
  c.behaviour!.retryAt = world.tick + Math.round((min === max ? min : world.rng.range(min, max)) * 30);
  return true;
}

export function continueWait(world: World, entity: Entity): boolean {
  const state = entity.components.citizen?.behaviour;
  if (!state || state.status !== 'active' || !world.registry.tasks.get(state.taskId)?.waitSeconds) return false;
  if (world.paused) return true;
  if (interruptedBy(entity) || entity.components.citizen!.hunger >= 55) { cancelBehaviour(world, entity, interruptedBy(entity) ?? 'Hungry'); return false; }
  state.progress = Math.min(1, (world.tick - state.startedAt) / Math.max(1, state.retryAt - state.startedAt));
  if (world.tick < state.retryAt) return true;
  completeBehaviour(world, entity, () => true); return false;
}

/** Lifecycle operations use the same saved stage and the same owning-system transaction. */
export interface TaskLifecycle {
  start: typeof enterBehaviour;
  tick: typeof reconcileBehaviour;
  suspend: typeof suspendBehaviour;
  cancel: typeof cancelBehaviour;
  finish: typeof completeBehaviour;
}
export const taskLifecycle: TaskLifecycle = {
  start: enterBehaviour, tick: reconcileBehaviour, suspend: suspendBehaviour, cancel: cancelBehaviour, finish: completeBehaviour,
};
