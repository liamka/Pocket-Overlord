import type { Entity } from '../core/types';
import { raceOf } from '../core/races';
import { drawSprite } from './sprites';

export function drawStoneHouse(ctx: CanvasRenderingContext2D, entity: Entity, time: number, color?: string): void {
  drawSprite(ctx, 'house', entity.components.appearance?.variant, time, false, 0, color, raceOf(entity));
  // Masonry keeps the original roof and each people's silhouette visible.
  ctx.fillStyle = '#4f5c5b'; ctx.fillRect(-9, -10, 19, 14);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
    const x = -9 + col * 4 + row % 2 * 2;
    ctx.fillStyle = (col + row) % 3 ? '#a2ada6' : '#bec5b7';
    if (x < 9) ctx.fillRect(x, -10 + row * 3, Math.min(3, 9 - x), 2);
  }
  ctx.fillStyle = '#3b443d'; ctx.fillRect(-2, -5, 5, 9);
  ctx.fillStyle = '#a88151'; ctx.fillRect(-1, -4, 3, 8);
  ctx.fillStyle = '#d9c597'; ctx.fillRect(1, 0, 1, 1);
  ctx.fillStyle = '#475e63'; ctx.fillRect(-7, -7, 3, 4); ctx.fillRect(5, -7, 3, 4);
  ctx.fillStyle = '#b7d8d5'; ctx.fillRect(-7, -7, 2, 2); ctx.fillRect(5, -7, 2, 2);
  ctx.fillStyle = '#d4d8c9'; ctx.fillRect(-10, 3, 21, 2);
}

export function drawConstruction(ctx: CanvasRenderingContext2D, entity: Entity, tick: number, color?: string): void {
  const site = entity.components.dwelling!.construction!, progress = site.progress;
  const rect = (color: string, x: number, y: number, w: number, h: number): void => {
    ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  };
  const beam = (x: number, y: number, toX: number, toY: number): void => {
    const length = Math.ceil(Math.hypot(toX - x, toY - y));
    for (let i = 0; i <= length; i++) rect('#b68c51', x + (toX - x) * i / length, y + (toY - y) * i / length, 2, 2);
  };
  if (site.upgrade) {
    drawSprite(ctx, 'house', entity.components.appearance?.variant, tick / 30, false, 0, color, raceOf(entity));
    ctx.save(); ctx.beginPath(); ctx.rect(-14, 5 - progress * 18, 28, progress * 18); ctx.clip();
    drawStoneHouse(ctx, entity, tick / 30, color); ctx.restore();
    for (const x of [-14, 13]) { rect('#735637', x, -17, 2, 23); rect('#bc9b63', x, -17, 1, 22); }
    rect('#bc9b63', -15, -6, 30, 2);
    for (let i = 0; i < 3; i++) rect(i % 2 ? '#b9c2b9' : '#7f8d87', -18 + i % 2 * 4, 5 - i * 3, 5, 3);
    return;
  }
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
