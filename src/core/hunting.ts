import type { Entity, Village } from './types';
import type { World } from './world';
import { canBreed, isAdult } from './unit-stats';
import { reproductionProfile } from './reproduction';
import { reproductionSex } from './reproduction-state';
import { compatibleParents } from './subspecies';
import { LEATHER } from './leather';
import { inTransit, stockOf } from './resource-ledger';
import { operational } from './buildings';

const species = (e: Entity): string | undefined => e.components.creature?.speciesId ?? e.components.animal?.kind;
const alive = (e: Entity): boolean => (e.components.health?.current ?? 0) > 0;

/** A connected local herd gives overlapping villages the same deterministic reserve.
 * No second population counter or random choice; movement/death re-evaluates the reserve. */
export function protectedHerd(world: World, target: Entity): Set<number> {
  const herd = new Map<number, Entity>([[target.id, target]]), queue = [target];
  for (const member of queue) for (const other of world.nearby(member.components.position!, LEATHER.herdRadius)) {
    if (herd.has(other.id) || !other.components.animal || !alive(other) || species(other) !== species(target)
      || other.components.animal.villageId !== target.components.animal?.villageId) continue;
    herd.set(other.id, other); queue.push(other);
  }
  const members = [...herd.values()].sort((a, b) => a.id - b.id);
  const protectedIds = new Set(members.filter(e => !isAdult(e) || e.components.reproduction?.pending || e.components.reproduction?.egg).map(e => e.id));
  for (const e of members) for (const id of e.components.reproduction?.pending?.parents ?? []) protectedIds.add(id);
  const adults = members.filter(isAdult);
  const breeders = adults.filter(e => canBreed(e) && (e.components.reproduction?.born ?? 0) < (reproductionProfile(e)?.offspringLimit ?? 0));
  const parents = (e: Entity): readonly number[] => e.components.animal?.parents ?? [];
  let pair: readonly Entity[] | undefined;
  pairs: for (let i = 0; i < breeders.length; i++) for (let j = i + 1; j < breeders.length; j++) {
    const a = breeders[i], b = breeders[j];
    if (compatibleParents(a, b) && !parents(a).includes(b.id) && !parents(b).includes(a.id)
      && reproductionProfile(a)?.methods.some(m => reproductionProfile(b)?.methods.includes(m)
        && (m === 'hermaphroditic' || m === 'sexual' && reproductionSex(a) !== reproductionSex(b)))) {
      pair = [a, b]; break pairs;
    }
  }
  // A reproductive herd without a compatible pair stays intact until it can recover.
  const reserve = pair ?? (adults.some(e => reproductionProfile(e)?.methods.length) ? adults : adults.slice(0, LEATHER.breedingReserve));
  for (const e of reserve) protectedIds.add(e.id);
  return protectedIds;
}
export function huntCandidate(world: World, village: Village, target: Entity): boolean {
  const a = target.components.animal, p = target.components.position;
  return !!a && a.kind !== 'dog' && a.villageId === null && isAdult(target) && alive(target) && !!p
    && !target.components.thermal?.burning && world.terrain.isLand(p.x, p.y)
    && Math.hypot(p.x - village.x, p.y - village.y) <= LEATHER.huntRadius;
}
export function huntable(world: World, village: Village, target: Entity): boolean {
  return huntCandidate(world, village, target) && !protectedHerd(world, target).has(target.id);
}
export function needsLeather(world: World, village: Village): boolean {
  if (![...world.query('workplace')].some(e => e.components.workplace!.villageId === village.id
    && e.components.workplace!.kind === 'workshop' && operational(e) && !e.components.thermal?.burning)) return false;
  const orders = world.crafting.orders.filter(o => o.villageId === village.id && !o.paid && ['waiting', 'working'].includes(o.state));
  const target = Math.max(LEATHER.stockTarget, ...orders.map(o => o.inputs.leather ?? 0));
  return stockOf(village, 'leather') + (inTransit(world, village.id).leather ?? 0) < target;
}
