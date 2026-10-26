import type { Entity, Village } from './types';
import type { World } from './world';
import { LEVEL_LIMIT, reconcileStats } from './unit-stats';
import { canGovern } from './capabilities';

export const EXPERIENCE_SOURCES = ['hit', 'kill', 'rule', 'food'] as const;
export type ExperienceSource = typeof EXPERIENCE_SOURCES[number];
/** Input supplied by the culture owner; this does not create cultures or grant their traits. */
export interface LearningCulture { name: string; fastLearners: boolean; trainingPotential: boolean }
export interface ExperienceEvent { id: number; source: ExperienceSource; base: number; subject: string; tick: number }
export interface ExperienceState {
  /** Synchronous results consume consecutive IDs. Replaying any consumed ID is rejected. */
  nextEventId: number;
  last?: ExperienceEvent & { multiplier: number; gained: number; discarded: number; levels: number };
  culture?: LearningCulture;
  ruling?: { villageId: number; since: number; creditedUntil: number };
}
export const newExperience = (): ExperienceState => ({ nextEventId: 1 });
export const xpRequired = (level: number): number => 100 + 20 * (level - 1);
export const EXPERIENCE = { hit: 2, kill: 10, dragon: 100, rule: 10, yearTicks: 100, maxAward: 1e9 } as const;
export const validExperienceName = (value: unknown): value is string => typeof value === 'string'
  && [...value].length > 0 && [...value].length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value);

/** Atomic publication/consumption: no pending XP queue, RNG draw, healing or service award. */
export function awardExperience(world: World, entity: Entity, event: ExperienceEvent): boolean {
  const s = entity.components.stats, state = s?.experience;
  if (world.paused || world.entities.get(entity.id) !== entity || !s || !state || !entity.components.unit
    || (entity.components.health?.current ?? 0) <= 0 || !Number.isSafeInteger(event.id) || event.id !== state.nextEventId
    || event.id >= Number.MAX_SAFE_INTEGER || event.tick !== world.tick || !EXPERIENCE_SOURCES.includes(event.source)
    || !Number.isSafeInteger(event.base) || event.base <= 0 || event.base > EXPERIENCE.maxAward || !validExperienceName(event.subject)) return false;
  const multiplier = state.culture?.fastLearners ? 2 : 1, amount = event.base * multiplier, before = s.level;
  let remaining = s.xpIntoLevel + amount;
  while (s.level < LEVEL_LIMIT && remaining >= xpRequired(s.level)) {
    remaining -= xpRequired(s.level);
    // The bonus is part of this level-up, not another XP purchase or recursive level-up event.
    s.level = Math.min(LEVEL_LIMIT, s.level + (state.culture?.trainingPotential ? 2 : 1));
  }
  const discarded = s.level === LEVEL_LIMIT ? remaining : 0;
  s.xpIntoLevel = s.level === LEVEL_LIMIT ? 0 : remaining;
  state.nextEventId++;
  state.last = { ...event, multiplier, gained: Math.max(0, amount - discarded), discarded, levels: s.level - before };
  reconcileStats(world, entity);
  return true;
}

/** Call only after the action owner has committed a real result and closed its replay gate. */
export function publishExperience(world: World, entity: Entity, source: ExperienceSource, subject: string, base: number): boolean {
  const state = entity.components.stats?.experience;
  return !!state && awardExperience(world, entity, { id: state.nextEventId, source, subject, base, tick: world.tick });
}

/** Replacing the future culture's input affects future awards only. */
export function setLearningCulture(world: World, entity: Entity, culture: LearningCulture | null): boolean {
  const state = entity.components.stats?.experience;
  if (world.entities.get(entity.id) !== entity || !state || culture !== null && (!validExperienceName(culture.name)
    || typeof culture.fastLearners !== 'boolean' || typeof culture.trainingPotential !== 'boolean')) return false;
  if (culture) state.culture = { ...culture }; else delete state.culture;
  return true;
}

export function startRulingExperience(world: World, entity: Entity, village: Village): void {
  const state = entity.components.stats?.experience;
  if (state && world.entities.get(entity.id) === entity && world.society.villages.includes(village)
    && village.government?.leaderId === entity.id && entity.components.citizen?.villageId === village.id) {
    state.ruling = { villageId: village.id, since: world.tick, creditedUntil: world.tick };
  }
}

/** The existing elder is our leader. No kings or second calendar are introduced. */
export function rulingExperience(world: World, entity: Entity): void {
  const state = entity.components.stats?.experience;
  if (world.paused || !state) return;
  const village = world.society.villages.find(v => v.id === entity.components.citizen?.villageId && v.government?.leaderId === entity.id);
  if (!village || !canGovern(world.registry, entity) || (entity.components.health?.current ?? 0) <= 0) { delete state.ruling; return; }
  if (state.ruling?.villageId !== village.id) startRulingExperience(world, entity, village);
  const ruling = state.ruling!, years = Math.floor((world.tick - ruling.creditedUntil) / EXPERIENCE.yearTicks);
  if (years <= 0) return;
  ruling.creditedUntil += years * EXPERIENCE.yearTicks;
  publishExperience(world, entity, 'rule', village.name, Math.min(EXPERIENCE.maxAward, years * EXPERIENCE.rule));
}
