import { describe, expect, it, vi } from 'vitest';
import { CHROMOSOME_SIZES, GENES, GENOME_GENERATION } from '../src/content/genes';
import { adjacentCells, calculateGenome, geneNodes, generateGenome, legacyGenome, mutateGenome, weightedMutationChoice } from '../src/core/genetics';
import { Random } from '../src/core/random';
import { validGenetics } from '../src/persistence/genetics';

describe('chromosome rules', () => {
  it('ignores empty and locked loci, diagonals and row wrapping', () => {
    const genome = legacyGenome(12345), cells = genome.chromosomes[0].cells;
    cells[5].gene = 'health-3'; cells[6].gene = 'mutagenic';
    expect(adjacentCells(5, 12)).toEqual([11, 4]);
    expect(calculateGenome(genome, 'a').flat.health).toBe(50);
    expect(calculateGenome(genome, 'a').states[0][5]).toBe('normal');
  });

  it('doubles compatible pairs but requires every occupied side to match', () => {
    const seed = Array.from({ length: 100 }, (_, i) => i).find(i => geneNodes(i, 'health-3')[1] === geneNodes(i, 'health-3')[3])!;
    const genome = legacyGenome(seed), cells = genome.chromosomes[0].cells;
    cells[0].gene = cells[1].gene = 'health-3';
    expect(calculateGenome(genome, 'a').flat.health).toBe(200);
    const mismatch = GENES.find(g => g.stat === 'damage' && geneNodes(seed, g.id)[0] !== geneNodes(seed, 'health-3')[2])!;
    cells[6].gene = mismatch.id;
    expect(calculateGenome(genome, 'a').states[0][0]).toBe('normal');
  });

  it('lets harmful override gold, including harm through an amplifier', () => {
    const genome = legacyGenome(1), cells = genome.chromosomes[0].cells;
    cells[2].gene = 'health-3'; // amplifier is directly below at 8
    expect(calculateGenome(genome, 'a').flat.health).toBe(100);
    cells[7].gene = 'harmful'; // diagonal to health, adjacent to the amplifier
    expect(calculateGenome(genome, 'a').flat.health).toBe(25);
    expect(calculateGenome(genome, 'a').states[0][8]).toBe('harmful');
  });

  it('copies effective neighbors only for the selected sex without changing the shared graph', () => {
    const genome = legacyGenome(1), cells = genome.chromosomes[0].cells;
    cells[0].gene = 'health-3'; cells[1].gene = 'male';
    const before = structuredClone(genome);
    expect(calculateGenome(genome, 'a').flat.health).toBe(50);
    expect(calculateGenome(genome, 'b').flat.health).toBe(200);
    cells[1].gene = 'female';
    expect(calculateGenome(genome, 'a').flat.health).toBe(200);
    expect(calculateGenome(genome, 'b').flat.health).toBe(50);
    cells[1].gene = 'male'; expect(genome).toEqual(before);
  });

  it('replays generation and respects every chromosome size and occupancy range', () => {
    for (const size of Object.keys(CHROMOSOME_SIZES) as (keyof typeof CHROMOSOME_SIZES)[]) for (let seed = 1; seed <= 24; seed++) {
      const a = new Random(seed), b = new Random(seed);
      const first = generateGenome(a, seed, size), second = generateGenome(b, seed, size);
      expect(first).toEqual(second); expect(a.state).toBe(b.state);
      expect(first.chromosomes[0].cells).toHaveLength(CHROMOSOME_SIZES[size].cells);
      expect(validGenetics(first)).toBe(true);
    }
  });

  it('keeps largest-gene choice configurable and spaghetti explicit', () => {
    const first = (largestChance: number, spaghetti = false) => {
      const random = new Random(1); vi.spyOn(random, 'next').mockReturnValue(0);
      return generateGenome(random, 1, 'tiny', { health: 100 }, { ...GENOME_GENERATION, largestChance, spaghetti, spaghettiChance: 1 });
    };
    expect(first(1).chromosomes[0].cells.find(l => l.kind === 'open')!.gene).toBe('health-4');
    expect(first(0).chromosomes[0].cells.find(l => l.kind === 'open')!.gene).toBe('health-1');
    expect(first(1, true).chromosomes[0].cells.filter(l => l.kind === 'open').every(l => l.gene === 'health-1')).toBe(true);
    expect(GENOME_GENERATION).toEqual({ largestChance: 0.8, spaghetti: false, spaghettiChance: 0.777 });
  });

  it('uses relative rarity weights and does not spend randomness on an empty pool', () => {
    const rng = new Random(1), next = vi.spyOn(rng, 'next'), pool = [0, 1, 2, 3].map(rarity => ({ value: rarity, rarity }));
    for (const [roll, value] of [[0.499, 0], [0.5, 1], [0.8, 2], [0.95, 3]]) {
      next.mockReturnValueOnce(roll); expect(weightedMutationChoice(rng, pool)).toBe(value);
    }
    next.mockClear(); expect(weightedMutationChoice(rng, [])).toBeUndefined(); expect(next).not.toHaveBeenCalled();
  });

  it('mutates distinct open loci on a copy, keeping the parent and fixed topology intact', () => {
    const parent = generateGenome(new Random(9), 12345), before = structuredClone(parent);
    const a = new Random(17), b = new Random(17), mutation = mutateGenome(parent, a, 20);
    expect(mutateGenome(parent, b, 20)).toEqual(mutation); expect(a.state).toBe(b.state);
    expect(parent).toEqual(before); expect(validGenetics(mutation.genome)).toBe(true);
    let changes = 0;
    mutation.genome.chromosomes.forEach((c, i) => c.cells.forEach((l, j) => {
      const old = parent.chromosomes[i].cells[j]; expect(l.kind).toBe(old.kind);
      if (l.gene !== old.gene) { expect(l.kind).toBe('open'); changes++; }
    }));
    expect(changes).toBe(mutation.changes); expect(changes).toBeGreaterThanOrEqual(2);
  });
});
