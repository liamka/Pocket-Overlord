import { GENOME_BUDGET_KEYS, referenceGenomeBudget, speciesReference } from '../content/species-reference';
import { CHROMOSOME_SIZES } from '../content/genes';
import { DROP_RULES } from '../content/species-profiles';
import { Random } from './random';
import { initializeStats, STAT_RULES, unitStats, type StatId } from './unit-stats';
import { number, record } from './validation';
import { validBundle } from './resources';
import { initializeUnit, unitName } from './units';
import { subspeciesOf } from './subspecies-state';
import type { Entity } from './types';
import type { World } from './world';

export function validSpeciesParameters(value: unknown): boolean {
  if (!record(value) || value.roads !== undefined && typeof value.roads !== 'boolean' || value.balance !== 'compatibility-v1' || !record(value.baseStats)
    || !Object.entries(value.baseStats).every(([k, v]) => Object.hasOwn(STAT_RULES, k) && number(v, STAT_RULES[k as StatId].min, STAT_RULES[k as StatId].max)
      && (!STAT_RULES[k as StatId].integer || Number.isInteger(v)))) return false;
  if (value.genomeBudget === null ? value.firstChromosome !== null : !record(value.genomeBudget)
    || !Object.entries(value.genomeBudget).every(([k, v]) => (GENOME_BUDGET_KEYS as readonly string[]).includes(k) && (v === null || number(v, 0, 1e6)
      && (!['random-sex', 'mutagenic', 'harmful'].includes(k) || Number.isInteger(v))))
    || typeof value.firstChromosome !== 'string' || !Object.hasOwn(CHROMOSOME_SIZES, value.firstChromosome)) return false;
  if (value.drops === null) return true;
  const drops = value.drops;
  if (!record(drops) || !number(drops.baseMass, 0, 1e6) || !validBundle(drops.base, 30) || !record(drops.rules)) return false;
  const rules = drops.rules, thresholds = rules.massPerDrop;
  return rules.childMass === DROP_RULES.childMass && rules.maximum === DROP_RULES.maximum
    && rules.minimum === DROP_RULES.minimum && rules.rounding === DROP_RULES.rounding
    && rules.defaultMassPerDrop === DROP_RULES.defaultMassPerDrop && record(thresholds)
    && Object.keys(thresholds).length === Object.keys(DROP_RULES.massPerDrop).length
    && Object.entries(DROP_RULES.massPerDrop).every(([key, mass]) => thresholds[key] === mass);
}

/** Read-only export. A factory sample has private RNG and never enters the world or receives genes. */
export function speciesComparison(world: World, speciesId: string, individual?: Entity) {
  const species = world.registry.species.get(speciesId);
  if (!species) return;
  const reference = speciesReference(speciesId);
  const live = individual && world.entities.get(individual.id) === individual && individual.components.creature?.speciesId === speciesId ? individual : undefined;
  let sample = live;
  if (!sample && species.runtime) {
    const definition = [...world.registry.entities.values()].find(d => d.speciesId === speciesId);
    if (definition) {
      sample = { id: 0, typeId: definition.id, components: definition.create({ x: 16, y: 16 }, new Random(1)) };
      sample.components.creature = { speciesId, origin: 'legacy', since: null };
      initializeUnit(sample, 0); initializeStats(sample, 0);
    }
  }
  return structuredClone({ version: 1, species: { id: species.id, name: species.sourceName, supported: !!species.runtime },
    local: species.parameters ? { ...species.parameters, baseStats: sample?.components.stats?.base ?? species.parameters.baseStats,
      diet: species.runtime?.food ?? [], genomeEditor: species.runtime?.genomeEditor ?? false } : null,
    reference: reference ? { ...reference, effectiveBudget: referenceGenomeBudget(speciesId, species.form === 'ascended') } : null,
    individual: live?.components.stats ? { name: unitName(live), base: live.components.stats.base, stats: unitStats(world, live),
      legacyGenes: species.parameters?.genomeBudget === null && !!subspeciesOf(live)?.genetics } : null });
}
