import { noise } from '../core/random';
import { Terrain, type LandChange, type LandEdit } from '../core/types';
import type { World } from '../core/world';
import { TILE } from './camera';

interface LandPatch { image: HTMLCanvasElement; x: number; y: number }
interface MovingTile extends LandChange { delay: number; seed: number; edge: boolean; front: boolean; angle: number }
interface Transition {
  mode: LandEdit['mode']; age: number; tiles: MovingTile[]; before?: LandPatch; after: LandPatch;
}
const DURATION = 2.4, LIMIT = 48;
const clamp = (t: number): number => Math.max(0, Math.min(1, t));
const smooth = (t: number): number => { const p = clamp(t); return p * p * (3 - 2 * p); };
const pixel = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, width = 1, height = 1): void => {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
};

/** Keep the actual ground texture so roads, beaches and biomes sink with their own colors. */
export function captureLandPatch(edit: LandEdit, ground: HTMLCanvasElement): LandPatch {
  const x = Math.min(...edit.tiles.map(tile => tile.x)), y = Math.min(...edit.tiles.map(tile => tile.y));
  const right = Math.max(...edit.tiles.map(tile => tile.x)) + 1, bottom = Math.max(...edit.tiles.map(tile => tile.y)) + 1;
  const image = document.createElement('canvas'); image.width = (right - x) * TILE; image.height = (bottom - y) * TILE;
  image.getContext('2d')!.drawImage(ground, x * TILE, y * TILE, image.width, image.height, 0, 0, image.width, image.height);
  return { image, x, y };
}

/** Player-driven transitions use real time, including while the world is paused. */
export class TerraformAnimations {
  private transitions: Transition[] = [];

  reset(): void { this.transitions = []; }

  update(dt: number): void {
    for (const transition of this.transitions) transition.age += dt;
    this.transitions = this.transitions.filter(transition => transition.age < DURATION && transition.tiles.length > 0);
  }

  start(edit: LandEdit, ground: HTMLCanvasElement, world: World, before?: LandPatch): void {
    const changed = new Set(edit.tiles.map(tile => `${tile.x},${tile.y}`));
    // A reversed brush stroke replaces those tiles rather than replaying an obsolete coastline.
    for (const transition of this.transitions) transition.tiles = transition.tiles.filter(tile => !changed.has(`${tile.x},${tile.y}`));
    const tiles = edit.tiles.filter(tile => world.terrain.at(tile.x, tile.y) === tile.to).map(tile => {
      const seed = noise(tile.x, tile.y, world.seed + 701);
      return { ...tile, seed, delay: Math.hypot(tile.x + 0.5 - edit.x, tile.y + 0.5 - edit.y) / edit.radius * 0.24 + seed * 0.1,
        angle: Math.atan2(tile.y + 0.5 - edit.y, tile.x + 0.5 - edit.x), front: !changed.has(`${tile.x},${tile.y + 1}`),
        edge: [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => !changed.has(`${tile.x + dx},${tile.y + dy}`)) };
    });
    if (!tiles.length) return;
    if (this.transitions.length >= LIMIT) this.transitions.shift();
    this.transitions.push({ mode: edit.mode, age: 0, tiles, before, after: captureLandPatch(edit, ground) });
  }

  private stamp(ctx: CanvasRenderingContext2D, patch: LandPatch | undefined, tile: MovingTile, x: number, y: number, width = TILE, height = TILE): void {
    if (patch) ctx.drawImage(patch.image, (tile.x - patch.x) * TILE, (tile.y - patch.y) * TILE, TILE, TILE,
      Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
    else pixel(ctx, tile.from < Terrain.Sand ? '#4b9af4' : '#7b9d50', x, y, width, height);
  }

  ground(ctx: CanvasRenderingContext2D): void {
    ctx.save(); ctx.imageSmoothingEnabled = false;
    for (const transition of this.transitions) {
      // Back-to-front ordering keeps raised soil edges behind the next strip of turf.
      for (const tile of transition.tiles) {
        const t = transition.age - tile.delay, x = tile.x * TILE, y = tile.y * TILE;
        if (t >= 1.05) continue;
        if (t <= 0) { this.stamp(ctx, transition.before, tile, x, y); continue; }
        if (transition.mode === 'raise') {
          this.stamp(ctx, transition.before, tile, x, y);
          const rise = smooth(t / 0.32), settle = smooth(transition.age / 1.25);
          const lift = Math.sin(settle * Math.PI) * 7;
          if (tile.front) {
            ctx.globalAlpha = rise * 0.2;
            pixel(ctx, '#173e5c', x + 1, y + TILE - 1, TILE + 1, 3);
          }
          ctx.globalAlpha = rise;
          if (tile.front && lift >= 1) {
            pixel(ctx, '#654d35', x, y + TILE - lift, TILE, lift);
            pixel(ctx, '#a47b4d', x, y + TILE - lift, TILE, Math.max(1, lift * 0.45));
            pixel(ctx, '#c6a472', x + 1, y + TILE - lift, TILE - 2, 1);
            if (lift > 3) pixel(ctx, '#4b4937', x + 2 + tile.seed * 3, y + TILE - 2, 2, 1);
          }
          this.stamp(ctx, transition.after, tile, x, y - lift);
          ctx.globalAlpha = 1;
        } else {
          const sink = smooth(t / 0.9), split = smooth((t - 0.12) / 0.4);
          ctx.save(); ctx.beginPath(); ctx.rect(x, y, TILE, TILE); ctx.clip();
          ctx.globalAlpha = 1 - smooth((t - 0.4) / 0.52);
          for (let piece = 0; piece < 2; piece++) {
            const patch = transition.before, side = piece ? 1 : -1;
            const offset = side * split * (1 + tile.seed), fall = sink * (5 + piece * 2);
            if (patch) ctx.drawImage(patch.image, (tile.x - patch.x) * TILE + piece * TILE / 2, (tile.y - patch.y) * TILE, TILE / 2, TILE,
              Math.round(x + piece * TILE / 2 + offset), Math.round(y + fall), TILE / 2, TILE);
            else pixel(ctx, '#7b9d50', x + piece * TILE / 2 + offset, y + fall, TILE / 2, TILE);
          }
          ctx.restore();
          ctx.globalAlpha = Math.sin(clamp(t / 1.05) * Math.PI) * 0.45;
          pixel(ctx, '#205d94', x + 2, y + 3, TILE - 4, 3);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }

  spray(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, world.terrain.width * TILE, world.terrain.height * TILE); ctx.clip();
    for (const transition of this.transitions) for (const tile of transition.tiles) {
      const t = transition.age - tile.delay, x = (tile.x + 0.5) * TILE, y = (tile.y + 0.5) * TILE;
      if (t < 0 || t > 2.05) continue;
      // Staggered, broken foam rings share the pale water colors used by ship wakes.
      if (tile.edge && tile.seed > 0.25) for (let ring = 0; ring < 2; ring++) {
        const age = t - ring * 0.24;
        if (age <= 0 || age >= 1.65) continue;
        const radius = 3 + age * (7 + tile.seed * 3), fade = Math.min(1, age * 8) * (1 - age / 1.65);
        for (let segment = 0; segment < 9; segment++) {
          if ((segment + Math.floor(tile.seed * 13)) % 4 === 0) continue;
          const angle = tile.angle + (transition.mode === 'lower' ? Math.PI : 0) + (segment / 8 - 0.5) * 1.6;
          const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius * 0.7;
          if (!world.terrain.inside(px / TILE, py / TILE) || world.terrain.isLand(px / TILE, py / TILE)) continue;
          ctx.globalAlpha = fade * (ring ? 0.45 : 0.75);
          pixel(ctx, '#3da6cf', px, py + 1, 3, 1);
          pixel(ctx, segment % 3 ? '#b9ece7' : '#f1fff0', px, py, 2, 1);
        }
      }
      // Ballistic droplets rise, arc and fall; the turf sheds a few heavier grains of soil.
      for (let drop = 0; drop < 3; drop++) {
        const n = noise(tile.x * 3 + drop, tile.y, 907), age = t - n * 0.16;
        if (age < 0 || age > 0.8) continue;
        const angle = n * Math.PI * 2, speed = 8 + n * 14;
        const height = Math.max(0, (22 + n * 17) * age - 48 * age * age);
        const px = x + Math.cos(angle) * speed * age, py = y + Math.sin(angle) * speed * age * 0.6 - height;
        const dirt = transition.mode === 'raise' && drop === 2;
        ctx.globalAlpha = (1 - smooth((age - 0.42) / 0.38)) * 0.9;
        if (!dirt && height > 3) pixel(ctx, '#6bcde6', px, py + 1, 1, 3);
        pixel(ctx, dirt ? '#c5a16b' : '#e5fff0', px, py, dirt ? 2 : 1, 2);
      }
    }
    ctx.restore();
  }
}
