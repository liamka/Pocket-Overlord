import { treeProfileFor } from './biome-ecology';
import { isAdult } from './unit-stats';
import { territoryOwner } from './territory';
import type { Entity, Village } from './types';
import type { World } from './world';
import { NaturalBiome } from './natural-biomes';
import { SOURCE_PROFILES, entries, type ResourceBundle } from './resources';
import { economyOf } from './village-life';

export const TREE_PROFILES = ['tree', 'palm', 'jungleTree', 'lemonTree', 'candyTree', 'mushroomTree', 'pine', 'crystalTree'] as const;
export type TreeProfile = typeof TREE_PROFILES[number];
export interface Tree {
  profile: TreeProfile; biome: NaturalBiome; origin: 'natural' | 'planted' | 'legacy';
  age: number; remaining: number; claim: { workerId: number; villageId: number } | null;
}
declare module './types' { interface ComponentMap { tree: Tree } }
// Pocket Overlord balance: two minutes to maturity; density is independent of yield.
export const FOREST = { mature: 120, sapling: 30, radius: 24, densityRadius: 6, maxDensity: 8, housingWood: 4, shipWood: 6 } as const;
export const FOREST_POLICIES = {
  preserve: { label: 'Preserve the forest', trees: 6, workers: 1 },
  balanced: { label: 'Balanced forestry', trees: 2, workers: 1 },
  intensive: { label: 'Intensive forestry', trees: 0, workers: 2 },
} as const;
export type ForestPolicy = keyof typeof FOREST_POLICIES;
export const FOREST_PROBLEMS = ['Tree is still growing', 'Tree has no usable wood', 'Tree is burning', 'Tree is no longer a stationary source',
  'Tree belongs to another settlement', 'Tree is already reserved', 'Forest preservation limit reached', 'Woodcutter limit reached',
  'Workers are needed for food', 'No reachable tree', 'No storage space for the whole harvest', 'No mature trees nearby'] as const;
export type ForestProblem = typeof FOREST_PROBLEMS[number];
export function newTree(biome: NaturalBiome, variant: number, origin: Tree['origin'] = 'natural', age: number = FOREST.mature, draw = (variant % 2) / 2): Tree {
  const profile = treeProfileFor(biome, draw) ?? 'tree';
  return { profile, biome, origin, age, remaining: SOURCE_PROFILES[profile].outputs.wood!, claim: null };
}
export function treeYield(entity: Entity): ResourceBundle {
  const tree = entity.components.tree;
  if (!tree) return {};
  const outputs = SOURCE_PROFILES[tree.profile].outputs;
  const wood = Math.min(tree.remaining, Math.max(0, Math.floor(outputs.wood! * (entity.components.combustible?.fuel ?? 45) / 45)));
  const fraction = wood / outputs.wood!;
  return Object.fromEntries(entries(outputs).map(([id, n]) => [id, id === 'wood' ? wood : Math.floor(n * fraction)]).filter(([, n]) => Number(n) > 0));
}
export function treeOwner(world: World, entity: Entity): Village | undefined {
  const p = entity.components.position;
  if (!p) return;
  return territoryOwner(world, p);
}
export function treeProblem(entity: Entity): ForestProblem | undefined {
  const c = entity.components, tree = c.tree;
  if (!tree || entity.typeId !== 'core:tree' || c.person || c.animal || c.motion) return 'Tree is no longer a stationary source';
  if (c.thermal?.burning) return 'Tree is burning';
  if (!(treeYield(entity).wood ?? 0) || (c.health?.current ?? 0) <= 0) return 'Tree has no usable wood';
  if (tree.age < FOREST.mature) return 'Tree is still growing';
}
export function cleanTreeClaim(world: World, entity: Entity): void {
  const tree = entity.components.tree, claim = tree?.claim;
  if (!tree || !claim) return;
  const c = world.entities.get(claim.workerId)?.components.citizen;
  if (!c || c.task !== 'work' || c.targetId !== entity.id || c.work?.good !== 'wood' || c.work.orderId !== undefined || c.work.cargo
    || c.villageId !== claim.villageId || treeOwner(world, entity)?.id !== claim.villageId || treeProblem(entity)) tree.claim = null;
}
export function fellingProblem(world: World, entity: Entity, village: Village, workerId: number): ForestProblem | undefined {
  const problem = treeProblem(entity);
  if (problem) return problem;
  cleanTreeClaim(world, entity);
  if (treeOwner(world, entity)?.id !== village.id) return 'Tree belongs to another settlement';
  if (entity.components.tree!.claim && entity.components.tree!.claim!.workerId !== workerId) return 'Tree is already reserved';
  const residents = [...world.query('citizen', 'person')].filter(e => e.components.citizen!.villageId === village.id);
  if (village.food < residents.length) return 'Workers are needed for food';
  const policy = FOREST_POLICIES[economyOf(village).forestPolicy ?? 'balanced'];
  const trees = world.nearby(village, FOREST.radius).filter(e => e.components.tree && treeOwner(world, e)?.id === village.id && !treeProblem(e));
  for (const tree of trees) cleanTreeClaim(world, tree);
  const claims = trees.filter(e => e.components.tree!.claim && e.components.tree!.claim!.workerId !== workerId).length;
  if (trees.length - claims <= policy.trees) return 'Forest preservation limit reached';
  if (claims >= policy.workers) return 'Woodcutter limit reached';
}
export function reserveTree(world: World, entity: Entity, worker: Entity): boolean {
  const village = world.society.villages.find(v => v.id === worker.components.citizen?.villageId);
  if (world.paused || !village || world.entities.get(entity.id) !== entity || world.entities.get(worker.id) !== worker
    || !worker.components.person || !isAdult(worker) || worker.components.citizen!.hunger >= 70
    || worker.components.thermal?.burning || (worker.components.health?.current ?? 0) <= 0 || fellingProblem(world, entity, village, worker.id)) return false;
  entity.components.tree!.claim = { workerId: worker.id, villageId: village.id };
  return true;
}
export function releaseTreeClaim(world: World, workerId: number): void {
  for (const e of world.query('tree')) if (e.components.tree!.claim?.workerId === workerId) e.components.tree!.claim = null;
}
/** Keep the existing owner of construction estimates; only protect wood not already reserved. */
export function housingWoodReserve(world: World, village: Village): number {
  let needed = FOREST.housingWood;
  for (const e of world.query('dwelling', 'building')) {
    const project = e.components.building!.project;
    if (e.components.dwelling!.villageId !== village.id || !project || project.paid) continue;
    const held = village.economy?.storage?.reduce((sum, s) => sum + s.reservations.filter(r => r.claimant === e.id).reduce((n, r) => n + (r.goods.wood ?? 0), 0), 0) ?? 0;
    needed += Math.max(0, (project.cost.wood ?? 0) - held);
  }
  return needed;
}
