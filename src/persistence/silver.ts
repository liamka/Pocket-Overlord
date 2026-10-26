import { SILVER } from '../core/silver';
import { record, type RecordValue } from '../core/validation';

/** No deposits, stock or experience are granted to existing worlds. */
export function migrateSilver(save: RecordValue): RecordValue {
  if (!record(save.society) || !Array.isArray(save.society.villages) || !Array.isArray(save.entities)) throw new Error('Invalid legacy silver economy');
  const release = new Set<number>();
  if (record(save.crafting) && Array.isArray(save.crafting.orders)) for (const o of save.crafting.orders) {
    if (!record(o) || typeof o.recipe !== 'string' || !o.recipe.startsWith('silver-') || o.paid || !['waiting', 'working'].includes(String(o.state))) continue;
    const village = save.society.villages.find(v => record(v) && v.id === o.villageId);
    if (record(village) && record(village.economy) && Number(village.economy.metalworking ?? 0) >= SILVER.requires) continue;
    o.state = 'cancelled'; o.reason = 'knowledge';
    const worker = save.entities.find(e => record(e) && e.id === o.workerId);
    if (record(worker) && record(worker.components) && record(worker.components.citizen)) {
      const c = worker.components.citizen;
      if (record(c.work) && c.work.orderId === o.id) {
        release.add(Number(worker.id)); delete c.work;
        if (c.task === 'work') { c.task = 'idle'; c.targetId = null; c.path = []; }
      }
    }
  }
  for (const v of save.society.villages) {
    if (!record(v) || !record(v.economy)) continue;
    const e = v.economy;
    if (record(e.stocks) && e.stocks.silver === undefined) e.stocks.silver = Array.isArray(e.storage)
      ? e.storage.reduce((sum: number, store: unknown) => sum + (record(store) && record(store.goods) ? Number(store.goods.silver ?? 0) : 0), 0) : 0;
    if (Array.isArray(e.storage)) for (const store of e.storage) if (record(store) && Array.isArray(store.reservations))
      store.reservations = store.reservations.filter(r => !record(r) || !release.has(Number(r.claimant)));
  }
  return { ...save, version: 42 };
}
