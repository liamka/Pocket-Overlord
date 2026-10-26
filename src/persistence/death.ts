import { DEATH_CAUSES, DEATH_HISTORY_LIMIT, NOTABLE_DEATH_LIMIT, deathCause, type DeathRecord } from '../core/death';
import { bool, integer, number, record, reference } from '../core/validation';
import type { WorldSnapshot } from '../core/types';
import type { Registry } from '../content/registry';

const name = (v: unknown, max = 30): v is string => typeof v === 'string' && [...v].length > 0 && [...v].length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
export function validDeathsSave(save: WorldSnapshot, registry: Registry): boolean {
  const state = save.deaths;
  if (!record(state) || !integer(state.total) || !record(state.causes)
    || Object.keys(state.causes).length !== DEATH_CAUSES.length || !DEATH_CAUSES.every(c => integer(state.causes[c]))
    || DEATH_CAUSES.reduce((n, c) => n + state.causes[c], 0) !== state.total) return false;
  const living = new Set(save.entities.map(e => e.id));
  const actor = (v: unknown): boolean => record(v) && integer(v.id, 1, save.nextEntityId - 1) && name(v.name);
  const valid = (d: unknown): d is DeathRecord => record(d) && integer(d.victimId, 1, save.nextEntityId - 1) && !living.has(d.victimId)
    && typeof d.typeId === 'string' && registry.entities.has(d.typeId) && name(d.name) && deathCause(d.cause)
    && (d.initiator === null || actor(d.initiator)) && bool(d.player)
    && record(d.position) && number(d.position.x, 0, save.terrain.width) && number(d.position.y, 0, save.terrain.height)
    && integer(d.tick, 0, save.tick) && (d.villageId === null || integer(d.villageId, 1, save.society.nextVillageId - 1))
    && (d.villageName === null || d.villageId !== null && name(d.villageName, 80)) && reference(d.homeId) && reference(d.partnerId)
    && (d.homeId === null || Number(d.homeId) < save.nextEntityId) && (d.partnerId === null || Number(d.partnerId) < save.nextEntityId)
    && Array.isArray(d.wars) && d.wars.length <= 44850 && new Set(d.wars).size === d.wars.length && d.wars.every(id => integer(id, 1, save.society.nextWarId - 1))
    && bool(d.favorite) && bool(d.ruler) && (d.warrior === undefined || bool(d.warrior)) && (!d.ruler || d.villageId !== null)
    && (d.successor === null || d.ruler === true && actor(d.successor) && record(d.successor) && d.successor.id !== d.victimId)
    && (d.transformedInto === null || actor(d.transformedInto) && record(d.transformedInto) && d.transformedInto.id !== d.victimId
      && typeof d.transformedInto.typeId === 'string' && registry.entities.has(d.transformedInto.typeId));
  const records = new Map<number, DeathRecord>();
  for (const [list, limit, notable] of [[state.recent, DEATH_HISTORY_LIMIT, false], [state.notable, NOTABLE_DEATH_LIMIT, true]] as const) {
    if (!Array.isArray(list) || list.length > limit || list.length > state.total) return false;
    const ids = new Set<number>(); let previous = -1;
    for (const d of list) {
      if (!valid(d) || ids.has(d.victimId) || d.tick < previous || notable && !d.favorite && !d.ruler) return false;
      const existing = records.get(d.victimId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(d)) return false;
      records.set(d.victimId, d); ids.add(d.victimId); previous = d.tick;
    }
  }
  if (records.size > state.total || DEATH_CAUSES.some(c => [...records.values()].filter(d => d.cause === c).length > state.causes[c])) return false;
  for (const entity of save.entities) {
    const sourceId = entity.components.thermal?.ignition?.sourceId;
    if (sourceId !== undefined && sourceId >= save.nextEntityId) return false;
  }
  for (const event of save.events) if ('sourceId' in event && event.sourceId !== undefined && event.sourceId >= save.nextEntityId) return false;
  return true;
}
