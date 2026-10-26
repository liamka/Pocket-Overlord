import { DIET_TRAITS, EGG_TRAITS, GESTATION_TRAITS, METHOD_TRAITS, PHYSIOLOGY, PHYSIOLOGY_IDS, POPULATION_TRAITS, PRODUCTION_TRAITS, changePhysiology, validPhysiology, type PhysiologyId } from '../content/subspecies-traits';
import { subspeciesOf, type SpeciesDefinition } from './subspecies-state';
import type { Entity } from './types';
import type { World } from './world';
import { RESIDENT_DIET, type Diet, type ResourceId } from './resources';
import type { ReproductionProfile } from './reproduction-state';
import type { StatModifier } from './unit-stats';

export interface PhysiologyState {
  birthApplied?: true; hatchApplied?: true; fleeUntil?: number;
  after: number; photoAfter: number; produceAfter: number; sleepAfter: number; shuffleAfter: number;
  pollen: number; flower: number | null; visits: number; lastMealAt: number;
  action?: { kind: 'mineral' | 'wood' | 'plant' | 'crop' | 'prey' | 'water' | 'soil' | 'flower' | 'honey' | 'fruit' | 'meal'; targetId: number | null; x: number; y: number };
  result?: { at: number; text: string };
}
declare module './types' { interface ComponentMap { physiology: PhysiologyState } }
export const newPhysiology = (tick: number): PhysiologyState => ({ after: tick + 30, photoAfter: tick + 300, produceAfter: tick + 1800,
  sleepAfter: tick + 2700, shuffleAfter: tick + 1800, pollen: 0, flower: null, visits: 0, lastMealAt: -1 });
export function hasPhysiology(e: Entity, id: PhysiologyId): boolean {
  return !!subspeciesOf(e)?.traits.includes(id) && !(PHYSIOLOGY[id].zombieRemoval && e.components.creature?.speciesId === 'zombie');
}
export const needsFood = (e: Entity): boolean => !subspeciesOf(e) || hasPhysiology(e, 'stomach');
export const metabolizes = (e: Entity): boolean => needsFood(e) && !hasPhysiology(e, 'energy-preserver');
export function physiologyDefaults(species: SpeciesDefinition): PhysiologyId[] {
  const base = species.runtime;
  const ids: PhysiologyId[] = (['sapience', 'amygdala', 'genealogy', 'tools', 'governance'] as const).filter(id => base?.[id]);
  if (base?.food.length) ids.push('stomach', base.food.includes('graze') ? 'herbivore' : base.food.includes('hunt') && !base.food.includes('care') ? 'carnivore' : 'omnivore');
  if (base?.owner === 'people') ids.push('wernickes-area');
  if (base?.reproduction !== 'none') ids.push('viviparity', base?.reproduction === 'family' ? 'sexual' : 'hermaphroditic');
  return ids;
}
export function physiologyModifiers(e: Entity): StatModifier[] {
  return (subspeciesOf(e)?.traits ?? []).filter(id => hasPhysiology(e, id)).map(id => ({ id: PHYSIOLOGY[id].label, origin: 'genome', flat: PHYSIOLOGY[id].flat, percent: PHYSIOLOGY[id].percent }));
}
const permissions: Partial<Record<PhysiologyId, Diet>> = {
  omnivore: [...RESIDENT_DIET, 'grain'], herbivore: [...RESIDENT_DIET.filter(id => !['meat', 'fish', 'worms', 'pie', 'sushi', 'burger'].includes(id)), 'grain'],
  frugivore: ['cider', 'berries', 'bananas', 'coconut', 'desertBerries', 'candy', 'celestialAvocado', 'lemons', 'honey'],
  folivore: ['jam', 'burger', 'tea', 'evilBeets', 'mushrooms', 'peppers', 'herbs', 'snowCucumbers'],
  granivore: ['grain', 'bread', 'ale', 'pineCones'], carnivore: ['pie', 'sushi', 'fish', 'meat', 'worms'], piscivore: ['fish', 'sushi'],
  florivore: ['honey'], lithotroph: ['crystalSalt', 'bone', 'gems', 'stone', 'commonMetal', 'silver', 'mythril', 'adamantine'], xylophagy: ['wood'],
};
export function physiologyDiet(e: Entity): ResourceId[] {
  if (!needsFood(e)) return [];
  const shared = subspeciesOf(e);
  const allowed = shared ? [...new Set(shared.traits.flatMap(id => permissions[id] ?? []))] : [...RESIDENT_DIET];
  // An explicit carrier policy can restrict physiology, never override it.
  const policy = e.components.resourceConsumer?.diet;
  return policy ? allowed.filter(id => policy.includes(id)) : allowed;
}
export function subspeciesRoom(world: World, e: Entity): number {
  const s = subspeciesOf(e);
  if (!s) return Infinity;
  const index = POPULATION_TRAITS.findIndex(id => s.traits.includes(id));
  if (index < 0) return Infinity;
  const reserved = [...world.query('reproduction')].reduce((n, actor) => n + (actor.components.reproduction!.pending?.subspeciesId === s.id ? actor.components.reproduction!.pending!.children.length : 0), 0);
  return Math.max(0, [50, 100, 500, 1000, 3000][index] - (s.created - s.died - s.departed) - reserved);
}
export function physiologyReproduction(base: ReproductionProfile, before: readonly PhysiologyId[], after: readonly PhysiologyId[]): ReproductionProfile {
  const development: readonly PhysiologyId[] = [...METHOD_TRAITS, ...GESTATION_TRAITS, ...EGG_TRAITS, 'oviparity', 'viviparity'];
  const growsDifferently = development.some(id => before.includes(id) !== after.includes(id));
  if (!growsDifferently && before.includes('aquatic') === after.includes('aquatic')) return base;
  const methods = METHOD_TRAITS.filter(id => after.includes(id));
  const form = after.includes('oviparity') ? 'oviparity' : after.includes('viviparity') ? 'viviparity' : 'direct';
  const gestation = GESTATION_TRAITS.findIndex(id => after.includes(id)), egg = EGG_TRAITS.findIndex(id => after.includes(id));
  return { ...base, methods, form, habitat: after.includes('aquatic') ? 'water' : 'land',
    maturation: growsDifferently ? (form === 'direct' ? 0 : 1) + (gestation < 0 ? 0 : [2, 4, 9, 20, 50][gestation]) + (egg < 0 ? 0 : [7, 2, 1, 3, 6, 3, 10, 4, 5, 6, 8, 15, 6, 5, 3, 3, 3, 3][egg]) + (after.includes('vegetative') ? 12 : 0) : base.maturation };
}
export function physiologyProblem(world: World, e: Entity, id: PhysiologyId): string | undefined {
  const owner = PHYSIOLOGY[id].owner;
  if (owner === 'culture') return 'Culture and language are not available';
  if (owner === 'body') return 'The required body is not available';
  if (owner === 'mythril') return 'Mythril deposits are not available';
  if (owner === 'appearance') return 'This body appearance is not available';
  if (owner === 'power') return 'This birth power is not available';
  if (['sapience', 'tools', 'governance', 'wernickes-area'].includes(id) && !e.components.person) return 'This body cannot perform settlement duties';
  if ((DIET_TRAITS as readonly string[]).includes(id) || (PRODUCTION_TRAITS as readonly string[]).includes(id) || ['aquatic', 'stomach', 'pollinator', 'photosynthetic-skin'].includes(id)) {
    if (!e.components.citizen && !e.components.animal) return 'This body has no feeding behavior';
  }
  if (id === 'mushroom-production') return 'Mushroom plants are not available';
  if (id === 'wasteland-adaptation') return 'The required biome is not available';
  if (id === 'wolf-metamorphosis' && !world.registry.entities.has('core:wolf')) return 'The required body is not available';
}
/** Explicit pool selection is shared by birth mutation and the random-traits law. */
export function drawPhysiologyMutation(world: World, actor: Entity, traits: readonly PhysiologyId[], remove = false): PhysiologyId[] {
  const pool = PHYSIOLOGY_IDS.filter(id => remove ? traits.includes(id) && PHYSIOLOGY[id].mutationRemoval
    : !traits.includes(id) && PHYSIOLOGY[id].random && !physiologyProblem(world, actor, id))
    .filter(id => validPhysiology(changePhysiology(traits, id, !remove)));
  if (!pool.length) return [...traits];
  let roll = world.rng.next() * pool.reduce((n, id) => n + PHYSIOLOGY[id].weight, 0);
  const id = pool.find(id => (roll -= PHYSIOLOGY[id].weight) < 0)!;
  return changePhysiology(traits, id, !remove);
}

export const conversationReach = (a: Entity, b: Entity): number => hasPhysiology(a, 'telepathic-link') && hasPhysiology(b, 'telepathic-link') ? 4 : 2.2;
export const canSpeak = (e: Entity): boolean => !subspeciesOf(e) || hasPhysiology(e, 'wernickes-area') || hasPhysiology(e, 'telepathic-link');
export function normalizedPhysiology(before: readonly PhysiologyId[], requested: readonly PhysiologyId[]): PhysiologyId[] {
  let result = [...before];
  for (const id of before) if (!requested.includes(id)) result = changePhysiology(result, id, false);
  for (const id of requested) if (!before.includes(id)) result = changePhysiology(result, id, true);
  return result;
}
