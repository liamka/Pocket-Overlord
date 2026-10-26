import { NaturalBiome, NATURAL_BIOMES } from './natural-biomes';

export const SILVER_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Silver?oldid=22279';
// Biome resource tables take precedence over Silver's older introductory list.
// Arcane Desert is our existing Desert ID, not every tile of coastal sand.
// https://the-official-worldbox-wiki.fandom.com/wiki/Arcane_Desert_Biome
// https://the-official-worldbox-wiki.fandom.com/wiki/Enchanted_Biome
// https://the-official-worldbox-wiki.fandom.com/wiki/Jungle_Biome
// https://the-official-worldbox-wiki.fandom.com/wiki/Mushroom_Biome
export const SILVER_WEIGHTS: Partial<Record<NaturalBiome, number>> = Object.fromEntries(
  NATURAL_BIOMES.filter(b => b.ecology.minerals.silver).map(b => [b.id, b.ecology.minerals.silver]));
// Pocket Overlord balance. Culture Development is marked obsolete: level 10 is
// not a gate. Use the existing workshop experience between bronze (4) and iron (10).
// Silver's value tier is 4, but its condition capacity is below bronze's 110.
export const SILVER = { deposit: 24, spacing: 960, seedSalt: 0x5117e, stockTarget: 4, requires: 7, durability: 80, critical: 0.05 } as const;
