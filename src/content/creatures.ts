import type { Registry } from './registry';
import type { SpeciesProfile } from '../core/creatures';
import { BASIC_CAPABILITIES, CIVIL_CAPABILITIES } from '../core/capabilities';
import { integer, record, reference } from '../core/validation';
import { compatibilityParameters } from './species-profiles';

export const CREATURE_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Category:Creatures?oldid=23045';
const slug = (name: string): string => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
const profile = (name: string, ownerPlan: number, group: SpeciesProfile['group'], form: SpeciesProfile['form'] = 'ordinary'): SpeciesProfile => ({
  id: slug(name), label: `species:${slug(name)}`, sourceName: name, source: CREATURE_SOURCE, ownerPlan, group, form, support: 'unavailable',
});
const catalogue: SpeciesProfile[] = [];
const add = (name: string, plan: number, group: SpeciesProfile['group'], form?: SpeciesProfile['form']): SpeciesProfile => {
  const p = profile(name, plan, group, form); catalogue.push(p); return p;
};
const pair = (name: string, evolved: string, plan: number, group: SpeciesProfile['group']): void => {
  const a = add(name, plan, group), b = add(evolved, plan, group, 'ascended');
  a.counterpart = b.id; b.counterpart = a.id; a.socialForm = 'separate-body';
};
for (const [name, plan] of [['Human', 96], ['Elf', 97], ['Orc', 98], ['Dwarf', 99]] as const) add(name, plan, 'people');
for (const [name, plan] of [['Snowman', 168], ['Evil Mage', 172], ['White Mage', 172], ['Necromancer', 172], ['Druid', 172], ['Plague Doctor', 172], ['Cold One', 169], ['Demon', 170], ['Angle', 171], ['Alien', 176]] as const) add(name, plan, 'humanoids');
for (const [name, evolved, plan] of [
  ['Sheep', 'Baakin', 129], ['Dog', 'Barkfolk', 130], ['Wolf', 'Howleer', 131], ['Cow', 'Mootaur', 132],
  ['Chicken', 'Pecklord', 133], ['Cat', 'Meowmorph', 134], ['Rabbit', 'Hopper', 135], ['Fox', 'Slypaw', 136],
  ['Bear', 'Grranth', 137], ['Monkey', 'Monke', 138], ['Goat', 'Herdor', 139], ['Alpaca', 'Charmaca', 140],
  ['Capybara', 'Chillbara', 141], ['Armadillo', 'Armaldar', 142], ['Rhino', 'Armoroc', 143], ['Buffalo', 'Buffolon', 144],
  ['Hyena', 'Lulclaw', 145], ['Rat', 'Nibling', 146], ['Raccoon', 'Bandit', 147], ['Penguin', 'Coolbeak', 149],
  ['Crab', 'Crablin', 150], ['Scorpion', 'Scorp', 151], ['Turtle', 'Turtok', 152], ['Crocodile', 'Reptiloid', 153],
  ['Snake', 'Snok', 154], ['Frog', 'Ribbit', 155], ['Piranha', 'Gnapkin', 156], ['Seal', 'Navy Seal', 157],
] as const) pair(name, evolved, plan, 'animals');
add('Ostrich', 148, 'animals');
for (const [name, evolved, plan] of [['Flower Bud', 'Lulliar', 160], ['Crystal Sword', 'Crystal Golem', 161], ['Bitba', 'Lemon Man', 162], ['Garl', 'Garlic Man', 163], ['Smore', 'Candy Man', 164], ['Acid Blob', 'Acid Gentleman', 165], ['Unicorn', 'Punkcorn', 166]] as const) pair(name, evolved, plan, 'special');
add('Fairy', 167, 'special');
for (const name of ['Bee', 'Butterfly', 'Grasshopper', 'Fly']) add(name, 158, 'insects').socialForm = 'same-body';
pair('Beetle', 'Dunglord', 159, 'insects');
for (const [name, plan] of [
  ['Crabzilla', 217], ['Dragon', 177], ['UFO', 176], ['Living Plant', 178], ['Living House', 178],
  ['Tumor Monster Humanoid', 186], ['Tumor Monster Animal', 186], ['Bioblob', 187], ['Lil Pumpkin', 189], ['Assimilator', 188],
  ['Zombie', 184], ['Skeleton', 182], ['Ghost', 183], ['MUSH Humanoid', 185], ['MUSH Animal', 185],
  ['Rude Skull', 175], ['Fire Skull', 174], ['Fire Elemental Man', 173], ['Fire Elemental Blob', 173],
  ['Fire Elemental Horse', 173], ['Fire Elemental Slug', 173], ['Fire Elemental Snake', 173], ['Greg', 216], ['Boat', 94],
  ['Robot Santa', 218], ['Tutorial Bear', 236],
] as const) add(name, plan, 'unique', 'unique');
for (const name of ['God Finger', 'Blue Langton Ant', 'Green Langton Ant', 'Black Langton Ant', 'Red Langton Ant', 'Printer', 'Sand Spider', 'Worm', 'Conways']) add(name, 208, 'terraformers', 'unique');
add('Grey Goo', 209, 'terraformers', 'unique');
for (const name of ['Rat King', 'Candy Bear']) add(name, 14, 'historical', 'historical').support = 'removed';
for (const name of ['Bird', 'Lion', 'River Turtle', 'Rooster', 'Shaved Sheep', 'Super Skeleton', 'Vulture']) add(name, 14, 'historical', 'historical').support = 'unused';
add('Tornado', 204, 'historical', 'historical').support = 'phenomenon';

/** Bind only existing entities. A sprite or an equipment definition is not species support. */
export const CREATURE_BINDINGS: Readonly<Record<string, string>> = {
  'core:person': 'human', 'core:elf': 'elf', 'core:orc': 'orc', 'core:dwarf': 'dwarf',
  'core:sheep': 'sheep', 'core:dog': 'dog', 'core:wolf': 'wolf',
  'core:dragon': 'dragon', 'core:ufo': 'ufo', 'core:kaiju': 'crabzilla', 'core:ship': 'boat',
};
for (const p of catalogue) {
  if (!Object.values(CREATURE_BINDINGS).includes(p.id)) continue;
  const people = p.group === 'people', animal = p.group === 'animals';
  p.parameters = compatibilityParameters(p.id);
  p.support = 'partial';
  p.label = p.id === 'crabzilla' ? 'Giant Kaiju' : p.id === 'boat' ? 'Ship' : p.id === 'ufo' ? 'Flying saucer' : p.sourceName;
  p.runtime = {
    ...(people ? CIVIL_CAPABILITIES : BASIC_CAPABILITIES),
    genomeEditor: !!p.parameters?.genomeBudget, genomeBudget: !!p.parameters?.genomeBudget,
    families: people ? ['basic', 'colored', 'civil', 'advanced-civil'] : animal
      ? ['basic', 'colored', 'animal-base', 'fur', ...(p.id === 'sheep' ? ['peaceful', 'herbivore'] as const : p.id === 'wolf' ? ['animal', 'carnivore'] as const : ['animal'] as const)] : ['special'],
    owner: people ? 'people' : animal ? 'husbandry' : p.id === 'boat' ? 'seafaring' : p.id === 'crabzilla' ? 'kaiju' : p.id === 'dragon' ? 'dragons' : 'ufos',
    movement: people || p.id === 'crabzilla' ? ['walk', 'swim'] : animal ? ['walk'] : p.id === 'boat' ? ['sail'] : ['fly'],
    amygdala: people || animal,
    citizenship: people, size: people ? 'resident' : animal ? 'animal' : p.id === 'boat' || p.id === 'ufo' ? 'vessel' : 'giant',
    food: people ? ['settlement'] : p.id === 'sheep' ? ['graze', 'care'] : p.id === 'wolf' ? ['hunt', 'care'] : p.id === 'dog' ? ['care'] : [],
    reproduction: people ? 'family' : p.id === 'sheep' ? 'herd' : 'none',
    relations: { friendship: people || p.id === 'dog', war: people || p.id === 'dog', prey: p.id === 'wolf' ? ['sheep'] : [], defendAgainst: p.id === 'dog' ? ['wolf'] : [] },
    death: p.id === 'boat' || p.id === 'ufo' ? 'vehicle' : 'organic', transitions: [],
    abilities: people ? ['work', 'family', 'guard'] : p.id === 'sheep' ? ['graze', 'herd'] : p.id === 'wolf' ? ['hunt'] : p.id === 'dog' ? ['guard']
      : p.id === 'boat' ? ['fish', 'trade'] : p.id === 'dragon' ? ['fire-breath'] : p.id === 'crabzilla' ? ['beam', 'crush'] : ['beam'],
  };
}
export const CREATURE_CATALOGUE: readonly SpeciesProfile[] = catalogue;

export function registerCreatures(registry: Registry): void {
  for (const p of catalogue) registry.registerSpecies(structuredClone(p));
  registry.registerComponent('creature', v => typeof v.speciesId === 'string' && !!registry.species.get(v.speciesId)?.runtime
    && ['natural', 'placed', 'cloned', 'born', 'transformed', 'legacy'].includes(String(v.origin))
    && (v.origin === 'legacy' ? v.since === null : integer(v.since))
    && (v.result === undefined || record(v.result) && ['fed', 'born', 'hit', 'lost-target'].includes(String(v.result.kind)) && integer(v.result.at) && reference(v.result.targetId)));
  for (const [entityId, speciesId] of Object.entries(CREATURE_BINDINGS)) registry.bindSpecies(entityId, speciesId);
}
