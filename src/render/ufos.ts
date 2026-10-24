import { UFO, ufoPose, type UfoState } from '../content/ufos';
import type { Vec2 } from '../core/types';
import { TILE } from './camera';

/** Rasterize every contour on the world pixel grid, including the banked hull. */
function polygon(ctx: CanvasRenderingContext2D, color: string, points: number[][]): void {
  ctx.fillStyle = color;
  const ys = points.map(p => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y < Math.max(...ys); y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a[1] <= y + 0.5 && b[1] > y + 0.5) || (b[1] <= y + 0.5 && a[1] > y + 0.5)) {
        xs.push(a[0] + (y + 0.5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) ctx.fillRect(Math.round(xs[i]), y, Math.max(1, Math.round(xs[i + 1]) - Math.round(xs[i])), 1);
  }
}

function oval(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry: number, bank = 0): void {
  polygon(ctx, color, Array.from({ length: 24 }, (_, i) => {
    const angle = i * Math.PI / 12, dx = Math.cos(angle) * rx;
    return [x + dx, y + Math.sin(angle) * ry + dx * bank];
  }));
}

export function drawUfoSprite(ctx: CanvasRenderingContext2D, time: number, bank = 0, pitch = 0, charge = 0): void {
  const shape = (color: string, points: number[][]): void => polygon(ctx, color, points.map(([x, y]) => [x, y + x * bank]));
  const pixel = (color: string, x: number, y: number, w = 2, h = 1): void => {
    ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y + x * bank), w, h);
  };
  const depth = 1 + pitch;
  // A heavy underside, a beveled silver rim and a glass dome read at normal map zoom.
  oval(ctx, '#263e4c', 0, 2, 19, 7 * depth, bank);
  oval(ctx, '#3c5365', 0, 2, 17, 5 * depth, bank);
  oval(ctx, '#516e82', 0, 0, 20, 6 * depth, bank);
  oval(ctx, '#8ca9b5', -1, -2, 18, 4 * depth, bank);
  oval(ctx, '#bbd0ca', -2, -3, 15, 2.5 * depth, bank);
  oval(ctx, '#677f8e', 0, -3, 11, 3 * depth, bank);
  // Rim windows orbit in depth; the rear row is naturally occluded by the canopy.
  for (let i = 0; i < 10; i++) {
    const angle = time * 2.8 + i * Math.PI / 5, front = Math.sin(angle);
    const x = Math.cos(angle) * 16, y = front * 4 * depth - 1;
    pixel(front > 0 ? '#d4efb0' : '#8cae9c', x - 1, y, front > 0 ? 3 : 2, front > 0 ? 2 : 1);
    if (front > 0.3) pixel('#668b52', x, y + 2, 2, 1);
  }
  shape('#344d46', [[-10, -4], [-9, -9], [-6, -14], [4, -15], [8, -11], [10, -4]]);
  shape('#587c4b', [[-8, -5], [-7, -10], [-4, -13], [3, -14], [6, -11], [8, -5]]);
  shape('#86b95a', [[-7, -5], [-6, -10], [-3, -12], [2, -12], [5, -10], [6, -5]]);
  shape('#b9e87d', [[-6, -6], [-5, -10], [-2, -12], [0, -12], [-1, -8], [-2, -5]]);
  pixel('#eff6be', -4, -11, 3, 2); pixel('#d2ee9c', -6, -8, 2, 2);
  pixel('#416b4b', 3, -9, 2, 4); pixel('#729b51', 1, -5, 5, 1);
  oval(ctx, '#b5c7bd', 0, -3, 10, 1.5, bank);
  for (const x of [-10, 0, 10]) pixel('#b7df82', x - 1, 6 - Math.abs(x) * 0.1, 2, 2);
  const glow = 2 + charge * 3;
  oval(ctx, charge > 0 ? '#80c943' : '#455e4e', 0, 5, glow + 1, 2);
  if (charge > 0) {
    oval(ctx, '#cffb75', 0, 5, glow, 1.5);
    pixel('#f3ffd0', -1, 4, 2, 2);
  }
}

export function drawUfoGround(ctx: CanvasRenderingContext2D, p: Vec2, state: UfoState): void {
  const pose = ufoPose(p, state), x = Math.round(pose.ground.x * TILE), y = Math.round(pose.ground.y * TILE);
  ctx.save();
  ctx.globalAlpha = 0.1; oval(ctx, '#192e38', x + 4, y + 3, 22, 9);
  ctx.globalAlpha = 0.18; oval(ctx, '#192e38', x + 4, y + 3, 17, 6);
  if (pose.strength > 0 && pose.extension === 1) {
    ctx.globalAlpha = pose.strength * 0.25;
    oval(ctx, '#aff644', x, y, 14, 7);
    ctx.globalAlpha = pose.strength * 0.6;
    oval(ctx, '#c5fc69', x, y, 8, 3);
  }
  ctx.restore();
}

export function drawUfo(ctx: CanvasRenderingContext2D, p: Vec2, state: UfoState): void {
  const pose = ufoPose(p, state), x = Math.round(pose.ground.x * TILE), groundY = Math.round(pose.ground.y * TILE);
  const sourceY = Math.round(pose.emitter.y * TILE), tipY = Math.round(pose.tip.y * TILE);
  ctx.save();
  if (state.phase === 'charge') {
    // Gathering motes anticipate the shot before its first damaging frame.
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7 + pose.time * 3, radius = (1 - pose.charge) * 15 + 3;
      ctx.globalAlpha = pose.charge; ctx.fillStyle = i % 2 ? '#a1ed53' : '#e4ff9c';
      ctx.fillRect(Math.round(x + Math.cos(angle) * radius), Math.round(sourceY + Math.sin(angle) * radius * 0.5), 2, 2);
    }
  }
  if (state.phase === 'beam') {
    const length = tipY - sourceY, collapse = 1 - pose.strength;
    // Opaque pixel cores inside translucent edges preserve the reference's vivid green column.
    for (let layer = 0; layer < 4; layer++) {
      ctx.globalAlpha = [0.16, 0.85, 1, 0.9][layer] * pose.strength;
      ctx.fillStyle = ['#96ef32', '#54bc32', '#98ed3f', '#d6fa79'][layer];
      for (let y = 0; y < length; y++) {
        const t = y / Math.max(1, length), flicker = Math.sin(y * 0.36 - pose.time * 31);
        const width = Math.max(1, Math.round((3 + t * 3 + flicker * 0.7) * [1.8, 1, 0.65, 0.25][layer] * (1 - collapse * 0.7)));
        if (collapse > 0.25 && Math.sin(y * 0.7 + pose.time * 24) < collapse - 0.45) continue;
        const drift = layer === 3 ? Math.round(Math.sin(t * 9 - pose.time * 16)) : 0;
        ctx.fillRect(x - width + drift, sourceY + y, width * 2, 1);
      }
    }
    if (pose.extension === 1) {
      ctx.globalAlpha = pose.strength;
      oval(ctx, '#58c333', x, groundY, 8, 4);
      oval(ctx, '#b5f55d', x, groundY - 1, 5, 3);
      const flash = Math.max(0, 1 - (state.phaseTime - UFO.contact) / 0.22);
      if (flash > 0) {
        ctx.globalAlpha = flash;
        oval(ctx, '#f4ffb2', x, groundY - 1, 7 + (1 - flash) * 12, 3 + (1 - flash) * 4);
      }
    }
    for (let i = 0; i < 9; i++) {
      const progress = (pose.time * 1.3 + i * 0.137) % 1;
      ctx.globalAlpha = pose.strength * (1 - progress); ctx.fillStyle = i % 2 ? '#d6fa79' : '#79d33f';
      ctx.fillRect(Math.round(x + Math.sin(i * 9 + pose.time * 4) * (6 + progress * 4)), Math.round(tipY - progress * length), 1 + i % 2, 3);
    }
  }
  if (state.phase === 'recover') {
    const fade = 1 - state.phaseTime / UFO.recover;
    for (let i = 0; i < 10; i++) {
      ctx.globalAlpha = fade * 0.8; ctx.fillStyle = i % 3 ? '#a5eb5d' : '#eff9b1';
      ctx.fillRect(Math.round(x + Math.sin(i * 7) * (3 + state.phaseTime * 8)),
        Math.round(sourceY + (groundY - sourceY) * (i / 10) + state.phaseTime * 18), 2, 2 + i % 3);
    }
  }
  ctx.globalAlpha = 1;
  ctx.translate(x, Math.round((pose.ground.y - pose.altitude) * TILE));
  drawUfoSprite(ctx, pose.time, pose.bank, pose.pitch, pose.charge);
  ctx.restore();
}
