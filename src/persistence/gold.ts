import { buildingCost, type BuildingAction } from '../core/buildings';
import type { Entity } from '../core/types';
import { record, type RecordValue } from '../core/validation';

/** Existing stores, food, wallets, service and voyages receive no gold. Existing
 * construction keeps its agreed bill, including already consumed materials. */
export function migrateGold(save: RecordValue): RecordValue {
  if (!Array.isArray(save.entities) || !record(save.society) || !Array.isArray(save.society.villages)) throw new Error('Invalid saved gold economy');
  for (const e of save.entities) {
    if (!record(e) || !record(e.components)) continue;
    const b = e.components.building;
    if (record(b) && record(b.project) && record(b.project.cost) && b.project.cost.gold === undefined) {
      const project = b.project;
      if (buildingCost(e as unknown as Entity, project.action as BuildingAction).gold) project.legacyGoldCost = true;
    }
    if (record(e.components.ship)) delete e.components.ship.goldVoyage;
  }
  for (const v of save.society.villages) if (record(v) && record(v.economy) && record(v.economy.stocks)) {
    if (v.economy.stocks.gold === undefined) v.economy.stocks.gold = Array.isArray(v.economy.storage)
      ? v.economy.storage.reduce((sum: number, s: unknown) => sum + (record(s) && record(s.goods) ? Number(s.goods.gold ?? 0) : 0), 0) : 0;
  }
  return { ...save, version: 65 };
}
