import { hasTrait, traitOpinion } from './traits';
import { isAdult, hungerPercent } from './unit-stats';
import { HAPPINESS_EVENTS, type HappinessEvent } from '../content/happiness';
import type { Registry } from '../content/registry';
import { hasCapability } from './capabilities';
import { operational } from './buildings';
import { parentsOf } from './families';
import { entityLabel, partnerOf, unitName } from './units';
import type { Entity } from './types';
import type { World } from './world';

export const HAPPINESS_HISTORY_LIMIT = 24;
/** An immutable historical caption, not a live target reference. */
export interface HappinessSource { id: number; name: string; localize: boolean }
export interface HappinessMemory { type: HappinessEvent; tick: number; source: HappinessSource; change: number }
export interface HappinessState {
  value: number;
  history: HappinessMemory[];
  starving: boolean;
  grown: boolean;
  home: HappinessSource | null;
  /** Inputs for future trait/status owners; no trait editor or egg lifecycle here. */
  psychopath?: boolean;
  egg?: boolean;
}
export const happinessPercent = (value: number): number => (value + 100) / 2;
export const canFeel = (registry: Registry, entity: Entity): boolean => hasCapability(registry, entity, 'amygdala') && !entity.components.happiness?.egg;
export const happinessValue = (world: World, entity: Entity): number | undefined => canFeel(world.registry, entity) ? entity.components.happiness?.value : undefined;
export function initializeHappiness(registry: Registry, entity: Entity): void {
  // Keep dormant memories when a subspecies temporarily loses emotional capacity.
  const species = registry.species.get(entity.components.creature?.speciesId ?? registry.entities.get(entity.typeId)?.speciesId ?? '');
  if (!species?.runtime?.amygdala || entity.components.happiness) return;
  entity.components.happiness = { value: 0, history: [], home: null,
    starving: hungerPercent(entity) >= (entity.components.animal ? 95 : 90),
    grown: isAdult(entity) };
}
export const happinessSource = (world: World, entity: Entity): HappinessSource => ({ id: entity.id,
  name: entity.components.unit ? unitName(entity) : entityLabel(world, entity), localize: !entity.components.unit });

/** Only a successful owner transaction calls this. Batch clamp happens after summation.
 * Same event/source/tick cannot be awarded twice; ongoing episodes have their own saved gates. */
export function recordHappinessBatch(world: World, entity: Entity, events: readonly { type: HappinessEvent; source?: HappinessSource }[]): void {
  const state = entity.components.happiness;
  if (!state || !canFeel(world.registry, entity) || world.entities.get(entity.id) !== entity || (entity.components.health?.current ?? 0) <= 0) return;
  let change = 0;
  for (const input of events) {
    const definition = HAPPINESS_EVENTS[input.type], source = input.source ?? happinessSource(world, entity);
    if (definition.support !== 'adapted' || (state.psychopath || hasTrait(entity, 'psychopath')) && definition.ignoresPsychopath
      || state.history.some(m => m.type === input.type && m.tick === world.tick && m.source.id === source.id)) continue;
    state.history.push({ type: input.type, tick: world.tick, source: { ...source }, change: definition.delta });
    change += definition.delta;
  }
  state.value = Math.max(-100, Math.min(100, state.value + change));
  state.history.splice(0, Math.max(0, state.history.length - HAPPINESS_HISTORY_LIMIT));
}
export function recordHappiness(world: World, entity: Entity, type: HappinessEvent, source: Entity = entity): void {
  recordHappinessBatch(world, entity, [{ type, source: happinessSource(world, source) }]);
}

/** Observe real state changes; a reserved or unfinished house is not a move-in. */
export function syncHappiness(world: World, entity: Entity): void {
  if (world.paused || !canFeel(world.registry, entity)) return;
  const h = entity.components.happiness;
  if (!h) return;
  const events: { type: HappinessEvent; source?: HappinessSource }[] = [];
  const starving = hungerPercent(entity) >= (entity.components.animal ? 95 : 90);
  if (starving && !h.starving) events.push({ type: 'starving' });
  h.starving = starving;
  const grown = isAdult(entity);
  if (grown && !h.grown) events.push({ type: 'adulthood' });
  h.grown = grown;
  const home = world.entities.get(entity.components.person?.homeId ?? -1), p = entity.components.position;
  if (h.home && (!home || home.id !== h.home.id)) { events.push({ type: 'lost-home', source: h.home }); h.home = null; }
  if (home?.components.dwelling && home.components.position && operational(home) && !home.components.thermal?.burning
    && home.id !== h.home?.id && p && Math.hypot(p.x - home.components.position.x, p.y - home.components.position.y) < 3.2) {
    h.home = happinessSource(world, home); events.push({ type: 'new-home', source: h.home });
  }
  recordHappinessBatch(world, entity, events);
}
export function happiness(world: World): void {
  if (world.paused) return;
  for (const entity of world.query('happiness')) syncHappiness(world, entity);
}
/** Called before family and partner references are removed. */
export function mournUnit(world: World, dead: Entity): void {
  const parents = parentsOf(dead), family = dead.components.kinship?.familyId;
  for (const other of world.query('happiness')) {
    if (other.id === dead.id) continue;
    const type: HappinessEvent | undefined = parents.includes(other.id) ? 'child-death'
      : partnerOf(other) === dead.id ? 'partner-death'
      : other.components.unit?.bestFriendId === dead.id ? 'friend-death'
      : parentsOf(other).includes(dead.id) || parentsOf(other).some(id => parents.includes(id))
        || family != null && other.components.kinship?.familyId === family ? 'family-death' : undefined;
    if (type) recordHappiness(world, other, type, dead);
  }
}
export function forgetHappinessHome(world: World, home: Entity): void {
  for (const resident of world.query('happiness')) {
    const state = resident.components.happiness!;
    if (state.home?.id !== home.id) continue;
    recordHappiness(world, resident, 'lost-home', home); state.home = null;
  }
}
/** Same age group, free bonds, and similar happiness make friendship possible.
 * Existing conversations supply repeated contact; no extra random stream. */
export function friendshipContactRequired(world: World, a: Entity, b: Entity): number {
  const av = happinessValue(world, a), bv = happinessValue(world, b);
  return av === undefined || bv === undefined ? 6 : Math.max(1, 4 + Math.floor(Math.abs(av - bv) / 50) + (av < -40 || bv < -40 ? 2 : 0) - Math.trunc((traitOpinion(a, b) + traitOpinion(b, a)) / 20));
}

/** Food's committed receipt owns this variable, catalogue-defined meal reward. */
export function recordMealHappiness(world: World, entity: Entity, change: number): void {
  const state = entity.components.happiness;
  if (!state || !canFeel(world.registry, entity) || !Number.isFinite(change)
    || state.history.some(m => m.type === 'meal' && m.tick === world.tick)) return;
  state.history.push({ type: 'meal', tick: world.tick, source: happinessSource(world, entity), change });
  state.value = Math.max(-100, Math.min(100, state.value + change));
  state.history.splice(0, Math.max(0, state.history.length - HAPPINESS_HISTORY_LIMIT));
}
