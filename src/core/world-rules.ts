import { ARCHITECT_MOODS, WORLD_LAWS, worldLawDefinitions, type ArchitectMood } from '../content/world-laws';
import { setWorldProcessEnabled } from './world-processes';
import type { World } from './world';
import type { Entity } from './types';

export interface WorldRules {
  version: 1;
  values: Record<string, boolean>;
  forbiddenKnowledge: boolean;
  architect: { name: string; mood: ArchitectMood };
  revision: number;
  changedAt: number;
}
export const newWorldRules = (): WorldRules => ({ version: 1, values: Object.fromEntries(WORLD_LAWS.map(d => [d.id, d.default])),
  forbiddenKnowledge: false, architect: { name: '', mood: 'serene' }, revision: 0, changedAt: 0 });
export function lawEnabled(world: Pick<World, 'worldRules'>, id: string): boolean {
  const d = worldLawDefinitions.get(id);
  return !!d && !d.unavailable && world.worldRules.values[id] === true && d.dependencies.every(key => lawEnabled(world, key));
}
const dependsOnLaw = (id: string, dependency: string): boolean => id === dependency
  || !!worldLawDefinitions.get(id)?.dependencies.some(key => dependsOnLaw(key, dependency));
export function syncWorldRuleProcesses(world: World, restoring = false, changedLaw?: string): void {
  for (const d of world.registry.worldProcesses.values()) {
    if (!d.dependencies.laws.length) continue;
    if (changedLaw && !d.dependencies.laws.some(id => dependsOnLaw(id, changedLaw))) continue;
    const enabled = d.dependencies.laws.every(id => lawEnabled(world, id));
    // A saved task may also be disabled by another owner. Loading never revives it.
    if (!restoring || !enabled) setWorldProcessEnabled(world, d.id, enabled);
  }
}
const changed = (world: World): void => { world.worldRules.revision++; world.worldRules.changedAt = world.tick; };
export type RuleResult = { ok: true } | { ok: false; reason: string };
export function setWorldLaw(world: World, id: string, enabled: boolean): RuleResult {
  const d = worldLawDefinitions.get(id);
  if (!d || typeof enabled !== 'boolean') return { ok: false, reason: 'Unknown world law.' };
  if (d.unavailable) return { ok: false, reason: d.unavailable };
  if (world.worldRules.values[id] === enabled) return { ok: true };
  world.worldRules.values[id] = enabled; changed(world); syncWorldRuleProcesses(world, false, id);
  if (id === 'armies' && !enabled) for (const e of world.query('citizen')) {
    const c = e.components.citizen!;
    if (c.task === 'fight' && !e.components.person?.madness) Object.assign(c, { task: 'idle', targetId: null, path: [], reconsiderIn: 0 });
  }
  if (id === 'peaceful-monsters' && enabled) for (const e of world.entities.values()) {
    if (e.components.animal) Object.assign(e.components.animal, { targetId: null, path: [], decisionIn: 0 });
    if (e.components.dragon) Object.assign(e.components.dragon, { targetId: null, breath: 0, pulseIn: 0 });
    if (e.components.ufo) Object.assign(e.components.ufo, { targetId: null, phase: 'cruise', phaseTime: 0 });
  }
  return { ok: true };
}
/** World-local experimental access; the future discovery/achievement owners share this gate. */
export const canUseWorldEditors = (world: World): boolean => world.worldRules.forbiddenKnowledge;
export const canEarnWorldProgress = (world: World): boolean => !world.worldRules.forbiddenKnowledge;
export function setForbiddenKnowledge(world: World, enabled: boolean): boolean {
  if (typeof enabled !== 'boolean') return false;
  if (world.worldRules.forbiddenKnowledge !== enabled) { world.worldRules.forbiddenKnowledge = enabled; changed(world); }
  return true;
}
export function setArchitect(world: World, name: string, mood: string): boolean {
  if (typeof name !== 'string' || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name) || !Object.hasOwn(ARCHITECT_MOODS, mood)) return false;
  const trimmed = name.trim();
  if (world.worldRules.architect.name !== trimmed || world.worldRules.architect.mood !== mood) {
    world.worldRules.architect = { name: trimmed, mood: mood as ArchitectMood }; changed(world);
  }
  return true;
}

/** Admission counts include existing conception and travel reservations, never a second population store. */
export function settlementRoom(world: World, villageId: number | null): number {
  if (villageId === null || !lawEnabled(world, 'population-100')) return Infinity;
  let count = 0;
  for (const e of world.query('citizen')) if (e.components.citizen!.villageId === villageId) {
    count++; count += e.components.reproduction?.pending?.children.length ?? 0;
  }
  for (const group of world.society.migrations) if (group.toId === villageId) {
    count += settlementArrivals(world, group.members, villageId);
  }
  return Math.max(0, 100 - count);
}
export function settlementArrivals(world: World, ids: readonly number[], villageId: number | null): number {
  return ids.reduce((count, id) => {
    const e = world.entities.get(id);
    return count + (e?.components.citizen && e.components.citizen.villageId !== villageId
      ? 1 + (e.components.reproduction?.pending?.children.length ?? 0) : 0);
  }, 0);
}
export const canJoinSettlement = (world: World, e: Entity, villageId: number | null): boolean =>
  villageId === null || e.components.citizen?.villageId === villageId
  || world.society.migrations.some(group => group.toId === villageId && group.members.includes(e.id))
  || settlementRoom(world, villageId) >= settlementArrivals(world, [e.id], villageId);

export const PROTECTED_TERRAIN_ACTIONS = ['blast', 'fire', 'heat-ray', 'antimatter', 'goo', 'conway', 'civ-seeds'] as const;
export type TerrainAction = typeof PROTECTED_TERRAIN_ACTIONS[number] | 'acid' | 'volcano' | 'stomp' | 'manual' | 'evil-wall';
export const terrainChangeAllowed = (world: World, action: TerrainAction): boolean =>
  !lawEnabled(world, 'gaia') || !(PROTECTED_TERRAIN_ACTIONS as readonly string[]).includes(action);

/** Contract for the future culture owner. Missing culture IDs never count as the same culture. */
export interface WarIdentity { species: string; culture: string | null; xenophobic: boolean; xenophile: boolean }
export function protectedCivilian(angryVillagers: boolean, attacker: WarIdentity, civilian: WarIdentity): boolean {
  if (angryVillagers) return false;
  const sameSpecies = attacker.species === civilian.species, tolerant = !attacker.xenophobic && !civilian.xenophobic;
  return sameSpecies && tolerant || tolerant && (attacker.xenophile || civilian.xenophile)
    || sameSpecies && attacker.culture !== null && attacker.culture === civilian.culture;
}
