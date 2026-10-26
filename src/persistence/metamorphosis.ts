import { TRAIT_DEFINITIONS } from '../content/traits';
import type { Registry } from '../content/registry';
import { ENTITY_LIMIT, type WorldSnapshot } from '../core/types';
import { FORM_MARKS } from '../core/metamorphosis';
import { validDamageContext } from '../core/death';
import { bool, integer, record, type RecordValue } from '../core/validation';

export const validTransformationContext = (v: unknown): boolean => record(v)
  && ['enemy-killed', 'monolith', 'snow', 'appearance', 'subspecies'].includes(String(v.trigger))
  && (v.sourceId === undefined || integer(v.sourceId, 1)) && (v.age === undefined || v.age === 'chaos' || v.age === 'despair')
  && (v.cloudId === undefined || v.trigger === 'snow' && integer(v.cloudId, 1))
  && (v.disasters === undefined || bool(v.disasters)) && (v.death === undefined || validDamageContext(v.death, true));
export const validMetamorphosis = (v: RecordValue): boolean => Array.isArray(v.marks) && v.marks.length <= FORM_MARKS.length
  && new Set(v.marks).size === v.marks.length && v.marks.every(m => (FORM_MARKS as readonly unknown[]).includes(m))
  && (v.attemptedKills === undefined || record(v.attemptedKills) && integer(v.attemptedKills.at) && Array.isArray(v.attemptedKills.victims)
    && v.attemptedKills.victims.length <= ENTITY_LIMIT && new Set(v.attemptedKills.victims).size === v.attemptedKills.victims.length && v.attemptedKills.victims.every(id => integer(id, 1)))
  && Array.isArray(v.history) && v.history.length <= 16 && v.history.every(h => record(h) && integer(h.fromId, 1)
    && typeof h.fromType === 'string' && typeof h.toType === 'string' && typeof h.rule === 'string' && integer(h.at)
    && ['body', 'appearance', 'subspecies'].includes(String(h.change)) && Array.isArray(h.removed) && h.removed.length <= 20 + TRAIT_DEFINITIONS.length
    && h.removed.every(m => TRAIT_DEFINITIONS.some(t => t.label === m) || (FORM_MARKS as readonly unknown[]).includes(m) || ['Plague', 'Madness', 'Burning', 'Combat effects'].includes(String(m))));
export function validTransformationsSave(save: WorldSnapshot, registry: Registry): boolean {
  const living = new Map(save.entities.map(e => [e.id, e])), memories = new Map(save.unitHistory?.map(m => [m.id, m]));
  const known = (id: number): boolean => !!living.get(id)?.components.unit || memories.has(id);
  for (const entity of save.entities) {
    const state = entity.components.metamorphosis;
    if (state) {
      if (!entity.components.unit || !validMetamorphosis(state as unknown as RecordValue)) return false;
      if (state.attemptedKills && (state.attemptedKills.at > save.tick || state.attemptedKills.victims.some(id => id >= save.nextEntityId || !known(id)))) return false;
      let previous = -1;
      for (const h of state.history) {
        const rule = registry.transformations.get(h.rule);
        if (!rule || !known(h.fromId) || h.fromId > entity.id || h.at < previous || h.at > save.tick
          || !rule.sources.includes(h.fromType) || h.change !== rule.change
          || h.toType !== (rule.target === 'self' ? h.fromType : rule.target)) return false;
        previous = h.at;
      }
      if (state.history.length && state.history.at(-1)!.toType !== entity.typeId) return false;
    }
    const partnerId = entity.components.unit?.partnerId;
    if (partnerId != null && (partnerId === entity.id || living.get(partnerId)?.components.unit?.partnerId !== entity.id)) return false;
    const previousId = entity.components.unit?.previousBodyId;
    if (previousId !== undefined && (previousId >= entity.id || memories.get(previousId)?.continuedAs !== entity.id)) return false;
  }
  for (const m of memories.values()) {
    for (const key of ['continuedAs', 'echoId'] as const) if (m[key] !== undefined && (!integer(m[key], m.id + 1, save.nextEntityId - 1) || !known(m[key]!))) return false;
    if (m.continuedAs !== undefined && m.continuedAs === m.echoId) return false;
    if (m.continuedAs !== undefined && (living.get(m.continuedAs)?.components.unit ?? memories.get(m.continuedAs)?.identity)?.previousBodyId !== m.id) return false;
    if (m.identity.previousBodyId !== undefined && (m.identity.previousBodyId >= m.id || memories.get(m.identity.previousBodyId)?.continuedAs !== m.id)) return false;
    if (m.identity.partnerId != null && (m.identity.partnerId === m.id || !known(m.identity.partnerId))) return false;
  }
  return save.events.every(e => e.kind !== 'transform' || e.target < save.nextEntityId && (e.context.sourceId === undefined || e.context.sourceId < save.nextEntityId));
}
