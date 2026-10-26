import { spendNutrition } from '../core/food';
import { lawEnabled } from '../core/world-rules';
import { hasPhysiology } from '../core/physiology';
import { reproductionHit } from '../core/reproduction';
import { huntable } from '../core/hunting';
import { traitHit } from './traits';
import { EQUIPMENT, HIT_STATUSES, NATURAL_ATTACKS, PROJECTILES, type AttackProfile, type HitStatus } from '../core/equipment-catalog';
import { equippedItem, equippedItems, wearLeather, maintainEquipment, type EquipmentShot } from '../core/equipment';
import { armoredDamage, projectileDeviation, rollDamage, unitStats } from '../core/unit-stats';
import { applyStatus, adoptStatuses, statusStops, statusBlocks, immuneToStatus, hasStatus, HIT_STATUS_IDS } from '../core/status-effects';
import { EXPERIENCE, publishExperience } from '../core/unit-levels';
import { unitName } from '../core/units';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import type { World } from '../core/world';
import { applyEvent } from './effects';
import { atWar } from './society';
import { aboardFerry } from '../core/ferries';
import { liftedIds } from '../core/cataclysms';
import { feedsBy, hunts } from '../core/creatures';
import type { DeathCause } from '../core/death';

export function attackProfile(world: World, entity: Entity): AttackProfile {
  const item = equippedItem(world, entity.id, 'weapon');
  if (!item) return NATURAL_ATTACKS[entity.components.naturalAttack?.kind ?? (entity.components.animal?.kind === 'dog' ? 'claws' : entity.components.animal ? 'bite' : 'hands')];
  const profile = EQUIPMENT[item.definition].attack;
  return { ...profile, statuses: [...new Set([...profile.statuses, ...HIT_STATUSES.filter(s => s !== 'madness' && item.modifiers[s])])] };
}
export const attackReach = (world: World, entity: Entity, target?: Entity): number => Math.max(unitStats(world, entity).values.range, target?.components.dwelling ? 2.3 : 0);
export const statusImmune = (entity: Entity, status: HitStatus): boolean => immuneToStatus(entity, HIT_STATUS_IDS[status]);
export const combatStopped = (entity: Entity): boolean => statusStops(entity) || (entity.components.combat?.statuses.stun ?? 0) > 0 || (entity.components.combat?.statuses.ice ?? 0) > 0;
export function equipmentSpeed(world: World, entity: Entity): number {
  const base = entity.components.stats?.base.speed ?? entity.components.motion?.speed ?? 1;
  const p = entity.components.position;
  const tangled = p && (entity.components.person || entity.components.animal) && lawEnabled(world, 'entanglewood')
    && world.nearby(p, 1.4).some(e => e.typeId === 'core:tree' && e.components.tree && !e.components.motion);
  return unitStats(world, entity).values.speed / (base || 1) * (tangled ? 0.8 : 1);
}
function friendly(world: World, source: Entity | undefined, target: Entity, villageId: number | null, hostile: boolean): boolean {
  if (source?.id === target.id) return true;
  if (hostile) return false;
  const targetVillage = target.components.citizen?.villageId ?? target.components.animal?.villageId ?? target.components.dwelling?.villageId ?? null;
  return villageId !== null && targetVillage !== null && !atWar(world, villageId, targetVillage);
}
function applyStatuses(world: World, entity: Entity, statuses: HitStatus[], sourceId: number): void {
  if (!entity.components.health || !world.entities.has(entity.id)) return;
  for (const status of statuses) {
    if (statusImmune(entity, status)) continue;
    if (status === 'fire') applyEvent(world, { kind: 'heat', target: entity.id, amount: 80, sourceId });
    else applyStatus(world, entity, HIT_STATUS_IDS[status], { ...(status === 'madness' ? {} : { seconds: status === 'stun' ? 0.8 : 2 }), source: world.entities.get(sourceId) });
  }
}
export function equipmentHit(world: World, sourceId: number, target: Entity, damage: number, statuses: HitStatus[], cause: DeathCause = 'conflict', receipt: { awarded: boolean; attackId?: number } = { awarded: false }): void {
  if (world.paused || world.entities.get(target.id) !== target || !target.components.health || target.components.health.current <= 0) return;
  const health = target.components.health, before = health.current, name = unitName(target);
  const defense = unitStats(world, target).values.armor;
  const protection = equippedItems(world, target.id);
  applyEvent(world, { kind: 'damage', target: target.id, amount: armoredDamage(damage, defense), sourceId, cause });
  if (health.current < before) wearLeather(world, target.id, protection);
  if (target.components.unit && sourceId !== target.id && health.current < before && !receipt.awarded) {
    receipt.awarded = true;
    // Other projectiles can arrive later or after loading. Persist the receipt on every remaining sibling.
    if (receipt.attackId !== undefined) for (const shot of world.equipment.shots) {
      if (shot.sourceId === sourceId && shot.experience?.attackId === receipt.attackId) shot.experience.awarded = true;
    }
    const source = world.entities.get(sourceId);
    if (source) publishExperience(world, source, 'hit', name, EXPERIENCE.hit);
  }
  traitHit(world, world.entities.get(sourceId), target, before - health.current);
  reproductionHit(world, world.entities.get(sourceId), target, before - health.current);
  if (world.entities.get(target.id) === target) applyStatuses(world, target, statuses, sourceId);
}
function clearStrike(world: World, from: Vec2, to: Vec2, attacker: number, target: number, ranged: boolean): boolean {
  const body = world.entities.get(attacker), crossesWater = !!body && (hasPhysiology(body, 'aquatic') || hasPhysiology(body, 'hovering'));
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.25);
  for (let i = 1; i < steps; i++) {
    const p = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
    if (world.terrain.at(p.x, p.y) === Terrain.Mountain || !ranged && !crossesWater && !world.terrain.isLand(p.x, p.y) || world.nearby(p, 1.3).some(e => e.id !== attacker && e.id !== target && e.components.solid
      && Math.hypot(e.components.position!.x - p.x, e.components.position!.y - p.y) < e.components.solid.radius)) return false;
  }
  return true;
}
/** Every actor uses this path; ranged attacks launch saved projectiles, never immediate damage. */
export function performAttack(world: World, entity: Entity, target: Entity, multiplier = 1): boolean {
  if (entity.components.animal && lawEnabled(world, 'peaceful-monsters')) return false;
  const p = entity.components.position, q = target.components.position, c = entity.components.citizen, a = entity.components.animal;
  const profile = attackProfile(world, entity), cooldown = c?.attackIn ?? a?.attackIn ?? 0;
  if (world.entities.get(entity.id) !== entity || world.entities.get(target.id) !== target || world.paused || !p || !q || !target.components.health || target.components.health.current <= 0 || (entity.components.health?.current ?? 0) <= 0 || cooldown > 0 || combatStopped(entity)
    || aboardFerry(world, entity.id) || liftedIds(world).has(entity.id)
    || Math.hypot(p.x - q.x, p.y - q.y) > attackReach(world, entity, target)
    || !clearStrike(world, p, q, entity.id, target.id, !!profile.projectile)) return false;
  const stats = unitStats(world, entity), v = stats.values, energy = entity.components.stats;
  if (statusBlocks(entity, 'attack') || stats.magic && statusBlocks(entity, 'spell')) return false;
  const staminaCost = 5, manaCost = stats.magic ? 3 : 0;
  if (energy && (energy.stamina < staminaCost || energy.mana < manaCost)
    || profile.projectile && world.equipment.shots.length + v.projectiles > 512) return false;
  const damage = Math.min(1e6, rollDamage(stats, () => world.rng.next()) * multiplier);
  if (energy) { energy.stamina -= staminaCost; energy.mana -= manaCost; }
  spendNutrition(entity, 1); // Local balance: one nutrition per committed attack.
  const hostile = !!entity.components.person?.madness || !!target.components.person?.madness || hasStatus(entity, 'angry') || hasStatus(entity, 'tantrum');
  const villageId = c?.villageId ?? a?.villageId ?? null;
  if (profile.projectile) {
    const attackId = world.equipment.nextShotId;
    const deviation = projectileDeviation(v.accuracy, Math.hypot(q.x - p.x, q.y - p.y));
    for (let i = 0; i < v.projectiles; i++) {
      const angle = profile.projectile === 'pellet' ? (i - (v.projectiles - 1) / 2) * 0.055 : 0;
      const dx = q.x - p.x, dy = q.y - p.y;
      const destination = { x: p.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: p.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
      if (deviation > 0) { destination.x += world.rng.range(-deviation, deviation); destination.y += world.rng.range(-deviation, deviation); }
      world.equipment.shots.push({ ...p, id: world.equipment.nextShotId++, sourceId: entity.id, targetId: target.id, villageId,
        kind: profile.projectile, destination, damage: damage / v.projectiles, statuses: [...profile.statuses], remaining: 5, hostile,
        ...(c?.jobAssignment?.kind === 'hunter' ? { hunting: true as const } : {}),
        experience: { attackId, awarded: false } });
    }
  } else {
    const targets = [target, ...world.nearby(q, 1.5).filter(e => c?.jobAssignment?.kind !== 'hunter' && e.id !== target.id && e.components.health && !friendly(world, entity, e, villageId, hostile)
      && Math.hypot(p.x - e.components.position!.x, p.y - e.components.position!.y) <= v.range
      && clearStrike(world, p, e.components.position!, entity.id, e.id, false)).sort((a, b) => a.id - b.id)].slice(0, v.targets);
    const receipt = { awarded: false };
    for (const victim of targets) equipmentHit(world, entity.id, victim, victim.components.dwelling ? damage / 2 : damage, profile.statuses,
      feedsBy(world.registry, entity, 'hunt') && hunts(world.registry, entity, victim) ? 'eaten' : 'conflict', receipt);
  }
  const interval = 1 / v.attackSpeed;
  if (c) c.attackIn = interval; if (a) a.attackIn = interval;
  return true;
}
function impact(world: World, shot: EquipmentShot, target?: Entity): void {
  const profile = PROJECTILES[shot.kind], source = world.entities.get(shot.sourceId);
  const statuses = [...new Set([...shot.statuses, ...(profile.status ? [profile.status] : [])])];
  let victims = profile.radius ? world.nearby(shot, profile.radius).sort((a, b) => a.id - b.id).filter(e => e.components.health && !friendly(world, source, e, shot.villageId, shot.hostile)) : target ? [target] : [];
  if (shot.hunting) {
    const village = world.society.villages.find(v => v.id === shot.villageId);
    victims = victims.filter(e => e.id === shot.targetId && village && huntable(world, village, e));
  }
  const cause: DeathCause = shot.kind === 'firebomb' ? 'explosion' : profile.status === 'fire' ? 'fire' : 'conflict';
  const receipt = shot.experience ?? { awarded: true };
  for (const victim of victims) equipmentHit(world, shot.sourceId, victim, victim.components.dwelling ? shot.damage / 2 : shot.damage, statuses, cause, receipt);
}
export function equipmentSystem(world: World, dt: number): void {
  if (world.paused) return;
  maintainEquipment(world);
  for (const e of world.query('citizen')) e.components.citizen!.attackIn = Math.max(0, e.components.citizen!.attackIn - dt - 1e-10);
  for (const entity of world.entities.values()) if (entity.components.combat) {
    adoptStatuses(world, entity);
  }
  for (let i = world.equipment.shots.length - 1; i >= 0; i--) {
    const shot = world.equipment.shots[i], profile = PROJECTILES[shot.kind];
    const dx = shot.destination.x - shot.x, dy = shot.destination.y - shot.y, d = Math.hypot(dx, dy);
    const travel = Math.min(d, profile.speed * dt), steps = Math.max(1, Math.ceil(travel / 0.2));
    let finished = false;
    for (let j = 0; j < steps; j++) {
      shot.x += dx / (d || 1) * travel / steps; shot.y += dy / (d || 1) * travel / steps;
      if (!world.terrain.inside(shot.x, shot.y) || world.terrain.at(shot.x, shot.y) === Terrain.Mountain) { finished = true; break; }
      const target = world.nearby(shot, 8).filter(e => e.id !== shot.sourceId && e.components.health && (e.components.solid || e.id === shot.targetId || !friendly(world, world.entities.get(shot.sourceId), e, shot.villageId, shot.hostile)))
        .sort((a, b) => a.id - b.id).find(e => Math.hypot(e.components.position!.x - shot.x, e.components.position!.y - shot.y) <= (e.components.stats ? unitStats(world, e).values.hitSize : e.components.solid?.radius ?? 0.35));
      if (target) { impact(world, shot, friendly(world, world.entities.get(shot.sourceId), target, shot.villageId, shot.hostile) ? undefined : target); finished = true; break; }
    }
    shot.remaining = Math.max(0, shot.remaining - dt);
    if (!finished && (d <= travel + 1e-8 || !shot.remaining)) { impact(world, shot); finished = true; }
    if (finished) world.equipment.shots.splice(i, 1);
  }
}
