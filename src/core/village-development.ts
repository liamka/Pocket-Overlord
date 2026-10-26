import { ARCHITECTURES, BUILDINGS, buildingOwner, operational, type Architecture, type BuildingAction } from './buildings';
import type { Entity, Village } from './types';
import type { World } from './world';

export type ConstructionProfile = 'advanced' | 'basic1' | 'basic2';
export interface DevelopmentNode { kind: string; level: number; requires: readonly string[] }
type Graph = Record<string, DevelopmentNode>;
const node = (kind: string, requires: string[] = [], level = 1): DevelopmentNode => ({ kind: `core:${kind}`, level, requires });
// Requirements for future buildings stay declarative until their owning plans register those buildings.
// Existing local production keeps its own requirements; prices/work belong to the building catalogue.
const common: Graph = {
  bonfire: node('bonfire'), stockpile: node('stockpile'), hall1: node('town-hall', ['bonfire']),
  house1: node('house', ['bonfire']), farm: node('farm'), mill: node('mill', ['bonfire']),
  harbor: node('harbor', ['bonfire']), market: node('market', ['bonfire', 'hall1']),
  bakery: node('bakery', ['mill']), workshop: node('workshop', ['market']),
  tower: node('watch-tower', ['bonfire', 'hall1']), mine: node('mine', ['bonfire', 'hall1']),
  library: node('library', ['bonfire', 'hall1']), barracks: node('barracks', ['bonfire', 'hall1']),
  dummy: node('training-dummy', ['barracks']), temple: node('temple', ['bonfire', 'hall1', 'statue']),
  statue: node('statue', ['hall1']), well: node('well', ['hall1']),
};
const basic2 = Object.fromEntries(Object.entries(common).filter(([id]) => id !== 'well' && id !== 'statue'));
export const DEVELOPMENT_GRAPHS: Record<ConstructionProfile, Graph> = {
  advanced: { ...common, tent: node('tent', ['bonfire']), tent2: node('tent', ['tent'], 2),
    house2: node('house', ['house1', 'hall1'], 2), house3: node('house', ['house2', 'hall2'], 3),
    house4: node('house', ['house3', 'hall2'], 4), house5: node('house', ['house4', 'hall3'], 5), house6: node('house', ['house5', 'hall3'], 6),
    hall2: node('town-hall', ['house2'], 2), hall3: node('town-hall', ['statue', 'mine', 'barracks'], 3),
    mill2: node('mill', ['mill'], 2), harbor2: node('harbor', ['harbor'], 2),
    well: node('well', ['bonfire', 'hall1']), statue: node('statue', ['hall2']),
    barracks: node('barracks', ['hall2']), temple: node('temple', ['bonfire', 'hall2', 'statue']),
  },
  basic1: { ...common, harbor2: node('harbor', ['harbor'], 2) },
  basic2: { ...basic2, temple: node('temple', ['bonfire', 'hall1']), harbor2: node('harbor', ['harbor'], 2) },
};
export function constructionProfileFor(architecture: Architecture, speciesName?: string): ConstructionProfile {
  if (speciesName) return ['Human', 'Elf', 'Orc', 'Dwarf'].includes(speciesName) ? 'advanced'
    : ['Necromancer', 'Evil Mage', 'White Mage', 'Plague Doctor', 'Demon', 'Cold One', 'Angel', 'Alien', 'Snowman', 'Fire Skull'].includes(speciesName) ? 'basic2' : 'basic1';
  return ['human', 'elf', 'orc', 'dwarf'].includes(architecture) ? 'advanced' : ['necromancer', 'demon', 'ice'].includes(architecture) ? 'basic2' : 'basic1';
}
export const villageProfile = (village: Village): ConstructionProfile => village.constructionProfile ?? 'advanced';

function availableNode(world: World, n: DevelopmentNode): boolean {
  return !!BUILDINGS[n.kind] && world.registry.entities.has(n.kind)
    && (n.level === 1 || n.kind === 'core:house' && n.level <= ARCHITECTURES.human.levels);
}
export function developmentProblem(world: World, village: Village, kind: string, level = 1): string | undefined {
  const graph = DEVELOPMENT_GRAPHS[villageProfile(village)];
  const entry = Object.values(graph).find(n => n.kind === kind && n.level === level);
  if (!entry) return kind.startsWith('core:stockpile-') ? undefined : 'Building is outside this construction profile';
  for (const key of entry.requires) {
    const requirement = graph[key];
    // Missing future systems cannot become mandatory dependencies of this plan.
    if (!availableNode(world, requirement)) continue;
    if (![...world.query('building')].some(e => buildingOwner(e) === village.id && e.components.building!.kind === requirement.kind
      && e.components.building!.level >= requirement.level && operational(e) && !e.components.thermal?.burning)) return 'Required buildings are not ready';
  }
}
export function projectAllowed(world: World, village: Village, entity: Entity, action: BuildingAction): boolean {
  return action === 'repair' || action === 'clear' || !developmentProblem(world, village, entity.components.building!.kind,
    action === 'upgrade' ? entity.components.building!.level + 1 : 1);
}
