import { STATUS_IDS, STATUS_CONFLICTS, isStatusId, statusDefinitions, type StatusId } from '../content/status-effects';
import { newStatuses, STATUS_END_REASONS, statusTier, statusImmunities, HIT_STATUS_IDS } from '../core/status-effects';
import { calculateStats } from '../core/unit-stats';
import { bool, integer, number, record, type RecordValue } from '../core/validation';
import type { Entity, WorldSnapshot } from '../core/types';

export function validStatuses(v: RecordValue): boolean {
  if (!integer(v.nextSerial, 1) || !Array.isArray(v.active) || v.active.length > STATUS_IDS.length
    || !Array.isArray(v.immunities) || v.immunities.some(s => !isStatusId(s)) || new Set(v.immunities).size !== v.immunities.length
    || !Array.isArray(v.history) || v.history.length > 16) return false;
  const ids = new Set(), serials = new Set();
  for (const s of v.active) {
    if (!record(s) || !isStatusId(s.id) || ids.has(s.id) || !integer(s.serial, 1, Number(v.nextSerial) - 1) || serials.has(s.serial)
      || !number(s.startedAt, -3e9, Number.MAX_SAFE_INTEGER) || !Number.isSafeInteger(s.startedAt)
      || s.expiresAt !== null && !integer(s.expiresAt, Math.max(0, Number(s.startedAt) + 1))
      || s.nextTick !== null && !integer(s.nextTick, Math.max(0, Number(s.startedAt)))
      || !record(s.source) || !integer(s.source.id, 0) || typeof s.source.name !== 'string' || !s.source.name.length || s.source.name.length > 160
      || /[\u0000-\u001f\u007f]/u.test(s.source.name) || !bool(s.source.localize)
      || s.targetId !== undefined && !integer(s.targetId, 1)) return false;
    const d = statusDefinitions[s.id];
    if (d.future || !!d.period !== (s.nextTick !== null) || (d.seconds === null) !== (s.expiresAt === null)) return false;
    ids.add(s.id); serials.add(s.serial);
  }
  if (STATUS_CONFLICTS.some(c => ids.has(c.a) && ids.has(c.b))) return false;
  let previous = 0;
  for (const h of v.history) {
    if (!record(h) || !isStatusId(h.id) || !integer(h.serial, 1, Number(v.nextSerial) - 1) || serials.has(h.serial)
      || !integer(h.endedAt, previous) || !STATUS_END_REASONS.includes(h.reason as typeof STATUS_END_REASONS[number])) return false;
    serials.add(h.serial); previous = Number(h.endedAt);
  }
  return v.rejected === undefined || record(v.rejected) && isStatusId(v.rejected.id) && integer(v.rejected.tick)
    && typeof v.rejected.reason === 'string' && v.rejected.reason.length <= 160;
}
export function migrateStatuses(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Invalid status migration');
  const tick = save.tick;
  for (const raw of save.entities) {
    if (!record(raw) || !record(raw.components)) continue;
    const e = raw as unknown as Entity, c = e.components;
    if (!c.unit || !c.health) continue;
    const state = c.statuses = newStatuses();
    const add = (id: StatusId, seconds = statusDefinitions[id].seconds, age = 0, nextTick?: number): void => {
      if (statusTier(e) === 'none' || statusTier(e) === 'basic' && statusDefinitions[id].tier === 'advanced' || statusImmunities(e).includes(id)) return;
      state.active.push({ id, serial: state.nextSerial++, startedAt: tick - Math.round(age * 30),
        expiresAt: seconds === null ? null : tick + Math.max(1, Math.round(seconds * 30)),
        nextTick: statusDefinitions[id].period ? nextTick ?? tick + statusDefinitions[id].period! : null,
        source: { id: e.id, name: c.unit!.customName ?? c.unit!.displayName, localize: false } });
    };
    if (c.thermal?.burning) add('burning');
    if (c.citizen?.pregnancy && c.citizen.fatherId) add('pregnant', c.citizen.pregnancy);
    if (c.person?.plague) add('plague', null, c.person.plague.age, tick + Math.max(1, Math.round((Math.max(0, 2.5 - c.person.plague.age) + c.person.plague.spreadIn) * 30)));
    if (c.person?.madness) add('madness', null, c.person.madness.age);
    for (const [hit, id] of Object.entries(HIT_STATUS_IDS) as [keyof typeof HIT_STATUS_IDS, StatusId][]) {
      const remaining = c.combat?.statuses[hit];
      if (remaining && !state.active.some(s => s.id === id)) add(id, statusDefinitions[id].seconds === null ? null : remaining);
    }
    if (c.combat) c.combat.statuses = {};
    const sleep = c.citizen?.neurons?.sleepingUntil;
    if (sleep && sleep > tick) add('sleeping', (sleep - tick) / 30);
    if (c.citizen?.neurons) delete c.citizen.neurons.sleepingUntil;
    // Resolve legacy overlaps using the same table, with no completion effects.
    for (const conflict of STATUS_CONFLICTS) if (state.active.some(s => s.id === conflict.a) && state.active.some(s => s.id === conflict.b)) {
      state.active = state.active.filter(s => s.id !== conflict.a && s.id !== conflict.b || s.id === conflict.winner);
    }
    if (c.thermal?.burning && !state.active.some(s => s.id === 'burning')) { c.thermal.burning = false; c.thermal.temperature = 0; delete c.thermal.ignition; }
    if (c.person?.plague && !state.active.some(s => s.id === 'plague')) delete c.person.plague;
    if (c.person?.madness && !state.active.some(s => s.id === 'madness')) delete c.person.madness;
    const worn = ((save.equipment as unknown as WorldSnapshot['equipment'])?.items ?? []).filter(i => i.location.kind === 'equipped' && i.location.entityId === e.id);
    const values = calculateStats(e, worn).values;
    c.health.max = values.health; c.health.current = Math.min(c.health.current, values.health);
    if (c.stats) { c.stats.mana = Math.min(c.stats.mana, values.mana); c.stats.stamina = Math.min(c.stats.stamina, values.stamina); }
  }
  return { ...save, version: 54 };
}
export function validStatusesSave(save: WorldSnapshot): boolean {
  const ids = new Set(save.entities.map(e => e.id));
  return save.entities.every(e => {
    const c = e.components, state = c.statuses;
    if (!c.unit || !c.health) return state === undefined;
    if (!state || !validStatuses(state as unknown as RecordValue) || (state.rejected?.tick ?? 0) > save.tick
      || state.history.some(h => h.endedAt > save.tick) || c.combat && Object.keys(c.combat.statuses).length) return false;
    if (state.active.some(s => s.startedAt > save.tick || s.source.id >= save.nextEntityId
      || s.targetId !== undefined && (!ids.has(s.targetId) || s.targetId === e.id)
      || statusTier(e) === 'none' || statusTier(e) === 'basic' && statusDefinitions[s.id].tier === 'advanced'
      || statusImmunities(e).includes(s.id))) return false;
    const pregnant = state.active.find(s => s.id === 'pregnant');
    const managed = c.reproduction?.pending?.form === 'viviparity';
    if (c.citizen && !!pregnant !== !!c.citizen.pregnancy || pregnant && !managed && (!c.citizen?.fatherId || c.person?.sex !== 'a')) return false;
    if (!!state.active.find(s => s.id === 'plague') !== !!c.person?.plague || !!state.active.find(s => s.id === 'madness') !== !!c.person?.madness) return false;
    return !!state.active.find(s => s.id === 'burning') === !!c.thermal?.burning;
  });
}
