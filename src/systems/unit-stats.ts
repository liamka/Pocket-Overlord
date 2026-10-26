import { physiologyBirthday } from './physiology';
import { hasPhysiology, conversationReach, canSpeak } from '../core/physiology';
import { lawEnabled } from '../core/world-rules';
import { hasTrait } from '../core/traits';
import type { World } from '../core/world';
import type { Entity } from '../core/types';
import { CIVIL_STATS, biologicalAge, chronologicalAge, hungerPercent, intrinsicStat, nutritionRemaining, preserveNutrition, reconcileStats, unitStats } from '../core/unit-stats';
import { unitName } from '../core/units';
import { aboardFerry } from '../core/ferries';
import { liftedIds } from '../core/cataclysms';
import { rulingExperience } from '../core/unit-levels';

/** Called only when a real, reachable conversation completes, once for both participants. */
export function learnConversation(world: World, first: Entity, second: Entity): void {
  if (world.paused || world.entities.get(first.id) !== first || world.entities.get(second.id) !== second || first.id === second.id
    || !canSpeak(first) || !canSpeak(second) || hasTrait(first,'mute') || hasTrait(second,'mute') || !first.components.stats || !second.components.stats || !first.components.citizen || !second.components.citizen
    || (first.components.health?.current ?? 0) <= 0 || (second.components.health?.current ?? 0) <= 0
    || !first.components.position || !second.components.position
    || Math.hypot(first.components.position.x - second.components.position.x, first.components.position.y - second.components.position.y) > conversationReach(first, second)) return;
  // Take both profiles before learning: a gain never teaches itself back in the same conversation.
  const a = unitStats(world, first).values, b = unitStats(world, second).values;
  for (const [student, teacher, own, other] of [[first, second, a, b], [second, first, b, a]] as const) {
    const s = student.components.stats!;
    for (const key of CIVIL_STATS) if (world.rng.next() < 0.3 && other[key] > own[key] && s.learned[key] < 999) {
      s.learned[key]++;
      s.lastLearning = { skill: key, teacher: unitName(teacher), at: world.tick };
    }
    reconcileStats(world, student);
  }
}

export function unitStatsSystem(world: World, dt: number): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  for (const e of world.query('stats', 'health')) {
    const c = e.components, s = c.stats!;
    if (c.reproduction?.egg) continue;
    rulingExperience(world, e);
    if (s.modifiers.some(m => m.expiresAt !== undefined && m.expiresAt <= world.tick)) {
      const food = nutritionRemaining(e);
      s.modifiers = s.modifiers.filter(m => m.expiresAt === undefined || m.expiresAt > world.tick);
      preserveNutrition(e, food);
    }
    const body = c.person ?? c.animal;
    if (body) body.age = Math.min(1e8, body.age + dt * 0.3);
    const age = chronologicalAge(e);
    if (age !== undefined && Math.floor(age) > s.lastBirthday) {
      s.lastBirthday = Math.floor(age);
      physiologyBirthday(world, e);
      // Extra biological years are part of this birthday, not a new event next tick.
      s.lastBirthday = Math.floor(chronologicalAge(e) ?? age);
      if (c.citizen && world.rng.next() < 0.3) {
        const total = CIVIL_STATS.reduce((n, key) => n + Math.max(1, s.base[key]), 0);
        let choice = world.rng.next() * total;
        for (const key of CIVIL_STATS) {
          choice -= Math.max(1, s.base[key]);
          if (choice < 0) { s.learned[key] = Math.min(999, s.learned[key] + 1); break; }
        }
      }
    }
    const stats = reconcileStats(world, e)!;
    if (age !== undefined && world.tick >= s.nextOldAgeAt) {
      s.nextOldAgeAt = world.tick + 100; // One check per existing simulation year, no catch-up lottery on load.
      const lifespan = intrinsicStat(e, 'lifespan'), excess = biologicalAge(e) - lifespan;
      if (lawEnabled(world, 'old-age') && excess > 0 && !s.immortal && !hasTrait(e,'immortal') && world.rng.next() < 0.9 / (1 + Math.exp(-(excess - lifespan * 0.1) / Math.max(1, lifespan * 0.03)))) {
        world.events.push({ kind: 'damage', target: e.id, amount: c.health!.current, cause: 'age' });
      }
    }
    if (!body || !c.position || c.health!.current <= 0 || lifted.has(e.id) || aboardFerry(world, e.id)) continue;
    const v = stats.values;
    const swimming = !!c.person && !world.terrain.isLand(c.position.x, c.position.y);
    if (swimming) { s.stamina = Math.max(0, s.stamina - dt * (hasPhysiology(e, 'aquatic') ? 0 : hasPhysiology(e, 'fins') ? 3 : 10)); continue; }
    const citi = c.citizen;
    const resting = citi ? !citi.path.length && (citi.task === 'idle' || citi.task === 'visit') && !citi.emergency : !c.animal?.moving && c.animal?.targetId === null;
    const catchingBreath = !citi?.path.length && !c.animal?.moving && (s.stamina < 5 || stats.magic && s.mana < 3);
    if ((resting || catchingBreath) && hungerPercent(e) < 90 && !c.thermal?.burning) {
      s.stamina = Math.min(v.stamina, s.stamina + dt * v.stamina * 0.05);
      if (stats.magic) s.mana = Math.min(v.mana, s.mana + dt * 2);
      if (resting && !c.person?.plague && hungerPercent(e) < 30) {
        c.health!.current = Math.min(c.health!.max, c.health!.current + dt * v.recovery);
      }
    }
  }
}
