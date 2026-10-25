import { CATACLYSMS, GRAVITY, cataclysms, ease, tornadoStrength, tornadoCaptivePose, gravityCaptivePose,
  type BloodTornado, type GravityClap, type LiftedPose, type CataclysmBurst } from '../core/cataclysms';
import { noise } from '../core/random';
import type { World } from '../core/world';
import { raceOf } from '../core/races';
import { drawResidentSprite } from './residents';
import { villageColor } from './sprites';
import { TILE } from './camera';

const TAU = Math.PI * 2;
const blood = ['#3c1716', '#581c18', '#7c251e', '#a33629', '#bd5140'];
const dust = ['#44443d', '#656257', '#888171', '#aaa18c', '#c0b7a1'];
type Point = readonly [number, number];
function pixel(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = w): void {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}
function line(ctx: CanvasRenderingContext2D, color: string, a: Point, b: Point, width = 1): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, width * 0.6)));
  for (let i = 0; i <= steps; i++) pixel(ctx, color, a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, width);
}
function oval(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry: number): void {
  if (rx <= 0 || ry <= 0) return;
  for (let row = -Math.ceil(ry); row <= ry; row++) {
    const span = Math.sqrt(Math.max(0, 1 - (row / Math.max(1, ry)) ** 2)) * rx;
    if (span > 0) pixel(ctx, color, x - span, y + row, span * 2, 1);
  }
}

/** Uneven overlapping lobes, with light on the upper left, read as suspended dust. */
function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, seed: number, alpha: number, red = false): void {
  if (radius < 0.5 || alpha <= 0) return;
  const colors = red ? ['#675449', '#8b6b59', '#aa8871'] : [dust[1], dust[2], dust[3]];
  ctx.globalAlpha = alpha * 0.3; oval(ctx, colors[1], x, y, radius * 1.3, radius * 0.8);
  for (let i = 0; i < 4; i++) {
    const n = noise(i, seed), a = i * 2.4 + n, r = radius * (0.5 + n * 0.25);
    const px = x + Math.cos(a) * radius * 0.42, py = y + Math.sin(a) * radius * 0.25;
    ctx.globalAlpha = alpha * (0.45 + n * 0.3);
    oval(ctx, colors[i % 2], px, py, r, r * 0.65);
    ctx.globalAlpha = alpha * 0.22; oval(ctx, colors[2], px - r * 0.2, py - r * 0.24, r * 0.75, r * 0.3);
  }
}

/** The upper column bends after the foot; small eddies travel upward through it. */
function funnel(t: BloodTornado, u: number) {
  const strength = tornadoStrength(t), sway = Math.sin(t.age * 1.6 - u * 4 + t.seed) * u * u;
  return { x: t.x * TILE + (sway * 13 - t.vx * u * u * 2.4) * strength,
    y: t.y * TILE - u * 124 * (0.2 + strength * 0.8),
    r: (3 + 40 * u ** 1.35) * (0.25 + 0.75 * strength)
      * (1 + Math.sin(u * 16 - t.age * 3) * 0.08 + Math.sin(u * 31 - t.age * 4.3) * 0.04) };
}
function airborneResident(ctx: CanvasRenderingContext2D, world: World, id: number, pose: LiftedPose, time: number): void {
  const entity = world.entities.get(id), person = entity?.components.person;
  if (!entity || !person) return;
  ctx.save(); ctx.globalAlpha = 1;
  ctx.translate(Math.round(pose.x * TILE), Math.round((pose.y - pose.z) * TILE));
  ctx.rotate(pose.angle); ctx.scale(pose.scale, pose.scale); ctx.translate(0, 5);
  const owner = entity.components.citizen?.villageId;
  drawResidentSprite(ctx, { time: time * 1.1 + id, action: 'swim', heading: pose.angle, race: raceOf(entity),
    child: person.age < 18, variant: entity.components.appearance?.variant, color: owner ? villageColor(owner) : undefined });
  ctx.restore();
}

export function drawCataclysmGround(ctx: CanvasRenderingContext2D, world: World): void {
  const state = cataclysms(world); if (!state) return;
  ctx.save();
  for (const s of state.stains) {
    const water = !world.terrain.isLand(s.x, s.y), fade = Math.min(1, (CATACLYSMS.stainLife - s.age) / 5);
    const spread = (0.25 + ease(s.age / 0.45) * 0.75) * s.size * TILE;
    ctx.globalAlpha = fade * (water ? 0.3 : 0.75);
    for (let i = 0; i < 11; i++) {
      const a = noise(i, s.seed) * TAU, r = Math.sqrt(noise(i, s.seed + 3)) * spread;
      const size = (1 + noise(i, s.seed + 7) * 3) * Math.min(1.5, s.size);
      oval(ctx, blood[s.age > 6 ? 0 : i % 3], s.x * TILE + Math.cos(a) * r,
        s.y * TILE + Math.sin(a) * r * 0.65, size + (water ? s.age * 0.2 : 0), Math.max(1, size * 0.5));
    }
  }
  for (const t of state.tornadoes) {
    const strength = tornadoStrength(t), x = t.x * TILE, y = t.y * TILE;
    if (strength <= 0) continue;
    ctx.globalAlpha = strength * 0.1; oval(ctx, '#292b25', x - t.vx * 1.8, y - 8, 60, 28);
    ctx.globalAlpha = strength * 0.18; oval(ctx, '#292b25', x, y, 31, 14);
    for (let i = 0; i < 32; i++) {
      const n = noise(i, t.seed), phase = (n + t.age * (0.25 + n * 0.18)) % 1;
      const angle = i * 2.4 + phase * 3, radius = (1 - phase) * (25 + n * 52) * strength;
      ctx.globalAlpha = Math.sin(phase * Math.PI) * strength * 0.4;
      const px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius * 0.6;
      line(ctx, dust[i % 4], [px, py], [px + Math.cos(angle + 0.5) * 3, py + Math.sin(angle + 0.5) * 2]);
    }
    for (const c of t.captives) {
      const p = tornadoCaptivePose(t, c); ctx.globalAlpha = 0.17 * (1 - p.z / 20);
      oval(ctx, '#27271f', p.x * TILE, p.y * TILE, 4, 2);
    }
  }
  for (const g of state.claps) {
    const x = g.x * TILE, y = g.y * TILE;
    if (!g.fired) {
      const pull = ease(g.age / GRAVITY.charge);
      ctx.globalAlpha = pull * 0.13; oval(ctx, '#292b26', x, y, 27 - pull * 15, 10 - pull * 5);
      for (const c of g.captives) {
        const p = gravityCaptivePose(g, c); ctx.globalAlpha = 0.16 * (1 - p.z / 20);
        oval(ctx, '#292b26', p.x * TILE, p.y * TILE, 4, 2);
      }
    } else {
      const age = g.age - GRAVITY.charge;
      // The pressure front reaches the same ground positions as the damaging wave.
      for (let i = 0; i < 64; i++) {
        const n = noise(i, g.seed + 43), a = i * TAU / 64 + n * 0.04;
        const distance = GRAVITY.radius * TILE * Math.min(1, age / GRAVITY.wave);
        const fade = (1 - ease((age - GRAVITY.wave * 0.65) / 0.9)) * ease(age / 0.12);
        const r = distance * (0.95 + n * 0.05), radius = (3 + n * 5) * (0.4 + Math.min(1, age));
        cloud(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, radius, i + g.seed, fade * 0.5);
      }
    }
  }
  ctx.restore();
}

function drawTornado(ctx: CanvasRenderingContext2D, world: World, t: BloodTornado): void {
  const strength = tornadoStrength(t), dying = t.released === null ? 0 : Math.max(0, t.age - t.released);
  const opacity = ease(t.age / 0.25) * (1 - ease((dying - 0.4) / 0.9));
  const red = Math.min(1, t.blood / 8 + t.captives.length / 24);
  ctx.save();
  if (opacity > 0) {
    const captives = t.captives.map(c => ({ id: c.id, pose: tornadoCaptivePose(t, c) }));
    for (const c of captives) if (c.pose.y < t.y) airborneResident(ctx, world, c.id, c.pose, t.age);
    // Fine, shaded cells follow a rotating surface. No stationary stripes or wireframe.
    const palette = red > 0.25 ? ['#3e3934', '#51463c', '#665344', '#806855', '#97816b', '#b09b82']
      : ['#383c38', '#4b4e46', '#626459', '#7d7d6d', '#969581', '#b0ac94'];
    for (let row = 62; row >= 0; row--) {
      const u = row / 62, f = funnel(t, u), cells = Math.max(4, Math.ceil(f.r * 0.6));
      for (let col = 0; col < cells; col++) {
        const v = (col + 0.5) / cells * 2 - 1, surface = Math.asin(v);
        const phase = surface - t.age * (3.4 - u * 1.6) + u * 8;
        const billow = Math.sin(phase * 3 + u * 13) * 0.55 + Math.sin(phase * 7 - u * 27) * 0.23
          + Math.sin(phase * 11 + u * 43) * 0.12;
        const lit = Math.sqrt(1 - v * v) * 2.1 - v * 1.1 + billow;
        ctx.globalAlpha = opacity * (0.7 + Math.sqrt(1 - v * v) * 0.2);
        pixel(ctx, palette[Math.max(0, Math.min(5, Math.floor(lit + 1.8)))],
          f.x - f.r + col * f.r * 2 / cells, f.y, f.r * 2 / cells + 1, 3);
      }
    }
    // Irregular eddies peel off the surface, rise, widen and dissolve at the crown.
    for (let i = 0; i < 58; i++) {
      const n = noise(i, t.seed + 9), u = (n + t.age * (0.12 + n * 0.07)) % 1;
      const f = funnel(t, u), a = i * 2.4 + t.age * (3.8 - u * 1.8) - u * 6;
      const side = Math.sin(a), r = (3 + u * 10) * strength;
      if (side < -0.35) continue;
      cloud(ctx, f.x + Math.cos(a) * f.r * 0.94, f.y + side * f.r * 0.23, r,
        i + t.seed, opacity * Math.sin(u * Math.PI) * (0.3 + Math.max(0, side) * 0.3), red > 0.25);
    }
    const top = funnel(t, 1);
    for (let i = 0; i < 17; i++) {
      const n = noise(i, t.seed + 81), a = i * 2.4 + t.age * 0.8;
      cloud(ctx, top.x + Math.cos(a) * top.r * Math.sqrt(n), top.y + Math.sin(a) * 9,
        (10 + n * 12) * strength, i + t.seed, opacity * 0.6, red > 0.25);
    }
    // Heavy fragments orbit more slowly than the dust; nearer pieces occlude the column.
    const count = 25 + Math.min(35, t.debris * 3);
    for (let i = 0; i < count; i++) {
      const n = noise(i, t.seed + 19), u = (n + t.age * (0.12 + n * 0.1)) % 1, f = funnel(t, u);
      const a = t.age * (2.9 + n * 1.4) - u * 9 + i * 2.4;
      if (Math.sin(a) < -0.15) continue;
      const r = f.r + 5 + n * 16, x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r * 0.3;
      ctx.globalAlpha = opacity * Math.sin(u * Math.PI);
      const length = t.debris && i % 4 === 1 ? 5 : 2, angle = a * 1.3 + n * 4;
      const color = red > 0 && i % 3 === 0 ? blood[i % 3 + 1] : dust[i % 3];
      line(ctx, color, [x, y], [x + Math.cos(angle) * length, y + Math.sin(angle) * length], i % 5 ? 1 : 2);
      if (length > 2) pixel(ctx, dust[3], x, y);
    }
    for (const c of captives) if (c.pose.y >= t.y) airborneResident(ctx, world, c.id, c.pose, t.age);
    for (let i = 0; i < 22; i++) {
      const n = noise(i, t.seed + 93), phase = (n + t.age * 0.45) % 1, a = i * 2.4 + t.age * 1.8;
      const r = (9 + phase * 33) * strength;
      cloud(ctx, t.x * TILE + Math.cos(a) * r, t.y * TILE + Math.sin(a) * r * 0.38 - phase * 6,
        (5 + phase * 9) * strength, i + t.seed, opacity * Math.sin(phase * Math.PI) * 0.75, red > 0.25);
    }
  }
  if (dying > 0.3 && dying < 2.7) {
    const age = dying - 0.3, fade = Math.sin(Math.min(1, age / 2.4) * Math.PI);
    for (let i = 0; i < 23; i++) {
      const n = noise(i, t.seed), a = i * 2.4, radius = 18 + age * (8 + n * 18);
      cloud(ctx, t.x * TILE - t.vx * 2 + Math.cos(a) * radius + age * 7,
        t.y * TILE - 40 - n * 75 + Math.sin(a) * radius * 0.3 - age * 6,
        9 + age * 8, i + t.seed, fade * 0.28, red > 0.25);
    }
  }
  if (dying > 0 && t.blood) {
    for (let i = 0; i < 60 + Math.min(80, t.blood * 6); i++) {
      const n = noise(i, t.seed), age = dying - n * 0.7;
      if (age <= 0) continue;
      const angle = noise(i, t.seed + 4) * TAU, r = 12 + noise(i, t.seed + 8) * 48;
      const fall = 72 + n * 40, impact = Math.sqrt(fall / 85), time = Math.min(age, impact);
      const x = t.x * TILE + Math.cos(angle) * r - t.vx * 1.8 + Math.sin(angle) * time * 12;
      const ground = t.y * TILE + Math.sin(angle) * r * 0.6, y = ground - fall + time * time * 85;
      ctx.globalAlpha = 0.85 * (1 - ease((age - impact) / 0.35));
      if (age < impact) line(ctx, blood[i % 3 + 1], [x, y], [x - Math.sin(angle), y - 1 - time * 3], 1 + (i % 9 === 0 ? 1 : 0));
      else {
        const splash = (age - impact) * 16;
        pixel(ctx, blood[1], x - splash, ground, 2 + splash * 2, 1);
        if (splash < 3) for (const side of [-1, 1]) pixel(ctx, blood[2], x + side * (splash + 1), ground - Math.sin(splash) * 2);
      }
    }
  }
  ctx.restore();
}

const pressureBuffers = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
/** Sample the actual scenery through a thin pressure shell, without changing the simulation. */
function refract(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, amount: number): void {
  if (radius < 3 || amount <= 0) return;
  const matrix = ctx.getTransform();
  if (matrix.a <= 0 || matrix.d <= 0 || matrix.b !== 0 || matrix.c !== 0) return;
  let buffer = pressureBuffers.get(ctx);
  if (!buffer) { buffer = document.createElement('canvas'); buffer.width = buffer.height = 224; pressureBuffers.set(ctx, buffer); }
  const sample = buffer.getContext('2d')!, size = Math.ceil(radius + 8) * 2;
  const left = Math.round(x - size / 2), top = Math.round(y - size / 2);
  sample.clearRect(0, 0, size, size); sample.imageSmoothingEnabled = false;
  sample.drawImage(ctx.canvas, left * matrix.a + matrix.e, top * matrix.d + matrix.f,
    size * matrix.a, size * matrix.d, 0, 0, size, size);
  ctx.globalAlpha = Math.min(0.8, amount * 0.5);
  for (let row = -Math.floor(radius); row <= radius; row += 2) {
    const half = Math.sqrt(Math.max(0, radius * radius - row * row));
    const thickness = Math.min(half, 3 + amount), shift = Math.min(3, amount) * half / radius;
    for (const side of [-1, 1]) {
      const dx = Math.round(x + side * half - (side > 0 ? thickness : 0));
      ctx.drawImage(buffer, dx - left - side * shift, Math.round(y + row) - top,
        Math.max(1, thickness), 2, dx, Math.round(y + row), Math.max(1, thickness), 2);
    }
  }
}

function drawGravity(ctx: CanvasRenderingContext2D, world: World, g: GravityClap): void {
  const x = g.x * TILE, ground = g.y * TILE, y = ground - 60;
  ctx.save();
  if (!g.fired) {
    const charge = g.age / GRAVITY.charge, collapse = ease((g.age - 1.75) / 0.45);
    const radius = (12 + charge * 17) * ease(g.age / 0.4) * (1 - collapse * 0.88);
    refract(ctx, x, y, radius, charge * 2.5);
    for (let i = 0; i < 46; i++) {
      const n = noise(i, g.seed), start = n * 0.45, progress = ease((g.age - start) / (GRAVITY.charge - start));
      const a = noise(i, g.seed + 18) * TAU, r = (22 + n * 66) * (1 - progress);
      const px = x + Math.cos(a + progress * 0.3) * r, py = ground + Math.sin(a) * r - progress * 60;
      const height = progress * 60, alpha = ease((g.age - start) / 0.3) * (1 - collapse * 0.65);
      ctx.globalAlpha = alpha * 0.12; oval(ctx, '#292a24', px, py + height, 2, 1);
      if (i % 3 === 0) cloud(ctx, px, py + 2, 3 + n * 4, i + g.seed, alpha * 0.27);
      ctx.globalAlpha = alpha;
      const spin = progress * (2 + n * 4) + n * 5, length = 1 + n * 3;
      line(ctx, dust[i % 3], [px, py], [px + Math.cos(spin) * length, py + Math.sin(spin) * length], i % 7 ? 1 : 2);
      if (i % 7 === 0) pixel(ctx, dust[3], px, py);
    }
    for (const c of g.captives) airborneResident(ctx, world, c.id, gravityCaptivePose(g, c), g.age);
    // A faint condensation skin tightens around the mass in the last half second.
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4 + g.age * 0.2, n = noise(i, g.seed + 63);
      cloud(ctx, x + Math.cos(a) * radius, y + Math.sin(a) * radius * 0.85,
        (2 + n * 4) * (1 - collapse * 0.7), i + g.seed, charge ** 3 * 0.22);
    }
    if (collapse > 0) {
      ctx.globalAlpha = collapse * 0.85;
      oval(ctx, '#3b3730', x, y, 6 * (1 - collapse * 0.7), 5 * (1 - collapse * 0.7));
    }
  } else {
    const age = g.age - GRAVITY.charge, shock = 1 - ease(age / 0.5);
    const radius = 4 + age * 165;
    if (shock > 0) {
      refract(ctx, x, y, radius, shock * 3);
      for (let i = 0; i < 28; i++) {
        const n = noise(i, g.seed + 14), a = i * TAU / 28;
        cloud(ctx, x + Math.cos(a) * radius, y + Math.sin(a) * radius * 0.8,
          3 + n * 4 + age * 8, i + g.seed, shock * 0.42);
      }
    }
    // The suspended mass falls, while the ground front lifts separate clods of soil.
    for (let i = 0; i < 24; i++) {
      const n = noise(i, g.seed + 24), a = i * 2.4, r = age * (12 + n * 30);
      cloud(ctx, x + Math.cos(a) * r, Math.min(ground, y + age * age * 70) + Math.sin(a) * r * 0.5,
        3 + age * 6, i + g.seed, (1 - ease(age / 1.45)) * 0.3, g.blood > 0);
    }
    for (let i = 0; i < 44; i++) {
      const n = noise(i, g.seed + 82), a = i * 2.4, source = (0.25 + n * 0.7) * GRAVITY.radius * TILE;
      const flight = age - source / (GRAVITY.radius * TILE / GRAVITY.wave);
      if (flight <= 0) continue;
      const speed = 12 + n * 28, impact = speed / 80, time = Math.min(flight, impact);
      const r = source + time * (8 + n * 24), height = Math.max(0, speed * time - 80 * time * time);
      const px = x + Math.cos(a) * r, py = ground + Math.sin(a) * r - height;
      ctx.globalAlpha = (1 - ease((flight - impact) / 0.4)) * 0.9;
      const angle = a + flight * (3 + n * 5);
      line(ctx, dust[i % 3], [px, py], [px + Math.cos(angle) * (1 + n * 2), py + Math.sin(angle) * (1 + n * 2)], i % 5 ? 1 : 2);
    }
  }
  ctx.restore();
}

function drawBurst(ctx: CanvasRenderingContext2D, b: CataclysmBurst): void {
  const fade = Math.min(1, (CATACLYSMS.burstLife - b.age) / 0.4), count = b.kind === 'blood' ? 24 : 12;
  for (let i = 0; i < count; i++) {
    const n = noise(i, b.seed), a = noise(i, b.seed + 2) * TAU, velocity = 12 + n * 30;
    const impact = (velocity + Math.sqrt(velocity * velocity + 320 * b.z * TILE)) / 160;
    const time = Math.min(b.age, impact), distance = b.spread * TILE * (0.2 + n * 0.8);
    const r = (1 - Math.exp(-time * 2.5)) * distance;
    const x = b.x * TILE + Math.cos(a) * r, ground = b.y * TILE + Math.sin(a) * r * 0.65;
    const height = Math.max(0, b.z * TILE + velocity * time - 80 * time * time);
    const color = b.kind === 'blood' ? blood[i % 4] : dust[i % 4];
    ctx.globalAlpha = fade * (height > 0 ? 0.95 : 0.65);
    if (height > 0) {
      const vx = Math.cos(a) * distance * 2.5 * Math.exp(-time * 2.5);
      const vy = Math.sin(a) * distance * 1.625 * Math.exp(-time * 2.5) - velocity + 160 * time;
      const exposure = b.kind === 'blood' ? 0.025 : 0.015;
      line(ctx, color, [x, ground - height], [x - vx * exposure, ground - height - vy * exposure], i % 6 ? 1 : 2);
    } else {
      const landed = b.age - impact;
      pixel(ctx, color, x - 1, ground, i % 3 + 2, 1);
      if (b.kind === 'blood' && landed < 0.18) {
        const spread = landed * 15, lift = Math.sin(landed / 0.18 * Math.PI) * 2;
        for (const side of [-1, 1]) pixel(ctx, color, x + side * spread, ground - lift);
      }
    }
  }
}

export function drawCataclysms(ctx: CanvasRenderingContext2D, world: World): void {
  const state = cataclysms(world); if (!state) return;
  ctx.save();
  for (const t of state.tornadoes) drawTornado(ctx, world, t);
  for (const g of state.claps) drawGravity(ctx, world, g);
  for (const burst of state.bursts) drawBurst(ctx, burst);
  ctx.restore();
}

/** Only an on-screen clap shakes the camera; its impulse decays in simulation time. */
export function cataclysmShake(world: World, visible: (x: number, y: number) => boolean): { x: number; y: number } {
  let x = 0, y = 0;
  for (const g of cataclysms(world)?.claps ?? []) {
    const age = g.age - GRAVITY.charge;
    if (age < 0 || age > 0.4 || !visible(g.x, g.y)) continue;
    const force = (1 - age / 0.4) ** 2 * 4;
    x += Math.sin(age * 86 + g.seed) * force; y += Math.cos(age * 73 + g.seed) * force;
  }
  return { x: Math.round(Math.max(-6, Math.min(6, x))), y: Math.round(Math.max(-6, Math.min(6, y))) };
}
