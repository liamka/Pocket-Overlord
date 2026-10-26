import type { TileLayers } from '../core/tiles';
import { TILE } from './camera';

/** Own pixel marks for layers, drawn below entities so a house can cover an intact fuse or mine. */
export function drawTileLayers(ctx: CanvasRenderingContext2D, layer: TileLayers | undefined, x: number, y: number): void {
  if (!layer) return;
  const px = x * TILE, py = y * TILE;
  if (layer.lavaStage) {
    ctx.fillStyle = ['#55413b', '#873e2f', '#bc4f27', '#ee772a'][layer.lavaStage - 1]; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = ['#85523d', '#ba6936', '#f29b3d', '#ffe286'][layer.lavaStage - 1];
    ctx.fillRect(px + 1, py + 2, 3, 1); ctx.fillRect(px + 4, py + 5, 2, 1);
  }
  if (layer.frost) {
    ctx.fillStyle = layer.frost === 'ice' ? '#8ebdcc' : '#dce8e3'; ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = layer.frost === 'ice' ? '#c8e5e9' : '#f2f6ed'; ctx.fillRect(px + 1, py + 2, 4, 1);
  }
  if (layer.top) {
    const wall = layer.top.startsWith('wall-'), flower = layer.top.startsWith('flower-');
    ctx.fillStyle = wall ? '#788d98' : flower ? layer.top === 'flower-dark' ? '#9871a9' : '#e8dbaa' : layer.top === 'grey-goo' ? '#777e9c' : '#a96946';
    ctx.fillRect(px + (wall ? 0 : 2), py + (wall ? 0 : 2), wall ? TILE : 4, wall ? TILE : 4);
    if (wall) { ctx.fillStyle = '#afc0be'; ctx.fillRect(px, py, TILE, 1); }
  }
  if (layer.burning) { ctx.fillStyle = '#eb8a38'; ctx.fillRect(px + 1, py + 4, 2, 2); ctx.fillStyle = '#f3c75e'; ctx.fillRect(px + 4, py + 2, 2, 2); }
}
