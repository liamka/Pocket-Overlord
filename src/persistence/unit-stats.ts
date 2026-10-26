import type { Entity, WorldSnapshot } from '../core/types';
import { bool, integer, number, record, type RecordValue } from '../core/validation';
import { STAT_ORIGINS, STAT_RULES, CIVIL_STATS, calculateStats, initializeStats, isAdult, type StatId } from '../core/unit-stats';
import { validLevelProgress, validLevelSave } from './unit-levels';
import { isRace, RACES } from '../core/races';

export function validStats(v: RecordValue): boolean {
  if (!record(v.base) || Object.keys(v.base).length !== Object.keys(STAT_RULES).length
    || !(Object.keys(STAT_RULES) as StatId[]).every(k => number((v.base as RecordValue)[k], STAT_RULES[k].min, STAT_RULES[k].max)
      && (!STAT_RULES[k].integer || Number.isInteger((v.base as RecordValue)[k])))
    || !validLevelProgress(v) || !record(v.learned) || Object.keys(v.learned).length !== 4 || !CIVIL_STATS.every(k => integer((v.learned as RecordValue)[k], 0, 999))
    || !number(v.ageOvergrowth, 0, 1e8) || !integer(v.lastBirthday, 0, 1e8) || !integer(v.nextOldAgeAt) || !bool(v.immortal)
    || !number(v.stamina, 0, 1e6) || !number(v.mana, 0, 1e6) || !Array.isArray(v.modifiers) || v.modifiers.length > 64) return false;
  const ids = new Set<string>();
  for (const m of v.modifiers) {
    if (!record(m) || typeof m.id !== 'string' || !m.id.length || m.id.length > 80 || ids.has(m.id)
      || !STAT_ORIGINS.includes(m.origin as typeof STAT_ORIGINS[number]) || !record(m.flat) || !record(m.percent)
      || m.expiresAt !== undefined && (!integer(m.expiresAt) || m.origin !== 'status')
      || !Object.entries(m.flat).every(([k, n]) => Object.hasOwn(STAT_RULES, k) && number(n, -1e6, 1e6))
      || !Object.entries(m.percent).every(([k, n]) => Object.hasOwn(STAT_RULES, k) && number(n, -10000, 10000))) return false;
    ids.add(m.id);
  }
  return v.lastLearning === undefined || record(v.lastLearning) && CIVIL_STATS.includes(v.lastLearning.skill as typeof CIVIL_STATS[number])
    && typeof v.lastLearning.teacher === 'string' && [...v.lastLearning.teacher].length <= 100 && !/[\u0000-\u001f\u007f]/u.test(v.lastLearning.teacher) && integer(v.lastLearning.at);
}

export function migrateStats(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Invalid saved units');
  for (const raw of save.entities) {
    if (!record(raw) || !record(raw.components) || !record(raw.components.unit) || !record(raw.components.health)) continue;
    // No RNG, experience, healing or energy refill. Legacy baseHealth already excludes equipment.
    const entity = raw as unknown as Entity;
    initializeStats(entity, save.tick, true);
    // Adulthood moved from 18 to the unified species threshold. Adopt this baseline without a reward.
    if (entity.components.happiness) entity.components.happiness.grown = isAdult(entity);
  }
  return { ...save, version: 52 };
}

export function migrateLifespans(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities)) throw new Error('Invalid saved units');
  const previous = { human: 85, elf: 150, orc: 65, dwarf: 120 };
  for (const raw of save.entities) {
    if (!record(raw) || !record(raw.components)) continue;
    const { person, stats } = raw.components;
    if (!record(person) || !record(stats) || !record(stats.base)) continue;
    const race = person.race ?? 'human';
    // Adopt the new balance once, preserving custom bases and all personal modifiers.
    if (isRace(race) && stats.base.lifespan === previous[race]) stats.base.lifespan = RACES[race].lifespan;
  }
  return { ...save, version: 72 };
}

export function validStatsSave(save: WorldSnapshot): boolean {
  if (!validLevelSave(save)) return false;
  for (const e of save.entities) {
    const s = e.components.stats, health = e.components.health;
    if (!e.components.unit || !health) { if (s) return false; continue; }
    if (!s || !validStats(s as unknown as RecordValue) || s.nextOldAgeAt > save.tick + 100
      || (s.lastLearning?.at ?? 0) > save.tick || s.modifiers.some(m => m.expiresAt !== undefined && m.expiresAt <= save.tick)) return false;
    const worn = (save.equipment?.items ?? []).filter(i => i.location.kind === 'equipped' && i.location.entityId === e.id);
    const v = calculateStats(e, worn).values;
    if (Math.abs(health.max - v.health) > 1e-8 || s.stamina > v.stamina || s.mana > v.mana
      || (e.components.citizen?.hunger ?? e.components.animal?.hunger ?? 0) > v.nutrition) return false;
  }
  return true;
}
