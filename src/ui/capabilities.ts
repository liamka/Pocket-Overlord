import { CAPABILITIES, hasCapability, supportsCapability, type Capability, type CreatureCapabilities } from '../core/capabilities';
import { translate, type Language } from '../i18n';
import type { Entity } from '../core/types';
import type { World } from '../core/world';

export const CAPABILITY_LABELS: Record<Capability, string> = {
  amygdala: 'Emotional capacity', nutrition: 'Feeding', genealogy: 'Genealogy', genomeEditor: 'Genome editing', genomeBudget: 'Genome budget', subspecies: 'Subspecies',
  clothing: 'Clothing', tools: 'Tool use', flight: 'Flight', statusLevels: 'Experience levels', sapience: 'Sapience', citizenship: 'Settlement life', governance: 'City leadership',
};
export function capabilityLines(c: CreatureCapabilities, language: Language): string[] {
  const label = (key: Capability): string => translate(CAPABILITY_LABELS[key], language);
  return [translate('Available capabilities: {abilities}', language, { abilities: CAPABILITIES.filter(key => supportsCapability(c, key)).map(label).join(', ') || translate('None', language) }),
    translate('Unavailable capabilities: {abilities}', language, { abilities: CAPABILITIES.filter(key => !supportsCapability(c, key)).map(label).join(', ') || translate('None', language) })];
}
export function suspendedCapabilities(world: World, entity: Entity, language: Language): string | undefined {
  const suspended = CAPABILITIES.filter(key => hasCapability(world.registry, entity, key) && !hasCapability(world.registry, entity, key, true));
  if (!suspended.length) return;
  return translate('Madness suspends: {abilities}', language, { abilities: suspended.map(key => translate(CAPABILITY_LABELS[key], language)).join(', ') });
}
