import { KAIJU, kaijuBeam, kaijuPose, type KaijuJoint, type KaijuState } from '../content/kaiju';
import type { Vec2 } from '../core/types';
import { TILE } from './camera';

const skin = { outline: '#142932', dark: '#263e47', base: '#3d5c61', light: '#587b79', belly: '#95a488' };
const project = (p: KaijuJoint): Vec2 => ({ x: Math.round(p.x * TILE), y: Math.round((p.y - p.height) * TILE) });

function polygon(ctx: CanvasRenderingContext2D, color: string, points: Vec2[]): void {
  ctx.fillStyle = color;
  const low = Math.floor(Math.min(...points.map(p => p.y))), high = Math.max(...points.map(p => p.y));
  for (let y = low; y < high; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a.y <= y + 0.5 && b.y > y + 0.5) || (b.y <= y + 0.5 && a.y > y + 0.5)) xs.push(a.x + (y + 0.5 - a.y) * (b.x - a.x) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) ctx.fillRect(Math.round(xs[i]), y, Math.max(1, Math.round(xs[i + 1]) - Math.round(xs[i])), 1);
  }
}

function shape(ctx: CanvasRenderingContext2D, color: string, at: Vec2, points: number[][]): void {
  polygon(ctx, color, points.map(([x, y]) => ({ x: at.x + x, y: at.y + y })));
}

function oval(ctx: CanvasRenderingContext2D, color: string, p: Vec2, rx: number, ry: number): void {
  ctx.fillStyle = color;
  for (let y = -Math.ceil(ry); y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - y * y / (ry * ry))));
    ctx.fillRect(Math.round(p.x) - half, Math.round(p.y) + y, half * 2 + 1, 1);
  }
}

function segment(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, width: number, color: string, tip = width): void {
  const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = (b.y - a.y) / distance, ny = (a.x - b.x) / distance;
  polygon(ctx, color, [{ x: a.x + nx * width, y: a.y + ny * width }, { x: b.x + nx * tip, y: b.y + ny * tip },
    { x: b.x - nx * tip, y: b.y - ny * tip }, { x: a.x - nx * width, y: a.y - ny * width }]);
}

function limb(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, root: number, tip: number, far = false): void {
  segment(ctx, a, b, root + 2, skin.outline, tip + 2);
  oval(ctx, skin.outline, a, root + 2, root + 1); oval(ctx, skin.outline, b, tip + 2, tip + 1);
  segment(ctx, a, b, root, far ? skin.dark : skin.base, tip);
  oval(ctx, far ? skin.dark : skin.base, a, root, root - 1); oval(ctx, far ? skin.dark : skin.base, b, tip, tip - 1);
  segment(ctx, { x: a.x - 3, y: a.y - 2 }, { x: b.x - 2, y: b.y - 1 }, root * 0.45, far ? skin.base : skin.light, tip * 0.4);
  for (let i = 1; i < 4; i++) {
    const t = i / 4, x = Math.round(a.x + (b.x - a.x) * t), y = Math.round(a.y + (b.y - a.y) * t);
    ctx.fillStyle = far ? skin.outline : skin.dark; ctx.fillRect(x + 2, y, 3, 2);
    ctx.fillStyle = far ? skin.base : '#729086'; ctx.fillRect(x - 4, y - 2, 2, 1);
  }
}

function chargeAt(state: KaijuState, along: number): number {
  if (state.phase === 'beam') return 0.85 + Math.sin(state.age * 24 + along * 5) * 0.15;
  if (state.phase === 'recover') return Math.max(0, 1 - state.phaseTime / 0.7);
  return state.phase === 'charge' ? Math.max(0, Math.min(1, (state.phaseTime / KAIJU.charge - along * 0.65) / 0.3)) : 0;
}

function spine(ctx: CanvasRenderingContext2D, base: Vec2, size: number, lean: number, glow: number): void {
  const points = [[-size * 0.55, 2], [-size * 0.7, -size * 0.45], [-size * 0.35, -size * 0.38],
    [lean - size * 0.1, -size], [lean + size * 0.2, -size * 0.55], [size * 0.55, -size * 0.6], [size * 0.45, 2]];
  if (glow > 0) {
    ctx.save(); ctx.globalAlpha = glow * 0.2;
    shape(ctx, '#4dbfff', base, points.map(([x, y]) => [x * 1.3, y * 1.2])); ctx.restore();
  }
  shape(ctx, skin.outline, base, points);
  shape(ctx, glow > 0.5 ? '#54bbeb' : '#416b7e', base, points.map(([x, y]) => [x * 0.75, y * 0.87]));
  shape(ctx, glow > 0.5 ? '#c2f5ff' : '#719fa8', base, [[-1, 0], [lean, -size * 0.75], [2, -size * 0.2], [3, 1]]);
}

function tailPoints(p: Vec2, state: KaijuState): { at: Vec2; width: number }[] {
  const { joint } = kaijuPose(p, state);
  return Array.from({ length: 13 }, (_, i) => {
    const t = i / 12, sway = Math.sin(state.age * 1.8 - t * 4.8) * 2.3 * t + Math.sin(state.gait * Math.PI * 2) * t * 0.5;
    return { at: project(joint(-1.4 - t * 15, sway, 2.6 * (1 - t) + 0.2)), width: Math.max(1, 13 * (1 - t) ** 1.2) };
  });
}

function drawTail(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState): void {
  const points = tailPoints(p, state);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i], b = points[i + 1];
    segment(ctx, a.at, b.at, a.width + 2, skin.outline, b.width + 1);
    segment(ctx, a.at, b.at, a.width, skin.base, b.width);
    segment(ctx, { x: a.at.x, y: a.at.y - 3 }, { x: b.at.x, y: b.at.y - 2 }, a.width * 0.45, skin.light, b.width * 0.4);
    if (i % 2 === 0) spine(ctx, { x: a.at.x, y: a.at.y - a.width * 0.5 }, 5 + (1 - i / 12) * 8, -Math.cos(state.heading) * 5, chargeAt(state, (12 - i) / 24));
  }
}

export function drawKaijuGround(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState, water: boolean): void {
  ctx.save(); ctx.globalAlpha = 0.28;
  oval(ctx, '#102d39', { x: p.x * TILE + 5, y: p.y * TILE + 5 }, 36, 17);
  const tail = tailPoints(p, state);
  for (let i = 0; i < tail.length - 1; i++) {
    segment(ctx, { x: tail[i].at.x + 5, y: tail[i].at.y + 9 }, { x: tail[i + 1].at.x + 5, y: tail[i + 1].at.y + 7 }, tail[i].width, '#102d39', tail[i + 1].width);
  }
  if (water) for (let ring = 0; ring < 3; ring++) {
    const phase = (state.age * 0.6 + ring / 3) % 1;
    ctx.globalAlpha = (1 - phase) * 0.6; ctx.fillStyle = '#b4e9f5';
    for (let i = 0; i < 24; i++) {
      const angle = i * Math.PI / 12;
      ctx.fillRect(Math.round(p.x * TILE + Math.cos(angle) * (28 + phase * 25)), Math.round(p.y * TILE + Math.sin(angle) * (12 + phase * 17)), 5, 2);
    }
  }
  ctx.restore();
}

function drawLeg(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState, side: number, water: boolean, far: boolean): void {
  const pose = kaijuPose(p, state), foot = pose.feet.find(f => f.side === side)!;
  const forward = Math.cos(state.gait * Math.PI * 2 + (side < 0 ? Math.PI : 0)) * 1.25;
  const hip = project(pose.joint(-0.5, side * 1.7, 5.3 + pose.bob));
  const knee = project(pose.joint(1 + forward * 0.4, side * 2.6, 2.9 + foot.height * 0.5));
  const ankle = project(foot);
  limb(ctx, hip, knee, 15, 11, far); limb(ctx, knee, { x: ankle.x, y: ankle.y - 4 }, 10, 7, far);
  const footPoint = (f: number, s: number, z: number) => project(pose.joint(forward + f, side * 2.4 + s, foot.height + z));
  polygon(ctx, skin.outline, [footPoint(-0.8, -0.9, 0.2), footPoint(1.7, -1, 0.1), footPoint(2, 0.9, 0), footPoint(-0.7, 1, 0.1)]);
  polygon(ctx, far ? skin.base : skin.light, [footPoint(-0.6, -0.7, 0.5), footPoint(1.6, -0.8, 0.3), footPoint(1.7, 0.7, 0.2), footPoint(-0.6, 0.8, 0.3)]);
  for (const toe of [-0.6, 0, 0.6]) polygon(ctx, '#d0d3ac', [footPoint(1.2, toe - 0.2, 0.3), footPoint(2.5, toe, 0), footPoint(1.2, toe + 0.2, 0.3)]);
  if (state.stepIn > 0.1 && foot.height < 0.2) {
    const t = 1 - state.stepIn / KAIJU.step;
    ctx.save(); ctx.globalAlpha = (1 - t) * 0.7;
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.4;
      ctx.fillStyle = water ? (i % 2 ? '#9ce7fa' : '#ddf8ff') : (i % 2 ? '#b6ac88' : '#706f60');
      ctx.fillRect(Math.round(ankle.x + Math.cos(angle) * (6 + t * 20)), Math.round(ankle.y + Math.sin(angle) * t * 9 - Math.sin(t * Math.PI) * 12), 4, 3 + Math.floor(t * 3));
    }
    ctx.restore();
  }
}

function drawArm(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState, side: number, far: boolean): void {
  const pose = kaijuPose(p, state), swing = Math.sin(state.gait * Math.PI * 2 + side) * 0.4;
  const shoulder = project(pose.joint(0.3, side * 2.2, 9.1 + pose.bob));
  const elbow = project(pose.joint(1 + swing - pose.charge * 0.4, side * 3.3, 6.8 + pose.bob));
  const hand = project(pose.joint(2.6 + swing - pose.charge * 0.6, side * 2.8, 6.6 + pose.bob));
  limb(ctx, shoulder, elbow, 7, 5, far); limb(ctx, elbow, hand, 5, 4, far);
  for (let i = -1; i <= 1; i++) {
    const start = project(pose.joint(2.6 + swing - pose.charge * 0.6, side * 2.8 + i * 0.35, 6.6 + pose.bob));
    const tip = project(pose.joint(3.4 + swing - pose.charge * 0.6, side * 2.8 + i * 0.4, 6.05 + pose.bob));
    segment(ctx, start, tip, 1.6, '#c5cdb1', 0.4);
  }
}

function drawBack(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState): void {
  const { joint, bob } = kaijuPose(p, state);
  for (let i = 0; i < 6; i++) {
    const t = i / 5, at = project(joint(-3.4 + t * t * 2.8, 0, 4 + t * 8 + bob));
    spine(ctx, at, 24 - t * 8, -Math.cos(state.heading) * 12, chargeAt(state, 0.5 + t * 0.5));
  }
}

function drawHead(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState): void {
  const pose = kaijuPose(p, state), { headForward: f, headHeight: h } = pose;
  const at = (forward: number, side: number, height: number) => project(pose.joint(f + forward, side, h + height));
  const opening = state.phase === 'beam' ? 0.9 : state.phase === 'charge' ? 0.2 + pose.charge * 0.65 : 0.09 + Math.sin(state.age * 2) * 0.025;
  const near = Math.cos(state.heading) >= 0 ? 1 : -1;
  // The skull is projected as solid planes; the jaw opens downwards in every direction.
  polygon(ctx, skin.outline, [at(-1, -1.4, 1.2), at(1.7, -1.3, 1.5), at(3, -1, 0.9), at(3.5, -0.55, 0.6), at(3.5, 0.55, 0.6), at(3, 1, 0.9), at(1.7, 1.3, 1.5), at(-1, 1.4, 1.2), at(-1.2, 0, -0.7)]);
  polygon(ctx, skin.base, [at(-0.8, -1.2, 1.25), at(1.4, -1.2, 1.6), at(3.25, -0.8, 0.85), at(3.25, 0.8, 0.85), at(1.4, 1.2, 1.6), at(-0.8, 1.2, 1.25)]);
  polygon(ctx, skin.light, [at(-0.7, -1, 1.4), at(1.2, -1, 1.8), at(3.1, -0.65, 1.05), at(3.1, 0.2, 1.05), at(0.4, 0.4, 1.6)]);
  polygon(ctx, '#101e29', [at(-0.1, near * 1.2, 0.65), at(3.4, near * 0.9, 0.65), at(3.2, near * 0.9, -opening), at(0, near * 1.2, -0.35)]);
  polygon(ctx, skin.outline, [at(-0.5, -1, -0.1), at(3.3, -0.9, -opening), at(3.3, 0.9, -opening), at(-0.5, 1, -0.1), at(-0.6, 0, -0.8)]);
  polygon(ctx, '#788e7c', [at(-0.2, near * 1.05, -0.15), at(3.2, near * 0.85, -opening), at(3.1, near * 0.8, -opening - 0.35), at(-0.2, near * 0.95, -0.6)]);
  for (let i = 0; i < 5; i++) {
    const t = 0.5 + i * 0.5;
    polygon(ctx, '#e0e4bd', [at(t, near * 1.1, 0.55), at(t + 0.23, near * 1.1, 0.55), at(t + 0.15, near * 1.1, 0.12 - opening * 0.15)]);
  }
  for (const side of [-1, 1]) {
    const eye = at(0.9, side * 1.23, 1.05), brow = at(0.3, side * 1.15, 1.6);
    segment(ctx, brow, { x: eye.x + Math.cos(state.heading) * 6, y: eye.y - 2 }, 2.5, skin.outline);
    ctx.fillStyle = pose.charge > 0.5 ? '#b1f1ff' : '#ecb75d'; ctx.fillRect(eye.x - 2, eye.y - 1, 5, 2);
    ctx.fillStyle = '#182c35'; ctx.fillRect(eye.x + 1, eye.y - 1, 1, 2);
    const nostril = at(2.9, side * 0.7, 1.1); ctx.fillRect(nostril.x, nostril.y, 2, 1);
  }
  for (let i = 0; i < 8; i++) {
    const scale = at(-0.4 + i % 4 * 0.7, (i < 4 ? -0.5 : 0.5), 1.5 - i % 4 * 0.1);
    ctx.fillStyle = i % 2 ? '#314d56' : '#6e8b80'; ctx.fillRect(scale.x, scale.y, 2, 1);
  }
  if (pose.charge > 0) {
    const mouth = project(pose.mouth), glow = pose.charge * (0.9 + Math.sin(state.age * 31) * 0.1);
    ctx.save(); ctx.globalAlpha = glow * 0.3; oval(ctx, '#3bb7ff', mouth, 12, 9);
    ctx.globalAlpha = glow; oval(ctx, '#8ee7ff', mouth, 5, 3); oval(ctx, '#efffff', mouth, 2, 2); ctx.restore();
  }
}

export function drawKaiju(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState, water: boolean): void {
  ctx.save();
  const pose = kaijuPose(p, state), far = Math.cos(state.heading) >= 0 ? -1 : 1;
  drawTail(ctx, p, state); drawLeg(ctx, p, state, far, water, true); drawArm(ctx, p, state, far, true);
  if (Math.sin(state.heading) >= 0) drawBack(ctx, p, state);
  const body = project(pose.joint(-0.2, 0, 7.4 + pose.bob));
  shape(ctx, skin.outline, body, [[-17, -30], [-27, -17], [-29, 4], [-24, 24], [-14, 34], [12, 34], [24, 24], [28, 4], [25, -17], [15, -30]]);
  shape(ctx, skin.dark, body, [[-15, -28], [-25, -16], [-27, 3], [-22, 22], [-12, 31], [11, 31], [22, 22], [26, 3], [23, -16], [13, -28]]);
  shape(ctx, skin.base, body, [[-13, -27], [-23, -14], [-24, 3], [-20, 20], [-10, 28], [8, 26], [18, 15], [19, -9], [10, -26]]);
  shape(ctx, skin.light, body, [[-11, -24], [-21, -12], [-20, 1], [-13, 7], [-5, -6], [4, -24]]);
  if (Math.sin(state.heading) > -0.55) {
    const belly = { x: body.x + Math.cos(state.heading) * 9, y: body.y + Math.sin(state.heading) * 5 };
    shape(ctx, '#6f887b', belly, [[-8, -22], [-15, -9], [-14, 12], [-8, 24], [6, 26], [14, 12], [15, -8], [7, -22]]);
    for (let i = 0; i < 7; i++) {
      const w = 10 + Math.sin(i / 6 * Math.PI) * 3, y = -19 + i * 6;
      shape(ctx, skin.belly, belly, [[-w, y], [0, y + 1], [w - 1, y], [w - 2, y + 3], [0, y + 4], [-w + 1, y + 3]]);
    }
  }
  for (let i = 0; i < 27; i++) {
    const x = (i * 13 % 43) - 21, y = (i * 19 % 48) - 20;
    if (Math.sin(state.heading) > -0.55 && Math.abs(x - Math.cos(state.heading) * 9) < 12) continue;
    ctx.fillStyle = i % 3 ? '#29444c' : '#6a8982'; ctx.fillRect(body.x + x, body.y + y, 3, 2);
    ctx.fillStyle = '#81998d'; if (i % 4 === 0) ctx.fillRect(body.x + x, body.y + y - 1, 2, 1);
  }
  const neck = project(pose.joint(pose.headForward - 0.4, 0, pose.headHeight - 0.6));
  limb(ctx, project(pose.joint(0.3, 0, 9.4 + pose.bob)), neck, 15, 11);
  if (Math.sin(state.heading) < 0) drawBack(ctx, p, state);
  drawLeg(ctx, p, state, -far, water, false); drawArm(ctx, p, state, -far, false);
  drawHead(ctx, p, state);
  ctx.restore();
}

export function drawKaijuBeam(ctx: CanvasRenderingContext2D, p: Vec2, state: KaijuState, width: number, height: number): void {
  if (state.phase !== 'beam') return;
  const { from, to } = kaijuBeam(p, state), a = project(from), b = { x: to.x * TILE, y: to.y * TILE };
  ctx.save(); ctx.beginPath(); ctx.rect(0, -160, width * TILE, height * TILE + 160); ctx.clip();
  const fade = Math.min(1, state.phaseTime / 0.1 + 0.25, (KAIJU.beam - state.phaseTime) / 0.16), pulse = Math.sin(state.age * 38) * 1.5;
  ctx.globalAlpha = 0.18 * fade; segment(ctx, a, b, 12, '#4fbaff', 23 + pulse);
  ctx.globalAlpha = fade; segment(ctx, a, b, 5, '#2375cc', 13 + pulse);
  segment(ctx, a, b, 3.5, '#65caff', 9 + pulse); segment(ctx, a, b, 1.5, '#ebfcff', 4 + pulse * 0.4);
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
  for (let wave = 0; wave < 7; wave++) {
    const t = (state.age * 1.8 + wave / 7) % 1, radius = 3 + t * 11;
    for (let j = 0; j < 9; j++) {
      const across = (j - 4) / 4 * radius, ahead = Math.sin(j / 8 * Math.PI) * 5;
      ctx.fillStyle = '#b8efff'; ctx.fillRect(Math.round(a.x + dx * t + nx * across + dx / length * ahead), Math.round(a.y + dy * t + ny * across + dy / length * ahead), 2, 2);
    }
  }
  for (let i = 0; i < 22; i++) {
    const t = (state.age * 1.8 + i * 0.137) % 1, angle = i * 2.4;
    ctx.globalAlpha = (1 - t) * fade; ctx.fillStyle = ['#f1fcff', '#79d6ff', '#a4b6c5', '#6c7372'][i % 4];
    const size = 2 + Math.floor((1 - t) * 5);
    ctx.fillRect(Math.round(b.x + Math.cos(angle) * t * 35), Math.round(b.y + Math.sin(angle) * t * 18 - Math.sin(t * Math.PI) * 26), size, size);
  }
  ctx.globalAlpha = fade; oval(ctx, '#8ddcff', b, 12 + pulse, 6); oval(ctx, '#f1ffff', b, 7, 4);
  ctx.restore();
}
