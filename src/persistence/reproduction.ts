import type { Registry } from '../content/registry';
import { defaultReproduction, initializeReproduction, REPRODUCTION_METHODS, REPRODUCTION_REASONS, type ReproductionProfile } from '../core/reproduction-state';
import { bool, integer, number, record, reference, type RecordValue } from '../core/validation';
import { ENTITY_LIMIT, POPULATION_LIMIT, type Entity, type WorldSnapshot } from '../core/types';

export function validReproductionProfile(v: unknown): v is ReproductionProfile {
  if (!record(v) || !Array.isArray(v.methods) || new Set(v.methods).size !== v.methods.length
    || v.methods.some(m => !REPRODUCTION_METHODS.includes(m)) || !['viviparity', 'oviparity', 'direct'].includes(String(v.form))
    || !number(v.baseMaturation, 0, 1000) || !number(v.maturation, 0, 1000) || !integer(v.birthRate, 0, 8)
    || !integer(v.offspringLimit, 0, 1000) || !['land', 'water'].includes(String(v.habitat))) return false;
  const autonomous = v.methods.filter(m => !['soulborne', 'metamorph'].includes(m));
  if (autonomous.some(m => ['budding', 'fission', 'vegetative', 'spore'].includes(m)) && (autonomous.length !== 1 || v.form !== 'direct')) return false;
  if (v.methods.includes('sexual') && v.methods.includes('hermaphroditic') || v.methods.includes('divine') && v.methods.includes('parthenogenesis')) return false;
  return !autonomous.some(m => ['sexual', 'hermaphroditic', 'parthenogenesis'].includes(m)) || v.form !== 'direct';
}
const parentIds = (v: unknown): v is number[] => Array.isArray(v) && v.length >= 1 && v.length <= 2
  && new Set(v).size === v.length && v.every(id => integer(id, 1));
export function validReproduction(v: RecordValue): boolean {
  if (v.sex !== undefined && !['a', 'b'].includes(String(v.sex)) || !integer(v.born) || !bool(v.divineUsed) || !record(v.cooldowns)
    || Object.entries(v.cooldowns).some(([m, t]) => !REPRODUCTION_METHODS.includes(m as typeof REPRODUCTION_METHODS[number]) || !integer(t))) return false;
  if (v.cloneOf !== undefined && !integer(v.cloneOf, 1)) return false;
  if (v.last !== undefined && (!record(v.last) || !REPRODUCTION_METHODS.includes(v.last.method as typeof REPRODUCTION_METHODS[number])
    || !integer(v.last.at) || !REPRODUCTION_REASONS.includes(v.last.reason as typeof REPRODUCTION_REASONS[number]))) return false;
  if (v.egg !== undefined && (!record(v.egg) || !parentIds(v.egg.parents) || !integer(v.egg.laidAt)
    || !integer(v.egg.hatchAt, Number(v.egg.laidAt) + 1) || v.pending !== undefined)) return false;
  if (v.pending === undefined) return true;
  const p = v.pending;
  return record(p) && REPRODUCTION_METHODS.includes(p.method as typeof REPRODUCTION_METHODS[number]) && p.method !== 'metamorph'
    && ['viviparity', 'oviparity', 'direct'].includes(String(p.form)) && parentIds(p.parents) && integer(p.startedAt)
    && integer(p.dueAt, Number(p.startedAt)) && typeof p.typeId === 'string' && integer(p.subspeciesId, 1)
    && reference(p.homeId) && bool(p.reserved) && ['land', 'water'].includes(String(p.habitat))
    && Array.isArray(p.children) && p.children.length >= 1 && p.children.length <= 9
    && p.children.every(c => record(c) && ['a', 'b'].includes(String(c.sex)) && (c.point === undefined ? p.method !== 'spore'
      : p.method === 'spore' && record(c.point) && number(c.point.x, -10, 10000) && number(c.point.y, -10, 10000)));
}
/** No RNG, rewards, food transfer or rerolled deadline when adopting a saved pregnancy. */
export function migrateReproduction(save: RecordValue, registry: Registry): RecordValue {
  if (!Array.isArray(save.entities) || !integer(save.tick) || !record(save.subspecies) || !Array.isArray(save.subspecies.records)) throw new Error('Invalid reproduction migration');
  const entities = save.entities as Entity[], history = (save.unitHistory ?? []) as NonNullable<WorldSnapshot['unitHistory']>;
  for (const s of save.subspecies.records) {
    if (!record(s) || typeof s.speciesId !== 'string') throw new Error('Invalid reproduction species');
    s.reproduction = defaultReproduction(registry.species.get(s.speciesId)?.runtime?.reproduction);
  }
  for (const e of entities) {
    initializeReproduction(e, save.tick);
    const r = e.components.reproduction;
    if (!r) continue;
    r.born = entities.filter(n => (n.components.citizen?.parents ?? n.components.animal?.parents ?? []).includes(e.id)).length
      + history.filter(n => n.parents.includes(e.id)).length;
    r.divineUsed = e.components.traits?.entries.some(t => t.id === 'miracle-bearer') ?? false;
    const pregnant = e.components.statuses?.active.find(s => s.id === 'pregnant'), c = e.components.citizen;
    if (pregnant && c?.fatherId && e.components.subspecies) r.pending = { method: 'sexual', form: 'viviparity',
      parents: [e.id, c.fatherId], startedAt: Math.max(0, pregnant.startedAt), dueAt: Math.max(0, pregnant.expiresAt ?? save.tick),
      typeId: e.typeId, subspeciesId: e.components.subspecies.id, homeId: e.components.person?.homeId ?? null,
      children: [{ sex: e.id % 2 ? 'a' : 'b' }], reserved: false, habitat: 'land' };
  }
  return { ...save, version: 56 };
}
export function validReproductionSave(save: WorldSnapshot, registry: Registry): boolean {
  const living = new Map(save.entities.map(e => [e.id, e])), history = new Set(save.unitHistory?.map(m => m.id));
  const known = (id: number): boolean => living.has(id) || history.has(id);
  let reserved = 0, people = 0;
  const parents = new Set<number>();
  for (const e of save.entities) {
    const r = e.components.reproduction;
    if (!e.components.person && !e.components.animal) { if (r) return false; continue; }
    if (!r || !validReproduction(r as unknown as RecordValue) || (e.components.person ? r.sex !== undefined : r.sex === undefined)
      || (r.last?.at ?? 0) > save.tick || r.cloneOf !== undefined && (r.cloneOf >= e.id || !known(r.cloneOf))) return false;
    if (e.components.creature?.origin === 'cloned' && r.cloneOf === undefined) return false;
    if (r.egg && (r.egg.laidAt > save.tick || r.egg.parents.some(id => !known(id) || id >= e.id)
      || !e.components.statuses?.active.some(s => s.id === 'egg' && s.expiresAt === r.egg!.hatchAt))) return false;
    const p = r.pending;
    const active = e.components.statuses?.active ?? [];
    if (active.some(s => s.id === 'egg' && !r.egg || s.id === 'budding' && p?.method !== 'budding'
      || s.id === 'taking-roots' && p?.method !== 'vegetative' || s.id === 'pregnant' && p?.form !== 'viviparity')) return false;
    if (!p) continue;
    if (p.startedAt > save.tick || p.typeId !== e.typeId || p.subspeciesId !== e.components.subspecies?.id || p.parents[0] !== e.id
      || p.parents.some(id => !known(id) || parents.has(id)) || p.homeId !== null && !living.get(p.homeId)?.components.dwelling
      || p.method === 'divine' && !r.divineUsed) return false;
    const profile = save.subspecies?.records.find(s => s.id === p.subspeciesId)?.reproduction;
    if (!profile?.methods.includes(p.method) || ['budding', 'fission', 'divine', 'vegetative', 'spore'].includes(p.method) && p.form !== 'direct'
      || ['sexual', 'hermaphroditic', 'parthenogenesis'].includes(p.method) && p.form !== profile.form
      || (['sexual', 'hermaphroditic'].includes(p.method) ? p.parents.length !== 2 : p.parents.length !== 1)) return false;
    if (p.parents.some(id => {
      const parent = living.get(id), memory = save.unitHistory?.find(m => m.id === id);
      return (parent?.components.creature?.speciesId ?? registry.entities.get(memory?.typeId ?? '')?.speciesId) !== e.components.creature?.speciesId;
    })) return false;
    const status = p.method === 'budding' ? 'budding' : p.method === 'vegetative' ? 'taking-roots' : p.form === 'viviparity' ? 'pregnant' : undefined;
    if (status && !e.components.statuses?.active.some(s => s.id === status && s.expiresAt === p.dueAt)) return false;
    for (const id of p.parents) parents.add(id);
    if (p.reserved) { reserved += p.children.length; if (e.components.person) people += p.children.length; }
  }
  return save.entities.length + reserved <= ENTITY_LIMIT && save.entities.filter(e => e.components.person).length + people <= POPULATION_LIMIT;
}
