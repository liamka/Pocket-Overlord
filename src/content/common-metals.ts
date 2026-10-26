import type { PixelSprite, Registry } from './registry';
import type { World } from '../core/world';
import { Terrain, type Vec2 } from '../core/types';
import { NaturalBiome } from '../core/natural-biomes';
import { Random } from '../core/random';
import { COMMON_METAL } from '../core/common-metals';
import { cleanDepositClaims, newDeposit, validDeposit } from '../core/deposits';

const sprite: PixelSprite = {
  pixels: ['      dddd      ', '    ddsssddd    ', '   dssmlssssd   ', '  dslwlssmlssd  ', ' dsslmssslwlssd ', ' dsmssddsslmssd ', 'dssmldmsdssmsssd', 'dsswlmssmllssssd', ' dssmmssslwsssd ', '  ddddddddddd  '],
  palette: { d: '#303f49', s: '#596876', m: '#967a59', l: '#c6d4d4', w: '#f1eee0' }, anchor: { x: 7, y: 8 },
};
export function canPlaceCommonMetal(world: World, p: Vec2): boolean {
  const tile = world.terrain.at(p.x, p.y), biome = world.terrain.biomeAt(p.x, p.y).id;
  return biome !== NaturalBiome.Corrupted && biome !== NaturalBiome.Crystal
    && (tile === Terrain.Grass || tile === Terrain.Sand) && world.safeLand(p, 0.7) && world.canStand(p, 0.7)
    && !world.nearby(p, 2).some(e => e.components.farm || e.components.ruin || e.components.stone || e.components.commonMetal);
}
/** Runs after stone, with its own stream: existing trees, stone and simulation RNG stay intact. */
export function seedCommonMetal(world: World): void {
  if (!world.registry.entities.has('core:common-metal')) return;
  const rng = new Random(world.seed ^ COMMON_METAL.seedSalt), { width, height } = world.terrain;
  for (let i = 0; i < Math.floor(width * height / COMMON_METAL.attemptsPerTile); i++) {
    const p = { x: rng.range(1, width - 1), y: rng.range(1, height - 1) };
    if (canPlaceCommonMetal(world, p)) world.spawn('core:common-metal', p);
  }
}
export function registerCommonMetals(registry: Registry): void {
  registry.registerComponent('commonMetal', v => v.profile === 'metalOre' && validDeposit(v));
  registry.registerEntity({ id: 'core:common-metal', sprite, create: p => ({ position: { ...p }, health: { current: 140, max: 140 },
    solid: { radius: 0.65 }, commonMetal: newDeposit(NaturalBiome.Grassland, 'natural', 'metalOre'),
  }) });
  registry.registerTool({ id: 'core:common-metal', category: 'nature', label: 'Common metal ore', icon: sprite, radius: 0.7, color: '#c6d4d4',
    hint: 'Residents mine ore and stone together. Workshops turn the ore into metal equipment.', canApply: canPlaceCommonMetal,
    apply: (world, p) => {
      if (!canPlaceCommonMetal(world, p)) return 'Ore needs clear, dry land outside corrupted and crystal biomes';
      const entity = world.spawn('core:common-metal', p);
      if (!entity) return 'В мире слишком много объектов';
      entity.components.commonMetal!.origin = 'placed';
    },
  });
  registry.registerSystem({ id: 'core:common-metal-deposits', after: ['core:landscape'], before: ['core:ferries'], update: world => {
    if (world.tick % 30 !== 0) return;
    for (const e of world.query('commonMetal', 'position')) {
      cleanDepositClaims(world, e);
      if (!world.terrain.isLand(e.components.position!.x, e.components.position!.y)) world.remove(e.id);
    }
  } });
}
