import type { PixelSprite, Registry } from './registry';
import type { Entity, Vec2 } from '../core/types';
import { Terrain, WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { number, reference } from '../core/validation';
import type { World } from '../core/world';

export const DRAGON_ID = 'core:dragon';
export const DRAGON_FIRE_ID = 'core:dragon-fire';
export const DRAGON = { speed: 5, altitude: 1.25, mouth: 4, reach: 5.5, impactRadius: 1.4,
  fireSeconds: 8, breathSeconds: 1.8, pulseSeconds: 0.15 } as const;
export interface DragonState {
  heading: number;
  targetId: number | null;
  goalX: number;
  goalY: number;
  thinkIn: number;
  attackIn: number;
  breath: number;
  pulseIn: number;
}
declare module '../core/types' { interface ComponentMap { dragon: DragonState } }

const embers: PixelSprite = { pixels: ['.aa.a.', 'abbba.', '.aaa..'], palette: { a: '#713b2c', b: '#e78036' }, anchor: { x: 3, y: 1 } };
const angleDifference = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const prey = (entity: Entity): boolean => !!entity.components.health && !!entity.components.combustible && !entity.components.explosive;

export function dragonBreathPoint(position: Vec2, heading: number, along: number, across = 0): Vec2 {
  return { x: position.x + Math.cos(heading) * along - Math.sin(heading) * across,
    y: position.y + Math.sin(heading) * along + Math.cos(heading) * across };
}

export function dragonAltitude(time: number): number {
  return DRAGON.altitude + Math.sin(time * Math.PI * 3) * 0.12;
}

/** A short descending jet ends at exactly the ground point used by the fire system. */
export function dragonBreathPose(position: Vec2, heading: number, time: number, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const ground = dragonBreathPoint(position, heading, DRAGON.mouth + (DRAGON.reach - DRAGON.mouth) * t, -0.25 * (1 - t));
  const altitude = dragonAltitude(time) * (1 - t * t);
  return { x: ground.x, y: ground.y - altitude, ground, altitude };
}

function breathe(world: World, entity: Entity): void {
  const p = entity.components.position!, dragon = entity.components.dragon!;
  const impact = dragonBreathPoint(p, dragon.heading, DRAGON.reach);
  if (!world.terrain.inside(impact.x, impact.y) || !world.terrain.isLand(impact.x, impact.y)
    || world.terrain.at(impact.x, impact.y) === Terrain.Mountain) return;
  if (world.effects.some(rain => Math.hypot(rain.x - impact.x, rain.y - impact.y) <= rain.radius)) return;
  for (const victim of world.nearby(impact, DRAGON.impactRadius)) {
    if (!victim.components.combustible || victim.typeId === DRAGON_FIRE_ID) continue;
    world.events.push({ kind: 'heat', target: victim.id, amount: 48 });
    world.events.push({ kind: 'damage', target: victim.id, amount: 9 });
  }
  world.events.push({ kind: 'surface', ...impact, radius: DRAGON.impactRadius, terrain: Terrain.Scorched });
  // Successive ground impacts overlap as the dragon passes; existing flames stay behind.
  if (!world.nearby(impact, 0.65).some(other => other.typeId === DRAGON_FIRE_ID)) world.spawn(DRAGON_FIRE_ID, impact);
}

function fly(world: World, dt: number): void {
  for (const flame of world.query('thermal', 'combustible')) {
    if (flame.typeId === DRAGON_FIRE_ID && (!flame.components.thermal!.burning || flame.components.combustible!.fuel <= 0)) world.remove(flame.id);
  }
  for (const entity of world.query('dragon', 'position')) {
    const p = entity.components.position!, dragon = entity.components.dragon!;
    dragon.attackIn = Math.max(0, dragon.attackIn - dt);
    dragon.thinkIn = Math.max(0, dragon.thinkIn - dt);
    const breathing = dragon.breath > 0;
    let target = world.entities.get(dragon.targetId ?? -1);
    if (!target || !prey(target)) { target = undefined; dragon.targetId = null; }
    if (!breathing && dragon.thinkIn === 0) {
      let best = Infinity;
      for (const candidate of world.nearby(p, 48)) {
        if (!prey(candidate)) continue;
        const q = candidate.components.position!;
        const distance = Math.hypot(q.x - p.x, q.y - p.y);
        const bearing = Math.abs(angleDifference(Math.atan2(q.y - p.y, q.x - p.x), dragon.heading));
        const score = distance + bearing * 5 + (distance < 3 ? 20 : 0) + (candidate.components.person || candidate.components.dwelling ? 0 : 14)
          + (candidate.components.thermal?.burning ? 12 : 0);
        if (score < best) { best = score; target = candidate; }
      }
      dragon.targetId = target?.id ?? null;
      if (!target && Math.hypot(p.x - dragon.goalX, p.y - dragon.goalY) < 6) {
        dragon.goalX = world.rng.range(2, world.terrain.width - 2);
        dragon.goalY = world.rng.range(2, world.terrain.height - 2);
      }
      dragon.thinkIn = 1;
    }
    const goal = target?.components.position ?? { x: dragon.goalX, y: dragon.goalY };
    const bearing = Math.atan2(goal.y - p.y, goal.x - p.x);
    // Fly clear of a target underneath us before turning back for another pass.
    const passOver = !!target && Math.hypot(goal.x - p.x, goal.y - p.y) < 6 && Math.abs(angleDifference(bearing, dragon.heading)) > 0.65;
    const nearEdge = p.x < 3 || p.y < 3 || p.x > world.terrain.width - 3 || p.y > world.terrain.height - 3;
    const desired = nearEdge ? Math.atan2(world.terrain.height / 2 - p.y, world.terrain.width / 2 - p.x)
      : breathing || passOver ? dragon.heading : bearing;
    const turn = angleDifference(desired, dragon.heading);
    dragon.heading += Math.max(-dt * 1.8, Math.min(dt * 1.8, turn));
    dragon.heading = (dragon.heading + Math.PI * 2) % (Math.PI * 2);
    if (!breathing && dragon.attackIn === 0 && !nearEdge) {
      const impact = dragonBreathPoint(p, dragon.heading, DRAGON.reach);
      const q = target?.components.position;
      const overLand = world.terrain.inside(impact.x, impact.y) && world.terrain.isLand(impact.x, impact.y)
        && world.terrain.at(impact.x, impact.y) !== Terrain.Mountain;
      if (overLand && (!q || Math.hypot(q.x - impact.x, q.y - impact.y) <= DRAGON.impactRadius)) {
        dragon.breath = DRAGON.breathSeconds; dragon.pulseIn = 0;
        dragon.attackIn = world.rng.range(4, 6);
      }
    }
    p.x = Math.max(0.5, Math.min(world.terrain.width - 0.5, p.x + Math.cos(dragon.heading) * DRAGON.speed * dt));
    p.y = Math.max(0.5, Math.min(world.terrain.height - 0.5, p.y + Math.sin(dragon.heading) * DRAGON.speed * dt));
    world.spatial.update(entity);
    if (dragon.breath > 0) {
      dragon.pulseIn -= dt;
      if (dragon.pulseIn <= 0) { breathe(world, entity); dragon.pulseIn += DRAGON.pulseSeconds; }
      dragon.breath = Math.max(0, dragon.breath - dt);
    }
  }
}

export function registerDragons(registry: Registry): void {
  registry.registerComponent('dragon', v => number(v.heading, 0, Math.PI * 2) && reference(v.targetId)
    && number(v.goalX, 0, WORLD_WIDTH) && number(v.goalY, 0, WORLD_HEIGHT) && number(v.thinkIn, 0, 1)
    && number(v.attackIn, 0, 6) && number(v.breath, 0, DRAGON.breathSeconds) && number(v.pulseIn, 0, DRAGON.pulseSeconds));
  registry.registerEntity({ id: DRAGON_ID, sprite: 'dragon', create: (position, rng) => ({
    position: { ...position }, health: { current: 1800, max: 1800 },
    dragon: { heading: rng.range(0, Math.PI * 2), targetId: null, goalX: position.x, goalY: position.y,
      thinkIn: 0, attackIn: 0.5, breath: 0, pulseIn: 0 },
  }) });
  registry.registerEntity({ id: DRAGON_FIRE_ID, sprite: embers, create: position => ({
    position: { ...position }, combustible: { fuel: DRAGON.fireSeconds, ignition: 15 }, thermal: { temperature: 100, wetness: 0, burning: true },
  }) });
  registry.registerSystem({ id: 'core:dragons', after: ['core:movement'], before: ['core:settlement'], update: fly });
  registry.registerTool({ id: DRAGON_ID, category: 'destruction', icon: 'dragon', label: 'Dragon', radius: 2, showArea: false, color: '#ed8448',
    hint: 'Spawn a dragon. It flies over land and sea, breathing fire on people, forests and settlements.',
    apply: (world, point) => { if (!world.spawn(DRAGON_ID, point)) return 'Too many objects in the world'; },
  });
}
