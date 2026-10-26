import type { Animal, WorkplaceKind } from '../core/village-life';
import type { ColorRoles } from '../content/phenotypes';
import { resolveBodyColors } from './appearance';

const pixel = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1): void => {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

export function drawAnimal(ctx: CanvasRenderingContext2D, animal: Pick<Animal, 'kind' | 'age' | 'heading' | 'stride' | 'moving' | 'hunger'>, color = '#7ab9c0', adult = animal.age >= 16, body?: ColorRoles): void {
  const { kind, stride, moving } = animal;
  const colors = resolveBodyColors(kind, body);
  ctx.save();
  if (Math.cos(animal.heading) < 0) ctx.scale(-1, 1);
  if (!adult) ctx.scale(0.65, 0.65);
  const sheep = kind === 'sheep', wolf = kind === 'wolf', gait = moving ? Math.sin(stride) * 2 : 0;
  if (sheep || kind === 'dog') ctx.scale(0.7, 0.7);
  const r = (c: string, x: number, y: number, w = 1, h = 1): void => pixel(ctx, c, x, y, w, h);
  r('#20362b55', -7, 1, 15, 3);
  for (const [x, phase] of [[-5, 1], [-3, -1], [3, -1], [5, 1]]) {
    r(colors.legs, x + gait * phase, -2, 2, 5); r('#323b33', x + gait * phase, 2, 2, 1);
  }
  if (sheep) {
    r(colors.shadow, -7, -9, 14, 8); r(colors.middle, -8, -9, 14, 6); r(colors.light, -6, -11, 10, 7);
    for (let i = 0; i < 4; i++) r(colors.accent, -5 + i * 3, -10 + i % 2, 2, 2);
    const lower = !moving && animal.hunger > 25 ? 3 : 0;
    r(colors.face, 5, -10 + lower, 5, 7); r(colors.muzzle, 9, -7 + lower, 3, 3);
    r(colors.earLight, 3, -10 + lower, 3, 2); r('#171f20', 8, -9 + lower); r(colors.tail, -9, -7, 2, 3);
  } else {
    const fur = colors.middle, light = colors.light;
    r(fur, -7, -7, 14, 6); r(light, -5, -7, 8, 2); r(fur, 4, -11, 6, 7);
    r(light, 8, -7, 5, 3); r('#28332e', 12, -7, 2, 2); r('#152425', 8, -9);
    r(colors.ears, 4, -13, 2, 4); r(colors.accent, 8, -13, 2, 3);
    r(fur, -10, -8 + (moving ? Math.sin(stride * 2) : 0), 4, 2); r(light, -11, -10, 2, 3);
    if (!wolf) { r(color, 4, -5, 6, 2); r('#efcf77', 8, -3, 1, 2); }
  }
  if (animal.hunger >= 75) { r('#f5bd69', 0, -18, 1, 3); r('#f5bd69', 0, -14); }
  ctx.restore();
}

export function drawWorkplace(ctx: CanvasRenderingContext2D, kind: WorkplaceKind, time: number, color = '#bb8056'): void {
  const r = (c: string, x: number, y: number, w = 1, h = 1): void => pixel(ctx, c, x, y, w, h);
  r('#21382d55', -12, 1, 28, 5);
  if (kind === 'market') {
    r('#775135', -12, -18, 2, 22); r('#775135', 11, -18, 2, 22);
    r('#3b4732', -14, -19, 28, 3);
    for (let i = 0; i < 7; i++) { r(i % 2 ? '#e4d6a7' : color, -14 + i * 4, -18, 4, 7); r(i % 2 ? '#bca778' : '#875b45', -14 + i * 4, -11, 4, 2); }
    r('#755034', -13, -3, 27, 7); r('#ca9f60', -12, -4, 25, 3); r('#e3c388', -12, -4, 25, 1);
    r('#c7ad72', -10, -9, 5, 5); r('#e7d5a0', -9, -10, 3, 2); r('#d18a3d', -3, -7, 7, 3); r('#f2c774', -2, -8, 5, 2);
    r('#7d9561', 6, -7, 5, 3); r('#b6c678', 7, -8, 3, 2);
  } else {
    r('#76654d', -10, -11, 21, 15); r('#d4c598', -9, -11, 19, 13);
    r(color, -12, -15, 25, 5); r(color, -8, -19, 17, 5); r('#deb77c', -6, -19, 13, 2);
    r('#534b38', -3, -4, 6, 8); r('#be975a', -2, -3, 4, 7);
    if (kind === 'mill') {
      r('#b6a077', -5, -26, 11, 18); r('#e2d4a9', -4, -25, 9, 15);
      const angle = time * 0.65;
      for (let blade = 0; blade < 4; blade++) {
        const direction = angle + blade * Math.PI / 2;
        for (let d = 2; d < 14; d++) { r('#79684b', Math.cos(direction) * d, -22 + Math.sin(direction) * d, 2, 2); if (d > 5) r('#eee1b7', Math.cos(direction) * d + Math.sin(direction) * 2, -22 + Math.sin(direction) * d - Math.cos(direction) * 2, 3, 3); }
      }
      r('#65573f', -1, -23, 4, 4); r('#d7c18b', -11, -5, 5, 8);
    } else if (kind === 'bakery') {
      r('#795646', 5, -25, 5, 13); r('#b28665', 5, -25, 5, 2);
      const rise = Math.floor(time * 5) % 9;
      r('#c9c6ac80', 5, -28 - rise, 4, 3); r('#c9c6ac55', 8, -34 - rise, 5, 3);
      r('#624d37', -9, -8, 6, 6); r('#e5a44f', -8, -7, 4, 4); r('#f5d28b', -7, -6, 2, 2);
      r('#e0b767', 5, -7, 5, 3); r('#86643f', 6, -7, 1, 2);
    } else {
      r('#805637', -12, -4, 15, 2); r('#5d4635', -11, -2, 2, 6); r('#5d4635', 0, -2, 2, 6);
      r('#4f6366', -9, -8, 9, 3); r('#8fa4a0', -7, -9, 6, 2);
      r('#765537', 6, -8, 2, 10); r('#a7b4a5', 3, -9, 8, 3);
      r('#d7b274', 9, 1, 6, 2); r('#987046', 10, 3, 6, 2);
    }
  }
}
