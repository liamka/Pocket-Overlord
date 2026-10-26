import type { Registry } from './registry';
import { FOREST, TREE_PROFILES } from '../core/forestry';
import { NATURAL_BIOMES } from '../core/natural-biomes';
import { SOURCE_PROFILES } from '../core/resources';
import { integer, number, record } from '../core/validation';

export function registerForestry(registry: Registry): void {
  registry.registerComponent('tree', t => TREE_PROFILES.some(id => id === t.profile) && integer(t.biome, 0, NATURAL_BIOMES.length - 1)
    && ['natural', 'planted', 'legacy'].includes(String(t.origin)) && number(t.age, 0, FOREST.mature)
    && integer(t.remaining, 0, SOURCE_PROFILES[t.profile as typeof TREE_PROFILES[number]]?.outputs.wood ?? 0)
    && (t.claim === null || record(t.claim) && integer(t.claim.workerId, 1) && integer(t.claim.villageId, 1)));
}
