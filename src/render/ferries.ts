import type { World } from '../core/world';
import { ferryAvailable, ferryPosition, ferryRoutes, tilePoint } from '../core/ferries';
import { TILE } from './camera';

export function drawFerries(ctx: CanvasRenderingContext2D, world: World): void {
  for (const { road, ferry } of ferryRoutes(world)) {
    if (!ferryAvailable(world, road, ferry)) continue;
    const a = tilePoint(world, road.tiles[ferry.start]), b = tilePoint(world, road.tiles[ferry.end]);
    const vertical = a.x === b.x;
    for (const bank of [a, b]) {
      ctx.save(); ctx.translate(Math.round(bank.x * TILE), Math.round(bank.y * TILE));
      if (vertical) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = '#65482f'; ctx.fillRect(-4, -5, 8, 10);
      ctx.fillStyle = '#c4a371';
      for (let y = -4; y <= 4; y += 3) ctx.fillRect(-4, y, 8, 2);
      ctx.fillStyle = '#4a3628'; ctx.fillRect(-5, -6, 2, 3); ctx.fillRect(3, 3, 2, 3);
      ctx.restore();
    }
    const p = ferryPosition(world, road, ferry);
    ctx.save(); ctx.translate(Math.round(p.x * TILE), Math.round(p.y * TILE));
    if (vertical) ctx.rotate(Math.PI / 2);
    if (ferry.progress !== ferry.target) {
      ctx.fillStyle = '#acd6dd';
      const stern = ferry.target ? -1 : 1;
      ctx.fillRect(stern * 13 - 2, -3, 3, 1); ctx.fillRect(stern * 15 - 2, 3, 3, 1);
    }
    ctx.fillStyle = '#315e75'; ctx.fillRect(-10, 5, 20, 3);
    ctx.fillStyle = '#4d3425'; ctx.fillRect(-10, -5, 20, 12); ctx.fillRect(-12, -3, 24, 8);
    ctx.fillStyle = '#bd9056'; ctx.fillRect(-9, -4, 18, 9);
    ctx.fillStyle = '#e0b87c';
    for (let x = -8; x <= 7; x += 3) ctx.fillRect(x, -4, 2, 9);
    ctx.fillStyle = '#705031'; ctx.fillRect(-10, -6, 20, 2); ctx.fillRect(-10, 5, 20, 2);
    ctx.restore();
  }
}
