import type { PixelSprite, Registry } from './registry';
import type { World } from '../core/world';
import { Terrain, type Vec2 } from '../core/types';
import { integer } from '../core/validation';
import { Random } from '../core/random';
import { STONE } from '../core/stone';

declare module '../core/types' {
  interface ComponentMap { stone: { remaining: number } }
}

const sprite: PixelSprite = {
  pixels: [
    '      ddddd       ',
    '    ddllllldd     ',
    '   dlllmmmmlmd    ',
    '  dlllmmmmmmmsd   ',
    ' dllmmmmddmmmsdd  ',
    ' dlmmmmdllmdmsssd ',
    'dlmmmmdllmmmdsssd ',
    'dmmmmdllmmmmmdsssd',
    'dmmmmdmmmmmmmdsssd',
    ' dsssddmmmmmddssd ',
    '  dddddssssddddd  ',
    '     ddddddd      ',
  ], palette: { d: '#424f50', l: '#c4cbc0', m: '#8b9793', s: '#657472' }, anchor: { x: 8, y: 9 },
};

function canPlace(world: World, p: Vec2): boolean {
  const tile = world.terrain.at(p.x, p.y);
  return (tile === Terrain.Grass || tile === Terrain.Sand) && world.safeLand(p, 0.7) && world.canStand(p, 0.7)
    && !world.nearby(p, 2).some(e => e.components.farm || e.components.ruin || e.components.stone);
}

/** Independent randomness scatters deposits without advancing the simulation RNG. */
export function seedStone(world: World): void {
  if (!world.registry.entities.has('core:stone')) return;
  const rng = new Random(world.seed ^ 0x57a0), { width, height } = world.terrain;
  const attempts = Math.floor(width * height / 240);
  for (let i = 0; i < attempts; i++) {
    const p = { x: rng.range(1, width - 1), y: rng.range(1, height - 1) };
    if (canPlace(world, p)) world.spawn('core:stone', p);
  }
}

export function registerStone(registry: Registry): void {
  registry.registerComponent('stone', v => integer(v.remaining, 1, STONE.deposit));
  registry.registerEntity({ id: 'core:stone', sprite, create: p => ({
    position: { ...p }, health: { current: 120, max: 120 }, solid: { radius: 0.65 }, stone: { remaining: STONE.deposit },
  }) });
  registry.registerTool({ id: 'core:stone', category: 'nature', label: 'Stone', icon: sprite, radius: 0.7, color: '#bbc4bd',
    hint: 'Place a stone deposit. Residents mine it for stronger homes and stone axes.', canApply: canPlace,
    apply: (world, p) => {
      if (!canPlace(world, p)) return 'Place stone on clear, dry land';
      if (!world.spawn('core:stone', p)) return 'В мире слишком много объектов';
    },
  });
  registry.registerSystem({ id: 'core:stone-deposits', after: ['core:landscape'], before: ['core:ferries'], update: world => {
    if (world.tick % 30 !== 0) return;
    for (const e of world.query('stone', 'position')) if (!world.terrain.isLand(e.components.position!.x, e.components.position!.y)) world.remove(e.id);
  } });
}
