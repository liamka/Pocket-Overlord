import type { Entity, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { HAMMER_CONTACT, angleDelta, initialResidentAnimation, residentAction } from '../core/resident-animation';
import { RACES, raceOf } from '../core/races';
import { aboardFerry } from '../core/ferries';
import { findPath } from './navigation';
import { atWar, buildHouse } from './society';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const danger = (world: World, p: Vec2): boolean => world.nearby(p, 5).some(e => e.components.explosive || e.components.thermal?.burning);
const stop = (entity: Entity): void => {
  Object.assign(entity.components.citizen!, { task: 'idle', targetId: null, path: [], reconsiderIn: 0, repair: null });
  if (entity.components.person?.animation) entity.components.person.animation.work = 0;
};

function eligible(world: World, entity: Entity, house: Entity): boolean {
  const { person, citizen, position } = entity.components, home = house.components.dwelling, p = house.components.position;
  return !!person && !!citizen && !!position && !!home?.construction && !!p && person.age >= 18 && citizen.hunger < 80
    && !citizen.emergency && !entity.components.thermal?.burning && !house.components.thermal?.burning && citizen.task !== 'migrate'
    && !aboardFerry(world, entity.id) && raceOf(entity) === raceOf(house)
    && !atWar(world, citizen.villageId, home.villageId) && world.safeLand(p, 1)
    && world.terrain.isLand(position.x, position.y) && !danger(world, position) && !danger(world, p);
}

function takeJob(world: World, entity: Entity, house: Entity): boolean {
  const path = findPath(world, entity.components.position!, house.components.position!, 1.7);
  if (path === undefined) return false;
  Object.assign(entity.components.citizen!, { task: 'build', targetId: house.id, path, reconsiderIn: 2, repair: null });
  if (entity.components.person?.animation) entity.components.person.animation.work = 0;
  return true;
}

export function startConstruction(world: World, position: Vec2, builder: Entity): Entity | undefined {
  const house = buildHouse(world, position, raceOf(builder));
  if (!house) return;
  house.components.dwelling!.construction = { progress: 0, struckAt: -1 };
  if (!takeJob(world, builder, house)) { world.remove(house.id); return; }
  return house;
}

export function continueConstruction(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!;
  if (c.task !== 'build') return false;
  const house = world.entities.get(c.targetId ?? -1);
  if (!house || !eligible(world, entity, house)) { stop(entity); return false; }
  const p = entity.components.position!, q = house.components.position!;
  if (distance(p, q) <= 1.9) c.path = [];
  else if (c.reconsiderIn <= 0 && !takeJob(world, entity, house)) { stop(entity); return false; }
  return true;
}

/** At most two reachable adults share a site; abandoned work can be resumed by a neighbor. */
export function assignConstruction(world: World, entity: Entity): boolean {
  const p = entity.components.position!, c = entity.components.citizen!;
  const sites = [...world.query('dwelling', 'position')].filter(h => eligible(world, entity, h)
    && (c.villageId === null || h.components.dwelling!.villageId === c.villageId) && distance(p, h.components.position!) < 22)
    .sort((a, b) => distance(p, a.components.position!) - distance(p, b.components.position!));
  for (const house of sites) {
    const workers = [...world.query('citizen')].filter(e => e.components.citizen!.task === 'build' && e.components.citizen!.targetId === house.id);
    if (workers.length < 2 && takeJob(world, entity, house)) return true;
  }
  return false;
}

/** Saved work phase drives both the hammer contact and the completed building courses. */
export function construction(world: World, dt: number): void {
  for (const entity of world.query('person', 'citizen', 'position')) {
    const { person, citizen: c, position: p } = entity.components;
    const animation = person!.animation ??= initialResidentAnimation(entity.components.motion?.heading);
    const action = residentAction(world, entity), house = world.entities.get(c!.targetId ?? -1);
    const working = ['build', 'repair', 'farm', 'fight', 'extinguish', 'aid'].includes(action);
    if (!working) { animation.work = 0; continue; }
    if (action === 'build' && (!house || !eligible(world, entity, house))) { stop(entity); continue; }
    const target = c!.emergency ? world.entities.get(c!.emergency.targetId ?? -1)?.components.position
      : c!.repair ? { x: c!.repair.tile % world.terrain.width + 0.5, y: Math.floor(c!.repair.tile / world.terrain.width) + 0.5 } : house?.components.position;
    if (target) {
      const turn = angleDelta(Math.atan2(target.y - p!.y, target.x - p!.x), animation.heading);
      animation.heading = angleDelta(animation.heading + Math.max(-dt * 8, Math.min(dt * 8, turn)), 0);
    }
    const before = animation.work, duration = action === 'build' ? 0.9 * RACES[raceOf(entity)].construction : 0.9;
    animation.work = (before + dt / duration) % 1;
    if (action !== 'build' || before >= HAMMER_CONTACT || animation.work < HAMMER_CONTACT) continue;
    const site = house!.components.dwelling!.construction!;
    site.progress = Math.min(1, site.progress + 1 / 12); site.struckAt = world.tick;
    if (site.progress < 1 - 1e-8) continue;
    delete house!.components.dwelling!.construction;
    for (const worker of world.query('citizen')) if (worker.components.citizen!.task === 'build' && worker.components.citizen!.targetId === house!.id) stop(worker);
    world.visual({ kind: 'build', ...house!.components.position!, radius: 2 });
  }
}
