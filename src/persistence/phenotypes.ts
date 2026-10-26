import { PHENOTYPE_PALETTES } from '../content/phenotypes';
import { NATURAL_BIOMES } from '../core/natural-biomes';
import { isLegacyPalette, legacyPaletteId, permittedPalettes, supportsPhenotype, PHENOTYPE_SPECIES } from '../core/phenotypes';
import { integer, record, type RecordValue } from '../core/validation';
import type { SpeciesProfile } from '../core/creatures';

export function validPhenotype(value: unknown, species: SpeciesProfile, tick: number): boolean {
  if (!supportsPhenotype(species.id)) return value === undefined;
  return record(value) && typeof value.paletteId === 'string'
    && (isLegacyPalette(species.id, value.paletteId) || permittedPalettes(species).includes(value.paletteId))
    && ['birth', 'edited', 'legacy', 'fallback'].includes(String(value.origin)) && integer(value.changedAt, 0, tick)
    && (value.biome === null || integer(value.biome, 0, NATURAL_BIOMES.length - 1));
}
/** Version 57 used fixed species body colors. Clothing variants and sickness remain separate. No RNG. */
export function migratePhenotypes(save: RecordValue): RecordValue {
  if (record(save.subspecies) && Array.isArray(save.subspecies.records)) for (const s of save.subspecies.records) {
    if (record(s) && typeof s.speciesId === 'string' && supportsPhenotype(s.speciesId)) {
      s.phenotype = { paletteId: legacyPaletteId(s.speciesId), origin: 'legacy', biome: null, changedAt: save.tick };
    }
  }
  return { ...save, version: 58 };
}
/** Unknown future IDs use the exact former body colors. Malformed fields and known wrong-species IDs still fail validation. */
export function normalizeUnknownPhenotypes(save: RecordValue): void {
  if (!record(save.subspecies) || !Array.isArray(save.subspecies.records)) return;
  for (const s of save.subspecies.records) {
    if (!record(s) || typeof s.speciesId !== 'string' || !supportsPhenotype(s.speciesId) || !record(s.phenotype)) continue;
    const p = s.phenotype;
    if (typeof p.paletteId === 'string' && p.paletteId.length > 0 && p.paletteId.length <= 100
      && ['birth', 'edited', 'legacy', 'fallback'].includes(String(p.origin))
      && !PHENOTYPE_SPECIES.some(id => legacyPaletteId(id) === p.paletteId) && !PHENOTYPE_PALETTES.some(known => known.id === p.paletteId)) {
      p.paletteId = legacyPaletteId(s.speciesId); p.origin = 'fallback';
    }
  }
}
