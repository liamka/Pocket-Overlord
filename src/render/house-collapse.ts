import { noise } from '../core/random';
import { raceOf } from '../core/races';
import type { VisualEvent } from '../core/types';
import { TILE } from './camera';
import { drawConstruction } from './construction';
import { drawSprite, villageColor } from './sprites';

type CollapseEvent = Extract<VisualEvent, { kind: 'collapse' }>;
interface Fragment {
  sx: number; sy: number; width: number; height: number;
  x: number; y: number; ground: number; delay: number;
  vx: number; vy: number; lift: number; spin: number; roof: boolean;
}
interface Collapse {
  x: number; y: number; age: number; seed: number; burning: boolean; water: boolean;
  image: HTMLCanvasElement; fragments: Fragment[];
}
const SIZE = 48, LEFT = 24, TOP = 36, LIMIT = 48, DURATION = 5.5, GRAVITY = 150;
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const smooth = (value: number): number => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** Closed-form falls and two smaller bounces keep contact independent of frame rate. */
export function fragmentFall(time: number, height: number, lift: number): { height: number; travel: number; impact: number; settled: boolean } {
  const impact = (lift + Math.sqrt(lift * lift + 2 * GRAVITY * height)) / GRAVITY;
  if (time < impact) return { height: height + lift * time - GRAVITY * time * time / 2, travel: time, impact, settled: false };
  const speed = Math.sqrt(lift * lift + 2 * GRAVITY * height);
  const elapsed = time - impact;
  let rest = elapsed;
  for (const bounce of [0.25, 0.09]) {
    const velocity = speed * bounce, duration = 2 * velocity / GRAVITY;
    if (rest < duration) return { height: velocity * rest - GRAVITY * rest * rest / 2,
      travel: impact + (1 - Math.exp(-elapsed * 5)) / 5, impact, settled: false };
    rest -= duration;
  }
  return { height: 0, travel: impact + (1 - Math.exp(-elapsed * 5)) / 5, impact, settled: true };
}

/** Captures the destroyed home, then animates its actual pixels without retaining a live entity. */
export class HouseCollapseAnimations {
  private collapses: Collapse[] = [];
  private next = 0;

  reset(): void { this.collapses = []; this.next = 0; }

  update(dt: number): void {
    for (const collapse of this.collapses) collapse.age += dt;
    this.collapses = this.collapses.filter(c => c.age < DURATION);
    this.next = 0;
  }

  start(event: CollapseEvent, water: boolean, ally?: number): void {
    const { house, tick } = event, { dwelling, appearance, thermal } = house.components;
    if (!dwelling) return;
    const image = document.createElement('canvas'); image.width = image.height = SIZE;
    const ctx = image.getContext('2d')!, color = dwelling.villageId ? villageColor(dwelling.villageId) : undefined;
    ctx.translate(LEFT, TOP);
    if (dwelling.construction) drawConstruction(ctx, house, tick, color);
    else {
      drawSprite(ctx, 'house', appearance?.variant, tick / 30, false, 0, color, raceOf(house));
      if (color) {
        ctx.fillStyle = '#524a35'; ctx.fillRect(11, -21, 1, 22);
        ctx.fillStyle = color; ctx.fillRect(12, -21, 7, 5);
        if (ally) { ctx.fillStyle = villageColor(ally); ctx.fillRect(12, -14, 7, 3); }
      }
    }
    // Shadows stay on the ground instead of becoming flying pieces.
    const pixels = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 3; i < pixels.data.length; i += 4) if (pixels.data[i] < 128) pixels.data[i] = 0;
    ctx.putImageData(pixels, 0, 0);
    const fragments: Fragment[] = [], seed = house.id + tick * 17;
    for (let sy = 0; sy < SIZE; sy += 5) for (let sx = 0; sx < SIZE; sx += 5) {
      const width = Math.min(5, SIZE - sx), height = Math.min(5, SIZE - sy);
      let occupied = false;
      for (let y = sy; y < sy + height && !occupied; y++) for (let x = sx; x < sx + width; x++) {
        if (pixels.data[(y * SIZE + x) * 4 + 3]) { occupied = true; break; }
      }
      if (!occupied) continue;
      const x = sx + width / 2 - LEFT, y = sy + height / 2 - TOP, n = noise(sx, seed + sy);
      const roof = y < -9 && x < 11;
      fragments.push({ sx, sy, width, height, x, y, roof, ground: 4 + n * 3,
        delay: roof ? 0.38 + n * 0.06 : 0.25 + n * 0.17,
        vx: (Math.sign(x) || 1) * (6 + n * 17), vy: (noise(sy + 31, seed + sx) - 0.5) * 10,
        lift: roof ? 3 + n * 6 : 6 + n * 10, spin: (n - 0.5) * 7 });
    }
    if (this.collapses.length >= LIMIT) this.collapses.splice(this.collapses.reduce((oldest, c, i, all) => c.age > all[oldest].age ? i : oldest, 0), 1);
    this.collapses.push({ x: event.x * TILE, y: event.y * TILE, age: 0, seed, image, fragments, burning: !!thermal?.burning, water });
    this.collapses.sort((a, b) => a.y - b.y);
  }

  ground(ctx: CanvasRenderingContext2D): void {
    this.next = 0;
    for (const c of this.collapses) {
      ctx.save(); ctx.translate(Math.round(c.x), Math.round(c.y));
      ctx.globalAlpha *= (1 - smooth((c.age - 4.2) / 1.3)) * 0.19;
      ctx.fillStyle = '#343b2d'; ctx.fillRect(-13, 0, 29, 7); ctx.fillRect(-9, -2, 21, 11);
      ctx.restore();
    }
  }

  /** Merge with the existing entity depth order so foreground residents cover falling walls. */
  drawBefore(ctx: CanvasRenderingContext2D, y = Infinity): void {
    while (this.next < this.collapses.length && this.collapses[this.next].y <= y) this.draw(ctx, this.collapses[this.next++]);
  }

  private draw(ctx: CanvasRenderingContext2D, c: Collapse): void {
    const age = c.age, fade = 1 - smooth((age - 4.2) / 1.3);
    ctx.save(); ctx.translate(Math.round(c.x), Math.round(c.y));
    // The roof first sags as a connected shape. Wall sections fail at staggered times.
    for (const p of c.fragments) {
      const t = age - p.delay, sag = p.roof ? 4 * smooth((Math.min(age, p.delay) - 0.12) / 0.26) : 0;
      ctx.save(); ctx.globalAlpha *= fade;
      if (t < 0) {
        const shudder = age < 0.12 ? 0 : Math.sin(age * 65) * 0.55;
        ctx.translate(p.x + shudder, p.y + sag);
      } else {
        const fall = fragmentFall(t, Math.max(0, p.ground - p.y - sag), p.lift);
        ctx.translate(Math.round(p.x + p.vx * fall.travel), Math.round(p.ground + p.vy * fall.travel - fall.height));
        ctx.rotate(p.spin * Math.min(t, fall.impact + 0.18));
        ctx.scale(1, 1 - smooth((t - fall.impact) / 0.2) * 0.5);
      }
      ctx.drawImage(c.image, p.sx, p.sy, p.width, p.height, -p.width / 2, -p.height / 2, p.width, p.height);
      ctx.restore();
    }
    if (age > 0.12 && age < 0.5 && c.fragments.some(p => p.y < -6 && p.y > -11)) {
      ctx.globalAlpha *= 1 - smooth((age - 0.3) / 0.2); ctx.fillStyle = '#443c31';
      for (let i = 0; i < Math.min(5, Math.floor((age - 0.12) * 25)); i++) {
        ctx.fillRect(-5 + (i % 2), -8 + i * 2, 1, 3);
      }
      ctx.globalAlpha = 1;
    }
    // Contact throws dust out along the ground; finer dust rises and settles more slowly.
    for (let i = 0; i < 15; i++) {
      const n = noise(i, c.seed), delay = 0.47 + n * 0.3, t = age - delay, life = 1.05 + n * 0.65;
      if (t < 0 || t >= life) continue;
      const progress = t / life, side = i % 2 ? -1 : 1;
      const x = side * (4 + n * 7 + (1 - Math.exp(-t * 2.4)) * (8 + n * 10));
      const y = 3 - Math.sin(progress * Math.PI / 2) * (3 + n * 8);
      const size = 2 + Math.round((2 + n * 3) * smooth(progress * 3));
      ctx.globalAlpha = Math.min(1, t * 16) * (1 - smooth(progress)) * (i % 3 ? 0.65 : 0.45);
      ctx.fillStyle = c.water ? '#c2e0e8' : c.burning ? '#6d6559' : i % 3 ? '#b9a580' : '#e0ceaa';
      this.cloud(ctx, x, y, size);
      ctx.globalAlpha *= 0.5; ctx.fillStyle = c.water ? '#e5f4ef' : '#e2d1ad';
      this.cloud(ctx, x - 1, y - 2, Math.max(1, size - 2));
    }
    if (c.burning) for (let i = 0; i < 9; i++) {
      const n = noise(i + 71, c.seed), t = age - 0.3 - n * 0.4;
      if (t < 0 || t > 1.5) continue;
      ctx.globalAlpha = (1 - t / 1.5) * 0.85; ctx.fillStyle = i % 2 ? '#f9c46d' : '#e48243';
      ctx.fillRect(Math.round((n - 0.5) * (15 + t * 18)), Math.round(-8 - t * 10 + Math.sin(t * 4 + i) * 2), 1, 1);
    }
    ctx.restore();
  }

  private cloud(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    x = Math.round(x); y = Math.round(y);
    const half = Math.max(1, Math.round(size * 0.6));
    ctx.fillRect(x - half, y - size, half * 2, size * 2);
    ctx.fillRect(x - size, y - half, size * 2, half * 2);
  }
}
