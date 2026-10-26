import type { Village } from './types';

export const COMMON_METAL_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Common_Metals?oldid=22966';
// Pocket Overlord balance: twelve mixed lots; two ore and one stone per indivisible lot.
export const COMMON_METAL = { deposit: 12, attemptsPerTile: 480, seedSalt: 0xc04e, houseCost: 2, millCost: 1 } as const;
export const COMMON_METAL_MATERIALS = {
  copper: { cost: 1, jewelryCost: 1, durability: 80, tier: 2, requires: 0 },
  bronze: { cost: 2, jewelryCost: 2, durability: 110, tier: 3, requires: 4 },
  iron: { cost: 3, jewelryCost: 3, durability: 140, tier: 5, requires: 10 },
  steel: { cost: 4, jewelryCost: 4, durability: 180, tier: 6, requires: 20 },
} as const;
export type CommonMetalMaterial = keyof typeof COMMON_METAL_MATERIALS;
export const isCommonMetalMaterial = (id: unknown): id is CommonMetalMaterial => typeof id === 'string' && Object.hasOwn(COMMON_METAL_MATERIALS, id);
/** Local workshop experience; culture systems can integrate without redefining the raw resource. */
export const metalExperience = (village: Village): number => village.economy?.metalworking ?? 0;
export const canWorkMetal = (village: Village, material: CommonMetalMaterial): boolean => metalExperience(village) >= COMMON_METAL_MATERIALS[material].requires;
