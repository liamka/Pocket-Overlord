import { traitDefinitions } from '../content/traits';
import { initializeUnit, isUnit, type UnitIdentity, type UnitMemory } from '../core/units';
import type { Entity, WorldSnapshot } from '../core/types';
import { bool, integer, record, reference, type RecordValue } from '../core/validation';
import { residentName } from '../core/village-life';
import type { Registry } from '../content/registry';

const name = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && [...v].length > 0 && [...v].length <= 30 && !/[\u0000-\u001f\u007f]/u.test(v);
export const validUnitIdentity = (v: RecordValue): boolean => name(v.displayName) && (v.customName === null || name(v.customName))
  && bool(v.favorite) && (v.bornAt === null || integer(v.bornAt, -Number.MAX_SAFE_INTEGER))
  && reference(v.bestFriendId) && reference(v.lostPartnerId) && reference(v.lostFriendId)
  && (v.partnerId === undefined || reference(v.partnerId))
  && (v.previousBodyId === undefined || integer(v.previousBodyId, 1));

export function migrateUnits(save: RecordValue): RecordValue {
  const entities = save.entities as Entity[];
  if (!Array.isArray(entities) || !entities.every(e => record(e) && record(e.components))) return { ...save, version: 44 };
  const history: UnitMemory[] = [], byId = new Map(entities.map(e => [e.id, e]));
  for (const entity of entities) {
    initializeUnit(entity, Number(save.tick));
    const identity = entity.components.unit, citizen = entity.components.citizen;
    if (!identity || !citizen) continue;
    const friend = byId.get(citizen.integration?.friendId ?? -1);
    if (friend?.components.citizen && friend.id !== entity.id) identity.bestFriendId = friend.id;
    // Old saves retained parent IDs but no death date or personal name.
    for (const id of citizen.parents) if (!byId.has(id) && !history.some(m => m.id === id)) {
      const parent: UnitIdentity = { displayName: residentName(id), customName: null, favorite: false,
        bornAt: null, bestFriendId: null, lostPartnerId: null, lostFriendId: null };
      history.push({ id, typeId: 'core:person', identity: parent, parents: [], endedAt: null, died: true });
    }
  }
  return { ...save, unitHistory: history, version: 44 };
}

export function validUnitsSave(save: WorldSnapshot, registry: Registry): boolean {
  if (!Array.isArray(save.unitHistory)) return false;
  const living = new Map(save.entities.map(e => [e.id, e])), memories = new Map<number, UnitMemory>();
  for (const m of save.unitHistory) {
    if (!record(m) || !integer(m.id, 1, save.nextEntityId - 1) || living.has(m.id) || memories.has(m.id)
      || typeof m.typeId !== 'string' || !registry.entities.has(m.typeId) || !record(m.identity) || !validUnitIdentity(m.identity)
      || m.endedAt !== null && !integer(m.endedAt, 0, save.tick) || !bool(m.died)
      || !Array.isArray(m.parents) || m.parents.length > 2 || !m.parents.every(id => integer(id, 1) && id !== m.id)
      || m.identity.bornAt !== null && Number(m.identity.bornAt) > (m.endedAt ?? save.tick)) return false;
    if (m.traitIds !== undefined && (!Array.isArray(m.traitIds) || m.traitIds.length > 116 || new Set(m.traitIds).size !== m.traitIds.length
      || !m.traitIds.every(id => typeof id === 'string' && Object.hasOwn(traitDefinitions,id)))) return false;
    memories.set(m.id, m as unknown as UnitMemory);
  }
  const known = (id: number): boolean => !!living.get(id)?.components.person || !!living.get(id)?.components.animal || memories.has(id);
  for (const entity of save.entities) {
    const u = entity.components.unit;
    if (!isUnit(entity)) { if (u) return false; continue; }
    if (!u || !validUnitIdentity(u as unknown as RecordValue) || u.bornAt !== null && u.bornAt > save.tick) return false;
    if (!entity.components.person && !entity.components.animal && u.bornAt !== null) return false;
    if (u.bestFriendId !== null && (u.bestFriendId === entity.id || !living.get(u.bestFriendId)?.components.unit)) u.bestFriendId = null;
    for (const key of ['lostFriendId', 'lostPartnerId'] as const) if (u[key] !== null && !memories.has(u[key]!)) u[key] = null;
    const citizen = entity.components.citizen;
    if (citizen) citizen.parents = [...new Set(citizen.parents.filter(id => id < entity.id && known(id)))];
  }
  for (const m of memories.values()) {
    m.parents = [...new Set(m.parents.filter(id => id < m.id && known(id)))];
    for (const key of ['bestFriendId', 'lostFriendId', 'lostPartnerId'] as const) {
      if (m.identity[key] !== null && (m.identity[key] === m.id || !known(m.identity[key]!))) m.identity[key] = null;
    }
  }
  return true;
}
