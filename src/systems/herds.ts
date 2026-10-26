import { lawEnabled } from '../core/world-rules';
import { isAdult } from '../core/unit-stats';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import type { World } from '../core/world';
import { collectivePolicy, familyOf, foundHerd, HERD, herdContact, joinFamily, leaveFamily } from '../core/families';
import { feedsBy, hunts } from '../core/creatures';
import { liftedIds } from '../core/cataclysms';
import { unitName } from '../core/units';

type Route = (world: World, from: Vec2, to: Vec2, reach: number) => Vec2[] | undefined;
function contactRoute(route: Route, world: World, from: Vec2, to: Vec2, reach: number): Vec2[] | undefined {
  let path = route(world, from, to, reach);
  if (path && !herdContact(world, path.at(-1) ?? from, to, reach)) path = route(world, from, to, Math.min(reach, 0.75));
  // Herds never board ferries or claim success at the opposite bank.
  if (path?.some((p, i) => !herdContact(world, i ? path![i - 1] : from, p, 1.6))) return;
  return path && herdContact(world, path.at(-1) ?? from, to, reach) ? path : undefined;
}
const distance = (a: Entity, b: Entity): number => Math.hypot(a.components.position!.x - b.components.position!.x, a.components.position!.y - b.components.position!.y);
function safe(world: World, entity: Entity): boolean {
  const a = entity.components.animal!, p = entity.components.position!;
  return !entity.components.thermal?.burning && !a.targetId && a.hunger < 70 && world.terrain.isLand(p.x, p.y)
    && !world.nearby(p, 8).some(e => e.components.explosive || e.components.thermal?.burning || hunts(world.registry, e, entity));
}
/** Timers belong to individuals and use simulation seconds, never wall time or new random draws. */
export function updateHerd(world: World, entity: Entity, dt: number, route: Route): void {
  if (world.paused) return;
  const k = entity.components.kinship!, h = k.herd!, animal = entity.components.animal!;
  for (const key of ['checkIn', 'moveIn', 'followIn', 'leaveIn', 'joinIn'] as const) h[key] = Math.max(0, h[key] - dt);
  const family = familyOf(world, entity);
  if (!collectivePolicy(world.registry, entity)?.reference.herd) { leaveFamily(world, entity); return; }
  if (h.checkIn <= 0) {
    h.checkIn = HERD.check;
    if (family && !family.members.includes(entity.id)) leaveFamily(world, entity);
  }
  if (h.leaveIn <= 0) {
    h.leaveIn = HERD.leave;
    if (family && family.members.length >= family.limit && family.alphaId !== entity.id && isAdult(entity) && safe(world, entity)) {
      leaveFamily(world, entity); h.joinIn = HERD.join; h.reason = 'Left a full herd';
      animal.path = []; animal.decisionIn = 0;
      world.announce(`${unitName(entity)} left a full herd to find another`);
      return;
    }
  }
  if (familyOf(world, entity) || h.joinIn > 0) return;
  h.joinIn = HERD.join;
  if (!safe(world, entity)) return;
  const lifted = liftedIds(world);
  const candidates = world.nearby(entity.components.position!, 6).filter(e => e.id !== entity.id && e.components.animal
    && e.components.creature?.speciesId === entity.components.creature?.speciesId && !lifted.has(e.id)
    && e.components.animal.villageId === animal.villageId && safe(world, e)).sort((a, b) => distance(entity, a) - distance(entity, b) || a.id - b.id);
  for (const other of candidates) {
    const target = familyOf(world, other);
    if (!target || target.type !== 'alpha' || target.id === k.previousFamilyId || target.members.length >= target.limit) continue;
    if (contactRoute(route, world, entity.components.position!, other.components.position!, 1.8) === undefined) continue;
    if (joinFamily(world, entity, target)) {
      h.reason = 'Staying near the herd';
      world.announce(`${unitName(entity)} joined the herd led by ${unitName(world.entities.get(target.alphaId!)!)}`);
      return;
    }
  }
  if (!isAdult(entity)) return;
  const companion = candidates.find(e => !familyOf(world, e) && isAdult(e)
    && contactRoute(route, world, entity.components.position!, e.components.position!, 1.8) !== undefined);
  if (companion && foundHerd(world, entity, companion)) {
    h.reason = 'Staying near the herd';
    world.announce(`${unitName(entity)} and ${unitName(companion)} formed a herd`);
  }
}

/** Returns true when the herd owns the current path. Combat, escape and dog care take precedence. */
export function followHerd(world: World, entity: Entity, route: Route): boolean {
  if (world.paused) return false;
  const family = familyOf(world, entity), h = entity.components.kinship?.herd, animal = entity.components.animal!;
  if (!family || family.type !== 'alpha' || !h) return false;
  if (family.alphaId === entity.id) {
    h.followId = null; h.reason = 'Leading the herd';
    if (h.moveIn > 0) return true;
    h.moveIn = HERD.move;
    return false;
  }
  const alpha = world.entities.get(family.alphaId ?? -1);
  if (!alpha?.components.position) { animal.path = []; h.followId = null; return false; }
  if (liftedIds(world).has(alpha.id)) {
    animal.path = []; h.followId = alpha.id; h.reason = 'No route to the herd'; return true;
  }
  if (h.followIn > 0 && h.followId === alpha.id) return true;
  h.followIn = HERD.follow; h.followId = alpha.id;
  const path = contactRoute(route, world, entity.components.position!, alpha.components.position!, 2);
  animal.path = path ?? [];
  h.reason = path === undefined ? 'No route to the herd' : herdContact(world, entity.components.position!, alpha.components.position!) ? 'Staying near the herd' : 'Following the oldest herd member';
  return true;
}

/** Uses the existing animal path and feeding owner; no group teleport or shared hunger. */
export function forageHerd(world: World, entity: Entity, route: Route): boolean {
  const animal = entity.components.animal!, herd = entity.components.kinship?.herd;
  if (world.paused || lawEnabled(world, 'peaceful-monsters') || !herd || !familyOf(world, entity) || !feedsBy(world.registry, entity, 'graze')
    || animal.hunger < 15 || animal.hunger < 35 && !['Seeking safe pasture', 'Grazing safely', 'No safe pasture nearby'].includes(herd.reason)) return false;
  const p = entity.components.position!, candidates: Vec2[] = [];
  for (let y = Math.floor(p.y) - 6; y <= Math.floor(p.y) + 6; y++) for (let x = Math.floor(p.x) - 6; x <= Math.floor(p.x) + 6; x++) {
    if (world.terrain.inside(x, y) && world.terrain.at(x, y) === Terrain.Grass && !world.terrain.surfaceAt(x, y)) candidates.push({ x: x + 0.5, y: y + 0.5 });
  }
  candidates.sort((a, b) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(p.x - b.x, p.y - b.y) || a.y - b.y || a.x - b.x);
  herd.followId = null;
  for (const q of candidates.slice(0, 16)) {
    if (!world.canStand(q, 0.15, entity.id) || world.nearby(q, 8).some(e => e.components.explosive || e.components.thermal?.burning || hunts(world.registry, e, entity))) continue;
    const path = contactRoute(route, world, p, q, 0.25);
    if (path === undefined) continue;
    animal.path = path;
    herd.reason = world.terrain.at(p.x, p.y) === Terrain.Grass && !world.terrain.surfaceAt(p.x, p.y) ? 'Grazing safely' : 'Seeking safe pasture';
    return true;
  }
  animal.path = []; herd.reason = 'No safe pasture nearby';
  return true;
}

/** Carnivores defend an actual member being targeted; herbivores keep escaping. */
export function defendHerd(world: World, entity: Entity, route: Route): boolean {
  const animal = entity.components.animal!, herd = entity.components.kinship?.herd, family = familyOf(world, entity);
  if (world.paused || !herd || !family || !isAdult(entity) || animal.kind === 'sheep') return false;
  const attackers = world.nearby(entity.components.position!, 10).filter(e => {
    const targetId = e.components.animal?.targetId ?? (['fight', 'guard'].includes(e.components.citizen?.task ?? '') ? e.components.citizen?.targetId : null);
    const victim = world.entities.get(targetId ?? -1);
    return !!victim && family.members.includes(victim.id) && !family.members.includes(e.id) && (e.components.health?.current ?? 0) > 0
      && !!e.components.position && distance(e, victim) <= 4;
  }).sort((a, b) => distance(entity, a) - distance(entity, b) || a.id - b.id);
  for (const attacker of attackers) {
    const path = contactRoute(route, world, entity.components.position!, attacker.components.position!, 0.8);
    if (path === undefined) continue;
    animal.targetId = attacker.id; animal.path = path; herd.followId = null; herd.reason = 'Defending a herd member';
    return true;
  }
  if (attackers.length) { animal.targetId = null; animal.path = []; herd.followId = null; herd.reason = 'No route to the threatened member'; return true; }
  return false;
}
