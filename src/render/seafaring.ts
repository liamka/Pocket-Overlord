import type { Entity } from '../core/types';
import type { ShipState } from '../core/seafaring';
import { harborBerth } from '../core/seafaring';
import { bundleSize } from '../core/resources';
import { TILE } from './camera';

type Point = readonly [number, number];
type Vertex = readonly [number, number, number];
const rect = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number): void => {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
};
/** Scanline fills retain crisp pixels when a sail bends or the hull changes bearing. */
function polygon(ctx: CanvasRenderingContext2D, color: string, points: readonly Point[]): void {
  ctx.fillStyle = color;
  const min = Math.ceil(Math.min(...points.map(p => p[1]))), max = Math.floor(Math.max(...points.map(p => p[1])));
  for (let y = min; y <= max; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) ctx.fillRect(Math.round(xs[i]), y, Math.max(1, Math.round(xs[i + 1]) - Math.round(xs[i])), 1);
  }
}
function line(ctx: CanvasRenderingContext2D, color: string, a: Point, b: Point, width = 1): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1])));
  for (let i = 0; i <= steps; i++) rect(ctx, color, a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, width, width);
}

export function shipPose(time: number, heading: number, speed: number, turn = 0) {
  return { bob: Math.sin(time * 2.8) * 0.65 + Math.sin(time * 4.1 + 1) * 0.25,
    roll: Math.sin(time * 2.8 + 0.5) * 0.035 + turn * speed * 0.025,
    pitch: Math.sin(time * 2.1 + heading) * 0.025,
    flutter: Math.sin(time * 6.2) * 0.7 + Math.sin(time * 10.3) * 0.25 };
}

/** The hull turns on the water plane; masts remain upright in every direction. */
export function drawShipSprite(ctx: CanvasRenderingContext2D, time: number, heading = 0, kind: ShipState['kind'] = 'fishing', sail = 1, speed = 2, turn = 0, color = '#639cc0', cargo = 0, fishing = false): void {
  const pose = shipPose(time, heading, speed, turn), cos = Math.cos(heading), sin = Math.sin(heading);
  const large = kind === 'trade', length = large ? 20 : 14, beam = large ? 7 : 5;
  const project = (x: number, y: number, z: number): Point => {
    const forward = x + z * pose.pitch, across = y + z * pose.roll;
    return [cos * forward - sin * across, sin * forward + cos * across - z - pose.bob - x * pose.pitch - y * pose.roll];
  };
  const poly = (color: string, points: Vertex[]): void => polygon(ctx, color, points.map(p => project(...p)));
  const rope = (color: string, a: Vertex, b: Vertex, width = 1): void => line(ctx, color, project(...a), project(...b), width);
  const hull: Vertex[] = [[-length, -beam * 0.65, 2], [-length + 3, -beam, 2], [length - 6, -beam, 2], [length + 2, 0, 3],
    [length - 6, beam, 2], [-length + 3, beam, 2], [-length, beam * 0.65, 2]];
  polygon(ctx, '#173e5c65', hull.map(([x, y]) => [cos * x - sin * y + 2, sin * x + cos * y + 3]));
  // Straked sides and a raised gunwale frame the lighter plank deck.
  poly('#3d3029', hull.map(([x, y, z]) => [x, y, z - 1]));
  poly('#6e422c', hull.map(([x, y, z]) => [x, y, z + 1]));
  poly('#b98247', hull.map(([x, y, z]) => [x * 0.94, y * 0.84, z + 3]));
  poly('#d5ac6e', hull.map(([x, y, z]) => [x * 0.85, y * 0.68, z + 3]));
  for (let x = -length + 4; x < length - 5; x += 4) rope('#a77c49', [x, -beam * 0.65, 5], [x, beam * 0.65, 5]);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    rope(i > 2 ? '#ecc384' : '#9b693e', [a[0], a[1], 6], [b[0], b[1], 6]);
  }
  for (let x = -length + 3; x < length - 5; x += 5) {
    const side = cos >= 0 ? beam : -beam;
    rope('#5d3e2c', [x, side, 2], [x, side, 5]);
  }
  rope('#5b3b2a', [length - 3, 0, 5], [length + 5, 0, 7]);
  if (large) {
    poly('#7b5235', [[-17, -4, 5], [-8, -4, 5], [-8, 4, 5], [-17, 4, 5]]);
    poly('#c7a36a', [[-17, -4, 10], [-8, -4, 10], [-8, 4, 10], [-17, 4, 10]]);
    poly(color, [[-18, -5, 11], [-7, -5, 11], [-7, 5, 11], [-18, 5, 11]]);
    for (const x of [-15, -11]) { const q = project(x, cos > 0 ? 4.2 : -4.2, 7); rect(ctx, '#ffdc88', q[0], q[1], 2, 2); }
  }
  if (cargo > 0) {
    for (let n = 0; n < Math.ceil(cargo / 8); n++) {
      const x = -4 + n * 4, y = large ? 3 : 0;
      poly('#725137', [[x, y, 5], [x + 3, y, 5], [x + 3, y + 3, 5], [x, y + 3, 5]]);
      poly('#c39c60', [[x, y, 8], [x + 3, y, 8], [x + 3, y + 3, 8], [x, y + 3, 8]]);
      rope('#e2c389', [x + 1, y, 8], [x + 1, y + 3, 8]);
    }
  }
  const crew = project(large ? -13 : -8, -1, large ? 12 : 6);
  rect(ctx, '#334953', crew[0], crew[1] - 3, 2, 3); rect(ctx, '#eac496', crew[0], crew[1] - 5, 2, 2);
  const mast = (x: number, height: number, width: number, offset: number): void => {
    rope('#4c392a', [x, 0, 5], [x, 0, height + 3], 2);
    rope('#dab879', [x, 0, 6], [x, 0, height + 2]);
    rope('#71634c', [x, 0, height - 1], [-length + 2, -beam + 1, 6]);
    rope('#71634c', [x, 0, height - 1], [length - 3, beam - 1, 6]);
    const yardAngle = -heading + 0.2 + Math.sin(time * 1.2 + offset) * 0.09;
    const ax = Math.cos(yardAngle), ay = Math.sin(yardAngle);
    const surface = (u: number, v: number): Vertex => {
      const depth = 2 + 15 * sail, belly = Math.sin(v * Math.PI) * (1.5 + sail * 2.5);
      const flutter = pose.flutter * v * v * sail;
      return [x + ax * u + cos * belly, ay * u + sin * belly, height - v * depth + flutter + Math.sin(u * 0.35 + time * 4 + offset) * v * 0.45];
    };
    const rows = 9;
    for (let row = 0; row < rows; row++) {
      const v = row / rows, next = (row + 1) / rows, half = width * (1 - 0.18 * v), lower = width * (1 - 0.18 * next);
      poly(row < 2 ? '#fffae5' : row < 6 ? '#eee5c7' : '#bfc9ba', [surface(-half, v), surface(half, v), surface(lower, next), surface(-lower, next)]);
      const seam = width * 0.35;
      rope('#d3d4ba', surface(seam, v), surface(seam, next));
    }
    rope('#796044', [x - ax * (width + 1), -ay * (width + 1), height + 1], [x + ax * (width + 1), ay * (width + 1), height + 1]);
    const flag = project(x, 0, height + 3);
    for (let i = 0; i < 7; i++) rect(ctx, color, flag[0] + i, flag[1] - 3 + Math.sin(time * 7 - i * 0.7 + offset), 1, 3 - Math.floor(i / 3));
  };
  // Draw the farther mast first so rigging and canvas overlap naturally in turns.
  const masts = large ? [{ x: -4, h: 31, w: 8, o: 0 }, { x: 9, h: 25, w: 6, o: 1.6 }] : [{ x: 1, h: 26, w: 7, o: 0 }];
  masts.sort((a, b) => sin * (a.x - b.x));
  for (const m of masts) mast(m.x, m.h, m.w, m.o);
  if (fishing) {
    const swing = Math.sin(time * 1.7) * 1.2;
    rope('#b3996a', [-7, beam, 7], [-11, beam + 8, 1]);
    poly('#7badae70', [[-13, beam + 5, 0], [-5, beam + 5, 0], [-3 + swing, beam + 13, 0], [-15 + swing, beam + 13, 0]]);
    for (let n = 0; n < 4; n++) rope('#b0c9ba', [-13 + n * 2.5, beam + 5, 0], [-15 + n * 4 + swing, beam + 13, 0]);
  }
  // Broken white pixels hug the bow; their phase advances with water rather than heading.
  if (speed > 0.2) for (const side of [-1, 1]) {
    const phase = (time * 2.4 + side * 0.25) % 1;
    const a = project(length - 4 - phase * 5, side * (beam + phase * 2), -0.5);
    line(ctx, '#e3f5e1', a, [a[0] - cos * 3, a[1] - sin * 3]);
  }
}

export function drawShipWake(ctx: CanvasRenderingContext2D, entity: Entity): void {
  const ship = entity.components.ship!;
  for (const mark of ship.wake) {
    const fade = 1 - mark.age / 3, span = 3 + mark.age * 5, cos = Math.cos(mark.heading), sin = Math.sin(mark.heading);
    const x = mark.x * TILE - cos * 13, y = mark.y * TILE - sin * 13;
    ctx.save(); ctx.globalAlpha *= fade * 0.38;
    for (const side of [-1, 1]) {
      const a: Point = [x - sin * span * side, y + cos * span * side];
      line(ctx, '#d1f1e5', a, [a[0] - cos * 3, a[1] - sin * 3]);
    }
    ctx.restore();
  }
}

export function drawShip(ctx: CanvasRenderingContext2D, entity: Entity, time: number, color?: string): void {
  const ship = entity.components.ship!, p = entity.components.position!;
  const voyage = entity.components.foreignVoyage;
  const cargo = voyage ? Math.min(24, bundleSize(voyage.goods) + bundleSize(voyage.purchases)) : ship.cargo;
  ctx.save(); ctx.translate(Math.round(p.x * TILE), Math.round(p.y * TILE));
  drawShipSprite(ctx, time + entity.id * 0.73, ship.heading, ship.kind, ship.sail, ship.speed, ship.turn, color, cargo, ship.phase === 'fishing');
  ctx.restore();
}

export function drawHarborSprite(ctx: CanvasRenderingContext2D, time: number, direction = 0, color = '#639cc0', built = 1): void {
  const angle = direction * Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle);
  const ground = (x: number, y: number, z = 0): Point => [cos * x - sin * y, sin * x + cos * y - z];
  const deck = (x: number, y: number, w: number, h: number): void => {
    polygon(ctx, '#264f6280', [ground(x + 2, y + 2, -3), ground(x + w + 2, y + 2, -3), ground(x + w + 2, y + h + 2, -3), ground(x + 2, y + h + 2, -3)]);
    polygon(ctx, '#513e2e', [ground(x, y), ground(x + w, y), ground(x + w, y + h), ground(x, y + h)]);
    for (let plank = x + 1; plank < x + w; plank += 3) polygon(ctx, plank % 2 ? '#b58b55' : '#c6a16a', [ground(plank, y + 1, 2), ground(Math.min(x + w - 1, plank + 2), y + 1, 2), ground(Math.min(x + w - 1, plank + 2), y + h - 1, 2), ground(plank, y + h - 1, 2)]);
  };
  deck(-9, -12, 19, 25);
  if (built > 0.15) deck(8, -4, 22 * Math.min(1, built * 2), 9);
  if (built > 0.4) deck(26, -14, 7, 29);
  for (const [x, y] of [[-9, -12], [-9, 12], [9, -12], [9, 12], [29, -13], [29, 13]]) {
    if (x > 20 && built < 0.4) continue;
    const p = ground(x, y); rect(ctx, '#59422e', p[0] - 1, p[1] - 5, 3, 9); rect(ctx, '#e1bd7b', p[0] - 1, p[1] - 6, 3, 2);
    const foam = Math.floor(time * 3 + x) % 3; rect(ctx, '#9cd8d9a0', p[0] - 2 - foam, p[1] + 5, 3, 1);
  }
  if (built < 0.7) {
    rect(ctx, '#c3975d', -8, -9, 15, 3); rect(ctx, '#6c5037', -5, -15, 2, 20); rect(ctx, '#6c5037', 6, -15, 2, 20);
    return;
  }
  // Buildings stay upright for every coastline orientation; only the piers rotate.
  const hut = ground(0, 4), tower = ground(0, -9);
  const paintHut = (): void => {
    const [x, y] = hut;
    rect(ctx, '#6d6653', x - 8, y - 14, 16, 17); rect(ctx, '#c6b88c', x - 6, y - 13, 12, 14);
    rect(ctx, '#4a493b', x - 2, y - 7, 4, 10); rect(ctx, '#eee2ac', x + 4, y - 10, 2, 4);
    polygon(ctx, '#2c4e61', [[x - 11, y - 13], [x, y - 26], [x + 11, y - 13]]);
    polygon(ctx, color, [[x - 9, y - 15], [x, y - 24], [x + 8, y - 15]]);
    line(ctx, '#a9ccd0', [x, y - 24], [x + 8, y - 15]);
    rect(ctx, '#dccd9b', x - 3, y - 16, 6, 5); rect(ctx, '#35494d', x - 1, y - 15, 2, 3);
  };
  const paintTower = (): void => {
    const [x, y] = tower;
    rect(ctx, '#5c6158', x - 4, y - 31, 9, 32); rect(ctx, '#b4b598', x - 3, y - 30, 6, 29); rect(ctx, '#ddd6af', x - 3, y - 30, 2, 29);
    for (let n = 0; n < 4; n++) rect(ctx, '#8b927e', x, y - 8 - n * 5, 3, 1);
    rect(ctx, '#3a4d51', x - 5, y - 33, 11, 7); rect(ctx, '#f3d78c', x - 3, y - 32, 6, 4);
    rect(ctx, Math.sin(time * 1.4) > 0 ? '#fff0b7' : '#e5bc70', x - 2, y - 31, 4, 3);
    polygon(ctx, '#52778b', [[x - 6, y - 34], [x, y - 41], [x + 6, y - 34]]);
    rect(ctx, '#2f4347', x, y - 45, 1, 5);
  };
  if (tower[1] < hut[1]) { paintTower(); paintHut(); } else { paintHut(); paintTower(); }
  const supplies = ground(12, 1);
  rect(ctx, '#674b33', supplies[0], supplies[1] - 5, 5, 6); rect(ctx, '#c7a36c', supplies[0] + 1, supplies[1] - 5, 3, 5);
  rect(ctx, '#6c7974', supplies[0], supplies[1] - 2, 5, 1);
  const flag = ground(7, -8);
  rect(ctx, '#5c4d3a', flag[0], flag[1] - 29, 1, 22);
  for (let i = 0; i < 9; i++) rect(ctx, color, flag[0] + i + 1, flag[1] - 29 + Math.sin(time * 5 - i * 0.55), 1, 5);
}

export function drawHarbor(ctx: CanvasRenderingContext2D, entity: Entity, time: number, color?: string): void {
  const p = entity.components.position!, harbor = entity.components.harbor!;
  ctx.save(); ctx.translate(Math.round(p.x * TILE), Math.round(p.y * TILE));
  drawHarborSprite(ctx, time + entity.id * 0.21, harbor.direction, color, harbor.built);
  ctx.restore();
}

export function drawMooring(ctx: CanvasRenderingContext2D, ship: Entity, harbor: Entity): void {
  if (ship.components.ship!.phase !== 'docked') return;
  const p = ship.components.position!, berth = harborBerth(harbor);
  if (Math.hypot(p.x - berth.x, p.y - berth.y) > 1) return;
  const shore = harbor.components.position!, dx = berth.x - shore.x, dy = berth.y - shore.y;
  const tie: Point = [(shore.x + dx * 0.68) * TILE, (shore.y + dy * 0.68) * TILE - 3];
  line(ctx, '#c3b18b', tie, [p.x * TILE, p.y * TILE - 3]);
}
