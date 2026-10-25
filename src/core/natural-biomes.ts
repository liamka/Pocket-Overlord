import { noise } from './random';

// Living ground is independent of island shapes, roads and blast damage.
// Append new IDs so existing worlds keep their original biomes.
export enum NaturalBiome { Grassland, Savanna, Desert, Jungle, Swamp, Permafrost, Enchanted, Corrupted, Infernal, Mushroom, Crystal, Candy, Lemon }
export const NATURAL_BIOMES = [
  { id: NaturalBiome.Grassland, key: 'grassland', name: 'Grassland', label: 'Grassland seeds', hint: 'Plant meadows and broadleaf trees. Balanced soil for farming.', colors: ['#7b9d50', '#7d9f52', '#78994d', '#809f54'], detail: '#a0b66b', trees: 0.22, growth: 1, walking: 1 },
  { id: NaturalBiome.Savanna, key: 'savanna', name: 'Savanna', label: 'Savanna seeds', hint: 'Plant golden grass and acacias. Crops grow more slowly.', colors: ['#b4ac59', '#b8af5c', '#b1a654', '#bdb461'], detail: '#d8c878', trees: 0.12, growth: 0.75, walking: 1 },
  { id: NaturalBiome.Desert, key: 'desert', name: 'Desert', label: 'Desert seeds', hint: 'Spread desert sand and cacti. Poor soil and slower travel.', colors: ['#d9b976', '#dcbc7a', '#d5b471', '#e0c180'], detail: '#b8965f', trees: 0.055, growth: 0.35, walking: 0.8 },
  { id: NaturalBiome.Jungle, key: 'jungle', name: 'Jungle', label: 'Jungle seeds', hint: 'Grow lush jungle and palms. Rich soil helps crops grow faster.', colors: ['#4b8851', '#508d54', '#48834d', '#548e52'], detail: '#77ad69', trees: 0.38, growth: 1.25, walking: 0.9 },
  { id: NaturalBiome.Swamp, key: 'swamp', name: 'Swamp', label: 'Swamp seeds', hint: 'Grow wetlands and mangroves. Mud slows travel and crop growth.', colors: ['#69866c', '#6e8b70', '#658268', '#728e72'], detail: '#93aa7b', trees: 0.2, growth: 0.7, walking: 0.6 },
  { id: NaturalBiome.Permafrost, key: 'permafrost', name: 'Permafrost', label: 'Permafrost seeds', hint: 'Spread lasting snow and conifers. Cold soil slows crops and travel.', colors: ['#cededb', '#d4e3df', '#c7d8d6', '#dae7e2'], detail: '#a6c3c5', trees: 0.16, growth: 0.5, walking: 0.75 },
  { id: NaturalBiome.Enchanted, key: 'enchanted', name: 'Enchanted', label: 'Enchanted seeds', hint: 'Grow silver trees and luminous flowers. Fertile soil speeds crop growth.', colors: ['#64a6a0', '#69aba4', '#60a19b', '#70b0a8'], detail: '#afe4cb', trees: 0.25, growth: 1.3, walking: 1 },
  { id: NaturalBiome.Corrupted, key: 'corrupted', name: 'Corrupted', label: 'Corrupted seeds', hint: 'Spread violet soil and twisted dead trees. Crops and travelers struggle here.', colors: ['#6d587e', '#725d83', '#685379', '#786389'], detail: '#a18aa9', trees: 0.14, growth: 0.4, walking: 0.7 },
  { id: NaturalBiome.Infernal, key: 'infernal', name: 'Infernal', label: 'Infernal seeds', hint: 'Create ash fields and ember trees. Harsh ground slows crops and travel.', colors: ['#65444a', '#6b484b', '#604049', '#724e4e'], detail: '#d27550', trees: 0.1, growth: 0.25, walking: 0.75 },
  { id: NaturalBiome.Mushroom, key: 'mushroom', name: 'Mushroom', label: 'Mushroom spores', hint: 'Grow giant mushrooms and glowing spores. Rich soil feeds crops; dense growth slows travel.', colors: ['#8b769a', '#917ca0', '#857094', '#9782a5'], detail: '#c4b2d4', trees: 0.3, growth: 1.2, walking: 0.8 },
  { id: NaturalBiome.Crystal, key: 'crystal', name: 'Crystal', label: 'Crystal seeds', hint: 'Grow blue crystal spires on violet ground. Rocky soil slows crops and travel.', colors: ['#777aab', '#7d80b1', '#7275a5', '#8386b7'], detail: '#b6d6ec', trees: 0.18, growth: 0.65, walking: 0.85 },
  { id: NaturalBiome.Candy, key: 'candy', name: 'Candy', label: 'Candy seeds', hint: 'Plant candy trees on pink sugar fields. Crops thrive, but sticky ground slows travel.', colors: ['#c78ea6', '#cd94ac', '#c188a0', '#d39ab2'], detail: '#f5c8d7', trees: 0.23, growth: 1.1, walking: 0.9 },
  { id: NaturalBiome.Lemon, key: 'lemon', name: 'Lemon', label: 'Lemon seeds', hint: 'Grow golden lemon groves. Sunny soil helps crops grow faster.', colors: ['#bbb965', '#c1bf6b', '#b5b35f', '#c7c571'], detail: '#e9df95', trees: 0.27, growth: 1.15, walking: 1 },
] as const;

export const FANTASY_BIOMES = NATURAL_BIOMES.filter(biome => biome.id >= NaturalBiome.Enchanted);
export const SEED_BIOMES = NATURAL_BIOMES.filter(biome => biome.id !== NaturalBiome.Crystal && biome.id !== NaturalBiome.Candy);

export const biomeDefinition = (id: number) => NATURAL_BIOMES[id] ?? NATURAL_BIOMES[NaturalBiome.Grassland];

export interface BiomeSurface {
  kind: 'soil' | 'stone' | 'sand' | 'mud' | 'water' | 'ice';
  colors: readonly string[];
  detail: string;
}

// Surface 0 is the biome's usual cover; 1–3 are local terrain, never another biome.
export const BIOME_SURFACES: readonly (readonly BiomeSurface[])[] = [
  [
    { kind: 'soil', colors: ['#998564', '#9d8968', '#958160'], detail: '#b5a07c' },
    { kind: 'stone', colors: ['#899080', '#8e9585', '#858c7c'], detail: '#b0b5a2' },
    { kind: 'sand', colors: ['#bbb083', '#bfb488', '#b7ac7f'], detail: '#d1c79b' },
  ],
  [
    { kind: 'soil', colors: ['#ab885f', '#af8c63', '#a7845b'], detail: '#c5a379' },
    { kind: 'stone', colors: ['#9c967e', '#a09a83', '#989279'], detail: '#bbb29a' },
    { kind: 'sand', colors: ['#c9b477', '#cdb87c', '#c5b073'], detail: '#e0cc91' },
  ],
  [
    { kind: 'soil', colors: ['#bc9469', '#c0986d', '#b89065'], detail: '#977653' },
    { kind: 'stone', colors: ['#aaa08a', '#aea48e', '#a69c86'], detail: '#cec0a5' },
    { kind: 'sand', colors: ['#c8aa73', '#ccae77', '#c4a66f'], detail: '#e1c28b' },
  ],
  [
    { kind: 'soil', colors: ['#7d7353', '#817757', '#796f4f'], detail: '#a39469' },
    { kind: 'stone', colors: ['#78867a', '#7c8a7e', '#748276'], detail: '#a0afa0' },
    { kind: 'mud', colors: ['#6e7260', '#727664', '#6a6e5c'], detail: '#929681' },
  ],
  [
    { kind: 'soil', colors: ['#77715e', '#7b7562', '#736d5a'], detail: '#9a917a' },
    { kind: 'mud', colors: ['#66766b', '#6a7a6f', '#627267'], detail: '#89988a' },
    { kind: 'water', colors: ['#4d797b', '#517d7f', '#497577'], detail: '#7ba4a0' },
  ],
  [
    { kind: 'soil', colors: ['#92989b', '#969c9f', '#8e9497'], detail: '#bdc6c9' },
    { kind: 'stone', colors: ['#7e929d', '#8296a1', '#7a8e99'], detail: '#adbfc7' },
    { kind: 'ice', colors: ['#8ebdcc', '#93c1cf', '#89b8c7'], detail: '#c8e5e9' },
  ],
  [
    { kind: 'soil', colors: ['#858d8b', '#8b9391', '#7f8785'], detail: '#bbc5ba' },
    { kind: 'stone', colors: ['#899aa6', '#8fa0ac', '#8394a0'], detail: '#c7dbe0' },
    { kind: 'water', colors: ['#4f929a', '#5598a0', '#498c94'], detail: '#a4e0d5' },
  ],
  [
    { kind: 'soil', colors: ['#594f62', '#5f5568', '#53495c'], detail: '#8b7e96' },
    { kind: 'stone', colors: ['#777082', '#7d7688', '#716a7c'], detail: '#a6a0b0' },
    { kind: 'mud', colors: ['#514c5d', '#575263', '#4b4657'], detail: '#80728d' },
  ],
  [
    { kind: 'soil', colors: ['#877a77', '#8d807d', '#817471'], detail: '#b1a09a' },
    { kind: 'stone', colors: ['#493f49', '#4f454f', '#433943'], detail: '#84646a' },
    { kind: 'sand', colors: ['#a16e56', '#a7745c', '#9b6850'], detail: '#d39c70' },
  ],
  [
    { kind: 'soil', colors: ['#716078', '#77667e', '#6b5a72'], detail: '#a58aab' },
    { kind: 'stone', colors: ['#8a889f', '#908ea5', '#848299'], detail: '#beb6cf' },
    { kind: 'mud', colors: ['#6b646e', '#716a74', '#655e68'], detail: '#988ca2' },
  ],
  [
    { kind: 'soil', colors: ['#8c84a5', '#928aab', '#867e9f'], detail: '#c2b6d5' },
    { kind: 'stone', colors: ['#607f9f', '#6685a5', '#5a7999'], detail: '#a4d8ed' },
    { kind: 'sand', colors: ['#b3a6cf', '#b9acd5', '#ada0c9'], detail: '#e0d4ed' },
  ],
  [
    { kind: 'soil', colors: ['#a67e84', '#ac848a', '#a0787e'], detail: '#d5b3b2' },
    { kind: 'stone', colors: ['#9b8fae', '#a195b4', '#9589a8'], detail: '#d4c7e0' },
    { kind: 'sand', colors: ['#e0c5ac', '#e6cbb2', '#dabfa6'], detail: '#fff0d0' },
  ],
  [
    { kind: 'soil', colors: ['#a59362', '#ab9968', '#9f8d5c'], detail: '#d5c18c' },
    { kind: 'stone', colors: ['#a29f80', '#a8a586', '#9c997a'], detail: '#d2ceb1' },
    { kind: 'sand', colors: ['#d7c77b', '#ddcd81', '#d1c175'], detail: '#f6e9ac' },
  ],
];

export function biomeSurface(biome: number, surface: number): BiomeSurface | undefined {
  return BIOME_SURFACES[biome]?.[surface - 1];
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const tx = smooth(x - ix), ty = smooth(y - iy);
  const a = noise(ix, iy, seed) * (1 - tx) + noise(ix + 1, iy, seed) * tx;
  const b = noise(ix, iy + 1, seed) * (1 - tx) + noise(ix + 1, iy + 1, seed) * tx;
  return a * (1 - ty) + b * ty;
}

/** Broad patches with irregular edges, in the island's 0–100 coordinates. */
export function surfacePatchNoise(x: number, y: number, seed: number): number {
  return smoothNoise(x / 18, y / 18, seed + 211) * 0.8 + smoothNoise(x / 7, y / 7, seed + 307) * 0.2;
}

/** Broad climate regions with irregular edges, in the island's 0–100 coordinates. */
export function naturalBiomeFor(x: number, y: number, seed: number): NaturalBiome {
  // Magic forms broad patches among the climate regions, rather than individual tiles.
  if (smoothNoise(x / 16, y / 16, seed + 659) > 0.67) {
    const region = Math.floor((x + 8) / 26) + Math.floor((y + 8) / 26) * 3 + Math.floor(noise(0, 0, seed + 167) * FANTASY_BIOMES.length);
    return FANTASY_BIOMES[(region % FANTASY_BIOMES.length + FANTASY_BIOMES.length) % FANTASY_BIOMES.length].id;
  }
  const heat = y / 100 + (smoothNoise(x / 17, y / 17, seed + 83) - 0.5) * 0.32;
  const wetX = noise(0, 0, seed + 37) > 0.5 ? x : 100 - x;
  const moisture = wetX / 100 + (smoothNoise(x / 21, y / 21, seed + 127) - 0.5) * 0.4;
  if (heat < 0.28) return NaturalBiome.Permafrost;
  if (moisture > 0.73) return NaturalBiome.Swamp;
  if (heat < 0.53) return NaturalBiome.Grassland;
  if (moisture < 0.3) return NaturalBiome.Desert;
  if (moisture < 0.52) return NaturalBiome.Savanna;
  return NaturalBiome.Jungle;
}
