import { CHROMOSOME_SIZES, GENE_DEFINITIONS, GENOME_VERSION } from '../content/genes';
import { legacyGenome, type Genetics } from '../core/genetics';
import { bool, integer, number, record, type RecordValue } from '../core/validation';

export function validGenetics(value: unknown): value is Genetics {
  if (!record(value) || value.version !== GENOME_VERSION || value.eventOrder !== 'birth-v1' || !integer(value.dnaSeed, 0, 0xffffffff)
    || !bool(value.gmo) || !record(value.generation) || !number(value.generation.largestChance, 0, 1)
    || !bool(value.generation.spaghetti) || !number(value.generation.spaghettiChance, 0, 1)
    || !Array.isArray(value.chromosomes) || !value.chromosomes.length || value.chromosomes.length > 25) return false;
  let count = 0;
  for (const c of value.chromosomes) {
    if (!record(c) || typeof c.size !== 'string' || !Object.hasOwn(CHROMOSOME_SIZES, c.size) || !Array.isArray(c.cells)) return false;
    const rule = CHROMOSOME_SIZES[c.size as keyof typeof CHROMOSOME_SIZES];
    if (c.cells.length !== rule.cells) return false;
    for (const cell of c.cells) if (!record(cell) || !['open', 'locked', 'amplifier'].includes(String(cell.kind))
      || (cell.kind === 'open' ? cell.gene !== null && (typeof cell.gene !== 'string' || !Object.hasOwn(GENE_DEFINITIONS, cell.gene)) : cell.gene !== null)) return false;
    const open = c.cells.filter(l => l.kind === 'open').length, amplifiers = c.cells.filter(l => l.kind === 'amplifier').length, locked = c.cells.length - open - amplifiers;
    if (open < rule.open[0] || open > rule.open[1] || amplifiers < rule.amplifiers[0] || amplifiers > rule.amplifiers[1] || locked < rule.locked[0] || locked > rule.locked[1]) return false;
    count += c.cells.length;
  }
  if (count > 300) return false;
  if (value.lineage !== undefined && (!record(value.lineage) || !integer(value.lineage.parentId, 1) || !integer(value.lineage.at)
    || value.lineage.reason !== 'birth-mutation' || !integer(value.lineage.geneChanges, 1, 30) || !integer(value.lineage.traitChanges, 0, 64))) return false;
  return value.lastEdit === undefined || record(value.lastEdit) && value.gmo === true && integer(value.lastEdit.at) && integer(value.lastEdit.affected, 1, 6000);
}
export function migrateGenetics(save: RecordValue): RecordValue {
  if (!record(save.subspecies) || !Array.isArray(save.subspecies.records) || typeof save.seed !== 'number') throw new Error('Invalid genetics migration');
  for (const shared of save.subspecies.records) {
    if (!record(shared)) throw new Error('Invalid genetic branch');
    shared.genetics = legacyGenome(save.seed);
  }
  return { ...save, version: 57 };
}
