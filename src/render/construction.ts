import type { Entity } from '../core/types';
import { raceOf } from '../core/races';
import { drawSprite } from './sprites';

export function drawConstruction(ctx: CanvasRenderingContext2D, entity: Entity, tick: number, color?: string): void {
  const site = entity.components.dwelling!.construction!, progress = site.progress;
  const rect = (color: string, x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  const beam = (x: number, y: number, toX: number, toY: number): void => {
    const length = Math.ceil(Math.hypot(toX - x, toY - y));
    for (let i = 0; i <= length; i++) rect('#b68c51', x + (toX - x) * i / length, y + (toY - y) * i / length, 2, 2);
  };
  rect('#394b3444', -12, -1, 26, 8);
  // The foundation, wall frame and roof timbers appear as separate construction stages.
  for (let n = 0; n < 7; n++) {
    rect(n % 2 ? '#888a70' : '#aba487', -10 + n * 3, 2, 3, 3);
    rect('#c6bba0', -10 + n * 3, 2, 2, 1);
  }
  if (progress >= 1 / 12) {
    rect('#6b563a', -9, -3, 19, 5);
    for (let x = -8; x < 10; x += 3) rect('#bc9b62', x, -3, 2, 4);
  }
  if (progress >= 2 / 12) {
    const height = Math.min(16, Math.floor((progress - 1 / 12) * 64));
    for (const x of [-9, 0, 8]) { rect('#735537', x, 1 - height, 2, height); rect('#d3ae6a', x, 1 - height, 1, height); }
    if (height >= 12) beam(-8, -12, 9, -12);
  }
  if (progress >= 5 / 12) { beam(-10, -13, 0, -25); beam(0, -25, 11, -13); beam(0, -25, 0, -12); }
  if (progress >= 3 / 12) {
    const top = 5 - (progress - 0.25) / 0.75 * 38;
    ctx.save(); ctx.beginPath(); ctx.rect(-13, top, 27, 10 - top); ctx.clip();
    drawSprite(ctx, 'house', entity.components.appearance?.variant, tick / 30, false, 0, color, raceOf(entity));
    ctx.restore();
  }
  const piles = Math.max(1, 4 - Math.floor(progress * 4));
  for (let i = 0; i < piles; i++) {
    rect('#795939', -17 + i % 2, 5 - i * 2, 9, 2); rect('#d8b77a', -17 + i % 2, 5 - i * 2, 8, 1);
  }
  if (progress >= 0.25) {
    ctx.save(); ctx.globalAlpha *= progress > 0.85 ? 0.65 : 1;
    for (const x of [-14, 13]) {
      rect('#6b5038', x, -21, 2, 27); rect('#c6a267', x, -21, 1, 26);
      rect('#e5d3a0', x - 1, -7, 3, 1); rect('#e5d3a0', x - 1, -16, 3, 1);
    }
    rect('#795a39', -15, -7, 31, 2); rect('#d9b678', -15, -8, 31, 1);
    if (progress > 0.45) {
      rect('#a17d4b', 11, -18, 1, 23); rect('#a17d4b', 17, -18, 1, 23);
      for (let y = -16; y <= 4; y += 4) rect('#dec087', 11, y, 7, 1);
    }
    ctx.restore();
  }
  const age = (tick - site.struckAt) / 30;
  if (site.struckAt >= 0 && age < 0.4) {
    ctx.save(); ctx.globalAlpha *= 1 - age / 0.4;
    for (let n = 0; n < 5; n++) rect(n % 2 ? '#ddc99f' : '#ae9770', (n - 2) * (1 + age * 10), -3 - Math.sin(age / 0.4 * Math.PI) * (2 + n % 3), 2, 2);
    ctx.restore();
  }
}
