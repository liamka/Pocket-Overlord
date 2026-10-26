import { hasPhysiology, needsFood } from './physiology';
import { subspeciesOf } from './subspecies-state';
import { isAdult } from './unit-stats';
import type { Registry, EntityDefinition } from '../content/registry';
import type { Components, Entity } from './types';
import type { Locomotion, SpeciesProfile } from './creatures';

/** Independent capabilities, never a biological or political inheritance tree. */
export interface CreatureCapabilities {
  movement: readonly Locomotion[];
  food: readonly ('settlement' | 'graze' | 'hunt' | 'care')[];
  reproduction: 'family' | 'herd' | 'none';
  citizenship: boolean;
  sapience: boolean;
  amygdala: boolean;
  genealogy: boolean;
  genomeEditor: boolean;
  genomeBudget: boolean;
  subspecies: boolean;
  clothing: boolean;
  tools: boolean;
  statusLevels: boolean;
  governance: boolean;
}
export const CAPABILITIES = ['amygdala', 'nutrition', 'genealogy', 'genomeEditor', 'genomeBudget', 'subspecies', 'clothing', 'tools', 'flight', 'statusLevels', 'sapience', 'citizenship', 'governance'] as const;
export type Capability = typeof CAPABILITIES[number];
/** No genes, experience or phenotype system is installed by this plan. */
export const BASIC_CAPABILITIES: Readonly<CreatureCapabilities> = Object.freeze({ movement: Object.freeze([]), food: Object.freeze([]), reproduction: 'none',
  citizenship: false, sapience: false, amygdala: false, genealogy: false, genomeEditor: false, genomeBudget: false, subspecies: false,
  clothing: false, tools: false, statusLevels: false, governance: false });
export const CIVIL_CAPABILITIES: Readonly<CreatureCapabilities> = Object.freeze({ ...BASIC_CAPABILITIES, movement: Object.freeze(['walk', 'swim'] as const),
  food: Object.freeze(['settlement'] as const), reproduction: 'family', amygdala: true, citizenship: true, sapience: true, genealogy: true, clothing: true, tools: true, governance: true });

export function supportsCapability(c: CreatureCapabilities | undefined, key: Capability): boolean {
  if (!c) return false;
  return key === 'nutrition' ? c.food.length > 0 : key === 'flight' ? c.movement.includes('fly') : c[key];
}
export function capabilitiesOf(registry: Registry, entity: Entity): CreatureCapabilities | undefined {
  const id = entity.components.creature?.speciesId ?? registry.entities.get(entity.typeId)?.speciesId;
  const base = id ? registry.species.get(id)?.runtime : undefined, shared = subspeciesOf(entity);
  if (!base || !shared) return base;
  const sapience = base.sapience && shared.traits.includes('sapience');
  return { ...base, food: needsFood(entity) ? base.food : [],
    movement: hasPhysiology(entity, 'unmoving') ? [] : hasPhysiology(entity, 'hovering') ? ['fly'] : hasPhysiology(entity, 'aquatic') ? [...new Set([...base.movement, 'swim' as const])] : base.movement,
    subspecies: true, sapience, amygdala: base.amygdala && shared.traits.includes('amygdala'),
    genealogy: base.genealogy && shared.traits.includes('genealogy'), tools: base.tools && sapience && shared.traits.includes('tools'),
    citizenship: base.citizenship && sapience, governance: base.governance && sapience && shared.traits.includes('governance') };

}
export function hasCapability(registry: Registry, entity: Entity, key: Capability, active = false): boolean {
  const id = entity.components.creature?.speciesId ?? registry.entities.get(entity.typeId)?.speciesId;
  const base = id ? registry.species.get(id)?.runtime : undefined;
  if (!base) return false;
  const shared = subspeciesOf(entity);
  if (key === 'subspecies' && shared) return true;
  if (key === 'nutrition' && !needsFood(entity)) return false;
  if (key === 'flight' && hasPhysiology(entity, 'hovering')) return true;
  if (!supportsCapability(base, key)) return false;
  if (shared) {
    if ((key === 'sapience' || key === 'citizenship' || key === 'tools' || key === 'governance')
      && (!base.sapience || !shared.traits.includes('sapience'))) return false;
    if ((key === 'amygdala' || key === 'genealogy' || key === 'tools' || key === 'governance') && !shared.traits.includes(key)) return false;
  }
  if (active && ['sapience', 'citizenship', 'governance'].includes(key) && entity.components.person?.madness) return false;
  return true;
}
export const canGovern = (registry: Registry, entity: Entity): boolean => hasCapability(registry, entity, 'governance', true)
  && !!entity.components.citizen && isAdult(entity) && entity.components.citizen.task !== 'migrate';
export type UnitEditor = 'identity' | 'equipment' | 'genealogy';
const editorRequirements: Record<UnitEditor, readonly Capability[]> = { identity: [], equipment: ['tools'], genealogy: ['genealogy'] };
export function canOpenUnitEditor(registry: Registry, entity: Entity, editor: UnitEditor): boolean {
  return !!entity.components.unit && editorRequirements[editor].every(key => hasCapability(registry, entity, key));
}
/** Ground traps can consult the same contract without adding a mine power here. */
export const touchesGround = (registry: Registry, entity: Entity): boolean => !hasCapability(registry, entity, 'flight');

type Runtime = NonNullable<SpeciesProfile['runtime']>;
export const OWNER_SYSTEMS: Record<Runtime['owner'], readonly string[]> = {
  people: ['core:movement', 'core:settlement', 'core:intentions'], husbandry: ['core:husbandry'], movement: ['core:movement'],
  dragons: ['core:dragons'], ufos: ['core:ufos'], kaiju: ['core:kaiju'], seafaring: ['core:seafaring'],
};
const ownerComponents: Record<Runtime['owner'], readonly string[]> = {
  people: ['person', 'citizen', 'motion'], husbandry: ['animal'], movement: ['motion'], dragons: ['dragon'], ufos: ['ufo'], kaiju: ['kaiju'], seafaring: ['ship'],
};
const ownerMovement: Record<Runtime['owner'], readonly Locomotion[]> = {
  people: ['walk', 'swim'], husbandry: ['walk'], movement: ['walk', 'swim', 'fly'], dragons: ['fly'], ufos: ['fly'], kaiju: ['walk', 'swim'], seafaring: ['sail'],
};
const capabilityComponents: Partial<Record<Capability, readonly string[]>> = {
  genealogy: ['person', 'citizen'], clothing: ['person', 'appearance'], tools: ['person', 'citizen'], citizenship: ['person', 'citizen'], governance: ['person', 'citizen'],
  subspecies: ['subspecies'], statusLevels: ['experience'],
};
export const CAPABILITY_SYSTEMS: Partial<Record<Capability, string>> = {
  governance: 'core:governance', subspecies: 'core:subspecies', statusLevels: 'core:experience',
};
export function validateCapabilities(profile: SpeciesProfile): void {
  const c = profile.runtime;
  if (!c) return;
  const fail = (reason: string): never => { throw new Error(`Species ${profile.id}: ${reason}`); };
  // Chromosomes are attached by World.insert; generation/editing are synchronous owners, not tick systems.
  if ((c.genomeEditor || c.genomeBudget) && !profile.parameters?.genomeBudget) fail('genome capability requires a species budget');
  if (!OWNER_SYSTEMS[c.owner]) fail('unknown behavior owner');
  for (const key of CAPABILITIES) if (key !== 'nutrition' && key !== 'flight' && typeof c[key] !== 'boolean') fail(`capability ${key} must be boolean`);
  if (!Array.isArray(c.movement) || !c.movement.length || c.movement.some(m => !['walk', 'swim', 'fly', 'sail'].includes(m))) fail('missing or invalid movement capability');
  if (!Array.isArray(c.food) || c.food.some(f => !['settlement', 'graze', 'hunt', 'care'].includes(f))) fail('invalid nutrition capability');
  if (c.movement.some(mode => !ownerMovement[c.owner].includes(mode))) fail(`${c.owner} behavior cannot supply the requested movement`);
  if (['people', 'husbandry', 'kaiju'].includes(c.owner) && !c.movement.includes('walk')) fail(`${c.owner} behavior requires walking`);
  if (c.owner === 'movement' && !c.movement.includes('walk') && !c.movement.includes('fly')) fail('movement behavior requires walking or flight');
  if (c.food.length && !['people', 'husbandry'].includes(c.owner)) fail(`${c.owner} behavior has no feeding handler`);
  if (c.owner === 'people' && c.food.some(food => food !== 'settlement') || c.owner === 'husbandry' && c.food.includes('settlement')) fail(`${c.owner} behavior cannot supply the requested nutrition`);
  if (c.reproduction === 'herd' && c.owner !== 'husbandry') fail('herd reproduction requires husbandry');
  if (!['none', 'family', 'herd'].includes(c.reproduction)) fail('invalid reproduction capability');
  if (c.governance && (!c.citizenship || !c.sapience)) fail('governance requires citizenship and sapience');
  if (c.citizenship && (!c.sapience || !c.tools || !c.food.includes('settlement') || c.owner !== 'people')) fail('citizenship requires sapience, tools, settlement food and the people behavior contract');
  if (c.reproduction === 'family' && (!c.genealogy || !c.citizenship)) fail('family reproduction requires genealogy and citizenship');
  if (c.owner === 'people' && !c.citizenship) fail('people behavior requires citizenship');
  if (c.owner === 'husbandry' && c.citizenship) fail('husbandry cannot also run citizen duties');
  if (c.owner === 'seafaring' && !c.movement.includes('sail')) fail('seafaring requires sailing');
  if (['dragons', 'ufos'].includes(c.owner) && !c.movement.includes('fly')) fail(`${c.owner} requires flight`);
  if (c.owner === 'movement' && (c.food.length || c.reproduction !== 'none' || c.citizenship)) fail('movement alone cannot supply nutrition, reproduction or citizen duties');
  if (c.movement.includes('fly') && c.movement.includes('sail')) fail('flight and a sailing hull require different movement handlers');
}
export function validateSpeciesComponents(profile: SpeciesProfile, definition: EntityDefinition, components: Components): void {
  const c = profile.runtime!;
  const require = (key: string, reason: string): void => {
    const value = components[key as keyof Components];
    if (!Object.hasOwn(components, key) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Species ${profile.id} (${definition.id}): ${reason} requires component ${key}`);
  };
  for (const key of ['position', 'health', ...ownerComponents[c.owner]]) require(key, c.owner);
  for (const [key, required] of Object.entries(capabilityComponents)) if (supportsCapability(c, key as Capability)) for (const component of required) require(component, key);
  for (const key of new Set(Object.values(ownerComponents).flat())) {
    if (Object.hasOwn(components, key) && !ownerComponents[c.owner].includes(key)) throw new Error(`Species ${profile.id}: component ${key} conflicts with ${c.owner} behavior`);
  }
}
