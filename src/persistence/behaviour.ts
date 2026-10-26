import type { Registry } from '../content/registry';
import type { WorldSnapshot } from '../core/types';
import { integer, number, record, reference } from '../core/validation';
import { TASK_REASONS } from '../core/behaviour';
import { storageOwner } from '../core/stockpiles';

export function validBehaviour(value: unknown): boolean {
  if (value === undefined) return true;
  return record(value) && typeof value.taskId === 'string' && value.taskId.length > 0 && value.taskId.length <= 100
    && typeof value.stageId === 'string' && value.stageId.length > 0 && value.stageId.length <= 100
    && reference(value.targetId) && reference(value.ownerId) && number(value.progress, 0, 1)
    && integer(value.startedAt) && integer(value.retryAt) && Number(value.retryAt) >= Number(value.startedAt)
    && ['active', 'suspended', 'completed', 'cancelled'].includes(String(value.status))
    && (value.reason === undefined || TASK_REASONS.some(reason => reason === value.reason))
    && (value.intent === undefined || ['idle', 'farm', 'eat', 'visit', 'socialize', 'fight', 'repair', 'build', 'migrate', 'work', 'deliver', 'tend', 'guard', 'equip'].includes(String(value.intent)))
    && (value.status === 'suspended' ? value.intent !== undefined && integer(value.suspendedAt, Number(value.startedAt)) : value.suspendedAt === undefined);
}

export function validBehaviourSave(save: WorldSnapshot, registry: Registry): boolean {
  const entities = new Map(save.entities.map(e => [e.id, e])), owners = new Set(save.society.villages.map(v => v.id));
  for (const entity of save.entities) {
    const c = entity.components.citizen, state = c?.behaviour;
    if (c?.familyActionAt !== undefined && c.familyActionAt > save.tick) return false;
    if (c?.reflectionAfter !== undefined && c.reflectionAfter > save.tick + 1800) return false;
    if (!state) continue;
    const definition = registry.tasks.get(state.taskId);
    if (!validBehaviour(state) || !definition?.stages.some(s => s.id === state.stageId) || state.startedAt > save.tick) return false;
    if (!definition.waitSeconds && state.retryAt > save.tick + (state.status === 'cancelled' ? 30 : 0)) return false;
    if (state.status === 'completed' || state.status === 'cancelled') { if (state.targetId !== null || state.ownerId !== null) return false; continue; }
    if (state.targetId !== null && (!entities.has(state.targetId) || state.status === 'active' && state.targetId !== c!.targetId)) return false;
    if (state.ownerId !== null && !owners.has(state.ownerId)) return false;
    const expected = state.taskId === 'gather' ? ['carry', 'unload'].includes(state.stageId) ? 'deliver' : 'work'
      : state.taskId === 'delivery' ? 'deliver' : state.taskId === 'construction' ? 'build' : state.taskId === 'eating' ? 'eat'
      : state.taskId === 'combat' ? 'fight' : state.taskId === 'migration' ? 'migrate' : state.taskId === 'home_rest' ? 'visit' : definition.waitSeconds ? 'idle' : undefined;
    if (expected && state.intent !== undefined && state.intent !== expected) return false;
    if (state.taskId === 'migration' && !save.society.migrations.some(group => group.members.includes(entity.id))) return false;
    if (state.status === 'suspended') {
      if (state.suspendedAt! > save.tick || definition.waitSeconds) return false;
      continue;
    }
    if (state.taskId === 'home_rest') {
      if (c!.task !== 'visit' || state.targetId !== entity.components.person?.homeId || state.ownerId !== c!.villageId
        || !entities.get(state.targetId ?? -1)?.components.dwelling || state.retryAt - state.startedAt < 90 || state.retryAt - state.startedAt > 180) return false;
      continue;
    }
    if (state.taskId === 'migration') {
      if (c!.task !== 'migrate' || state.targetId !== null || state.ownerId !== c!.villageId) return false;
      continue;
    }
    if (!definition.waitSeconds && state.taskId !== 'swim_to_island') {
      if (state.targetId === null) return false;
      const task = state.taskId === 'gather' ? ['carry', 'unload'].includes(state.stageId) ? 'deliver' : 'work'
        : state.taskId === 'delivery' ? 'deliver' : state.taskId === 'construction' ? 'build' : state.taskId === 'eating' ? 'eat' : state.taskId === 'combat' ? 'fight' : null;
      if (task && c!.task !== task) return false;
      if (task !== 'deliver' && state.ownerId !== c!.villageId || task === 'deliver' && c!.work?.cargo && state.ownerId !== c!.work.cargo.villageId) return false;
      const target = entities.get(state.targetId)!;
      if (task === 'deliver' && storageOwner(target) !== state.ownerId) return false;
      if (task === 'work' && (!c!.work || c!.work.orderId !== undefined || c!.work.cargo)) return false;
      if (task === 'build' && !target.components.building?.project) return false;
      if (task === 'eat' && target.components.dwelling?.villageId !== state.ownerId) return false;
    }
    if (state.taskId === 'swim_to_island' && (state.targetId !== null || state.ownerId !== null || !entity.components.motion || !entity.components.position)) return false;
    if (definition.waitSeconds && (state.targetId !== null || state.ownerId !== null || c!.task !== 'idle'
      || state.retryAt - state.startedAt < definition.waitSeconds[0] * 30 || state.retryAt - state.startedAt > definition.waitSeconds[1] * 30)) return false;
  }
  return true;
}
