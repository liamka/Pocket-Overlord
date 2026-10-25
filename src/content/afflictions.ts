import type { Registry, PixelSprite } from './registry';
import { MADNESS, PLAGUE } from '../core/afflictions';
import { afflictions, enrage, infect } from '../systems/afflictions';

const plagueIcon: PixelSprite = { pixels: ['..aaaaa..', '.abbbbba.', 'abccbccba', 'abccbccba', '.abbbbba.', '..ababa..', '..aaaaa..', '.dd...dd.', 'dd.....dd'],
  palette: { a: '#34462d', b: '#b6c77a', c: '#28352b', d: '#758f3d' }, anchor: { x: 4, y: 4 } };
const madnessIcon: PixelSprite = { pixels: ['.a.....a.', '..ababa..', '.bcccccb.', 'bcddcddcb', 'bceeceecb', '.bcccccb.', '..bdddb..', '..bbbbb..'],
  palette: { a: '#ce3f32', b: '#673127', c: '#c57353', d: '#442a28', e: '#ffebae' }, anchor: { x: 4, y: 4 } };

export function registerAfflictions(registry: Registry): void {
  registry.registerSystem({ id: 'core:afflictions', after: ['core:fire'], before: ['core:landscape'], update: afflictions });
  registry.registerTool({ id: PLAGUE.id, label: 'Plague', category: 'destruction', icon: plagueIcon, radius: PLAGUE.brush, paint: true, color: '#a6b957',
    hint: 'Click or drag to infect residents. The plague spreads through close contact and slowly kills.',
    apply: (world, p) => { for (const entity of world.nearby(p, PLAGUE.brush)) infect(entity); },
  });
  registry.registerTool({ id: MADNESS.id, label: 'Madness', category: 'destruction', icon: madnessIcon, radius: MADNESS.brush, paint: true, color: '#d9674c',
    hint: 'Click or drag to drive residents mad. They abandon their tasks and attack anyone nearby.',
    apply: (world, p) => { for (const entity of world.nearby(p, MADNESS.brush)) enrage(world, entity); },
  });
}
