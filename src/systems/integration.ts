import { canSpeak, conversationReach } from '../core/physiology';
import { hasTrait } from '../core/traits';
import { learnConversation } from './unit-stats';
import { applyStatus, hasStatus, statusBlocks, statusStops } from '../core/status-effects';
import { isAdult } from '../core/unit-stats';
import { friendshipContactRequired, recordHappiness } from '../core/happiness';
import type { World } from '../core/world';
import type { Entity, Migration } from '../core/types';
import { residentName } from '../core/village-life';
import { befriend, unitName } from '../core/units';
import { aboardFerry } from '../core/ferries';
import { findPath } from './navigation';
import { villageOf } from './society';
import { unsafe } from './emergencies';

const distance = (a: Entity, b: Entity): number => Math.hypot(a.components.position!.x - b.components.position!.x, a.components.position!.y - b.components.position!.y);
const expressive = (e: Entity): number => Number((['laughing', 'singing', 'swearing', 'crying'] as const).some(id => hasStatus(e, id)));

/** Founders and households returning to their own village do not need to integrate. */
export function beginIntegration(world: World, entity: Entity, group: Migration): void {
  const c = entity.components.citizen!;
  delete c.integration;
  if (group.toId === null || group.fromId === c.villageId || c.villageId === null) return;
  c.integration = { villageId: c.villageId, groupId: group.id, arrived: world.tick, status: 'settling', belonging: 30,
    worked: false, friendId: null, contactId: null, contact: 0,
    socialAfter: world.tick + 90, socialUntil: 0, leaveAfter: world.tick + 2700 };
}

function available(world: World, entity: Entity): boolean {
  const c = entity.components.citizen, p = entity.components.position;
  return !!c && !!p && canSpeak(entity) && !hasTrait(entity,'mute') && !statusBlocks(entity, 'conversation') && !statusStops(entity) && !entity.components.person?.madness && !c.emergency && c.hunger < 55 && !c.work?.cargo
    && !world.society.wars.some(war => war.attackers.includes(c.villageId ?? -1) || war.defenders.includes(c.villageId ?? -1))
    && ['idle', 'farm', 'visit', 'socialize'].includes(c.task) && !aboardFerry(world, entity.id)
    && world.terrain.isLand(p.x, p.y) && !entity.components.thermal?.burning && !unsafe(world, p);
}

function stopSocializing(entity: Entity): void {
  const c = entity.components.citizen!;
  c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0; delete c.conversation;
}

export function continueSocializing(world: World, entity: Entity): boolean {
  if (world.paused) return false;
  const c = entity.components.citizen!;
  if (c.task !== 'socialize') return false;
  const target = world.entities.get(c.targetId ?? -1), other = target?.components.citizen;
  const until = Math.max(c.integration?.socialUntil ?? 0, other?.integration?.socialUntil ?? 0);
  if (!target || !other || other.task !== 'socialize' || other.targetId !== entity.id || other.villageId !== c.villageId
    || world.tick >= until || !available(world, entity) || !available(world, target)) {
    if (target && other?.targetId === entity.id) {
      if (until > 0 && world.tick >= until && other.task === 'socialize' && other.villageId === c.villageId
        && c.conversation?.partnerId === target.id && other.conversation?.partnerId === entity.id
        && available(world, entity) && available(world, target) && distance(entity, target) <= conversationReach(entity, target)
        && (c.conversation?.contact ?? 0) >= 3 && (other.conversation?.contact ?? 0) >= 3) {
        learnConversation(world, entity, target);
        recordHappiness(world, entity, 'conversation', target); recordHappiness(world, target, 'conversation', entity);
        applyStatus(world, entity, 'social-recovery'); applyStatus(world, target, 'social-recovery');
      }
      stopSocializing(target);
    }
    stopSocializing(entity); return false;
  }
  if (distance(entity, target) <= conversationReach(entity, target)) {
    c.path = [];
    const p = entity.components.position!, q = target.components.position!;
    if (entity.components.person?.animation) entity.components.person.animation.heading = Math.atan2(q.y - p.y, q.x - p.x);
  } else if (c.reconsiderIn <= 0 || !c.path.length) {
    const path = distance(entity, target) <= conversationReach(entity, target) ? [] : findPath(world, entity.components.position!, target.components.position!, conversationReach(entity, target) - 0.4, (_from, to) => !unsafe(world, to));
    if (path === undefined) { stopSocializing(entity); stopSocializing(target); return false; }
    c.path = path; c.reconsiderIn = 2;
  }
  return true;
}

/** Short meetings leave time for food and work; isolated arrivals seek one another out. */
export function assignSocializing(world: World, entity: Entity): boolean {
  if (!canSpeak(entity) || hasTrait(entity,'mute')) return false;
  const c = entity.components.citizen!, state = c.integration;
  if (!state || state.status === 'settled' || world.tick < state.socialAfter || !available(world, entity)) return false;
  state.socialAfter = world.tick + 600;
  const seekPeers = state.status === 'isolated' && Math.floor((world.tick - state.arrived) / 600) % 2 === 1;
  const candidates = [...world.query('person', 'citizen', 'position')].filter(other => {
    const oc = other.components.citizen!;
    if (hasTrait(other,'mute') || other.id === entity.id || oc.villageId !== c.villageId || oc.task === 'socialize' || !available(world, other)) return false;
    return seekPeers
      ? oc.integration?.status === 'isolated' || oc.integration?.groupId === state.groupId
      : !oc.integration || oc.integration.status === 'settled';
  }).sort((a, b) => Number(b.id === state.friendId) - Number(a.id === state.friendId)
    || expressive(b) - expressive(a)
    || distance(entity, a) - distance(entity, b));
  // A rejected household can try its neighbors again after circumstances improve.
  if (!candidates.length && seekPeers) candidates.push(...[...world.query('person', 'citizen', 'position')]
    .filter(other => other.id !== entity.id && other.components.citizen!.villageId === c.villageId
      && !other.components.citizen!.integration && available(world, other) && other.components.citizen!.task !== 'socialize'));
  for (const target of candidates) {
    if (distance(entity, target) > 14) continue;
    const path = distance(entity, target) <= conversationReach(entity, target) ? [] : findPath(world, entity.components.position!, target.components.position!, conversationReach(entity, target) - 0.4, (_from, to) => !unsafe(world, to));
    if (path === undefined) continue;
    state.socialUntil = world.tick + 360;
    c.conversation = { partnerId: target.id, startedAt: world.tick, contact: 0 };
    target.components.citizen!.conversation = { partnerId: entity.id, startedAt: world.tick, contact: 0 };
    Object.assign(c, { task: 'socialize', targetId: target.id, path, reconsiderIn: 2, repair: null });
    Object.assign(target.components.citizen!, { task: 'socialize', targetId: entity.id, path: [], reconsiderIn: 2, repair: null });
    return true;
  }
  return false;
}

export function integration(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  const people = [...world.query('person', 'citizen', 'position')];
  for (const entity of people) {
    const c = entity.components.citizen!, state = c.integration;
    const conversation = c.conversation, partner = world.entities.get(conversation?.partnerId ?? -1);
    if (conversation) {
      if (!partner || c.task !== 'socialize' || c.targetId !== partner.id || partner.components.citizen?.targetId !== entity.id
        || partner.components.citizen.task !== 'socialize' || !available(world, entity) || !available(world, partner)) delete c.conversation;
      else if (distance(entity, partner) <= conversationReach(entity, partner)) conversation.contact = Math.min(12, conversation.contact + 1);
    }
    if (!state) continue;
    const village = villageOf(world, c.villageId);
    if (!village || state.villageId !== village.id) { delete c.integration; continue; }
    for (const key of ['friendId', 'contactId'] as const) {
      const other = world.entities.get(state[key] ?? -1)?.components.citizen;
      if (!other || other.villageId !== village.id || other.task === 'migrate') {
        state[key] = null;
        if (key === 'contactId') state.contact = 0;
      }
    }
    if (entity.components.person!.madness || state.status === 'settled' || c.task === 'migrate' || c.emergency || aboardFerry(world, entity.id)
      || entity.components.thermal?.burning || !world.terrain.isLand(entity.components.position!.x, entity.components.position!.y)) continue;
    const residents = people.filter(e => e.components.citizen!.villageId === village.id && e.components.citizen!.task !== 'migrate');
    const home = world.entities.get(entity.components.person!.homeId ?? -1);
    const housed = home?.components.dwelling?.villageId === village.id && !home.components.building?.project && !home.components.thermal?.burning;
    const fed = village.food >= residents.length * 0.5 && c.hunger < 65;
    state.belonging = Math.max(0, Math.min(100, state.belonging + (housed ? 0.3 : -0.8) + (fed ? 0.3 : -1) + (state.friendId !== null ? 0.3 : 0)));
    const target = world.entities.get(c.targetId ?? -1), other = target?.components.citizen;
    if (c.task === 'socialize' && target && other?.task === 'socialize' && other.targetId === entity.id
      && other.villageId === village.id && available(world, entity) && available(world, target) && distance(entity, target) <= conversationReach(entity, target)
      && world.tick < Math.max(state.socialUntil, other.integration?.socialUntil ?? 0)) {
      if (!other.integration || other.integration.status === 'settled') {
        const welcomed = fed && (village.government?.trust ?? 60) >= 30;
        if (welcomed) {
          if (state.contactId !== target.id) { state.contactId = target.id; state.contact = 0; }
          state.contact = Math.min(10, state.contact + 1);
          if (state.contact >= friendshipContactRequired(world, entity, target) && state.friendId !== target.id && befriend(world, entity, target)) {
            state.friendId = target.id; state.belonging = Math.min(100, state.belonging + 20);
            world.announce(`${village.name}: ${unitName(entity)} befriended ${unitName(target)}`);
          }
        } else state.belonging = Math.max(0, state.belonging - 2);
      }
    }
    const hasNeighbors = residents.some(e => e.components.citizen!.integration?.groupId !== state.groupId);
    const hasTies = state.friendId !== null || !hasNeighbors;
    const hasWork = !isAdult(entity) || state.worked;
    if (world.tick - state.arrived >= 900 && state.belonging >= 65 && housed && fed && hasTies && hasWork) {
      state.status = 'settled';
      world.announce(`${village.name}: ${residentName(entity.id, world)} settled into the community`);
    } else if (state.status !== 'isolated' && world.tick - state.arrived >= 1800
      && (state.belonging <= 25 || world.tick - state.arrived >= 3600 && (!hasTies || !hasWork))) {
      state.status = 'isolated';
      world.announce(`${village.name}: ${residentName(entity.id, world)} feels unwelcome`);
    } else if (state.status === 'isolated' && state.belonging >= 50 && hasTies && hasWork) state.status = 'settling';
  }
}
