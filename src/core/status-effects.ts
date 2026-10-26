import { hasPhysiology, needsFood } from './physiology';
import { lawEnabled } from './world-rules';
import { cancelReproduction, pendingStatus } from './reproduction';
import { traitBlocks, hasTrait, removeTrait } from './traits';
import { STATUS_IDS } from '../content/status-effects';
import { STATUS_CONFLICTS, statusDefinitions, type StatusId } from '../content/status-effects';
import { applyEvent } from '../systems/effects';
import { hasCapability, touchesGround } from './capabilities';
import { canMove } from './creatures';
import { aboardFerry } from './ferries';
import { liftedIds } from './cataclysms';
import { cancelBehaviour } from './behaviour';
import { recordHappiness, happinessSource, syncHappiness, type HappinessSource } from './happiness';
import { reconcileStats, hungerPercent } from './unit-stats';
import type { Entity } from './types';
import type { World } from './world';

export const STATUS_END_REASONS = ['expired', 'cured', 'death', 'removed', 'conflict', 'water', 'damage', 'replaced', 'target-lost', 'condition-ended'] as const;
export type StatusEndReason = typeof STATUS_END_REASONS[number];
export interface StatusInstance {
  id: StatusId; serial: number; startedAt: number; expiresAt: number | null; nextTick: number | null;
  source: HappinessSource; targetId?: number;
}
export interface StatusState {
  nextSerial: number; active: StatusInstance[]; immunities: StatusId[];
  history: { id: StatusId; serial: number; endedAt: number; reason: StatusEndReason }[];
  rejected?: { id: StatusId; tick: number; reason: string };
}
export const newStatuses = (): StatusState => ({ nextSerial: 1, active: [], immunities: [], history: [] });
export const statusOf = (e: Entity, id: StatusId): StatusInstance | undefined => e.components.statuses?.active.find(s => s.id === id);
export const hasStatus = (e: Entity, id: StatusId): boolean => !!statusOf(e, id);
export const statusTier = (e: Entity): 'none' | 'basic' | 'advanced' => e.components.kaiju ? 'none'
  : e.components.dragon || e.components.ufo || e.components.ship ? 'basic' : 'advanced';
export const statusStops = (e: Entity): boolean => e.components.statuses?.active.some(s => !!statusDefinitions[s.id].stops) ?? false;
export const statusBlocks = (e: Entity, action: string): boolean => e.components.statuses?.active.some(s => statusDefinitions[s.id].blocks?.includes(action)) ?? false;
export const HIT_STATUS_IDS = { fire: 'burning', ice: 'frozen', stun: 'stunned', slow: 'slowness', madness: 'madness' } as const;
const hitStatusEntries = Object.entries(HIT_STATUS_IDS) as [keyof typeof HIT_STATUS_IDS, StatusId][];
export function statusImmunities(e: Entity): StatusId[] {
  return [...new Set([...STATUS_IDS.filter(id => immuneToStatus(e,id)), ...(e.components.statuses?.immunities ?? []), ...(e.components.combat?.immunities ?? []).map(s => HIT_STATUS_IDS[s])])];
}
/** Simulation asks about one effect; the full catalogue is only needed by the inspector. */
export function immuneToStatus(e: Entity, id: StatusId): boolean {
  return id === 'frozen' && hasPhysiology(e, 'cold-resistance') || id === 'burning' && hasPhysiology(e, 'heat-resistance')
    || id === 'drowning' && (hasPhysiology(e, 'aquatic') || hasPhysiology(e, 'hovering')) || id === 'starving' && !needsFood(e) || traitBlocks(e, id) || !!e.components.statuses?.immunities.includes(id)
    || !!e.components.combat?.immunities.some(hit => HIT_STATUS_IDS[hit] === id);
}
export function statusRejection(e: Entity, id: StatusId): string | undefined {
  if (!e.components.unit || !e.components.health || e.components.health.current <= 0) return 'No living recipient';
  if (statusTier(e) === 'none') return 'This creature cannot receive statuses';
  if (statusTier(e) === 'basic' && statusDefinitions[id].tier === 'advanced') return 'This creature supports only basic statuses';
  if (immuneToStatus(e, id)) return 'Immune to this status';
  if (id === 'swearing' && hasTrait(e, 'mute')) return 'Immune to this status';
  if (statusDefinitions[id].future) return statusDefinitions[id].future;
  if ((id === 'plague' || id === 'madness') && !e.components.person) return 'This status requires a resident';
  if (id === 'pregnant' && e.components.reproduction?.pending?.form !== 'viviparity') return 'Pregnancy requires a confirmed parent';
  if (id === 'egg' && !e.components.reproduction?.egg || id === 'budding' && e.components.reproduction?.pending?.method !== 'budding'
    || id === 'taking-roots' && e.components.reproduction?.pending?.method !== 'vegetative') return 'Cause no longer present';
  if (id === 'burning' && (!e.components.thermal || !e.components.combustible || e.components.combustible.fuel <= 0 || e.components.thermal.wetness >= 0.25)) return 'Too wet or without fuel';
}
export interface ApplyStatusOptions { seconds?: number; source?: Entity; sourceName?: string; targetId?: number; legacy?: boolean }
/** Legacy adoption has no entry effects, no RNG and no reward. */
export function applyStatus(world: World, e: Entity, id: StatusId, options: ApplyStatusOptions = {}): boolean {
  if (world.entities.get(e.id) !== e || world.paused && !options.legacy) return false;
  const state = e.components.statuses;
  if (!state) return false;
  let reason = statusRejection(e, id);
  if (id === 'surprised' && !hasCapability(world.registry, e, 'amygdala')) reason = 'This creature cannot be surprised';
  if (options.targetId !== undefined && (!world.entities.has(options.targetId) || options.targetId === e.id)) reason = 'Target is no longer available';
  if (id === 'fell-in-love' && options.targetId === undefined) reason = 'Target is no longer available';
  if (id === 'pregnant' && e.components.reproduction?.pending?.form !== 'viviparity' && !world.entities.has(e.components.citizen?.fatherId ?? -1)
    && !world.unitHistory.some(m => m.id === e.components.citizen?.fatherId)) reason = 'Pregnancy requires a confirmed parent';
  if (id === 'starving' && hungerPercent(e) < (e.components.animal ? 95 : 90)) reason = 'Cause no longer present';
  if (options.seconds !== undefined && (!Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > 1e8)) return false;
  if (reason) { state.rejected = { id, tick: world.tick, reason }; return false; }
  const conflicts = STATUS_CONFLICTS.filter(c => (c.a === id && hasStatus(e, c.b)) || (c.b === id && hasStatus(e, c.a)));
  const blocked = conflicts.find(c => c.winner !== id && c.winner !== null);
  if (blocked) { state.rejected = { id, tick: world.tick, reason: 'Blocked by an incompatible status' }; return false; }
  for (const conflict of conflicts) removeStatus(world, e, conflict.a === id ? conflict.b : conflict.a, 'conflict');
  if (conflicts.some(c => c.winner === null)) { extinguishProjection(e); return false; }
  const definition = statusDefinitions[id], seconds = definition.seconds === null ? null : options.seconds ?? definition.seconds;
  if (state.rejected?.id === id) delete state.rejected;
  const expiresAt = seconds === null ? null : world.tick + Math.max(1, Math.round(seconds * 30));
  const old = statusOf(e, id);
  if (old && definition.reapply === 'ignore') return true;
  if (old && definition.reapply === 'refresh') {
    // Preserve the next pulse, source and serial. Refreshing cannot repeat onEnter or delay damage indefinitely.
    old.expiresAt = expiresAt === null ? null : Math.max(old.expiresAt ?? expiresAt, expiresAt);
    return true;
  }
  if (old) removeStatus(world, e, id, 'replaced');
  const instance: StatusInstance = { id, serial: state.nextSerial++, startedAt: world.tick, expiresAt,
    nextTick: definition.period ? world.tick + definition.period : null,
    source: options.sourceName ? { id: 0, name: options.sourceName, localize: true } : happinessSource(world, options.source ?? e),
    ...(options.targetId !== undefined ? { targetId: options.targetId } : {}) };
  state.active.push(instance);
  if (id === 'pregnant' && e.components.citizen) {
    e.components.citizen.pregnancy = Math.min(8, Math.max(0.01, seconds ?? 45));
    const parents = e.components.reproduction?.pending?.parents;
    if (parents) e.components.citizen.fatherId = parents.find(id => id !== e.id) ?? e.id;
  }
  if (id === 'burning') e.components.thermal!.burning = true;
  if (id === 'plague') e.components.person!.plague ??= { age: 0, spreadIn: 0.8 };
  if (id === 'plague') instance.nextTick = world.tick + 99; // Incubation (75) and the first contact interval (24).
  if (id === 'madness') e.components.person!.madness ??= { age: 0 };
  if (!options.legacy) {
    if (definition.stops || id === 'angry' || id === 'tantrum' || id === 'confused' || id === 'suspicious' || id === 'surprised') {
      if (id !== 'sleeping' || e.components.citizen?.behaviour?.taskId !== 'wait5') cancelBehaviour(world, e);
      if (e.components.motion) { e.components.motion.vx = 0; e.components.motion.vy = 0; }
      if (e.components.citizen) delete e.components.citizen.conversation;
    }
    if (definition.onEnter) recordHappiness(world, e, definition.onEnter, options.source);
    if (id === 'cursed') removeTrait(world, e, 'blessed', 'status');
    if (id === 'starving') syncHappiness(world, e);
    if (id === 'surprised') {
      if (e.components.physiology) e.components.physiology.fleeUntil = world.rng.next() < (hasPhysiology(e, 'cautious-instincts') ? 0.6 : 0.3) ? expiresAt ?? world.tick + 90 : world.tick;
      if (hasStatus(e, 'just-ate')) removeStatus(world, e, 'just-ate', 'condition-ended');
      applyStatus(world, e, 'on-guard');
    }
  }
  reconcileStats(world, e);
  return true;
}
function extinguishProjection(e: Entity): void {
  const t = e.components.thermal;
  if (t) { t.burning = false; delete t.ignition; }
}
/** The instance is removed before callbacks. Reentrant removal or loading never replays an exit. */
export function removeStatus(world: World, e: Entity, id: StatusId, reason: StatusEndReason): boolean {
  const state = e.components.statuses, instance = statusOf(e, id);
  if (!state || !instance) return false;
  if (reason === 'expired' && (instance.expiresAt === null || instance.expiresAt > world.tick)) return false;
  state.active = state.active.filter(s => s !== instance);
  const pending = e.components.reproduction?.pending;
  if (pending && pendingStatus(pending) === id && reason !== 'condition-ended') cancelReproduction(world, e);
  state.history.push({ id, serial: instance.serial, endedAt: world.tick, reason });
  state.history.splice(0, Math.max(0, state.history.length - 16));
  if (id === 'burning') extinguishProjection(e);
  if (id === 'pregnant' && e.components.citizen) { e.components.citizen.pregnancy = 0; e.components.citizen.fatherId = null; }
  if (id === 'plague' && e.components.person) delete e.components.person.plague;
  if (id === 'madness' && e.components.person) delete e.components.person.madness;
  if (['madness', 'angry', 'tantrum'].includes(id) && !e.components.person?.madness && !hasStatus(e, 'angry') && !hasStatus(e, 'tantrum')) {
    const c = e.components.citizen;
    if (c?.task === 'fight') { cancelBehaviour(world, e); c.task = 'idle'; c.targetId = null; c.path = []; c.reconsiderIn = 0; }
  }
  if (id === 'sleeping' && e.components.citizen?.neurons) delete e.components.citizen.neurons.sleepingUntil;
  reconcileStats(world, e);
  if (reason !== 'expired' || world.entities.get(e.id) !== e || (e.components.health?.current ?? 0) <= 0) return true;
  const definition = statusDefinitions[id];
  if (definition.onExit) recordHappiness(world, e, definition.onExit);
  if (id === 'sleeping') {
    const home = world.entities.get(e.components.person?.homeId ?? -1), p = e.components.position, q = home?.components.position;
    if (!home?.components.dwelling || home.components.building?.project || home.components.thermal?.burning || !p || !q || Math.hypot(p.x - q.x, p.y - q.y) >= 2.4) recordHappiness(world, e, 'sleep-outside');
    const roll = Math.floor(world.rng.next() * 23);
    if (roll < 3) applyStatus(world, e, (['good-dream', 'bad-dream', 'nightmare'] as const)[roll]);
  }
  return true;
}
export function clearStatuses(world: World, e: Entity, reason: StatusEndReason): void {
  for (const s of [...(e.components.statuses?.active ?? [])]) removeStatus(world, e, s.id, reason);
}
export function cureStatuses(world: World, e: Entity, dispel = false): void {
  if (world.paused || world.entities.get(e.id) !== e) return;
  for (const s of [...(e.components.statuses?.active ?? [])]) {
    if (dispel ? statusDefinitions[s.id].dispellable : statusDefinitions[s.id].curable) removeStatus(world, e, s.id, 'cured');
  }
}
export function interruptStatuses(world: World, e: Entity): void {
  for (const s of [...(e.components.statuses?.active ?? [])]) if (statusDefinitions[s.id].damageInterrupts) removeStatus(world, e, s.id, 'damage');
  const b = e.components.citizen?.behaviour;
  if (b?.taskId === 'reflection' || b?.taskId === 'wait5' || b?.taskId === 'home_rest') cancelBehaviour(world, e);
}
export function wetStatuses(world: World, e: Entity): void {
  removeStatus(world, e, 'burning', 'water'); removeStatus(world, e, 'angry', 'water');
}
export function releaseStatusTarget(world: World, id: number): void {
  for (const e of world.query('statuses')) for (const s of [...e.components.statuses!.active]) {
    if (s.targetId === id) removeStatus(world, e, s.id, 'target-lost');
  }
}
/** Adopt legacy producers once; their old fields are projections after adoption. */
export function adoptStatuses(world: World, e: Entity): void {
  if (!e.components.statuses) return;
  const c = e.components;
  for (const [hit, id] of hitStatusEntries) {
    const remaining = c.combat?.statuses[hit];
    if (remaining === undefined) continue;
    if (remaining && !hasStatus(e, id)) applyStatus(world, e, id, { seconds: remaining, legacy: true });
    if (c.combat) delete c.combat.statuses[hit];
  }
  if (c.thermal?.burning && !hasStatus(e, 'burning') && !applyStatus(world, e, 'burning', { legacy: true })) extinguishProjection(e);
  if (c.citizen?.pregnancy && !hasStatus(e, 'pregnant')) applyStatus(world, e, 'pregnant', { seconds: c.citizen.pregnancy, legacy: true });
  if (c.person?.plague && !hasStatus(e, 'plague')) {
    const old = { ...c.person.plague };
    if (applyStatus(world, e, 'plague', { legacy: true })) {
      const s = statusOf(e, 'plague')!; s.startedAt = world.tick - Math.round(old.age * 30);
      s.nextTick = world.tick + Math.max(1, Math.round((Math.max(0, 2.5 - old.age) + old.spreadIn) * 30));
    } else delete c.person.plague;
  }
  if (c.person?.madness && !hasStatus(e, 'madness')) {
    const age = c.person.madness.age;
    if (applyStatus(world, e, 'madness', { legacy: true })) statusOf(e, 'madness')!.startedAt = world.tick - Math.round(age * 30);
    else delete c.person.madness;
  }
}
export function statusEffects(world: World): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  for (const e of [...world.query('statuses')].sort((a, b) => a.id - b.id)) {
    if ((e.components.health?.current ?? 0) <= 0) { clearStatuses(world, e, 'death'); continue; }
    adoptStatuses(world, e);
    const c = e.components, p = c.position, eater = c.citizen ?? c.animal;
    const hungry = lawEnabled(world, 'hunger') && needsFood(e) && !!eater && hungerPercent(e) >= (c.animal ? 95 : 90);
    if (hungry && !hasStatus(e, 'starving')) applyStatus(world, e, 'starving');
    if (!hungry) removeStatus(world, e, 'starving', 'condition-ended');
    const drowning = !hasPhysiology(e, 'aquatic') && !!p && !!eater && world.terrain.isOpenWater(p.x, p.y) && !lifted.has(e.id) && !aboardFerry(world, e.id)
      && touchesGround(world.registry, e) && (c.person ? (c.stats?.stamina ?? 0) <= 0 : !canMove(world.registry, e, 'swim'));
    if (drowning && !hasStatus(e, 'drowning')) applyStatus(world, e, 'drowning');
    if (!drowning) removeStatus(world, e, 'drowning', 'condition-ended');
    for (const s of [...c.statuses!.active]) {
      if (!world.entities.has(e.id) || !statusOf(e, s.id)) continue;
      const d = statusDefinitions[s.id];
      if (immuneToStatus(e, s.id)) { removeStatus(world, e, s.id, 'cured'); continue; }
      if (s.targetId !== undefined && !world.entities.has(s.targetId)) { removeStatus(world, e, s.id, 'target-lost'); continue; }
      if (s.id === 'sleeping' && (c.thermal?.burning || c.citizen?.emergency || hungerPercent(e) >= 55)) { removeStatus(world, e, s.id, 'removed'); cancelBehaviour(world, e); continue; }
      if (s.id === 'burning' && (!c.thermal?.burning || c.thermal.wetness >= 0.25 || !c.combustible?.fuel)) { removeStatus(world, e, s.id, 'water'); continue; }
      const pending = c.reproduction?.pending;
      if (pending && pendingStatus(pending) === s.id || s.id === 'egg' && c.reproduction?.egg) {
        if (s.id === 'pregnant' && c.citizen) c.citizen.pregnancy = Math.min(8, Math.max(0.01, ((s.expiresAt ?? world.tick) - world.tick) / 30));
        continue;
      }
      if (s.id === 'pregnant') {
        if (!c.citizen?.fatherId) { removeStatus(world, e, s.id, 'removed'); continue; }
        c.citizen.pregnancy = Math.min(8, Math.max(0.01, ((s.expiresAt ?? world.tick) - world.tick) / 30));
        // The existing birth transaction completes a due pregnancy only after its placement/capacity checks.
        continue;
      }
      if (s.id === 'madness' && c.person?.madness) c.person.madness.age = Math.max(0, (world.tick - s.startedAt) / 30);
      if (s.id === 'plague') continue; // Transmission and damage remain with the disease owner, using this clock.
      if (d.onTick === 'damage' && s.nextTick !== null && d.period && world.tick >= s.nextTick && (s.expiresAt === null || s.nextTick <= s.expiresAt)) {
        s.nextTick = world.tick + d.period; // One pulse per invocation tick; never replay overdue pulses after loading.
        const max = c.health!.max;
        const amount = s.id === 'burning' ? max * 0.1 : s.id === 'poisoned' ? Math.max(1, max * 0.01)
          : s.id === 'ash-fever' ? max * 0.01 : s.id === 'starving' ? max * 0.05 : s.id === 'drowning' ? 1 : 0;
        if (amount) applyEvent(world, { kind: 'damage', target: e.id, amount,
          cause: s.id === 'burning' ? 'fire' : s.id === 'starving' ? 'hunger' : s.id === 'drowning' ? 'drowning' : s.id === 'poisoned' ? 'poison' : 'plague',
          sourceId: s.source.id, sourceName: s.source.name, ...(s.id === 'burning' ? c.thermal?.ignition : {}) });
      }
      if (!world.entities.has(e.id)) break;
      if (s.expiresAt !== null && world.tick >= s.expiresAt) {
        if (s.id === 'starving' && hungry) s.expiresAt = world.tick + 1800;
        else removeStatus(world, e, s.id, 'expired');
      }
    }
  }
}
