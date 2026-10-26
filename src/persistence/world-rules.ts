import { ARCHITECT_MOODS, WORLD_LAWS } from '../content/world-laws';
import { integer, record } from '../core/validation';
import type { WorldRules } from '../core/world-rules';

export function validWorldRules(value: unknown, tick: number): value is WorldRules {
  if (!record(value) || value.version !== 1 || !record(value.values) || Object.keys(value.values).length !== WORLD_LAWS.length
    || !WORLD_LAWS.every(d => typeof (value.values as Record<string, unknown>)[d.id] === 'boolean')
    || typeof value.forbiddenKnowledge !== 'boolean' || !integer(value.revision) || !integer(value.changedAt, 0, tick)
    || !record(value.architect) || typeof value.architect.name !== 'string' || value.architect.name.length > 60
    || /[\u0000-\u001f\u007f]/.test(value.architect.name) || value.architect.name.trim() !== value.architect.name
    || typeof value.architect.mood !== 'string' || !Object.hasOwn(ARCHITECT_MOODS, value.architect.mood)) return false;
  // Unsupported toggles cannot be smuggled in through a save file.
  return WORLD_LAWS.every(d => !d.unavailable || (value.values as Record<string, unknown>)[d.id] === d.default);
}
