import type { PixelSprite, Registry } from './registry';
import type { World } from '../core/world';
import { Terrain, type Vec2 } from '../core/types';
import { NaturalBiome } from '../core/natural-biomes';
import { Random } from '../core/random';
import { newDeposit } from '../core/deposits';
import { SILVER, SILVER_WEIGHTS } from '../core/silver';

const sprite: PixelSprite = {
  pixels: ['       dd       ', '     ddllld     ', '   ddslwllsdd   ', '  dssslwlssssd  ', ' dsslwlsslwlssd ',
    'dssslllssllwsssd', 'dsslwllssslssssd', ' dssssssslwsssd ', '  ddddddddddd  '],
  palette: { d: '#344c56', s: '#65858a', l: '#b2d7d7', w: '#f4ffff' }, anchor: { x: 7, y: 7 },
};
export function canPlaceSilver(world: World, p: Vec2): boolean {
  const tile = world.terrain.at(p.x, p.y);
  return (tile === Terrain.Grass || tile === Terrain.Sand) && world.safeLand(p, 0.7) && world.canStand(p, 0.7)
    && !world.nearby(p, 2).some(e => e.components.farm || e.components.ruin || e.components.stone || e.components.commonMetal || e.components.gemSource);
}
/** Only called at world creation; neither loading nor repainting a biome seeds ore. */
export function seedSilver(world: World): void {
  if (!world.registry.entities.has('core:silver-ore')) return;
  const rng = new Random(world.seed ^ SILVER.seedSalt), { width, height } = world.terrain;
  for (let i = 0; i < Math.floor(width * height / SILVER.spacing); i++) {
    const p = { x: rng.range(1, width - 1), y: rng.range(1, height - 1) };
    if (rng.next() * 5 < (SILVER_WEIGHTS[world.terrain.biomeAt(p.x, p.y).id] ?? 0) && canPlaceSilver(world, p)) world.spawn('core:silver-ore', p);
  }
}
export function registerSilver(registry: Registry): void {
  // The common finite-deposit component owns extraction, claims and water removal.
  registry.registerEntity({ id: 'core:silver-ore', sprite, create: p => ({
    position: { ...p }, health: { current: 120, max: 120 }, solid: { radius: 0.65 },
    stone: newDeposit(NaturalBiome.Grassland, 'natural', 'silverOre'),
  }) });
  registry.registerTool({ id: 'core:silver-ore', category: 'nature', label: 'Silver ore', icon: sprite, radius: 0.7, color: '#b2d7d7',
    hint: 'Residents mine silver and stone together. Silver equipment needs workshop experience.', canApply: canPlaceSilver,
    apply: (world, p) => {
      if (!canPlaceSilver(world, p)) return 'Place silver ore on clear, dry land';
      const source = world.spawn('core:silver-ore', p);
      if (!source) return 'В мире слишком много объектов';
      source.components.stone!.origin = 'placed';
    },
  });
}
