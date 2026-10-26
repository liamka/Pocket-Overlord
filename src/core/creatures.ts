import { hasPhysiology, needsFood } from './physiology';
import type { Entity } from './types';
import type { Registry } from '../content/registry';
import type { World } from './world';
import type { CreatureCapabilities } from './capabilities';

export type CreatureOrigin = 'natural' | 'placed' | 'cloned' | 'born' | 'transformed' | 'legacy';
export type Locomotion = 'walk' | 'swim' | 'fly' | 'sail';
export interface SpeciesProfile {
  id: string;
  label: string;
  /** Source identity and ownership are documentation, never spawn instructions. */
  sourceName: string;
  source: string;
  ownerPlan: number;
  group: 'people' | 'humanoids' | 'animals' | 'special' | 'insects' | 'unique' | 'terraformers' | 'historical';
  form: 'ordinary' | 'ascended' | 'unique' | 'historical';
  support: 'partial' | 'unavailable' | 'removed' | 'unused' | 'phenomenon';
  /** A prospective social form need not change the body (e.g. bees). */
  socialForm?: 'same-body' | 'separate-body';
  counterpart?: string;
  parameters?: import('../content/species-profiles').SpeciesParameters;
  runtime?: CreatureCapabilities & {
    owner: 'people' | 'husbandry' | 'dragons' | 'ufos' | 'kaiju' | 'seafaring' | 'movement';
    families: readonly import('../content/creature-families').CreatureFamilyId[];
    size: 'resident' | 'animal' | 'giant' | 'vessel';
    relations: { friendship: boolean; war: boolean; prey: readonly string[]; defendAgainst: readonly string[] };
    death: 'organic' | 'vehicle';
    /** Implemented actions; their owner systems supply timing, targeting and effects. */
    abilities: readonly string[];
    /** No executable transitions until their owning plan installs them. */
    transitions: readonly string[];
  };
}
export interface Creature {
  speciesId: string;
  origin: CreatureOrigin;
  since: number | null;
  /** Last completed interaction, not a second action scheduler or timer. */
  result?: { kind: 'fed' | 'born' | 'hit' | 'lost-target'; at: number; targetId: number | null };
}
declare module './types' { interface ComponentMap { creature: Creature } }

export function speciesOf(registry: Registry, entity: Entity): SpeciesProfile | undefined {
  const id = registry.entities.get(entity.typeId)?.speciesId;
  return id ? registry.species.get(id) : undefined;
}
export function canMove(registry: Registry, entity: Entity, mode: Locomotion): boolean {
  if (hasPhysiology(entity, 'unmoving')) return false;
  if (mode === 'fly' && hasPhysiology(entity, 'hovering') || mode === 'swim' && hasPhysiology(entity, 'aquatic')) return true;
  return speciesOf(registry, entity)?.runtime?.movement.includes(mode) ?? false;
}
export function feedsBy(registry: Registry, entity: Entity, food: NonNullable<SpeciesProfile['runtime']>['food'][number]): boolean {
  return needsFood(entity) && (speciesOf(registry, entity)?.runtime?.food.includes(food) ?? false);
}
export function reproducesBy(registry: Registry, entity: Entity, mode: 'family' | 'herd'): boolean {
  return speciesOf(registry, entity)?.runtime?.reproduction === mode;
}
export function hunts(registry: Registry, actor: Entity, target: Entity): boolean {
  const prey = speciesOf(registry, target);
  return !!prey && (speciesOf(registry, actor)?.runtime?.relations.prey.includes(prey.id) ?? false);
}
export function recordCreatureResult(world: World, entity: Entity, kind: NonNullable<Creature['result']>['kind'], targetId: number | null): void {
  if (entity.components.creature) entity.components.creature.result = { kind, at: world.tick, targetId };
}

/** Removal remains the sole death/loot transaction; cancel unique attacks before their next pulse. */
export function releaseCreatureTargets(world: World, id: number): void {
  for (const entity of world.query('creature')) {
    const c = entity.components;
    if (c.creature!.result?.targetId === id) c.creature!.result.targetId = null;
    if ((c.citizen?.targetId ?? c.animal?.targetId) === id) recordCreatureResult(world, entity, 'lost-target', null);
    if (c.dragon?.targetId === id) {
      c.dragon.targetId = null; c.dragon.breath = c.dragon.pulseIn = 0; c.dragon.thinkIn = 0;
      recordCreatureResult(world, entity, 'lost-target', null);
    }
    if (c.ufo?.targetId === id) {
      c.ufo.targetId = null; c.ufo.phase = 'recover'; c.ufo.phaseTime = 0; c.ufo.thinkIn = 0;
      recordCreatureResult(world, entity, 'lost-target', null);
    }
    if (c.kaiju?.targetId === id) {
      c.kaiju.targetId = null; c.kaiju.phase = 'recover'; c.kaiju.phaseTime = 0; c.kaiju.pulseIn = 0; c.kaiju.thinkIn = 0;
      recordCreatureResult(world, entity, 'lost-target', null);
    }
    if (c.ship?.homeId === id) c.ship.homeId = null;
    if (c.ship?.targetId === id) {
      Object.assign(c.ship, { targetId: null, targetOwnerId: null, path: [], next: 0, phase: 'idle', wait: 0, speed: 0 });
      recordCreatureResult(world, entity, 'lost-target', null);
    }
  }
}
