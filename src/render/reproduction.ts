import type { Entity } from '../core/types';
import { TILE } from './camera';
import { EGG_TRAITS } from '../content/subspecies-traits';
import { hasPhysiology } from '../core/physiology';

const shells = ['#a9b77d', '#be98ce', '#b5dce4', '#e4a6c5', '#b8a984', '#79bbaa', '#94bacd', '#e3d6c0', '#c9ac8e', '#e6945c', '#b4e1e8', '#929ea7', '#a4a0d4', '#dd9e5a', '#e9a4ac', '#e6bb8e', '#d7cba9', '#c5c8a1'];

/** Draw inside the existing creature transform. The embryo is an actual saved entity. */
export function drawEgg(ctx: CanvasRenderingContext2D, entity?: Entity, tick = 0): void {
  const variant = entity ? EGG_TRAITS.findIndex(id => hasPhysiology(entity, id)) : -1;
  ctx.save();
  if (variant === 7) { ctx.translate(0, -6); ctx.rotate(tick / 20); ctx.translate(0, 6); }
  ctx.fillStyle = '#403c36'; ctx.fillRect(-4, -10, 8, 9); ctx.fillRect(-3, -12, 6, 12);
  ctx.fillStyle = shells[variant] ?? '#d7cba9'; ctx.fillRect(-3, -9, 6, 7); ctx.fillRect(-2, -11, 4, 10);
  ctx.fillStyle = '#f7edcd'; ctx.fillRect(-2, -10, 2, 6); ctx.fillStyle = '#a69c7d'; ctx.fillRect(1, -5, 2, 2);
  if (variant === 7 || variant === 8) { ctx.fillStyle = '#484751'; ctx.fillRect(variant === 7 ? -1 : -2, -8, 2, 2); if (variant === 8) ctx.fillRect(1, -8, 1, 2); }
  if (variant === 11) { ctx.fillStyle = '#697783'; ctx.fillRect(-4, -11, 8, 2); ctx.fillRect(-4, -3, 8, 2); }
  if (variant === 14) ['#d78991', '#e5c278', '#9ac796', '#93b9d3'].forEach((color, i) => { ctx.fillStyle = color; ctx.fillRect(-3, -10 + i * 2, 6, 2); });
  if ([0, 4, 6, 9, 10, 13, 15, 17].includes(variant)) {
    ctx.fillStyle = variant === 9 ? '#f9d68a' : variant === 10 ? '#f2fbff' : '#706778';
    ctx.fillRect(-2, -8, 1, 2); ctx.fillRect(1, -5, 2, 2);
  }
  ctx.restore();
}
export function drawReproduction(ctx: CanvasRenderingContext2D, e: Entity, tick: number): void {
  const p = e.components.reproduction?.pending;
  if (p?.method === 'budding') {
    ctx.save(); ctx.translate(6, -5); ctx.scale(0.5, 0.5); drawEgg(ctx); ctx.restore();
  }
  if (p?.method === 'vegetative' || e.components.statuses?.active.some(s => s.id === 'uprooting')) {
    ctx.fillStyle = '#765c3e'; for (const x of [-7, -4, 2, 5]) ctx.fillRect(x, -1, 2, 4 + Math.abs(x) % 3);
  }
  if (p?.method === 'spore') {
    const t = Math.min(1, (tick - p.startedAt) / Math.max(1, p.dueAt - p.startedAt)), origin = e.components.position!;
    ctx.fillStyle = '#b89465';
    for (const slot of p.children) if (slot.point) ctx.fillRect((slot.point.x - origin.x) * TILE * t,
      (slot.point.y - origin.y) * TILE * t - 8 - Math.sin(t * Math.PI) * 10, 2, 2);
  }
}
