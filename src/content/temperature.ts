import type { PixelSprite, Registry } from './registry';
import { TEMPERATURE } from '../core/temperature';
import { applyEvent } from '../systems/effects';

/** Basic temperature brushes; the separate heat-ray catalogue is not implemented here. */
export function registerTemperature(registry: Registry): void {
  for (const [id, label, sign, color] of [['warm', 'Warm', 1, '#ed9b54'], ['cool', 'Cool', -1, '#9dcddd']] as const) {
    const icon: PixelSprite = { pixels: sign > 0
      ? ['....a....', '...aa....', '..abba...', '..abba.a.', '.abbcbba.', '.abcccba.', '..bcccb..', '...bbb...']
      : ['a...a...a', '.a..a..a.', '..a.a.a..', '...aaa...', 'aaaaaaaaa', '...aaa...', '..a.a.a..', '.a..a..a.', 'a...a...a'],
      palette: { a: color, b: '#ffc16a', c: '#fff0ba' }, anchor: { x: 4, y: 4 } };
    registry.registerTool({ id: `core:${id}`, category: 'destruction', label, icon, radius: 3, color, continuous: true,
      hint: sign > 0 ? 'Hold to accumulate heat in bodies and ground.' : 'Hold to accumulate cold in bodies and ground.',
      apply: (world, p) => {
        if (world.paused) return 'Resume time to change temperature.';
        applyEvent(world, { kind: 'tile-heat', ...p, radius: 3, amount: TEMPERATURE.brushCell * sign, cause: 'fire', player: true });
        for (const e of world.nearby(p, 3).sort((a, b) => a.id - b.id))
          applyEvent(world, { kind: 'heat', target: e.id, amount: TEMPERATURE.brushBody * sign, cause: 'fire', player: true });
      },
    });
  }
}
