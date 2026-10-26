export interface WorldLawDefinition {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly default: boolean;
  readonly action: string;
  readonly consumers: readonly string[];
  readonly dependencies: readonly string[];
  readonly change: 'immediate' | 'future' | 'unavailable';
  readonly unavailable?: string;
}
const law = (id: string, label: string, group: string, initial: boolean, action: string, consumers: string[], change: 'immediate' | 'future' = 'immediate', dependencies: string[] = []): WorldLawDefinition =>
  Object.freeze({ id, label, group, default: initial, action, consumers: Object.freeze(consumers), dependencies: Object.freeze(dependencies), change });
const absent = (id: string, label: string, group: string, initial: boolean, reason: string, dependencies: string[] = []): WorldLawDefinition =>
  Object.freeze({ ...law(id, label, group, initial, reason, [], 'future', dependencies), change: 'unavailable', unavailable: reason });

/** Wiki defaults are preserved, including for unavailable entries. No placeholder has a consumer. */
export const WORLD_LAWS: readonly WorldLawDefinition[] = Object.freeze([
  law('population-100', '100 People', 'Harmony', false, 'Limit new settlement admissions to 100. Existing residents and reserved births stay.', ['reproduction', 'housing', 'migration'], 'future'),
  law('gaia', "Gaia's Covenant", 'Harmony', false, 'Protect soil from blasts, fire and heat rays. Creatures can still take damage.', ['effects', 'fire', 'heat-rays']),
  law('diplomacy', 'Diplomacy', 'Diplomacy', true, 'Allow new alliances and declarations of war. Existing campaigns can still end.', ['diplomacy'], 'future'),
  absent('magic-rites', 'Magic Rites', 'Diplomacy', true, 'Religions and rites are not available.'),
  absent('rebellions', 'Rebellions', 'Diplomacy', true, 'Kingdoms, clans and rebellions are not available.', ['diplomacy']),
  absent('stealing-borders', 'Stealing Borders', 'Diplomacy', true, 'Territorial conquest is not available.'),
  absent('glitched-noosphere', 'Glitched Noosphere', 'Civilizations', false, 'Cultures, languages, religions and clans are not available.'),
  absent('terramorphing', 'Terramorphing', 'Civilizations', true, 'Buildings do not spread biomes.'),
  law('kingdom-expansion', 'Kingdom Expansion', 'Civilizations', true, 'Allow new settler expeditions. Travellers already on the road continue.', ['migration'], 'future'),
  absent('angry-villagers', 'Angry Villagers', 'Civilizations', false, 'Cultural identities, Xenophile and Xenophobic are not available.'),
  law('civ-babies', 'Civ Babies', 'Civilizations', true, 'Allow new conceptions by residents. Existing pregnancies and eggs continue.', ['reproduction'], 'future'),
  absent('handsome-migrants', 'Handsome Migrants', 'Civilizations', true, 'Migrant cultures, languages, religions and subspecies population limits are not available.'),
  law('armies', 'Armies', 'Civilizations', true, 'Allow residents to serve in campaigns. Disabling recalls soldiers without removing their cargo.', ['jobs', 'combat']),
  law('gene-spaghetti', 'Gene Spaghetti', 'Units', false, 'New subspecies replace each generated gene with a random common gene with 77.7% probability.', ['subspecies'], 'future'),
  law('mutant-box', 'Mutant Box', 'Units', false, 'New subspecies may gain compatible random abilities.', ['physiology'], 'future'),
  law('grin-reaper', 'Grin Reaper', 'Units', false, 'Marked subspecies gradually lose members.', ['physiology']),
  law('hunger', 'Hunger', 'Units', true, 'Allow hunger to increase and cause starvation. Disabling preserves stored food and current nutrition.', ['metabolism', 'statuses', 'damage']),
  law('old-age', 'Old Age', 'Units', true, 'Allow natural death from old age. Aging continues when disabled.', ['unit-stats', 'damage']),
  law('peaceful-monsters', 'Peaceful Monsters', 'Mobs', false, 'Stop animal attacks, dragon fire and UFO beams. Existing fires and player-controlled powers remain active.', ['husbandry', 'dragons', 'ufos', 'combat']),
  law('animal-babies', 'Animal Babies', 'Mobs', true, 'Allow new animal conceptions. Existing pregnancies and eggs continue.', ['reproduction'], 'future'),
  absent('forever-creep', 'Forever Creep', 'Mobs', false, 'Creep and its decay are not available.'),
  law('drop-of-thoughts', 'Drop of Thoughts', 'Spawn', false, 'Allow life clouds to summon available native peoples.', ['clouds']),
  law('animal-spawn', 'Animal Spawn', 'Spawn', true, 'Allow new settlement herds and wild wolves. Manual placement and births use separate rules.', ['husbandry'], 'future'),
  law('clouds-of-life', 'Clouds of Life', 'Spawn', true, 'Allow Gaia traits to create life clouds on death.', ['clouds']),
  law('high-flora-density', 'High Flora Density', 'Nature', false, 'Allow 50% more nearby trees during natural spreading. Existing forests stay.', ['spread-vegetation'], 'future'),
  law('random-seeds', 'Random Seeds', 'Nature', true, 'Allow natural tree seeding. Manual planting remains available.', ['spread-vegetation']),
  absent('roots-without-borders', 'Roots without Borders', 'Nature', false, 'Cross-biome plant spreading is not available.'),
  absent('minerals', 'Minerals', 'Nature', true, 'Natural renewal of mineral deposits is not available.'),
  absent('erosion', 'Erosion', 'Nature', true, 'Coastal erosion is not available.'),
  law('trees-growth', 'Trees Growth', 'Trees', true, 'Allow young trees to mature and spread. Existing trees remain harvestable.', ['tree-growth', 'spread-vegetation']),
  law('fast-trees-growth', 'Fast Trees Growth', 'Trees', false, 'Multiply tree maturation and seeding attempts by five from the next visit.', ['tree-growth', 'spread-vegetation'], 'future', ['trees-growth']),
  law('entanglewood', 'Entanglewood', 'Trees', true, 'Slow walking residents and animals by 20% near standing trees.', ['movement']),
  absent('bark-bites-back', 'Bark Bites Back', 'Trees', false, 'Living trees and the corrupted-biome exception are not available.'),
  absent('plants-growth', 'Plants Growth', 'Plants', true, 'Wild plants have no growth cycle. Farms use agriculture.'),
  absent('fast-plants-growth', 'Fast Plants Growth', 'Plants', false, 'Wild plants have no growth cycle. Farms use agriculture.', ['plants-growth']),
  absent('plants-tickles', 'Plants Tickles', 'Plants', false, 'Contact reactions of wild plants are not available.'),
  absent('root-pranks', 'Root Pranks', 'Plants', false, 'Contact reactions of wild plants are not available.'),
  absent('nectar-nap', 'Nectar Nap', 'Plants', false, 'Flowers with sleep-inducing pollen are not available.'),
  absent('fungi-growth', 'Fungi Growth', 'Fungi', true, 'Fungi have no separate growth cycle.'),
  absent('fast-fungi-growth', 'Fast Fungi Growth', 'Fungi', false, 'Fungi have no separate growth cycle.', ['fungi-growth']),
  absent('exploding-mushrooms', 'Exploding Mushrooms', 'Fungi', false, 'Explosive fungi are not available.'),
  law('grow-grass', 'Grow Grass', 'Biomes', true, 'Allow damaged soil to recover. Manual biome brushes remain available.', ['burned-tiles', 'rain']),
  law('biomes-overgrowth', 'Biomes Overgrowth', 'Biomes', true, 'Allow neighbouring biomes to compete for living soil.', ['biome-spread']),
  law('eternal-lava', 'Eternal Lava', 'Weather', false, 'Prevent ordinary lava cooling. Water and rain still cool lava.', ['geohazards']),
  absent('forever-cold', 'Forever Cold', 'Weather', false, 'Natural freezing and thawing of soil are not available.'),
  absent('natural-disasters', 'Natural Disasters', 'Disasters', true, 'Random natural disasters are not available. Manual powers remain available.'),
  absent('other-disasters', 'Other Disasters', 'Disasters', true, 'Random invasions are not available. Manual powers remain available.'),
  absent('rat-king', 'Rat King', 'Disasters', false, 'Rat populations and their plague outbreaks are not available.'),
  absent('evolution-events', 'Evolution Events', 'Other', true, 'Monolith evolution is not available.'),
]);
export const worldLawDefinitions: ReadonlyMap<string, WorldLawDefinition> = new Map(WORLD_LAWS.map(d => [d.id, d]));
export const ARCHITECT_MOODS = Object.freeze({
  serene: ['Serene', '#68FFFF'], trickster: ['Trickster', '#1CF713'], benevolent: ['Benevolent', '#FFE90B'],
  malevolent: ['Malevolent', '#A00CFC'], chaotic: ['Chaotic', '#FF0E0E'], orderly: ['Orderly', '#FF870E'],
  mysterious: ['Mysterious', '#F01FB4'], apathetic: ['Apathetic', '#AAAAAA'], ethereal: ['Ethereal', '#73A18E'],
} as const);
export type ArchitectMood = keyof typeof ARCHITECT_MOODS;
