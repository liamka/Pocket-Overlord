import type { PixelSprite, Registry } from './registry';
import type { World } from '../core/world';
import { Terrain } from '../core/types';
import { NaturalBiome } from '../core/natural-biomes';
import { Random } from '../core/random';
import { newDeposit } from '../core/deposits';
import { BONE } from '../core/bone';

// Original buried ribs and crossbone, distinct from living creatures and decoration.
const sprite: PixelSprite = {
  pixels: ['      bb bb     ', '      bbbbb     ', '    dd bbb dd   ', '   dbbdbbbdbbd  ', '  dbbbdbbbdbbbd ',
    ' ddddddbbbdddddd', ' dbbllbbbbbllbbd', ' dbbbllbbbllbbbd', '  dddddddddddd  '],
  palette: { d: '#514654', l: '#bcb49b', b: '#ece2bc' }, anchor: { x: 7, y: 7 },
};
/** New worlds only. Loading or repainting terrain never replenishes deposits. */
export function seedBone(world: World): void {
  if (!world.registry.entities.has('core:bone-deposit')) return;
  const rng = new Random(world.seed ^ BONE.seedSalt), { width, height } = world.terrain;
  for (let i = 0; i < Math.floor(width * height / BONE.spacing); i++) {
    const p = { x: rng.range(1, width - 1), y: rng.range(1, height - 1) }, tile = world.terrain.at(p.x, p.y);
    if (world.terrain.biomeAt(p.x, p.y).id === NaturalBiome.Corrupted && (tile === Terrain.Grass || tile === Terrain.Sand)
      && world.safeLand(p, 0.7) && world.canStand(p, 0.7)
      && !world.nearby(p, 2).some(e => e.components.farm || e.components.ruin || e.components.stone || e.components.commonMetal || e.components.gemSource)) world.spawn('core:bone-deposit', p);
  }
}
export function registerBone(registry: Registry): void {
  registry.registerEntity({ id: 'core:bone-deposit', sprite, create: p => ({
    position: { ...p }, health: { current: 120, max: 120 }, solid: { radius: 0.65 },
    stone: newDeposit(NaturalBiome.Corrupted, 'natural', 'boneDeposit'),
  }) });
}
