import { canUseWorldEditors } from './world-rules';
import { calculateGenome, geneticSex, type Genetics } from './genetics';
import { bindSubspecies, subspeciesOf } from './subspecies-state';
import { calculateStats, reconcileStats } from './unit-stats';
import { validGenetics } from '../persistence/genetics';
import type { World } from './world';
import type { Entity } from './types';

export interface GenomeDraft { entityId: number; subspeciesId: number; revision: number; genome: Genetics }
export interface LocusAddress { chromosome: number; locus: number }
export function swapGenomeLoci(draft: GenomeDraft, from: LocusAddress, to: LocusAddress): boolean {
  const a = draft.genome.chromosomes[from.chromosome]?.cells[from.locus], b = draft.genome.chromosomes[to.chromosome]?.cells[to.locus];
  if (!a || !b || a.kind !== 'open' || b.kind !== 'open') return false;
  [a.gene, b.gene] = [b.gene, a.gene];
  return true;
}
export type EditResult = { ok: true; affected: number } | { ok: false; reason: 'Enable experimental mode in World laws to edit.' | 'Genome owner is gone' | 'Genome changed while editing' | 'Locked genome layout' | 'No gene changes' };
export function createGenomeDraft(world: World, entityId: number): GenomeDraft | undefined {
  const e = world.entities.get(entityId), s = subspeciesOf(e);
  return e && world.registry.species.get(s?.speciesId ?? '')?.runtime?.genomeEditor && (e.components.health?.current ?? 0) > 0 && s?.genetics
    ? { entityId, subspeciesId: s.id, revision: s.revision, genome: structuredClone(s.genetics) } : undefined;
}
export function draftProblem(world: World, draft: GenomeDraft): EditResult | undefined {
  if (!canUseWorldEditors(world)) return { ok: false, reason: 'Enable experimental mode in World laws to edit.' };
  const e = world.entities.get(draft.entityId), shared = subspeciesOf(e);
  if (!e || (e.components.health?.current ?? 0) <= 0 || !shared?.genetics || shared.id !== draft.subspeciesId
    || !world.registry.species.get(shared.speciesId)?.runtime?.genomeEditor) return { ok: false, reason: 'Genome owner is gone' };
  if (shared.revision !== draft.revision) return { ok: false, reason: 'Genome changed while editing' };
  const genome = draft.genome, original = shared.genetics;
  if (!validGenetics(genome) || genome.dnaSeed !== original.dnaSeed || genome.chromosomes.length !== original.chromosomes.length
    || genome.chromosomes.some((c, i) => c.size !== original.chromosomes[i].size || c.cells.some((l, j) => l.kind !== original.chromosomes[i].cells[j].kind))) return { ok: false, reason: 'Locked genome layout' };
}
/** One synchronous transaction; manual editing works on pause, simulation time does not advance. */
export function applyGenomeEdit(world: World, draft: GenomeDraft): EditResult {
  const problem = draftProblem(world, draft);
  if (problem) return problem;
  const s = subspeciesOf(world.entities.get(draft.entityId))!, original = s.genetics!;
  if (JSON.stringify(original.chromosomes) === JSON.stringify(draft.genome.chromosomes)) return { ok: false, reason: 'No gene changes' };
  const members = [...world.query('subspecies', 'health')].filter(e => e.components.subspecies!.id === s.id && e.components.health!.current > 0).sort((a, b) => a.id - b.id);
  s.genetics = { ...structuredClone(original), chromosomes: structuredClone(draft.genome.chromosomes), gmo: true, lastEdit: { at: world.tick, affected: members.length } };
  s.revision++; s.changedAt = world.tick;
  for (const e of members) reconcileStats(world, e);
  return { ok: true, affected: members.length };
}
/** Sex previews are disposable entities, bound only to a private copy of the shared profile. */
export function previewGenomeStats(world: World, entity: Entity, genome: Genetics, sex: 'a' | 'b') {
  const copy = structuredClone(entity), shared = subspeciesOf(entity)!;
  if (copy.components.person) copy.components.person.sex = sex;
  else if (copy.components.reproduction) copy.components.reproduction.sex = sex;
  bindSubspecies(copy, { ...shared, genetics: structuredClone(genome) });
  const worn = world.equipment.items.filter(i => i.location.kind === 'equipped' && i.location.entityId === entity.id);
  return { ...calculateStats(copy, worn).values, ...externalGenomeStats(genome, sex) };
}
function externalGenomeStats(genome: Genetics, sex: 'a' | 'b') {
  const values = calculateGenome(genome, sex);
  return { offspring: values.offspring, birthRate: values.birthRate, mutation: values.mutation };
}
const reproductionBonuses = new WeakMap<Genetics, Partial<Record<'a' | 'b', ReturnType<typeof externalGenomeStats>>>>();
export const reproductionGeneBonus = (entity: Entity): { offspring: number; birthRate: number; mutation: number } => {
  const genome = subspeciesOf(entity)?.genetics;
  if (!genome) return { offspring: 0, birthRate: 0, mutation: 0 };
  // Published chromosomes are immutable. Editors and mutations publish a new genome object.
  let cached = reproductionBonuses.get(genome);
  if (!cached) { cached = {}; reproductionBonuses.set(genome, cached); }
  const sex = geneticSex(entity);
  return { ...(cached[sex] ??= externalGenomeStats(genome, sex)) };
};
