import { NaturalBiome, biomeDefinition, biomeSurface } from './natural-biomes';
import { isBridge, isRoadSurface, Terrain } from './types';

/** Stable layer IDs. Individual wall, explosive and creep behavior belongs to its content owner. */
export const TILE_TOPS = ['tnt', 'timed-tnt', 'landmine', 'water-bomb', 'fuse', 'firework-0', 'firework-1', 'firework-3', 'firework-4',
  'wall-stone', 'wall-ancient', 'wall-green', 'wall-light', 'wall-evil', 'wall-wood', 'wall-iron', 'grey-goo', 'flower-dark', 'flower-light'] as const;
export type TileTop = typeof TILE_TOPS[number];
export interface TileLayers {
  index: number;
  /** Preserve local cover identity independently of a changing living biome. */
  surfaceBiome?: number;
  elevation?: number;
  waterDepth?: 1 | 2 | 3;
  frost?: 'snow' | 'ice';
  top?: TileTop;
  variant?: number;
  temperature?: number;
  thermalAt?: number;
  thermalBand?: number;
  thermalFrost?: true;
  heatSource?: import('./death').DamageContext;
  thermalChange?: import('./temperature').ThermalChange;
  lavaStage?: 1 | 2 | 3 | 4;
  burning?: number;
}
export interface TileTraveler { mode?: 'walk' | 'swim' | 'sail' | 'fly'; swampAdapted?: boolean; desertAdapted?: boolean; frostAdapted?: boolean }
export const TILE_BASE_IDS = ['deep-water', 'shallow-water', 'sand', 'soil', 'scorched', 'crater', 'road', 'mountain', 'bridge-horizontal', 'bridge-vertical', 'pit-shallow', 'pit-close', 'pit-deep', 'hill', 'summit'] as const;
/** Our balance, in simulation seconds. Source hazard numbers do not specify a time unit. */
export const TILE_BALANCE = { sandSpeed: 0.5, waterSpeed: 0.6, iceSpeed: 0.8, roadSpeed: 1.4, mountainDamage: 1,
  wallDamage: 1, gooDamage: 200, paradoxChance: 0.1, paradoxYears: 1 } as const;

// Tiles revision 21811: separate ignition probability and burn rate, High / Low.
export const BIOME_TILE_RULES = {
  grassland: [6, 5, 5, 5, 'Herbs'], savanna: [6, 6, 5, 5, 'Wheat'], desert: [0, 0, 0, 0, 'Desert Berries'],
  jungle: [5, 4, 5, 5, 'Bananas'], swamp: [0, 0, 0, 0, 'Herbs'], permafrost: [0, 0, 0, 0, 'Pinecones'],
  enchanted: [4, 3, 4, 4, 'Herbs'], corrupted: [2, 2, 1, 1, 'Evil Beets'], infernal: [0, 0, 0, 0, 'Peppers'],
  mushroom: [3, 3, 4, 4, 'Mushroom'], crystal: [0, 0, 0, 0, 'Crystal Salt'], candy: [6, 5, 4, 4, 'Candy'], lemon: [6, 5, 2, 2, 'Lemon'],
  birch: [3, 3, 4, 4, 'Herbs'], celestial: [3, 3, 2, 2, 'Herbs'], clover: [3, 3, 4, 4, 'Herbs'], flower: [3, 3, 4, 5, 'Herbs'],
  garlic: [3, 3, 5, 5, 'Herbs'], maple: [3, 3, 4, 4, 'Herbs'], paradox: [3, 3, 2, 2, 'Herbs'], rocklands: [3, 3, 3, 3, 'Herbs'],
  singularity: [3, 3, 1, 1, 'Herbs'], wasteland: [0, 0, 0, 0, 'Herbs'],
} as const;
export function biomeTileRule(key: keyof typeof BIOME_TILE_RULES, high: boolean) {
  const rule = BIOME_TILE_RULES[key];
  return { ignitionChance: rule[high ? 0 : 1] / 100, burnRate: rule[high ? 2 : 3],
    referenceResource: key === 'permafrost' && !high ? null : rule[4], referenceNutrition: 30, referenceStrength: 0 };
}
export function tileCell(tile: Terrain, biomeId: number, surfaceId: number, layers?: TileLayers, traveler: TileTraveler = {}) {
  const biome = biomeDefinition(biomeId), surface = biomeSurface(layers?.surfaceBiome ?? biomeId, surfaceId), frost = layers?.frost;
  const pit = tile >= Terrain.PitShallow && tile <= Terrain.PitDeep;
  const water = tile < Terrain.Sand || surface?.kind === 'water', ice = frost === 'ice' || surface?.kind === 'ice';
  const wall = layers?.top?.startsWith('wall-') ?? false, goo = layers?.top === 'grey-goo';
  const depth = layers?.waterDepth ?? (tile === Terrain.DeepWater ? 3 : water || isBridge(tile) ? 1 : 0);
  const elevation = layers?.elevation ?? (tile === Terrain.Summit ? frost === 'snow' ? 4 : 5 : tile === Terrain.Mountain ? 3 : tile === Terrain.Hill ? 2 : tile === Terrain.Grass ? 1 : 0);
  const steep = elevation >= 3;
  const mode = traveler.mode ?? 'walk', land = !pit && (!water || ice || isBridge(tile));
  const passable = mode === 'fly' || !wall && !pit && (mode === 'sail' ? water && !ice && !isBridge(tile) : land || mode === 'swim');
  // One precedence table: flight, barriers, water/ice, roads, local cover, biome. Never stack cover penalties.
  const speed = mode === 'fly' ? 1 : !passable ? 0 : water && !ice ? TILE_BALANCE.waterSpeed : ice ? TILE_BALANCE.iceSpeed
    : goo ? 0.1 : isRoadSurface(tile) ? TILE_BALANCE.roadSpeed : tile === Terrain.Sand || surface?.kind === 'sand' ? TILE_BALANCE.sandSpeed
    : steep ? 0.5 : (biome.id === NaturalBiome.Swamp && traveler.swampAdapted || biome.id === NaturalBiome.Desert && traveler.desertAdapted || biome.id === NaturalBiome.Permafrost && traveler.frostAdapted) ? 1 : surface?.kind === 'mud' ? 0.6 : biome.walking;
  const buildReason = layers?.lavaStage ? 'Dangerous ground.' : pit ? 'There is no ground here.' : wall ? 'A wall occupies this cell.' : water || ice ? 'Water and frozen ground cannot support a building.'
    : steep ? 'The slope is too steep.' : goo ? 'Dangerous ground.' : isBridge(tile) ? 'A bridge occupies this cell.' : null;
  const plantable = tile === Terrain.Grass && !surface && !frost && !wall && !goo && !steep && !layers?.lavaStage;
  const farmable = tile === Terrain.Grass && !water && !ice && !frost && !wall && !goo && !steep && surface?.kind !== 'stone' && !layers?.lavaStage;
  const rules = biomeTileRule(biome.key as keyof typeof BIOME_TILE_RULES, elevation >= 2);
  const burn = plantable ? { chance: rules.ignitionChance, rate: rules.burnRate } : { chance: 0, rate: 0 };
  if (isRoadSurface(tile)) { burn.chance = 1; burn.rate = 5; }
  if (layers?.top === 'fuse') { burn.chance = 1; burn.rate = 5; }
  if (layers?.top === 'grey-goo' || layers?.top === 'wall-wood') { burn.chance = 1; burn.rate = 5; }
  const damage = wall ? TILE_BALANCE.wallDamage : goo ? TILE_BALANCE.gooDamage : steep ? TILE_BALANCE.mountainDamage : 0;
  return { base: TILE_BASE_IDS[tile], tile, biome, surface, elevation, waterDepth: depth, water, ice, land, frost, top: layers?.top,
    temperature: layers?.temperature ?? 0, lavaStage: layers?.lavaStage, thermalChange: layers?.thermalChange,
    burning: layers?.burning ?? 0, variant: layers?.variant, movement: { passable, speed: layers?.lavaStage && mode !== 'fly' ? Math.min(speed, 0.2) : speed },
    buildable: buildReason === null, buildReason, plantable, farmable, growth: farmable ? biome.growth : 0, burn,
    damagePerSecond: mode === 'fly' ? 0 : damage, entry: biome.ecology.entry === 'age' && plantable ? { chance: TILE_BALANCE.paradoxChance, years: TILE_BALANCE.paradoxYears } : null,
    tools: { freeze: water && !ice && !isBridge(tile) && !wall, thaw: !!frost, seed: !wall && !goo && !pit },
  };
}
