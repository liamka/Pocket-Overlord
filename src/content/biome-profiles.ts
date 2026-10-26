import type { TreeProfile } from '../core/forestry';
import type { ResourceId } from '../core/resources';

export const BIOME_ADAPTATIONS = ['desert-adaptation', 'corrupted-adaptation', 'infernal-adaptation', 'permafrost-adaptation', 'swamp-adaptation'] as const;
export type BiomeAdaptation = typeof BIOME_ADAPTATIONS[number];
export type BiomeMineral = 'stone' | 'commonMetal' | 'silver' | 'gems' | 'bone' | 'gold';
/** Pocket Overlord rates; these are not WorldBox constants. */
export const BIOME_BALANCE = { mineralArea: 480, crystalPlantArea: 2400, spreadMonths: 0.5, spreadBudget: 256,
  faunaMonths: 5, faunaSamples: 4, wildSpeciesLimit: 6 } as const;
export interface BiomeEcology {
  strength: number; generationWeight: number; referenceMaxRegion: number | null; income: number;
  flora: readonly { profile: TreeProfile; weight: number }[];
  minerals: Partial<Record<BiomeMineral, number>>;
  creatures: readonly string[]; sapients: readonly string[];
  adaptation: BiomeAdaptation | null;
  origin: { creature: readonly string[]; subspecies: readonly BiomeAdaptation[] };
  climate: 'temperate' | 'arid' | 'tropical' | 'wet' | 'frozen' | 'hot';
  entry: 'age' | null;
}
const peoples = ['human', 'elf', 'dwarf', 'orc'];
const profile = (generationWeight: number, flora: TreeProfile, minerals: BiomeEcology['minerals'], patch: Partial<BiomeEcology> = {}): BiomeEcology => ({
  strength: 6, generationWeight, referenceMaxRegion: null, income: 0, flora: [{ profile: flora, weight: 1 }], minerals,
  creatures: [], sapients: peoples, adaptation: null, origin: { creature: [], subspecies: [] }, climate: 'temperate', entry: null, ...patch,
});
// Category:Biomes, revision 22818. Only existing biome/species/resource/trait IDs.
// Flora is our existing harvest balance. Detailed species, special plants and mutations
// remain with their own plans; none is replaced with an unrelated runtime creature.
export const BIOME_ECOLOGY = {
  grassland: profile(8, 'tree', { stone: 4, commonMetal: 3 }, { strength: 5, creatures: ['sheep', 'wolf'] }),
  savanna: profile(5, 'tree', { stone: 5, commonMetal: 3 }, { climate: 'arid', origin: { creature: ['fast'], subspecies: [] } }),
  desert: profile(4, 'tree', { stone: 4, commonMetal: 3, silver: 1, gems: 1 }, { climate: 'arid', adaptation: 'desert-adaptation', origin: { creature: ['eagle-eyed'], subspecies: [] } }),
  jungle: profile(6, 'jungleTree', { commonMetal: 1, silver: 5, gems: 1 }, { climate: 'tropical', flora: [{ profile: 'palm', weight: 1 }, { profile: 'jungleTree', weight: 1 }], origin: { creature: ['tiny', 'poison-immunity'], subspecies: [] } }),
  swamp: profile(3, 'tree', { stone: 4, commonMetal: 3 }, { referenceMaxRegion: 300, climate: 'wet', adaptation: 'swamp-adaptation', sapients: ['elf', 'orc'], origin: { creature: ['regeneration'], subspecies: [] } }),
  permafrost: profile(3, 'pine', { stone: 4, commonMetal: 3 }, { climate: 'frozen', adaptation: 'permafrost-adaptation', creatures: ['wolf'], sapients: ['human'], origin: { creature: ['frost-proof'], subspecies: [] } }),
  enchanted: profile(3, 'tree', { commonMetal: 2, silver: 5, gems: 1 }, { income: 1, sapients: ['elf'], origin: { creature: ['attractive'], subspecies: [] } }),
  corrupted: profile(1, 'tree', { bone: 7 }, { referenceMaxRegion: 20, income: -1, adaptation: 'corrupted-adaptation', sapients: [], origin: { creature: ['weak'], subspecies: [] } }),
  infernal: profile(1, 'tree', { commonMetal: 3 }, { referenceMaxRegion: 20, climate: 'hot', adaptation: 'infernal-adaptation', sapients: [], origin: { creature: ['fire-blood', 'fire-proof'], subspecies: [] } }),
  mushroom: profile(1, 'mushroomTree', { stone: 5, commonMetal: 3, silver: 3, gems: 1 }, { referenceMaxRegion: 300, creatures: ['sheep'], sapients: [], origin: { creature: ['regeneration'], subspecies: [] } }),
  crystal: profile(2, 'crystalTree', {}, { income: 2, sapients: ['dwarf'], origin: { creature: ['strong'], subspecies: [] } }),
  candy: profile(1, 'candyTree', { stone: 4, commonMetal: 3 }, { referenceMaxRegion: 30, sapients: [], origin: { creature: ['gluttonous', 'fat'], subspecies: [] } }),
  lemon: profile(3, 'lemonTree', { stone: 5, commonMetal: 3 }, { sapients: [], origin: { creature: ['genius'], subspecies: [] } }),
  // Plan 43 supplies its tile identity; no new flora, tool or ordinary generation here.
  paradox: profile(0, 'tree', { stone: 4, commonMetal: 3 }, { strength: 5, flora: [], sapients: [], entry: 'age', origin: { creature: ['long-liver'], subspecies: [] } }),
} satisfies Record<string, BiomeEcology>;
export const BIOME_MINERAL_RESOURCES: readonly ResourceId[] = ['stone', 'commonMetal', 'silver', 'gems', 'bone', 'gold'];
