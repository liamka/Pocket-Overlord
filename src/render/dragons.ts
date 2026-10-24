import { DRAGON, dragonAltitude, dragonBreathPose, dragonGroundPosition, type DragonState } from '../content/dragons';
import type { Vec2 } from '../core/types';
import { TILE } from './camera';

const FRAME_COUNT = 24;
const FRAME_SIZE = 160;
const DIRECTIONS = 32;
const DIRECTION_STEP = Math.PI * 2 / DIRECTIONS;
interface DragonFrame { sprite: HTMLCanvasElement; shadow: HTMLCanvasElement; mouth: Vec2 }
type Joint = { x: number; y: number; z: number };
const frames = new Map<number, DragonFrame>();

/** Scanline silhouettes keep the wings and scales on the same pixel grid as the world. */
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

function dragonFrame(frame: number, direction: number, breathing: boolean): DragonFrame {
  const key = (direction * FRAME_COUNT + frame) * 2 + Number(breathing);
  const existing = frames.get(key);
  if (existing) return existing;
  const sprite = document.createElement('canvas'), shadow = document.createElement('canvas');
  sprite.width = shadow.width = FRAME_SIZE; sprite.height = shadow.height = FRAME_SIZE;
  const ctx = sprite.getContext('2d')!, shadowCtx = shadow.getContext('2d')!;
  ctx.translate(FRAME_SIZE / 2, FRAME_SIZE / 2); shadowCtx.translate(FRAME_SIZE / 2, FRAME_SIZE / 2);
  const phase = frame / FRAME_COUNT, wave = phase * Math.PI * 2;
  // Hold the raised wings, drive a broad downstroke, then fold the wrists on recovery.
  const keys = [
    [0, 1.12, 0.18], [0.13, 0.98, 0], [0.38, -0.62, 0],
    [0.5, -0.78, 0.12], [0.7, 0.12, 0.72], [0.88, 1.04, 0.48], [1, 1.12, 0.18],
  ];
  const next = keys.findIndex(k => k[0] > phase), a = keys[next - 1], b = keys[next];
  const t = (phase - a[0]) / (b[0] - a[0]), eased = t * t * (3 - 2 * t);
  const lift = a[1] + (b[1] - a[1]) * eased, fold = a[2] + (b[2] - a[2]) * eased;
  const heading = direction * DIRECTION_STEP, cosine = Math.cos(heading), sine = Math.sin(heading);
  const facing = cosine < -1e-7 ? -1 : 1;
  // Mirror the profile when facing left so the horns and belly never turn upside down.
  const project = (p: Joint, ground = false): number[] => [p.x * cosine - p.y * facing * sine, p.x * sine + p.y * facing * cosine - (ground ? 0 : p.z)];
  const body = ([x, y]: number[]): Joint => {
    const neck = Math.max(0, (x - 10) / 23);
    const pitch = Math.sin(wave - 0.65) * 0.035;
    return { x: x - neck * (breathing ? 0 : 0.6), y: y * (1.45 - neck * 0.27) + Math.sin(wave - x * 0.055) * (1 - neck) * 0.6,
      z: Math.sin(wave - 0.7) * 1.5 * (1 - neck) + x * pitch * (1 - neck)
        + neck * (breathing ? -2.5 : Math.sin(wave - 1.1) * 0.65) };
  };
  const paint = (color: string, points: number[][], joint = body): void => {
    const posed = points.map(joint);
    polygon(ctx, color, posed.map(p => project(p)));
    polygon(shadowCtx, '#252f29', posed.map(p => project(p, true)));
  };
  const shape = (color: string, points: number[][]): void => paint(color, points);
  const r = (color: string, x: number, y: number, w: number, h: number): void => shape(color, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
  const wing = (side: number): void => {
    // The tips and membrane follow the shoulder with a small delay.
    const wrist = lift - Math.sin(wave - 0.6) * 0.3 - fold * 0.22;
    const joint = ([x, y]: number[]): Joint => {
      const distance = Math.max(0, y - 3), arm = Math.min(14, distance), fingers = Math.max(0, distance - 14);
      const trailing = Math.max(0, Math.min(1, (8 - x) / 32));
      return { x: x - fold * distance * 0.24 + Math.sin(wave - 0.6) * distance * 0.045,
        y: side * (3 + (Math.cos(lift) * arm + Math.cos(wrist) * fingers) * (1 - fold * 0.14)),
        z: body([4, 3]).z + Math.sin(lift) * arm + Math.sin(wrist) * fingers
          + Math.sin(wave - distance * 0.075) * trailing * fingers * 0.055 };
    };
    const w = (color: string, points: number[][]): void => paint(color, points, joint);
    w('#633229', [[8, 2], [12, 14], [3, 28], [-8, 40], [-14, 38], [-32, 33], [-24, 23], [-27, 15], [-17, 18], [-18, 9], [-8, 11], [-7, 2]]);
    w('#b74b2d', [[7, 4], [9, 14], [1, 27], [-9, 38], [-28, 32], [-20, 23], [-23, 17], [-14, 20], [-15, 11], [-5, 13], [-5, 4]]);
    w('#cfb98e', [[6, 9], [7, 15], [-10, 35], [-26, 32], [-18, 23], [-21, 19], [-12, 22], [-13, 13], [-4, 16], [-4, 7]]);
    w('#ead6aa', [[5, 11], [4, 17], [-11, 34], [-23, 32], [-13, 27]]);
    w('#a4482e', [[8, 6], [11, 14], [1, 29], [-9, 39], [-11, 37], [-1, 26], [7, 14]]);
    w('#a46140', [[5, 14], [-18, 24], [-26, 32], [-21, 30], [-15, 23], [3, 13]]);
    w('#b57750', [[5, 13], [-12, 21], [-13, 14], [-11, 18], [3, 12]]);
    w('#eecb96', [[9, 12], [14, 10], [12, 16], [9, 17]]);
  };
  const nearSide = cosine * facing >= 0 ? 1 : -1;
  wing(-nearSide);
  // The wave reaches the tail tip later than the hips; the root stays attached.
  const tail = ([x, y]: number[]): Joint => {
    const length = Math.max(0, (-x - 8) / 31), p = body([x, y]);
    p.y += Math.sin(wave - length * 2.8) * length * 5;
    p.z += Math.sin(wave - length * 2.2) * length * 2.8;
    return p;
  };
  paint('#663125', [[-1, -5], [-13, -4], [-22, 3], [-29, 6], [-36, 3], [-39, -3], [-39, 5], [-33, 11], [-25, 11], [-13, 4], [0, 6]], tail);
  paint('#bf492b', [[-1, -3], [-13, -2], [-23, 5], [-30, 8], [-36, 5], [-32, 10], [-26, 9], [-12, 2], [0, 4]], tail);
  paint('#ee8940', [[-5, -2], [-14, 0], [-25, 8], [-20, 6], [-11, 3], [-3, 2]], tail);
  for (const side of [-1, 1]) {
    const leg = ([x, y]: number[]): Joint => {
      const p = body([x, y]), toe = Math.max(0, (Math.abs(y) - 3) / 9);
      p.x -= toe * (2 + Math.sin(wave - 0.8)) * 1.5;
      p.y *= 1 - fold * 0.2; p.z -= toe * (2 + (1 - fold) * 2);
      return p;
    };
    paint('#773225', [[-5, side * 3], [-9, side * 10], [-3, side * 12], [0, side * 10], [-4, side * 8], [2, side * 4]], leg);
    paint('#e9c78b', [[-4, side * 10], [0, side * 10], [0, side * 12], [-4, side * 12]], leg);
  }
  shape('#673128', [[-13, -3], [-5, -7], [7, -5], [13, -1], [17, -6], [18, -10], [26, -10], [29, -6], [33, -5], [33, 1], [24, 3], [19, 1], [14, 6], [5, 7], [-5, 6]]);
  shape('#c84e2d', [[-11, -2], [-4, -6], [6, -4], [13, 1], [19, -5], [20, -9], [25, -9], [28, -4], [32, -4], [32, 0], [24, 2], [19, -1], [14, 4], [5, 6], [-4, 4]]);
  shape('#ed8240', [[-9, -2], [-3, -5], [6, -3], [13, 2], [20, -4], [20, -7], [24, -7], [25, -3], [20, 1], [14, 5], [5, 5], [-3, 2]]);
  shape('#f3b865', [[-5, 2], [4, 3], [13, 4], [19, -1], [20, 2], [14, 6], [5, 6], [-4, 4]]);
  for (let i = 0; i < 5; i++) shape('#f7d190', [[-14 + i * 5, -3], [-16 + i * 5, -7], [-11 + i * 5, -4]]);
  shape('#f4d596', [[19, -7], [16, -15], [21, -10], [23, -7]]);
  shape('#c8a776', [[24, -8], [24, -14], [27, -9]]);
  r('#752e26', 27, -1, 6, 1); r('#fff1ab', 25, -6, 3, 2); r('#382b25', 27, -6, 1, 2);
  r('#653025', 31, -4, 1, 1); r('#ffb45a', 21, -8, 3, 1); r('#ffe1a0', 30, 0, 1, 2);
  r('#9e3b27', -5, -3, 2, 2); r('#9e3b27', 0, -2, 2, 2); r('#ffac55', 3, 0, 2, 1);
  if (breathing) {
    shape('#4c2723', [[24, -1], [33, 0], [33, 5], [25, 3]]);
    shape('#c84e2d', [[23, 2], [31, 4], [34, 3], [32, 6], [25, 5]]);
    shape('#f3b865', [[25, 4], [32, 5], [31, 6], [25, 5]]);
    r('#ffe1a0', 28, -1, 1, 2); r('#ffe1a0', 31, 3, 1, 2);
  }
  wing(nearSide);
  const mouth = project(body([32, breathing ? 1 : -2]));
  const result = { sprite, shadow, mouth: { x: mouth[0], y: mouth[1] } };
  // Bound the directional poses while retaining all frames of several simultaneous flights.
  if (frames.size >= 128) frames.delete(frames.keys().next().value!);
  frames.set(key, result);
  return result;
}

function spritePose(time: number, heading: number, breathing: boolean) {
  const direction = (Math.round(heading / DIRECTION_STEP) % DIRECTIONS + DIRECTIONS) % DIRECTIONS;
  const frame = (Math.floor(time * DRAGON.wingBeat * FRAME_COUNT) % FRAME_COUNT + FRAME_COUNT) % FRAME_COUNT;
  const angle = heading - direction * DIRECTION_STEP;
  return { frame: dragonFrame(frame, direction, breathing), angle };
}

export function drawDragonSprite(ctx: CanvasRenderingContext2D, time: number, heading = 0, breathing = false): void {
  const pose = spritePose(time, heading, breathing);
  ctx.save(); ctx.rotate(pose.angle);
  ctx.drawImage(pose.frame.sprite, -FRAME_SIZE / 2, -FRAME_SIZE / 2);
  ctx.restore();
}

export function drawDragonShadow(ctx: CanvasRenderingContext2D, p: Vec2, heading: number, time: number, breathing = false): void {
  const pose = spritePose(time, heading, breathing);
  ctx.save(); ctx.translate(Math.round(p.x * TILE + 2), Math.round(p.y * TILE + 2));
  ctx.scale(0.78, 0.52); ctx.rotate(pose.angle);
  ctx.globalAlpha = 0.22;
  ctx.drawImage(pose.frame.shadow, -FRAME_SIZE / 2, -FRAME_SIZE / 2);
  ctx.restore();
}

/** Wide patches of fire sit on the soil and remain there after the dragon passes. */
export function drawDragonGroundFire(ctx: CanvasRenderingContext2D, p: Vec2, fuel: number, time: number, id: number): void {
  const x = Math.round(p.x * TILE), y = Math.round(p.y * TILE), strength = Math.min(1, fuel / 2);
  ctx.save(); ctx.translate(x, y);
  polygon(ctx, '#813c27', [[-11, -3], [-5, -6], [6, -5], [11, -2], [10, 4], [4, 6], [-7, 5], [-12, 1]]);
  ctx.globalAlpha = strength * 0.65;
  polygon(ctx, '#f56d29', [[-10, -2], [-5, -4], [5, -4], [10, -1], [8, 3], [-5, 4], [-10, 1]]);
  ctx.globalAlpha = strength;
  for (let i = 0; i < 5; i++) {
    const px = -8 + i * 4, py = Math.round(Math.sin(i * 7 + id) * 3);
    const height = Math.round((6 + (Math.sin(time * 15 + i * 3 + id) + 1) * 4) * strength);
    const lean = Math.round(Math.sin(time * 11 + id + i) * 2);
    ctx.fillStyle = '#e45e26'; ctx.fillRect(px - 3, py - height + 3, 6, height);
    ctx.fillStyle = '#ffac3c'; ctx.fillRect(px - 2, py - height + 1, 4, height);
    ctx.fillRect(px - 1 + lean, py - height - 2, 2, 4);
    ctx.fillStyle = '#fff0a0'; ctx.fillRect(px - 1, py - Math.round(height * 0.5), 2, Math.round(height * 0.5) + 1);
  }
  const smoke = (time * 0.7 + id * 0.31) % 1;
  ctx.globalAlpha = (1 - smoke) * 0.3 * strength; ctx.fillStyle = '#555c53';
  ctx.fillRect(Math.round(smoke * 7) - 2, -14 - Math.round(smoke * 18), 4 + Math.round(smoke * 4), 4 + Math.round(smoke * 4));
  ctx.restore();
}

export function drawDragon(ctx: CanvasRenderingContext2D, p: Vec2, dragon: DragonState, time: number): void {
  p = dragonGroundPosition(p, dragon);
  if (dragon.breath > 0) {
    const { frame, angle } = spritePose(time, dragon.heading, true);
    const mouth = dragonBreathPose(p, dragon.heading, time, 0);
    const mouthX = (Math.round(p.x * TILE) + frame.mouth.x * Math.cos(angle) - frame.mouth.y * Math.sin(angle)) / TILE;
    const mouthY = (Math.round((p.y - dragonAltitude(time)) * TILE) + frame.mouth.x * Math.sin(angle) + frame.mouth.y * Math.cos(angle)) / TILE;
    const jet = (progress: number): Vec2 => {
      const q = dragonBreathPose(p, dragon.heading, time, progress);
      return { x: q.x + (mouthX - mouth.x) * (1 - progress), y: q.y + (mouthY - mouth.y) * (1 - progress) };
    };
    // Individual incandescent puffs travel out of the jaw and fan down to the ground.
    const emitted = Math.min(1, (DRAGON.breathSeconds - dragon.breath) / 0.28);
    const end = jet(1), dx = end.x - mouthX, dy = end.y - mouthY, length = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < 18; i++) {
      const progress = (time * 3.6 + i / 18) % 1;
      if (progress > emitted) continue;
      const q = jet(progress), spread = Math.sin(i * 7.13) * progress ** 1.4 * 7;
      const x = Math.round(q.x * TILE - dy / length * spread);
      const y = Math.round(q.y * TILE + dx / length * spread);
      const size = 1 + Math.floor(progress * 3.8), corner = Math.max(1, Math.floor(size / 2));
      polygon(ctx, '#d45125', [[x - size + corner, y - size], [x + size - corner, y - size],
        [x + size, y - size + corner], [x + size, y + size - corner], [x + size - corner, y + size],
        [x - size + corner, y + size], [x - size, y + size - corner], [x - size, y - size + corner]]);
      ctx.fillStyle = '#ffbd3f'; ctx.fillRect(x - size + 1, y - size + 1, Math.max(1, size * 2 - 2), Math.max(1, size * 2 - 2));
      ctx.fillStyle = '#fff09b'; ctx.fillRect(x - size + 1, y - size + 1, Math.max(1, size * 2 - 2), 1);
      ctx.fillRect(x - size + 1, y - size + 1, 1, Math.max(1, size * 2 - 2));
      if (size > 2) { ctx.fillStyle = '#ee7b25'; ctx.fillRect(x - 1, y - 1, 2, 2); }
      else { ctx.fillStyle = '#fff4c4'; ctx.fillRect(x, y, 1, 1); }
    }
  }
  ctx.save(); ctx.translate(Math.round(p.x * TILE), Math.round((p.y - dragonAltitude(time)) * TILE));
  drawDragonSprite(ctx, time, dragon.heading, dragon.breath > 0);
  ctx.restore();
}
