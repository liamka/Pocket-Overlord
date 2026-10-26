import { noise } from '../core/random';
import { smoothNoise } from '../core/natural-biomes';
import type { TerrainMap } from '../core/terrain';
import { isBridge } from '../core/types';
import type { World } from '../core/world';
import { SEA_WAVES, seaWaveShape, seaWaves } from '../systems/effects';
import { TILE, type Camera } from './camera';
import { OCEAN_COLOR, offshoreDepth, depthColor, drawRipples, paintOceanChunk } from './ocean-texture';
export { OCEAN_COLOR } from './ocean-texture';

let textureWorker: Worker | undefined, textureSerial = 0;
const textureRequests = new Map<number, (bitmap: ImageBitmap) => void>();
function requestTexture(x: number, y: number, stride: number, seed: number, done: (bitmap: ImageBitmap) => void): void {
  if (!textureWorker) {
    textureWorker = new Worker(new URL('./ocean-worker.ts', import.meta.url), { type: 'module' });
    textureWorker.onmessage = ({ data }: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
      const receive = textureRequests.get(data.id); textureRequests.delete(data.id);
      if (receive) receive(data.bitmap); else data.bitmap.close();
    };
  }
  const id = ++textureSerial; textureRequests.set(id, done);
  textureWorker.postMessage({ id, x, y, stride, seed });
}

/** Shore distance is visual only; the saved water tiles still control swimming. */
export class Ocean {
  private land = new Uint8Array(0);
  private distances = new Float32Array(0);
  private hasLand = false;
  private map: TerrainMap | undefined;
  private backgroundSeed: number | undefined;
  private readonly backgroundChunks = new Map<string, HTMLCanvasElement | ImageBitmap>();
  private readonly pendingChunks = new Set<string>();
  private readonly readyChunks = new Set<string>();

  /** Continue the same seabed outside playable terrain, anchored to world coordinates. */
  drawBackground(ctx: CanvasRenderingContext2D, camera: Camera, seed: number): void {
    if (this.backgroundSeed !== seed) {
      for (const chunk of this.backgroundChunks.values()) if (chunk instanceof ImageBitmap) chunk.close();
      this.backgroundSeed = seed; this.backgroundChunks.clear(); this.pendingChunks.clear(); this.readyChunks.clear();
    }
    // Keep each cached chunk at 256px even when the whole island is very small.
    const stride = 2 ** Math.max(0, Math.floor(Math.log2(1 / camera.zoom))), span = 32 * stride;
    const start = camera.screenToWorld(-64, -64), end = camera.screenToWorld(camera.width + 64, camera.height + 64);
    const visible = new Set<string>();
    for (let cy = Math.floor(start.y / span); cy <= Math.floor(end.y / span); cy++) {
      for (let cx = Math.floor(start.x / span); cx <= Math.floor(end.x / span); cx++) {
        const x = cx * span, y = cy * span;
        if (this.map && x >= 0 && y >= 0 && x + span <= this.map.width && y + span <= this.map.height) continue;
        const key = `${stride}:${cx}:${cy}`; visible.add(key);
        let chunk = this.backgroundChunks.get(key);
        if (!chunk) {
          chunk = document.createElement('canvas'); chunk.width = chunk.height = 32 * TILE;
          const background = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';
          paintOceanChunk(chunk.getContext('2d', { alpha: false })!, x, y, stride, seed, background);
          if (!background) this.readyChunks.add(key);
          this.backgroundChunks.set(key, chunk);
        }
        // Refresh insertion order and retain a bounded neighborhood while panning.
        this.backgroundChunks.delete(key); this.backgroundChunks.set(key, chunk);
        if (!this.readyChunks.has(key) && !this.pendingChunks.has(key) && this.pendingChunks.size < 4) {
          const preview = chunk;
          this.pendingChunks.add(key);
          requestTexture(x, y, stride, seed, bitmap => {
            if (this.backgroundSeed === seed && this.backgroundChunks.get(key) === preview) {
              this.backgroundChunks.set(key, bitmap); this.readyChunks.add(key); this.pendingChunks.delete(key);
            } else { bitmap.close(); if (this.backgroundSeed === seed) this.pendingChunks.delete(key); }
          });
        }
        ctx.drawImage(chunk, x * TILE, y * TILE, span * TILE, span * TILE);
      }
    }
    for (const [key, chunk] of this.backgroundChunks) {
      if (this.backgroundChunks.size <= Math.max(128, visible.size)) break;
      if (visible.has(key)) continue;
      if (chunk instanceof ImageBitmap) chunk.close();
      this.backgroundChunks.delete(key); this.readyChunks.delete(key);
    }
  }

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
    const initial = this.map !== map;
    let changed = initial;
    if (initial) {
      this.map = map;
      this.land = new Uint8Array(map.tiles.length);
      this.distances = new Float32Array(map.tiles.length);
    }
    for (const i of initial ? map.tiles.keys() : map.dirty) {
      const land = Number(!map.cell(i % map.width, Math.floor(i / map.width)).water && !isBridge(map.tiles[i]));
      if (this.land[i] !== land) changed = true;
      this.land[i] = land;
    }
    if (!changed) return;
    const previous = initial ? undefined : this.distances.slice();
    this.hasLand = this.land.some(Boolean);
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
    if (initial) map.markAllDirty();
    else for (let i = 0; i < d.length; i++) {
      // Beyond 32 tiles the seabed is independent of shore distance. Neighbors are
      // included by Renderer.terrain for the interpolated edge samples.
      if (d[i] !== previous![i] && Math.min(d[i], previous![i]) <= 33) map.dirty.add(i);
    }
  }

  drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, seed: number): void {
    const { width, height } = this.map!;
    ctx.fillStyle = OCEAN_COLOR;
    ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    const explicitDepth = this.map!.layers.get(y * width + x)?.waterDepth;
    if (explicitDepth) {
      ctx.fillStyle = depthColor(explicitDepth === 1 ? 1 : explicitDepth === 2 ? 8 : 24);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE); drawRipples(ctx, x * TILE, y * TILE, x, y, seed); return;
    }
    const seabedDepth = offshoreDepth(x, y, seed);
    if (!this.hasLand || this.distances[y * width + x] > 32) {
      ctx.fillStyle = depthColor(seabedDepth);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      drawRipples(ctx, x * TILE, y * TILE, x, y, seed);
      return;
    }
    const at = (px: number, py: number): number => this.distances[Math.max(0, Math.min(height - 1, py)) * width + Math.max(0, Math.min(width - 1, px))];
    // Coherent seabed shapes vary the shelf width and leave shoals offshore.
    // Keep contour steps larger than the surface texture instead of dithering depth.
    const shelf = smoothNoise(x / 13, y / 13, seed + 887);
    for (let py = 0; py < TILE; py += 4) for (let px = 0; px < TILE; px += 4) {
      const sx = x + (px + 2) / TILE - 0.5, sy = y + (py + 2) / TILE - 0.5;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      const distance = (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy)
        + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
      const coastalDepth = Math.max(0, distance - 0.5) * (0.65 + shelf * 0.9);
      ctx.fillStyle = depthColor(Math.min(coastalDepth, seabedDepth));
      ctx.fillRect(x * TILE + px, y * TILE + py, 4, 4);
    }
    // Quiet, staggered pixel ripples read as water without breaking the depth shapes.
    drawRipples(ctx, x * TILE, y * TILE, x, y, seed);
  }
}
