import { noise } from '../core/random';
import type { World } from '../core/world';
import { VOLCANO, bombPose, geohazards, poolRadius, type Pool, type Volcano } from '../core/geohazards';
import { TILE } from './camera';

type Point = readonly [number, number];
const TAU = Math.PI * 2;
function polygon(ctx: CanvasRenderingContext2D, color: string, points: readonly Point[]): void {
  ctx.fillStyle = color; ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(Math.round(x), Math.round(y)) : ctx.moveTo(Math.round(x), Math.round(y)));
  ctx.closePath(); ctx.fill();
}
function oval(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, rx: number, ry = rx): void {
  ctx.fillStyle = color;
  for (let row = -Math.ceil(ry); row <= Math.ceil(ry); row++) {
    const width = Math.sqrt(Math.max(0, 1 - row * row / (ry * ry))) * rx;
    ctx.fillRect(Math.round(x - width), Math.round(y + row), Math.max(1, Math.round(width * 2)), 1);
  }
}
function line(ctx: CanvasRenderingContext2D, color: string, points: readonly Point[], width = 1): void {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(Math.round(x), Math.round(y)) : ctx.moveTo(Math.round(x), Math.round(y))); ctx.stroke();
}
function poolShape(ctx: CanvasRenderingContext2D, pool: Pool, color: string, scale: number): void {
  const radius = poolRadius(pool) * TILE * scale;
  polygon(ctx, color, Array.from({ length: 18 }, (_, i): Point => {
    const angle = i * TAU / 18, r = radius * (0.86 + noise(i, pool.seed) * 0.14);
    return [pool.x * TILE + Math.cos(angle) * r, pool.y * TILE + Math.sin(angle) * r];
  }));
}

export function drawGeohazardGround(ctx: CanvasRenderingContext2D, world: World): void {
  const state = geohazards(world); if (!state) return;
  ctx.save();
  for (const [lava, pools] of [[false, state.acid], [true, state.lava]] as const) {
    // Paint each layer across the whole liquid: neighboring deposits form a continuous flow.
    for (const layer of [0, 1, 2]) for (const pool of pools) {
      const cool = lava && pool.remaining < 4;
      ctx.globalAlpha = Math.min(1, pool.remaining);
      const colors = lava ? ['#423c32', cool ? '#555046' : '#ab4828', cool ? '#79543b' : '#e57a32'] : ['#46523a', '#78923d', '#a0b253'];
      poolShape(ctx, pool, colors[layer], [1.08, 0.98, 0.8][layer]);
    }
    for (const pool of pools) {
      const radius = poolRadius(pool) * TILE, cool = lava && pool.remaining < 4;
      ctx.globalAlpha = Math.min(1, pool.remaining);
      if (lava) {
        for (let i = 0; i < (pool.radius < 1.2 ? 2 : 5); i++) {
          const angle = noise(i, pool.seed + 1) * TAU, r = noise(i, pool.seed + 3) * radius * 0.65;
          const x = pool.x * TILE + Math.cos(angle) * r, y = pool.y * TILE + Math.sin(angle) * r;
          oval(ctx, '#514039', x, y, 1 + noise(i, pool.seed + 5) * (cool ? 4 : 2), 1 + noise(i, pool.seed) * 2);
        }
        if (!cool) {
          const shift = Math.sin(pool.age * 2 + pool.seed) * 2;
          line(ctx, '#ffd277', [[pool.x * TILE - radius * 0.5, pool.y * TILE], [pool.x * TILE - 1, pool.y * TILE + shift],
            [pool.x * TILE + radius * 0.4, pool.y * TILE - 2]], 1.5);
        }
      } else for (let i = 0; i < 8; i++) {
        const phase = (pool.age * (0.5 + noise(i, pool.seed) * 0.4) + noise(i, pool.seed + 2)) % 1;
        const a = noise(i, pool.seed + 4) * TAU, r = Math.sqrt(noise(i, pool.seed + 6)) * radius * 0.75;
        const x = pool.x * TILE + Math.cos(a) * r, y = pool.y * TILE + Math.sin(a) * r;
        const size = (0.8 + phase * 2) * Math.min(1, radius / 10);
        oval(ctx, '#607b37', x, y, size + 1, size * 0.65 + 1);
        oval(ctx, phase > 0.8 ? '#cbd787' : '#dce3a0', x - 0.5, y - phase, size, size * 0.65);
      }
    }
  }
  ctx.globalAlpha = 0.28;
  for (const bomb of state.bombs) {
    const p = bombPose(bomb); oval(ctx, '#302d27', p.x * TILE, p.y * TILE, 3, 1.5);
  }
  ctx.restore();
}

/** Faceted rock, a recessed crater and incandescent fissures share the eruption clock. */
export function drawVolcano(ctx: CanvasRenderingContext2D, v: Volcano): void {
  const t = Math.min(1, v.age / VOLCANO.grow), grow = 0.08 + t * t * (3 - 2 * t) * 0.92;
  ctx.save(); ctx.scale(grow, grow);
  oval(ctx, '#333b2b55', 5, 5, 39, 13);
  polygon(ctx, '#343b36', [[-36, 7], [-27, -6], [-18, -25], [-12, -40], [13, -40], [21, -23], [29, -6], [36, 7], [14, 14], [-16, 12]]);
  polygon(ctx, '#7d7b64', [[-34, 6], [-24, -7], [-16, -26], [-10, -39], [1, -36], [-6, -12], [-14, 9]]);
  polygon(ctx, '#5c6153', [[-10, -36], [4, -38], [9, -19], [3, -3], [15, 12], [-13, 10], [-6, -14]]);
  polygon(ctx, '#454b42', [[9, -38], [18, -23], [25, -5], [34, 7], [15, 12], [9, -7]]);
  polygon(ctx, '#a4a087', [[-26, -3], [-17, -24], [-13, -27], [-19, -8], [-18, -5]]);
  polygon(ctx, '#40453c', [[-21, 6], [-15, -7], [-12, -9], [-14, 4], [-6, 11]]);
  line(ctx, '#373e37', [[12, -27], [16, -15], [15, -5], [22, 7]], 2);
  line(ctx, '#898873', [[-9, -29], [-5, -16], [-7, -10], [-3, 2]]);
  const hot = v.eruption > 0;
  line(ctx, hot ? '#d76b30' : '#824730', [[3, -35], [1, -24], [5, -18], [2, -8], [8, 7]], hot ? 4 : 2);
  if (hot) line(ctx, '#ffc86a', [[2, -34], [1, -26], [4, -18], [2, -10], [6, 1]], 1.5);
  oval(ctx, '#898674', 0, -39, 14, 6); oval(ctx, '#322e29', 1, -40, 11, 4);
  oval(ctx, '#ae492c', 1, -39, 8, 2.5); oval(ctx, hot ? '#ffe1a0' : '#e78c3b', -1, -40, 5, 1.5);
  line(ctx, '#b7ab8b', [[-12, -40], [-9, -44], [-3, -45], [5, -44]], 2);
  for (let i = 0; i < 16; i++) {
    const a = noise(i, v.seed) * TAU, r = 22 + noise(i, v.seed + 3) * 13;
    oval(ctx, i % 2 ? '#646859' : '#3b433a', Math.cos(a) * r, 6 + Math.sin(a) * 6, 1 + i % 3, 1 + i % 2);
  }
  ctx.restore();
}

export function drawGeohazardAir(ctx: CanvasRenderingContext2D, world: World): void {
  const state = geohazards(world); if (!state) return;
  ctx.save();
  for (const pool of [...state.acid, ...state.lava]) {
    const lava = state.lava.includes(pool), water = !world.terrain.isLand(pool.x, pool.y);
    if (lava && !water && pool.remaining < 2) continue;
    const radius = poolRadius(pool) * TILE;
    for (let i = 0; i < (water ? 5 : 3); i++) {
      const t = (pool.age * 0.65 + noise(i, pool.seed)) % 1;
      const x = pool.x * TILE + (noise(i, pool.seed + 1) - 0.5) * radius + t * 6;
      const y = pool.y * TILE + (noise(i, pool.seed + 2) - 0.5) * radius - t * (water ? 22 : 12);
      ctx.globalAlpha = Math.sin(t * Math.PI) * Math.min(1, pool.remaining) * (water ? 0.4 : 0.16);
      oval(ctx, water ? '#dddcc4' : lava ? '#6e6654' : '#bcc58c', x, y, 1 + t * 5, 1 + t * 3);
    }
  }
  for (const entity of world.query('volcano', 'position')) {
    const v = entity.components.volcano!, p = entity.components.position!;
    const rise = Math.min(1, v.age / VOLCANO.grow), hot = v.eruption > 0;
    const force = hot ? Math.min(1, (2.6 - v.eruption) / 0.4, v.eruption / 0.8) : 0;
    for (let i = 0; i < 18; i++) {
      const t = (v.age * 0.3 + i / 18) % 1;
      const drift = (noise(i, v.seed) - 0.5) * (4 + t * 15) + t * t * 18;
      const x = p.x * TILE + drift, y = p.y * TILE - 40 * rise - t * (38 + force * 42);
      ctx.globalAlpha = Math.sin(t * Math.PI) * (0.18 + force * 0.32) * rise;
      oval(ctx, ['#55554e', '#777367', '#aaa28d'][i % 3], x, y, 3 + t * (7 + force * 8), 2 + t * 7);
    }
    if (hot) for (let i = 0; i < 25; i++) {
      const t = (v.age * 0.8 + noise(i, v.seed + 2)) % 1, side = noise(i, v.seed + 4) - 0.5;
      ctx.globalAlpha = (1 - t) * rise;
      const x = p.x * TILE + side * t * 45, y = p.y * TILE - 40 * rise - Math.sin(t * Math.PI) * (20 + noise(i, v.seed) * 30) + t * 12;
      ctx.fillStyle = i % 3 ? '#ef9c4d' : '#ffe2a0'; ctx.fillRect(Math.round(x), Math.round(y), 1 + i % 2, 2);
    }
  }
  for (const bomb of state.bombs) {
    const p = bombPose(bomb);
    for (let i = 5; i >= 0; i--) {
      const tail = bombPose({ ...bomb, age: Math.max(0, bomb.age - i * 0.035) });
      ctx.globalAlpha = (1 - i / 6) * 0.75;
      oval(ctx, i > 2 ? '#9c5f3b' : '#eb963e', tail.x * TILE, (tail.y - tail.z) * TILE, 2 + (5 - i) * 0.25, 2);
    }
    ctx.globalAlpha = 1;
    oval(ctx, '#4d3e30', p.x * TILE, (p.y - p.z) * TILE, 3.5, 3);
    oval(ctx, '#ef9d4a', p.x * TILE - 1, (p.y - p.z) * TILE - 1, 2.5, 1.5);
    ctx.fillStyle = '#ffe2a2'; ctx.fillRect(Math.round(p.x * TILE - 2), Math.round((p.y - p.z) * TILE - 2), 2, 1);
  }
  ctx.restore();
}
