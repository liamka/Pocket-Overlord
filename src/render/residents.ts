import type { Entity, ResidentAnimation } from '../core/types';
import type { RaceId } from '../core/races';
import { raceOf } from '../core/races';
import type { World } from '../core/world';
import { initialResidentAnimation, residentAction, type ResidentAction } from '../core/resident-animation';

type Point = readonly [number, number];
export interface ResidentPose extends Partial<ResidentAnimation> {
  time?: number; variant?: number; race?: RaceId; child?: boolean; color?: string;
  action?: ResidentAction; tool?: 'hammer' | 'hoe' | 'sword' | 'bucket' | 'bandage' | 'feed'; load?: 'planks' | 'pack' | 'grain' | 'flour' | 'bread' | 'tools';
}
const pixel = (ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w = 1, h = 1): void => {
  ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
};
function limb(ctx: CanvasRenderingContext2D, color: string, a: Point, b: Point, width = 1): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i <= steps; i++) pixel(ctx, color, a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, width, width);
}
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** A held backswing, fast contact at 62%, recoil and relaxed recovery. */
export function hammerAngle(phase: number): number {
  const keys = [[0, -0.25], [0.18, -0.7], [0.43, -2.15], [0.5, -2.2], [0.62, 0.3], [0.73, 0.48], [1, -0.25]];
  const t = Math.max(0, Math.min(1, phase));
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const [from, a] = keys[i - 1], [to, b] = keys[i]; return a + (b - a) * smooth((t - from) / (to - from));
  }
  return keys[0][1];
}

/** Small articulated limbs retain each people's silhouette and palette. */
export function drawResidentSprite(ctx: CanvasRenderingContext2D, pose: ResidentPose = {}): void {
  const { time = 0, stride = 0, moving = 0, heading = Math.PI / 2, work = 0, action = 'idle', variant = 0, race = 'human', child = false } = pose;
  ctx.save(); if (child) ctx.scale(0.75, 0.75);
  const wide = race === 'orc' || race === 'dwarf', short = race === 'dwarf', elf = race === 'elf';
  const skin = race === 'orc' ? '#8bb456' : short ? '#e4b986' : elf ? '#edcfaa' : '#e6bf91';
  const shade = race === 'orc' ? '#567a38' : '#be9068';
  const shirt = pose.color ?? (elf ? '#8fb76b' : race === 'orc' ? '#a77d48' : short ? '#bd8c51' : ['#ead6a0', '#a7cad1', '#d9947e', '#c7aed4', '#e6be76'][variant % 5]);
  const dark = elf ? '#365b3d' : race === 'orc' ? '#5e4730' : short ? '#686e70' : '#4d635f';
  const boots = elf ? '#40563b' : '#453e38';
  const walking = action === 'walk' || action === 'carry', swimming = action === 'swim';
  const blend = walking ? moving : 0, swing = Math.sin(stride), facing = Math.cos(heading) < -0.05 ? -1 : 1;
  const back = Math.sin(heading) < -0.4, front = Math.abs(Math.cos(heading)) < 0.45;
  const working = action === 'build' || action === 'repair' || action === 'farm' || action === 'fight' || action === 'extinguish' || action === 'aid';
  const contact = working ? Math.max(0, 1 - Math.abs(work - 0.65) / 0.17) : 0;
  const bob = -Math.abs(swing) * 0.65 * blend + (action === 'idle' ? Math.sin(time * 2.3) * 0.16 : 0) + contact * 0.55;
  const lean = facing * contact * 0.8 + Math.cos(heading) * blend * 0.25;
  const chestY = (short ? -5 : -7) + bob, headY = chestY - (elf ? 5 : 4);
  const shoulder = (wide ? 3.5 : 2.5) * (front ? 1 : 0.85);
  pixel(ctx, '#2c493c44', -3, 2, wide ? 8 : 7, 2);
  if (!swimming) for (const side of [-1, 1]) {
    const phase = stride + (side > 0 ? Math.PI : 0), step = Math.sin(phase) * 1.65 * blend;
    const lift = Math.max(0, Math.cos(phase)) * 1.2 * blend;
    const hip: Point = [side * (wide ? 1.7 : 1.1) + lean, -1 + (walking || working ? bob : 0)];
    const foot: Point = [side * (wide ? 1.7 : 1.1) + Math.cos(heading) * step, 2 + Math.sin(heading) * step * 0.6 - lift];
    const knee: Point = [(hip[0] + foot[0]) / 2 - facing * lift * 0.3, (hip[1] + foot[1]) / 2 - lift * 0.25];
    limb(ctx, boots, hip, knee, 2); limb(ctx, side < 0 ? boots : '#6c6350', knee, foot, 2);
    pixel(ctx, '#353a33', foot[0] + (facing < 0 ? -1 : 0), foot[1] + 1, 3, 1);
  }
  const toolAngle = hammerAngle(work);
  const arms = (side: number): Point => {
    const shoulderPoint: Point = [lean + side * shoulder, chestY + 1];
    let elbow: Point, hand: Point;
    if (working && side === facing) {
      const angle = action === 'farm' ? toolAngle * 0.65 + 0.3 : toolAngle;
      elbow = [shoulderPoint[0] + Math.cos(heading) * (1 + Math.cos(angle) * 1.1), shoulderPoint[1] + Math.sin(angle) * 1.7 + 1 + Math.sin(heading) * 0.5];
      hand = [shoulderPoint[0] + Math.cos(heading) * (2 + Math.cos(angle) * 2), shoulderPoint[1] + Math.sin(angle) * 3 + Math.sin(heading) * (2 + Math.cos(angle) * 2) * 0.55];
    } else if (action === 'carry' && pose.load !== 'pack') {
      elbow = [shoulderPoint[0] + side, chestY + 3]; hand = [side * 3 + lean, chestY + 2];
    } else if (swimming) {
      const reach = Math.sin(time * 6 + side * 1.7);
      elbow = [side * (shoulder + 2), chestY + reach]; hand = [side * (shoulder + 4), chestY + reach * 2 + 1];
    } else {
      const sway = -side * swing * 1.5 * blend;
      elbow = [shoulderPoint[0] + Math.cos(heading) * sway * 0.5, chestY + 3 + Math.sin(heading) * sway * 0.25];
      hand = [shoulderPoint[0] + Math.cos(heading) * sway, chestY + 5 + Math.sin(heading) * sway * 0.5];
    }
    limb(ctx, side === facing ? shirt : dark, shoulderPoint, elbow, 2);
    limb(ctx, side === facing ? skin : shade, elbow, hand); pixel(ctx, skin, hand[0], hand[1], 2, 2);
    return hand;
  };
  arms(-facing);
  pixel(ctx, dark, lean - shoulder, chestY, shoulder * 2 + 1, short ? 5 : 6);
  pixel(ctx, shirt, lean - shoulder + 1, chestY, shoulder * 2 - 1, short ? 4 : 5);
  pixel(ctx, '#9e8052', lean - shoulder + 1, -2 + bob, shoulder * 2 - 1, 1);
  if (action === 'build' || action === 'repair' || action === 'carry' && pose.load !== 'pack') {
    pixel(ctx, '#73573d', lean - 2, chestY + 3, 5, 4); pixel(ctx, '#b79962', lean - 1, chestY + 3, 3, 3);
  }
  const hx = lean + (front ? 0 : facing * 0.6), headW = wide ? 6 : 5;
  pixel(ctx, shade, hx - headW / 2, headY, headW, 5);
  pixel(ctx, skin, hx - headW / 2, headY, headW - 1, 4);
  if (elf) {
    pixel(ctx, skin, hx - 5, headY + 1, 3, 1); pixel(ctx, skin, hx + 2, headY + 1, 3, 1);
    pixel(ctx, variant % 2 ? '#c5ae6d' : '#e3d49a', hx - 2, headY - 2, 5, 2);
    pixel(ctx, '#648754', hx - 2, headY, 5, 1);
  } else if (short) {
    pixel(ctx, '#56616a', hx - 4, headY - 1, 9, 2); pixel(ctx, '#a6b1b1', hx - 3, headY - 2, 7, 2);
    pixel(ctx, '#d4b276', hx - 1, headY - 2, 2, 3);
    if (!back) { pixel(ctx, variant % 2 ? '#b07945' : '#895032', hx - 3, headY + 4, 7, 3); pixel(ctx, '#bc915a', hx - 1, headY + 6, 3, 2); }
  } else if (race === 'orc') {
    pixel(ctx, '#425c30', hx - 3, headY - 1, 6, 2);
    if (!back) { pixel(ctx, '#eee3b2', hx - 2, headY + 3, 1, 2); pixel(ctx, '#eee3b2', hx + 2, headY + 3, 1, 2); }
  } else {
    pixel(ctx, variant % 2 ? '#604a36' : '#8b6844', hx - 3, headY - 1, 6, 2);
    pixel(ctx, '#6a4d36', hx - facing * 2, headY + 1, 1, back ? 3 : 1);
  }
  if (back) pixel(ctx, race === 'orc' ? '#567a38' : short ? '#78817b' : elf ? '#c5ae6d' : '#6a4d36', hx - 2, headY + 1, 4, 3);
  else {
    pixel(ctx, '#303b32', hx + (front ? -1 : facing * 2), headY + 2);
    if (front) pixel(ctx, '#303b32', hx + 2, headY + 2);
    else pixel(ctx, skin, hx + facing * 3, headY + 3, 1, 1);
  }
  if (pose.load === 'pack') {
    pixel(ctx, '#705138', lean - facing * 3 - 2, chestY + 1, 4, 6); pixel(ctx, '#c5a171', lean - facing * 3 - 1, chestY + 1, 3, 5);
  }
  const hand = arms(facing);
  if (action === 'carry' && pose.load !== 'pack') {
    if (pose.load && pose.load !== 'planks') {
      const shade = pose.load === 'flour' ? '#eee1ba' : pose.load === 'bread' ? '#d9a155' : '#bba06b';
      pixel(ctx, '#69563a', -5 + lean, chestY - 2, 11, 8); pixel(ctx, shade, -4 + lean, chestY - 3, 9, 8);
      if (pose.load === 'tools') { pixel(ctx, '#d5dfce', -2 + lean, chestY - 5, 6, 2); pixel(ctx, '#725137', lean, chestY - 3, 2, 5); }
      else { pixel(ctx, '#7c653e', -1 + lean, chestY - 4, 3, 2); pixel(ctx, '#fff0c4', -3 + lean, chestY - 1, 2, 3); }
    } else {
    for (let i = 0; i < 3; i++) {
      pixel(ctx, '#6c4f35', -6 + lean + i % 2, chestY - 1 + i * 2, 13, 2);
      pixel(ctx, '#dbba7b', -6 + lean + i % 2, chestY - 1 + i * 2, 12, 1);
    }
    pixel(ctx, '#89795a', -2 + lean, chestY - 1, 1, 6); pixel(ctx, '#89795a', 4 + lean, chestY - 1, 1, 6);
    }
  } else if (pose.tool === 'feed') {
    pixel(ctx, '#b9904f', hand[0] - 2, hand[1], 5, 4); pixel(ctx, '#efd088', hand[0] - 2, hand[1], 5, 1);
    if (action === 'aid') for (let i = 0; i < 3; i++) pixel(ctx, '#e9c36d', hand[0] + Math.cos(heading) * (3 + work * 5 + i), hand[1] + 2 + work * 4, 1, 1);
  } else if (pose.tool === 'bucket' || action === 'extinguish') {
    pixel(ctx, '#475b61', hand[0] - 2, hand[1], 6, 5); pixel(ctx, '#a9bfbc', hand[0] - 1, hand[1] + 1, 4, 3);
    pixel(ctx, '#8ad8ef', hand[0] - 1, hand[1], 4, 1);
    if (action === 'extinguish') for (let i = 0; i < 12; i++) {
      const phase = (work + i / 12) % 1, reach = phase * 28;
      pixel(ctx, i % 2 ? '#b9f1f5' : '#74bdd9', hand[0] + Math.cos(heading) * reach,
        hand[1] + Math.sin(heading) * reach - Math.sin(phase * Math.PI) * 9 + phase * 4, 2, 1);
    }
  } else if (pose.tool === 'bandage' || action === 'aid') {
    pixel(ctx, '#f0e7cc', hand[0], hand[1], 4, 3); pixel(ctx, '#8aac88', hand[0] + 1, hand[1], 1, 3);
  } else if (pose.tool || working) {
    const tool = pose.tool ?? (action === 'farm' ? 'hoe' : action === 'fight' ? 'sword' : 'hammer');
    const angle = working ? toolAngle : 1.2 + swing * blend * 0.12, length = tool === 'hoe' ? 7 : 4;
    const tip: Point = [hand[0] + Math.cos(heading) * Math.cos(angle) * length, hand[1] + Math.sin(angle) * length + Math.sin(heading) * Math.cos(angle) * length * 0.55];
    limb(ctx, tool === 'sword' ? '#d3ded7' : '#947246', hand, tip);
    if (tool === 'sword') limb(ctx, '#c6a76a', [hand[0] - 1, hand[1]], [hand[0] + 2, hand[1]]);
    else {
      const normal: Point = [-facing * Math.sin(angle) * 2, Math.cos(angle) * 2];
      limb(ctx, '#4c5e61', [tip[0] - normal[0], tip[1] - normal[1]], [tip[0] + normal[0], tip[1] + normal[1]], 2);
      pixel(ctx, '#dae1cd', tip[0] - normal[0], tip[1] - normal[1], 2, 1);
    }
    if ((action === 'build' || action === 'repair') && work >= 0.62 && work < 0.91) {
      const age = (work - 0.62) / 0.29;
      for (let i = 0; i < 4; i++) {
        const dx = facing * (i - 1) * age * 3, dy = -Math.sin(age * Math.PI) * (2 + i % 2) + age * 2;
        pixel(ctx, i % 2 ? '#ddc28d' : '#a58a61', tip[0] + dx, tip[1] + dy, 1, 1);
      }
    }
  }
  ctx.restore();
}

export function drawResident(ctx: CanvasRenderingContext2D, world: World, entity: Entity, color?: string): void {
  const person = entity.components.person!, c = entity.components.citizen;
  const action = residentAction(world, entity);
  drawResidentSprite(ctx, { ...(person.animation ?? initialResidentAnimation(entity.components.motion?.heading)), action,
    time: world.tick / 30 + entity.id * 0.37, variant: entity.components.appearance?.variant, race: raceOf(entity), child: person.age < 18, color,
    load: c?.task === 'migrate' ? 'pack' : c?.work?.cargo ? c.work.cargo.good === 'wood' ? 'planks' : c.work.cargo.good : 'planks', tool: c?.emergency ? c.emergency.kind === 'extinguish' ? 'bucket' : c.emergency.kind === 'aid' ? 'bandage' : undefined
      : c?.task === 'tend' ? 'feed' : c?.task === 'build' || c?.task === 'repair' || c?.task === 'work' ? 'hammer' : c?.task === 'farm' ? 'hoe' : c?.task === 'fight' || c?.task === 'guard' ? 'sword' : undefined });
  const neighbor = world.entities.get(c?.targetId ?? -1)?.components.position, p = entity.components.position!;
  if (c?.task === 'socialize' && !c.emergency && neighbor && Math.hypot(p.x - neighbor.x, p.y - neighbor.y) <= 2.2) {
    const y = person.age < 18 ? -22 : -28;
    pixel(ctx, '#f5eed8', -4, y, 9, 5); pixel(ctx, '#f5eed8', -2, y + 5, 2, 2);
    for (let i = 0; i < 3; i++) pixel(ctx, '#5c6c5c', -2 + i * 2, y + 2);
  }
}
