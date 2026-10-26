import { traitBlocks, adoptAfflictions } from '../core/traits';
import { isAdult } from '../core/unit-stats';
import { adoptStatuses, applyStatus, statusOf, hasStatus } from '../core/status-effects';
import { packedFood, recordLoss } from '../core/resource-ledger';
import { suspendCivilDuties } from './capabilities';
import { PLAGUE, MADNESS, plagueSeverity } from '../core/afflictions';
import { liftedIds } from '../core/cataclysms';
import { aboardFerry } from '../core/ferries';
import { attackReach, performAttack } from './equipment';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import type { World } from '../core/world';
import { applyEvent } from './effects';
import { findPath } from './navigation';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function infect(entity: Entity, world?: World): void {
  if (traitBlocks(entity,'plague') || entity.components.ship) return;
  const person = entity.components.person;
  if (world) { if (!world.paused) applyStatus(world, entity, 'plague'); return; }
  if (person && entity.components.health && !person.plague) person.plague = { age: 0, spreadIn: PLAGUE.interval };
}

export function enrage(world: World, entity: Entity): void {
  const { person, citizen } = entity.components;
  if (!person || !citizen || !entity.components.health || person.madness || traitBlocks(entity,'madness')) return;
  if (!applyStatus(world, entity, 'madness')) return;
  suspendCivilDuties(world, entity);
  Object.assign(citizen, { task: 'idle', targetId: null, path: [], repair: null, reconsiderIn: 0, attackIn: 0 });
  delete citizen.emergency;
  if (citizen.work) delete citizen.work.reservation;
  if (!citizen.work?.cargo) delete citizen.work;
  // A berserk traveler leaves the party immediately; remaining members keep their trip.
  for (const group of [...world.society.migrations]) {
    if (!group.members.includes(entity.id)) continue;
    group.members = group.members.filter(id => id !== entity.id);
    if (!group.members.length) {
      const village = world.society.villages.find(v => v.id === group.fromId);
      recordLoss(village, packedFood(group.food, group.foodGoods));
      world.society.migrations.splice(world.society.migrations.indexOf(group), 1);
    }
  }
}

/** Contact cannot pass through a mountain; new carriers have their own incubation. */
function contact(world: World, a: Vec2, b: Vec2, onLand = false): boolean {
  const steps = Math.max(1, Math.ceil(distance(a, b) * 2));
  for (let i = 1; i <= steps; i++) {
    const x = a.x + (b.x - a.x) * i / steps, y = a.y + (b.y - a.y) * i / steps;
    if (world.terrain.at(x, y) === Terrain.Mountain || onLand && !world.terrain.isLand(x, y)) return false;
  }
  return true;
}

export function afflictions(world: World, dt: number): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  for (const entity of [...world.query('person', 'health', 'position')]) {
    adoptStatuses(world, entity);
    adoptAfflictions(entity,world.tick);
    const person = entity.components.person!, plague = person.plague, clock = statusOf(entity, 'plague');
    if (!plague) continue;
    if (!clock) continue;
    plague.age = Math.max(0, Math.min(1e8, (world.tick - clock.startedAt) / 30));
    if (plague.age < PLAGUE.incubation) continue;
    plague.spreadIn = Math.min(PLAGUE.interval, Math.max(0, (clock.nextTick! - world.tick) / 30));
    if (world.tick >= clock.nextTick!) {
      clock.nextTick = world.tick + Math.round(PLAGUE.interval * 30);
      plague.spreadIn = PLAGUE.interval;
      if (!lifted.has(entity.id)) {
        let transmitted = 0;
        // Spatial bucket insertion order changes after loading; keep transmission deterministic.
        for (const other of world.nearby(entity.components.position!, PLAGUE.contact).sort((a, b) => a.id - b.id)) {
          if (!other.components.person || !other.components.health || other.components.person.plague || lifted.has(other.id)
            || !contact(world, entity.components.position!, other.components.position!)) continue;
          if (world.rng.next() < 0.6) { infect(other, world); if (++transmitted === 2) break; }
        }
      }
    }
    applyEvent(world, { kind: 'damage', target: entity.id, amount: (2 + plagueSeverity(entity) * 6) * dt, cause: 'plague' });
  }
}

/** Override jobs for berserk residents and nearby adults defending themselves. */
export function madnessIntent(world: World, entity: Entity, lifted: ReadonlySet<number>): boolean {
  const { person, citizen: c, position: p, motion } = entity.components;
  if (!person || !c || !p) return false;
  const mad = !!person.madness || hasStatus(entity, 'angry') || hasStatus(entity, 'tantrum');
  if (aboardFerry(world, entity.id) || !world.terrain.isLand(p.x, p.y)) return mad;
  if (!mad && (!isAdult(entity) || c.task === 'migrate' || c.emergency)) return false;
  const sight = mad ? MADNESS.sight : 4;
  const eligible = (target: Entity): boolean => target.id !== entity.id && !!target.components.person && !!target.components.health
    && (mad || !!target.components.person.madness) && !lifted.has(target.id) && !aboardFerry(world, target.id)
    && world.terrain.isLand(target.components.position!.x, target.components.position!.y)
    && distance(p, target.components.position!) <= sight;
  let target = world.entities.get(c.targetId ?? -1);
  if (!target || !eligible(target)) target = undefined;
  if (!target || c.reconsiderIn <= 0) {
    const candidates = world.nearby(p, sight).filter(eligible)
      .sort((a, b) => distance(p, a.components.position!) - distance(p, b.components.position!) || a.id - b.id);
    target = undefined;
    for (const candidate of candidates.slice(0, 6)) {
      const q = candidate.components.position!;
      if (distance(p, q) <= attackReach(world, entity) && contact(world, p, q, true)) {
        target = candidate; c.path = []; break;
      }
      // Stay on the current shore; an attack must never reach across a ferry crossing.
      const path = findPath(world, p, q, 1.1, (a, b) => distance(p, b) <= sight + 2 && contact(world, a, b, true));
      if (path === undefined || path.some((step, i) => {
        const previous = i ? path[i - 1] : p;
        return Math.abs(Math.floor(step.x) - Math.floor(previous.x)) + Math.abs(Math.floor(step.y) - Math.floor(previous.y)) > 1;
      })) continue;
      target = candidate; c.path = path; break;
    }
    if (target || mad) c.reconsiderIn = 0.5;
  }
  if (!target) {
    if (mad) { c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null; }
    return mad;
  }
  c.task = 'fight'; c.targetId = target.id; c.repair = null;
  if (c.work) delete c.work.reservation;
  if (!c.work?.cargo) delete c.work;
  if (mad) delete c.emergency;
  const q = target.components.position!;
  if (distance(p, q) <= attackReach(world, entity) && contact(world, p, q, true)) {
    c.path = [];
    const heading = Math.atan2(q.y - p.y, q.x - p.x);
    if (motion) motion.heading = heading;
    if (person.animation) person.animation.heading = heading;
    if (c.attackIn <= 0) {
      performAttack(world, entity, target, mad ? 1.25 : 1);
    }
  }
  return true;
}
