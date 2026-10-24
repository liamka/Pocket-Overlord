import { noise } from './random';

// Living ground is independent of island shapes, roads and blast damage.
export enum NaturalBiome { Grassland, Savanna, Desert, Jungle, Swamp, Permafrost }
export const NATURAL_BIOMES = [
  { id: NaturalBiome.Grassland, key: 'grassland', name: 'Grassland', label: 'Grassland seeds', hint: 'Plant meadows and broadleaf trees. Balanced soil for farming.', colors: ['#7b9d50', '#7d9f52', '#78994d', '#809f54'], detail: '#a0b66b', trees: 0.22, growth: 1, walking: 1 },
  { id: NaturalBiome.Savanna, key: 'savanna', name: 'Savanna', label: 'Savanna seeds', hint: 'Plant golden grass and acacias. Crops grow more slowly.', colors: ['#b4ac59', '#b8af5c', '#b1a654', '#bdb461'], detail: '#d8c878', trees: 0.12, growth: 0.75, walking: 1 },
  { id: NaturalBiome.Desert, key: 'desert', name: 'Desert', label: 'Desert seeds', hint: 'Spread desert sand and cacti. Poor soil and slower travel.', colors: ['#d9b976', '#dcbc7a', '#d5b471', '#e0c180'], detail: '#b8965f', trees: 0.055, growth: 0.35, walking: 0.8 },
  { id: NaturalBiome.Jungle, key: 'jungle', name: 'Jungle', label: 'Jungle seeds', hint: 'Grow lush jungle and palms. Rich soil helps crops grow faster.', colors: ['#4b8851', '#508d54', '#48834d', '#548e52'], detail: '#77ad69', trees: 0.38, growth: 1.25, walking: 0.9 },
  { id: NaturalBiome.Swamp, key: 'swamp', name: 'Swamp', label: 'Swamp seeds', hint: 'Grow wetlands and mangroves. Mud slows travel and crop growth.', colors: ['#69866c', '#6e8b70', '#658268', '#728e72'], detail: '#93aa7b', trees: 0.2, growth: 0.7, walking: 0.6 },
  { id: NaturalBiome.Permafrost, key: 'permafrost', name: 'Permafrost', label: 'Permafrost seeds', hint: 'Spread lasting snow and conifers. Cold soil slows crops and travel.', colors: ['#cededb', '#d4e3df', '#c7d8d6', '#dae7e2'], detail: '#a6c3c5', trees: 0.16, growth: 0.5, walking: 0.75 },
] as const;

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
