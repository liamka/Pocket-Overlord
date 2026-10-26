import type { StatModifier } from '../core/unit-stats';
import { BIOME_ADAPTATIONS } from './biome-profiles';

/** Physiology owns permissions, not food properties, bodies, cultures or epochs.
 * Reference: Subspecies Traits, revision 23068. Rarity weights are 10/6/3/1;
 * assignments without a readable rarity icon are deliberately local balance. */
export const DIET_TRAITS = ['omnivore', 'herbivore', 'carnivore', 'cannibalism', 'algivore', 'florivore', 'folivore', 'frugivore', 'geophagy', 'graminivore', 'granivore', 'hematophagy', 'insectivore', 'lithotroph', 'nectarivore', 'piscivore', 'xylophagy'] as const;
export const PRODUCTION_TRAITS = ['gem-production', 'gold-production', 'stone-production', 'mushroom-production'] as const;
export const POPULATION_TRAITS = ['minimal-population', 'small-population', 'moderate-population', 'large-population', 'expansive-population'] as const;
export const REBIRTH_TRAITS = ['fenix-born', 'butterfly-metamorphosis', 'chicken-metamorphosis', 'crab-metamorphosis', 'sword-metamorphosis', 'wolf-metamorphosis', 'fire-elemental-form'] as const;
export const METHOD_TRAITS = ['sexual', 'hermaphroditic', 'parthenogenesis', 'budding', 'fission', 'spore', 'vegetative', 'divine', 'soulborne', 'metamorph'] as const;
export const GESTATION_TRAITS = ['short-gestation', 'moderate-gestation', 'long-gestation', 'very-long-gestation', 'extremely-long-gestation'] as const;
export const EGG_TRAITS = ['alien-egg', 'blob-egg', 'bubble-egg', 'candy-egg', 'cocoon-egg', 'colored-egg', 'crystal-egg', 'eyeball-egg', 'face-egg', 'flames-egg', 'ice-egg', 'metal-box-egg', 'orb-egg', 'pumpkin-egg', 'rainbow-egg', 'roe-egg', 'plain-shell-egg', 'spotted-shell-egg'] as const;
export const FORM_TRAITS = ['light-orb', 'abomination', 'blood-vortex', 'burger-being', 'energy-being', 'fractal', 'living-rock', 'orb', 'tentacle-horror', 'void-form'] as const;
export const PHYSIOLOGY_IDS = [
  ...POPULATION_TRAITS, 'sapience', 'advanced-hippocampus', 'amygdala', 'wernickes-area',
  'cautious-instincts', 'inquisitive-nature', 'dreamweavers', 'fast-builders', 'slow-builders', 'hyper-intelligence', 'genetic-psychosis', 'pure', 'super-positivity', 'telepathic-link',
  'stomach', 'big-stomach', 'voracious', 'accelerated-healing', 'bad-genes', 'aquatic', 'fins', 'hovering', 'unmoving', 'cold-resistance', 'heat-resistance', 'exoskeleton',
  'bioluminescence', 'enhanced-strength', 'good-throwers', 'high-fecundity', 'long-lifespan', 'hydrophobia', 'pollinator', ...DIET_TRAITS, 'photosynthetic-skin', ...REBIRTH_TRAITS,
  'mythril-form', 'plant-growth', 'tree-growth', 'gaia-roots', 'parental-care', 'rapid-aging', ...PRODUCTION_TRAITS,
  'aggressive', 'annoying-fireworks', 'antimatter-essence', 'genetic-mirror', 'unstable-genome', 'nimble', 'shiny-love', 'spicy-kids',
  'gift-of-air', 'gift-of-blood', 'gift-of-death', 'gift-of-fire', 'gift-of-harmony', 'gift-of-life', 'gift-of-thunder', 'gift-of-the-void', 'gift-of-water',
  'energy-preserver', 'polyphasic-sleep', 'monophasic-sleep', 'prolonged-rest', 'nocturnal-dormancy', 'circadian-drift', 'winter-slumberers', 'chaos-driven',
  'oviparity', 'viviparity', ...METHOD_TRAITS, ...GESTATION_TRAITS, ...EGG_TRAITS, ...FORM_TRAITS, ...BIOME_ADAPTATIONS, 'wasteland-adaptation',
  'grin-mark', 'gmo', 'uplifted',
  // Existing independent permissions survive older saves; not extra wiki traits.
  'genealogy', 'tools', 'governance',
] as const;
export type PhysiologyId = typeof PHYSIOLOGY_IDS[number];
export interface PhysiologyDefinition {
  id: PhysiologyId; label: string; opposites: PhysiologyId[]; requires: PhysiologyId[];
  random: boolean; mutationRemoval: boolean; zombieRemoval: boolean; weight: 10 | 6 | 3 | 1;
  flat: StatModifier['flat']; percent: StatModifier['percent'];
  /** A missing owner is shown explicitly, never a successful no-op. */
  owner?: 'culture' | 'body' | 'epoch' | 'mythril' | 'appearance' | 'power';
}
const removed = new Set<string>(['cautious-instincts', 'inquisitive-nature', 'dreamweavers', 'fast-builders', 'slow-builders', 'genetic-psychosis', 'hyper-intelligence', 'super-positivity', 'telepathic-link',
  'accelerated-healing', 'aquatic', 'bad-genes', 'bioluminescence', 'cold-resistance', 'heat-resistance', 'enhanced-strength', 'exoskeleton', 'fins', 'good-throwers', 'hovering', 'long-lifespan', 'pollinator', 'unmoving',
  ...REBIRTH_TRAITS, 'mythril-form', 'plant-growth', 'tree-growth', ...PRODUCTION_TRAITS, 'nimble']);
const zombie = new Set<string>(['dreamweavers', 'genetic-psychosis', 'hyper-intelligence', 'pure', 'super-positivity', 'telepathic-link', 'stomach', 'big-stomach', 'accelerated-healing', 'bad-genes', 'long-lifespan', 'unmoving',
  ...DIET_TRAITS, 'photosynthetic-skin', 'oviparity', 'viviparity', ...METHOD_TRAITS, ...GESTATION_TRAITS, ...EGG_TRAITS]);
const manual = new Set<string>(['grin-mark', 'antimatter-essence', 'geophagy', 'unmoving', 'gmo', 'uplifted', ...FORM_TRAITS, 'genealogy', 'tools', 'governance']);
const labels: Partial<Record<PhysiologyId, string>> = { sapience: 'Prefrontal Cortex', 'wernickes-area': "Wernicke’s Area", 'gmo': 'GMO', 'fenix-born': 'Fenix Born', 'light-orb': 'The Light Orb', orb: 'The Orb' };
export const PHYSIOLOGY: Record<PhysiologyId, PhysiologyDefinition> = Object.fromEntries(PHYSIOLOGY_IDS.map((id): [PhysiologyId, PhysiologyDefinition] => [id, {
  id, label: labels[id] ?? id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' '), opposites: [], requires: [],
  random: !manual.has(id), mutationRemoval: removed.has(id), zombieRemoval: zombie.has(id), weight: 10, flat: {}, percent: {},
} satisfies PhysiologyDefinition])) as Record<PhysiologyId, PhysiologyDefinition>;
function excludes(...ids: PhysiologyId[]): void { for (const id of ids) for (const other of ids) if (id !== other && !PHYSIOLOGY[id].opposites.includes(other)) PHYSIOLOGY[id].opposites.push(other); }
excludes(...POPULATION_TRAITS); excludes(...REBIRTH_TRAITS); excludes('mythril-form', 'plant-growth', 'tree-growth'); excludes(...GESTATION_TRAITS); excludes(...EGG_TRAITS); excludes(...FORM_TRAITS);
excludes('fast-builders', 'slow-builders'); excludes('polyphasic-sleep', 'monophasic-sleep'); excludes('oviparity', 'viviparity');
for (const id of ['frugivore', 'granivore', 'florivore', 'folivore', 'carnivore', 'piscivore', 'herbivore'] as const) excludes('omnivore', id);
for (const id of ['frugivore', 'granivore', 'florivore', 'folivore', 'piscivore'] as const) excludes('herbivore', id);
excludes('sexual', 'hermaphroditic'); excludes('hermaphroditic', 'parthenogenesis'); excludes('divine', 'parthenogenesis');
for (const id of ['budding', 'fission', 'spore', 'vegetative'] as const) {
  for (const other of METHOD_TRAITS) if (other !== id && other !== 'soulborne' && other !== 'metamorph') excludes(id, other);
  excludes(id, 'viviparity'); if (id !== 'spore') excludes(id, 'oviparity');
}
for (const id of [...DIET_TRAITS, ...PRODUCTION_TRAITS, 'big-stomach'] as const) PHYSIOLOGY[id].requires = ['stomach'];
for (const id of EGG_TRAITS) PHYSIOLOGY[id].requires = ['oviparity'];
for (const [id, flat] of Object.entries({ 'fast-builders': { construction: 2 }, 'slow-builders': { construction: -1 }, 'hyper-intelligence': { intelligence: 30 },
  'big-stomach': { nutrition: 100 }, voracious: { metabolicRate: 10 }, 'enhanced-strength': { damage: 50 }, 'long-lifespan': { lifespan: 100 } })) PHYSIOLOGY[id as PhysiologyId].flat = flat;
PHYSIOLOGY.exoskeleton.percent = { armor: 10 };
for (const id of ['advanced-hippocampus', 'dreamweavers'] as const) PHYSIOLOGY[id].owner = 'culture';
for (const id of ['butterfly-metamorphosis', 'chicken-metamorphosis', 'crab-metamorphosis', 'sword-metamorphosis', 'fire-elemental-form'] as const) PHYSIOLOGY[id].owner = 'body';
PHYSIOLOGY['mythril-form'].owner = 'mythril';
for (const id of FORM_TRAITS) PHYSIOLOGY[id].owner = 'appearance';
for (const id of ['gift-of-air', 'gift-of-blood', 'gift-of-death', 'gift-of-harmony'] as const) PHYSIOLOGY[id].owner = 'power';
for (const id of ['dreamweavers', 'hyper-intelligence', 'aquatic', 'enhanced-strength', 'fins', 'genetic-mirror', 'unstable-genome'] as const) PHYSIOLOGY[id].weight = 3;
for (const id of ['pure', 'antimatter-essence', 'divine', 'grin-mark'] as const) PHYSIOLOGY[id].weight = 1;
for (const id of ['lithotroph', 'photosynthetic-skin', 'pollinator', 'nimble', 'telepathic-link'] as const) PHYSIOLOGY[id].weight = 6;

export function isPhysiologyId(id: unknown): id is PhysiologyId { return typeof id === 'string' && Object.hasOwn(PHYSIOLOGY, id); }
export function validPhysiology(ids: unknown): ids is PhysiologyId[] {
  return Array.isArray(ids) && new Set(ids).size === ids.length && ids.every(isPhysiologyId)
    && ids.every(id => PHYSIOLOGY[id].requires.every(required => ids.includes(required)) && PHYSIOLOGY[id].opposites.every(other => !ids.includes(other)));
}
/** Normalize add/remove side effects on a draft. No shared state, RNG or recipients touched. */
export function changePhysiology(before: readonly PhysiologyId[], id: PhysiologyId, enabled: boolean): PhysiologyId[] {
  const next = new Set(before);
  const add = (trait: PhysiologyId): void => {
    for (const required of PHYSIOLOGY[trait].requires) if (!next.has(required)) add(required);
    for (const opposite of PHYSIOLOGY[trait].opposites) next.delete(opposite);
    const firstStomach = trait === 'stomach' && !next.has(trait);
    next.add(trait);
    if (firstStomach) add('omnivore');
  };
  if (enabled) add(id); else next.delete(id);
  for (const trait of next) if (PHYSIOLOGY[trait].requires.some(required => !next.has(required))) next.delete(trait);
  return PHYSIOLOGY_IDS.filter(trait => next.has(trait));
}
