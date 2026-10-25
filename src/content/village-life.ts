import type { Registry } from './registry';
import type { Animal, Workplace } from '../core/village-life';
import { GOODS } from '../core/village-life';
import { bool, integer, number, point, record, reference, type RecordValue } from '../core/validation';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';

declare module '../core/types' {
  interface ComponentMap { animal: Animal; workplace: Workplace }
}

export function validWork(value: unknown): boolean {
  if (value === undefined) return true;
  return record(value) && GOODS.includes(value.good as typeof GOODS[number]) && number(value.progress, 0, 4)
    && (value.cargo === null || record(value.cargo) && GOODS.includes(value.cargo.good as typeof GOODS[number])
      && number(value.cargo.amount, 0.001, 12) && integer(value.cargo.villageId, 1));
}

export function validIntegration(value: unknown): boolean {
  if (value === undefined) return true;
  return record(value) && integer(value.villageId, 1) && integer(value.groupId, 1) && integer(value.arrived)
    && ['settling', 'settled', 'isolated'].includes(String(value.status)) && number(value.belonging, 0, 100) && bool(value.worked)
    && reference(value.friendId) && reference(value.contactId) && number(value.contact, 0, 6)
    && integer(value.socialAfter) && integer(value.socialUntil) && integer(value.leaveAfter);
}

export function validVillageLife(v: RecordValue): boolean {
  const e = v.economy, g = v.government, livestock = v.livestock;
  return (e === undefined || record(e) && record(e.stocks) && GOODS.every(good => number((e.stocks as RecordValue)[good], 0, 2000)) && integer(e.deliveries) && integer(e.buildAfter))
    && (g === undefined || record(g) && reference(g.leaderId) && number(g.trust, 0, 100) && integer(g.electedAt) && integer(g.electionAt) && integer(g.lastHarvest) && integer(g.elections))
    && (livestock === undefined || record(livestock) && bool(livestock.established) && integer(livestock.threatAfter));
}

export function registerVillageLife(registry: Registry): void {
  registry.registerComponent('animal', a => ['sheep', 'dog', 'wolf'].includes(String(a.kind)) && reference(a.villageId) && reference(a.ownerId)
    && (a.kind !== 'wolf' || a.ownerId === null && a.villageId === null) && number(a.age, 0, 10000) && number(a.hunger, 0, 100)
    && number(a.breedIn, 0, 120) && number(a.produceIn, 0, 30) && number(a.attackIn, 0, 2) && number(a.decisionIn, 0, 2)
    && reference(a.targetId) && Array.isArray(a.path) && a.path.length <= WORLD_WIDTH * WORLD_HEIGHT && a.path.every(point)
    && number(a.heading, -Math.PI, Math.PI) && number(a.stride, 0, Math.PI * 2) && bool(a.moving));
  registry.registerComponent('workplace', w => ['market', 'mill', 'bakery', 'workshop'].includes(String(w.kind)) && reference(w.villageId));
  for (const kind of ['sheep', 'dog', 'wolf'] as const) {
    const health = kind === 'sheep' ? 35 : kind === 'dog' ? 65 : 45;
    registry.registerEntity({ id: `core:${kind}`, sprite: kind, create: p => ({
      position: { ...p }, health: { current: health, max: health }, combustible: { fuel: 12, ignition: 36 },
      thermal: { temperature: 0, wetness: 0, burning: false },
      animal: { kind, villageId: null, ownerId: null, age: 20, hunger: 20, breedIn: 90, produceIn: 25,
        attackIn: 0, decisionIn: 0, targetId: null, path: [], heading: 0, stride: 0, moving: false },
    }) });
  }
  for (const kind of ['market', 'mill', 'bakery', 'workshop'] as const) registry.registerEntity({ id: `core:${kind}`, sprite: kind, create: p => ({
    position: { ...p }, health: { current: 140, max: 140 }, combustible: { fuel: 45, ignition: 38 },
    thermal: { temperature: 0, wetness: 0, burning: false }, solid: { radius: 1.1 }, workplace: { kind, villageId: null },
  }) });
}
