import { EXPERIENCE, EXPERIENCE_SOURCES, newExperience, validExperienceName, xpRequired } from '../core/unit-levels';
import { LEVEL_LIMIT } from '../core/unit-stats';
import { bool, integer, record, type RecordValue } from '../core/validation';
import type { WorldSnapshot } from '../core/types';

export function validLevelProgress(stats: RecordValue): boolean {
  const x = stats.experience;
  if (!integer(stats.level, 1, LEVEL_LIMIT) || !integer(stats.xpIntoLevel, 0, stats.level === LEVEL_LIMIT ? 0 : xpRequired(stats.level) - 1)
    || !record(x) || !integer(x.nextEventId, 1)) return false;
  if (x.culture !== undefined && (!record(x.culture) || !validExperienceName(x.culture.name)
    || !bool(x.culture.fastLearners) || !bool(x.culture.trainingPotential))) return false;
  if (x.ruling !== undefined && (!record(x.ruling) || !integer(x.ruling.villageId, 1) || !integer(x.ruling.since)
    || !integer(x.ruling.creditedUntil, x.ruling.since) || (x.ruling.creditedUntil - x.ruling.since) % EXPERIENCE.yearTicks !== 0)) return false;
  const last = x.last;
  if (last === undefined) return x.nextEventId === 1;
  return record(last) && integer(last.id, 1) && last.id === x.nextEventId - 1 && integer(last.tick)
    && EXPERIENCE_SOURCES.includes(last.source as typeof EXPERIENCE_SOURCES[number]) && validExperienceName(last.subject)
    && integer(last.base, 1, EXPERIENCE.maxAward) && (last.multiplier === 1 || last.multiplier === 2)
    && integer(last.gained, 0, EXPERIENCE.maxAward * 2) && integer(last.discarded, 0, EXPERIENCE.maxAward * 2)
    && last.gained + last.discarded === last.base * last.multiplier && integer(last.levels, 0, stats.level - 1)
    && (last.discarded === 0 || stats.level === LEVEL_LIMIT);
}

export function validLevelSave(save: WorldSnapshot): boolean {
  return save.entities.every(e => {
    const s = e.components.stats, x = s?.experience;
    if (!s) return true;
    if (!validLevelProgress(s as unknown as RecordValue) || !x || (x.last?.tick ?? 0) > save.tick) return false;
    const r = x.ruling;
    return !r || r.creditedUntil <= save.tick && r.since <= save.tick && e.components.citizen?.villageId === r.villageId
      && save.society.villages.some(v => v.id === r.villageId && v.government?.leaderId === e.id);
  });
}

export function migrateLevels(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Invalid saved experience');
  for (const e of save.entities) if (record(e) && record(e.components) && record(e.components.stats)) {
    // Preserve existing levels and bars. No reconstruction from kills, service or past years in office.
    e.components.stats.xpIntoLevel = 0;
    e.components.stats.experience = newExperience();
  }
  return { ...save, version: 53 };
}
