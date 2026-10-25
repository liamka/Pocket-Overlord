import { aboardFerry } from '../core/ferries';
import type { Emergency, Entity, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { liftedIds } from '../core/cataclysms';
import { hazardAreas } from '../core/geohazards';
import { applyEvent } from './effects';
import { findPath } from './navigation';
import { atWar } from './society';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const owner = (e: Entity): number | null => e.components.citizen?.villageId ?? e.components.dwelling?.villageId ?? e.components.farm?.villageId ?? null;
export const emergencyReach = (kind: Emergency['kind']): number => kind === 'extinguish' ? 3.8 : 1.6;
export const isEmergency = (entity: Entity): boolean => !!entity.components.citizen?.emergency;

export function unsafe(world: World, p: Vec2, radius = 6): boolean {
  return hazardAreas(world).some(area => distance(p, area) < area.radius + 2) || world.nearby(p, radius + 4).some(e => {
    const hazard = e.components.explosive;
    return (hazard || e.components.thermal?.burning) && distance(p, e.components.position!) < (hazard ? hazard.radius + 2 : radius);
  });
}

function stop(entity: Entity): void {
  const c = entity.components.citizen!;
  delete c.emergency; c.reconsiderIn = 0;
}

function begin(entity: Entity, state: Emergency): Emergency {
  const c = entity.components.citizen!;
  if (c.task !== 'migrate') Object.assign(c, { task: 'idle', targetId: null, path: [], repair: null, reconsiderIn: 0 });
  c.emergency = state;
  return state;
}

function responsePath(world: World, start: Vec2, end: Vec2, reach: number, safe: (a: Vec2, b: Vec2) => boolean): Vec2[] | undefined {
  const path = findPath(world, start, end, reach, safe);
  // Ferry boarding uses the ordinary travel path, so emergency routes stay on the current shore.
  return path?.some((p, i) => i > 0 && distance(path[i - 1], p) > 1.01) ? undefined : path;
}

/** Emergency paths override ordinary jobs without losing a family's migration membership. */
export function emergencies(world: World, dt: number): void {
  const lifted = liftedIds(world);
  const areas = hazardAreas(world);
  const hazards = [...world.query('position')].filter(e => e.components.explosive || e.components.thermal?.burning);
  const people = [...world.query('person', 'citizen', 'position', 'health')].filter(e => !lifted.has(e.id));
  const assigned = new Map<number, number>();
  for (const e of people) {
    const id = e.components.citizen!.emergency?.targetId;
    if (id != null) assigned.set(id, (assigned.get(id) ?? 0) + 1);
  }
  for (const entity of people) {
    const { person, citizen, position, health, thermal } = entity.components;
    const c = citizen!, p = position!;
    if (person!.madness) { if (c.emergency) stop(entity); continue; }
    if (aboardFerry(world, entity.id) || !world.terrain.isLand(p.x, p.y)) { stop(entity); continue; }
    const local = hazards.filter(e => e.id !== entity.id && distance(p, e.components.position!) < (e.components.explosive?.radius ?? 7) + 5);
    const pools = areas.filter(area => distance(p, area) < area.radius + 12);
    const risk = (q: Vec2, fireRadius = 3.3): number => local.reduce((sum, e) => sum
      + Math.max(0, (e.components.explosive ? e.components.explosive.radius + 2 : fireRadius) - distance(q, e.components.position!)), 0)
      + pools.reduce((sum, area) => sum + Math.max(0, area.radius + 1.5 - distance(q, area)), 0);
    const threatened = !!thermal?.burning || risk(p, 7) > 0;
    const capable = !person!.plague && person!.age >= 18 && health!.current >= health!.max * 0.65 && c.hunger < 80 && !thermal?.burning;
    const mustFlee = !!thermal?.burning || risk(p) > 0 || threatened && !capable;
    let state = c.emergency;
    if (state) state.reconsiderIn -= dt;
    if (mustFlee && state?.kind !== 'flee') {
      if (state?.targetId != null) assigned.set(state.targetId, Math.max(0, (assigned.get(state.targetId) ?? 1) - 1));
      state = begin(entity, { kind: 'flee', targetId: null, path: [], reconsiderIn: 0 });
    }
    if (state?.kind === 'flee') {
      if (!threatened) { stop(entity); continue; }
      if (state.reconsiderIn <= 0) {
        const closest = [...local.map(e => e.components.position!), ...pools].sort((a, b) => distance(p, a) - distance(p, b))[0];
        const away = closest ? Math.atan2(p.y - closest.y, p.x - closest.x) : entity.components.motion!.heading;
        const points: Vec2[] = [];
        for (const radius of [6, 10]) for (const offset of [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2, Math.PI]) {
          const q = { x: p.x + Math.cos(away + offset) * radius, y: p.y + Math.sin(away + offset) * radius };
          if (world.canStand(q, 0.2, entity.id) && risk(q, 7) === 0) points.push(q);
        }
        state.path = [];
        for (const q of points) {
          const path = responsePath(world, p, q, 0.8, (a, b) => risk(b, 7) <= risk(a, 7) + 0.01);
          if (path?.length) { state.path = path; break; }
        }
        state.reconsiderIn = 1;
      }
      continue;
    }
    if (state) {
      const target = world.entities.get(state.targetId!), q = target?.components.position;
      const valid = capable && target && q && !atWar(world, c.villageId, owner(target))
        && (state.kind === 'extinguish' ? target.components.thermal?.burning && !target.components.explosive
          : target.components.person && !target.components.person.plague && !target.components.person.madness
            && target.components.health!.current < target.components.health!.max * 0.85 && !target.components.thermal?.burning);
      if (!valid || distance(p, q!) > 16) {
        assigned.set(state.targetId!, Math.max(0, (assigned.get(state.targetId!) ?? 1) - 1));
        stop(entity); state = undefined;
      } else {
        const reach = emergencyReach(state.kind);
        if (distance(p, q!) <= reach + 0.15) {
          state.path = [];
          if (state.kind === 'extinguish') applyEvent(world, { kind: 'wet', target: target!.id, amount: dt * 0.65 });
          else target!.components.health!.current = Math.min(target!.components.health!.max * 0.85, target!.components.health!.current + dt * 5);
        } else if (state.reconsiderIn <= 0) {
          const path = responsePath(world, p, q!, reach, (_a, b) => risk(b) === 0);
          if (path === undefined) { stop(entity); state = undefined; }
          else { state.path = path; state.reconsiderIn = 0.75; }
        }
        if (state) continue;
      }
    }
    // New responders are chosen on a staggered half-second cadence; escape is immediate.
    if (world.tick % 15 !== entity.id % 15) continue;
    if (capable && c.task !== 'migrate') {
      const fires = local.filter(e => e.components.thermal?.burning && !e.components.explosive && !atWar(world, c.villageId, owner(e))
        && (assigned.get(e.id) ?? 0) < 2 && distance(p, e.components.position!) <= 12);
      const wounded = people.filter(e => e.id !== entity.id && !e.components.person!.plague && !e.components.person!.madness
        && !e.components.thermal?.burning && !atWar(world, c.villageId, owner(e))
        && e.components.health!.current < e.components.health!.max * 0.6 && !(assigned.get(e.id) ?? 0) && distance(p, e.components.position!) <= 10);
      fires.sort((a, b) => Number(!!b.components.person) - Number(!!a.components.person) || distance(p, a.components.position!) - distance(p, b.components.position!));
      wounded.sort((a, b) => distance(p, a.components.position!) - distance(p, b.components.position!));
      for (const target of [...fires, ...wounded]) {
        const kind = target.components.thermal?.burning ? 'extinguish' : 'aid';
        const path = responsePath(world, p, target.components.position!, emergencyReach(kind), (_a, b) => risk(b) === 0);
        if (path === undefined) continue;
        begin(entity, { kind, targetId: target.id, path, reconsiderIn: 0.75 });
        assigned.set(target.id, (assigned.get(target.id) ?? 0) + 1); break;
      }
    }
    if (!c.emergency && threatened) begin(entity, { kind: 'flee', targetId: null, path: [], reconsiderIn: 0 });
  }
}
