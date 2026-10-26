/** Reference families are descriptive groups, never executable inheritance. */
export const CREATURE_FAMILIES = [
  ['basic', 'Basic units', 'Shared foundations; each species keeps its own parameters.'],
  ['special', 'Special units', 'Vessels and unique creatures keep separate behavior.'],
  ['black-ant', 'Free-moving terraformers', 'Movement without citizen duties or genealogy.'],
  ['colored', 'Colored units', 'Young forms, body resources and appearance.'],
  ['animal-base', 'Animal base', 'Animal life without automatic citizenship.'],
  ['fur', 'Fur animals', 'Fur appearance and body resources.'],
  ['skin', 'Skin animals', 'Skin appearance and body resources.'],
  ['animal', 'Animals', 'Animal feeding and combat.'],
  ['peaceful', 'Peaceful animals', 'Peaceful behavior is independent of intelligence.'],
  ['herbivore', 'Herbivores', 'Feeding on plants.'],
  ['insect', 'Insects', 'Small creatures without an automatic child form.'],
  ['carnivore', 'Carnivores', 'Hunting and feeding on prey.'],
  ['omnivore', 'Omnivores', 'More than one source of food.'],
  ['flying-insect', 'Flying insects', 'Flight without citizen duties or a required swimming ability.'],
  ['civil', 'Civil units', 'Tools, families and settlement life.'],
  ['advanced-civil', 'Advanced civil units', 'Humanoid clothing in addition to settlement life.'],
  ['animal-civil', 'Civil animals', 'Intelligent animals use the same settlement rules as people.'],
  ['no-genes', 'Creatures without genes', 'Genome editing, genome budget and subspecies are separate.'],
  ['mob', 'Other creatures', 'Species-specific combat and transformations.'],
  ['fire-elemental', 'Fire elementals', 'Distinct fiery forms.'],
  ['creep', 'Creep creatures', 'Distinct growth and appearance rules.'],
  ['tumor-unit', 'Tumor creatures', 'Separate biological origins and transformations.'],
  ['mush', 'Mush creatures', 'Fungal origins and appearance.'],
  ['tumor-animal', 'Tumor animals', 'Animal forms without automatic item use.'],
] as const;
export type CreatureFamilyId = typeof CREATURE_FAMILIES[number][0];
export const validCreatureFamily = (id: string): id is CreatureFamilyId => CREATURE_FAMILIES.some(row => row[0] === id);
