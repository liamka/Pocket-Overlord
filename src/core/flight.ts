import type { CoreComponents, Vec2 } from './types';

export const LEGACY_ROCKET_HEADING = Math.atan2(320, -60);

export function flightPoint(origin: Vec2, heading: number, along: number, across = 0): Vec2 {
  const dx = Math.cos(heading), dy = Math.sin(heading);
  return { x: origin.x + dx * along - dy * across, y: origin.y + dy * along + dx * across };
}

/** Distance along a ray to a point beyond the map, including diagonal approaches. */
export function flightExitDistance(point: Vec2, heading: number, width: number, height: number): number {
  const dx = Math.cos(heading), dy = Math.sin(heading), margin = 24;
  const x = Math.abs(dx) < 1e-9 ? Infinity : ((dx > 0 ? width + margin : -margin) - point.x) / dx;
  const y = Math.abs(dy) < 1e-9 ? Infinity : ((dy > 0 ? height + margin : -margin) - point.y) / dy;
  return Math.min(x, y);
}

/** Projection and tangent of the same accelerating descent used by the trail and shadow. */
export function rocketPose(target: Vec2, projectile: CoreComponents['projectile']) {
  const progress = Math.max(0, Math.min(1, 1 - projectile.remaining / projectile.duration));
  const heading = projectile.heading ?? LEGACY_ROCKET_HEADING;
  const ground = flightPoint(target, heading, -41 * (1 - progress) * (1 + progress * 0.35));
  const altitude = 6 * (1 - progress);
  const velocity = 41 * (0.65 + progress * 0.7);
  return { x: ground.x, y: ground.y - altitude, ground, progress,
    heading: Math.atan2(Math.sin(heading) * velocity + 6, Math.cos(heading) * velocity) };
}
