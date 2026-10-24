import { HAMMER, TSAR, superweaponStrikes, type SuperweaponStrike } from '../content/superweapons';
import { noise } from '../core/random';
import type { World } from '../core/world';
import type { Vec2 } from '../core/types';
import { TILE } from './camera';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
function block(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
function cloud(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, radius: number, squash = 1): void {
  const r = Math.max(1, Math.round(radius)), h = Math.max(1, Math.round(r * squash));
  block(ctx, color, x - r * 0.65, y - h, r * 1.3, h * 2);
  block(ctx, color, x - r, y - h * 0.6, r * 2, h * 1.2);
}
function plume(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, radius: number, squash = 1): void {
  const rows = 14, height = radius * squash * 2 / rows;
  for (let row = 0; row < rows; row++) {
    const p = (row + 0.5) / rows * 2 - 1, width = Math.round(Math.sqrt(1 - p * p) * radius / 3) * 3;
    block(ctx, color, x - width, y - radius * squash + row * height, width * 2, Math.ceil(height));
  }
}
function blastContour(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, seed: number): void {
  ctx.beginPath();
  const top = Math.floor((y - ry) / 4) * 4, bottom = Math.ceil((y + ry) / 4) * 4;
  for (let py = top; py < bottom; py += 4) {
    const p = Math.max(-1, Math.min(1, (py + 2 - y) / Math.max(1, ry)));
    const edge = 0.94 + noise(Math.floor((py - top) / 12) + 503, seed) * 0.06;
    const width = Math.sqrt(1 - p * p) * rx * edge;
    const left = Math.floor((x - width) / 4) * 4, right = Math.ceil((x + width) / 4) * 4;
    ctx.rect(left, py, Math.max(4, right - left), 4);
  }
}
function blastCloud(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry: number, seed: number): void {
  blastContour(ctx, x, y, rx, ry, seed); ctx.fillStyle = color; ctx.fill();
}
function pressureWave(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, radius: number, thickness: number, squash = 1): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const r of [radius, Math.max(0, radius - thickness)]) {
    for (let i = 0; i < 96; i++) {
      const angle = i * Math.PI / 48, px = Math.round((x + Math.cos(angle) * r) / 3) * 3, py = Math.round((y + Math.sin(angle) * r * squash) / 3) * 3;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
}
function ring(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, radius: number, squash = 1, size = 2, phase = 0): void {
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI / 32 + phase;
    block(ctx, color, x + Math.cos(angle) * radius - size / 2, y + Math.sin(angle) * radius * squash - size / 2, size, size);
  }
}
function target(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number): void {
  const radius = 20 - progress * 8;
  ctx.globalAlpha = 0.6 + progress * 0.3;
  for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
    block(ctx, '#ffcf78', x + dx * radius - (dx > 0 ? 5 : 0), y + dy * radius, 6, 2);
    block(ctx, '#ffcf78', x + dx * radius, y + dy * radius - (dy > 0 ? 5 : 0), 2, 6);
  }
  block(ctx, '#fff0b0', x - 3, y, 7, 1); block(ctx, '#fff0b0', x, y - 3, 1, 7);
}

/** Every phase is derived from saved simulation time, including smoke and fallout. */
export class SuperweaponAnimations {
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  shake(world: World): Vec2 {
    if (this.reducedMotion) return { x: 0, y: 0 };
    let strength = 0;
    for (const strike of superweaponStrikes(world, HAMMER.id)) {
      if (strike.elapsed >= HAMMER.charge && strike.elapsed < HAMMER.charge + HAMMER.duration) strength = Math.max(strength, 1.2);
    }
    for (const strike of superweaponStrikes(world, TSAR.id)) {
      const age = strike.elapsed - TSAR.delay;
      if (age >= 0) {
        const impact = 12 * clamp(1 - age / 1.8) ** 2;
        const aftershock = age >= 0.65 ? 5 * clamp(1 - (age - 0.65) / 2.5) : 0;
        strength = Math.max(strength, impact, aftershock);
      }
    }
    return { x: Math.round(Math.sin(world.tick * 2.7) * strength), y: Math.round(Math.cos(world.tick * 3.3) * strength * 0.65) };
  }

  ground(ctx: CanvasRenderingContext2D, world: World): void {
    ctx.save();
    for (const strike of superweaponStrikes(world, HAMMER.id)) {
      const x = strike.x * TILE, y = strike.y * TILE, age = strike.elapsed - HAMMER.charge;
      if (age < 0) { target(ctx, x, y, strike.elapsed / HAMMER.charge); continue; }
      const fade = clamp((HAMMER.end - strike.elapsed) / 0.7), wet = !world.terrain.isLand(strike.x, strike.y);
      ctx.globalAlpha = fade * 0.45;
      cloud(ctx, wet ? '#d4e9df' : '#dd702c', x, y, HAMMER.groundRadius * TILE, 0.6);
      for (let i = 0; i < 14; i++) {
        const angle = noise(i, strike.seed) * Math.PI * 2, radius = 7 + noise(i + 23, strike.seed) * 17;
        ctx.globalAlpha = fade * (0.45 + 0.25 * Math.sin(age * 17 + i));
        block(ctx, wet ? '#f0ffff' : '#ffc55e', x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * 0.7, 3 + i % 3, 2);
      }
      ctx.globalAlpha = fade * 0.65;
      ring(ctx, '#f6d782', x, y, 8 + ((age * 2) % 1) * 25, 0.6, 2);
    }
    for (const strike of superweaponStrikes(world, TSAR.id)) {
      const x = strike.x * TILE, y = strike.y * TILE, age = strike.elapsed - TSAR.delay;
      if (age < 0) {
        const p = strike.elapsed / TSAR.delay;
        target(ctx, x, y, p);
        ctx.globalAlpha = 0.6 + p * 0.4;
        for (let i = 0; i < 3; i++) block(ctx, p * 3 > i ? '#f76336' : '#643c31', x - 16 + i * 12, y + 24, 9, 4);
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2, distance = 44 - p * 23;
          block(ctx, '#ff8651', x + Math.cos(angle) * distance - 3, y + Math.sin(angle) * distance - 3, 6, 6);
        }
        ctx.globalAlpha = 0.3; plume(ctx, '#201f26', x + 5, y + 3, 7 + p * 9, 0.45); continue;
      }
      const wet = !world.terrain.isLand(strike.x, strike.y);
      const heat = clamp(1 - age / 2.4);
      ctx.globalAlpha = heat * 0.65;
      plume(ctx, wet ? '#a0d2d4' : '#732f20', x, y, TSAR.craterRadius * TILE * (0.8 + clamp(age) * 0.4), 0.75);
      ctx.globalAlpha = heat * 0.65;
      plume(ctx, wet ? '#d9f5e8' : '#f77629', x, y, TSAR.craterRadius * TILE * 0.7, 0.65);
      for (let wave = 0; wave < 2; wave++) {
        const p = (age - wave * 0.16) / 0.9;
        if (p < 0 || p >= 1) continue;
        const radius = TSAR.damageRadius * TILE * (1 - (1 - p) ** 3) * (1 - wave * 0.13);
        ctx.globalAlpha = (1 - p) ** 1.5 * (0.6 - wave * 0.2);
        pressureWave(ctx, wave === 0 ? '#fff6c9' : wet ? '#c2eef1' : '#ffc04a', x, y, radius, 4 + (1 - p) * 18);
        ctx.globalAlpha *= 0.28;
        pressureWave(ctx, wet ? '#dcf7ef' : '#d4a371', x, y, radius * 0.96, 20 + p * 25);
      }
      if (age < 2.4) {
        const p = clamp(age / 1.2), spread = TSAR.damageRadius * TILE * 0.9 * (1 - (1 - p) ** 2);
        for (let i = 0; i < 48; i++) {
          const n = noise(i, strike.seed), angle = noise(i + 101, strike.seed) * Math.PI * 2;
          const radius = spread * (0.7 + n * 0.3), size = (4 + n * 10) * (0.4 + p);
          const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius;
          ctx.globalAlpha = clamp(age / 0.12) * clamp((2.4 - age) / 1.5) * 0.45;
          plume(ctx, wet ? '#8eaeb3' : '#67513f', px, py - size * 0.2, size, 0.7);
          ctx.globalAlpha *= 0.7;
          plume(ctx, wet ? '#d4e7df' : '#b69b73', px - size * 0.2, py - size * 0.5, size * 0.7, 0.6);
        }
      }
      const fade = clamp((TSAR.end - strike.elapsed) / 3);
      for (let i = 0; i < 44; i++) {
        const n = noise(i + 41, strike.seed), angle = noise(i + 113, strike.seed) * Math.PI * 2;
        const distance = Math.sqrt(n) * TSAR.falloutRadius * TILE;
        ctx.globalAlpha = fade * (0.1 + 0.25 * (Math.sin(age * 2 + i) + 1) / 2);
        block(ctx, wet ? '#c1ded1' : '#becb78', x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 2 + n * 3, 1 + n * 2);
      }
    }
    ctx.restore();
  }

  airborne(ctx: CanvasRenderingContext2D, world: World, top: number): void {
    ctx.save();
    for (const strike of superweaponStrikes(world, HAMMER.id)) this.hammer(ctx, strike, top, !world.terrain.isLand(strike.x, strike.y));
    for (const strike of superweaponStrikes(world, TSAR.id)) this.tsar(ctx, strike, !world.terrain.isLand(strike.x, strike.y));
    ctx.restore();
  }

  private hammer(ctx: CanvasRenderingContext2D, strike: SuperweaponStrike, top: number, wet: boolean): void {
    const x = strike.x * TILE, y = strike.y * TILE, age = strike.elapsed - HAMMER.charge;
    if (age < 0) {
      const progress = strike.elapsed / HAMMER.charge;
      ctx.globalAlpha = 0.15 + progress * 0.35;
      block(ctx, '#ffdc83', x, top, 1, y - top);
      ring(ctx, '#f9d88a', x, y, 28 * (1 - progress) + 7, 0.5, 2, strike.elapsed);
      return;
    }
    const fade = clamp((HAMMER.end - strike.elapsed) / 0.7);
    const intensity = age < HAMMER.duration ? clamp(age / 0.1) : clamp((HAMMER.end - strike.elapsed) / 0.7);
    const pulse = Math.sin(age * 43) + Math.sin(age * 61), width = (12 + pulse) * intensity;
    const height = Math.max(1, y - top);
    ctx.globalAlpha = intensity * 0.12; block(ctx, '#ffad36', x - width * 2.8, top, width * 5.6, height);
    ctx.globalAlpha = intensity * 0.3; block(ctx, '#f59a32', x - width * 1.5, top, width * 3, height);
    ctx.globalAlpha = intensity * 0.8; block(ctx, '#ffcd61', x - width * 0.7, top, width * 1.4, height);
    ctx.globalAlpha = intensity; block(ctx, '#fff1a9', x - width * 0.35, top, width * 0.7, height);
    block(ctx, '#fffdf0', x - Math.max(1, width * 0.15), top, Math.max(2, width * 0.3), height);
    for (let i = 0; i < 24; i++) {
      const p = (age * 1.8 + i / 24) % 1, side = noise(i, strike.seed) * 2 - 1;
      ctx.globalAlpha = intensity * Math.sin(p * Math.PI) * 0.7;
      block(ctx, i % 3 ? '#ffe09a' : '#ffffff', x + side * (width + 6), top + p * height, 1 + i % 2, 5 + i % 6);
    }
    ctx.globalAlpha = intensity;
    cloud(ctx, '#f4a03c', x, y - 3, 18 + pulse * 2, 0.6);
    cloud(ctx, '#ffe393', x, y - 4, 12 + pulse, 0.7);
    cloud(ctx, '#fffceb', x, y - 3, 6 + pulse * 0.4);
    for (let i = 0; i < 22; i++) {
      const n = noise(i + 61, strike.seed), p = (age * (1.1 + n) + n) % 1;
      const angle = noise(i + 83, strike.seed) * Math.PI * 2;
      ctx.globalAlpha = (1 - p) * fade;
      block(ctx, i % 3 ? '#ffc85d' : '#fff4c4', x + Math.cos(angle) * p * 43,
        y + Math.sin(angle) * p * 22 - Math.sin(p * Math.PI) * 33, 2, 3);
    }
    for (let i = 0; i < 10; i++) {
      const n = noise(i + 133, strike.seed), p = (age * 0.5 + n) % 1;
      if (p > age * 0.5) continue;
      ctx.globalAlpha = Math.sin(p * Math.PI) * fade * 0.35;
      cloud(ctx, wet ? '#d1e5df' : '#6c6656', x + (n - 0.5) * 28 + p * 18, y - 12 - p * 70, 4 + p * 9);
    }
  }

  private tsar(ctx: CanvasRenderingContext2D, strike: SuperweaponStrike, wet: boolean): void {
    const x = strike.x * TILE, y = strike.y * TILE, age = strike.elapsed - TSAR.delay;
    if (age < 0) {
      const p = strike.elapsed / TSAR.delay, by = y - 260 * (1 - p * p);
      for (let i = 1; i < 12; i++) {
        ctx.globalAlpha = (1 - i / 12) * 0.35;
        plume(ctx, '#dddbc6', x + Math.sin(i + p * 8) * 2, by - 24 - i * (7 + p * 8), 2 + i * 0.35, 1.8);
      }
      ctx.globalAlpha = 1;
      block(ctx, '#242c31', x - 9, by - 22, 19, 35); block(ctx, '#b7bbad', x - 8, by - 20, 17, 32);
      block(ctx, '#f9e9c5', x - 7, by - 18, 5, 28); block(ctx, '#65736f', x + 5, by - 18, 4, 28);
      block(ctx, '#252e31', x - 8, by - 9, 17, 12); block(ctx, '#dfad48', x - 8, by - 8, 17, 10);
      block(ctx, '#41382b', x - 2, by - 6, 5, 6); block(ctx, '#f9df8c', x, by - 4, 1, 2);
      block(ctx, '#c8c5ad', x - 6, by + 12, 13, 4); block(ctx, '#ece0bc', x - 3, by + 16, 7, 3);
      block(ctx, '#374949', x - 15, by - 29, 7, 17); block(ctx, '#7e8b7d', x + 9, by - 29, 7, 17);
      block(ctx, '#dfd1aa', x - 8, by - 26, 17, 3); block(ctx, '#4a5653', x - 1, by - 31, 3, 10);
      return;
    }
    this.thermalDebris(ctx, strike);
    this.fireRing(ctx, strike, wet, false);
    this.mushroom(ctx, strike);
    this.ejecta(ctx, strike, wet);
    this.fireRing(ctx, strike, wet, true);
    const fade = clamp((TSAR.end - strike.elapsed) / 3);
    for (let i = 0; i < 72; i++) {
      const n = noise(i + 151, strike.seed), p = ((age - 2) * (0.09 + n * 0.08) + n) % 1;
      if (age < 2 || p > (age - 2) * 0.2) continue;
      ctx.globalAlpha = fade * Math.sin(p * Math.PI) * 0.65;
      const px = x + (noise(i + 197, strike.seed) - 0.5) * TSAR.falloutRadius * TILE * 2.4 + Math.sin(p * 5 + i) * 15;
      const py = y - 250 + p * 300 + (noise(i + 211, strike.seed) - 0.5) * 120;
      block(ctx, i % 5 === 0 && age < 5 ? '#ffc264' : i % 3 ? '#302c2b' : '#bcae88', px, py, 2 + i % 3, 2 + i % 2);
    }
  }

  private thermalDebris(ctx: CanvasRenderingContext2D, strike: SuperweaponStrike): void {
    const age = strike.elapsed - TSAR.delay;
    if (age >= 1.8) return;
    const radius = TSAR.damageRadius * TILE * (1 - Math.exp(-age * 8));
    for (let i = 0; i < 720; i++) {
      const n = noise(i + 541, strike.seed), angle = noise(i + 811, strike.seed) * Math.PI * 2;
      const distance = radius * Math.sqrt(n), size = 3 + noise(i + 1041, strike.seed) * 5;
      ctx.globalAlpha = clamp(age / 0.06) * clamp((1.8 - age) / 1.1) * (0.65 + n * 0.35);
      const x = strike.x * TILE + Math.cos(angle) * distance, y = strike.y * TILE + Math.sin(angle) * distance * 0.85 - age * (15 + n * 35);
      block(ctx, i % 4 ? '#fff2b2' : '#ffbd37', x, y, size, size);
    }
  }

  private fireRing(ctx: CanvasRenderingContext2D, strike: SuperweaponStrike, wet: boolean, front: boolean): void {
    const age = strike.elapsed - TSAR.delay;
    if (age >= 2.6) return;
    const x = strike.x * TILE, y = strike.y * TILE, grow = 1 - Math.exp(-age * 7);
    const radius = 12 + grow * 200, fade = clamp(age / 0.06) * clamp((2.6 - age) / 0.9);
    ctx.save();
    if (front) { ctx.beginPath(); ctx.rect(x - radius * 1.3, y + 2, radius * 2.6, radius); ctx.clip(); }
    if (!front) {
      ctx.globalAlpha = fade * 0.15;
      blastCloud(ctx, '#ffcb48', x, y, radius * 1.2, radius * 0.65, strike.seed);
      ctx.globalAlpha = fade;
      blastCloud(ctx, wet ? '#4b4940' : '#572515', x, y - 7, radius * 0.96, radius * 0.48, strike.seed);
    }
    ctx.globalAlpha = fade;
    pressureWave(ctx, '#9b3a10', x, y + 12, radius * 1.04, radius * 0.3, 0.48);
    pressureWave(ctx, '#f99312', x, y + 7, radius, radius * 0.23, 0.48);
    pressureWave(ctx, '#ffcf39', x, y + 2, radius * 0.95, radius * 0.1, 0.48);
    pressureWave(ctx, '#fff2a1', x, y, radius * 0.88, radius * 0.045, 0.48);
    for (let i = 0; i < 32; i++) {
      const n = noise(i + 391, strike.seed), angle = i * Math.PI / 16 + n * 0.09;
      const px = x + Math.cos(angle) * radius * 0.79, py = y + Math.sin(angle) * radius * 0.37;
      const height = (9 + n * 42) * grow * (0.75 + Math.sin(age * 17 + i) * 0.25);
      block(ctx, '#ed7914', px - 5, py - height, 9 + n * 6, height + 7);
      block(ctx, '#ffd85b', px - 3, py - height * 0.7, 6 + n * 4, height * 0.7 + 4);
      block(ctx, '#fff5bb', px - 2, py - height * 0.48, 4, height * 0.3);
    }
    ctx.restore();
  }

  private mushroom(ctx: CanvasRenderingContext2D, strike: SuperweaponStrike): void {
    const x = strike.x * TILE, y = strike.y * TILE, age = strike.elapsed - TSAR.delay;
    if (age >= TSAR.cloud) return;
    const grow = 1 - Math.exp(-Math.max(0, age - 0.06) * 5);
    const lift = 15 + grow * 205 + Math.max(0, age - 1.25) * 34, capY = y - lift;
    const radius = 18 + grow * 163, fade = clamp(age / 0.1) * clamp((3.15 - age) / 1.1);
    const heat = clamp((1.9 - age) / 1.05), column = clamp((2.65 - age) / 0.85) * clamp(age / 0.15);
    // A squat incandescent column supports the cap before breaking into soot.
    if (column > 0) {
      ctx.globalAlpha = column;
      blastCloud(ctx, '#522613', x, y - lift * 0.4, grow * 75, lift * 0.57, strike.seed + 1);
      blastCloud(ctx, '#e76a0d', x - 4, y - lift * 0.4, grow * 57, lift * 0.54, strike.seed + 2);
      for (let strand = 0; strand < 10; strand++) {
        const n = noise(strand + 431, strike.seed), side = (strand / 9 - 0.5) * 124 * grow;
        for (let segment = 0; segment < 7; segment++) {
          const p = segment / 7, flow = Math.sin(age * 12 - p * 6 + strand) * (6 + n * 8);
          const px = x + side * (0.8 + p * 0.4) + flow, py = y - p * lift;
          ctx.globalAlpha = column * (0.7 + n * 0.3);
          const bright = (segment + strand) % 3 !== 0;
          block(ctx, bright ? '#ffc635' : '#9b3c0c', px - 7, py - lift / 7, 10 + n * 9, lift / 7 + 4);
          if (bright) block(ctx, '#fff0a3', px - 4, py - lift / 7, 4 + n * 5, lift / 10);
        }
      }
    }
    if (fade > 0) {
      ctx.globalAlpha = fade;
      blastCloud(ctx, '#231e1c', x, capY + 9, radius * 1.05, radius * 0.72, strike.seed);
      ctx.globalAlpha = fade * heat;
      blastCloud(ctx, '#9e3b0d', x, capY + 6, radius, radius * 0.7, strike.seed);
      blastCloud(ctx, '#f29116', x - 2, capY, radius * 0.97, radius * 0.66, strike.seed + 1);
      blastCloud(ctx, '#ffd04b', x - 5, capY - 8, radius * 0.89, radius * 0.61, strike.seed + 2);
      blastCloud(ctx, '#fff1a0', x - 7, capY - 14, radius * 0.77, radius * 0.53, strike.seed + 3);
      ctx.globalAlpha = fade * clamp((1.25 - age) / 0.8);
      blastCloud(ctx, '#fffbc9', x - 10, capY - 17, radius * 0.61, radius * 0.43, strike.seed + 4);
      ctx.save(); blastContour(ctx, x, capY, radius, radius * 0.69, strike.seed); ctx.clip();
      for (let patch = 0; patch < 14; patch++) {
        const n = noise(patch + 337, strike.seed), angle = patch * 2.4 + age * 0.5;
        const px = x + Math.cos(angle) * radius * (0.2 + n * 0.5), py = capY + Math.sin(angle) * radius * 0.42;
        ctx.globalAlpha = fade * heat * 0.35;
        blastCloud(ctx, patch % 3 ? '#ffe88a' : '#e9a52e', px, py, radius * (0.1 + n * 0.13), radius * (0.06 + n * 0.09), strike.seed + patch);
      }
      // Oblique, uneven tears consume the white cap, leaving broken orange seams.
      for (let band = 0; band < 5; band++) {
        const n = noise(band + 47, strike.seed), cooling = clamp((age - 0.55 - n * 0.45) / 0.7);
        if (cooling <= 0) continue;
        const edge = [];
        for (let segment = 0; segment < 40; segment++) {
          const p = segment / 39, px = x + (p - 0.5) * radius * 2.3;
          const py = capY + (band / 4 - 0.5) * radius * 2.1 - (p - 0.5) * radius * 1.1
            + Math.sin(p * 9 + band * 2 + age * 2) * radius * 0.12 + (n - 0.5) * radius * 0.3;
          const thickness = radius * (0.16 + cooling * 0.3) * cooling * (0.65 + noise(Math.floor(segment / 2) + band * 23, strike.seed) * 0.7);
          edge.push({ x: Math.round(px / 4) * 4, y: Math.round(py / 4) * 4, thickness: Math.round(thickness / 4) * 4 });
        }
        ctx.globalAlpha = fade;
        for (let i = 0; i < edge.length - 1; i++) {
          const point = edge[i];
          if (point.thickness > 0) block(ctx, band % 2 ? '#221d1c' : '#2b211b', point.x, point.y, edge[i + 1].x - point.x + 4, point.thickness);
        }
        const ember = clamp((2.65 - age) / 1.1) * cooling;
        for (let i = 0; i < edge.length - 1; i++) {
          if ((i + band) % 4 === 0) continue;
          const point = edge[i], py = point.y + point.thickness;
          ctx.globalAlpha = fade * ember;
          block(ctx, '#b7490e', point.x, py, radius * 0.14, 7);
          if ((i + band) % 3 === 0) {
            block(ctx, '#ffac24', point.x + 2, py, radius * 0.16, 5);
            block(ctx, '#ffe47b', point.x + 4, py, radius * 0.11, 3);
          }
        }
      }
      ctx.restore();
    }
    // The cooling head separates into opaque, drifting chunks instead of a static mushroom.
    for (let i = 0; i < 18; i++) {
      const n = noise(i + 83, strike.seed), start = 1.1 + n * 0.8, t = age - start;
      if (t <= 0) continue;
      const opacity = clamp(t / 0.3) * clamp((3.5 + n * 1.3 - age) / 0.8);
      if (opacity <= 0) continue;
      const angle = noise(i + 113, strike.seed) * Math.PI * 2, distance = radius * (0.4 + n * 0.5) + t * (24 + n * 38);
      const px = x + Math.cos(angle) * distance, py = capY + Math.sin(angle) * radius * 0.45 - t * (15 + n * 28);
      const size = (22 + n * 40) * (0.8 + t * 0.16);
      ctx.globalAlpha = opacity;
      blastCloud(ctx, i % 3 ? '#211f20' : '#29231f', px, py, size, size * (0.8 + n * 0.4), strike.seed + i);
      ctx.globalAlpha = opacity * clamp((2.6 - age) / 0.9) * 0.8;
      block(ctx, '#c14a0c', px - size * 0.25, py + size * 0.2, size * 0.4, 6);
      block(ctx, '#ff9f1c', px - size * 0.15, py + size * 0.2, size * 0.22, 3);
    }
  }

  private ejecta(ctx: CanvasRenderingContext2D, strike: SuperweaponStrike, wet: boolean): void {
    const age = strike.elapsed - TSAR.delay;
    for (let i = 0; i < 64; i++) {
      const n = noise(i + 271, strike.seed), p = (age - n * 0.25) / (1.2 + n * 2.8);
      if (p < 0 || p >= 1) continue;
      const angle = noise(i + 293, strike.seed) * Math.PI * 2, distance = (70 + n * 270) * p;
      for (let trail = 4; trail >= 0; trail--) {
        const t = Math.max(0, p - trail * 0.025), d = distance * t / (p || 1);
        const x = strike.x * TILE + Math.cos(angle) * d, y = strike.y * TILE + Math.sin(angle) * d * 0.65 - Math.sin(t * Math.PI) * (45 + n * 150);
        ctx.globalAlpha = (1 - p) * (1 - trail / 5) * 0.9;
        block(ctx, wet ? '#d4efdf' : trail ? '#c65f2d' : p < 0.5 ? '#ffe2a0' : '#4b3c31', x, y, 3 + n * 4, 3 + n * 3);
      }
    }
  }

  flash(ctx: CanvasRenderingContext2D, world: World, width: number, height: number, origin: Vec2, zoom: number): void {
    let alpha = 0, warning = 0, smoke = 0, warmth = 0;
    for (const strike of superweaponStrikes(world, TSAR.id)) {
      const age = strike.elapsed - TSAR.delay;
      const x = origin.x + strike.x * TILE * zoom, y = origin.y + strike.y * TILE * zoom, radius = TSAR.radius * TILE * zoom;
      if (x + radius < 0 || x - radius > width || y + radius < 0 || y - radius > height) continue;
      if (age < 0) {
        warning = Math.max(warning, (this.reducedMotion ? 0.08 : 0.24) * (strike.elapsed / TSAR.delay) ** 2);
        continue;
      }
      alpha = Math.max(alpha, (this.reducedMotion ? 0.12 : 0.55) * clamp(1 - age / 0.45) ** 2);
      warmth = Math.max(warmth, 0.1 * clamp(age / 0.12) * clamp(1 - age / 1.8));
      smoke = Math.max(smoke, (this.reducedMotion ? 0.05 : 0.16) * clamp((age - 0.5) / 0.6) * clamp((4.5 - age) / 2));
    }
    ctx.save();
    for (const [opacity, color] of [[warning, '#251920'], [warmth, '#f5a544'], [alpha, '#fff6dd']] as const) {
      if (opacity <= 0) continue;
      ctx.globalAlpha = opacity; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height);
    }
    if (smoke > 0) {
      const radius = Math.max(width, height) * 0.7;
      const shadow = ctx.createRadialGradient(width / 2, height * 0.55, radius * 0.12, width / 2, height * 0.55, radius);
      shadow.addColorStop(0, '#342d2600'); shadow.addColorStop(0.6, '#342d2680'); shadow.addColorStop(1, '#1b1c24');
      ctx.globalAlpha = smoke; ctx.fillStyle = shadow; ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
  }
}
