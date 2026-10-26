import type { World } from '../core/world';
import type { Entity, Village } from '../core/types';
import { buildingOwner, setBuildingOwner, transferBuilding } from '../core/buildings';
import { cancelJob } from '../core/jobs';
import { destroyStorage, releaseReservation } from '../core/stockpiles';
import { cargoContents, recordLoss } from '../core/resource-ledger';
import { canGovern } from '../core/capabilities';
import { decisionBlock } from '../core/neurons';
import { lawEnabled } from '../core/world-rules';
import { residentName } from '../core/village-life';
import { habitableZone, initializeTerritories, ownsPosition, reservedZone, TERRITORY, territoryOwner, zoneAt, zoneCenter, zoneNeighbours, zoneOwner } from '../core/territory';
import { findPath } from './navigation';
import { cancelMigration } from './migration';
import { endWar } from './diplomacy';
import { cancelCraft } from './crafting';

export const expandingTerritory = (world: World, id: number): boolean => world.society.villages.some(v => v.territory?.expansion?.actorId === id);
function stopExpansion(world: World, village: Village): void {
  const t = village.territory!, c = world.entities.get(t.expansion?.actorId ?? -1)?.components.citizen;
  if (c?.task === 'visit' && c.targetId === null) { c.task = 'idle'; c.path = []; c.reconsiderIn = 0; }
  delete t.expansion;
}
function releaseBuilding(world: World, entity: Entity): void {
  destroyStorage(world, entity.id);
  for (const village of world.society.villages) releaseReservation(village, entity.id);
  setBuildingOwner(entity, null);
  const b = entity.components.building;
  if (b) b.state = b.project ? b.project.paid ? 'construction' : 'planned' : entity.components.ruin ? 'ruined' : 'abandoned';
  for (const worker of world.query('citizen')) if (worker.components.citizen!.jobAssignment?.targetId === entity.id) cancelJob(world, worker, 'Workplace changed owner');
}
function releaseZone(world: World, village: Village, zone: number): void {
  village.territory!.zones = village.territory!.zones.filter(z => z !== zone);
  for (const e of world.query('building', 'position')) if (buildingOwner(e) === village.id && zoneAt(world, e.components.position!) === zone) releaseBuilding(world, e);
}
/** Remove live references together. Historical founder/death records retain their historical identities. */
export function removeVillage(world: World, village: Village): void {
  stopExpansion(world, village);
  for (const order of world.crafting.orders) if (order.villageId === village.id && !order.paid) cancelCraft(world, order, 'recipient');
  for (const group of [...world.society.migrations]) if (group.fromId === village.id || group.toId === village.id) cancelMigration(world, group);
  for (const war of [...world.society.wars]) if (war.attackers.includes(village.id) || war.defenders.includes(village.id)) endWar(world, war, 'Одна из сторон больше не может сражаться');
  for (const entity of world.query('citizen')) {
    const c = entity.components.citizen!;
    if (c.villageId === village.id) { cancelJob(world, entity, 'Workplace changed owner'); c.villageId = null; delete c.profession; delete c.integration; }
    if (c.work?.cargo?.villageId === village.id) { recordLoss(village, cargoContents(c.work.cargo)); c.work.cargo = null; }
    if (c.work?.reservation?.villageId === village.id) delete c.work.reservation;
    if (c.work?.orderId !== undefined && world.crafting.orders.some(o => o.id === c.work!.orderId && o.villageId === village.id)) {
      delete c.work.orderId;
      if (!c.work.cargo) delete c.work;
    }
  }
  for (const e of [...world.query('position')]) {
    if (buildingOwner(e) === village.id) releaseBuilding(world, e);
    if (e.components.animal?.villageId === village.id) e.components.animal.villageId = null;
    if (e.components.caravan?.fromId === village.id || e.components.caravan?.toId === village.id) world.remove(e.id);
    if (e.components.tree?.claim?.villageId === village.id) e.components.tree.claim = null;
  }
  world.crafting.orders = world.crafting.orders.filter(o => o.villageId !== village.id);
  for (const item of world.equipment.items) if (item.location.kind === 'carried' && item.location.villageId === village.id) {
    const p = world.entities.get(item.location.entityId)?.components.position ?? village;
    item.location = { kind: 'ground', x: p.x, y: p.y }; delete item.claim;
  }
  world.society.relations = world.society.relations.filter(r => r.a !== village.id && r.b !== village.id);
  for (const road of world.society.roads) if (road.a === village.id || road.b === village.id) for (const ferry of road.ferries ?? []) {
    for (const id of ferry.passengers) {
      const c = world.entities.get(id)?.components;
      if (c?.citizen) { c.citizen.path = []; c.citizen.reconsiderIn = 0; }
      if (c?.caravan) { c.caravan.reroute = true; c.caravan.retryIn = 0; }
    }
  }
  world.society.roads = world.society.roads.filter(r => r.a !== village.id && r.b !== village.id);
  world.society.villages = world.society.villages.filter(v => v.id !== village.id);
  world.announce(`${village.name}: the last boundary disappeared`);
}
export function territories(world: World): void {
  if (world.paused || world.tick % 30 !== 0) return;
  initializeTerritories(world);
  for (const village of [...world.society.villages]) {
    const t = village.territory!;
    const residents = [...world.query('citizen', 'person', 'position')].filter(e => e.components.citizen!.villageId === village.id
      && e.components.citizen!.task !== 'migrate' && (e.components.health?.current ?? 1) > 0);
    if (!residents.length) {
      stopExpansion(world, village); t.reason = 'Settlement is empty';
      if (t.abandonedAt === null) { t.abandonedAt = world.tick; t.decayAt = world.tick + TERRITORY.decayTicks; world.announce(`${village.name}: nobody remains; the borders are shrinking`); }
      if (world.tick >= t.decayAt) {
        const zone = [...t.zones].sort((a, b) => {
          const p = zoneCenter(world, a), q = zoneCenter(world, b);
          return Math.hypot(q.x - village.x, q.y - village.y) - Math.hypot(p.x - village.x, p.y - village.y) || b - a;
        })[0];
        if (zone !== undefined) releaseZone(world, village, zone);
        t.decayAt = world.tick + TERRITORY.decayTicks;
        if (!t.zones.length) removeVillage(world, village);
      }
      continue;
    }
    if (t.abandonedAt !== null) { t.abandonedAt = null; t.decayAt = world.tick + TERRITORY.decayTicks; world.announce(`${village.name}: residents returned; the borders are preserved`); }
    // Terrain edits never create land by ownership. At most one lost zone per update.
    const invalid = t.zones.find(z => !habitableZone(world, z));
    if (invalid !== undefined) releaseZone(world, village, invalid);
    const actor = world.entities.get(village.government?.leaderId ?? -1), c = actor?.components.citizen, p = actor?.components.position;
    const reason = !actor || !c || !p || !residents.includes(actor) || !canGovern(world.registry, actor) ? 'No elder elected'
      : !lawEnabled(world, 'kingdom-expansion') ? 'Kingdom expansion is disabled'
        : decisionBlock(world, actor) || c.emergency || actor.components.thermal?.burning || c.hunger >= 65 || !['idle', 'visit', 'socialize'].includes(c.task) || c.work?.cargo ? 'Elder is busy' : undefined;
    if (reason) { stopExpansion(world, village); t.reason = reason; continue; }
    if (t.expansion) {
      const order = t.expansion, destination = zoneCenter(world, order.zone);
      if (order.actorId !== actor!.id || world.tick - order.started > 1800 || zoneOwner(world, order.zone) || reservedZone(world, order.zone)
        || !habitableZone(world, order.zone) || !zoneNeighbours(world, order.zone).some(z => t.zones.includes(z))) {
        stopExpansion(world, village); t.expandAt = world.tick + TERRITORY.expansionTicks; continue;
      }
      if (Math.hypot(p!.x - destination.x, p!.y - destination.y) <= 1 && !c!.path.length) {
        t.zones.push(order.zone); t.zones.sort((a, b) => a - b);
        for (const e of world.query('building', 'position')) if (zoneAt(world, e.components.position!) === order.zone) transferBuilding(world, e, village);
        world.announce(`${village.name}: ${residentName(actor!.id, world)} expanded the border`);
        stopExpansion(world, village); t.expandAt = world.tick + TERRITORY.expansionTicks; t.reason = 'Borders can expand';
      } else if (!c!.path.length) {
        const path = findPath(world, p!, destination, 0.8);
        if (!path) { stopExpansion(world, village); t.reason = 'No route to the frontier'; t.expandAt = world.tick + TERRITORY.expansionTicks; }
        else c!.path = path;
      }
      continue;
    }
    if (world.tick < t.expandAt) continue;
    t.expandAt = world.tick + TERRITORY.expansionTicks;
    const frontier = [...new Set(t.zones.flatMap(z => zoneNeighbours(world, z)))].filter(z => !zoneOwner(world, z) && !reservedZone(world, z) && habitableZone(world, z)).sort((a, b) => a - b);
    t.reason = frontier.length ? 'No route to the frontier' : 'No free habitable neighbouring zone';
    for (const zone of frontier) {
      const path = findPath(world, p!, zoneCenter(world, zone), 0.8);
      if (!path) continue;
      cancelJob(world, actor!, 'Ruler duties');
      Object.assign(c!, { task: 'visit', targetId: null, path, repair: null, reconsiderIn: 2 });
      t.expansion = { actorId: actor!.id, zone, started: world.tick }; t.reason = 'Borders can expand'; break;
    }
  }
  // Components follow the zone owner; identity, paid work and stored goods survive a transfer.
  for (const e of world.query('building', 'position')) {
    const owner = territoryOwner(world, e.components.position!), previous = buildingOwner(e);
    if (owner && previous !== owner.id) transferBuilding(world, e, owner);
    else if (!owner && previous !== null && !ownsPosition(world, previous, e.components.position!)) releaseBuilding(world, e);
  }
}
