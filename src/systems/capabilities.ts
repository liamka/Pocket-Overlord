import { canGovern } from '../core/capabilities';
import { cancelBehaviour } from '../core/behaviour';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { residentName } from '../core/village-life';
import { releaseReservation } from '../core/stockpiles';
import { releaseItemClaims } from '../core/equipment';
import { releaseTreeClaim } from '../core/forestry';
import { releaseDepositClaim } from '../core/deposits';
import { cancelCraft } from './crafting';

/** No replacement election or RNG here: the existing government owns elections. */
export function reconcileOffices(world: World): void {
  for (const village of world.society.villages) {
    const office = village.government;
    if (office?.leaderId == null) continue;
    const leader = world.entities.get(office.leaderId);
    if (leader && leader.components.citizen?.villageId === village.id && canGovern(world.registry, leader)) continue;
    office.leaderId = null;
    if (leader) world.announce(`${residentName(leader.id, world)} can no longer lead ${village.name}`);
  }
}
/** Release unfinished commitments together, retaining carried goods and personal identity. */
export function suspendCivilDuties(world: World, entity: Entity): void {
  cancelBehaviour(world, entity);
  for (const order of world.crafting.orders) if (order.workerId === entity.id) cancelCraft(world, order, 'unsafe');
  for (const village of world.society.villages) releaseReservation(village, entity.id);
  releaseItemClaims(world, entity.id); releaseTreeClaim(world, entity.id); releaseDepositClaim(world, entity.id);
  reconcileOffices(world);
}
