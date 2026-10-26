import { genomeModifiers } from './subspecies-state';
import { traitModifiers, hasTrait } from './traits';
import { CREATURE_PROFILES } from './resources';
import { VISITORS } from './visitors';
import { statusDefinitions } from '../content/status-effects';
import { compatibilityParameters } from '../content/species-profiles';
import { plagueSeverity } from './afflictions';
import { RACES, raceOf } from './races';
import { EQUIPMENT, NATURAL_ATTACKS, wornOutLeather, type AttackProfile } from './equipment-catalog';
import { equippedItems, type EquipmentItem } from './equipment';
import type { Entity } from './types';
import type { World } from './world';
import type { ExperienceState } from './unit-levels';

export const LEVEL_LIMIT = 9999;

const rule = (label: string, unit: string, min: number, max: number, initial: number, integer = false) => ({ label, unit, min, max, initial, integer, mode: 'add-then-percent' as const });
/** Local units: tiles, seconds and the existing 0.3 years/second calendar. */
export const STAT_RULES = {
  health: rule('Health', 'points', 1, 1e6, 1), mana: rule('Mana', 'points', 0, 1e6, 0), stamina: rule('Stamina', 'points', 0, 1e6, 0),
  nutrition: rule('Nutrition', 'points', 100, 200, 100), happiness: rule('Happiness', 'points', -100, 100, 0),
  damage: rule('Damage', 'points', 1, 1e5, 1, true), armor: rule('Armor', '%', 0, 99, 0), critical: rule('Critical chance', '%', 0, 1e4, 0),
  speed: rule('Speed', 'tiles/s', 0, 100, 0), attackSpeed: rule('Attack speed', '/s', 0.5, 10, 1), accuracy: rule('Accuracy', 'points', 1, 10, 10),
  range: rule('Attack range', 'tiles', 0, 100, 1.5), projectiles: rule('Projectiles', 'count', 1, 32, 1, true), targets: rule('Targets', 'count', 1, 32, 1, true),
  damageRange: rule('Minimum damage', '%', 0, 100, 50), criticalMultiplier: rule('Critical multiplier', '×', 1, 10, 2),
  combatSkill: rule('Combat skill', '%', 0, 100, 0), spellcasting: rule('Spellcasting', '%', 0, 100, 0),
  diplomacy: rule('Diplomacy', 'points', 0, 999, 0, true), warfare: rule('Warfare', 'points', 0, 999, 0, true),
  stewardship: rule('Stewardship', 'points', 0, 999, 0, true), intelligence: rule('Intelligence', 'points', 0, 999, 0, true),
  lifespan: rule('Lifespan', 'years', 1, 1e6, 85), construction: rule('Construction', 'points', 1, 100, 10), metabolicRate: rule('Metabolic rate', '×', 0, 20, 1),
  recovery: rule('Rest recovery', 'points/s', 0, 100, 0.2),
  hitSize: rule('Hit radius', 'tiles', 0.05, 8, 0.35), scale: rule('Visual scale', '×', 0.1, 4, 1), mass: rule('Mass', 'kg', 0.01, 1e6, 65),
} as const;
export type StatId = keyof typeof STAT_RULES;
export type StatValues = Record<StatId, number>;
export const CIVIL_STATS = ['diplomacy', 'warfare', 'stewardship', 'intelligence'] as const;
export type CivilStat = typeof CIVIL_STATS[number];
export const STAT_SOURCE_LABELS = { genome: 'Inherited parameters', personal: 'Personal traits', culture: 'Culture', status: 'Temporary effect' } as const;
export const STAT_ORIGINS = ['genome', 'personal', 'culture', 'status'] as const;
export interface StatModifier {
  id: string; origin: typeof STAT_ORIGINS[number]; flat: Partial<StatValues>; percent: Partial<StatValues>; expiresAt?: number;
}
export interface UnitStats {
  base: StatValues;
  level: number; xpIntoLevel: number; experience: ExperienceState;
  learned: Record<CivilStat, number>; modifiers: StatModifier[];
  ageOvergrowth: number; lastBirthday: number; nextOldAgeAt: number; immortal: boolean;
  stamina: number; mana: number;
  lastLearning?: { skill: CivilStat; teacher: string; at: number };
}
export const clampStat = (key: StatId, value: number): number => {
  const r = STAT_RULES[key], bounded = Math.max(r.min, Math.min(r.max, Number.isFinite(value) ? value : r.initial));
  return r.integer ? Math.floor(bounded) : bounded;
};
export const chronologicalAge = (e: Entity): number | undefined => e.components.person?.age ?? e.components.animal?.age;
export const biologicalAge = (e: Entity): number => (chronologicalAge(e) ?? 0) + (e.components.stats?.ageOvergrowth ?? 0);
export function intrinsicStat(e: Entity, key: StatId): number {
  // Happiness (plans/worldbox/elements/24.md) replaces historical Mood (25.md).
  // Keep the saved base/modifier slots compatible, but only the event owner supplies this value.
  if (key === 'happiness') return e.components.happiness?.value ?? STAT_RULES.happiness.initial;
  const state = e.components.stats;
  const base = state?.base[key] ?? (key === 'lifespan' ? e.components.person ? RACES[raceOf(e)].lifespan : 160 : STAT_RULES[key].initial);
  let flat = 0, percent = 0;
  for (const modifiers of [state?.modifiers, traitModifiers(e), genomeModifiers(e)]) if (modifiers) {
    for (const m of modifiers) { flat += m.flat[key] ?? 0; percent += m.percent[key] ?? 0; }
  }
  for (const status of e.components.statuses?.active ?? []) {
    const d = statusDefinitions[status.id]; flat += d.flat?.[key] ?? 0; percent += d.percent?.[key] ?? 0;
  }
  return clampStat(key, (base + flat) * Math.max(0, 1 + percent / 100));
}
export function adultAge(e: Entity): number {
  const lifespan = intrinsicStat(e, 'lifespan');
  return e.components.person && lifespan > 30 ? 16 : Math.min(16, 1.1 * lifespan ** 0.55);
}
export const breedingAge = (e: Entity): number => e.components.person && intrinsicStat(e, 'lifespan') > 30 ? 18 : adultAge(e);
export const isAdult = (e: Entity): boolean => chronologicalAge(e) !== undefined && chronologicalAge(e)! >= adultAge(e);
export const canBreed = (e: Entity): boolean => chronologicalAge(e) !== undefined && chronologicalAge(e)! >= breedingAge(e) && !hasTrait(e,'infertile');
export const hungerPercent = (e: Entity): number => e.components.citizen?.hunger ?? e.components.animal?.hunger ?? 0;
export const nutritionRemaining = (e: Entity): number => intrinsicStat(e, 'nutrition') * Math.max(0, 1 - hungerPercent(e) / 100);
/** Keep the existing hunger percentage as the sole stored food bar. Capacity changes cannot create food. */
export function preserveNutrition(e: Entity, amount: number): void {
  const eater = e.components.citizen ?? e.components.animal;
  if (eater) eater.hunger = 100 * (1 - Math.min(Math.max(0, amount), intrinsicStat(e, 'nutrition')) / intrinsicStat(e, 'nutrition'));
}
export function setStatModifier(world: World, e: Entity, modifier: StatModifier): boolean {
  const state = e.components.stats;
  if (world.entities.get(e.id) !== e || !state || !modifier.id || modifier.id.length > 80 || !STAT_ORIGINS.includes(modifier.origin)
    || state.modifiers.length >= 64 && !state.modifiers.some(m => m.id === modifier.id)
    || modifier.expiresAt !== undefined && (modifier.origin !== 'status' || !Number.isSafeInteger(modifier.expiresAt) || modifier.expiresAt <= world.tick)
    || !Object.entries(modifier.flat).every(([k, n]) => Object.hasOwn(STAT_RULES, k) && Number.isFinite(n) && Math.abs(n) <= 1e6)
    || !Object.entries(modifier.percent).every(([k, n]) => Object.hasOwn(STAT_RULES, k) && Number.isFinite(n) && Math.abs(n) <= 10000)) return false;
  const food = nutritionRemaining(e), index = state.modifiers.findIndex(m => m.id === modifier.id);
  if (index < 0) state.modifiers.push(structuredClone(modifier)); else state.modifiers[index] = structuredClone(modifier);
  preserveNutrition(e, food); reconcileStats(world, e); return true;
}
export function removeStatModifier(world: World, e: Entity, id: string): boolean {
  const state = e.components.stats;
  if (world.entities.get(e.id) !== e || !state?.modifiers.some(m => m.id === id)) return false;
  const food = nutritionRemaining(e);
  state.modifiers = state.modifiers.filter(m => m.id !== id);
  preserveNutrition(e, food); reconcileStats(world, e); return true;
}

export function initializeStats(e: Entity, tick: number, legacy = false): void {
  const c = e.components;
  if (c.stats || !c.unit || !c.health) return;
  const base = Object.fromEntries(Object.entries(STAT_RULES).map(([k, r]) => [k, r.initial])) as StatValues;
  base.health = c.combat?.baseHealth ?? c.health.max;
  base.speed = c.motion?.speed ?? (c.animal ? c.animal.kind === 'sheep' ? 1.3 : 2.2 : 0);
  base.hitSize = c.solid?.radius ?? 0.35;
  if (c.person) {
    const race = RACES[raceOf(e)];
    Object.assign(base, { damage: race.damage, attackSpeed: 1 / race.attackInterval, lifespan: race.lifespan,
      construction: 10 / race.construction, recovery: race.recovery * 2, stamina: 100, mana: 20, mass: raceOf(e) === 'elf' ? 25 : 65,
      diplomacy: 2, warfare: 2, stewardship: 2, intelligence: 2 });
  } else if (c.animal) Object.assign(base, { damage: c.animal.kind === 'dog' ? 9 : 5, stamina: 100, lifespan: 160, mass: c.animal.kind === 'sheep' ? 45 : 25 });
  else if (c.ship || c.ufo) base.mass = 1000;
  else if (c.monsterHunter) Object.assign(base, { damage: VISITORS.damage, attackSpeed: 1 / VISITORS.attackDelay,
    speed: VISITORS.speed, mass: 65 });
  const resourceProfile = c.person ? CREATURE_PROFILES[raceOf(e)] : c.animal ? CREATURE_PROFILES[c.animal.kind] : undefined;
  if (resourceProfile) base.mass = resourceProfile.mass;
  // Overrides describe the existing direct base only. A budget enters through placed genes, never here.
  Object.assign(base, compatibilityParameters(c.creature?.speciesId ?? '')?.baseStats);
  c.stats = { base, level: 1, xpIntoLevel: 0, experience: { nextEventId: 1 }, learned: { diplomacy: 0, warfare: 0, stewardship: 0, intelligence: 0 }, modifiers: [],
    ageOvergrowth: 0, lastBirthday: Math.floor(chronologicalAge(e) ?? 0), nextOldAgeAt: tick + 100, immortal: false,
    stamina: legacy ? 0 : base.stamina, mana: 0 };
}
export interface StatContribution { source: string; flat: number; percent: number }
export interface StatExplanation { base: number; value: number; contributions: StatContribution[] }
export interface CalculatedStats {
  values: StatValues; explanations: Record<StatId, StatExplanation>; attack: AttackProfile; magic: boolean; minimumDamage: number;
}
const magical = new Set(['fireball', 'madness', 'redOrb', 'blueOrb', 'greenOrb', 'bone']);
const weaponRange = (kind: string): number => kind.includes('hammer') ? 10 : kind === 'stick' ? 20
  : kind.includes('sword') ? 80 : kind === 'spear' ? 70 : ['bow', 'blaster', 'axe'].includes(kind) ? 60 : kind === 'shotgun' ? 90 : 50;
/** Pure calculation. Inputs are saved sources, equipment and active states, never the previous maximum. */
export function calculateStats(e: Entity, worn: readonly EquipmentItem[] = []): CalculatedStats {
  const c = e.components, state = c.stats;
  const values = { ...(state?.base ?? Object.fromEntries(Object.entries(STAT_RULES).map(([k, r]) => [k, r.initial]))) } as StatValues;
  values.happiness = intrinsicStat(e, 'happiness');
  const explanations = Object.fromEntries(Object.keys(STAT_RULES).map(k => [k, { base: values[k as StatId], value: 0, contributions: [] } as StatExplanation])) as CalculatedStats['explanations'];
  const add = (key: StatId, source: string, flat = 0, percent = 0): void => {
    if (key === 'happiness') return;
    if (flat || percent) explanations[key].contributions.push({ source, flat, percent });
  };
  const finish = (key: StatId): number => {
    const x = explanations[key];
    return x.value = values[key] = clampStat(key, (x.base + x.contributions.reduce((n, v) => n + v.flat, 0)) * Math.max(0, 1 + x.contributions.reduce((n, v) => n + v.percent, 0) / 100));
  };
  for (const m of [...(state?.modifiers ?? []), ...genomeModifiers(e)]) for (const key of Object.keys(STAT_RULES) as StatId[]) add(key, STAT_SOURCE_LABELS[m.origin], m.flat[key], m.percent[key]);
  for (const s of c.statuses?.active ?? []) {
    const d = statusDefinitions[s.id];
    for (const key of Object.keys(STAT_RULES) as StatId[]) add(key, d.label, d.flat?.[key], d.percent?.[key]);
  }
  for (const m of traitModifiers(e)) for (const key of Object.keys(STAT_RULES) as StatId[]) add(key, m.id, m.flat[key], m.percent[key]);
  for (const key of CIVIL_STATS) add(key, 'Learning', state?.learned[key] ?? 0);
  const weapon = worn.find(i => EQUIPMENT[i.definition]?.slot === 'weapon'), definition = weapon && EQUIPMENT[weapon.definition];
  const attack = definition?.attack ?? NATURAL_ATTACKS[c.naturalAttack?.kind ?? (c.animal?.kind === 'dog' ? 'claws' : c.animal ? 'bite' : 'hands')];
  const magic = !!c.person && !!attack.projectile && magical.has(attack.projectile);
  for (const item of worn) {
    if (wornOutLeather(item)) continue;
    const d = EQUIPMENT[item.definition], m = item.modifiers;
    if (!d) continue;
    add('damage', 'Equipment', d.damage + (m.strength ?? 0) + (m.sharpness ?? 0));
    add('armor', 'Equipment', d.armor + (m.protection ?? 0) * 2);
    add('critical', 'Equipment', (d.critical ?? 0) * 100 + (m.critical ?? 0) * 2);
    add('health', 'Equipment', (m.health ?? 0) * 5);
    add('speed', 'Equipment', 0, (m.speed ?? 0) * 5 + (d.speed ?? 0) * 100);
    add('attackSpeed', 'Equipment', 0, (m.attackSpeed ?? 0) * 4);
    for (const key of ['intelligence', 'warfare', 'diplomacy'] as const) add(key, 'Equipment', m[key] ?? 0);
  }
  for (const key of CIVIL_STATS) finish(key);
  add('damage', 'Warfare', values.warfare * 0.2);
  add('combatSkill', 'Warfare', Math.floor(values.warfare / 5));
  add('spellcasting', 'Intelligence', Math.floor(values.intelligence / 5));
  add('mana', 'Intelligence', values.intelligence * 10);
  add('construction', 'Stewardship', 0, values.stewardship);
  const levels = Math.max(0, (state?.level ?? 1) - 1);
  if ((state?.level ?? 1) > 5) { add('combatSkill', 'Level', 10); add('spellcasting', 'Level', 10); }
  // Only the base profile grows. Items and percentages never compound on a previous level.
  for (const [key, rate] of [['health', 0.05], ['mana', 0.02], ['stamina', 0.02]] as const) add(key, 'Level', explanations[key].base * levels * rate);
  add('range', 'Equipment', attack.range - explanations.range.base);
  add('projectiles', 'Equipment', attack.shots - explanations.projectiles.base);
  add('targets', 'Equipment', attack.targets - explanations.targets.base);
  add('damageRange', 'Equipment', weaponRange(definition?.kind ?? '') - explanations.damageRange.base);
  if (attack.interval) add('attackSpeed', 'Equipment', explanations.attackSpeed.base * (1 / attack.interval - 1));
  if (definition?.kind === 'fire-sword') add('criticalMultiplier', 'Equipment', 0.1);
  else if (definition?.kind === 'druid-staff') add('criticalMultiplier', 'Equipment', 0.3);
  else if (attack.projectile && attack.projectile !== 'pellet') add('criticalMultiplier', 'Equipment', 0.5);
  if (chronologicalAge(e) !== undefined && !isAdult(e)) { add('damage', 'Young age', 0, -50); add('speed', 'Young age', 0, -30); }
  if (c.person?.madness) add('speed', 'Madness', 0, 35);
  if (c.person?.plague) { add('speed', 'Plague', 0, -45 * plagueSeverity(e)); add('stamina', 'Plague', -10); }
  if ((c.combat?.statuses.slow ?? 0) > 0) add('speed', 'Slowed', 0, -50);
  for (const key of Object.keys(STAT_RULES) as StatId[]) if (!(CIVIL_STATS as readonly string[]).includes(key)) finish(key);
  if ((c.combat?.statuses.stun ?? 0) > 0 || (c.combat?.statuses.ice ?? 0) > 0 || c.statuses?.active.some(s => statusDefinitions[s.id].stops)) {
    explanations.speed.contributions.push({ source: 'Immobilized', flat: -values.speed, percent: 0 });
    explanations.speed.value = values.speed = 0;
  }
  return { values, explanations, attack, magic, minimumDamage: Math.max(1, Math.ceil(values.damage * values.damageRange / 100)) };
}

const statKeys = Object.keys(STAT_RULES) as StatId[];
type CachedEquipment = Pick<EquipmentItem, 'id' | 'definition' | 'modifiers'> & { wornOut: boolean };
interface StatsCache {
  base?: StatValues; learned?: UnitStats['learned']; level?: number;
  modifiers: StatModifier[]; genome: StatModifier[]; traits: string[]; statuses: string[];
  madness: boolean; plague?: number; happiness?: number; slow: boolean; stopped: boolean;
  naturalAttack?: string; person: boolean; animal?: string; adultAge: number; adult: boolean; equipment: CachedEquipment[];
  result: CalculatedStats;
}
const cache = new WeakMap<Entity, StatsCache>();
function sameBase(current: StatValues | undefined, saved: StatValues | undefined): boolean {
  if (!current || !saved) return current === saved;
  for (const key of statKeys) if (current[key] !== saved[key]) return false;
  return true;
}
const sameValues = (a: Partial<StatValues>, b: Partial<StatValues>): boolean => {
  for (const key in a) if (a[key as StatId] !== b[key as StatId]) return false;
  for (const key in b) if (a[key as StatId] !== b[key as StatId]) return false;
  return true;
};
const sameModifiers = (current: readonly StatModifier[], saved: readonly StatModifier[]): boolean => current.length === saved.length
  && current.every((m, i) => m.id === saved[i].id && m.origin === saved[i].origin
    && sameValues(m.flat, saved[i].flat) && sameValues(m.percent, saved[i].percent));
const copyModifiers = (modifiers: readonly StatModifier[]): StatModifier[] => modifiers.map(m => ({ ...m, flat: { ...m.flat }, percent: { ...m.percent } }));
const sameIds = (current: readonly { id: string }[], saved: readonly string[]): boolean => current.length === saved.length
  && current.every((value, i) => value.id === saved[i]);
function sameEquipment(world: World, e: Entity, saved: readonly CachedEquipment[]): boolean {
  let count = 0;
  for (const item of equippedItems(world, e.id)) {
    const old = saved[count++];
    if (!old || item.id !== old.id || item.definition !== old.definition || wornOutLeather(item) !== old.wornOut
      || !sameValues(item.modifiers, old.modifiers)) return false;
  }
  return count === saved.length;
}
export function unitStats(world: World, e: Entity): CalculatedStats {
  const c = e.components, s = c.stats, existing = cache.get(e), genome = genomeModifiers(e);
  const traits = c.traits?.entries ?? [], statuses = c.statuses?.active ?? [], modifiers = s?.modifiers ?? [];
  const madness = !!c.person?.madness, plague = c.person?.plague?.age, happiness = c.happiness?.value;
  const slow = (c.combat?.statuses.slow ?? 0) > 0, stopped = (c.combat?.statuses.stun ?? 0) > 0 || (c.combat?.statuses.ice ?? 0) > 0;
  // Compare saved numeric sources directly, without recursively flattening hundreds of keys on every consumer call.
  // Copies retain immediate visibility of in-place editor changes, including multiple changes in one tick.
  const unchanged = existing && s?.level === existing.level && madness === existing.madness && plague === existing.plague
    && happiness === existing.happiness && slow === existing.slow && stopped === existing.stopped
    && c.naturalAttack?.kind === existing.naturalAttack && !!c.person === existing.person && c.animal?.kind === existing.animal
    && sameBase(s?.base, existing.base)
    && CIVIL_STATS.every(key => s?.learned[key] === existing.learned?.[key])
    && sameModifiers(modifiers, existing.modifiers) && sameModifiers(genome, existing.genome)
    && sameIds(traits, existing.traits) && sameIds(statuses, existing.statuses) && sameEquipment(world, e, existing.equipment);
  const maturity = unchanged ? existing.adultAge : adultAge(e), age = chronologicalAge(e);
  const adult = age !== undefined && age >= maturity;
  if (unchanged && adult === existing.adult) return existing.result;
  const worn = equippedItems(world, e.id);
  const result = calculateStats(e, worn);
  cache.set(e, { base: s && { ...s.base }, learned: s && { ...s.learned }, level: s?.level,
    modifiers: copyModifiers(modifiers), genome: copyModifiers(genome), traits: traits.map(t => t.id), statuses: statuses.map(t => t.id),
    madness, plague, happiness, slow, stopped, naturalAttack: c.naturalAttack?.kind, person: !!c.person, animal: c.animal?.kind, adultAge: maturity, adult,
    equipment: worn.map(item => ({ id: item.id, definition: item.definition, modifiers: { ...item.modifiers }, wornOut: wornOutLeather(item) })), result });
  return result;
}
/** Updating maxima cannot heal, refill energy or grant experience. */
export function reconcileStats(world: World, e: Entity): CalculatedStats | undefined {
  const s = e.components.stats, h = e.components.health;
  if (!s || !h) return;
  const calculated = unitStats(world, e), v = calculated.values;
  h.max = v.health; h.current = Math.max(0, Math.min(h.current, h.max));
  if (e.components.combat) e.components.combat.baseHealth = s.base.health;
  s.stamina = Math.max(0, Math.min(s.stamina, v.stamina)); s.mana = Math.max(0, Math.min(s.mana, v.mana));
  const eater = e.components.citizen ?? e.components.animal;
  if (eater) eater.hunger = Math.max(0, Math.min(eater.hunger, 100));
  const ruling = s.experience?.ruling;
  if (ruling && (!e.components.citizen || e.components.citizen.villageId !== ruling.villageId
    || !world.society.villages.some(v => v.id === ruling.villageId && v.government?.leaderId === e.id))) delete s.experience.ruling;
  return calculated;
}
export function armoredDamage(damage: number, armor: number): number {
  return Math.max(1, Math.floor(Math.max(0, damage) * (1 - clampStat('armor', armor) / 100)));
}
export function rollDamage(stats: CalculatedStats, random: () => number): number {
  const max = Math.max(1, Math.floor(stats.values.damage));
  if (stats.values.critical > 0 && random() < Math.min(1, stats.values.critical / 100)) return max * stats.values.criticalMultiplier;
  const min = Math.min(max, stats.minimumDamage);
  return min + Math.floor(random() * (max - min + 1));
}
export function projectileDeviation(accuracy: number, distance: number): number {
  const a = clampStat('accuracy', accuracy);
  return Math.min((10 / a - 1) * distance / 40, (10 - a) * 0.2);
}
