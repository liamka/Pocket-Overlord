import type { Registry } from './registry';
import { GEM_BIOMES, GEMS } from '../core/gems';
import { NaturalBiome, NATURAL_BIOMES } from '../core/natural-biomes';
import { integer } from '../core/validation';

export function registerGems(registry: Registry): void {
  registry.registerComponent('gemSource', s => ['ore', 'plant'].includes(String(s.kind)) && ['natural', 'mine', 'biology'].includes(String(s.origin))
    && integer(s.biome, 0, NATURAL_BIOMES.length - 1) && integer(s.createdAt)
    && integer(s.remaining, 1, s.kind === 'ore' ? GEMS.batches : 1)
    && (s.kind === 'plant' ? s.origin === 'natural' && s.biome === NaturalBiome.Crystal : s.origin === 'mine' || s.origin === 'biology' || GEM_BIOMES.includes(Number(s.biome))));
  for (const kind of ['ore', 'plant'] as const) registry.registerEntity({
    id: kind === 'ore' ? 'core:gem-ore' : 'core:crystal-plant', sprite: registry.entities.get('core:stone')!.sprite,
    create: p => ({ position: { ...p }, health: { current: kind === 'ore' ? 120 : 30, max: kind === 'ore' ? 120 : 30 }, solid: { radius: kind === 'ore' ? 0.65 : 0.3 },
      gemSource: { kind, origin: 'natural', biome: kind === 'ore' ? GEM_BIOMES[0] : NaturalBiome.Crystal, remaining: kind === 'ore' ? GEMS.batches : 1, createdAt: 0 } }),
  });
  // A change of biome does not erase an existing deposit, including one raised by a mine.
  registry.registerSystem({ id: 'core:gem-sources', after: ['core:landscape'], before: ['core:ferries'], update: world => {
    if (world.paused || world.tick % 30) return;
    for (const e of world.query('gemSource', 'position')) if (!world.terrain.isLand(e.components.position!.x, e.components.position!.y)) world.remove(e.id);
  } });
}
