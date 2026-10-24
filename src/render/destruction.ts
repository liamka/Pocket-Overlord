import { noise } from '../core/random';
import type { Sprite } from '../content/registry';
import { drawSprite } from './sprites';
import { rocketPose } from '../core/flight';
import type { CoreComponents, Vec2 } from '../core/types';
import { TILE } from './camera';

interface Debris {
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; size: number; smoke: boolean; water: boolean; fragment: boolean; dust: boolean;
}
interface Blast { x: number; y: number; radius: number; age: number; water: boolean; style?: 'rocket' | 'dynamite'; seed: number }
const DEBRIS_LIMIT = 400, BLAST_LIMIT = 12;
const fire = ['#fff9db', '#ffe56b', '#ffad32', '#ef6727', '#a74a32'];
const spray = ['#f0ffff', '#d0f4ff', '#94d8ec', '#68abc8', '#427c9d'];
const circle = Array.from({ length: 40 }, (_, i) => ({ x: Math.cos(i * Math.PI / 20), y: Math.sin(i * Math.PI / 20) }));
const ringSprites: HTMLCanvasElement[] = [];
const fusePath = [[1, -9], [1, -10], [1, -11], [2, -11], [3, -11], [4, -11], [4, -12], [4, -13], [4, -14], [5, -14], [6, -14], [7, -14], [7, -15], [7, -16], [7, -17]];

function ringSprite(progress: number, water: boolean): HTMLCanvasElement {
  const frame = Math.min(15, Math.floor(progress * 16)), key = frame + (water ? 16 : 0);
  if (ringSprites[key]) return ringSprites[key];
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 168;
  const ctx = canvas.getContext('2d')!, phase = frame / 16;
  const radius = 64 * (0.12 + 1.12 * (1 - (1 - phase) ** 3));
  const size = Math.max(1, Math.round(4 * (1 - phase)));
  ctx.fillStyle = water ? '#d4f6ff' : '#fff3c4';
  for (const point of circle) ctx.fillRect(Math.round(84 + point.x * radius), Math.round(84 + point.y * radius), size, size);
  return ringSprites[key] = canvas;
}

/** Decorative state only: bounded pools never enter the simulation or saved world. */
export class DestructionAnimations {
  private readonly debris: Debris[] = Array.from({ length: DEBRIS_LIMIT }, () => ({ x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 0, smoke: false, water: false, fragment: false, dust: false }));
  private readonly blasts: Blast[] = Array.from({ length: BLAST_LIMIT }, () => ({ x: 0, y: 0, radius: 0, age: 0, water: false, seed: 0 }));
  private debrisCount = 0;
  private blastCount = 0;
  private nextDebris = 0;
  private nextBlast = 0;
  private serial = 0;
  private shake = 0;
  private time = 0;
  private trails = 0;
  private fuses = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  shakeX = 0;
  shakeY = 0;

  reset(): void {
    this.debrisCount = this.blastCount = this.nextDebris = this.nextBlast = this.serial = 0;
    this.shake = this.shakeX = this.shakeY = this.time = 0;
    this.trails = this.fuses = 0;
  }

  update(dt: number): void {
    this.trails = this.fuses = 0;
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 18);
    this.shakeX = this.reducedMotion ? 0 : Math.round(Math.sin(this.time * 91) * this.shake);
    this.shakeY = this.reducedMotion ? 0 : Math.round(Math.cos(this.time * 113) * this.shake * 0.65);
    for (let i = this.blastCount - 1; i >= 0; i--) {
      const blast = this.blasts[i]; blast.age += dt;
      if (blast.age >= 0.65) {
        this.blasts[i] = this.blasts[--this.blastCount]; this.blasts[this.blastCount] = blast;
      }
    }
    const drag = Math.exp(-dt * 2.4);
    for (let i = this.debrisCount - 1; i >= 0; i--) {
      const particle = this.debris[i]; particle.age += dt;
      if (particle.age >= particle.life) {
        this.debris[i] = this.debris[--this.debrisCount]; this.debris[this.debrisCount] = particle;
        continue;
      }
      particle.x += particle.vx * dt; particle.y += particle.vy * dt;
      particle.vx *= drag;
      particle.vy = particle.vy * drag + (particle.dust ? -2 : particle.smoke ? -12 : particle.fragment ? 90 : particle.water ? 65 : 30) * dt;
    }
  }

  explode(x: number, y: number, radius: number, water: boolean, style?: 'rocket' | 'dynamite'): void {
    const blast = this.blasts[this.blastCount < BLAST_LIMIT ? this.blastCount++ : this.nextBlast++ % BLAST_LIMIT];
    blast.x = x; blast.y = y; blast.radius = radius; blast.water = water; blast.age = 0;
    blast.style = style; blast.seed = this.serial;
    this.shake = Math.min(3.5, this.shake + radius / 25);
    const serial = this.serial++, count = style === 'rocket' ? 80 : style === 'dynamite' ? 72 : radius > 55 ? 84 : 60;
    for (let i = 0; i < count; i++) {
      const particle = this.debris[this.debrisCount < DEBRIS_LIMIT ? this.debrisCount++ : this.nextDebris++ % DEBRIS_LIMIT];
      const n = noise(i, serial), angle = n * Math.PI * 2;
      const dust = !!style && !water && i % 5 === 1;
      const fragment = !!style && !water && i % 5 === 2;
      const smoke = dust || i % 3 === 0;
      const speed = (dust ? 0.7 : smoke ? 0.2 : 0.8) * radius * (0.5 + noise(i + 83, serial) * 1.8);
      particle.x = x; particle.y = y;
      particle.vx = Math.cos(angle) * speed; particle.vy = Math.sin(angle) * speed * (dust ? 0.35 : 1) - (dust ? 0 : smoke ? style === 'rocket' ? 35 : 18 : fragment ? 28 : 10);
      particle.age = 0; particle.life = smoke ? 1.1 + n * 0.7 : 0.35 + n * 0.65;
      particle.size = smoke ? 5 + n * radius * 0.12 : 2 + n * 4;
      particle.smoke = smoke; particle.water = water; particle.fragment = fragment && !smoke; particle.dust = dust;
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // Smoke sits behind the hot core, then lingers after the flash and shockwave.
    for (let i = 0; i < this.debrisCount; i++) {
      const p = this.debris[i]; if (!p.smoke) continue;
      const progress = p.age / p.life, size = Math.round(p.size * (1 + progress * 1.5));
      ctx.globalAlpha = Math.min(0.7, p.age * 7) * (1 - progress);
      ctx.fillStyle = p.water ? '#bbdfec' : p.dust ? progress < 0.5 ? '#9e8a66' : '#797260' : progress < 0.3 ? '#6e6258' : '#4d5154';
      this.cloud(ctx, p.x, p.y, size);
      if (p.dust) {
        ctx.globalAlpha *= 0.4; ctx.fillStyle = '#cab08a'; this.cloud(ctx, p.x - size * 0.2, p.y - size * 0.3, Math.round(size * 0.55));
      }
    }
    for (let i = 0; i < this.blastCount; i++) {
      const b = this.blasts[i], progress = b.age / 0.65;
      ctx.globalAlpha = (1 - progress) ** 2;
      const scale = b.radius / 64;
      ctx.drawImage(ringSprite(progress, b.water), b.x - 84 * scale, b.y - 84 * scale, 168 * scale, 168 * scale);
      if (b.style && !b.water && b.age < 0.48) {
        const spread = b.age / 0.48;
        // A rocket grows a rising fireball; dynamite throws a flatter, dusty burst.
        for (let lobe = 0; lobe < 7; lobe++) {
          const n = noise(lobe, b.seed), angle = lobe * Math.PI * 2 / 7;
          const lift = b.style === 'rocket' ? spread * b.radius * 0.7 : 0;
          ctx.globalAlpha = (1 - spread) * 0.85;
          ctx.fillStyle = b.style === 'rocket' ? fire[Math.min(4, Math.floor(spread * 4 + n))] : spread < 0.4 ? '#ffb756' : '#a78962';
          this.cloud(ctx, b.x + Math.cos(angle) * b.radius * spread * 0.6,
            b.y + Math.sin(angle) * b.radius * spread * 0.3 - lift, Math.round(b.radius * (0.12 + n * 0.13) * (1 + spread * 0.5)));
        }
      }
      if (b.age < 0.22) {
        const flash = 1 - b.age / 0.22;
        ctx.globalAlpha = flash;
        ctx.fillStyle = b.water ? '#7ac6e7' : '#f68129';
        this.cloud(ctx, b.x, b.y, Math.round(b.radius * (0.25 + (1 - flash) * 0.55)));
        ctx.fillStyle = b.water ? '#eaffff' : '#fff8cf';
        this.cloud(ctx, b.x, b.y, Math.round(b.radius * 0.36 * flash));
      }
    }
    for (let i = 0; i < this.debrisCount; i++) {
      const p = this.debris[i]; if (p.smoke) continue;
      const progress = p.age / p.life, size = Math.max(1, Math.round(p.size * (1 - progress * 0.7)));
      ctx.globalAlpha = Math.min(1, (1 - progress) * 2);
      ctx.fillStyle = p.fragment ? progress < 0.25 ? '#f4bc74' : '#67594b' : (p.water ? spray : fire)[Math.min(4, Math.floor(progress * 5))];
      const tumble = p.fragment && Math.floor(p.age * 18) % 2 === 0;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), tumble ? size + 2 : size, tumble ? Math.max(1, size - 1) : size);
      if (p.fragment) {
        ctx.fillStyle = '#c0a684'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private cloud(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const r = Math.max(1, radius), half = Math.round(r * 0.6), px = Math.round(x), py = Math.round(y);
    ctx.fillRect(px - half, py - r, half * 2, r * 2);
    ctx.fillRect(px - r, py - half, r * 2, half * 2);
  }

  target(ctx: CanvasRenderingContext2D, x: number, y: number, remaining: number, duration: number): void {
    const pulse = Math.round(10 + Math.sin((duration - remaining) * 18) * 2);
    ctx.globalAlpha = 0.7; ctx.fillStyle = '#ef9f70';
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      ctx.fillRect(x + dx * pulse - (dx > 0 ? 5 : 0), y + dy * pulse, 6, 1);
      ctx.fillRect(x + dx * pulse, y + dy * pulse - (dy > 0 ? 5 : 0), 1, 6);
    }
    ctx.fillRect(x - 3, y, 7, 1); ctx.fillRect(x, y - 3, 1, 7);
    ctx.globalAlpha = 1;
  }

  rocketShadow(ctx: CanvasRenderingContext2D, target: Vec2, projectile: CoreComponents['projectile']): void {
    const pose = rocketPose(target, projectile);
    ctx.save(); ctx.translate(Math.round(pose.ground.x * TILE + 5 * (1 - pose.progress)), Math.round(pose.ground.y * TILE + 3));
    ctx.rotate(pose.heading + Math.PI / 2); ctx.globalAlpha = 0.12 + pose.progress * 0.18;
    ctx.fillStyle = '#243c36'; ctx.fillRect(-2, -9, 4, 14); ctx.fillRect(-4, 1, 8, 4);
    ctx.restore();
  }

  rocket(ctx: CanvasRenderingContext2D, target: Vec2, projectile: CoreComponents['projectile'], sprite: Sprite, variant = 0): void {
    const elapsed = projectile.duration - projectile.remaining, pose = rocketPose(target, projectile);
    // Sample the flight path rather than accumulating smoke from frame timings.
    for (let i = this.trails++ < 24 ? 22 : 0; i >= 1; i--) {
      const age = i * 0.022; if (age > elapsed) continue;
      const trail = rocketPose(target, { ...projectile, remaining: projectile.remaining + age });
      const wobble = Math.sin(i * 1.8 + elapsed * 9) * i * 0.18;
      const x = trail.x * TILE - Math.cos(trail.heading) * 9 - Math.sin(trail.heading) * wobble;
      const y = trail.y * TILE - Math.sin(trail.heading) * 9 + Math.cos(trail.heading) * wobble;
      const smoke = i > 4;
      ctx.globalAlpha = smoke ? (1 - i / 24) * 0.48 : 0.9;
      ctx.fillStyle = smoke ? i > 12 ? '#797d76' : '#c1bda3' : fire[Math.min(4, i - 1)];
      this.cloud(ctx, x, y, smoke ? Math.round(2 + i * 0.28) : 3);
      if (smoke && i % 3 === 0) {
        ctx.globalAlpha *= 0.45; ctx.fillStyle = '#e1d7b8'; this.cloud(ctx, x - 1, y - 2, Math.round(1 + i * 0.16));
      }
    }
    ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(Math.round(pose.x * TILE), Math.round(pose.y * TILE)); ctx.rotate(pose.heading + Math.PI / 2);
    const flicker = Math.floor((Math.sin(elapsed * 73) + Math.sin(elapsed * 109)) * 2);
    ctx.globalAlpha = 0.2; ctx.fillStyle = '#ffb343'; this.cloud(ctx, 0, 12, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d6632f'; ctx.fillRect(-4, 8, 9, 8); ctx.fillRect(-3, 16, 7, 6 + flicker);
    ctx.fillStyle = '#ffb83e'; ctx.fillRect(-3, 8, 7, 11); ctx.fillRect(-2, 19, 5, 5 + flicker);
    ctx.fillStyle = '#ffe882'; ctx.fillRect(-2, 8, 5, 10); ctx.fillRect(-1, 18, 3, 4 + flicker);
    ctx.fillStyle = '#fff7cf'; ctx.fillRect(-1, 8, 3, 7);
    for (let i = 0; i < 3; i++) {
      const phase = (elapsed * 12 + i / 3) % 1;
      ctx.globalAlpha = 1 - phase; ctx.fillStyle = '#ffe7a6';
      ctx.fillRect(Math.round(Math.sin(i * 7 + elapsed * 13) * phase * 5), Math.round(17 + phase * 18), 1, 2);
    }
    ctx.globalAlpha = 1; drawSprite(ctx, sprite, variant, elapsed);
    ctx.restore();
  }

  fuse(ctx: CanvasRenderingContext2D, x: number, y: number, remaining: number, id: number, water: boolean): void {
    if (this.fuses++ >= 64) return;
    const elapsed = Math.max(0, 2 - remaining), progress = Math.min(1, elapsed / 2);
    const last = Math.floor((1 - progress) * (fusePath.length - 1));
    const head = fusePath[last];
    ctx.save();
    if (water) {
      for (let i = 0; i < 7; i++) {
        const age = (elapsed * 1.7 + i / 7) % 1;
        const px = Math.round(x + (noise(i, id) - 0.5) * 10 + Math.sin(age * 6) * 2), py = Math.round(y - 2 - age * 18);
        ctx.globalAlpha = (1 - age) * 0.8; ctx.fillStyle = '#bfe9f0';
        ctx.fillRect(px, py, 3, 1); ctx.fillRect(px - 1, py + 1, 1, 2); ctx.fillRect(px + 3, py + 1, 1, 2);
      }
      ctx.restore(); return;
    }
    for (let i = 0; i <= last; i++) {
      const [fx, fy] = fusePath[i];
      ctx.fillStyle = '#473b2b'; ctx.fillRect(x + fx - 1, y + fy, 3, 2);
      ctx.fillStyle = i % 2 ? '#cfaa72' : '#9b794c'; ctx.fillRect(x + fx, y + fy, 1, 1);
    }
    const hx = x + head[0], hy = y + head[1];
    ctx.globalAlpha = 0.18 + Math.sin(elapsed * 29) * 0.05; ctx.fillStyle = '#ffb039'; this.cloud(ctx, hx, hy, 5);
    ctx.globalAlpha = 1; ctx.fillStyle = '#ec7431'; ctx.fillRect(hx - 2, hy - 1, 5, 3);
    ctx.fillStyle = '#ffcc58'; ctx.fillRect(hx - 1, hy - 2, 3, 3);
    ctx.fillStyle = '#fff4b5'; ctx.fillRect(hx, hy - 1, 1, 2);
    for (let i = 0; i < 9; i++) {
      const age = (elapsed * (2.4 + noise(i, id)) + i / 9) % 1;
      const direction = noise(i + 17, id) * 2 - 1;
      const oldHead = fusePath[Math.floor((1 - Math.max(0, (elapsed - age * 0.3) / 2)) * (fusePath.length - 1))];
      ctx.globalAlpha = 1 - age; ctx.fillStyle = i % 3 ? '#ffbd49' : '#fff1a7';
      ctx.fillRect(Math.round(x + oldHead[0] + direction * age * 15), Math.round(y + oldHead[1] - age * 15 + age * age * 7), 1 + i % 2, 1);
    }
    for (let i = 1; i <= 4; i++) {
      const age = (elapsed * 0.9 + i / 4) % 1;
      if (age > elapsed) continue;
      ctx.globalAlpha = Math.sin(age * Math.PI) * 0.25; ctx.fillStyle = '#9d9988';
      this.cloud(ctx, hx + Math.sin(age * 5 + id) * age * 5, hy - 5 - age * 20, Math.round(1 + age * 3));
    }
    if (remaining < 0.55) {
      ctx.globalAlpha = (Math.sin(elapsed * 55) + 1) * 0.18;
      ctx.fillStyle = '#ffd490'; ctx.fillRect(x - 6, y - 8, 12, 9);
    }
    ctx.restore();
  }
}
