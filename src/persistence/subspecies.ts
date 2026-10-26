import { validPhysiology } from '../content/subspecies-traits';
import { NATURAL_BIOMES } from '../core/natural-biomes';
import { validReproductionProfile } from './reproduction';
import { validGenetics } from './genetics';
import { validPhenotype } from './phenotypes';
import type { Registry } from '../content/registry';
import { traitDefinitions } from '../content/traits';
import { traitAvailable } from '../core/traits';
import { bindSubspecies, defaultSubspeciesTraits, emptyGenome, GENE_KEYS, hasSubspecies, newSubspeciesState,
  type SpeciesDefinition, type SubspeciesState } from '../core/subspecies-state';
import { integer, number, record, type RecordValue } from '../core/validation';
import type { Entity, WorldSnapshot } from '../core/types';

export function validGenes(value: unknown, complete = false): boolean {
  return record(value) && (!complete || Object.keys(value).length === GENE_KEYS.length)
    && Object.entries(value).every(([key, n]) => (GENE_KEYS as readonly string[]).includes(key) && number(n, -10000, 10000));
}
export function validSubspeciesMember(value: RecordValue): boolean {
  return Object.keys(value).length === 2 && integer(value.id, 1) && validGenes(value.deviations);
}
export function validSubspeciesTraits(value: unknown, species: SpeciesDefinition): boolean {
  return validPhysiology(value) && value.every(t => !['sapience', 'tools', 'governance'].includes(t)
    || species.runtime?.owner === 'people');
}
export function validBirthTraits(value: unknown, species: SpeciesDefinition): boolean {
  if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length) return false;
  return value.every(id => {
    const d = typeof id === 'string' && Object.hasOwn(traitDefinitions, id) ? traitDefinitions[id] : undefined;
    return d && traitAvailable(d) && d.scope !== 'special' && (d.scope !== 'person' || species.runtime?.owner === 'people')
      && !d.pending && d.randomBirth && d.birth > 0 && !d.conflicts.some(other => value.includes(other));
  });
}
/** One stable legacy group per species, without RNG, new bodies, refills or trait draws. */
export function migrateSubspecies(save: RecordValue, registry: Registry): RecordValue {
  if (!Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Invalid subspecies migration');
  const state = newSubspeciesState(), tick = save.tick;
  const entities = save.entities.filter((raw): raw is RecordValue => record(raw) && record(raw.components) && typeof raw.typeId === 'string')
    .map(raw => raw as unknown as Entity).sort((a, b) => a.id - b.id);
  const speciesIds = [...new Set(entities.map(e => registry.entities.get(e.typeId)?.speciesId).filter((id): id is string => !!id && hasSubspecies(registry.species.get(id))))].sort();
  for (const speciesId of speciesIds) {
    const members = entities.filter(e => registry.entities.get(e.typeId)?.speciesId === speciesId), id = state.nextId++;
    state.records.push({ id, speciesId, genome: emptyGenome(), traits: defaultSubspeciesTraits(registry.species.get(speciesId)!), birthTraits: [],
      origin: { kind: 'legacy', at: tick, founderId: members[0].id }, created: members.length, born: 0, died: 0, departed: 0, revision: 0, changedAt: tick });
    for (const e of members) e.components.subspecies = { id, deviations: {} };
  }
  return { ...save, version: 55, subspecies: state };
}
/** Validate before binding: malformed records must never enter stat/capability calculations. */
export function validSubspeciesSave(save: WorldSnapshot, registry: Registry): boolean {
  const state: unknown = save.subspecies;
  if (!record(state) || !integer(state.nextId, 1) || !Array.isArray(state.records) || state.records.length >= state.nextId) return false;
  const ids = new Set<number>();
  for (const s of state.records) {
    if (!record(s) || !integer(s.id, 1, state.nextId - 1) || ids.has(s.id) || typeof s.speciesId !== 'string') return false;
    const species = registry.species.get(s.speciesId);
    const genetics = s.genetics;
    if (s.biomeOrigin !== undefined && s.biomeOrigin !== null && !integer(s.biomeOrigin, 0, NATURAL_BIOMES.length - 1)) return false;
    if (!species || !hasSubspecies(species) || !validGenes(s.genome, true) || !validPhenotype(s.phenotype, species, save.tick)
      || (genetics === undefined ? species.parameters?.genomeBudget !== null : !validGenetics(genetics) || genetics.dnaSeed !== (save.seed >>> 0) || (genetics.lastEdit?.at ?? 0) > save.tick)
      || !validReproductionProfile(s.reproduction) || !validSubspeciesTraits(s.traits, species) || !validBirthTraits(s.birthTraits, species)
      || !record(s.origin) || !['natural', 'placed', 'cloned', 'born', 'transformed', 'legacy'].includes(String(s.origin.kind))
      || !integer(s.origin.at, 0, save.tick) || !integer(s.origin.founderId, 1, save.nextEntityId - 1)
      || !integer(s.created, 1) || !integer(s.born, 0, s.created) || !integer(s.died, 0, s.created) || !integer(s.departed, 0, s.created - Number(s.died))
      || !integer(s.revision) || !integer(s.changedAt, s.origin.at, save.tick)) return false;
    ids.add(s.id);
  }
  const typed = state as unknown as SubspeciesState, counts = new Map<number, number>();
  for (const s of typed.records) if (s.genetics?.lineage) {
    const line = s.genetics.lineage, parent = typed.records.find(p => p.id === line.parentId);
    if (!parent || parent.id >= s.id || parent.speciesId !== s.speciesId || line.at !== s.origin.at || s.origin.kind !== 'born') return false;
  }
  for (const e of save.entities) {
    if (!record(e) || !record(e.components) || typeof e.typeId !== 'string') return false;
    const speciesId = registry.entities.get(e.typeId)?.speciesId, member = e.components.subspecies;
    if (!hasSubspecies(registry.species.get(speciesId ?? ''))) { if (member !== undefined) return false; continue; }
    if (!record(member) || !validSubspeciesMember(member)) return false;
    const s = typed.records.find(s => s.id === member.id);
    if (!s || s.speciesId !== speciesId) return false;
    const citizen = e.components.citizen;
    if (!s.traits.includes('sapience') && citizen && (citizen.villageId !== null || e.components.person?.homeId !== null
      || citizen.jobAssignment || citizen.profession?.service && citizen.profession.service !== 'civilian'
      || citizen.profession?.office && citizen.profession.office !== 'resident' || citizen.task !== 'idle')) return false;
    counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  }
  if (typed.records.some(s => s.created - s.died - s.departed !== (counts.get(s.id) ?? 0))) return false;
  for (const e of save.entities) {
    const s = typed.records.find(s => s.id === e.components.subspecies?.id);
    if (s) bindSubspecies(e, s);
  }
  return true;
}
