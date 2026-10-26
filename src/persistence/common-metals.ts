import { buildingCost } from '../core/buildings';
import { COMMON_METAL_MATERIALS, isCommonMetalMaterial } from '../core/common-metals';
import { EQUIPMENT } from '../core/equipment-catalog';
import type { Entity } from '../core/types';
import { record, type RecordValue } from '../core/validation';

/** Rename the former catalogue id without seeding deposits or granting workshop experience. */
export function migrateCommonMetals(save: RecordValue): RecordValue {
  const rename = (bundle: unknown): void => {
    if (!record(bundle) || !Object.hasOwn(bundle, 'metal')) return;
    if (Object.hasOwn(bundle, 'commonMetal')) throw new Error('Duplicate common metal stock');
    bundle.commonMetal = bundle.metal; delete bundle.metal;
  };
  if (!Array.isArray(save.entities) || !record(save.society) || !Array.isArray(save.society.villages)) throw new Error('Invalid legacy metal economy');
  const release = new Set<number>();
  for (const entity of save.entities) {
    if (!record(entity) || !record(entity.components)) continue;
    const c = entity.components;
    if (record(c.resourcePile)) rename(c.resourcePile.goods);
    if (record(c.citizen) && record(c.citizen.work)) {
      const work = c.citizen.work;
      if (work.good === 'metal') work.good = 'commonMetal';
      if (record(work.reservation)) rename(work.reservation.inputs);
      if (record(work.cargo)) {
        if (work.cargo.good === 'metal') work.cargo.good = 'commonMetal';
        rename(work.cargo.byproducts);
      }
    }
    if (record(c.building) && record(c.building.project)) {
      const project = c.building.project;
      rename(project.cost);
      if (project.action === 'upgrade' && c.dwelling || c.building.kind === 'core:mill' && project.action === 'build') {
        // Previously paid work stays paid. Unpaid work reserves the entire new estimate.
        project.cost = buildingCost(entity as unknown as Entity, project.action as 'upgrade' | 'build');
        if (!project.paid) { release.add(Number(entity.id)); c.building.state = 'planned'; }
      }
    }
  }
  if (record(save.crafting) && Array.isArray(save.crafting.orders)) for (const order of save.crafting.orders) {
    if (!record(order)) continue;
    rename(order.inputs);
    const material = EQUIPMENT[String(order.recipe)]?.material;
    if (!order.paid && (order.state === 'working' || order.state === 'waiting') && isCommonMetalMaterial(material) && COMMON_METAL_MATERIALS[material].requires > 0) {
      order.state = 'cancelled'; order.reason = 'knowledge';
      const worker = save.entities.find(e => record(e) && e.id === order.workerId);
      if (record(worker) && record(worker.components) && record(worker.components.citizen)) {
        const c = worker.components.citizen;
        if (record(c.work) && c.work.orderId === order.id) {
          release.add(Number(worker.id)); delete c.work;
          if (c.task === 'work') { c.task = 'idle'; c.targetId = null; c.path = []; }
        }
      }
    }
  }
  for (const village of save.society.villages) {
    if (!record(village) || !record(village.economy)) continue;
    const economy = village.economy;
    economy.metalworking = 0;
    rename(economy.stocks); rename(economy.spent); rename(economy.lost);
    if (Array.isArray(economy.storage)) for (const store of economy.storage) {
      if (!record(store)) continue;
      rename(store.goods); rename(store.limits);
      if (Array.isArray(store.reservations)) {
        store.reservations = store.reservations.filter(r => !record(r) || !release.has(Number(r.claimant)));
        for (const r of store.reservations as unknown[]) if (record(r)) rename(r.goods);
      }
    }
  }
  return { ...save, version: 40 };
}
