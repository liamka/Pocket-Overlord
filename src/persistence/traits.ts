import { NATURAL_BIOMES } from '../core/natural-biomes';
import { traitDefinitions } from '../content/traits';
import { TRAIT_SOURCES, traitCompatible } from '../core/traits';
import { bool, integer, record, type RecordValue } from '../core/validation';
import type { WorldSnapshot } from '../core/types';

export function validTraits(v: RecordValue): boolean {
  if (v.biomeOrigin !== undefined && v.biomeOrigin !== null && !integer(v.biomeOrigin, 0, NATURAL_BIOMES.length - 1)) return false;
  if (!Array.isArray(v.entries) || v.entries.length > Object.keys(traitDefinitions).length || !bool(v.born) || !bool(v.inherited) || !bool(v.grown)
    || !integer(v.kills,0,1e9) || !integer(v.nextEventId,1,Number.MAX_SAFE_INTEGER) || !integer(v.lastBirthday,0,1e8)) return false;
  const ids = new Set<string>();
  for (const t of v.entries) {
    if (!record(t) || typeof t.id !== 'string' || !Object.hasOwn(traitDefinitions,t.id) || ids.has(t.id)
      || !TRAIT_SOURCES.includes(t.source as typeof TRAIT_SOURCES[number]) || !integer(t.at)
      || t.subject !== undefined && (typeof t.subject !== 'string' || t.subject.length > 100 || /[\u0000-\u001f\u007f]/u.test(t.subject))) return false;
    const d = traitDefinitions[t.id];
    if (d.interval ? !integer(t.nextAt,t.at+d.interval) : t.nextAt !== undefined) return false;
    ids.add(t.id);
  }
  if ([...ids].some(id => traitDefinitions[id].conflicts.some(other => ids.has(other)))) return false;
  return v.lastTrigger === undefined || record(v.lastTrigger) && integer(v.lastTrigger.id,1,Number(v.nextEventId)-1)
    && typeof v.lastTrigger.trait === 'string' && Object.hasOwn(traitDefinitions,v.lastTrigger.trait) && integer(v.lastTrigger.at);
}
/** Optional component: old saves are adopted at insertion, without RNG or birth rewards. */
export function validTraitsSave(save: WorldSnapshot): boolean {
  return save.entities.every(e => {
    const s = e.components.traits;
    if (!s) return true;
    if (!e.components.unit || !e.components.health || !validTraits(s as unknown as RecordValue)) return false;
    if ((s.lastTrigger?.at ?? 0) > save.tick) return false;
    return s.entries.every(t => traitCompatible(e,traitDefinitions[t.id]) && t.at <= save.tick
      && (t.nextAt === undefined || t.nextAt <= save.tick + traitDefinitions[t.id].interval!));
  });
}
