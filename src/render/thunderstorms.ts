import { STORM, stormClouds } from '../content/thunderstorms';
import { noise } from '../core/random';
import { STEP } from '../core/types';
import type { World } from '../core/world';
import { TILE } from './camera';

/** Clouds, rain and bolts follow simulation time and stay still while paused. */
export function drawThunderstorms(ctx: CanvasRenderingContext2D, world: World): void {
  const time = world.tick * STEP;
  ctx.save();
  for (const cloud of stormClouds(world)) {
    const x = Math.round(cloud.x * TILE), y = Math.round(cloud.y * TILE), top = y - 58;
    const opacity = Math.min(1, cloud.remaining / 0.5);
    ctx.globalAlpha = opacity * 0.16; ctx.fillStyle = '#263547';
    ctx.fillRect(x - 28, y - 10, 56, 18); ctx.fillRect(x - 20, y - 15, 40, 28);
    ctx.globalAlpha = opacity * 0.55; ctx.fillStyle = '#85bfe8';
    for (let i = 0; i < 32; i++) {
      const dx = noise(i, 11) * 48 - 24, fall = (time * 1.6 + noise(i, 29)) % 1;
      ctx.fillRect(Math.round(x + dx - fall * 5), Math.round(top + 16 + fall * 46), 1, 5);
    }
    ctx.globalAlpha = opacity;
    const r = (color: string, dx: number, dy: number, w: number, h: number): void => {
      ctx.fillStyle = color; ctx.fillRect(x + dx, top + dy, w, h);
    };
    r('#283448', -28, 7, 56, 12); r('#39465d', -32, 3, 64, 12);
    r('#526078', -27, -2, 22, 15); r('#5e6c84', -14, -8, 27, 21);
    r('#495871', 10, -3, 20, 17); r('#718097', -10, -8, 16, 4);
    r('#313e54', -24, 14, 49, 6);
    const bolt = cloud.bolt;
    if (!bolt) continue;
    const bx = Math.round(bolt.x * TILE), by = Math.round(bolt.y * TILE);
    ctx.globalAlpha = opacity * Math.min(1, bolt.remaining / 0.1);
    const points = [{ x, y: top + 16 }];
    for (let i = 1; i < 7; i++) points.push({
      x: Math.round(x + (bx - x) * i / 7 + (noise(i, bolt.seed) - 0.5) * 15),
      y: Math.round(top + 16 + (by - top - 16) * i / 7),
    });
    points.push({ x: bx, y: by });
    for (const [color, width] of [['#6baaff', 6], ['#fff3b0', 3], ['#ffffff', 1]] as const) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'miter'; ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#dceeff'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(points[3].x, points[3].y); ctx.lineTo(points[3].x + 10, points[3].y + 4); ctx.lineTo(points[3].x + 7, points[3].y + 12); ctx.stroke();
    ctx.fillStyle = '#fff3b0'; ctx.fillRect(bx - 6, by - 1, 12, 2); ctx.fillRect(bx - 1, by - 5, 2, 10);
    ctx.globalAlpha *= 0.18 * bolt.remaining / STORM.boltLife;
    ctx.fillStyle = '#dceeff'; ctx.fillRect(x - 29, top + 3, 58, 15);
  }
  ctx.restore();
}
