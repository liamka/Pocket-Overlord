/** Factual color endpoints and eligibility from revision 22101, visually checked from its HTML/CSS.
 * The four rendering roles are our interpolation, not four colors claimed by the source. */
export const PHENOTYPE_SOURCE = 'https://the-official-worldbox-wiki.fandom.com/wiki/Phenotypes?oldid=22101';
export interface ColorRoles { shadow: string; middle: string; light: string; accent: string }
export interface PalettePermission { subject: string; biomes?: readonly string[] }
export interface PaletteDefinition { id: string; name: string; from: string; to: string; permissions: readonly PalettePermission[] }
export const PHENOTYPE_PALETTES: readonly PaletteDefinition[] = [
  {"id":"aqua","name":"Aqua","from":"#77D8D0","to":"#3779A5","permissions":[{"subject":"piranha"},{"subject":"turtle"},{"subject":"beetle"},{"subject":"snake","biomes":["swamp"]},{"subject":"frog","biomes":["corrupted","swamp"]}]},
  {"id":"black-blue","name":"Black Blue","from":"#34345B","to":"#222229","permissions":[{"subject":"assimilator"},{"subject":"raccoon"},{"subject":"seal"},{"subject":"ostrich"},{"subject":"penguin"},{"subject":"fly"},{"subject":"beetle"}]},
  {"id":"bright-blue","name":"Bright Blue","from":"#A8E3FF","to":"#1CA4FF","permissions":[{"subject":"cold-one"},{"subject":"flower-bud"}]},
  {"id":"bright-green","name":"Bright Green","from":"#C5FFA0","to":"#1CDA2C","permissions":[{"subject":"alien"},{"subject":"frog"},{"subject":"grasshopper"},{"subject":"snake","biomes":["jungle"]},{"subject":"crystal-sword","biomes":["swamp"]}]},
  {"id":"bright-orange","name":"Bright Orange","from":"#FFC191","to":"#FF7316","permissions":[{"subject":"fox"},{"subject":"cat"},{"subject":"flower-bud","biomes":["maple"]}]},
  {"id":"bright-pink","name":"Bright Pink","from":"#FFB6E3","to":"#FF5FC2","permissions":[{"subject":"crystal-sword"},{"subject":"flower-bud"},{"subject":"butterfly"},{"subject":"fairy"},{"subject":"acid-blob","biomes":["corrupted"]}]},
  {"id":"bright-purple","name":"Bright Purple","from":"#F3B9FF","to":"#BE4FDD","permissions":[{"subject":"crystal-sword"},{"subject":"flower-bud"},{"subject":"scorpion","biomes":["corrupted"]},{"subject":"fur-animals","biomes":["celestial"]}]},
  {"id":"bright-red","name":"Bright Red","from":"#FF9A9A","to":"#FF2222","permissions":[{"subject":"crystal-sword"},{"subject":"flower-bud"},{"subject":"butterfly"}]},
  {"id":"bright-salmon","name":"Bright Salmon","from":"#FFAFBC","to":"#FF537E","permissions":[{"subject":"piranha"},{"subject":"crab"}]},
  {"id":"bright-teal","name":"Bright Teal","from":"#A3FFE0","to":"#0DDCA4","permissions":[{"subject":"crystal-sword"},{"subject":"butterfly"}]},
  {"id":"bright-violet","name":"Bright Violet","from":"#D6B7FF","to":"#7142F3","permissions":[{"subject":"butterfly"},{"subject":"fur-animals","biomes":["singularity"]}]},
  {"id":"bright-yellow","name":"Bright Yellow","from":"#FFEBA3","to":"#FFCE1F","permissions":[{"subject":"greg"},{"subject":"crystal-sword"},{"subject":"flower-bud"},{"subject":"bee"},{"subject":"butterfly"},{"subject":"angle"},{"subject":"scorpion","biomes":["arcane-desert"]}]},
  {"id":"candy","name":"Candy","from":"#FF658C","to":"#D166FF","permissions":[{"subject":"unicorn"}]},
  {"id":"corrupted","name":"Corrupted","from":"#7E7987","to":"#483162","permissions":[{"subject":"turtle"},{"subject":"snake","biomes":["corrupted"]},{"subject":"crab","biomes":["corrupted"]},{"subject":"fur-animals","biomes":["corrupted"]},{"subject":"skin-animals","biomes":["corrupted"]}]},
  {"id":"crystal","name":"Crystal","from":"#1CFFCE","to":"#15A1FF","permissions":[{"subject":"crystal-sword"}]},
  {"id":"dark-blue","name":"Dark Blue","from":"#2182EB","to":"#163487","permissions":[{"subject":"fur-animals","biomes":["crystal"]}]},
  {"id":"dark-green","name":"Dark Green","from":"#72C727","to":"#2A6016","permissions":[{"subject":"mush"},{"subject":"crocodile"},{"subject":"snake"},{"subject":"turtle"}]},
  {"id":"dark-orange","name":"Dark Orange","from":"#FF7B16","to":"#69340B","permissions":[{"subject":"lil-pumpkin"},{"subject":"monkey"},{"subject":"snake"},{"subject":"chicken"},{"subject":"armadillo"},{"subject":"capybara"},{"subject":"fur-animals","biomes":["maple","savanna","sand"]}]},
  {"id":"dark-pink","name":"Dark Pink","from":"#F84EE7","to":"#652265","permissions":[{"subject":"fur-animals","biomes":["candy"]}]},
  {"id":"dark-purple","name":"Dark Purple","from":"#A341E1","to":"#491C5F","permissions":[{"subject":"fur-animals","biomes":["mushroom"]}]},
  {"id":"dark-red","name":"Dark Red","from":"#EC2D2D","to":"#5F1414","permissions":[{"subject":"scorpion"},{"subject":"wolf","biomes":["infernal"]}]},
  {"id":"dark-salmon","name":"Dark Salmon","from":"#F35688","to":"#6F2949","permissions":[{"subject":"tumor-monster"}]},
  {"id":"dark-teal","name":"Dark Teal","from":"#1FDEA5","to":"#0F6557","permissions":[{"subject":"fur-animals","biomes":["crystal"]}]},
  {"id":"dark-violet","name":"Dark Violet","from":"#6F47DF","to":"#321A75","permissions":[{"subject":"crystal-sword","biomes":["corrupted"]}]},
  {"id":"dark-yellow","name":"Dark Yellow","from":"#FFC61A","to":"#986411","permissions":[{"subject":"fur-animals","biomes":["arcane-desert"]}]},
  {"id":"desert","name":"Desert","from":"#D3C0AB","to":"#B68637","permissions":[{"subject":"turtle"},{"subject":"frog","biomes":["arcane-desert"]},{"subject":"snake","biomes":["arcane-desert"]},{"subject":"dog","biomes":["arcane-desert"]},{"subject":"crab","biomes":["arcane-desert"]},{"subject":"flower-bud","biomes":["arcane-desert"]},{"subject":"fur-animals","biomes":["arcane-desert"]}]},
  {"id":"gray-black","name":"Gray Black","from":"#7A7A7A","to":"#3E3E3E","permissions":[{"subject":"evil-mage"},{"subject":"plague-doctor"},{"subject":"dog"},{"subject":"wolf"},{"subject":"raccoon"},{"subject":"rat"},{"subject":"goat"},{"subject":"fur-animals","biomes":["rocklands"]}]},
  {"id":"infernal","name":"Infernal","from":"#FF5100","to":"#FF002B","permissions":[{"subject":"frog","biomes":["infernal","jungle"]},{"subject":"snake","biomes":["infernal"]},{"subject":"scorpion","biomes":["infernal"]},{"subject":"crab","biomes":["infernal"]},{"subject":"crystal-sword","biomes":["infernal"]},{"subject":"acid-blob","biomes":["infernal"]},{"subject":"fur-animals","biomes":["infernal"]},{"subject":"skin-animals","biomes":["infernal"]}]},
  {"id":"jungle","name":"Jungle","from":"#03803D","to":"#2EB829","permissions":[{"subject":"flower-bud","biomes":["jungle"]}]},
  {"id":"lemon","name":"Lemon","from":"#FFDB27","to":"#BDF741","permissions":[{"subject":"bitba"},{"subject":"frog","biomes":["lemon"]},{"subject":"snake","biomes":["lemon"]},{"subject":"fur-animals","biomes":["lemon"]},{"subject":"skin-animals","biomes":["lemon"]}]},
  {"id":"magical","name":"Magical","from":"#24C695","to":"#9D2EA7","permissions":[{"subject":"fur-animals","biomes":["celestial","mushroom"]}]},
  {"id":"mid-gray","name":"Mid Gray","from":"#BBBBBB","to":"#606060","permissions":[{"subject":"dwarf"},{"subject":"rhino"},{"subject":"garl"},{"subject":"elf","biomes":["corrupted"]},{"subject":"orc","biomes":["corrupted"]},{"subject":"fur-animals","biomes":["garlic"]}]},
  {"id":"pink-yellow-mushroom","name":"Pink Yellow Mushroom","from":"#F12C78","to":"#FFAC26","permissions":[{"subject":"frog","biomes":["mushroom"]},{"subject":"fur-animals","biomes":["mushroom"]}]},
  {"id":"polar","name":"Polar","from":"#E8EEF5","to":"#95C2E7","permissions":[{"subject":"unicorn"},{"subject":"sheep"},{"subject":"dog","biomes":["permafrost"]},{"subject":"seal","biomes":["permafrost"]},{"subject":"flower-bud","biomes":["permafrost"]},{"subject":"fur-animals","biomes":["permafrost"]}]},
  {"id":"savanna","name":"Savanna","from":"#FFB52B","to":"#D06643","permissions":[{"subject":"hyena"},{"subject":"snake","biomes":["savanna"]},{"subject":"fur-animals","biomes":["savanna"]}]},
  {"id":"skin-black","name":"Skin Black","from":"#46372A","to":"#34211E","permissions":[{"subject":"dog","biomes":["corrupted"]}]},
  {"id":"skin-blue","name":"Skin Blue","from":"#7FC1C7","to":"#37617A","permissions":[{"subject":"fur-animals","biomes":["swamp"]}]},
  {"id":"skin-dark","name":"Skin Dark","from":"#7C5A3C","to":"#593731","permissions":[{"subject":"human"},{"subject":"bear"},{"subject":"alpaca"},{"subject":"smore"}]},
  {"id":"skin-green","name":"Skin Green","from":"#9DB361","to":"#425338","permissions":[{"subject":"orc"}]},
  {"id":"skin-light","name":"Skin Light","from":"#F5D6BA","to":"#F3C6BE","permissions":[{"subject":"human"},{"subject":"elf"},{"subject":"dwarf"}]},
  {"id":"skin-medium","name":"Skin Medium","from":"#C5966D","to":"#C06859","permissions":[{"subject":"dwarf"},{"subject":"rhino"},{"subject":"smore"},{"subject":"frog","biomes":["savanna"]}]},
  {"id":"skin-mixed","name":"Skin Mixed","from":"#E9BA90","to":"#34211E","permissions":[{"subject":"human"},{"subject":"elf"},{"subject":"white-mage"},{"subject":"druid"},{"subject":"necromancer"},{"subject":"bandit"},{"subject":"sheep"},{"subject":"smore"}]},
  {"id":"skin-pale","name":"Skin Pale","from":"#FFF9F4","to":"#ECD9D5","permissions":[{"subject":"orc","biomes":["permafrost"]},{"subject":"unicorn"}]},
  {"id":"skin-pink","name":"Skin Pink","from":"#FFAFC0","to":"#D1539F","permissions":[{"subject":"fur-animals","biomes":["candy"]}]},
  {"id":"skin-purple","name":"Skin Purple","from":"#C29FD5","to":"#5C54A2","permissions":[{"subject":"elf","biomes":["celestial"]}]},
  {"id":"skin-red","name":"Skin Red","from":"#DB4D48","to":"#7F2E39","permissions":[{"subject":"demon"},{"subject":"orc","biomes":["infernal"]}]},
  {"id":"skin-yellow","name":"Skin Yellow","from":"#FFE18E","to":"#AB8B51","permissions":[{"subject":"fur-animals","biomes":["arcane-desert"]}]},
  {"id":"soil","name":"Soil","from":"#533028","to":"#160C15","permissions":[{"subject":"buffalo"},{"subject":"beetle"},{"subject":"scorpion","biomes":["savanna"]}]},
  {"id":"swamp","name":"Swamp","from":"#784D85","to":"#367F58","permissions":[{"subject":"turtle"},{"subject":"beetle"},{"subject":"crab","biomes":["swamp"]},{"subject":"smore","biomes":["swamp"]},{"subject":"acid-blob","biomes":["swamp"]},{"subject":"flower-bud","biomes":["swamp"]},{"subject":"fur-animals","biomes":["swamp"]}]},
  {"id":"toxic-green","name":"Toxic Green","from":"#CBFF2E","to":"#10F023","permissions":[{"subject":"bioblob"},{"subject":"acid-blob"}]},
  {"id":"white-gray","name":"White Gray","from":"#FAFAFA","to":"#B0B0B0","permissions":[{"subject":"dog"},{"subject":"wolf"},{"subject":"rabbit"},{"subject":"cat"},{"subject":"rat"},{"subject":"chicken"},{"subject":"sheep"},{"subject":"cow"},{"subject":"alpaca"},{"subject":"goat"},{"subject":"rude-skull"},{"subject":"snowman"}]},
  {"id":"wood","name":"Wood","from":"#9D582A","to":"#4C2828","permissions":[{"subject":"dog"},{"subject":"wolf"},{"subject":"bear"},{"subject":"rabbit"},{"subject":"cat"},{"subject":"ostrich"},{"subject":"rat"},{"subject":"chicken"},{"subject":"armadillo"},{"subject":"capybara"},{"subject":"fur-animals","biomes":["sand"]}]},
];
export const FUR_SPECIES = new Set('fox buffalo hyena monkey wolf bear piranha rabbit cat raccoon rat chicken sheep cow armadillo alpaca capybara goat'.split(' '));
export const SKIN_SPECIES = new Set('crocodile seal piranha unicorn ostrich flower-bud'.split(' '));
const rgb = (hex: string): number[] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex: string): number => rgb(hex).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
const mix = (a: string, b: string): string => '#' + rgb(a).map((n, i) => Math.round((n + rgb(b)[i]) / 2).toString(16).padStart(2, '0')).join('');
export const PALETTE_ROLES: Readonly<Record<string, ColorRoles>> = Object.freeze(Object.fromEntries(PHENOTYPE_PALETTES.map(p => {
  const [shadow, light] = luminance(p.from) < luminance(p.to) ? [p.from, p.to] : [p.to, p.from];
  return [p.id, Object.freeze({ shadow, middle: mix(p.from, p.to), light, accent: p.from })];
})));
for (const palette of PHENOTYPE_PALETTES) {
  for (const rule of palette.permissions) { if (rule.biomes) Object.freeze(rule.biomes); Object.freeze(rule); }
  Object.freeze(palette.permissions); Object.freeze(palette);
}
Object.freeze(PHENOTYPE_PALETTES);
