import type { Entity, ResidentAnimation, Vec2 } from './types';
import type { World } from './world';
import { aboardFerry } from './ferries';

export type ResidentAction = 'idle' | 'walk' | 'carry' | 'build' | 'repair' | 'farm' | 'fight' | 'swim';
export const HAMMER_CONTACT = 0.62;
export const angleDelta = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function initialResidentAnimation(heading = 0): ResidentAnimation {
  return { stride: 0, moving: 0, heading: angleDelta(heading, 0), work: 0 };
}

/** Footfall advances with distance traveled, never with a blocked movement intention. */
export function recordResidentMovement(entity: Entity, previous: Vec2, dt: number, carried = false): void {
  const person = entity.components.person, p = entity.components.position;
  if (!person || !p) return;
  const animation = person.animation ??= initialResidentAnimation(entity.components.motion?.heading);
  const dx = p.x - previous.x, dy = p.y - previous.y, distance = carried ? 0 : Math.hypot(dx, dy);
  const moving = distance > 0.001 ? Math.min(1, distance / dt) : 0;
  animation.moving += (moving - animation.moving) * Math.min(1, dt * 12);
  if (animation.moving < 0.001) animation.moving = 0;
  const strideLength = person.age < 18 ? 0.9 : 1.35;
  animation.stride = (animation.stride + distance * Math.PI * 2 / strideLength) % (Math.PI * 2);
  if (distance > 0.001) {
    const turn = angleDelta(Math.atan2(dy, dx), animation.heading);
    animation.heading = angleDelta(animation.heading + Math.max(-dt * 8, Math.min(dt * 8, turn)), 0);
  }
}

export function residentAction(world: World, entity: Entity): ResidentAction {
  const { person, position: p, citizen: c } = entity.components;
  if (!person || !p || aboardFerry(world, entity.id)) return 'idle';
  if (!world.terrain.isLand(p.x, p.y)) return 'swim';
  if ((person.animation?.moving ?? 0) > 0.08) return c?.task === 'build' || c?.task === 'migrate' ? 'carry' : 'walk';
  if (!c || person.age < 18 || entity.components.thermal?.burning || c.path.length) return 'idle';
  if (c.task === 'repair' && c.repair) {
    const x = c.repair.tile % world.terrain.width + 0.5, y = Math.floor(c.repair.tile / world.terrain.width) + 0.5;
    return Math.hypot(p.x - x, p.y - y) <= 1.3 ? 'repair' : 'idle';
  }
  const target = world.entities.get(c.targetId ?? -1), q = target?.components.position;
  if (!q || target.components.thermal?.burning) return 'idle';
  const distance = Math.hypot(p.x - q.x, p.y - q.y);
  if (c.task === 'build' && target.components.dwelling?.construction && distance <= 2.1) return 'build';
  if (c.task === 'farm' && target.components.farm && distance <= 2) return 'farm';
  if (c.task === 'fight' && distance <= (target.components.dwelling ? 2.3 : 1.5)) return 'fight';
  return 'idle';
}
