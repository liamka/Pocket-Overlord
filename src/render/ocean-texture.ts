import { noise } from '../core/random';
import { smoothNoise } from '../core/natural-biomes';
import { TILE } from './camera';

export const OCEAN_COLOR = '#356eb5';
const shelfColors = ['#83bac7', '#6caccb', '#5999c7', '#4d8bc5', '#427fc0', '#3b76bb', OCEAN_COLOR];
export const offshoreDepth = (x: number, y: number, seed: number): number => 5
  + (smoothNoise(x / 28, y / 28, seed + 809) * 0.7 + smoothNoise(x / 11, y / 11, seed + 853) * 0.3) * 26;
export const depthColor = (depth: number): string => shelfColors[depth < 0.7 ? 0 : depth < 2.1 ? 1 : depth < 4.8 ? 2 : depth < 8 ? 3 : depth < 13 ? 4 : depth < 19 ? 5 : 6];
type Painter = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function drawRipples(ctx: Painter, px: number, py: number, x: number, y: number, seed: number): void {
  ctx.fillStyle = '#d3e8ed0b';
  ctx.fillRect(px + (y % 2 ? 1 : 4), py + 2, 3, 1);
  if (noise(x, y, seed + 919) > 0.35) ctx.fillRect(px + (y % 2 ? 4 : 1), py + 6, 2, 1);
}
export function paintOceanChunk(ctx: Painter, x: number, y: number, stride: number, seed: number, preview = false): void {
  ctx.scale(1 / stride, 1 / stride);
  const span = 32 * stride, sample = preview ? stride * 4 : Math.max(1, stride / TILE);
  for (let ty = 0; ty < span; ty += sample) for (let tx = 0; tx < span; tx += sample) {
    const wx = x + tx, wy = y + ty;
    ctx.fillStyle = depthColor(offshoreDepth(wx, wy, seed));
    ctx.fillRect(tx * TILE, ty * TILE, TILE * sample, TILE * sample);
    if (sample === 1) drawRipples(ctx, tx * TILE, ty * TILE, wx, wy, seed);
  }
}
