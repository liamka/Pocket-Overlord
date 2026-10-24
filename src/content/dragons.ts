import type { PixelSprite, Registry } from './registry';
import type { Entity, Vec2, WorldViewport } from '../core/types';
import { Terrain, WORLD_HEIGHT, WORLD_WIDTH } from '../core/types';
import { number, record, reference } from '../core/validation';
import type { World } from '../core/world';

export const DRAGON_ID = 'core:dragon';
export const DRAGON_FIRE_ID = 'core:dragon-fire';
export const DRAGON = { speed: 5, altitude: 3.25, wingBeat: 1.25, mouth: 4, reach: 5.5, impactRadius: 1.4,
  fireSeconds: 8, breathSeconds: 1.8, pulseSeconds: 0.15, lifetime: 35 } as const;
interface DragonTransit {
  fromX: number; fromY: number; toX: number; toY: number;
  vx: number; vy: number; elapsed: number; duration: number;
}
export interface DragonState {
  age: number;
  heading: number;
  targetId: number | null;
  goalX: number;
  goalY: number;
  thinkIn: number;
  attackIn: number;
  breath: number;
  pulseIn: number;
  returnPoint?: Vec2;
  arrival?: DragonTransit;
  departure?: DragonTransit;
}
declare module '../core/types' { interface ComponentMap { dragon: DragonState } }

const viewports = new WeakMap<World, WorldViewport>();
export function setDragonViewport(world: World, viewport: WorldViewport): void { viewports.set(world, viewport); }
const currentView = (world: World): WorldViewport => viewports.get(world)
  ?? { left: 0, top: 0, right: world.terrain.width, bottom: world.terrain.height };
// Covers the fully extended wings, tail, altitude and their ground shadow.
const FLIGHT_MARGIN = 12;
const embers: PixelSprite = { pixels: ['.aa.a.', 'abbba.', '.aaa..'], palette: { a: '#713b2c', b: '#e78036' }, anchor: { x: 3, y: 1 } };
const angleDifference = (to: number, from: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const prey = (entity: Entity): boolean => !!entity.components.health && !!entity.components.combustible && !entity.components.explosive;

/** Match cruise velocity on arrival; preserve momentum when turning back to leave. */
function transitPose(flight: DragonTransit, arriving: boolean) {
  const t = Math.min(1, flight.elapsed / flight.duration), t2 = t * t, t3 = t2 * t;
  const dx = flight.toX - flight.fromX, dy = flight.toY - flight.fromY, distance = Math.hypot(dx, dy) || 1;
  const endSpeed = arriving ? DRAGON.speed : distance * 2 / flight.duration;
  const endX = dx / distance * endSpeed, endY = dy / distance * endSpeed;
  const tangent = flight.duration * (t3 - 2 * t2 + t), endTangent = flight.duration * (t3 - t2);
  const x = flight.fromX + dx * (3 * t2 - 2 * t3) + flight.vx * tangent + endX * endTangent;
  const y = flight.fromY + dy * (3 * t2 - 2 * t3) + flight.vy * tangent + endY * endTangent;
  const vx = dx * (6 * t - 6 * t2) / flight.duration + flight.vx * (3 * t2 - 4 * t + 1) + endX * (3 * t2 - 2 * t);
  const vy = dy * (6 * t - 6 * t2) / flight.duration + flight.vy * (3 * t2 - 4 * t + 1) + endY * (3 * t2 - 2 * t);
  // A banked arc avoids a stationary reversal when the return corner is behind the dragon.
  const bend = !arriving && flight.vx * dx + flight.vy * dy < 0
    ? Math.min(10, distance * 0.2) * (Math.sign(flight.vx * dy - flight.vy * dx) || 1) : 0;
  const arc = bend * 16 * t2 * (1 - t) ** 2, arcVelocity = bend * 32 * t * (1 - t) * (1 - 2 * t) / flight.duration;
  return { point: { x: x - dy / distance * arc, y: y + dx / distance * arc },
    velocity: { x: vx - dy / distance * arcVelocity, y: vy + dx / distance * arcVelocity } };
}

export function dragonGroundPosition(position: Vec2, dragon: DragonState): Vec2 {
  const flight = dragon.arrival ?? dragon.departure;
  return flight ? transitPose(flight, !!dragon.arrival).point : position;
}

function locateTransit(world: World, entity: Entity, dt: number): void {
  const p = entity.components.position!, dragon = entity.components.dragon!, flight = (dragon.arrival ?? dragon.departure)!;
  const { point, velocity } = transitPose(flight, !!dragon.arrival);
  // Keep off-map render coordinates in the saved flight; the spatial index stays on the map.
  p.x = Math.max(0, Math.min(world.terrain.width - 0.001, point.x));
  p.y = Math.max(0, Math.min(world.terrain.height - 0.001, point.y));
  const turn = angleDifference(Math.atan2(velocity.y, velocity.x), dragon.heading);
  dragon.heading = (dragon.heading + Math.max(-dt * 1.8, Math.min(dt * 1.8, turn)) + Math.PI * 2) % (Math.PI * 2);
  world.spatial.update(entity);
}

function summon(world: World, point: Vec2, viewport?: WorldViewport): string | void {
  const entity = world.spawn(DRAGON_ID, point);
  if (!entity) return 'Too many objects in the world';
  const view = viewport && [viewport.left, viewport.top, viewport.right, viewport.bottom].every(v => number(v, -1e6, 1e6))
    && viewport.left <= point.x && viewport.right >= point.x && viewport.top <= point.y && viewport.bottom >= point.y
    ? viewport : { left: 0, top: 0, right: world.terrain.width, bottom: world.terrain.height };
  setDragonViewport(world, view);
  const corner = Math.floor(world.rng.range(0, 4));
  const fromX = corner % 2 ? view.right + FLIGHT_MARGIN : view.left - FLIGHT_MARGIN;
  const fromY = corner < 2 ? view.top - FLIGHT_MARGIN : view.bottom + DRAGON.altitude + FLIGHT_MARGIN;
  const dx = point.x - fromX, dy = point.y - fromY;
  const duration = Math.max(1.5, Math.min(4, Math.hypot(dx, dy) / (DRAGON.speed * 3)));
  const dragon = entity.components.dragon!;
  dragon.returnPoint = { x: fromX, y: fromY };
  dragon.heading = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
  dragon.arrival = { fromX, fromY, toX: point.x, toY: point.y, vx: dx * 3 / duration, vy: dy * 3 / duration, elapsed: 0, duration };
  locateTransit(world, entity, 0);
}

function depart(world: World, entity: Entity, direction?: Vec2): void {
  const dragon = entity.components.dragon!, from = dragonGroundPosition(entity.components.position!, dragon), view = currentView(world);
  const back = dragon.returnPoint ?? { x: from.x < world.terrain.width / 2 ? -FLIGHT_MARGIN : world.terrain.width + FLIGHT_MARGIN,
    y: from.y < world.terrain.height / 2 ? -FLIGHT_MARGIN : world.terrain.height + DRAGON.altitude + FLIGHT_MARGIN };
  let dx = direction?.x ?? back.x - from.x, dy = direction?.y ?? back.y - from.y;
  if (Math.hypot(dx, dy) < 0.001) { dx = -1; dy = -1; }
  const edgeX = dx < 0 ? Math.min(0, view.left) - FLIGHT_MARGIN : Math.max(world.terrain.width, view.right) + FLIGHT_MARGIN;
  const edgeY = dy < 0 ? Math.min(0, view.top) - FLIGHT_MARGIN : Math.max(world.terrain.height, view.bottom) + DRAGON.altitude + FLIGHT_MARGIN;
  const scale = Math.min(dx ? (edgeX - from.x) / dx : Infinity, dy ? (edgeY - from.y) / dy : Infinity);
  const previous = dragon.departure ? transitPose(dragon.departure, false).velocity
    : { x: Math.cos(dragon.heading) * DRAGON.speed, y: Math.sin(dragon.heading) * DRAGON.speed };
  const toX = from.x + dx * scale, toY = from.y + dy * scale;
  dragon.departure = { fromX: from.x, fromY: from.y, toX, toY, vx: previous.x, vy: previous.y, elapsed: 0,
    duration: Math.max(1.5, Math.min(4, Math.hypot(toX - from.x, toY - from.y) / (DRAGON.speed * 3))) };
  dragon.targetId = null; dragon.breath = dragon.pulseIn = 0;
}

function travel(world: World, entity: Entity, dt: number): void {
  const dragon = entity.components.dragon!, flight = (dragon.arrival ?? dragon.departure)!;
  const elapsed = flight.elapsed + dt;
  flight.elapsed = elapsed + 1e-9 >= flight.duration ? flight.duration : elapsed;
  locateTransit(world, entity, dt);
  if (flight.elapsed !== flight.duration) return;
  if (dragon.arrival) {
    Object.assign(entity.components.position!, { x: flight.toX, y: flight.toY });
    delete dragon.arrival; world.spatial.update(entity);
  } else {
    const p = dragonGroundPosition(entity.components.position!, dragon), view = currentView(world);
    if (p.x <= view.left - 10 || p.x >= view.right + 10 || p.y <= view.top - 10 || p.y >= view.bottom + DRAGON.altitude + 10) world.remove(entity.id);
    else depart(world, entity, { x: flight.toX - flight.fromX, y: flight.toY - flight.fromY });
  }
}

export function dragonBreathPoint(position: Vec2, heading: number, along: number, across = 0): Vec2 {
  return { x: position.x + Math.cos(heading) * along - Math.sin(heading) * across,
    y: position.y + Math.sin(heading) * along + Math.cos(heading) * across };
}

export function dragonAltitude(time: number): number {
  return DRAGON.altitude + Math.sin(time * Math.PI * 2 * DRAGON.wingBeat - 0.8) * 0.2;
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
    dragon.age += dt;
    if (dragon.arrival || dragon.departure) { travel(world, entity, dt); continue; }
    if (dragon.age + 1e-9 >= DRAGON.lifetime) { depart(world, entity); continue; }
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
  const validTransit = (v: unknown): boolean => record(v)
    && [v.fromX, v.fromY, v.toX, v.toY, v.vx, v.vy].every(n => number(n, -2e6, 2e6))
    && number(v.duration, 1.5, 4) && number(v.elapsed, 0, v.duration);
  registry.registerComponent('dragon', v => number(v.age, 0, 1e8) && number(v.heading, 0, Math.PI * 2) && reference(v.targetId)
    && number(v.goalX, 0, WORLD_WIDTH) && number(v.goalY, 0, WORLD_HEIGHT) && number(v.thinkIn, 0, 1)
    && number(v.attackIn, 0, 6) && number(v.breath, 0, DRAGON.breathSeconds) && number(v.pulseIn, 0, DRAGON.pulseSeconds)
    && (v.returnPoint === undefined || record(v.returnPoint) && number(v.returnPoint.x, -1000020, 1000020) && number(v.returnPoint.y, -1000020, 1000020))
    && (v.arrival === undefined || validTransit(v.arrival) && v.departure === undefined && v.targetId === null && v.breath === 0 && v.pulseIn === 0
      && record(v.arrival) && number(v.arrival.toX, 0, WORLD_WIDTH) && number(v.arrival.toY, 0, WORLD_HEIGHT))
    && (v.departure === undefined || validTransit(v.departure) && v.arrival === undefined && v.targetId === null && v.breath === 0 && v.pulseIn === 0
      && number(v.age, DRAGON.lifetime - 1e-9, 1e8)));
  registry.registerEntity({ id: DRAGON_ID, sprite: 'dragon', create: (position, rng) => ({
    position: { ...position }, health: { current: 1800, max: 1800 },
    dragon: { age: 0, heading: rng.range(0, Math.PI * 2), targetId: null, goalX: position.x, goalY: position.y,
      thinkIn: 0, attackIn: 0.5, breath: 0, pulseIn: 0 },
  }) });
  registry.registerEntity({ id: DRAGON_FIRE_ID, sprite: embers, create: position => ({
    position: { ...position }, combustible: { fuel: DRAGON.fireSeconds, ignition: 15 }, thermal: { temperature: 100, wetness: 0, burning: true },
  }) });
  registry.registerSystem({ id: 'core:dragons', after: ['core:movement'], before: ['core:settlement'], update: fly });
  registry.registerTool({ id: DRAGON_ID, category: 'destruction', icon: 'dragon', label: 'Dragon', radius: 2, showArea: false, color: '#ed8448',
    hint: 'Spawn a dragon. It flies over land and sea, breathing fire on people, forests and settlements.',
    apply: summon,
  });
}
