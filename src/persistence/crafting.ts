import { isAdult } from '../core/unit-stats';
import { activeOrder, CRAFTING, CRAFT_REASONS, modifierTries, newCrafting, type CraftOrder } from '../core/crafting';
import { EQUIPMENT, EQUIPMENT_SLOTS } from '../core/equipment-catalog';
import { canWorkMetal, isCommonMetalMaterial, metalExperience } from '../core/common-metals';
import { SILVER } from '../core/silver';
import { entries, validBundle, type ResourceBundle } from '../core/resources';
import { bool, integer, number, record, reference, type RecordValue } from '../core/validation';
import type { WorldSnapshot } from '../core/types';
import { GEMS } from '../core/gems';

/** Preserve unfinished legacy axes, paid carried axes and all food jobs exactly once. */
export function migrateCrafting(save: RecordValue): RecordValue {
  const state = newCrafting();
  if (Array.isArray(save.entities)) for (const e of save.entities) {
    if (!record(e) || !record(e.components) || !record(e.components.citizen)) continue;
    const c = e.components.citizen, w = c.work;
    if (c.task !== 'work' || !record(w) || w.good !== 'stoneAxes' || w.cargo !== null || !integer(c.villageId, 1)) continue;
    const order: CraftOrder = { id: state.nextOrderId++, villageId: c.villageId, recipientId: null, homeId: null, slot: 'weapon', recipe: 'stone-axe',
      workplaceId: Number(c.targetId), workerId: Number(e.id), inputs: { ...EQUIPMENT['stone-axe'].recipe.inputs }, coins: null,
      progress: Number(w.progress), paid: false, state: 'working', reason: 'working', seed: (Number(save.rngState) ^ Math.imul(Number(e.id), 2654435761)) >>> 0,
      tries: record(e.components.person) && e.components.person.race === 'dwarf' ? 3 : 1, mastery: false, createdAt: Number(save.tick), resultId: null };
    state.orders.push(order); w.orderId = order.id;
    // A legacy job without a reservation waits for a fresh assignment; it has spent nothing.
    if (!record(w.reservation)) { order.state = 'waiting'; order.workerId = null; order.workplaceId = null; c.task = 'idle'; c.targetId = null; c.path = []; delete c.work; }
  }
  return { ...save, version: 37, crafting: state };
}
const sameBundle = (a: ResourceBundle, b: ResourceBundle): boolean => entries(a).length === entries(b).length && entries(a).every(([id, n]) => n === b[id]);
export function validCraftingSave(save: WorldSnapshot): boolean {
  const state: unknown = save.crafting;
  if (!record(state) || !integer(state.nextOrderId, 1) || !Array.isArray(state.orders) || state.orders.length > 1928) return false;
  const entities = new Map(save.entities.map(e => [e.id, e])), items = new Map(save.equipment!.items.map(i => [i.id, i]));
  const ids = new Set<number>(), workers = new Set<number>(), places = new Set<number>(), demands = new Set<string>(), results = new Set<number>();
  const ref = (id: unknown): boolean => reference(id) && (id === null || Number(id) < save.nextEntityId);
  for (const raw of state.orders) {
    if (!record(raw) || !integer(raw.id, 1, state.nextOrderId - 1) || ids.has(raw.id) || !integer(raw.villageId, 1, save.society.nextVillageId - 1)
      || !ref(raw.recipientId) || !ref(raw.homeId) || !ref(raw.workplaceId) || !ref(raw.workerId)
      || typeof raw.recipe !== 'string' || !Object.hasOwn(EQUIPMENT, raw.recipe) || !EQUIPMENT_SLOTS.includes(raw.slot as never)
      || !validBundle(raw.inputs, 12, false) || !number(raw.progress, 0, CRAFTING.work) || !bool(raw.paid) || !bool(raw.mastery)
      || !['waiting', 'working', 'delivering', 'completed', 'cancelled'].includes(String(raw.state)) || !CRAFT_REASONS.includes(raw.reason as never)
      || !integer(raw.seed, 0, 0xffffffff) || !integer(raw.tries, 1, CRAFTING.maxTries) || !integer(raw.createdAt, 0, save.tick)
      || !reference(raw.resultId)) return false;
    const o = raw as unknown as CraftOrder, d = EQUIPMENT[o.recipe];
    if (o.reservedUntil !== undefined && (!o.inputs.gems || !integer(o.reservedUntil, o.createdAt, save.tick + GEMS.reservationTicks))
      || o.state === 'working' && o.inputs.gems && (o.reservedUntil === undefined || o.reservedUntil <= save.tick)) return false;
    if (d.slot !== o.slot || !sameBundle(o.inputs, d.recipe.inputs) || o.coins !== d.recipe.coins) return false;
    ids.add(o.id);
    if (o.paid !== (o.state === 'delivering' || o.state === 'completed') || o.paid !== (o.resultId !== null)
      || o.paid && (o.progress !== d.recipe.work || o.workerId === null || o.workplaceId === null)) return false;
    if (activeOrder(o)) {
      const village = save.society.villages.find(v => v.id === o.villageId);
      if (!o.paid && d.material === 'silver' && (!village || metalExperience(village) < SILVER.requires)) return false;
      if (!o.paid && isCommonMetalMaterial(d.material) && (!village || !canWorkMetal(village, d.material))) return false;
      // Paid orphaned cargo follows the existing ledger: it stays with its carrier until death.
      if (!o.paid && !save.society.villages.some(v => v.id === o.villageId)) return false;
      if (!o.paid && o.recipientId !== null) {
        const e = entities.get(o.recipientId);
        if (!e?.components.person || !isAdult(e) || e.components.citizen?.villageId !== o.villageId) return false;
      }
      const key = `${o.recipientId}:${o.slot}`;
      if (o.recipientId !== null && demands.has(key)) return false;
      if (o.recipientId !== null) demands.add(key);
    }
    if (o.state === 'waiting' && (o.workerId !== null || o.paid)) return false;
    if (o.state === 'working') {
      const e = entities.get(o.workerId!), c = e?.components.citizen, station = entities.get(o.workplaceId!);
      if (!e?.components.person || !isAdult(e) || !c || c.villageId !== o.villageId || c.task !== 'work' || c.targetId !== o.workplaceId
        || c.work?.orderId !== o.id || c.work.progress !== o.progress || c.work.cargo !== null || c.work.reservation?.villageId !== o.villageId
        || !sameBundle(c.work.reservation.inputs, o.inputs) || station?.components.workplace?.kind !== 'workshop' || station.components.workplace.villageId !== o.villageId
        || o.tries !== modifierTries(e, o.mastery) || workers.has(o.workerId!) || places.has(o.workplaceId!)) return false;
      const held: ResourceBundle = {};
      for (const v of save.society.villages) for (const s of v.economy?.storage ?? []) for (const r of s.reservations) if (r.claimant === o.workerId)
        for (const [id, n] of entries(r.goods)) held[id] = (held[id] ?? 0) + n;
      if (!sameBundle(held, o.inputs)) return false;
      workers.add(o.workerId!); places.add(o.workplaceId!);
    }
    if (o.resultId !== null) {
      if (!integer(o.resultId, 1, save.equipment!.nextItemId - 1) || results.has(o.resultId)) return false;
      results.add(o.resultId);
      const item = items.get(o.resultId);
      if (!item || item.author.id !== o.workerId || item.createdAt < o.createdAt || item.origin?.orderId !== o.id
        || item.origin.villageId !== o.villageId || item.origin.workplaceId !== o.workplaceId || item.origin.recipientId !== o.recipientId) return false;
      if (o.state === 'delivering' && (item.location.kind !== 'carried' || item.location.entityId !== o.workerId || item.location.villageId !== o.villageId)) return false;
    }
  }
  for (const e of save.entities) {
    const w = e.components.citizen?.work;
    if (w?.good === 'stoneAxes' && w.orderId === undefined && e.components.citizen?.task === 'work'
      && entities.get(e.components.citizen.targetId ?? -1)?.components.workplace?.kind === 'workshop') return false;
    if (w?.orderId !== undefined) {
      const o = (state.orders as CraftOrder[]).find(o => o.id === w.orderId);
      if (!o || o.workerId !== e.id || o.state !== 'working' && o.state !== 'delivering' || w.progress !== o.progress) return false;
    }
  }
  const origins = new Set<number>();
  for (const item of items.values()) if (item.origin !== undefined) {
    const p: unknown = item.origin;
    if (!record(p) || p.kind !== 'crafted' || !integer(p.orderId, 1, state.nextOrderId - 1) || !integer(p.villageId, 1, save.society.nextVillageId - 1)
      || !integer(p.workplaceId, 1, save.nextEntityId - 1) || !ref(p.recipientId) || origins.has(p.orderId)) return false;
    const order = (state.orders as CraftOrder[]).find(o => o.id === p.orderId);
    if (order && order.resultId !== item.id) return false;
    origins.add(p.orderId);
  }
  return true;
}
