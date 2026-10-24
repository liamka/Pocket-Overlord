import type { Entity } from '../core/types';

/** Low foundations and charred beams remain after the collapse animation has settled. */
export function drawRuin(ctx: CanvasRenderingContext2D, entity: Entity): void {
  const state = entity.components.ruin!, variant = entity.components.appearance?.variant ?? 0;
  const stone = state.race === 'dwarf';
  ctx.fillStyle = '#26372b55'; ctx.fillRect(-13, -4, 27, 12);
  ctx.fillStyle = stone ? '#61605a' : '#56483a'; ctx.fillRect(-11, -6, 23, 12);
  ctx.fillStyle = '#302f29'; ctx.fillRect(-8, -4, 17, 8);
  for (let i = 0; i < 9; i++) {
    const x = -12 + (i * 7 + variant * 3) % 24, y = -5 + i * 5 % 12;
    ctx.fillStyle = i % 2 ? '#8b8270' : '#75604b'; ctx.fillRect(x, y, 4, 2);
    ctx.fillStyle = '#39382e'; ctx.fillRect(x, y + 2, 4, 1);
  }
  ctx.fillStyle = '#423b30'; ctx.fillRect(-10, -12, 3, 10); ctx.fillRect(8, -9, 3, 11);
  ctx.fillStyle = '#a3967b'; ctx.fillRect(-10, -12, 3, 2); ctx.fillRect(8, -9, 3, 1);
  ctx.fillStyle = '#66513a';
  for (let i = 0; i < 11; i++) ctx.fillRect(-6 + i, -2 + Math.floor(i / 3), 3, 2);
}
