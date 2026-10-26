import { plantProblem } from '../core/biome-ecology';
import type { Registry, PixelSprite } from './registry';
import { SEED_BIOMES, naturalTreeSite } from '../core/natural-biomes';
import { Terrain } from '../core/types';
import { FOREST } from '../core/forestry';

const glyphs = [
  ['...gg...', '..gggg..', '.gggggg.', '..gggg..', '...tt...', '...tt...'],
  ['.gggggg.', 'gggggggg', '...tt...', '..ttt...', '...tt...', '...tt...'],
  ['...gg...', '.g.gg...', '.g.gg.g.', '.gggg.g.', '...gggg.', '...gg...'],
  ['.gg..gg.', 'gggggggg', '..gggg..', '...tt...', '....tt..', '....tt..'],
  ['.g....g.', '.g..g.g.', '.gg.ggg.', '..g.g.g.', '..g.g.g.', '..t.t.t.'],
  ['...g....', '.g.g.g..', '..ggg...', 'ggggggg.', '..ggg...', '.g.g.g..'],
  ['...g....', '.ggggg..', 'ggggggg.', '.ggtgg..', '..ttt...', '...t....'],
  ['g..t..g.', '.gtt.g..', '..ttt...', '.t.t.t..', '...t....', '..ttt...'],
  ['...g....', '.g.g.g..', '.gtttg..', '..ttt...', '...t....', '..ttt...'],
  ['..gggg..', '.gggggg.', 'gggggggg', '...tt...', '...tt...', '..tttt..'],
  ['...g....', '..ggg...', 'g.ggg.g.', 'gggggggg', '.gggggg.', '..gggg..'],
  ['..gggg..', '.ggttgg.', '.gtggtg.', '..gggg..', '...tt...', '...tt...'],
  ['..gggg..', '.ggtggg.', 'ggggtggg', '.gtgggg.', '...tt...', '..tttt..'],
];
const foliage = ['#376b46', '#376b46', '#376b46', '#376b46', '#376b46', '#ffffff', '#c5e8ef', '#b4a2c9', '#ef905c', '#e3b0df', '#a8eafa', '#ffe1cd', '#e6d55b'];

export function registerNaturalBiomes(registry: Registry): void {
  for (const biome of SEED_BIOMES) {
    const icon: PixelSprite = {
      pixels: ['..bbbbbbbbbb..', '.bssssssssssb.', 'bssssssssssssb', ...glyphs[biome.id].map(row => `bss${row.replaceAll('.', 's')}ssb`), 'bssssssssssssb', 'bssssssssssssb', '.bbbbbbbbbbbb.']
        .flatMap(row => { const pixels = [...row].map(pixel => pixel + pixel).join(''); return [pixels, pixels]; }),
      palette: { b: '#514733', s: biome.colors[1], g: foliage[biome.id], t: '#806044' }, anchor: { x: 14, y: 12 },
    };
    registry.registerTool({
      id: `core:biome-${biome.key}`, category: 'biomes', label: biome.label, hint: biome.hint,
      icon, color: biome.colors[1], radius: 6, continuous: true, paint: true,
      canApply: (world, point) => {
        let suitable = false;
        world.terrain.circle(point.x, point.y, 6, (x, y) => { if (world.terrain.canPaintBiome(x, y)) suitable = true; });
        return suitable;
      },
      apply: (world, point) => {
        world.terrain.circle(point.x, point.y, 6, (x, y) => {
          if (!world.terrain.canPaintBiome(x, y)) return;
          world.terrain.paintBiome(x, y, biome.id);
          // Stable planting sites keep repeated strokes from packing trees together.
          if (world.terrain.at(x, y) !== Terrain.Grass || plantProblem(world, { x, y })) return;
          const p = naturalTreeSite(x, y, world.seed, biome.id);
          if (!p) return;
          if (world.canStand(p, 1.2) && !world.nearby(p, 4).some(e => e.components.farm || e.components.dwelling || e.components.person)
            && world.nearby(p, FOREST.densityRadius).filter(e => e.components.tree).length < FOREST.maxDensity) world.spawn('core:tree', p, 'planted');
        });
      },
    });
  }
}
