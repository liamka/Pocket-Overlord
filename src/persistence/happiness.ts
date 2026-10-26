import type { Registry } from '../content/registry';
import { HAPPINESS_EVENTS, type HappinessEvent } from '../content/happiness';
import { HAPPINESS_HISTORY_LIMIT, initializeHappiness } from '../core/happiness';
import type { Entity, WorldSnapshot } from '../core/types';
import { bool, integer, number, record, type RecordValue } from '../core/validation';

const source = (v: unknown): boolean => record(v) && integer(v.id, 1) && typeof v.name === 'string'
  && v.name.length > 0 && v.name.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(v.name) && bool(v.localize);
export function validHappiness(v: RecordValue): boolean {
  if (!number(v.value, -100, 100) || !bool(v.starving) || !bool(v.grown) || v.home !== null && !source(v.home)
    || v.psychopath !== undefined && !bool(v.psychopath) || v.egg !== undefined && !bool(v.egg)
    || !Array.isArray(v.history) || v.history.length > HAPPINESS_HISTORY_LIMIT) return false;
  const keys = new Set<string>();
  let tick = 0;
  return v.history.every(m => {
    if (!record(m) || typeof m.type !== 'string' || !Object.hasOwn(HAPPINESS_EVENTS, m.type) || !integer(m.tick, tick)
      || !source(m.source) || !record(m.source)) return false;
    const definition = HAPPINESS_EVENTS[m.type as HappinessEvent], key = `${m.type}:${m.tick}:${m.source.id}`;
    if (definition.support !== 'adapted' || (m.type === 'meal' ? !number(m.change, -120, 1200) : m.change !== definition.delta) || keys.has(key)) return false;
    keys.add(key); tick = Number(m.tick); return true;
  });
}
export function migrateHappiness(save: RecordValue, registry: Registry): RecordValue {
  if (Array.isArray(save.entities)) for (const raw of save.entities) {
    if (!record(raw) || !record(raw.components)) continue;
    const entity = raw as unknown as Entity;
    initializeHappiness(registry, entity);
    const state = entity.components.happiness, homeId = entity.components.person?.homeId;
    // Baseline existing shelter and starvation. Never replay history or infer old rewards.
    if (state && homeId != null) state.home = { id: homeId, name: 'Home', localize: true };
  }
  return { ...save, version: 51 };
}
export function validHappinessSave(save: WorldSnapshot, registry: Registry): boolean {
  return save.entities.every(entity => {
    const conversation = entity.components.citizen?.conversation;
    if (conversation && (conversation.startedAt > save.tick || conversation.partnerId === entity.id
      || !save.entities.some(e => e.id === conversation.partnerId && e.components.citizen))) return false;
    const h = entity.components.happiness;
    const species = registry.species.get(entity.components.creature?.speciesId ?? registry.entities.get(entity.typeId)?.speciesId ?? '');
    if (!species?.runtime?.amygdala) return h === undefined;
    return !!h && validHappiness(h as unknown as RecordValue) && (h.home === null || h.home.id < save.nextEntityId)
      && h.history.every(m => m.tick <= save.tick && m.source.id < save.nextEntityId);
  });
}
