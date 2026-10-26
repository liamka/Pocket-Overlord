/** WorldBox's game taxonomy, revision 22255; not a scientific classification. */
export const TAXONOMY_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Creature_Taxonomy_and_Collectives?oldid=22255';
export const TAXON_RANKS = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus', 'species'] as const;
export type TaxonRank = typeof TAXON_RANKS[number];
export interface Taxon { readonly id: string; readonly rank: TaxonRank; readonly label: string; readonly parentId: string | null }
// IDs are explicit and never derived from translated/display names.
export const TAXA: readonly Taxon[] = [
  { id: 'animalia', rank: 'kingdom', label: 'Animalia', parentId: null },
  { id: 'chordata', rank: 'phylum', label: 'Chordata', parentId: 'animalia' },
  { id: 'mammalia', rank: 'class', label: 'Mammalia', parentId: 'chordata' },
  { id: 'primates', rank: 'order', label: 'Primates', parentId: 'mammalia' },
  { id: 'hominidae', rank: 'family', label: 'Hominidae', parentId: 'primates' },
  { id: 'homo', rank: 'genus', label: 'Homo', parentId: 'hominidae' },
  { id: 'homo-sapiens', rank: 'species', label: 'Sapiens', parentId: 'homo' },
  { id: 'elvus', rank: 'genus', label: 'Elvus', parentId: 'hominidae' },
  { id: 'elvus-elegance', rank: 'species', label: 'Elegance', parentId: 'elvus' },
  { id: 'dworfus', rank: 'genus', label: 'Dworfus', parentId: 'hominidae' },
  { id: 'dworfus-fortis', rank: 'species', label: 'Fortis', parentId: 'dworfus' },
  { id: 'orcus', rank: 'genus', label: 'Orcus', parentId: 'hominidae' },
  { id: 'orcus-bellicus', rank: 'species', label: 'Bellicus', parentId: 'orcus' },
  { id: 'carnivora', rank: 'order', label: 'Carnivora', parentId: 'mammalia' },
  { id: 'canidae', rank: 'family', label: 'Canidae', parentId: 'carnivora' },
  { id: 'canis', rank: 'genus', label: 'Canis', parentId: 'canidae' },
  { id: 'canis-lupus', rank: 'species', label: 'Lupus', parentId: 'canis' },
  { id: 'artiodactyla', rank: 'order', label: 'Artiodactyla', parentId: 'mammalia' },
  { id: 'bovidae', rank: 'family', label: 'Bovidae', parentId: 'artiodactyla' },
  { id: 'ovis', rank: 'genus', label: 'Ovis', parentId: 'bovidae' },
  { id: 'ovis-aries', rank: 'species', label: 'Aries', parentId: 'ovis' },
];
export interface CollectiveProfile {
  readonly taxonId: string | null;
  readonly reference: { readonly name: string | null; readonly limit: number | null; readonly herd: boolean; readonly mode: 'normal' | 'alpha' | 'none' };
  /** Our founding limit. Existing collectives retain the limit saved at their founding. */
  readonly limit: number;
}
const profile = (taxonId: string, name: string, limit: number, herd = false): CollectiveProfile =>
  ({ taxonId, reference: { name, limit, herd, mode: herd ? 'alpha' : 'normal' }, limit });
const solitary: CollectiveProfile = { taxonId: null, reference: { name: null, limit: null, herd: false, mode: 'none' }, limit: 0 };
// Only the eleven supported forms. Prospective evolved forms grant no capabilities.
export const COLLECTIVE_PROFILES: Readonly<Record<string, CollectiveProfile>> = {
  human: profile('homo-sapiens', 'Family', 10), elf: profile('elvus-elegance', 'Quiver', 20),
  dwarf: profile('dworfus-fortis', 'Beard', 30), orc: profile('orcus-bellicus', 'Horde', 50),
  dog: profile('canis-lupus', 'Pack', 20, true), wolf: profile('canis-lupus', 'Pack', 20, true),
  sheep: profile('ovis-aries', 'Flock', 100, true), crabzilla: solitary, dragon: solitary, ufo: solitary, boat: solitary,
};
/** Missing ranks are allowed; a taxonomy label cannot become a family/member identifier. */
export function taxonomyPath(speciesId: string, taxa: readonly Taxon[] = TAXA): Taxon[] {
  const path: Taxon[] = [], visited = new Set<string>();
  let id = COLLECTIVE_PROFILES[speciesId]?.taxonId;
  while (id && !visited.has(id)) {
    visited.add(id);
    const taxon = taxa.find(t => t.id === id);
    if (!taxon) break;
    path.unshift(taxon); id = taxon.parentId;
  }
  return path;
}
