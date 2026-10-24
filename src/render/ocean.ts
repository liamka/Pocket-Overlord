import { noise } from '../core/random';
import type { TerrainMap } from '../core/terrain';
import { isBridge, Terrain } from '../core/types';
import type { World } from '../core/world';
import { SEA_WAVES, seaWaveShape, seaWaves } from '../systems/effects';
import { TILE } from './camera';

export const OCEAN_COLOR = '#3680d4';
const shelfColors = ['#6cbcf6', '#5bacfd', '#56a9f5', '#4b9af4', '#428de5', '#3986dc', OCEAN_COLOR];

/** Shore distance is visual only; the saved water tiles still control swimming. */
export class Ocean {
  private land = new Uint8Array(0);
  private distances = new Float32Array(0);
  private map: TerrainMap | undefined;

  drawWaves(ctx: CanvasRenderingContext2D, world: World, crests: boolean): void {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, world.terrain.width * TILE, world.terrain.height * TILE); ctx.clip();
    for (const wave of seaWaves(world)) {
      const shape = seaWaveShape(wave.blastRadius);
      for (let crest = 0; crest < SEA_WAVES.crests; crest++) {
        const radius = (wave.elapsed - 0.15 - crest * shape.interval) * shape.speed;
        if (radius <= 0 || radius > shape.range + shape.width) continue;
        const strength = (1 - crest * 0.22) * Math.min(1, radius / 3) * Math.max(0, 1 - radius / shape.range * 0.65);
        for (let ray = 0; ray < SEA_WAVES.rays; ray++) {
          const next = (ray + 1) % SEA_WAVES.rays, reach = Math.min(wave.reach[ray], wave.reach[next]);
          const shore = Math.min(wave.shore[ray], wave.shore[next]), front = Math.min(radius, reach);
          const inner = Math.max(0, radius - shape.width * 1.8), coastFade = Math.min(1, Math.max(0, (reach + shape.width - radius) / shape.width));
          if (inner >= front || coastFade <= 0) continue;
          const a = ray * Math.PI * 2 / SEA_WAVES.rays, b = (ray + 1) * Math.PI * 2 / SEA_WAVES.rays;
          const point = (angle: number, r: number) => ({ x: (wave.x + Math.cos(angle) * r) * TILE, y: (wave.y + Math.sin(angle) * r) * TILE });
          const p = point(a, front), q = point(b, front), u = point(a, inner), v = point(b, inner);
          const breaking = radius >= shore - 2, alpha = strength * coastFade;
          if (!crests) {
            ctx.globalAlpha = alpha * (shape.tsunami ? 0.55 : 0.2); ctx.fillStyle = '#237dc1';
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.lineTo(v.x, v.y); ctx.lineTo(u.x, u.y); ctx.closePath(); ctx.fill();
            continue;
          }
          if (!shape.tsunami) {
            ctx.globalAlpha = alpha * 0.85; ctx.strokeStyle = breaking ? '#edfff0' : '#b4edf5'; ctx.lineWidth = breaking ? 3 : 2;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
            continue;
          }
          const height = (32 + (breaking ? 24 : 0)) * alpha * (0.9 + Math.sin(wave.elapsed * 5 + ray * 0.24) * 0.1);
          ctx.globalAlpha = Math.min(0.95, alpha + 0.3);
          const backP = point(a, Math.max(0, front - shape.width)), backQ = point(b, Math.max(0, front - shape.width));
          ctx.fillStyle = '#349dd2';
          ctx.beginPath(); ctx.moveTo(backP.x, backP.y); ctx.lineTo(backQ.x, backQ.y);
          ctx.lineTo(q.x, q.y - height); ctx.lineTo(p.x, p.y - height); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#1e66a4';
          ctx.beginPath(); ctx.moveTo(p.x, p.y + 3); ctx.lineTo(q.x, q.y + 3); ctx.lineTo(q.x, q.y - height); ctx.lineTo(p.x, p.y - height); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#51bde4';
          ctx.beginPath(); ctx.moveTo(p.x, p.y - height * 0.45); ctx.lineTo(q.x, q.y - height * 0.45);
          ctx.lineTo(q.x, q.y - height); ctx.lineTo(p.x, p.y - height); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = alpha; ctx.strokeStyle = '#e1fff4'; ctx.lineWidth = breaking ? 7 : 4;
          ctx.beginPath(); ctx.moveTo(p.x, p.y - height); ctx.lineTo(q.x, q.y - height); ctx.stroke();
          const n = noise(ray + crest * 193, world.seed), foam = (wave.elapsed * 1.4 + n) % 1;
          ctx.globalAlpha = alpha * (1 - foam); ctx.fillStyle = '#effff7';
          for (let drop = 0; drop < (breaking ? 4 : 2); drop++) {
            const t = (drop + n) / 4, px = p.x + (q.x - p.x) * t, py = p.y + (q.y - p.y) * t;
            const size = breaking ? 3 + n * 4 : 2 + n * 3;
            ctx.fillRect(Math.round(px + Math.cos(a) * foam * 10), Math.round(py - height - Math.sin(foam * Math.PI) * (breaking ? 18 : 7)), size, size);
          }
        }
      }
    }
    ctx.restore();
  }

  update(map: TerrainMap): void {
    let changed = this.map !== map;
    if (changed) {
      this.map = map;
      this.land = new Uint8Array(map.tiles.length);
      this.distances = new Float32Array(map.tiles.length);
    }
    for (const i of map.dirty) {
      const land = Number(map.tiles[i] >= Terrain.Sand && !isBridge(map.tiles[i]));
      if (this.land[i] !== land) changed = true;
      this.land[i] = land;
    }
    if (!changed) return;
    const { width, height } = map, d = this.distances;
    for (let i = 0; i < d.length; i++) d[i] = this.land[i] ? 0 : width + height;
    // Two chamfer passes include diagonals so the shelves follow curved coasts.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (y) {
        d[i] = Math.min(d[i], d[i - width] + 1);
        if (x) d[i] = Math.min(d[i], d[i - width - 1] + Math.SQRT2);
        if (x + 1 < width) d[i] = Math.min(d[i], d[i - width + 1] + Math.SQRT2);
      }
    }
    for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x + 1 < width) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (y + 1 < height) {
        d[i] = Math.min(d[i], d[i + width] + 1);
        if (x) d[i] = Math.min(d[i], d[i + width - 1] + Math.SQRT2);
        if (x + 1 < width) d[i] = Math.min(d[i], d[i + width + 1] + Math.SQRT2);
      }
    }
    map.markAllDirty();
  }

  drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
    const { width, height } = this.map!;
    ctx.fillStyle = OCEAN_COLOR;
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    if (this.distances[y * width + x] > 12) return;
    const at = (px: number, py: number): number => this.distances[Math.max(0, Math.min(height - 1, py)) * width + Math.max(0, Math.min(width - 1, px))];
    for (let py = 0; py < TILE; py += 2) for (let px = 0; px < TILE; px += 2) {
      const sx = x + (px + 1) / TILE - 0.5, sy = y + (py + 1) / TILE - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const distance = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
        + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
      const grain = noise(x * TILE + px, y * TILE + py, seed);
      const ripple = Math.sin(x * 0.53 + y * 0.37) * 0.28 + Math.cos(y * 0.61 - x * 0.2) * 0.2;
      const depth = Math.max(0, distance - 0.5 + ripple + (grain - 0.5) * 1.15);
      const band = depth < 0.6 ? 0 : depth < 1.5 ? 1 : depth < 3 ? 2 : depth < 4.8 ? 3 : depth < 7 ? 4 : depth < 9.5 ? 5 : 6;
      ctx.fillStyle = shelfColors[band];
      ctx.fillRect(x * TILE + px, y * TILE + py, 2, 2);
    }
  }
}
