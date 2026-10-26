import type { PixelSprite, Registry } from './registry';
import type { Entity, Vec2 } from '../core/types';
import { Terrain } from '../core/types';
import type { World } from '../core/world';
import { NaturalBiome } from '../core/natural-biomes';
import { newDeposit } from '../core/deposits';
import { GOLD } from '../core/gold';
import { hasTrait } from '../core/traits';

const sprite: PixelSprite = {
  pixels: ['      dddd      ', '    ddsslsdd    ', '   dslyylsssd   ', '  dsslywlsslysd ',
    ' dsssyllsslywsd ', 'dsslylssssllyssd', ' dsslyylsssssdd ', '  ddddddddddd   '],
  palette: { d: '#49463e', s: '#807968', l: '#c89a35', y: '#f4c94f', w: '#fff0a0' }, anchor: { x: 7, y: 6 },
};
export function canPlaceGold(world: World, p: Vec2): boolean {
  const tile = world.terrain.at(p.x, p.y);
  return (tile === Terrain.Grass || tile === Terrain.Sand) && world.safeLand(p, 0.7) && world.canStand(p, 0.7)
    && !world.nearby(p, 2.5).some(e => e.components.building || e.components.farm || e.components.ruin
      || e.components.stone || e.components.commonMetal || e.components.gemSource);
}
/** Mine plan 51 owns when/where to attempt creation. This creates only a finite
 * source, never village stock, and is deliberately absent from world seeding. */
export function placeGoldOre(world: World, p: Vec2, origin: 'placed' | 'mine' | 'biology' = 'mine'): Entity | undefined {
  if (!canPlaceGold(world, p)) return;
  const source = world.spawn('core:gold-ore', p);
  if (source) source.components.stone!.origin = origin;
  return source;
}
/** Called by the inherited trait's saved periodic deadline. No general food or
 * manure system is introduced here. A crowded site consumes the attempt. */
export function produceGold(world: World, actor: Entity): void {
  const p = actor.components.position;
  if (world.paused || !p || world.entities.get(actor.id) !== actor || !hasTrait(actor, 'bioproduct-gold')
    || (actor.components.health?.current ?? 0) <= 0 || actor.components.thermal?.burning
    || !world.terrain.isLand(p.x, p.y) || world.nearby(p, 8).some(e => e.components.stone?.profile === 'goldOre')) return;
  if (world.rng.next() >= GOLD.biologicalChance) return;
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, q = { x: p.x + Math.cos(angle) * 2.8, y: p.y + Math.sin(angle) * 2.8 };
    if (placeGoldOre(world, q, 'biology')) return;
  }
}
export function registerGold(registry: Registry): void {
  registry.registerEntity({ id: 'core:gold-ore', sprite, create: p => ({
    position: { ...p }, health: { current: 120, max: 120 }, solid: { radius: 0.65 },
    stone: newDeposit(NaturalBiome.Grassland, 'mine', 'goldOre'),
  }) });
  registry.registerTool({ id: 'core:gold-ore', category: 'nature', label: 'Gold ore', icon: sprite, radius: 0.7, color: '#f4c94f',
    hint: 'Residents carry gold and stone to storage. Gold pays for buildings; personal coins stay separate.', canApply: canPlaceGold,
    apply: (world, p) => {
      if (!canPlaceGold(world, p)) return 'Place gold ore on clear, dry land';
      if (!placeGoldOre(world, p, 'placed')) return 'Too many objects in the world';
    },
  });
}
