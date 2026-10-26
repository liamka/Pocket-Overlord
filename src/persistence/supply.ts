import { SUPPLY_REASONS, shipmentSize, type Shipment, type SupplyEntry } from '../core/supply';
import { bundleSize, canConsume, entries, RESIDENT_DIET, isResource, validBundle } from '../core/resources';
import { integer, number, record } from '../core/validation';
import type { WorldSnapshot } from '../core/types';

const good = (value: unknown): boolean => value === 'food' || value === 'equipment' || isResource(value);
const reason = (value: unknown): boolean => SUPPLY_REASONS.some(r => r === value);
export function validShipment(value: unknown): value is Shipment {
  if (!record(value) || !integer(value.fromId, 1) || !integer(value.toId, 1) || value.fromId === value.toId
    || !integer(value.sourceId, 1) || !integer(value.destinationId, 1) || !good(value.good)
    || !validBundle(value.goods, 24) || value.goods.stoneAxes || bundleSize(value.goods) > 24
    || !Array.isArray(value.itemIds) || value.itemIds.length > 1 || !value.itemIds.every(id => integer(id, 1))
    || !integer(value.amount, 1, 24) || !number(value.delivered, 0, 24) || !number(value.returned, 0, 24) || !number(value.lost, 0, 24)
    || !integer(value.started) || !['outbound', 'returning', 'complete'].includes(String(value.phase)) || !reason(value.reason)
    || !Array.isArray(value.journal) || !value.journal.length || value.journal.length > 16) return false;
  let tick = value.started;
  for (const event of value.journal) { if (!record(event) || !integer(event.tick, tick) || !reason(event.reason)) return false; tick = event.tick; }
  const s = value as unknown as Shipment;
  if (entries(s.goods).some(([id]) => s.good === 'food' ? !canConsume(id, RESIDENT_DIET) : id !== s.good)
    || s.itemIds.length && s.good !== 'equipment' && s.good !== 'stoneAxes') return false;
  return Math.abs(shipmentSize(s) + s.delivered + s.returned + s.lost - s.amount) < 1e-8
    && (s.phase !== 'complete' || shipmentSize(s) < 1e-8) && s.journal.at(-1)!.reason === s.reason;
}
export function validSupplyEntry(value: unknown): value is SupplyEntry {
  return record(value) && integer(value.carrierId, 1) && integer(value.fromId, 1) && integer(value.toId, 1) && value.fromId !== value.toId
    && good(value.good) && integer(value.amount, 1, 24) && number(value.delivered, 0, 24) && number(value.returned, 0, 24) && number(value.lost, 0, 24)
    && Number(value.delivered) + Number(value.returned) + Number(value.lost) <= value.amount + 1e-8
    && integer(value.started) && integer(value.tick, value.started) && number(value.x) && number(value.y) && reason(value.reason);
}
export function validSupplySave(save: WorldSnapshot): boolean {
  if (!save.equipment) return false;
  const entities = new Map(save.entities.map(e => [e.id, e]));
  const origins = new Set<number>(), itemIds = new Set<number>();
  for (const e of save.entities) {
    const s = e.components.shipment;
    if (!s) continue;
    if (!validShipment(s) || !e.components.caravan && e.components.ship?.kind !== 'trade' || origins.has(s.fromId)
      || s.fromId >= save.society.nextVillageId || s.toId >= save.society.nextVillageId
      || s.sourceId >= save.nextEntityId || s.destinationId >= save.nextEntityId || s.journal.some(j => j.tick > save.tick)) return false;
    origins.add(s.fromId);
    const c = e.components.caravan, ship = e.components.ship;
    if (!!c === !!ship) return false;
    if (c && (c.fromId !== s.fromId || c.toId !== null && c.toId !== s.toId)) return false;
    if (ship && (ship.cargoOwnerId !== s.fromId || ship.goldVoyage && (ship.goldVoyage.fromId !== s.fromId || ship.goldVoyage.toId !== s.toId))) return false;
    // Both legacy summaries must be exact copies, never independent stock.
    const packed = c?.foodGoods ?? ship?.foodGoods ?? {};
    if (entries(packed).some(([id, n]) => n !== (s.goods[id] ?? 0)) || Math.abs(bundleSize(packed) - (c?.food ?? ship?.cargo ?? 0)) > 1e-8
      || c && (c.gems ?? 0) !== (s.goods.gems ?? 0)) return false;
    if (entries(s.goods).some(([id, n]) => canConsume(id, RESIDENT_DIET) && (packed[id] ?? 0) !== n)) return false;
    for (const id of s.itemIds) {
      const item = save.equipment.items.find(i => i.id === id), l = item?.location;
      if (itemIds.has(id) || !l || l.kind !== 'carried' || l.entityId !== e.id || l.villageId !== s.fromId) return false;
      itemIds.add(id);
    }
  }
  for (const item of save.equipment.items) if (item.location.kind === 'carried' && entities.get(item.location.entityId)?.components.shipment && !itemIds.has(item.id)) return false;
  for (const v of save.society.villages) {
    const history = v.economy?.supplyHistory;
    if (history === undefined) continue;
    if (!Array.isArray(history) || history.length > 16) return false;
    let last = 0;
    for (const row of history) {
      if (!validSupplyEntry(row) || row.tick > save.tick || row.tick < last || row.fromId !== v.id && row.toId !== v.id
        || row.carrierId >= save.nextEntityId || row.fromId >= save.society.nextVillageId || row.toId >= save.society.nextVillageId
        || row.x < 0 || row.y < 0 || row.x >= save.terrain.width || row.y >= save.terrain.height) return false;
      last = row.tick;
    }
  }
  return true;
}
