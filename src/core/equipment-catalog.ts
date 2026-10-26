import { STONE_WEAPONS } from './stone';
import { COMMON_METAL_MATERIALS, isCommonMetalMaterial } from './common-metals';
import { SILVER } from './silver';
import { LEATHER } from './leather';
import type { ResourceBundle } from './resources';

export const EQUIPMENT_SLOTS = ['weapon', 'helmet', 'armor', 'boots', 'amulet', 'ring'] as const;
export type EquipmentSlot = typeof EQUIPMENT_SLOTS[number];
export const MATERIALS = ['wood', 'stone', 'copper', 'bronze', 'silver', 'iron', 'steel', 'mythril', 'adamantine', 'leather', 'bone'] as const;
export type Material = typeof MATERIALS[number];
export const MODIFIERS = ['speed', 'critical', 'attackSpeed', 'health', 'intelligence', 'warfare', 'sharpness', 'diplomacy', 'strength', 'protection', 'fire', 'ice', 'slow', 'stun', 'eternal', 'cursed', 'player'] as const;
export type Modifier = typeof MODIFIERS[number];
export type Modifiers = Partial<Record<Modifier, number>>;
export type HitStatus = 'fire' | 'ice' | 'slow' | 'stun' | 'madness';
export const HIT_STATUSES: HitStatus[] = ['fire', 'ice', 'slow', 'stun', 'madness'];
const defenses: EquipmentSlot[] = ['helmet', 'armor', 'boots'];
const jewelry: EquipmentSlot[] = ['amulet', 'ring'];
export const MODIFIER_RULES: Record<Modifier, { slots: readonly EquipmentSlot[]; max: number }> = Object.fromEntries(MODIFIERS.map(id => [id, {
  slots: (['speed', 'critical', 'eternal', 'cursed', 'player'].includes(id) ? EQUIPMENT_SLOTS
    : ['health'].includes(id) ? [...defenses, ...jewelry]
    : id === 'protection' ? defenses
    : ['intelligence', 'warfare', 'sharpness'].includes(id) ? jewelry
    : ['attackSpeed'].includes(id) ? ['weapon', ...jewelry] : ['weapon']) as readonly EquipmentSlot[],
  max: ['fire', 'ice', 'slow', 'stun', 'eternal', 'cursed', 'player'].includes(id) ? 1 : 5,
}])) as Record<Modifier, { slots: readonly EquipmentSlot[]; max: number }>;

// One speed profile per projectile. These are Pocket Overlord balance values.
export const PROJECTILES = {
  arrow: { speed: 12, radius: 0, color: '#dbc698', status: undefined },
  snowball: { speed: 10, radius: 0, color: '#e9ffff', status: 'ice' },
  rock: { speed: 10, radius: 0, color: '#a7aaa1', status: undefined },
  firebomb: { speed: 8, radius: 2, color: '#f89941', status: 'fire' },
  torch: { speed: 9, radius: 1, color: '#ffc65a', status: 'fire' },
  fireball: { speed: 14, radius: 2, color: '#ff7d36', status: 'fire' },
  madness: { speed: 15, radius: 1, color: '#ce74db', status: 'madness' },
  plasma: { speed: 20, radius: 1, color: '#78e1f1', status: 'fire' },
  pellet: { speed: 18, radius: 0, color: '#fff0bf', status: undefined },
  redOrb: { speed: 10, radius: 0, color: '#f55e4f', status: 'fire' },
  blueOrb: { speed: 10, radius: 0, color: '#8ccaff', status: 'ice' },
  greenOrb: { speed: 10, radius: 0, color: '#9ad76b', status: 'slow' },
  bone: { speed: 7, radius: 1.5, color: '#dcd5b9', status: undefined },
} satisfies Record<string, { speed: number; radius: number; color: string; status?: HitStatus }>;
export type ProjectileKind = keyof typeof PROJECTILES;
export interface AttackProfile { range: number; targets: number; spread: number; interval?: number; projectile?: ProjectileKind; shots: number; statuses: HitStatus[] }
export interface EquipmentDefinition {
  id: string; kind: string; slot: EquipmentSlot; material?: Material; damage: number; armor: number; value: number;
  durability: number; critical?: number; speed?: number; attack: AttackProfile; recipe: { inputs: ResourceBundle; coins: number | null; work: number; available: boolean; reason: string };
}
const metals: Material[] = ['copper', 'bronze', 'silver', 'iron', 'steel', 'mythril', 'adamantine'];
const tiers: Record<Material, number> = { wood: 1, bone: 1, leather: 1, stone: 2, copper: 2, bronze: 3, silver: 4, iron: 5, steel: 6, mythril: 7, adamantine: 8 };
const ingredients = (material: Material, slot: EquipmentSlot): ResourceBundle => isCommonMetalMaterial(material)
  ? { commonMetal: COMMON_METAL_MATERIALS[material][jewelry.includes(slot) ? 'jewelryCost' : 'cost'] }
  : { [material]: 1 };
const melee = (kind: string): AttackProfile => ({ range: kind === 'spear' ? 2.7 : 1.5, targets: kind === 'hammer' ? 3 : 1,
  spread: kind === 'sword' ? 0.2 : kind === 'hammer' ? 0.05 : kind === 'spear' ? 0.15 : 0,
  shots: 1, statuses: kind === 'hammer' ? ['stun'] : [] });
export const EQUIPMENT: Record<string, EquipmentDefinition> = {};
export const wornOutLeather = (item: { definition: string; durability: number }): boolean => EQUIPMENT[item.definition]?.material === 'leather' && item.durability <= 0;
for (const kind of ['sword', 'axe', 'hammer', 'spear', 'bow', 'helmet', 'armor', 'boots', 'amulet', 'ring']) {
  const slot: EquipmentSlot = ['sword', 'axe', 'hammer', 'spear', 'bow'].includes(kind) ? 'weapon' : kind as EquipmentSlot;
  const materials: Material[] = slot === 'weapon' ? ['wood', ...(kind === 'bow' ? [] : ['stone' as const]), ...metals]
    : defenses.includes(slot) ? ['leather', ...metals] : ['bone', ...metals];
  for (const material of materials) {
    const id = `${material}-${kind}`, stone = STONE_WEAPONS[id as keyof typeof STONE_WEAPONS];
    EQUIPMENT[id] = { id, kind, slot, material, damage: stone?.damage ?? (slot === 'weapon' ? tiers[material] * 2 : 0),
      armor: defenses.includes(slot) ? tiers[material] * 2 : 0, value: tiers[material] * 10,
      durability: material === 'silver' ? SILVER.durability : isCommonMetalMaterial(material) ? COMMON_METAL_MATERIALS[material].durability : 100,
      ...(material === 'silver' && jewelry.includes(slot) ? { critical: SILVER.critical } : {}),
      ...(material === 'leather' && slot === 'boots' ? { speed: LEATHER.bootsSpeed } : {}),
      attack: kind === 'bow' ? { ...melee(kind), range: 7 + tiers[material] / 2, projectile: 'arrow' } : { ...melee(kind), ...(stone ? { interval: stone.interval } : {}) },
      // Ordinary equipment uses materials only; special recipes also cost personal coins.
      recipe: { inputs: stone ? { ...stone.inputs } : { ...ingredients(material, slot), ...(jewelry.includes(slot) ? { gems: 1 } : {}) },
        coins: 0, work: 4, available: true, reason: material === 'silver' ? 'Silver equipment requires workshop experience' : isCommonMetalMaterial(material) ? 'Metal equipment requires workshop experience' : 'Made at the workshop' } };
  }
}
const specials: [string, number, ProjectileKind | undefined, HitStatus[], number][] = [
  ['stick', 1, undefined, [], 1], ['fire-sword', 20, undefined, ['fire'], 1], ['fire-hammer', 16, undefined, ['fire', 'stun'], 1],
  ['ice-hammer', 16, undefined, ['ice', 'stun'], 1], ['healer-staff', 12, 'fireball', [], 1], ['druid-staff', 8, 'greenOrb', [], 2],
  ['white-staff', 14, 'blueOrb', [], 1], ['evil-staff', 8, 'redOrb', [], 4], ['necromancer-staff', 14, 'bone', [], 1],
  ['blaster', 18, 'plasma', [], 1], ['shotgun', 12, 'pellet', [], 6],
];
// Our price balance: special recipes cost 20 coins; repairs cost half. Their existing
// knowledge gate remains in force. Ordinary recipes require no monetary surcharge.
for (const [id, damage, projectile, statuses, shots] of specials) EQUIPMENT[id] = {
  id, kind: id, slot: 'weapon', material: id === 'stick' ? 'wood' : undefined, damage, armor: 0, value: id === 'stick' ? 10 : 100 + damage * 5, durability: 100,
  attack: { ...melee(id.includes('hammer') ? 'hammer' : id), range: projectile ? 10 : 1.5, projectile, statuses, shots },
  recipe: { inputs: id === 'stick' ? { wood: 1 } : id.startsWith('fire-') ? { dragonScale: 2 } : { mythril: 3, gems: 2 },
    coins: id === 'stick' ? 0 : 20, work: 4, available: id === 'stick', reason: id === 'stick' ? 'Made at the workshop' : 'This equipment requires special knowledge' },
};
export const NATURAL_ATTACKS: Record<string, AttackProfile> = Object.fromEntries(['hands', 'jaws', 'bite', 'claws', 'fireHands', 'snowball', 'rock'].map(kind => [kind, {
  ...melee(kind), range: kind === 'snowball' || kind === 'rock' ? 7 : 1.5,
  projectile: kind === 'snowball' || kind === 'rock' ? kind : undefined, statuses: kind === 'fireHands' ? ['fire'] : [],
}]));
export function validModifiers(value: unknown, slot: EquipmentSlot): value is Modifiers {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([id, level]) => {
    const rule = MODIFIER_RULES[id as Modifier];
    return rule && rule.slots.includes(slot) && Number.isInteger(level) && level >= 1 && level <= rule.max;
  });
}
// Selected modern table from plan 4: rare starts at 2 (older search extracts say 3).
export function itemRarity(modifiers: Modifiers): string {
  const level = Math.max(0, ...Object.entries(modifiers).filter(([id]) => MODIFIER_RULES[id as Modifier].max === 5).map(([, n]) => n));
  return level >= 5 ? 'Legendary' : level >= 4 ? 'Epic' : level >= 2 ? 'Rare' : level === 1 ? 'Common' : 'Unmodified';
}

/** Local equipment preference based on active effects, independent of material price.
 * Callers compare within one slot; crafting compares an unmodified result to avoid
 * repeatedly spending materials in the hope of rolling better random modifiers. */
export function equipmentScore(definition: string, m: Modifiers = {}): number {
  const d = EQUIPMENT[definition];
  const critical = (d.critical ?? 0) + (m.critical ?? 0) * 0.02;
  const attackSpeed = (m.attackSpeed ?? 0) * 0.04;
  const damage = d.damage + (m.strength ?? 0) + (m.sharpness ?? 0) + (m.warfare ?? 0) * 0.25;
  const offense = d.slot === 'weapon' ? damage * (1 - d.attack.spread / 2) * (1 + critical / 2) / ((1 - attackSpeed) * (d.attack.interval ?? 1))
    + (d.attack.range - 1.5) * 0.3 + (d.attack.targets - 1) * 0.5
    + new Set([...d.attack.statuses, ...HIT_STATUSES.filter(s => s !== 'madness' && m[s])]).size * 0.5 : damage + critical * 20 + attackSpeed * 10;
  return offense + d.armor + (m.protection ?? 0) * 2 + (m.health ?? 0) * 0.5 + (m.speed ?? 0) * 0.5 + (d.speed ?? 0) * 10;
}
