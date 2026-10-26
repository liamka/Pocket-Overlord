import { NATURAL_BIOMES } from '../core/natural-biomes';
import { BIOME_CHANGE_BASE, decodeBiomeChange } from '../core/biome-spread';
import type { Registry } from '../content/registry';
import { monthTicks } from '../core/calendar';
import { ENTITY_LIMIT } from '../core/types';
import { integer, record } from '../core/validation';

/** Deleted targets may remain in a pending portion; duplicate cells and invalid cursors may not. */
export function validWorldProcesses(value: unknown, registry: Registry, tick: number, cells: number, nextEntityId: number): boolean {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.tasks) || value.tasks.length !== registry.worldProcesses.size) return false;
  const seen = new Set<string>();
  return value.tasks.every(state => {
    if (!record(state) || typeof state.id !== 'string' || seen.has(state.id)) return false;
    const definition = registry.worldProcesses.get(state.id);
    if (!definition) return false;
    seen.add(state.id);
    if (typeof state.enabled !== 'boolean' || !integer(state.scheduleRng, 0, 0xffffffff) || !integer(state.workRng, 0, 0xffffffff)
      || state.lastStep !== null && !integer(state.lastStep, 0, tick)
      || (state.enabled ? !integer(state.nextAt, 1, tick + monthTicks(definition.intervalMonths[1])) : state.nextAt !== null || state.pending !== null)) return false;
    const metrics = state.metrics;
    if (!record(metrics) || !['runs', 'completed', 'cancelled', 'processed', 'maxDelay', 'totalDelay'].every(key => integer(metrics[key]))
      || Number(metrics.maxDelay) > Number(metrics.totalDelay)
      || (metrics.runs === 0 ? metrics.lastDueAt !== null : !integer(metrics.lastDueAt, 0, tick))
      || metrics.runs !== Number(metrics.completed) + Number(metrics.cancelled) + (state.pending === null ? 0 : 1)) return false;
    if (state.pending === null) return true;
    const pending = state.pending;
    const maxItems = ['tiles', 'biomes'].includes(definition.scope) ? cells : ENTITY_LIMIT;
    if (!record(pending) || !integer(pending.dueAt, 0, tick) || !integer(pending.startedAt, pending.dueAt, tick)
      || !integer(state.lastStep, pending.startedAt, tick) || metrics.lastDueAt !== pending.dueAt
      || !Array.isArray(pending.items) || pending.items.length > maxItems
      || !integer(pending.cursor, 1, pending.items.length - 1) || Number(metrics.processed) < pending.cursor) return false;
    if (definition.scope === 'biomes') return pending.items.every(item => integer(item, 0, cells * BIOME_CHANGE_BASE ** 2 - 1)
      && decodeBiomeChange(item).before < NATURAL_BIOMES.length && decodeBiomeChange(item).after < NATURAL_BIOMES.length
      && decodeBiomeChange(item).before !== decodeBiomeChange(item).after)
      && new Set(pending.items.map(item => decodeBiomeChange(Number(item)).index)).size === pending.items.length;
    const min = definition.scope === 'tiles' ? 0 : 1, max = definition.scope === 'tiles' ? cells - 1 : nextEntityId - 1;
    return pending.items.every(item => integer(item, min, max))
      && (definition.scope === 'samples' || new Set(pending.items).size === pending.items.length);
  });
}
