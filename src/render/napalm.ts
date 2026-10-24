import { NAPALM, NAPALM_LAST_DROP, napalmPlanePosition, napalmBombPose, type NapalmStrike } from '../content/napalm';
import { flightPoint } from '../core/flight';
import { noise } from '../core/random';
import { TILE } from './camera';

interface Impact { x: number; y: number; radius: number; age: number; seed: number }
const hot = ['#fff3b2', '#ffd660', '#ff9b32', '#e65e27', '#943b2c'];

function block(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  const r = Math.max(1, Math.round(radius)), half = Math.max(1, Math.round(r * 0.6));
  block(ctx, color, x - half, y - r, half * 2, r * 2);
  block(ctx, color, x - r, y - half, r * 2, half * 2);
}

const hull = [
  [-33, -5, 66, 10], [33, -3, 7, 6], [-15, -29, 11, 58], [-10, -22, 19, 44],
  [-5, -14, 22, 28], [-29, -19, 7, 38], [-34, -13, 12, 26], [5, -21, 17, 8], [5, 13, 17, 8],
] as const;

/** Saved flight state drives aircraft and drops; only impact smoke is transient. */
export class NapalmAnimations {
  private impacts: Impact[] = [];
  private serial = 0;

  reset(): void { this.impacts = []; this.serial = 0; }
  update(dt: number): void {
    for (const impact of this.impacts) impact.age += dt;
    this.impacts = this.impacts.filter(impact => impact.age < 1.8);
  }
  impact(x: number, y: number, radius: number): void {
    this.impacts.push({ x, y, radius, age: 0, seed: this.serial++ });
    if (this.impacts.length > 32) this.impacts.shift();
  }

  shadows(ctx: CanvasRenderingContext2D, strikes: readonly NapalmStrike[], width: number, height: number): void {
    ctx.save();
    for (const strike of strikes) {
      const position = napalmPlanePosition(strike, width, height);
      ctx.save(); ctx.translate(Math.round(position.x * TILE + 12), Math.round(position.y * TILE + 10)); ctx.scale(0.9, 0.7); ctx.rotate(strike.heading);
      ctx.globalAlpha = 0.2;
      for (const [px, py, w, h] of hull) block(ctx, '#162b2a', px, py, w, h);
      ctx.restore();
      for (const bomb of strike.bombs) {
        const progress = Math.max(0, Math.min(1, (strike.elapsed - NAPALM.approach - bomb.index * NAPALM.interval) / NAPALM.fall));
        const { ground } = napalmBombPose(strike, bomb, progress);
        ctx.globalAlpha = 0.12 + progress * 0.18;
        block(ctx, '#263228', ground.x * TILE - 3, ground.y * TILE, 7 - progress * 3, 2);
      }
    }
    ctx.restore();
  }

  airborne(ctx: CanvasRenderingContext2D, strikes: readonly NapalmStrike[], width: number, height: number): void {
    for (const strike of strikes) {
      for (const bomb of strike.bombs) {
        const age = strike.elapsed - NAPALM.approach - bomb.index * NAPALM.interval;
        const progress = Math.max(0, Math.min(1, age / NAPALM.fall));
        const pose = napalmBombPose(strike, bomb, progress);
        // Thin wake traces the accelerating descent, ending exactly at the impact point.
        for (let t = 1; t <= 5; t++) {
          const p = progress - t * 0.045; if (p < 0) continue;
          const trail = napalmBombPose(strike, bomb, p);
          ctx.globalAlpha = (1 - t / 6) * 0.3;
          block(ctx, '#dbd3b3', trail.x * TILE, trail.y * TILE, 2, 2);
        }
        ctx.globalAlpha = 1;
        ctx.save(); ctx.translate(Math.round(pose.x * TILE), Math.round(pose.y * TILE)); ctx.rotate(pose.heading);
        block(ctx, '#233435', -6, -3, 13, 6);
        block(ctx, '#728578', -5, -2, 11, 4); block(ctx, '#c6c9a4', -4, -2, 9, 1);
        block(ctx, '#e9903e', 1, -2, 3, 4); block(ctx, '#f6c66c', 1, -2, 3, 1);
        block(ctx, '#344b4c', -9, -4, 4, 2); block(ctx, '#344b4c', -9, 2, 4, 2);
        block(ctx, '#a6b2a0', 6, -1, 2, 2);
        ctx.restore();
      }
      this.plane(ctx, strike, width, height);
    }
  }

  private plane(ctx: CanvasRenderingContext2D, strike: NapalmStrike, width: number, height: number): void {
    const position = napalmPlanePosition(strike, width, height);
    const x = position.x * TILE, y = (position.y - NAPALM.altitude) * TILE;
    for (let i = 1; i <= 14; i++) {
      const elapsed = strike.elapsed - i * 0.035; if (elapsed < 0) continue;
      const trail = napalmPlanePosition({ ...strike, elapsed }, width, height);
      ctx.globalAlpha = (1 - i / 15) * 0.18;
      for (const side of [-1, 1]) {
        const puff = flightPoint({ x: trail.x * TILE, y: (trail.y - NAPALM.altitude) * TILE }, strike.heading, -18, side * 17 + Math.sin(i + strike.elapsed * 5));
        cloud(ctx, puff.x, puff.y, 1 + i * 0.16, '#b9bab0');
      }
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(strike.heading);
    for (const [px, py, w, h] of hull) block(ctx, '#263a3d', px, py, w, h);
    // Stepped wings, elevator and engine nacelles keep a clear bomber silhouette.
    block(ctx, '#75857d', -14, -28, 9, 56); block(ctx, '#98a394', -13, -28, 2, 56);
    block(ctx, '#65776f', -9, -21, 17, 42); block(ctx, '#829287', -4, -13, 20, 26);
    block(ctx, '#9eaa99', 3, -14, 3, 28); block(ctx, '#405650', -9, -25, 2, 50);
    block(ctx, '#74877b', -28, -18, 5, 36); block(ctx, '#a1ac94', -28, -18, 1, 36);
    block(ctx, '#455b57', -33, -12, 6, 24);
    block(ctx, '#5d746d', -32, -4, 65, 8); block(ctx, '#a4b3a0', -25, -4, 55, 2);
    block(ctx, '#3b5553', -25, 3, 55, 1); block(ctx, '#81968b', 30, -2, 8, 4);
    block(ctx, '#233f49', 21, -4, 9, 7); block(ctx, '#6bb7c1', 22, -3, 6, 3);
    block(ctx, '#d0e8d5', 23, -3, 3, 1); block(ctx, '#3f6262', 25, 0, 4, 2);
    for (const px of [-19, -12, -5, 2, 9, 16]) block(ctx, '#c0c8af', px, -3, 1, 1);
    const bayOpen = strike.elapsed >= NAPALM.approach - 0.15 && strike.elapsed <= NAPALM_LAST_DROP + 0.15;
    if (bayOpen) {
      block(ctx, '#15282c', -9, -1, 18, 4); block(ctx, '#bec2a0', -9, 4, 18, 2);
      const dropPhase = (strike.elapsed - NAPALM.approach) / NAPALM.interval;
      if (dropPhase >= 0 && dropPhase % 1 < 0.35) block(ctx, '#df974e', -2, 0, 5, 2);
    } else block(ctx, '#b3baa2', -8, 0, 15, 1);
    for (const side of [-1, 1]) {
      const py = side * 17;
      block(ctx, '#3b5150', 5, py - 4, 17, 8); block(ctx, '#9aa99b', 6, py - 3, 14, 2);
      block(ctx, '#6c8178', 7, py - 1, 15, 3); block(ctx, '#263e41', 21, py - 3, 3, 6);
      const frame = Math.floor(strike.elapsed * 30) % 3;
      ctx.globalAlpha = 0.65;
      if (frame === 0) block(ctx, '#e2e4cb', 24, py - 10, 2, 20);
      else if (frame === 1) {
        for (let p = -8; p <= 8; p += 4) block(ctx, '#e2e4cb', 24 + Math.sign(p), py + p, 2, 3);
      } else block(ctx, '#d1d8c1', 23, py - 6, 3, 12);
      ctx.globalAlpha = 1; block(ctx, '#d8d5b3', 23, py - 1, 3, 2);
    }
    const blink = Math.floor(strike.elapsed * 4) % 3 !== 0;
    block(ctx, blink ? '#ee8060' : '#8f493d', -11, -29, 3, 2);
    block(ctx, blink ? '#a4dca6' : '#4b7964', -11, 27, 3, 2);
    ctx.restore();
  }

  fire(ctx: CanvasRenderingContext2D, x: number, y: number, remaining: number, time: number, seed: number): void {
    const fade = Math.min(1, remaining / 0.5), age = NAPALM.fireSeconds - remaining;
    ctx.save();
    // Glowing fuel pools remain low while individual tongues and embers rise.
    ctx.globalAlpha = fade * 0.8;
    for (let i = 0; i < 5; i++) {
      const px = x + (noise(i, seed) - 0.5) * 25, py = y + (noise(i + 19, seed) - 0.5) * 17;
      block(ctx, '#8b3a24', px - 7, py - 2, 14, 5);
      block(ctx, '#e36f29', px - 5, py - 1, 10, 2); block(ctx, '#f5b43e', px - 2, py, 4, 1);
    }
    for (let i = 0; i < 7; i++) {
      const n = noise(i + 41, seed), px = x + (n - 0.5) * 30, py = y + (noise(i + 51, seed) - 0.5) * 15;
      const flicker = (Math.sin(time * 17 + n * 19) + Math.sin(time * 27 + i)) * 2;
      const height = Math.max(3, (13 + n * 11 + flicker) * fade), lean = Math.sin(time * 5 + i) * 3;
      ctx.globalAlpha = fade;
      block(ctx, '#cf4e22', px - 4, py - height * 0.6, 9, height * 0.6 + 2);
      block(ctx, '#ff922e', px - 3 + lean * 0.3, py - height * 0.8, 6, height * 0.8);
      block(ctx, '#ffd15b', px - 2 + lean * 0.7, py - height, 4, height * 0.75);
      block(ctx, '#fff1a9', px - 1, py - height * 0.35, 2, height * 0.3);
      const rise = (age * (0.7 + n * 0.4) + n) % 1;
      ctx.globalAlpha = fade * (1 - rise);
      block(ctx, '#ffc55e', px + rise * 6, py - 12 - rise * 35, 1 + n, 2);
    }
    for (let i = 0; i < 4; i++) {
      const n = noise(i + 71, seed), rise = (age * 0.6 + n) % 1;
      if (rise > age * 0.8) continue;
      ctx.globalAlpha = Math.sin(rise * Math.PI) * 0.32 * fade;
      cloud(ctx, x - 6 + n * 12 + rise * 12, y - 13 - rise * 45, 4 + rise * 7, rise < 0.4 ? '#604e40' : '#484c47');
    }
    ctx.restore();
  }

  drawImpacts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const impact of this.impacts) {
      const { x, y, radius, age, seed } = impact;
      for (let i = 0; i < 7; i++) {
        const n = noise(i, seed), rise = Math.min(1, age / 1.8);
        ctx.globalAlpha = Math.min(0.48, age * 2) * (1 - rise);
        cloud(ctx, x + (n - 0.5) * radius * 0.7 + age * 8, y - age * (16 + n * 16), 3 + rise * (9 + n * 9), '#53504a');
      }
      if (age < 0.45) {
        const spread = 1 - (1 - age / 0.45) ** 2;
        for (let i = 0; i < 6; i++) {
          const n = noise(i + 21, seed), angle = i * Math.PI / 3;
          ctx.globalAlpha = 1 - age / 0.45;
          cloud(ctx, x + Math.cos(angle) * radius * spread * 0.45, y + Math.sin(angle) * radius * spread * 0.22 - spread * 8,
            radius * (0.16 + n * 0.12) * (1 - spread * 0.35), hot[Math.min(3, Math.floor(spread * 4))]);
        }
        ctx.globalAlpha = Math.max(0, 1 - age / 0.15);
        cloud(ctx, x, y - 3, radius * 0.2, '#fff9d0');
      }
      for (let i = 0; i < 24; i++) {
        const n = noise(i + 49, seed), life = 0.45 + n * 0.5;
        if (age > life) continue;
        const angle = noise(i + 81, seed) * Math.PI * 2, progress = age / life;
        const distance = radius * (0.2 + n * 0.65) * (1 - (1 - progress) ** 2);
        const px = x + Math.cos(angle) * distance, py = y + Math.sin(angle) * distance * 0.45 - Math.sin(progress * Math.PI) * (8 + n * 12);
        ctx.globalAlpha = 1 - progress;
        block(ctx, hot[Math.min(4, Math.floor(progress * 5))], px, py, 2 + n * 3, 2);
        block(ctx, '#f39836', px - Math.cos(angle) * 4, py - 1, 3, 1);
      }
    }
    ctx.restore();
  }
}
