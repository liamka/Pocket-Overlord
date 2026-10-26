import { isAdult } from '../core/unit-stats';
import { buildingEntrances, buildingOwner, buildingProfile, buildingRoute, housingBonuses, housingLimit, operational } from '../core/buildings';
import { canAfford } from '../core/resource-ledger';
import type { Entity } from '../core/types';
import type { World } from '../core/world';
import { translate, type Language } from '../i18n';
import { resourceText } from './resources';
import { mineLines } from './mines';

export function buildingLines(world: World, entity: Entity, language: Language): string[] {
  const b = entity.components.building, profile = buildingProfile(entity);
  if (!b || !profile) return [];
  const owner = world.society.villages.find(v => v.id === buildingOwner(entity)), project = b.project;
  const state = { planned: 'Planned', reserved: 'Materials reserved', construction: 'Under construction', active: 'Active building', damaged: 'Damaged building', abandoned: 'Abandoned building', ruined: 'Ruins' }[b.state];
  const lines = [translate(profile.label, language), translate('Building level: {count}', language, { count: b.level }), translate(state, language),
    translate('Owner: {name}', language, { name: owner?.name ?? translate('No owner', language) }),
    translate('Construction cost: {goods}', language, { goods: resourceText(project?.cost ?? profile.cost, language) })];
  if (entity.components.health) lines.push(translate('Building health: {used} / {capacity}', language, { used: Math.ceil(entity.components.health.current), capacity: entity.components.health.max }));
  const entrances = buildingEntrances(world, entity);
  lines.push(translate(entrances.length ? 'Entrance accessible' : 'Entrance blocked', language));
  if (project) {
    lines.push(translate(project.action === 'repair' ? 'Repair work' : project.action === 'clear' ? 'Clearing ruins' : project.action === 'upgrade' ? 'Upgrade work' : 'Construction work', language),
      translate('Work completed: {count}%', language, { count: Math.floor(project.progress * 100) }),
      translate(project.paid ? 'Materials paid' : b.state === 'reserved' ? 'Materials reserved' : 'Waiting for materials', language));
    if (!owner) lines.push(translate('No owner', language));
    else if (!project.paid && !canAfford(world, owner, project.cost, entity.id)) lines.push(translate('Not enough building materials', language));
    else if (![...world.query('person', 'citizen', 'position')].some(e => isAdult(e) && e.components.citizen!.villageId === owner.id
      && buildingRoute(world, e.components.position!, entity) !== undefined)) lines.push(translate('No builder can reach this site', language));
  }
  if (b.kind === 'core:temple') {
    lines.push(translate('Temple: +2 to the allowed number of houses', language),
      translate('Only one temple bonus per settlement', language), translate('Fireproof; explosions can destroy it', language));
    const contributing = owner && housingBonuses(world, owner.id).has(entity.id);
    lines.push(translate(contributing ? 'Additional house slots: {count}'
      : operational(entity) && owner ? 'Another temple already provides this bonus' : 'Building effects inactive', language, { count: 2 }));
    if (entity.components.ruin) lines.push(translate('Rebuilding requires the full cost and new construction work', language));
  } else if (!operational(entity)) lines.push(translate('Building effects inactive', language));
  else {
    if (profile.effects.beds) lines.push(translate('Beds: {count}', language, { count: entity.components.dwelling?.capacity ?? profile.effects.beds }));
    if (profile.effects.storage) lines.push(translate('Storage capacity: {capacity}', language, { capacity: profile.effects.storage }));
    if (profile.effects.houses) lines.push(translate('Additional house slots: {count}', language, { count: profile.effects.houses }));
    if (profile.capabilities.includes('workplace')) lines.push(translate('Workplace available', language));
  }
  lines.push(...mineLines(world, entity, language));
  if (owner) {
    const limit = housingLimit(world, owner);
    lines.push(translate('House plots: {used} / {capacity}', language, { used: limit.used, capacity: limit.limit }));
    if (limit.used >= limit.limit) lines.push(translate('Housing limit reached', language));
  }
  return lines;
}
