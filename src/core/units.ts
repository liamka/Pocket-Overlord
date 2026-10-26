import { hasTrait } from './traits';
import { isAdult, hungerPercent } from './unit-stats';
import { recordHappiness } from './happiness';
import type { Entity, Vec2 } from './types';
import type { World } from './world';
import { residentName } from './village-life';
import { buildingProfile } from './buildings';
import { canOpenUnitEditor } from './capabilities';
import { aboardFerry, waitingForFerry } from './ferries';
import { parentsOf, type Kinship } from './families';

export interface UnitIdentity {
  displayName: string;
  customName: string | null;
  favorite: boolean;
  /** Simulation ticks; pre-existing adults can have a negative birth date. */
  bornAt: number | null;
  bestFriendId: number | null;
  lostPartnerId: number | null;
  lostFriendId: number | null;
  /** A personal bond survives bodies that cannot form a civil household. */
  partnerId?: number | null;
  previousBodyId?: number;
}
export interface UnitMemory {
  id: number; typeId: string; identity: UnitIdentity; parents: number[];
  kinship?: Pick<Kinship, 'familyId' | 'originFamilyId' | 'previousFamilyId'>;
  endedAt: number | null; died: boolean;
  continuedAs?: number;
  echoId?: number;
  /** Frozen personal traits for children born after a parent leaves or dies. */
  traitIds?: string[];
}
declare module './types' { interface ComponentMap { unit: UnitIdentity } }
export const isUnit = (entity: Entity): boolean => {
  const c = entity.components;
  return !!(c.creature || c.person || c.animal || c.ship || c.dragon || c.ufo || c.kaiju || c.monsterHunter);
};
export const unitName = (entity: Entity): string => entity.components.unit?.customName ?? entity.components.unit?.displayName ?? residentName(entity.id);
export const memoryName = (memory: UnitMemory): string => memory.identity.customName ?? memory.identity.displayName;
export const partnerOf = (entity: Entity): number | null => entity.components.citizen?.partnerId ?? entity.components.unit?.partnerId ?? null;
export function initializeUnit(entity: Entity, tick: number): void {
  if (!isUnit(entity) || entity.components.unit) return;
  const age = entity.components.person?.age ?? entity.components.animal?.age;
  entity.components.unit = { displayName: residentName(entity.id), customName: null, favorite: false,
    bornAt: age === undefined ? null : tick - Math.round(age * 100), bestFriendId: null, lostPartnerId: null, lostFriendId: null };
}
export function renameUnit(world: World, id: number, value: string): boolean {
  const unit = world.entities.get(id)?.components.unit;
  const name = value.trim();
  if (!unit || [...name].length > 30 || /[\u0000-\u001f\u007f]/u.test(name)) return false;
  unit.customName = name || null;
  return true;
}
/** Conversation completion is the only source of new friendships. No random draw. */
export function befriend(world: World, first: Entity, second: Entity): boolean {
  if (world.entities.get(first.id) !== first || world.entities.get(second.id) !== second) return false;
  const a = first.components.unit, b = second.components.unit;
  if (!a || !b || first.id === second.id || !first.components.citizen || !second.components.citizen
    || isAdult(first) !== isAdult(second)) return false;
  if (a.bestFriendId === second.id && b.bestFriendId === first.id) return true;
  if (a.bestFriendId !== null || b.bestFriendId !== null) return false;
  for (const [unit, friend] of [[a, second], [b, first]] as const) {
    unit.bestFriendId = friend.id; unit.lostFriendId = null;
  }
  recordHappiness(world, first, 'friend', second); recordHappiness(world, second, 'friend', first);
  return true;
}
/** Run before references are cleared, so the final names and family links survive. */
export function rememberUnit(world: World, entity: Entity, died = false, traitIds?: string[]): void {
  const identity = entity.components.unit;
  if (!identity) return;
  world.unitHistory.push({ id: entity.id, typeId: entity.typeId, identity: structuredClone(identity),
    traitIds: traitIds ?? (entity.components.traits?.entries ?? []).filter(t => hasTrait(entity,t.id)).map(t => t.id),
    parents: [...parentsOf(entity)], ...(entity.components.kinship ? { kinship: { familyId: entity.components.kinship.familyId,
      originFamilyId: entity.components.kinship.originFamilyId, previousFamilyId: entity.components.kinship.previousFamilyId } } : {}), endedAt: world.tick, died });
  for (const other of world.query('unit')) {
    if (other.id === entity.id) continue;
    const u = other.components.unit!;
    if (partnerOf(other) === entity.id) {
      u.partnerId = null;
      u.lostPartnerId = entity.id;
      if (died) world.announce(`${unitName(other)} lost their partner ${unitName(entity)}`);
    }
    if (u.bestFriendId === entity.id) {
      u.bestFriendId = null; u.lostFriendId = entity.id;
      if (died) world.announce(`${unitName(other)} lost their best friend ${unitName(entity)}`);
    }
  }
  if (identity.favorite) world.announce(died ? `Favorite ${unitName(entity)} died` : `Favorite ${unitName(entity)} left the world`);
}

export interface UnitLink { kind: 'unit' | 'entity' | 'place'; id: number; name: string; position?: Vec2; ended?: boolean; localize?: boolean }
const tasks: Record<string, string> = {
  idle: 'Resting', farm: 'Growing food', eat: 'Eating', visit: 'Visiting', socialize: 'Talking', fight: 'Fighting', repair: 'Repairing a road',
  build: 'Building', migrate: 'Migrating', work: 'Working', deliver: 'Delivering supplies', tend: 'Tending animals', guard: 'Guarding', equip: 'Collecting equipment',
  flee: 'Fleeing danger', extinguish: 'Putting out a fire', aid: 'Helping the wounded', docked: 'In port', sailing: 'Sailing', fishing: 'Fishing',
  returning: 'Returning', departing: 'Leaving the world', flying: 'Flying', cruise: 'Patrolling', charge: 'Charging a beam', beam: 'Firing a beam', recover: 'Recovering after an attack',
};
export interface UnitInspection {
  entity: Entity; identity: UnitIdentity; species: string;
  health?: { current: number; max: number }; age?: number; hunger?: number;
  occupation?: string; task?: string; stage?: string; progress?: number; reason?: string; target?: UnitLink;
  statuses: string[]; home?: UnitLink; village?: UnitLink;
  family: { relation: string; member: UnitLink }[]; equipment: boolean;
}
export function unitLink(world: World, id: number | null, followForms = true): UnitLink | undefined {
  if (id === null) return;
  if (followForms) {
    const visited = new Set<number>();
    while (!visited.has(id)) {
      visited.add(id);
      const next = world.unitHistory.find(m => m.id === id)?.continuedAs;
      if (next === undefined) break;
      id = next;
    }
  }
  const entity = world.entities.get(id);
  if (entity) return { kind: isUnit(entity) ? 'unit' : 'entity', id, name: isUnit(entity) ? unitName(entity) : entityLabel(world, entity), localize: !isUnit(entity), position: entity.components.position };
  const memory = world.unitHistory.find(m => m.id === id);
  if (memory) return { kind: 'unit', id, name: memoryName(memory), ended: true };
}
export function entityLabel(world: World, entity: Entity): string {
  const type = entity.typeId;
  if (entity.components.monsterHunter) return 'Monster hunter';
  if (entity.components.foreignVoyage) return entity.components.foreignVoyage.kind === 'merchants' ? 'Overseas merchants' : 'Hunters expedition';
  // Labels come from existing content. Never present internal entity identifiers.
  return world.registry.tools.get(type)?.label ?? buildingProfile(entity)?.label
    ?? world.registry.species.get(entity.components.creature?.speciesId ?? world.registry.entities.get(type)?.speciesId ?? '')?.label
    ?? (type === 'core:person' ? 'Human' : entity.components.dwelling ? 'Home' : entity.components.farm ? 'Farm' : 'Target');
}
export function inspectUnit(world: World, id: number): UnitInspection | undefined {
  const entity = world.entities.get(id), c = entity?.components;
  if (!entity || !c?.unit || !isUnit(entity)) return;
  const person = c.person, citizen = c.citizen, animal = c.animal, ship = c.ship;
  const view: UnitInspection = { entity, identity: c.unit, species: entityLabel(world, entity), health: c.health,
    statuses: [], family: [], equipment: canOpenUnitEditor(world.registry, entity, 'equipment') };
  if (person || animal) { view.age = person?.age ?? animal!.age; view.hunger = hungerPercent(entity); }
  const targetId = citizen?.emergency?.targetId ?? citizen?.targetId ?? animal?.targetId ?? ship?.targetId ?? c.monsterHunter?.targetId ?? c.dragon?.targetId ?? c.ufo?.targetId ?? c.kaiju?.targetId;
  if (targetId != null) {
    view.target = unitLink(world, targetId);
    if (!view.target || view.target.ended) { view.target = undefined; view.reason = 'Target is no longer available'; }
  }
  if (citizen) {
    view.task = tasks[citizen.emergency?.kind ?? citizen.task];
    const state = citizen.behaviour, definition = state && world.registry.tasks.get(state.taskId);
    if (state?.status === 'active' && definition) {
      view.task = definition.label;
      view.stage = definition.stages.find(s => s.id === state.stageId)?.label;
      view.progress = state.progress;
      if (state.taskId === 'swim_to_island') { view.target = undefined; view.reason = 'Seeking dry land'; }
    } else if (state?.status === 'cancelled' && citizen.task === 'idle' && !citizen.emergency) {
      view.stage = 'Action interrupted'; view.reason = state.reason;
    } else if (state?.status === 'suspended' && !citizen.emergency) {
      view.task = definition?.label; view.stage = 'Action suspended'; view.reason = state.reason;
    } else if (state?.status === 'completed' && citizen.task === 'idle' && !citizen.emergency) {
      view.stage = 'Action completed'; view.reason = state.reason;
    }
    if (aboardFerry(world, id)) view.stage = 'Crossing by ferry';
    else if (waitingForFerry(world, entity)) view.stage = 'Waiting to board';
    view.reason ??= citizen.work?.waiting ?? (citizen.emergency ? 'Responding to danger' : citizen.work?.cargo ? 'Carrying supplies'
      : citizen.task === 'eat' ? 'Hungry' : citizen.path.length ? 'Travelling to the target' : undefined);
    if (citizen.task === 'migrate') {
      const group = world.society.migrations.find(g => g.members.includes(id));
      if (group) {
        const destination = world.society.villages.find(v => v.id === group.toId);
        view.target = { kind: 'place', id: group.id, name: destination?.name ?? 'New settlement site', localize: !destination, position: group.destination };
        view.reason = 'Seeking a new home';
      }
    }
    view.reason ??= citizen.task === 'idle' ? 'No current assignment'
      : citizen.task === 'socialize' ? 'Meeting another resident'
      : citizen.task === 'repair' ? 'Damaged road'
      : citizen.task === 'work' || citizen.task === 'farm' ? 'Supplying the settlement' : undefined;
    if (citizen.task === 'repair' && citizen.repair) view.target = { kind: 'place', id: 0, name: 'Road', localize: true, position: {
      x: citizen.repair.tile % world.terrain.width + 0.5, y: Math.floor(citizen.repair.tile / world.terrain.width) + 0.5 } };
    const relative = (relation: string, memberId: number | null): void => {
      if (!canOpenUnitEditor(world.registry, entity, 'genealogy')) return;
      const member = unitLink(world, memberId); if (member) view.family.push({ relation, member });
    };
    citizen.parents.forEach(parent => relative('Parent', parent));
    relative('Partner', partnerOf(entity) ?? c.unit.lostPartnerId);
    relative('Best friend', c.unit.bestFriendId ?? c.unit.lostFriendId);
    for (const child of world.query('citizen')) if (child.components.citizen!.parents.includes(id)) relative('Child', child.id);
    for (const child of world.unitHistory) if (child.parents.includes(id)) relative('Child', child.id);
  }
  if (c.metamorphosis?.history.length) {
    const relative = (relation: string, memberId: number | null): void => {
      const member = unitLink(world, memberId);
      if (member && member.id !== entity.id && !view.family.some(r => r.relation === relation && r.member.id === member.id)) view.family.push({ relation, member });
    };
    parentsOf(entity).forEach(parent => relative('Parent', parent));
    relative('Partner', partnerOf(entity) ?? c.unit.lostPartnerId);
    relative('Best friend', c.unit.bestFriendId ?? c.unit.lostFriendId);
    for (const child of world.query('unit')) if (parentsOf(child).some(parent => unitLink(world, parent)?.id === entity.id)) relative('Child', child.id);
    for (const child of world.unitHistory) if (child.parents.some(parent => unitLink(world, parent)?.id === entity.id)) relative('Child', child.id);
  }
  if (ship) {
    view.occupation = ship.kind === 'fishing' ? 'Fishing vessel' : 'Trading vessel'; view.task = tasks[ship.phase];
    view.reason ??= ship.homeId === null ? 'No home harbor' : ship.cargo > 0 ? 'Carrying supplies' : undefined;
  }
  if (c.foreignVoyage) {
    view.occupation = view.species;
    view.task = c.foreignVoyage.phase === 'departing' ? 'Leaving the island' : c.foreignVoyage.phase === 'arriving' ? 'Sailing' : c.foreignVoyage.kind === 'merchants' ? 'Trading' : 'Waiting for hunters';
    view.reason = undefined;
  }
  if (c.monsterHunter) {
    view.occupation = 'Monster hunter'; view.task = c.monsterHunter.returning ? 'Returning to the ship' : 'Hunting';
    if (c.monsterHunter.returning) { view.target = unitLink(world, c.monsterHunter.shipId); view.reason = undefined; }
  }
  if (animal) {
    view.task = animal.targetId ? animal.kind === 'wolf' ? 'Hunting' : tasks.guard : animal.moving ? 'Wandering' : tasks.idle;
    const herd = c.kinship?.herd;
    if (herd?.reason === 'Defending a herd member' && animal.targetId !== null) { view.task = herd.reason; view.reason = herd.reason; }
    if (herd && animal.targetId === null) {
      view.reason = herd.reason;
      if (herd.followId !== null) view.target = unitLink(world, herd.followId);
      if (herd.reason === 'Following the oldest herd member' || herd.reason === 'Leading the herd') view.task = herd.reason;
    }
    for (const parent of parentsOf(entity)) { const member = unitLink(world, parent); if (member) view.family.push({ relation: 'Parent', member }); }
    for (const child of world.query('animal')) if (parentsOf(child).includes(id)) {
      const member = unitLink(world, child.id); if (member) view.family.push({ relation: 'Child', member });
    }
    for (const child of world.unitHistory) if (child.parents.includes(id)) {
      const member = unitLink(world, child.id); if (member) view.family.push({ relation: 'Child', member });
    }
  }
  if (c.dragon) view.task = tasks[c.dragon.departure ? 'departing' : c.dragon.breath > 0 ? 'fight' : 'flying'];
  if (c.ufo || c.kaiju) view.task = tasks[(c.ufo ?? c.kaiju)!.phase];
  if (c.thermal?.burning) view.statuses.push('Burning');
  if (person?.plague) view.statuses.push('Plague');
  if (person?.madness) view.statuses.push('Madness');
  if (citizen && hungerPercent(entity) >= 65) view.statuses.push('Hungry');
  const homeId = person?.homeId ?? ship?.homeId;
  if (homeId != null && world.entities.has(homeId)) view.home = unitLink(world, homeId);
  const villageId = citizen?.villageId ?? animal?.villageId ?? (ship?.homeId ? world.entities.get(ship.homeId)?.components.harbor?.villageId : undefined);
  const village = world.society.villages.find(v => v.id === villageId);
  if (village) view.village = { kind: 'place', id: village.id, name: village.name, position: village };
  return view;
}
