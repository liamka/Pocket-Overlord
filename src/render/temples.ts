import type { Entity } from '../core/types';

/** Original civic masonry in the existing peoples' palettes. No imported art or religious effects. */
export function drawTemple(ctx: CanvasRenderingContext2D, entity: Entity, tick: number, color?: string): void {
  const b = entity.components.building!, project = b.project;
  const style = b.architecture === 'elf' ? { wall: '#d3c8a3', shadow: '#789075', roof: '#56783d', light: '#a8c877' }
    : b.architecture === 'orc' ? { wall: '#b69b77', shadow: '#695d4b', roof: '#8a4b38', light: '#d09564' }
    : b.architecture === 'dwarf' ? { wall: '#b6bcb2', shadow: '#687674', roof: '#596c79', light: '#c2d0ce' }
    : { wall: '#d8cfaf', shadow: '#858b82', roof: '#617b99', light: '#aac1cb' };
  const r = (fill: string, x: number, y: number, w: number, h: number): void => { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); };
  r('#26372b55', -21, -3, 43, 16); r(style.shadow, -20, -4, 40, 14); r(style.wall, -19, -5, 38, 3);
  if (entity.components.ruin) {
    r('#434b44', -16, -3, 32, 9);
    for (let i = 0; i < 10; i++) { r(style.shadow, -18 + i * 7 % 34, -2 + i * 3 % 9, 5, 3); r(style.wall, -18 + i * 7 % 34, -2 + i * 3 % 9, 4, 1); }
    r(style.wall, -16, -16, 4, 17); r(style.shadow, 12, -12, 5, 13);
    r(style.light, -17, -17, 6, 2); r(style.light, 11, -13, 7, 2);
    return;
  }
  const progress = project?.action === 'build' ? project.progress : 1;
  if (progress > 0) {
    ctx.save(); ctx.beginPath(); ctx.rect(-22, 8 - 52 * progress, 44, 52 * progress); ctx.clip();
    r(style.shadow, -17, -26, 34, 31); r(style.wall, -16, -26, 31, 29);
    r('#3a4945', -4, -14, 8, 19); r(style.light, -5, -16, 10, 2);
    for (const x of [-15, -9, 7, 13]) {
      r(style.shadow, x, -23, 4, 26); r(style.wall, x, -23, 2, 26); r(style.light, x - 1, -24, 5, 2);
    }
    r(style.shadow, -20, -28, 40, 4);
    const tiers = b.architecture === 'dwarf' ? 3 : b.architecture === 'elf' ? 7 : 5;
    for (let i = 0; i < tiers; i++) {
      const inset = i * (b.architecture === 'elf' ? 2 : 3);
      r(style.roof, -20 + inset, -30 - i * 2, 40 - inset * 2, 3);
      r(style.light, -20 + inset, -30 - i * 2, 40 - inset * 2, 1);
    }
    r('#ecd58c', -2, -31 - tiers * 2, 4, 4);
    r(color ?? style.roof, 7, -20, 4, 9); r('#e8d9a5', 8, -19, 2, 2);
    ctx.restore();
  }
  r(style.wall, -10, 5, 20, 2); r(style.light, -12, 8, 24, 2);
  if (project) {
    for (const x of [-23, 22]) { r('#775d3b', x, -30, 2, 39); r('#c6a267', x, -30, 1, 39); }
    r('#c6a267', -24, -15, 49, 2);
    for (let i = 0; i < 3; i++) r(style.wall, -27 + i % 2 * 4, 6 - i * 3, 6, 3);
    const age = tick - project.struckAt;
    if (project.struckAt >= 0 && age < 12) for (let i = 0; i < 4; i++) r('#e7d9ba', -5 + i * 3, -3 - age - i % 2 * 3, 2, 2);
  }
}
