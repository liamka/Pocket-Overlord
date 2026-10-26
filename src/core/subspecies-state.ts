import { PHYSIOLOGY_IDS, type PhysiologyId } from '../content/subspecies-traits';
import { physiologyDefaults, physiologyModifiers } from './physiology';
import { defaultReproduction, type ReproductionProfile } from './reproduction-state';
import type { Entity } from './types';
import type { SpeciesProfile } from './creatures';
import type { StatModifier } from './unit-stats';
import { calculateGenome, geneticSex, type Genetics } from './genetics';

/** Species definitions remain in the existing content registry. */
export type SpeciesDefinition = SpeciesProfile;
export const SUBSPECIES_RADIUS = 12;
/** Local additive genes preserve the existing race/body baseline at zero. */
export const GENE_KEYS = ['health', 'damage', 'speed', 'lifespan', 'stamina', 'mana', 'intelligence', 'warfare', 'recovery', 'metabolicRate'] as const;
export type Gene = typeof GENE_KEYS[number];
export type Genome = Record<Gene, number>;
export const SUBSPECIES_TRAITS = PHYSIOLOGY_IDS;
export type SubspeciesTrait = typeof SUBSPECIES_TRAITS[number];
export interface Subspecies {
  biomeOrigin?: number | null;
  phenotype?: import('./phenotypes').Phenotype;
  id: number; speciesId: string; reproduction?: ReproductionProfile; genome: Genome; genetics?: Genetics; traits: SubspeciesTrait[]; birthTraits: string[];
  origin: { kind: 'natural' | 'placed' | 'cloned' | 'born' | 'transformed' | 'legacy'; at: number; founderId: number };
  created: number; born: number; died: number; departed: number;
  revision: number; changedAt: number;
}
export interface SubspeciesMember { id: number; deviations: Partial<Genome> }
export interface SubspeciesState { nextId: number; records: Subspecies[] }
export const newSubspeciesState = (): SubspeciesState => ({ nextId: 1, records: [] });
export { defaultReproduction };
export const emptyGenome = (): Genome => Object.fromEntries(GENE_KEYS.map(k => [k, 0])) as Genome;
export const defaultSubspeciesTraits = physiologyDefaults;
export const hasSubspecies = (species: SpeciesDefinition | undefined): boolean => species?.runtime?.death === 'organic';

// Runtime references, never serialized copies. Every world owns its own shared records.
const bindings = new WeakMap<Entity, Subspecies>();
export function bindSubspecies(entity: Entity, subspecies: Subspecies): void { bindings.set(entity, subspecies); }
export const subspeciesOf = (entity: Entity | undefined): Subspecies | undefined => {
  if (!entity) return;
  const s = bindings.get(entity);
  return s?.id === entity.components.subspecies?.id ? s : undefined;
};
const modifierCache = new WeakMap<Entity, { shared: Subspecies | undefined; traits: PhysiologyId[] | undefined; personal: Partial<Genome> | undefined; genome: Genome | undefined; genetics: Genetics | undefined; sex: 'a' | 'b'; result: StatModifier[] }>();
export function genomeModifiers(entity: Entity): StatModifier[] {
  const shared = subspeciesOf(entity), personal = entity.components.subspecies?.deviations;
  const sex = geneticSex(entity), cached = modifierCache.get(entity);
  if (cached && cached.shared === shared && cached.traits === shared?.traits && cached.personal === personal && cached.genome === shared?.genome
    && cached.genetics === shared?.genetics && cached.sex === sex) return cached.result;
  const result: StatModifier[] = shared ? [
    ...physiologyModifiers(entity),
    { id: 'subspecies', origin: 'genome', flat: shared.genome, percent: {} },
    { id: 'individual', origin: 'genome', flat: personal ?? {}, percent: {} },
    ...(shared.genetics ? [{ id: 'chromosomes', origin: 'genome' as const, ...chromosomeModifier(shared.genetics, sex) }] : []),
  ] : [];
  modifierCache.set(entity, { shared, traits: shared?.traits, personal, genome: shared?.genome, genetics: shared?.genetics, sex, result });
  return result;
}
const chromosomeCache = new WeakMap<Genetics, { a: ReturnType<typeof calculateGenome>; b: ReturnType<typeof calculateGenome> }>();
/** Published chromosomes are immutable; edits publish a new genome, never mutate this cache's input. */
function chromosomeModifier(genome: Genetics, sex: 'a' | 'b'): Pick<StatModifier, 'flat' | 'percent'> {
  let cached = chromosomeCache.get(genome);
  if (!cached) { cached = { a: calculateGenome(genome, 'a'), b: calculateGenome(genome, 'b') }; chromosomeCache.set(genome, cached); }
  return { flat: cached[sex].flat, percent: cached[sex].percent };
}
