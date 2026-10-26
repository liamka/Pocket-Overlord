import { number, record } from './validation';
import { STONE } from './stone';
import { COMMON_METAL, COMMON_METAL_SOURCE } from './common-metals';
import { SILVER, SILVER_SOURCE } from './silver';
import { GOLD, GOLD_SOURCE } from './gold';
import { BONE, BONE_SOURCE } from './bone';
import { LEATHER_SOURCE } from './leather';
import { DROP_RULES } from '../content/species-profiles';

export const RESOURCE_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Category:Resources?oldid=22509';
export const LEGACY_GOODS = ['grain', 'flour', 'bread', 'wood', 'tools', 'stone', 'stoneAxes'] as const;
export const RESOURCE_IDS = [...LEGACY_GOODS, 'commonMetal', 'silver', 'mythril', 'adamantine', 'bone', 'leather', 'gems', 'gold', 'dragonScale', 'fertilizer',
  'bananas', 'berries', 'candy', 'celestialAvocado', 'coconut', 'crystalSalt', 'desertBerries', 'evilBeets', 'fish', 'herbs', 'honey', 'lemons', 'meat', 'mushrooms', 'peppers', 'pineCones', 'snowCucumbers', 'worms',
  'ale', 'burger', 'cider', 'jam', 'pie', 'sushi', 'tea', 'provisions'] as const;
export type ResourceId = typeof RESOURCE_IDS[number];
export type ResourceBundle = Partial<Record<ResourceId, number>>;
export type Diet = readonly ResourceId[];
export const isResource = (id: unknown): id is ResourceId => typeof id === 'string' && RESOURCE_IDS.includes(id as ResourceId);
export const entries = (goods: ResourceBundle): [ResourceId, number][] => Object.entries(goods) as [ResourceId, number][];
const foods: ResourceId[] = ['grain', 'bread', 'bananas', 'berries', 'candy', 'celestialAvocado', 'coconut', 'crystalSalt', 'desertBerries', 'evilBeets', 'fish', 'herbs', 'honey', 'lemons', 'meat', 'mushrooms', 'peppers', 'pineCones', 'snowCucumbers', 'worms', 'ale', 'burger', 'cider', 'jam', 'pie', 'sushi', 'tea'];
// Balance units are our own: one unit is one inventory item, not a wiki kilogram.
export interface ResourceDefinition {
  id: ResourceId; unit: 'item'; transportable: boolean; storable: boolean;
  consumable: boolean; weight: number; volume: number; source: string;
  kind: 'food' | 'material' | 'equipment' | 'legacy-food';
}
export const RESOURCES = Object.fromEntries(RESOURCE_IDS.map(id => [id, {
  id, unit: 'item', transportable: true, storable: true,
  consumable: foods.includes(id) || ['wood', 'stone', 'commonMetal', 'silver', 'mythril', 'adamantine', 'bone', 'leather', 'gems', 'provisions'].includes(id),
  weight: id === 'stone' ? 3 : id === 'wood' ? 2 : 1, volume: id === 'wood' ? 2 : 1,
  source: id === 'gold' ? GOLD_SOURCE : id === 'leather' ? LEATHER_SOURCE : id === 'silver' ? SILVER_SOURCE : LEGACY_GOODS.includes(id as typeof LEGACY_GOODS[number]) || id === 'provisions' ? 'pocket-overlord:existing-economy' : RESOURCE_SOURCE,
  kind: id === 'provisions' ? 'legacy-food' : id === 'stoneAxes' ? 'equipment' : foods.includes(id) ? 'food' : 'material',
}])) as Record<ResourceId, ResourceDefinition>;
export const RESIDENT_DIET: Diet = [...foods.filter(id => id !== 'crystalSalt' && id !== 'grain'), 'provisions'];
export const canConsume = (id: ResourceId, diet: Diet): boolean => RESOURCES[id].consumable && diet.includes(id);

export function validBundle(value: unknown, max = 2000, allowEmpty = true): value is ResourceBundle {
  return record(value) && (allowEmpty || Object.keys(value).length > 0)
    && Object.entries(value).every(([id, amount]) => isResource(id) && number(amount, 0, max) && (id !== 'gold' || Number.isInteger(amount)));
}
export function validFoodGoods(value: unknown, amount: number): boolean {
  return value === undefined || validBundle(value, 30) && Math.abs(bundleSize(value) - amount) < 1e-8
    && entries(value).every(([id]) => canConsume(id, RESIDENT_DIET));
}
export function addBundle(target: ResourceBundle, goods: ResourceBundle): void {
  for (const [id, amount] of entries(goods)) if (amount > 0) target[id] = (target[id] ?? 0) + amount;
}
export function bundleSize(goods: ResourceBundle): number { return entries(goods).reduce((sum, [, n]) => sum + n, 0); }
export function bundleLoad(goods: ResourceBundle): { weight: number; volume: number } {
  return entries(goods).reduce((load, [id, n]) => ({ weight: load.weight + n * RESOURCES[id].weight, volume: load.volume + n * RESOURCES[id].volume }), { weight: 0, volume: 0 });
}
/** Mutates the sole remaining stock. Sequential workers can never extract the same unit. */
export function extractBundle(remaining: ResourceBundle, requested: ResourceBundle): ResourceBundle {
  if (!validBundle(remaining, 1e12) || !validBundle(requested, 1e12)) throw new Error('Invalid resource extraction');
  const result: ResourceBundle = {};
  for (const [id, wanted] of entries(requested)) {
    const amount = Math.max(0, Math.min(wanted, remaining[id] ?? 0));
    if (amount) { result[id] = amount; remaining[id] = (remaining[id] ?? 0) - amount; }
  }
  return result;
}

export interface SourceProfile {
  origin: 'tree' | 'plant' | 'deposit' | 'field' | 'creature' | 'biology' | 'ground' | 'ocean' | 'hive' | 'meteorite' | 'mine';
  renewal: 'none' | 'harvest' | 'producer'; work: 'cut' | 'mine' | 'harvest' | 'gather' | 'fish';
  primary: ResourceId; outputs: ResourceBundle; capacity: ResourceBundle; source: string;
}
const profile = (origin: SourceProfile['origin'], work: SourceProfile['work'], primary: ResourceId, outputs: ResourceBundle, renewal: SourceProfile['renewal'] = 'none'): SourceProfile =>
  ({ origin, work, primary, outputs, capacity: { ...outputs }, renewal, source: RESOURCE_SOURCE });
// Trees, mineral deposits, crystal plants and fields are live. Other profiles belong to future source plans.
export const SOURCE_PROFILES = {
  tree: profile('tree', 'cut', 'wood', { wood: 5 }),
  stone: { ...profile('deposit', 'mine', 'stone', { stone: STONE.batch }), capacity: { stone: STONE.deposit }, source: 'pocket-overlord:existing-economy' },
  gemOre: { ...profile('deposit', 'mine', 'gems', { gems: 1, stone: 1 }), capacity: { gems: 3, stone: 3 } },
  field: { ...profile('field', 'harvest', 'grain', { grain: 6 }, 'harvest'), capacity: { grain: 2000 }, source: 'pocket-overlord:existing-economy' },
  crystalTree: profile('tree', 'cut', 'wood', { wood: 5, stone: 1, commonMetal: 1, gems: 1 }),
  crystalPlant: profile('plant', 'gather', 'commonMetal', { commonMetal: 2, gems: 1, crystalSalt: 1 }),
  palm: profile('tree', 'cut', 'wood', { wood: 5, coconut: 1 }),
  jungleTree: profile('tree', 'cut', 'wood', { wood: 5, bananas: 1 }),
  mushroomTree: profile('tree', 'cut', 'wood', { wood: 5, mushrooms: 1 }),
  pine: profile('tree', 'cut', 'wood', { wood: 5, pineCones: 3 }),
  lemonTree: profile('tree', 'cut', 'wood', { wood: 5, lemons: 3 }),
  candyTree: profile('tree', 'cut', 'wood', { wood: 5, candy: 3 }),
  bush: profile('plant', 'gather', 'berries', { berries: 3 }, 'harvest'),
  hive: profile('hive', 'gather', 'honey', { honey: 10 }),
  ground: profile('ground', 'gather', 'herbs', { herbs: 1 }),
  ocean: profile('ocean', 'fish', 'fish', { fish: 1 }, 'producer'),
  metalOre: { ...profile('deposit', 'mine', 'commonMetal', { commonMetal: 2, stone: 1 }),
    capacity: { commonMetal: COMMON_METAL.deposit * 2, stone: COMMON_METAL.deposit }, source: COMMON_METAL_SOURCE },
  boneDeposit: { ...profile('deposit', 'mine', 'bone', { bone: 3, stone: 1 }),
    capacity: { bone: BONE.deposit, stone: BONE.deposit / 3 }, source: BONE_SOURCE },
  silverOre: { ...profile('deposit', 'mine', 'silver', { silver: 1, stone: 1 }),
    capacity: { silver: SILVER.deposit, stone: SILVER.deposit }, source: SILVER_SOURCE },
  goldOre: { ...profile('mine', 'mine', 'gold', { gold: 1, stone: 1 }),
    capacity: { gold: GOLD.deposit, stone: GOLD.deposit }, source: GOLD_SOURCE },
  meteorite: profile('meteorite', 'mine', 'adamantine', { adamantine: 3, stone: 3 }),
} satisfies Record<string, SourceProfile>;
export function validSourceProfile(p: SourceProfile): boolean {
  return ['tree', 'plant', 'deposit', 'field', 'creature', 'biology', 'ground', 'ocean', 'hive', 'meteorite', 'mine'].includes(p.origin)
    && ['none', 'harvest', 'producer'].includes(p.renewal) && ['cut', 'mine', 'harvest', 'gather', 'fish'].includes(p.work)
    && isResource(p.primary) && validBundle(p.outputs, 2000, false) && validBundle(p.capacity, 2000, false)
    && entries(p.outputs).every(([id, amount]) => (p.capacity[id] ?? 0) >= amount) && (p.outputs[p.primary] ?? 0) > 0 && !!p.source;
}

export interface MassProfile { baseMass: number; modifier: number; size: number; child: boolean }
export function creatureMass(p: MassProfile): number {
  if (![p.baseMass, p.modifier, p.size].every(Number.isFinite) || p.baseMass < 0 || p.modifier < -1 || p.size < 0) throw new Error('Invalid mass profile');
  return p.baseMass * (1 + p.modifier) * (p.size * 10) * (p.child ? DROP_RULES.childMass : 1);
}
export function creatureDrops(base: ResourceBundle, mass: MassProfile): ResourceBundle {
  const kg = creatureMass(mass), result: ResourceBundle = {};
  const thresholds: ResourceBundle = DROP_RULES.massPerDrop;
  for (const [id, amount] of entries(base)) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid base drops');
    if (amount > 0) result[id] = Math.min(DROP_RULES.maximum, Math.max(DROP_RULES.minimum, amount * Math.floor(kg / (thresholds[id] ?? DROP_RULES.defaultMassPerDrop) + 1)));
  }
  return result;
}
// Existing creatures only. Mass/size below are explicit Pocket Overlord balance choices.
// Base drops use the catalogue, never its already-scaled "normal drops" column.
export const CREATURE_PROFILES: Record<string, { mass: number; base: ResourceBundle }> = {
  human: { mass: 70, base: { meat: 1, bone: 1 } }, elf: { mass: 45, base: { meat: 1, bone: 1 } },
  dwarf: { mass: 60, base: { meat: 2, bone: 1, stone: 1 } }, orc: { mass: 80, base: { meat: 1, bone: 2 } },
  sheep: { mass: 50, base: { meat: 1, bone: 1, leather: 2 } }, dog: { mass: 25, base: { meat: 1, bone: 1, leather: 1 } }, wolf: { mass: 40, base: { meat: 1, bone: 1, leather: 1 } },
};
export interface CollectionPolicy { species: string; savage: boolean; scavenges: boolean; diet: Diet }
export const SAPIENT_SPECIES: readonly string[] = ['human', 'elf', 'dwarf', 'orc'];
export const canCollectRemains = (species: string, goods: ResourceBundle, policy: CollectionPolicy): boolean =>
  policy.scavenges && (policy.savage || !SAPIENT_SPECIES.includes(species) && policy.species !== species)
    && entries(goods).some(([id, n]) => n > 0 && canConsume(id, policy.diet));

// Deferred contracts: no dragon/trait producer or recipe/field effect is activated here.
export const SPECIAL_CHAINS = {
  dragonScale: { producer: 'dragon-death', trigger: 'once-per-death', outputs: { dragonScale: 1 }, delivery: ['cargo', 'stock'], consumer: 'fire-equipment-recipe', inputs: { dragonScale: 1 } },
  fertilizer: { producer: 'biological-trait', trigger: 'completed-biological-cycle', outputs: { fertilizer: 1 }, delivery: ['cargo', 'stock'], consumer: 'suitable-field', inputs: { fertilizer: 1 }, fertilityGain: 0.1, fertilityLimit: 1 },
} as const;
export function validSpecialChains(chains: typeof SPECIAL_CHAINS): boolean {
  return chains.dragonScale.producer === 'dragon-death' && chains.dragonScale.trigger === 'once-per-death' && chains.dragonScale.consumer === 'fire-equipment-recipe'
    && chains.fertilizer.producer === 'biological-trait' && chains.fertilizer.trigger === 'completed-biological-cycle' && chains.fertilizer.consumer === 'suitable-field'
    && Object.entries(chains).every(([id, chain]) => validBundle(chain.inputs, 30, false) && validBundle(chain.outputs, 30, false)
      && Object.keys(chain.inputs).length === 1 && Object.keys(chain.outputs).length === 1 && (chain.inputs as ResourceBundle)[id as ResourceId]! > 0
      && (chain.outputs as ResourceBundle)[id as ResourceId]! > 0 && chain.delivery.join(',') === 'cargo,stock')
    && number(chains.fertilizer.fertilityGain, 0.001, 1) && number(chains.fertilizer.fertilityLimit, chains.fertilizer.fertilityGain, 1)
    && !RESOURCES.fertilizer.consumable;
}
