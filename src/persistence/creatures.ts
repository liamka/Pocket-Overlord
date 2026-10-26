import type { Registry } from '../content/registry';
import { record, type RecordValue } from '../core/validation';

/** Identity only: no spawn, no RNG, no changes to active actions. */
export function migrateCreatures(save: RecordValue, registry: Registry): RecordValue {
  if (Array.isArray(save.entities)) for (const e of save.entities) {
    if (!record(e) || typeof e.typeId !== 'string' || !record(e.components)) continue;
    const speciesId = registry.entities.get(e.typeId)?.speciesId;
    if (speciesId && e.components.creature === undefined) e.components.creature = { speciesId, origin: 'legacy', since: null };
  }
  return { ...save, version: 45 };
}
