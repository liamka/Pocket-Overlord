import { reproductionSex } from '../core/reproduction-state';
import type { Registry } from './registry';
import { reproductionProfile } from '../core/reproduction';
import { isAdult } from '../core/unit-stats';
import { marked } from '../core/metamorphosis';

/** Reuse the body-transition owner; no replacement entity, second death or duplicate loot. */
export function registerReproductionForms(registry: Registry): void {
  const types = [...registry.entities.values()].filter(d => registry.species.get(d.speciesId ?? '')?.runtime?.death === 'organic');
  for (const target of types) {
    const owner = registry.species.get(target.speciesId!)?.runtime?.owner;
    if (owner !== 'people' && owner !== 'husbandry') continue;
    registry.registerTransformation({ id: `core:reproduction-${target.speciesId}`, label: 'Changed by reproductive metamorphosis',
      trigger: 'subspecies', sources: types.map(d => d.id), target: target.id, priority: 100,
      change: 'body', identity: 'continue', items: 'compatible-or-ground', remove: ['cursed', 'infected', 'mush', 'tumor'],
      eligible: (world, victim, context) => {
        const actor = world.entities.get(context.sourceId ?? -1);
        return !!actor && actor.typeId === target.id && actor.id !== victim.id && !victim.components.reproduction?.egg
          && reproductionProfile(actor)?.methods.includes('metamorph') === true && !isAdult(victim)
          && (marked(victim, 'soul') || !!registry.species.get(victim.components.creature?.speciesId ?? '')?.runtime?.sapience)
          && victim.components.subspecies?.id !== actor.components.subspecies?.id;
      },
      migrate: (components, source, world, context) => {
        const actor = world.entities.get(context.sourceId!)!;
        components.subspecies = { id: actor.components.subspecies!.id, deviations: {} };
        if (source.components.reproduction) {
          components.reproduction = structuredClone(source.components.reproduction);
          delete components.reproduction.pending; delete components.reproduction.egg;
          if (components.person) { components.person.sex = reproductionSex(source); delete components.reproduction.sex; }
          else components.reproduction.sex = reproductionSex(source);
        }
        if (components.health && source.components.health) components.health.current = Math.min(components.health.max, source.components.health.current);
      },
    });
  }
}
