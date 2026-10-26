import type { StatId } from '../core/unit-stats';

export const GENOME_VERSION = 1;
export const CHROMOSOME_WIDTH = 6;
export const CHROMOSOME_SIZES = Object.freeze({
  big: Object.freeze({ cells: 30, open: [18, 25], amplifiers: [1, 4], locked: [4, 8] }),
  medium: Object.freeze({ cells: 24, open: [16, 20], amplifiers: [1, 3], locked: [3, 5] }),
  small: Object.freeze({ cells: 18, open: [11, 15], amplifiers: [1, 3], locked: [2, 4] }),
  tiny: Object.freeze({ cells: 12, open: [7, 11], amplifiers: [0, 2], locked: [1, 3] }),
});
export type ChromosomeSize = keyof typeof CHROMOSOME_SIZES;
for (const rule of Object.values(CHROMOSOME_SIZES)) for (const range of [rule.open, rule.amplifiers, rule.locked]) Object.freeze(range);
export const MUTATION_WEIGHTS = Object.freeze([10, 6, 3, 1]);
/** Reproduction wins the source discrepancy: genetics, shared traits, parental traits,
 * personal birth draw; 0–2 personal growth traits later, never another shared mutation. */
export const GENETIC_EVENT_ORDER = Object.freeze(['genome-branch', 'shared-birth-traits', 'parental-traits', 'personal-birth-traits', 'personal-growth-traits']);
export interface GeneDefinition {
  readonly id: string; readonly family: string; readonly level: number; readonly rarity: number;
  readonly stat?: StatId; readonly amount: number; readonly percent?: boolean;
}
const families: readonly [string, StatId | undefined, readonly number[]][] = [
  ['health', 'health', [1, 10, 50, 100, 300]], ['stamina', 'stamina', [10, 50, 100]],
  ['damage', 'damage', [1, 6, 10]], ['armor', 'armor', [1, 6, 10]], ['speed', 'speed', [1, 2, 5]],
  ['diplomacy', 'diplomacy', [1, 2, 3]], ['warfare', 'warfare', [1, 2, 3]],
  ['stewardship', 'stewardship', [1, 2, 3]], ['intelligence', 'intelligence', [1, 2, 3]],
  ['lifespan', 'lifespan', [5, 20, 50, 100]], ['offspring', undefined, [1, 3, 5, 10]],
];
export const GENES: readonly GeneDefinition[] = Object.freeze([
  ...families.flatMap(([family, stat, values]) => values.map((amount, index) => Object.freeze({
    id: `${family}-${index + 1}`, family, stat, amount, level: index + 1, rarity: Math.min(3, index),
  }))),
  ...([['birth-rate', undefined, 1], ['attack-speed', 'attackSpeed', 1], ['bigger', 'scale', 30], ['smaller', 'scale', -10],
    ['mutagenic', undefined, 1], ['harmful', undefined, 0], ['male', undefined, 0], ['female', undefined, 0]] as const)
    .map(([id, stat, amount]) => Object.freeze({ id, family: id, level: 1, rarity: 0, stat, amount, percent: stat === 'scale' })),
]);
export const GENE_DEFINITIONS: Readonly<Record<string, GeneDefinition>> = Object.freeze(Object.fromEntries(GENES.map(g => [g.id, g])));
export const BASIC_GENES = Object.freeze(['health-1', 'health-2', 'stamina-1', 'damage-1', 'armor-1', 'diplomacy-1', 'warfare-1', 'stewardship-1', 'intelligence-1', 'harmful']);
/** Pocket Overlord settings; these are not species genomes from plan 34. */
export const GENOME_GENERATION = Object.freeze({ largestChance: 0.8, spaghetti: false, spaghettiChance: 0.777 });
export const BIRTH_MUTATION = Object.freeze({ chancePerPoint: 0.05, maximumChance: 0.5, maximumChanges: 30 });
