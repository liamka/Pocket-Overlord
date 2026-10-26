import type { Registry } from './registry';
import { CREATURE_PROFILES, isResource, RESOURCES, validBundle, bundleSize, type ResourceBundle, type ResourceId } from '../core/resources';
import { BONE } from '../core/bone';
import { leatherRemainsFire } from '../core/leather';
import { integer, reference } from '../core/validation';

export interface ResourcePile { goods: ResourceBundle; species: string; originId: number; createdAt: number; villageId: number | null }
declare module '../core/types' { interface ComponentMap {
  resourcePile: ResourcePile;
  /** Explicit resident diet/collection policy, absent by default. Future traits may set it. */
  resourceConsumer: { diet: ResourceId[]; sapientRemains: boolean };
  raisedRemains: { originId: number };
} }

export function registerResources(registry: Registry): void {
  registry.registerComponent('resourceConsumer', p => Array.isArray(p.diet) && p.diet.length > 0 && p.diet.every(id => isResource(id) && RESOURCES[id].consumable)
    && new Set(p.diet).size === p.diet.length && typeof p.sapientRemains === 'boolean');
  registry.registerComponent('raisedRemains', p => integer(p.originId, 1));
  registry.registerComponent('resourcePile', p => validBundle(p.goods, 30, false) && bundleSize(p.goods) > 0
    && typeof p.species === 'string' && Object.hasOwn(CREATURE_PROFILES, p.species) && integer(p.originId, 1) && integer(p.createdAt) && reference(p.villageId));
  registry.registerEntity({ id: 'core:resource-pile', sprite: {
    pixels: ['  bb   bb ', '  bbbbbbb ', '   lbbbl  ', ' ddllllld ', 'ddldddlddd', ' dddddddd '],
    palette: { b: '#e8dfba', l: '#9b8066', d: '#66504e' }, anchor: { x: 4, y: 4 },
  }, create: p => ({
    position: { ...p }, health: { current: 20, max: 20 },
    ...leatherRemainsFire(0),
    resourcePile: { goods: { meat: 1 }, species: 'sheep', originId: 1, createdAt: 0, villageId: null },
  }) });
  registry.registerSystem({ id: 'core:remains', after: ['core:landscape'], before: ['core:economy'], update: world => {
    if (world.paused) return;
    for (const e of world.query('resourcePile', 'position')) {
      const pile = e.components.resourcePile!, p = e.components.position!;
      if (pile.villageId !== null && !world.society.villages.some(v => v.id === pile.villageId)) pile.villageId = null;
      if (world.tick >= pile.createdAt + BONE.remainsTicks || !world.terrain.isLand(p.x, p.y)) world.remove(e.id);
    }
  } });
}
