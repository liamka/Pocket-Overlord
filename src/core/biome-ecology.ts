import { hasPhysiology } from './physiology';
import type { Entity, Vec2 } from './types';
import type { World } from './world';
import type { TreeProfile } from './forestry';
import { biomeDefinition, NaturalBiome } from './natural-biomes';
import { subspeciesOf } from './subspecies-state';
import { acquireTraits, traitAvailable, traitCompatible } from './traits';
import { traitDefinitions } from '../content/traits';
import type { Registry } from '../content/registry';
import { NATURAL_BIOMES } from './natural-biomes';
import { RESOURCES, SOURCE_PROFILES } from './resources';
import { SUBSPECIES_TRAITS } from './subspecies-state';

export function validateBiomeEcology(registry: Registry): void {
  for (const biome of NATURAL_BIOMES) {
    const e = biome.ecology;
    if (e.flora.some(f => !Object.hasOwn(SOURCE_PROFILES, f.profile) || f.weight <= 0)
      || Object.entries(e.minerals).some(([id, weight]) => !Object.hasOwn(RESOURCES, id) || weight <= 0)
      || [...e.creatures, ...e.sapients].some(id => !registry.species.has(id))
      || e.origin.creature.some(id => !Object.hasOwn(traitDefinitions, id))
      || e.origin.subspecies.some(id => !SUBSPECIES_TRAITS.includes(id))
      || e.adaptation && !SUBSPECIES_TRAITS.includes(e.adaptation)) throw new Error(`Invalid biome profile: ${biome.key}`);
  }
}

/** N attempts, each with a coin flip followed by a draw with replacement. */
export function drawOriginTraits<T extends string>(candidates: readonly T[], next: () => number): T[] {
  const selected = new Set<T>();
  for (let i = 0; i < candidates.length; i++) if (next() < 0.5) selected.add(candidates[Math.floor(next() * candidates.length)]);
  return [...selected];
}
export function applyBiomeOrigin(world: World, entity: Entity): void {
  const c = entity.components, origin = c.creature?.origin;
  if (!c.traits || c.traits.biomeOrigin !== undefined || !c.position || !origin
    || !['born', 'placed', 'natural'].includes(origin)) return;
  const biome = world.terrain.biomeAt(c.position.x, c.position.y);
  // A receipt is saved even when every attempt fails. Visits and repainting never call this.
  c.traits.biomeOrigin = biome.id;
  const candidates = biome.ecology.origin.creature.filter(id => traitAvailable(traitDefinitions[id]) && traitCompatible(entity, traitDefinitions[id]));
  acquireTraits(world, entity, drawOriginTraits(candidates, () => world.rng.next()), 'biome');
}
export function settlementBiomeProblem(world: World, point: Vec2, actor: Entity): string | undefined {
  const adaptation = world.terrain.biomeAt(point.x, point.y).ecology.adaptation;
  if (adaptation === 'permafrost-adaptation' && hasPhysiology(actor, 'cold-resistance') || adaptation === 'infernal-adaptation' && hasPhysiology(actor, 'heat-resistance')) return;
  if (adaptation && !subspeciesOf(actor)?.traits.includes(adaptation)) return 'This subspecies needs adaptation to settle here.';
}
export function villageBiomeProblem(world: World, point: Vec2, villageId: number): string | undefined {
  if (!world.terrain.biomeAt(point.x, point.y).ecology.adaptation) return;
  if (![...world.query('citizen')].some(e => e.components.citizen!.villageId === villageId
    && (e.components.health?.current ?? 0) > 0 && !settlementBiomeProblem(world, point, e))) return 'This subspecies needs adaptation to settle here.';
}
export function plantProblem(world: World, point: Vec2, profile?: TreeProfile): string | undefined {
  const c = world.terrain.cell(point.x, point.y);
  if (c.ice || c.frost) return 'Plants cannot grow on frozen ground.';
  if (!c.plantable) return 'This cell cannot grow plants.';
  if (!c.biome.ecology.flora.length || profile && !c.biome.ecology.flora.some(f => f.profile === profile)) return 'This plant does not grow in this biome.';
}
/** A stored plant keeps its species and remaining harvest after a biome edit. */
export function treeProfileFor(biome: NaturalBiome, draw: number): TreeProfile | undefined {
  const flora = biomeDefinition(biome).ecology.flora;
  let weight = draw * flora.reduce((sum, f) => sum + f.weight, 0);
  for (const plant of flora) { weight -= plant.weight; if (weight < 0) return plant.profile; }
}
