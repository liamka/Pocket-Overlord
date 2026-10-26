import { CLOUDS, clouds, cloudDefinitions, cloudRadius } from '../core/clouds';
import { noise } from '../core/random';
import { STEP } from '../core/types';
import type { World } from '../core/world';
import { TILE } from './camera';

const shade = (hex: string, light: number): string => '#' + [1, 3, 5].map(i =>
  Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * light)).toString(16).padStart(2, '0')).join('');
const palettes = Object.fromEntries(Object.entries(cloudDefinitions).map(([type, c]) => [type,
  [shade(c.color, 0.65), shade(c.color, 0.85), c.color, shade(c.color, 1.15)]]));

/** Clouds, rain and bolts follow simulation time and stay still while paused. */
export function drawThunderstorms(ctx: CanvasRenderingContext2D, world: World): void {
  const time = world.tick * STEP;
  ctx.save();
  for (const cloud of clouds(world)) {
    const colors = cloudDefinitions[cloud.type], tones = palettes[cloud.type], scale = cloudRadius(cloud.size) / 3.5;
    const x = Math.round(cloud.x * TILE), y = Math.round(cloud.y * TILE), top = y - 58;
    const opacity = Math.min(1, cloud.remaining / 0.5);
    ctx.globalAlpha = opacity * 0.16; ctx.fillStyle = '#263547';
    ctx.fillRect(x - 28 * scale, y - 10 * scale, 56 * scale, 18 * scale);
    ctx.fillRect(x - 20 * scale, y - 15 * scale, 40 * scale, 28 * scale);
    ctx.globalAlpha = opacity * 0.6; ctx.fillStyle = colors.drop;
    for (let i = 0; i < 12; i++) {
      const dx = (noise(i, 11, cloud.id) * 48 - 24) * scale, fall = (time * 1.6 + noise(i, 29, cloud.id)) % 1;
      ctx.fillRect(Math.round(x + dx), Math.round(top + 16 + fall * 46), cloud.type === 'snow' ? 2 : 1, cloud.type === 'snow' ? 2 : 5);
    }
    if (cloud.lastDrop) { ctx.globalAlpha = opacity * cloud.lastDrop.remaining / CLOUDS.interval;
      ctx.fillRect(Math.round(cloud.lastDrop.x * TILE) - 2, Math.round(cloud.lastDrop.y * TILE) - 1, 4, 2); }
    ctx.globalAlpha = opacity;
    const r = (color: string, dx: number, dy: number, w: number, h: number): void => {
      ctx.fillStyle = color; ctx.fillRect(x + Math.round(dx * scale), top + Math.round(dy * scale), Math.ceil(w * scale), Math.ceil(h * scale));
    };
    r(tones[0], -28, 7, 56, 12); r(tones[1], -32, 3, 64, 12);
    r(tones[2], -27, -2, 22, 15); r(tones[3], -14, -8, 27, 15);
    r(tones[2], 10, -3, 20, 17); r(tones[3], -22, -2, 10, 3);
    r(tones[1], -8, 7, 17, 7); r(tones[0], -24, 14, 49, 6);
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
    ctx.globalAlpha *= 0.18 * bolt.remaining / CLOUDS.boltLife;
    ctx.fillStyle = '#dceeff'; ctx.fillRect(x - 29, top + 3, 58, 15);
  }
  ctx.restore();
}
