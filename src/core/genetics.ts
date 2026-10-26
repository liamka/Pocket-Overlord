import { BASIC_GENES, BIRTH_MUTATION, CHROMOSOME_SIZES, CHROMOSOME_WIDTH, GENE_DEFINITIONS, GENES, GENOME_GENERATION, GENOME_VERSION, MUTATION_WEIGHTS, type ChromosomeSize, type GeneDefinition } from '../content/genes';
import { Random } from './random';
import type { StatModifier } from './unit-stats';

export interface Locus { kind: 'open' | 'locked' | 'amplifier'; gene: string | null }
export interface Chromosome { size: ChromosomeSize; cells: Locus[] }
export interface Genetics {
  version: 1; dnaSeed: number; chromosomes: Chromosome[]; gmo: boolean;
  generation: { largestChance: number; spaghetti: boolean; spaghettiChance: number };
  eventOrder: 'birth-v1';
  lineage?: { parentId: number; at: number; reason: 'birth-mutation'; geneChanges: number; traitChanges: number };
  lastEdit?: { at: number; affected: number };
}
export type GeneticSex = 'a' | 'b';
export type GeneState = 'empty' | 'locked' | 'normal' | 'golden' | 'harmful';
export interface GeneticEffects {
  flat: StatModifier['flat']; percent: StatModifier['percent']; offspring: number; birthRate: number; mutation: number;
  states: GeneState[][];
}
export const geneticSex = (e: { components: { person?: { sex: 'a' | 'b' }; reproduction?: { sex?: 'a' | 'b' } } }): GeneticSex => e.components.person?.sex ?? e.components.reproduction?.sex ?? 'a';
export function adjacentCells(index: number, length: number): number[] {
  return [index >= CHROMOSOME_WIDTH ? index - CHROMOSOME_WIDTH : -1, index % CHROMOSOME_WIDTH < 5 ? index + 1 : -1,
    index + CHROMOSOME_WIDTH < length ? index + CHROMOSOME_WIDTH : -1, index % CHROMOSOME_WIDTH ? index - 1 : -1].filter(n => n >= 0 && n < length);
}
/** Local DNA is stateless and world-scoped. Opening a preview never consumes world RNG. */
export function geneNodes(dnaSeed: number, id: string): readonly number[] {
  let seed = dnaSeed >>> 0;
  for (const c of id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  const random = new Random(seed);
  return [0, 1, 2, 3].map(() => Math.floor(random.next() * 4)); // top, right, bottom, left
}
const enabledBonus = (id: string | null, sex: GeneticSex): boolean => id === (sex === 'a' ? 'female' : 'male');
const occupied = (cell: Locus): boolean => cell.kind === 'amplifier' || cell.kind === 'open' && cell.gene !== null;
export function calculateGenome(genome: Genetics, sex: GeneticSex): GeneticEffects {
  const result: GeneticEffects = { flat: {}, percent: {}, offspring: 0, birthRate: 0, mutation: 0, states: [] };
  const add = (gene: GeneDefinition, factor: number): void => {
    if (gene.stat) {
      const values = gene.percent ? result.percent : result.flat;
      values[gene.stat] = (values[gene.stat] ?? 0) + gene.amount * factor;
    } else if (gene.family === 'offspring') result.offspring += gene.amount * factor;
    else if (gene.family === 'birth-rate') result.birthRate += gene.amount * factor;
    else if (gene.family === 'mutagenic') result.mutation += gene.amount * factor;
  };
  for (const chromosome of genome.chromosomes) {
    const cells = chromosome.cells;
    const corrupted = (i: number): boolean => cells[i].gene === 'harmful' || cells[i].kind === 'amplifier'
      && adjacentCells(i, cells.length).some(j => cells[j].gene === 'harmful');
    const universal = (i: number): boolean => cells[i].kind === 'amplifier' || cells[i].gene === 'mutagenic' || enabledBonus(cells[i].gene, sex);
    const compatible = (i: number, j: number): boolean => {
      if (universal(i) || universal(j)) return true;
      const a = cells[i].gene!, b = cells[j].gene!;
      if (['male', 'female', 'harmful'].includes(a) || ['male', 'female', 'harmful'].includes(b)) return false;
      const direction = j === i - 6 ? 0 : j === i + 1 ? 1 : j === i + 6 ? 2 : 3;
      return geneNodes(genome.dnaSeed, a)[direction] === geneNodes(genome.dnaSeed, b)[(direction + 2) % 4];
    };
    const states = cells.map((cell, i): GeneState => {
      if (cell.kind === 'locked') return 'locked';
      if (!occupied(cell)) return 'empty';
      const neighbors = adjacentCells(i, cells.length).filter(j => occupied(cells[j]));
      if (corrupted(i) || neighbors.some(corrupted)) return 'harmful';
      return neighbors.length && neighbors.every(j => compatible(i, j)) ? 'golden' : 'normal';
    });
    result.states.push(states);
    const factor = (i: number): number => states[i] === 'harmful' ? 0.5 : states[i] === 'golden' ? 2 : 1;
    for (const [i, cell] of cells.entries()) {
      if (!cell.gene) continue;
      const gene = GENE_DEFINITIONS[cell.gene];
      if (enabledBonus(cell.gene, sex)) {
        // Copy effective numeric neighbors once; bonuses never recursively copy other bonuses.
        for (const j of adjacentCells(i, cells.length)) {
          const neighbor = cells[j].gene && GENE_DEFINITIONS[cells[j].gene!];
          if (neighbor && !['male', 'female', 'harmful'].includes(neighbor.family)) add(neighbor, factor(j) * (states[i] === 'harmful' ? 0.5 : 1));
        }
      } else if (gene) add(gene, factor(i));
    }
  }
  return result;
}
const integer = (rng: Random, min: number, max: number): number => min + Math.floor(rng.next() * (max - min + 1));
const pick = <T>(rng: Random, values: readonly T[]): T => values[Math.floor(rng.next() * values.length)];
export function weightedMutationChoice<T>(rng: Random, pool: readonly { value: T; rarity: number }[]): T | undefined {
  const valid = pool.filter(p => Number.isInteger(p.rarity) && p.rarity >= 0 && p.rarity < MUTATION_WEIGHTS.length);
  if (!valid.length) return;
  let roll = rng.next() * valid.reduce((n, p) => n + MUTATION_WEIGHTS[p.rarity], 0);
  for (const item of valid) { roll -= MUTATION_WEIGHTS[item.rarity]; if (roll < 0) return item.value; }
}
export function generateGenome(rng: Random, dnaSeed: number, size: ChromosomeSize = 'tiny', targets: Record<string, number> = { health: 10, stamina: 10, damage: 1 }, generation: Genetics['generation'] = GENOME_GENERATION): Genetics {
  const genome: Genetics = { version: GENOME_VERSION, dnaSeed: dnaSeed >>> 0, chromosomes: [], gmo: false, eventOrder: 'birth-v1', generation: { ...generation } };
  const remaining = { ...targets };
  const special = ['random-sex', 'mutagenic', 'harmful'];
  const pending = (family: string, amount: number): boolean => amount > 0 && (special.includes(family)
    || GENES.some(g => g.family === family && g.amount > 0 && g.amount <= amount));
  do {
    const rule = CHROMOSOME_SIZES[size], amplifiers = integer(rng, ...rule.amplifiers as [number, number]), locked = integer(rng, ...rule.locked as [number, number]);
    const cells: Locus[] = Array.from({ length: rule.cells }, (_, i) => ({ kind: i < amplifiers ? 'amplifier' : i < amplifiers + locked ? 'locked' : 'open', gene: null }));
    for (let i = cells.length - 1; i > 0; i--) { const j = integer(rng, 0, i); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    for (const cell of cells) if (cell.kind === 'open') {
      const family = Object.keys(remaining).find(k => pending(k, remaining[k]));
      if (family && special.includes(family)) {
        cell.gene = family === 'random-sex' ? rng.next() < 0.5 ? 'female' : 'male' : family;
        remaining[family]--;
      } else if (family) {
        const pool = GENES.filter(g => g.family === family && g.amount > 0 && g.amount <= remaining[family]);
        const selected = rng.next() < generation.largestChance ? pool.reduce((a, b) => a.amount > b.amount ? a : b) : pick(rng, pool);
        cell.gene = selected.id; remaining[family] -= selected.amount;
      } else cell.gene = pick(rng, BASIC_GENES);
      if (generation.spaghetti && rng.next() < generation.spaghettiChance) cell.gene = pick(rng, GENES.filter(g => g.rarity === 0)).id;
    }
    genome.chromosomes.push({ size, cells });
    size = pick(rng, Object.keys(CHROMOSOME_SIZES) as ChromosomeSize[]);
  } while (genome.chromosomes.reduce((n, c) => n + c.cells.length, 0) <= 270
    && Object.entries(remaining).some(([k, n]) => pending(k, n)));
  return genome;
}
/** A neutral, editable migration. Legacy additive genes remain in their existing owner. */
export function legacyGenome(seed: number): Genetics {
  return { version: GENOME_VERSION, dnaSeed: seed >>> 0, eventOrder: 'birth-v1', gmo: false, generation: { ...GENOME_GENERATION },
    chromosomes: [{ size: 'tiny', cells: Array.from({ length: 12 }, (_, i) => ({ kind: i < 8 ? 'open' : i === 8 ? 'amplifier' : 'locked', gene: null })) }] };
}
export function mutateGenome(parent: Genetics, rng: Random, mutation: number): { genome: Genetics; changes: number } {
  const genome = structuredClone(parent), loci = genome.chromosomes.flatMap(c => c.cells.filter(l => l.kind === 'open'));
  const y = integer(rng, 0, Math.max(0, Math.floor(mutation)) + 1) + 1;
  const count = Math.min(BIRTH_MUTATION.maximumChanges, y + 1, loci.length);
  for (let i = 0; i < count; i++) {
    const at = integer(rng, i, loci.length - 1); [loci[i], loci[at]] = [loci[at], loci[i]];
    loci[i].gene = weightedMutationChoice(rng, GENES.filter(g => g.id !== loci[i].gene).map(g => ({ value: g.id, rarity: g.rarity })))!;
  }
  delete genome.lastEdit;
  return { genome, changes: count };
}
