import { canUseWorldEditors } from './world-rules';
import { FUR_SPECIES, SKIN_SPECIES, PHENOTYPE_PALETTES, PALETTE_ROLES, type ColorRoles } from '../content/phenotypes';
import { NaturalBiome } from './natural-biomes';
import { subspeciesOf } from './subspecies-state';
import type { SpeciesProfile } from './creatures';
import type { Entity } from './types';
import type { World } from './world';

export interface Phenotype { paletteId: string; origin: 'birth' | 'edited' | 'legacy' | 'fallback'; biome: number | null; changedAt: number }
// These seven bodies have independent skin/fur layers. Other species keep their own renderers.
export const PHENOTYPE_SPECIES = ['human', 'elf', 'orc', 'dwarf', 'sheep', 'dog', 'wolf'] as const;
export const supportsPhenotype = (speciesId: string): boolean => (PHENOTYPE_SPECIES as readonly string[]).includes(speciesId);
export const legacyPaletteId = (speciesId: string): string => `legacy-${speciesId}`;
/** Preserve exact old pixel colors, including the sheep's face and fleece; no recoloring of legacy sprites. */
export const isLegacyPalette = (speciesId: string, paletteId: string): boolean => paletteId === legacyPaletteId(speciesId);
// Explicit local correspondence. Enchanted is not assumed to mean the source's Celestial biome.
const sourceBiomes: Partial<Record<NaturalBiome, string>> = {
  [NaturalBiome.Savanna]: 'savanna', [NaturalBiome.Desert]: 'arcane-desert', [NaturalBiome.Jungle]: 'jungle',
  [NaturalBiome.Swamp]: 'swamp', [NaturalBiome.Permafrost]: 'permafrost', [NaturalBiome.Corrupted]: 'corrupted',
  [NaturalBiome.Infernal]: 'infernal', [NaturalBiome.Mushroom]: 'mushroom', [NaturalBiome.Crystal]: 'crystal',
  [NaturalBiome.Candy]: 'candy', [NaturalBiome.Lemon]: 'lemon',
};
/** Ascended animal bodies inherit the source animal's permissions, without creating those species. */
export function permittedPalettes(species: SpeciesProfile, biome?: number): string[] {
  const ids = species.form === 'ascended' && species.counterpart ? [species.id, species.counterpart] : [species.id];
  const subject = (s: string): boolean => ids.includes(s) || s === 'fur-animals' && ids.some(id => FUR_SPECIES.has(id)) || s === 'skin-animals' && ids.some(id => SKIN_SPECIES.has(id));
  const rows = PHENOTYPE_PALETTES.filter(p => p.permissions.some(r => subject(r.subject)));
  if (biome === undefined) return rows.map(p => p.id);
  const local = rows.filter(p => p.permissions.some(r => subject(r.subject) && r.biomes?.includes(sourceBiomes[biome as NaturalBiome] ?? '')));
  // Biome alternatives take precedence; otherwise use only the species' unconditioned palettes.
  return (local.length ? local : rows.filter(p => p.permissions.some(r => subject(r.subject) && !r.biomes))).map(p => p.id);
}
export function newPhenotype(world: World, species: SpeciesProfile, entity: Entity): Phenotype | undefined {
  if (!supportsPhenotype(species.id)) return;
  const point = entity.components.position!, biome = world.terrain.biomeAt(point.x, point.y).id;
  const choices = permittedPalettes(species, biome);
  return { paletteId: choices.length ? choices[Math.floor(world.rng.next() * choices.length)] : legacyPaletteId(species.id),
    origin: 'birth', biome, changedAt: world.tick };
}
export function phenotypeColors(entity: Entity): ColorRoles | undefined {
  const speciesId = entity.components.creature?.speciesId ?? '', paletteId = subspeciesOf(entity)?.phenotype?.paletteId;
  return supportsPhenotype(speciesId) && paletteId && Object.hasOwn(PALETTE_ROLES, paletteId) ? PALETTE_ROLES[paletteId] : undefined;
}
export interface PhenotypeDraft { entityId: number; subspeciesId: number; revision: number; paletteId: string }
export function createPhenotypeDraft(world: World, entityId: number): PhenotypeDraft | undefined {
  const entity = world.entities.get(entityId), shared = subspeciesOf(entity);
  if (!entity || !shared?.phenotype || !supportsPhenotype(shared.speciesId) || (entity.components.health?.current ?? 0) <= 0) return;
  return { entityId, subspeciesId: shared.id, revision: shared.revision, paletteId: shared.phenotype.paletteId };
}
export function phenotypeProblem(world: World, draft: PhenotypeDraft): string | undefined {
  if (!canUseWorldEditors(world)) return 'Enable experimental mode in World laws to edit.';
  const e = world.entities.get(draft.entityId), s = subspeciesOf(e);
  if (!e || (e.components.health?.current ?? 0) <= 0 || !s?.phenotype || s.id !== draft.subspeciesId || !supportsPhenotype(s.speciesId)) return 'The phenotype owner is no longer present.';
  if (s.revision !== draft.revision) return 'The subspecies changed. Reopen the appearance editor.';
  if (!isLegacyPalette(s.speciesId, draft.paletteId) && !permittedPalettes(world.registry.species.get(s.speciesId)!).includes(draft.paletteId)) return 'This palette is unknown or unavailable for this species.';
}
/** An explicit visual edit works on pause. It changes no genes, stats, clocks or RNG. */
export function applyPhenotype(world: World, draft: PhenotypeDraft): { ok: boolean; reason?: string; affected?: number } {
  const reason = phenotypeProblem(world, draft);
  if (reason) return { ok: false, reason };
  const shared = subspeciesOf(world.entities.get(draft.entityId))!;
  if (shared.phenotype!.paletteId === draft.paletteId) return { ok: false, reason: 'Choose a different palette.' };
  shared.phenotype = { ...shared.phenotype!, paletteId: draft.paletteId, origin: 'edited', changedAt: world.tick };
  shared.revision++; shared.changedAt = world.tick;
  return { ok: true, affected: shared.created - shared.died - shared.departed };
}
