import { isAdult } from './unit-stats';
import { recordHappiness } from './happiness';
import type { Entity, Vec2 } from './types';
import type { World } from './world';
import { unitName } from './units';
import { capabilitiesOf } from './capabilities';
import { COLLECTIVE_PROFILES, type CollectiveProfile } from '../content/taxonomy';
import type { Registry } from '../content/registry';

export interface Family {
  id: number; type: 'normal' | 'alpha' | 'parentless'; speciesId: string; subspeciesId: null;
  founders: number[]; members: number[]; originFamilyIds: (number | null)[];
  alphaId: number | null; foundedAt: number; dissolvedAt: number | null; limit: number;
  birthplace: Vec2; settlementName: string | null;
}
export interface FamilyState { nextId: number; records: Family[] }
export const newFamilies = (): FamilyState => ({ nextId: 1, records: [] });
/** Pocket Overlord balance in simulation seconds; not the wiki's cooldowns. */
export const HERD = { check: 5, move: 7, follow: 1, leave: 20, join: 8 } as const;
export const HERD_REASONS = ['Seeking a herd', 'Following the oldest herd member', 'Leading the herd', 'No route to the herd',
  'Left a full herd', 'The last member left the family', 'Staying near the herd', 'Escaping danger', 'Protecting the owner',
  'Seeking safe pasture', 'Grazing safely', 'No safe pasture nearby', 'Defending a herd member', 'No route to the threatened member'] as const;
export interface Kinship {
  familyId: number | null; originFamilyId: number | null; previousFamilyId: number | null;
  herd?: { checkIn: number; moveIn: number; followIn: number; leaveIn: number; joinIn: number;
    followId: number | null; reason: typeof HERD_REASONS[number] };
}
export function initializeKinship(entity: Entity): void {
  if (entity.components.kinship || !entity.components.person && !entity.components.animal) return;
  entity.components.kinship = { familyId: null, originFamilyId: null, previousFamilyId: null,
    ...(entity.components.animal ? { herd: { checkIn: HERD.check, moveIn: 0, followIn: 0, leaveIn: HERD.leave,
      joinIn: 1 + entity.id % HERD.join, followId: null, reason: 'Seeking a herd' as const } } : {}) };
}
export const parentsOf = (entity: Entity): number[] => entity.components.citizen?.parents ?? entity.components.animal?.parents ?? [];
export const familyOf = (world: World, entity: Entity): Family | undefined => world.families.records.find(f => f.id === entity.components.kinship?.familyId && f.dissolvedAt === null);
/** Proximity across a strip of water is not contact, even inside the follow radius. */
export function herdContact(world: World, from: Vec2, to: Vec2, reach = 2): boolean {
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  if (distance > reach) return false;
  const steps = Math.max(1, Math.ceil(distance * 4));
  for (let i = 0; i <= steps; i++) if (!world.terrain.isLand(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps)) return false;
  return true;
}
export function collectivePolicy(registry: Registry, entity: Entity): CollectiveProfile | undefined {
  const profile = COLLECTIVE_PROFILES[entity.components.creature?.speciesId ?? ''], capabilities = capabilitiesOf(registry, entity);
  if (!profile || !capabilities || profile.reference.mode === 'none') return;
  if (profile.reference.mode === 'normal' && entity.components.person && capabilities.reproduction === 'family'
    || profile.reference.herd && entity.components.animal && !capabilities.sapience && capabilities.movement.includes('walk')) return profile;
}
export function migrationFamilies(world: World, members: number[]): number[] {
  return [...new Set(members.flatMap(id => {
    const entity = world.entities.get(id), family = entity && (entity.components.health?.current ?? 0) > 0 && familyOf(world, entity);
    return family && family.members.includes(id) ? [family.id] : [];
  }))];
}
export const compareElders = (a: Entity, b: Entity): number =>
  (a.components.unit?.bornAt ?? -(a.components.animal?.age ?? 0) * 100)
  - (b.components.unit?.bornAt ?? -(b.components.animal?.age ?? 0) * 100) || a.id - b.id;
function resetFollower(entity: Entity, reason?: typeof HERD_REASONS[number]): void {
  const herd = entity.components.kinship?.herd;
  if (!herd) return;
  if (herd.followId !== null && entity.components.animal) entity.components.animal.path = [];
  herd.followId = null; herd.followIn = 0; herd.moveIn = 0;
  if (reason) herd.reason = reason;
  if (entity.components.animal) entity.components.animal.decisionIn = 0;
}
function reconcileFamily(world: World, family: Family): void {
  if (family.dissolvedAt !== null) return;
  if (!family.members.length) {
    family.members = []; family.alphaId = null; family.dissolvedAt = world.tick;
    return;
  }
  if (family.type !== 'alpha') return;
  const eldest = [...family.members].sort((a, b) => compareElders(world.entities.get(a)!, world.entities.get(b)!))[0];
  if (family.alphaId === eldest) return;
  const previous = family.alphaId;
  family.alphaId = eldest;
  recordHappiness(world, world.entities.get(eldest)!, 'alpha');
  for (const id of family.members) resetFollower(world.entities.get(id)!, id === eldest ? 'Leading the herd' : 'Staying near the herd');
  if (previous !== null) world.announce(`${unitName(world.entities.get(eldest)!)} now leads the herd as its oldest member`);
}
export function leaveFamily(world: World, entity: Entity): void {
  const k = entity.components.kinship, family = familyOf(world, entity);
  if (!k || !family) return;
  k.familyId = null; k.previousFamilyId = family.id; resetFollower(entity, 'Seeking a herd');
  family.members = family.members.filter(id => id !== entity.id);
  reconcileFamily(world, family);
}
export function joinFamily(world: World, entity: Entity, family: Family): boolean {
  const k = entity.components.kinship, policy = collectivePolicy(world.registry, entity);
  if (!k || world.entities.get(entity.id) !== entity || family.dissolvedAt !== null
    || !world.families.records.includes(family) || !policy || (entity.components.health?.current ?? 0) <= 0
    || family.type !== policy.reference.mode && family.type !== 'parentless'
    || entity.components.creature?.speciesId !== family.speciesId) return false;
  if (k.familyId === family.id) return true;
  if (family.members.length >= family.limit) return false;
  leaveFamily(world, entity);
  k.familyId = family.id; family.members.push(entity.id); resetFollower(entity, 'Staying near the herd');
  reconcileFamily(world, family);
  return true;
}
function createFamily(world: World, members: Entity[], founders: number[], type: Family['type'], position: Vec2): Family {
  const origins = founders.map(id => world.entities.get(id)?.components.kinship?.familyId
    ?? world.entities.get(id)?.components.kinship?.originFamilyId
    ?? world.unitHistory.find(m => m.id === id)?.kinship?.familyId
    ?? world.unitHistory.find(m => m.id === id)?.kinship?.originFamilyId ?? null);
  // Detach the whole batch before electing leaders; nobody earns a transient alpha role.
  const affected = new Set<Family>();
  for (const member of members) {
    const old = familyOf(world, member), kinship = member.components.kinship!;
    if (old) { affected.add(old); old.members = old.members.filter(id => id !== member.id); kinship.previousFamilyId = old.id; }
    kinship.familyId = null; resetFollower(member);
  }
  const owner = members[0].components.citizen?.villageId ?? members[0].components.animal?.villageId;
  const family: Family = { id: world.families.nextId++, type, founders: [...founders], originFamilyIds: origins,
    speciesId: members[0].components.creature!.speciesId, subspeciesId: null, members: members.map(e => e.id),
    alphaId: null, foundedAt: world.tick, dissolvedAt: null, limit: collectivePolicy(world.registry, members[0])!.limit,
    birthplace: { ...position }, settlementName: world.society.villages.find(v => v.id === owner)?.name ?? null };
  world.families.records.push(family);
  for (const member of members) { member.components.kinship!.familyId = family.id; resetFollower(member); }
  for (const old of affected) reconcileFamily(world, old);
  reconcileFamily(world, family);
  return family;
}
function parentsFamily(world: World, parents: number[]): Family | undefined {
  return world.families.records.find(f => f.dissolvedAt === null && f.founders.length === parents.length
    && parents.every(id => f.founders.includes(id) && (!world.entities.has(id) || world.entities.get(id)?.components.kinship?.familyId === f.id)));
}
export function familyHasRoom(world: World, parents: number[]): boolean {
  const family = parentsFamily(world, parents);
  return !family || family.members.length < family.limit;
}
/** Called only after a successful spawn by the existing birth owner. Repeating it is inert. */
export function recordFamilyBirth(world: World, child: Entity, parents: number[]): Family | undefined {
  const policy = collectivePolicy(world.registry, child);
  if (!policy || world.entities.get(child.id) !== child || (child.components.health?.current ?? 0) <= 0 || !child.components.kinship || !parents.length || parents.length > 2
    || new Set(parents).size !== parents.length || parents.some(id => id >= child.id
      || !world.entities.get(id)?.components.kinship && !world.unitHistory.some(m => m.id === id))) return;
  if (parents.some(id => {
    const parent = world.entities.get(id), memory = world.unitHistory.find(m => m.id === id);
    const speciesId = parent?.components.creature?.speciesId ?? world.registry.entities.get(memory?.typeId ?? '')?.speciesId;
    return speciesId !== child.components.creature?.speciesId;
  })) return;
  if (child.components.kinship.originFamilyId !== null) return familyOf(world, child);
  if (child.components.citizen) child.components.citizen.parents = [...parents];
  else if (child.components.animal) child.components.animal.parents = [...parents];
  let family = parentsFamily(world, parents);
  const birthFamily = family;
  if (family && family.members.length < family.limit) joinFamily(world, child, family);
  else {
    const living = parents.map(id => world.entities.get(id)).filter((e): e is Entity => !!e && (e.components.health?.current ?? 0) > 0);
    // A birth already paid for may finish after another member fills the last place.
    // Move its parents with the child, atomically, without erasing any genealogy.
    family = createFamily(world, [...living, child], parents, child.components.animal ? 'alpha' : 'normal', child.components.position!);
    world.announce(birthFamily ? `${unitName(child)} was born; the full family split and the parents stayed with the child`
      : `${unitName(child)} was born and a new family was founded`);
  }
  child.components.kinship.originFamilyId = birthFamily?.id ?? family.id;
  for (const id of parents) { const parent = world.entities.get(id); if (parent) recordHappiness(world, parent, 'child-born', child); }
  return family;
}
/** A local, reachable meeting is an explicit herd-founding event, independent of reproduction. */
export function foundHerd(world: World, first: Entity, second: Entity): Family | undefined {
  if (first.id === second.id || world.entities.get(first.id) !== first || world.entities.get(second.id) !== second
    || !collectivePolicy(world.registry, first)?.reference.herd || !collectivePolicy(world.registry, second)?.reference.herd
    || (first.components.health?.current ?? 0) <= 0 || (second.components.health?.current ?? 0) <= 0
    || !first.components.animal || !second.components.animal
    || !isAdult(first) || !isAdult(second)
    || first.components.creature?.speciesId !== second.components.creature?.speciesId || familyOf(world, first) || familyOf(world, second)) return;
  return createFamily(world, [first, second], [], 'alpha', first.components.position!);
}
export function removeFamilyMember(world: World, entity: Entity): void {
  leaveFamily(world, entity);
  for (const other of world.query('kinship')) if (other.components.kinship!.herd?.followId === entity.id) resetFollower(other);
}
