import { isAdult } from '../core/unit-stats';
import type { Registry } from './registry';
import { clouds } from '../core/clouds';
import { marked, rebirthEligible, transformLiving, type FormMark, type TransformationDefinition } from '../core/metamorphosis';
import { speciesOf } from '../core/creatures';
import { deathOf } from '../core/death';
import { NaturalBiome } from '../core/natural-biomes';
import { atWar } from '../systems/society';
import { integer } from '../core/validation';
import { validMetamorphosis, validTransformationContext } from '../persistence/metamorphosis';

export function registerMetamorphosis(registry: Registry): void {
  registry.registerComponent('metamorphosis', validMetamorphosis);
  registry.registerEvent({ kind: 'transform', validate: v => integer(v.target, 1) && validTransformationContext(v.context),
    apply: (world, event) => { transformLiving(world, event.target, event.context); } });
}

/** Run after all packs. Catalogue entries without an executable body never unlock a rule. */
export function registerAvailableTransformations(registry: Registry): void {
  const bodies = [...registry.entities.values()].filter(e => !!registry.species.get(e.speciesId ?? '')?.runtime);
  const organic = bodies.filter(e => registry.species.get(e.speciesId!)!.runtime!.death === 'organic').map(e => e.id);
  const mortals = organic.filter(id => ['people', 'husbandry'].includes(registry.species.get(registry.entities.get(id)!.speciesId!)!.runtime!.owner));
  const target = (species: string): string | undefined => bodies.find(e => e.speciesId === species)?.id;
  const remove: FormMark[] = ['infected', 'mush', 'tumor', 'cursed', 'rage', 'rebirth', 'wolf-rebirth'];
  const base = { trigger: 'death', change: 'body', identity: 'continue', items: 'compatible-or-ground', remove } as const;
  const add = (definition: TransformationDefinition): void => { if (!registry.transformations.has(definition.id)) registry.registerTransformation(definition); };
  if (mortals.length) add({ ...base, id: 'core:rebirth', label: 'Rebirth in own species', sources: mortals, target: 'self', priority: 10, rejuvenate: true,
    eligible: (_world, e) => marked(e, 'rebirth') && rebirthEligible(e) });
  const wolf = target('wolf');
  if (wolf && mortals.length) add({ ...base, id: 'core:wolf-rebirth', label: 'Wolf rebirth', sources: mortals, target: wolf, priority: 20, rejuvenate: true,
    eligible: (_world, e) => marked(e, 'wolf-rebirth') && rebirthEligible(e) });
  // Our conflict order: infection > spores > tumor > curse > wolf rebirth > own rebirth.
  // No mark is applied or spread here; its owner supplies the trigger.
  const excluded = ['zombie', 'snowman', 'angle', 'ghost', 'rude-skull', 'fire-skull', 'skeleton', 'assimilator', 'crabzilla', 'living-plant', 'living-house'];
  const compatible = organic.filter(id => {
    const p = registry.species.get(registry.entities.get(id)!.speciesId!)!;
    return !excluded.includes(p.id) && !p.id.startsWith('fire-elemental') && !p.id.startsWith('mush-') && p.group !== 'terraformers';
  });
  for (const [mark, humanoid, animal, label, priority] of [
    ['infected', 'zombie', 'zombie', 'Infection changed the body', 100],
    ['mush', 'mush-humanoid', 'mush-animal', 'Spores changed the body', 90],
    ['tumor', 'tumor-monster-humanoid', 'tumor-monster-animal', 'Tumor changed the body', 80],
    ['cursed', 'skeleton', null, 'Curse changed the body', 70],
  ] as const) {
    for (const [kind, species] of [['humanoid', humanoid], ['animal', animal]] as const) {
      const body = species && target(species);
      const sources = compatible.filter(id => {
        const p = registry.species.get(registry.entities.get(id)!.speciesId!)!;
        const human = p.runtime!.sapience;
        if ((kind === 'humanoid') !== human) return false;
        if (mark === 'infected' && ['bioblob', 'lil-pumpkin'].includes(p.id) || mark === 'infected' && p.id.startsWith('tumor-')) return false;
        return mark !== 'mush' || p.id !== 'dragon';
      });
      if (body && sources.length) add({ ...base, id: `core:${mark}-${kind}`, label, priority, sources, target: body,
        eligible: (_world, e) => marked(e, mark) });
    }
  }
  const ghost = target('ghost');
  if (ghost) add({ ...base, id: 'core:ghost-echo', label: 'A soul remained on corrupted land', priority: 0, sources: organic.filter(id => id !== ghost),
    target: ghost, identity: 'new', items: 'leave', additional: true,
    eligible: (world, e) => !!e.components.position && (marked(e, 'soul') || !!speciesOf(registry, e)?.runtime?.sapience)
      && !['demon', 'cold-one'].includes(e.components.creature?.speciesId ?? '')
      && world.terrain.biomeAt(e.components.position.x, e.components.position.y).id === NaturalBiome.Corrupted });
  const demon = target('demon');
  if (demon) add({ ...base, id: 'core:rage-demon', label: 'Rage changed the body', trigger: 'enemy-killed', target: demon, sources: organic, priority: 50, chance: 0.1,
    eligible: (world, e, context) => {
      const death = deathOf(world, context.sourceId ?? -1);
      return context.age === 'chaos' && context.disasters === true && !marked(e, 'blessed') && !e.components.unit?.favorite
        && marked(e, 'rage') && isAdult(e) && !!speciesOf(registry, e)?.runtime?.sapience
        && death?.tick === world.tick && death.cause === 'conflict' && death.warrior === true && death.initiator?.id === e.id
        && atWar(world, e.components.citizen?.villageId ?? null, death.villageId);
    } });
  const cold = target('cold-one');
  if (cold) add({ ...base, id: 'core:despair-cold', label: 'Despair changed the body', trigger: 'snow', target: cold, sources: organic, priority: 40,
    eligible: (world, e, context) => context.age === 'despair' && context.disasters === true
      && (context.sourceId !== undefined && world.entities.has(context.sourceId)
        || context.cloudId !== undefined && clouds(world).some(c => c.id === context.cloudId && c.type === 'snow'))
      && !isAdult(e) && !!speciesOf(registry, e)?.runtime?.sapience });
  for (const body of bodies) {
    const profile = registry.species.get(body.speciesId!)!, evolved = profile.counterpart && target(profile.counterpart);
    if (!evolved || profile.form !== 'ordinary') continue;
    add({ ...base, id: `core:evolve-${profile.id}`, label: 'Monolith evolution', trigger: 'monolith', sources: [body.id], target: evolved, priority: 30,
      eligible: (world, e, context) => !marked(e, 'pure') && world.entities.get(context.sourceId ?? -1)?.typeId === 'core:monolith' });
  }
}
