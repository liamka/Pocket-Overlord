import type { Registry } from '../content/registry';
import { newWorldProcesses } from '../core/world-processes';
import { record, type RecordValue } from '../core/validation';

/** No RNG draw, adaptation grant, recoloring or mineral regeneration on migration. */
export function migrateBiomeEcology(save: RecordValue, registry: Registry): RecordValue {
  if (!record(save.processes) || !Array.isArray(save.processes.tasks)) throw new Error('Invalid saved world processes');
  const current = newWorldProcesses(Number(save.seed), Number(save.tick), registry).tasks;
  const existing = new Set(save.processes.tasks.filter(record).map(task => task.id));
  save.processes.tasks.push(...current.filter(task => !existing.has(task.id)));
  if (Array.isArray(save.entities)) for (const e of save.entities) if (record(e) && record(e.components) && record(e.components.traits)) e.components.traits.biomeOrigin = null;
  if (record(save.subspecies) && Array.isArray(save.subspecies.records)) for (const s of save.subspecies.records) if (record(s)) s.biomeOrigin = null;
  return { ...save, version: 66 };
}
