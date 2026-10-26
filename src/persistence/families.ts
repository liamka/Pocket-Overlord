import { HERD, HERD_REASONS, collectivePolicy, compareElders, initializeKinship, newFamilies, parentsOf, type Family } from '../core/families';
import type { Entity, WorldSnapshot } from '../core/types';
import { integer, number, point, record, reference, type RecordValue } from '../core/validation';
import type { Registry } from '../content/registry';

export const validKinship = (v: RecordValue): boolean => reference(v.familyId) && reference(v.originFamilyId) && reference(v.previousFamilyId)
  && (v.herd === undefined || record(v.herd) && number(v.herd.checkIn, 0, HERD.check) && number(v.herd.moveIn, 0, HERD.move)
    && number(v.herd.followIn, 0, HERD.follow) && number(v.herd.leaveIn, 0, HERD.leave) && number(v.herd.joinIn, 0, HERD.join)
    && reference(v.herd.followId) && (HERD_REASONS as readonly unknown[]).includes(v.herd.reason));

export function migrateFamilies(save: RecordValue): RecordValue {
  // Old parent links remain authoritative. No speculative families, births or random draws on load.
  if (Array.isArray(save.entities)) for (const entity of save.entities) {
    if (record(entity) && record(entity.components)) initializeKinship(entity as unknown as Entity);
  }
  if (record(save.society) && Array.isArray(save.society.migrations)) for (const group of save.society.migrations) {
    if (record(group)) group.familyIds = [];
  }
  return { ...save, families: newFamilies(), version: 49 };
}

export function validFamiliesSave(save: WorldSnapshot, registry: Registry): boolean {
  const state = save.families;
  if (!record(state) || !integer(state.nextId, 1) || !Array.isArray(state.records)) return false;
  const living = new Map(save.entities.map(e => [e.id, e])), dead = new Map(save.unitHistory?.map(m => [m.id, m]) ?? []);
  const known = (id: number): boolean => !!living.get(id)?.components.kinship || dead.has(id);
  const families = new Map<number, Family>(), members = new Set<number>();
  for (const f of state.records) {
    if (!record(f) || !integer(f.id, 1, state.nextId - 1) || families.has(f.id)
      || !['normal', 'alpha', 'parentless'].includes(String(f.type)) || typeof f.speciesId !== 'string' || !registry.species.has(f.speciesId)
      || f.subspeciesId !== null || !integer(f.limit, 2, 300) || !integer(f.foundedAt, 0, save.tick)
      || f.dissolvedAt !== null && !integer(f.dissolvedAt, Number(f.foundedAt), save.tick)
      || !point(f.birthplace) || !record(f.birthplace) || Number(f.birthplace.x) >= save.terrain.width || Number(f.birthplace.y) >= save.terrain.height
      || f.settlementName !== null && (typeof f.settlementName !== 'string' || f.settlementName.length > 100)
      || !Array.isArray(f.founders) || f.founders.length > 2 || new Set(f.founders).size !== f.founders.length
      || !f.founders.every(id => integer(id, 1) && known(id)) || f.type === 'normal' && !f.founders.length || f.type === 'parentless' && f.founders.length !== 0
      || !Array.isArray(f.originFamilyIds) || f.originFamilyIds.length !== f.founders.length || !f.originFamilyIds.every(id => id === null || integer(id, 1, Number(f.id) - 1))
      || !Array.isArray(f.members) || f.members.length > Number(f.limit) || !reference(f.alphaId)
      || (f.dissolvedAt === null ? f.members.length < 1 : f.members.length !== 0 || f.alphaId !== null)
      || (f.type === 'alpha' && f.dissolvedAt === null ? f.alphaId === null || !f.members.includes(f.alphaId) : f.alphaId !== null)) return false;
    for (const id of f.members) {
      if (!integer(id, 1) || members.has(id)) return false;
      const e = living.get(id);
      if (e?.components.kinship?.familyId !== f.id || e.components.creature?.speciesId !== f.speciesId) return false;
      const policy = collectivePolicy(registry, e);
      if (!policy || f.type !== policy.reference.mode && f.type !== 'parentless') return false;
      if (f.type === 'normal' && !e.components.person || f.type === 'alpha' && !e.components.animal) return false;
      members.add(id);
    }
    if (f.type === 'alpha' && f.dissolvedAt === null) {
      const oldest = [...f.members].sort((a, b) => compareElders(living.get(a)!, living.get(b)!))[0];
      if (oldest !== f.alphaId) return false;
    }
    families.set(f.id, f as unknown as Family);
  }
  for (const f of families.values()) if (f.originFamilyIds.some(id => id !== null && !families.has(id))) return false;
  const validRefs = (k: unknown): boolean => record(k) && ['familyId', 'originFamilyId', 'previousFamilyId'].every(key => reference(k[key]) && (k[key] === null || families.has(Number(k[key]))));
  for (const e of save.entities) {
    const k = e.components.kinship;
    if (!e.components.person && !e.components.animal) { if (k) return false; continue; }
    if (!k || !validKinship(k as unknown as RecordValue) || !validRefs(k) || !!k.herd !== !!e.components.animal) return false;
    if (k.familyId !== null && !families.get(k.familyId)?.members.includes(e.id) || k.familyId === null && members.has(e.id)) return false;
    if (k.herd?.followId !== null && k.herd?.followId !== undefined) {
      const f = families.get(k.familyId ?? -1);
      if (!f || k.herd.followId === e.id || f.alphaId !== k.herd.followId || !living.has(k.herd.followId)) return false;
    }
    const parents = parentsOf(e);
    if (new Set(parents).size !== parents.length || parents.some(id => id >= e.id || !known(id))) return false;
    if (k.originFamilyId !== null) {
      const founders = families.get(k.originFamilyId)!.founders;
      if (parents.length !== founders.length || !parents.length || !parents.every(id => founders.includes(id))) return false;
    }
  }
  for (const m of dead.values()) if (m.kinship !== undefined) {
    if (!validRefs(m.kinship)) return false;
    if (m.kinship.originFamilyId !== null) {
      const founders = families.get(m.kinship.originFamilyId)!.founders;
      if (m.parents.length !== founders.length || !m.parents.length || !m.parents.every(id => founders.includes(id))) return false;
    }
  }
  for (const group of save.society.migrations) {
    // Departure records retain the same family identities even if a family later dissolves.
    if (!Array.isArray(group.familyIds) || new Set(group.familyIds).size !== group.familyIds.length
      || group.familyIds.some(id => !integer(id, 1) || !families.has(id))) return false;
  }
  return true;
}
