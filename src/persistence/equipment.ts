import { isAdult } from '../core/unit-stats';
import { EQUIPMENT, HIT_STATUSES, PROJECTILES, validModifiers, wornOutLeather } from '../core/equipment-catalog';
import { newEquipment, type EquipmentItem, type EquipmentState, type ItemLocation } from '../core/equipment';
import { bool, integer, number, record, reference, type RecordValue } from '../core/validation';
import type { WorldSnapshot } from '../core/types';
import { storageOwner } from '../core/stockpiles';

export function migrateEquipment(save: RecordValue): RecordValue {
  const state = newEquipment(), tick = Number(save.tick);
  const add = (location: ItemLocation): EquipmentItem => {
    const item: EquipmentItem = { id: state.nextItemId++, definition: 'stone-axe', modifiers: {}, durability: 100, maxDurability: 100,
      author: { id: null, name: '' }, createdAt: tick, name: '', favorite: false, playerMarked: false, location,
      history: [{ tick, reason: 'legacy', location: { ...location } }] };
    state.items.push(item); return item;
  };
  const count = (n: unknown): number => {
    if (!integer(n ?? 0, 0, 2000)) throw new Error('Invalid legacy equipment stock'); return Number(n ?? 0);
  };
  if (!Array.isArray(save.entities) || !record(save.society) || !Array.isArray(save.society.villages)) return { ...save, version: 36, equipment: state };
  for (const v of save.society.villages) if (record(v) && record(v.economy) && Array.isArray(v.economy.storage)) {
    for (const s of v.economy.storage) if (record(s) && record(s.goods)) {
      for (let n = count(s.goods.stoneAxes); n > 0; n--) add({ kind: 'stored', buildingId: Number(s.buildingId) });
      s.equipmentVolume = 0;
      if (Array.isArray(s.reservations)) s.reservations = s.reservations.filter(r => !record(r) || !record(r.goods) || !r.goods.stoneAxes);
    }
  }
  for (const entity of save.entities) if (record(entity) && record(entity.components) && record(entity.components.citizen)) {
    const c = entity.components.citizen, id = Number(entity.id);
    if (c.weapon === 'stone-axe') add({ kind: 'equipped', entityId: id });
    if (record(c.work) && record(c.work.cargo)) {
      const cargo = c.work.cargo;
      const axes = cargo.good === 'stoneAxes' ? cargo.amount : record(cargo.byproducts) ? cargo.byproducts.stoneAxes : 0;
      for (let n = count(axes); n > 0; n--) add({ kind: 'carried', entityId: id, villageId: Number(cargo.villageId) });
    }
    if (c.task === 'equip' && !c.weapon) {
      const item = state.items.find(i => i.location.kind === 'stored' && i.location.buildingId === c.targetId && i.claim === undefined);
      if (item) item.claim = id;
      else { c.task = 'idle'; c.targetId = null; c.path = []; }
    }
  }
  return { ...save, version: 36, equipment: state };
}

/** Cross-reference checks complement component validation: no duplicate slot, claim or scalar mirror. */
export function validEquipmentSave(save: WorldSnapshot): boolean {
  const state: unknown = save.equipment;
  if (!record(state) || !integer(state.nextItemId, 1) || !integer(state.nextShotId, 1) || !Array.isArray(state.items) || state.items.length > 1e6
    || !Array.isArray(state.shots) || state.shots.length > 512) return false;
  const entities = new Map(save.entities.map(e => [e.id, e])), items = new Set<number>(), slots = new Set<string>(), claims = new Set<number>();
  const stores = new Map(save.society.villages.flatMap(v => (v.economy?.storage ?? []).map(s => [s.buildingId, s] as const)));
  const inBounds = (p: RecordValue): boolean => number(p.x, 0, save.terrain.width - Number.EPSILON) && number(p.y, 0, save.terrain.height - Number.EPSILON)
    && p.x < save.terrain.width && p.y < save.terrain.height;
  const validLocation = (v: unknown, historical = false): v is ItemLocation => {
    if (!record(v)) return false;
    if (v.kind === 'ground') return inBounds(v) && Object.keys(v).length === 3;
    if (v.kind === 'stored') return integer(v.buildingId, 1, save.nextEntityId - 1) && Object.keys(v).length === 2 && (historical || stores.has(v.buildingId));
    return (v.kind === 'equipped' || v.kind === 'carried') && integer(v.entityId, 1, save.nextEntityId - 1)
      && Object.keys(v).length === (v.kind === 'carried' ? 3 : 2) && (v.kind !== 'carried' || integer(v.villageId, 1, save.society.nextVillageId - 1))
      && (historical || !!entities.get(v.entityId)?.components.person && !!entities.get(v.entityId)?.components.citizen
        || v.kind === 'carried' && !!entities.get(v.entityId)?.components.shipment);
  };
  const reasons = ['created', 'loaded', 'legacy', 'equipped', 'delivered', 'replaced', 'gift', 'death', 'collapse', 'reforged', 'transmuted', 'transformed'];
  for (const item of state.items) {
    if (!record(item) || !integer(item.id, 1, state.nextItemId - 1) || items.has(item.id) || typeof item.definition !== 'string' || !Object.hasOwn(EQUIPMENT, item.definition)) return false;
    const d = EQUIPMENT[item.definition];
    if (!validModifiers(item.modifiers, d.slot) || !number(item.maxDurability, 1, 10000) || !number(item.durability, 0, item.maxDurability)
      || !integer(item.createdAt, 0, save.tick) || !record(item.author) || !reference(item.author.id) || item.author.id !== null && Number(item.author.id) >= save.nextEntityId
      || typeof item.author.name !== 'string' || item.author.name.length > 100 || typeof item.name !== 'string' || item.name.length > 100
      || !bool(item.favorite) || !bool(item.playerMarked) || (!!item.modifiers.player !== item.playerMarked) || !validLocation(item.location)
      || !Array.isArray(item.history) || !item.history.length || item.history.length > 128) return false;
    let previous = item.createdAt;
    for (const h of item.history) {
      if (!record(h) || !integer(h.tick, previous, save.tick) || !reasons.includes(String(h.reason)) || !validLocation(h.location, true)) return false;
      previous = h.tick;
    }
    if (JSON.stringify(item.history.at(-1).location) !== JSON.stringify(item.location)) return false;
    const location = item.location;
    if (location.kind === 'equipped') {
      const key = `${location.entityId}:${d.slot}`;
      if (slots.has(key)) return false; slots.add(key);
      // Older saves may have an armed resident who is now below the adult threshold.
      if (!isAdult(entities.get(location.entityId)!) && item.history[0].reason !== 'legacy') return false;
    }
    if (item.claim !== undefined) {
      if (!integer(item.claim, 1) || claims.has(item.claim)) return false;
      const c = entities.get(item.claim)?.components.citizen;
      if (!c || c.task !== 'equip' || location.kind !== 'ground' && location.kind !== 'stored'
        || location.kind === 'stored' && (c.targetId !== location.buildingId || storageOwner(entities.get(location.buildingId)!) !== c.villageId)) return false;
      claims.add(item.claim);
    }
    items.add(item.id);
  }
  const typed = state as unknown as EquipmentState;
  for (const [buildingId, store] of stores) {
    const stored = typed.items.filter(i => i.location.kind === 'stored' && i.location.buildingId === buildingId);
    const axes = stored.filter(i => i.definition === 'stone-axe').length;
    if ((store.goods.stoneAxes ?? 0) !== axes || (store.equipmentVolume ?? 0) !== stored.length - axes) return false;
    if (stored.some(i => i.definition !== 'stone-axe') && Object.keys(store.limits).length) return false;
  }
  for (const e of entities.values()) {
    const c = e.components.citizen;
    const worn = typed.items.filter(i => i.location.kind === 'equipped' && i.location.entityId === e.id);
    if (c && (c.weapon === 'stone-axe') !== worn.some(i => i.definition === 'stone-axe')) return false;
    const axes = typed.items.filter(i => i.location.kind === 'carried' && i.location.entityId === e.id && i.definition === 'stone-axe');
    const cargo = c?.work?.cargo, count = cargo?.good === 'stoneAxes' ? cargo.amount : cargo?.byproducts?.stoneAxes ?? 0;
    if (!e.components.shipment && (count !== axes.length || axes.some(i => i.location.kind === 'carried' && i.location.villageId !== cargo?.villageId))) return false;
    if (!e.components.stats && e.components.citizen && e.components.combat && e.components.health && e.components.health.max !== e.components.combat.baseHealth + worn.filter(i => !wornOutLeather(i)).reduce((sum, i) => sum + (i.modifiers.health ?? 0) * 5, 0)) return false;
  }
  const shots = new Set<number>();
  const volleys = new Map<number, { sourceId: number; awarded: boolean; count: number }>();
  for (const s of state.shots) {
    if (!record(s) || !integer(s.id, 1, state.nextShotId - 1) || shots.has(s.id) || !integer(s.sourceId, 1, save.nextEntityId - 1)
      || !integer(s.targetId, 1, save.nextEntityId - 1) || !reference(s.villageId) || s.villageId !== null && Number(s.villageId) >= save.society.nextVillageId
      || typeof s.kind !== 'string' || !Object.hasOwn(PROJECTILES, s.kind) || !inBounds(s) || !record(s.destination)
      || !number(s.destination.x, -32, save.terrain.width + 32) || !number(s.destination.y, -32, save.terrain.height + 32)
      || !number(s.damage, 0, 1e6) || !number(s.remaining, 0.000001, 5) || !bool(s.hostile)
      || !Array.isArray(s.statuses) || s.statuses.length > 5 || new Set(s.statuses).size !== s.statuses.length || !s.statuses.every(s => HIT_STATUSES.includes(s))) return false;
    if (s.hunting !== undefined && (s.hunting !== true || s.villageId === null)) return false;
    if (s.experience !== undefined) {
      const x = s.experience;
      if (!record(x) || !integer(x.attackId, 1, s.id) || !bool(x.awarded)) return false;
      const volley = volleys.get(x.attackId);
      if (volley && (volley.sourceId !== s.sourceId || volley.awarded !== x.awarded || ++volley.count > 32)) return false;
      if (!volley) volleys.set(x.attackId, { sourceId: s.sourceId, awarded: x.awarded as boolean, count: 1 });
    }
    shots.add(s.id);
  }
  return true;
}
