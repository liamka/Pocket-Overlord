import type { StatValues } from '../core/unit-stats';
import { GOLD } from '../core/gold';

export type TraitTrigger = 'birth' | 'inherit' | 'grow' | 'book' | 'hit' | 'hurt' | 'death' | 'kill' | 'periodic' | 'year' | 'editor';
export interface TraitDefinition {
  id: string; label: string; birth: number; inherit: number; grow: number;
  conflicts: string[]; flat: Partial<StatValues>; percent: Partial<StatValues>;
  sameOpinion: number; oppositeOpinion: number; randomBirth: boolean;
  scope: 'body' | 'person' | 'special'; cure: boolean; interval?: number;
  /** Effects belonging to future systems are explicit, never presented as working abilities. */
  pending?: 'actions' | 'statuses' | 'epochs' | 'reproduction' | 'plants' | 'religion' | 'money';
  external: Record<string, number>; triggers: TraitTrigger[];
}
// B/I/G are weights, not percentages. Zero keeps event/editor acquisition possible.
// Numeric data: Creature Traits, indexed source; revision 23172 could not be fetched.
const rows: [string, number, number, number][] = [
  ['Eagle Eyed',3,5,0],['Genius',1,0,0],['Short Sighted',5,5,0],['Stupid',3,0,0],['Thief',1,0,0],['Wise',0,0,0],
  ['Ambitious',1,0,5],['Arcane Reflexes',0,5,0],['Battle Reflexes',0,5,0],['Content',2,0,5],['Deceitful',0,0,5],['Evil',0,0,0],
  ['Gluttonous',4,5,0],['Greedy',1,0,5],['Honest',2,0,5],['Hotheaded',2,0,0],['Lustful',1,0,5],['Paranoid',1,0,5],
  ['Peaceful',0,0,0],['Psychopath',1,0,0],['Pyromaniac',0,1,2],['Strong Minded',0,0,0],
  ['Bloodlust',1,5,4],['Burning Feet',0,3,0],['Cold Aura',0,3,0],['Flesh Eater',1,5,0],['Healing Aura',0,5,0],['Heart of Wizard',0,5,0],
  ['Lucky',2,5,0],['Moonchild',1,5,0],['Nightchild',1,5,0],['Pacifist',0,5,3],['Savage',0,5,2],['Unlucky',3,5,0],
  ['Agile',3,5,0],['Clumsy',5,5,0],['Fast',4,5,0],['Fat',7,5,0],['Giant',2,7,0],['Hard Skin',5,5,0],['Slow',6,5,0],
  ['Soft Skin',5,5,0],['Strong',4,0,0],['Tiny',4,7,0],['Tough',2,0,0],['Weak',5,0,0],['Weightless',1,5,0],
  ['Boosted Vitality',5,5,0],['Fertile',3,7,0],['Fragile Health',5,5,0],['Immortal',0,0,0],['Immune',1,10,0],['Infertile',1,5,0],
  ['Long Liver',2,5,0],['Regeneration',1,5,0],['Super Health',0,3,0],['Acid Blood',0,5,0],['Acid Touch',0,0,0],['Fire Blood',0,5,0],
  ['Heliophobia',0,10,0],['Mute',1,5,0],['Poisonous',0,5,0],['Sunblessed',2,5,0],["Titan's Lungs",0,5,0],['Venomous',0,5,0],
  ['Attractive',3,5,0],['One Eyed',0,0,0],['Golden Tooth',0,0,0],['Skin Burns',0,0,0],['Ugly',7,0,0],
  ['Acid Proof',0,5,0],['Bubble Defense',0,3,0],['Fire Proof',0,5,0],['Frost Proof',0,5,0],['Poison Immunity',0,5,0],['Thorns',0,5,0],
  ['Backstep',0,0,0],['Block',0,0,0],['Dash',0,0,0],['Deflect Projectiles',0,0,0],['Dodge',0,0,0],
  ['Dragonslayer',0,0,0],['Kingslayer',0,0,0],['Mageslayer',0,0,0],['Veteran',0,0,0],['Blessed',0,0,0],['Crippled',0,0,0],
  ['Infected',0,20,0],['MUSH Spores',0,30,0],['Plague',0,30,0],['Tumor Infection',0,30,0],
  ['Bomberman',0,0,0],['Death Bomb',0,1,0],['Death Nuke',0,1,0],['Energized',0,0,0],['Mega Heartbeat',0,4,0],['Whirlwind',0,0,0],
  ['The Chosen One',0,0,0],['Mark of Death',0,0,0],['Contagious',0,0,0],['Flower Prints',0,10,0],['Light Lamp',0,0,0],['Miner',0,0,5],['Shiny',0,10,0],
  ["It's a Boat",0,0,0],['Clone',0,0,0],['Alien Mold Desire',0,0,0],['Evil Computer Desire',0,0,0],['Golden Egg Desire',0,0,0],['Ethereal Harp Desire',0,0,0],
  ['Madness',0,0,0],['Metamorphed',0,0,0],['Miracle Bearer',0,0,0],['Miracle Born',0,0,0],['Scar of Divinity',0,0,0],['Zombie',0,0,0],
  ['Bioproduct Gold',0,5,0],
];
export const traitId = (label: string): string => label.toLowerCase().replace(/['’]/g, '').replaceAll(' ', '-');
export const traitDefinitions: Readonly<Record<string, TraitDefinition>> = Object.fromEntries(rows.map(([label,birth,inherit,grow]) => {
  const id = traitId(label);
  return [id, { id, label, birth, inherit, grow, conflicts: [], flat: {}, percent: {}, external: {}, sameOpinion: 0, oppositeOpinion: 0,
    randomBirth: true, scope: 'body', cure: false, triggers: [] } satisfies TraitDefinition];
}));
const edit = (id: string, patch: Partial<TraitDefinition>): void => { Object.assign(traitDefinitions[id], patch); };
// Explicitly bestowed or inherited; never a random source in an ordinary world.
edit('bioproduct-gold', { interval: GOLD.biologicalPeriod });
const modifiers = (id: string, flat: Partial<StatValues>, percent: Partial<StatValues> = {}, external: Record<string, number> = {}): void => edit(id, { flat, percent, external });
modifiers('eagle-eyed',{accuracy:5,critical:15}); modifiers('short-sighted',{accuracy:-5,critical:-5});
modifiers('genius',{intelligence:10,diplomacy:5,stewardship:7,warfare:5},{},{cities:3,loyalty:-10});
modifiers('stupid',{damage:5,intelligence:-5,diplomacy:-2,warfare:-2,stewardship:-5},{},{cities:-3,loyalty:-15});
modifiers('wise',{intelligence:1,diplomacy:1,stewardship:1,warfare:1});
modifiers('ambitious',{warfare:4,diplomacy:2,stewardship:1},{},{cities:5,loyalty:-15});
modifiers('arcane-reflexes',{spellcasting:50}); modifiers('battle-reflexes',{combatSkill:50});
modifiers('content',{diplomacy:2,stewardship:2,warfare:-2},{},{loyalty:10,supplyTimer:-0.3});
modifiers('deceitful',{stewardship:4,diplomacy:1},{},{loyalty:-20}); modifiers('evil',{warfare:10},{},{cities:-2});
modifiers('greedy',{warfare:4,diplomacy:-2,stewardship:-3},{},{cities:2,loyalty:-5,supplyTimer:4});
modifiers('honest',{stewardship:3,diplomacy:2,warfare:-2},{},{loyalty:5}); modifiers('lustful',{diplomacy:-2},{},{offspring:20});
modifiers('paranoid',{warfare:4,diplomacy:-2},{},{cities:-1,loyalty:-15,supplyTimer:0.5});
modifiers('bloodlust',{warfare:5},{},{cities:3,loyalty:-20,supplyTimer:1.5}); modifiers('heart-of-wizard',{},{mana:1000});
modifiers('lucky',{lifespan:7,accuracy:4,critical:30},{},{birthRate:5}); modifiers('unlucky',{lifespan:-13,accuracy:-4,critical:-30});
modifiers('moonchild',{intelligence:3,armor:1},{damage:50,speed:10}); modifiers('nightchild',{warfare:3,critical:3},{damage:50,speed:10});
modifiers('pacifist',{diplomacy:10,warfare:-4},{},{loyalty:50}); modifiers('agile',{stamina:20,lifespan:3,combatSkill:20},{hitSize:-10});
modifiers('clumsy',{},{lifespan:-50}); modifiers('long-liver',{},{lifespan:50}); modifiers('fast',{attackSpeed:5},{speed:30});
modifiers('fat',{},{hitSize:20,damage:10,stamina:-50,mass:30}); modifiers('giant',{},{hitSize:50,health:50,speed:-25});
modifiers('hard-skin',{armor:5}); modifiers('soft-skin',{armor:-5}); modifiers('slow',{attackSpeed:-5},{speed:-50});
modifiers('strong',{lifespan:3,warfare:2},{damage:50}); modifiers('weak',{damage:-2,warfare:-2,lifespan:-6},{damage:-50});
modifiers('tiny',{diplomacy:-1},{speed:25,hitSize:-20,health:-25}); modifiers('tough',{lifespan:4,warfare:1,armor:10});
modifiers('boosted-vitality',{},{health:50}); modifiers('fragile-health',{},{health:-50});
modifiers('fertile',{},{},{birthRate:4,offspring:40}); modifiers('infertile',{},{},{offspring:-99999});
modifiers('immortal',{},{},{loyalty:-20}); modifiers('super-health',{lifespan:100},{health:10000}); modifiers('titans-lungs',{},{stamina:1000});
modifiers('attractive',{diplomacy:2,stewardship:1,critical:10},{},{offspring:60}); modifiers('ugly',{},{},{offspring:-30});
modifiers('one-eyed',{diplomacy:1,warfare:-1,accuracy:-5,critical:-15}); modifiers('golden-tooth',{diplomacy:2});
modifiers('skin-burns',{warfare:2,diplomacy:-2,lifespan:-5},{speed:-25}); modifiers('crippled',{diplomacy:-3},{speed:-50},{offspring:-50});
modifiers('dragonslayer',{warfare:5,critical:4},{diplomacy:10}); modifiers('kingslayer',{warfare:5,diplomacy:-5},{},{loyalty:-25,supplyTimer:2});
modifiers('mageslayer',{warfare:5,critical:3},{},{loyalty:-10}); modifiers('veteran',{combatSkill:10},{damage:10,health:10});
modifiers('blessed',{lifespan:5,critical:10},{damage:50,health:50,speed:50,diplomacy:20});
modifiers('infected',{},{speed:10},{loyalty:-15}); modifiers('mush-spores',{},{speed:30},{loyalty:-15});
modifiers('plague',{stamina:-10,lifespan:-30,armor:-2},{speed:-30,damage:-50},{loyalty:-15});
modifiers('energized',{lifespan:7},{speed:20}); modifiers('the-chosen-one',{stamina:1000,mana:1000}); modifiers('shiny',{diplomacy:5});
modifiers('alien-mold-desire',{armor:10},{criticalMultiplier:30}); modifiers('evil-computer-desire',{},{health:30,lifespan:50});
modifiers('golden-egg-desire',{},{damage:50}); modifiers('ethereal-harp-desire',{},{speed:30,attackSpeed:30});
modifiers('miracle-born',{lifespan:20},{},{birthRate:2,offspring:200});

for (const pair of ['eagle-eyed short-sighted','genius stupid','stupid wise','thief honest','thief content','ambitious content','content greedy',
  'deceitful honest','evil blessed','bloodlust pacifist','lucky unlucky','agile fat','agile slow','fast slow','fat weightless','giant tiny',
  'hard-skin soft-skin','strong weak','clumsy long-liver','boosted-vitality fragile-health','fertile infertile','attractive ugly',
  'immortal plague','immune plague','immune infected','immune mush-spores','immune tumor-infection','contagious plague',
  'death-bomb death-nuke','mega-heartbeat whirlwind','its-a-boat wise','its-a-boat immortal','its-a-boat energized']) {
  const [a,b] = pair.split(' '); traitDefinitions[a].conflicts.push(b); traitDefinitions[b].conflicts.push(a);
}
const desires = ['alien-mold-desire','evil-computer-desire','golden-egg-desire','ethereal-harp-desire'];
for (const id of [...desires,'madness']) {
  traitDefinitions[id].conflicts.push('strong-minded', ...[...desires,'madness'].filter(x => x !== id));
  traitDefinitions['strong-minded'].conflicts.push(id);
}
for (const id of ['infected','tumor-infection','mush-spores','plague']) { traitDefinitions[id].conflicts.push('its-a-boat'); traitDefinitions['its-a-boat'].conflicts.push(id); }
for (const id of ['one-eyed','skin-burns','crippled','infected','tumor-infection','mush-spores','plague','madness',...desires]) edit(id,{cure:true});
const special = ['its-a-boat','clone',...desires,'madness','metamorphed','miracle-bearer','miracle-born','scar-of-divinity','zombie'];
for (const id of special) edit(id,{scope:'special'});
const excluded = ['veteran','wise','infected','mush-spores','tumor-infection','plague','blessed','kingslayer','mageslayer','dragonslayer',
  'crippled','one-eyed','golden-tooth','skin-burns','death-nuke','mark-of-death','mega-heartbeat','whirlwind','the-chosen-one','contagious',...special];
for (const id of excluded) edit(id,{randomBirth:false});
for (const id of ['genius','stupid','thief','wise','ambitious','content','deceitful','evil','gluttonous','greedy','honest','hotheaded','lustful',
  'paranoid','peaceful','psychopath','pyromaniac','bloodlust','pacifist','savage','mute','miner','golden-tooth']) edit(id,{scope:'person'});
for (const [id,sameOpinion,oppositeOpinion] of [ ['genius',20,-20],['stupid',30,0],['thief',10,0],['ambitious',-10,0],['content',15,0],
  ['deceitful',-15,-5],['gluttonous',5,0],['honest',10,-10],['hotheaded',-10,0],['savage',5,0],['agile',5,0],['fat',10,-10],
  ['strong',5,-10],['tough',-5,0],['weak',0,-10],['immortal',-20,0],['attractive',10,0],['one-eyed',20,0],['golden-tooth',5,0],
  ['skin-burns',40,0],['ugly',5,-15],['veteran',5,0],['crippled',10,0] ] as [string,number,number][]) edit(id,{sameOpinion,oppositeOpinion});
for (const [id,interval] of Object.entries({regeneration:90,'healing-aura':60,infected:45,'tumor-infection':30,'mark-of-death':30,contagious:30,
  'mega-heartbeat':150,whirlwind:3,unlucky:600,'burning-feet':30,'acid-touch':30,'cold-aura':30,'flower-prints':30,
  sunblessed:150,heliophobia:300,hotheaded:600})) edit(id,{interval});
// Unlucky: use the explicit interval table's 20 seconds, not its conflicting 1-second row.
for (const id of ['pyromaniac','bomberman','backstep','block','dash','deflect-projectiles','dodge','arcane-reflexes','battle-reflexes','the-chosen-one','weightless']) edit(id,{pending:'actions'});
for (const id of ['peaceful']) edit(id,{pending:'statuses'});
for (const id of ['moonchild','nightchild','sunblessed','heliophobia']) edit(id,{pending:'epochs'});
for (const id of ['flower-prints','cold-aura','acid-touch']) edit(id,{pending:'plants'});
// Fertility and the permanent divine-birth marker are consumed by reproduction.
for (const id of desires) edit(id,{pending:'religion'});
// Personal wallets now supply the thief's actual transfer and happiness consequence.
export const TRAIT_DEFINITIONS = Object.values(traitDefinitions);
export const MIND_TRAITS = rows.slice(6,22).map(([label]) => traitId(label));

for (const d of TRAIT_DEFINITIONS) {
  if (d.birth && d.randomBirth) d.triggers.push('birth');
  if (d.birth + d.inherit) d.triggers.push('inherit');
  if (d.grow) d.triggers.push('grow');
  if (d.interval) d.triggers.push('periodic');
  if (d.scope !== 'special') d.triggers.push('editor');
  if (MIND_TRAITS.includes(d.id)) d.triggers.push('book');
}
for (const [trigger, ids] of Object.entries({
  death: ['death-bomb','death-nuke','energized','fire-blood','acid-blood','mush-spores','poisonous'],
  hit: ['flesh-eater','venomous','zombie'], hurt: ['thorns','bubble-defense','one-eyed','crippled','skin-burns'],
  kill: ['veteran','dragonslayer','kingslayer','mageslayer','bloodlust','madness'], year: ['wise','evil'],
})) for (const id of ids) traitDefinitions[id].triggers.push(trigger as TraitTrigger);
