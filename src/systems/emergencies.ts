import { hasCapability } from '../core/capabilities';
import { removeStatus, statusStops } from '../core/status-effects';
import { isAdult } from '../core/unit-stats';
import { aboardFerry } from '../core/ferries';
import { taskLifecycle } from '../core/behaviour';
import { decisionBlock, neuronReady, recordNeuronAttempt } from '../core/neurons';
import type { Emergency, Entity, Vec2 } from '../core/types';
import type { World } from '../core/world';
import { liftedIds } from '../core/cataclysms';
import { hazardAreas } from '../core/geohazards';
import { applyEvent } from './effects';
import { findPath } from './navigation';
import { atWar } from './society';
import { cancelJob, claimJob, jobEligibility, releaseJob } from '../core/jobs';

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
  releaseJob(entity);
  const c = entity.components.citizen!;
  delete c.emergency; c.reconsiderIn = 0;
}

function begin(world: World, entity: Entity, state: Emergency): Emergency {
  if (entity.components.citizen?.jobAssignment) cancelJob(world, entity, 'Responding to danger');
  taskLifecycle.suspend(world, entity, 'Responding to danger');
  const c = entity.components.citizen!;
  if (c.task !== 'migrate') Object.assign(c, { task: 'idle', targetId: null, path: [], repair: null, reconsiderIn: 0 });
  c.emergency = state;
  if (c.neurons) delete c.neurons.sleepingUntil;
  if (state.kind !== 'aid') recordNeuronAttempt(world, entity, state.kind === 'flee' ? 'run_away' : 'put_out_fire', true, 'Responding to danger');
  return state;
}

function responsePath(world: World, start: Vec2, end: Vec2, reach: number, safe: (a: Vec2, b: Vec2) => boolean): Vec2[] | undefined {
  const path = findPath(world, start, end, reach, safe);
  // Ferry boarding uses the ordinary travel path, so emergency routes stay on the current shore.
  return path?.some((p, i) => i > 0 && distance(path[i - 1], p) > 1.01) ? undefined : path;
}
function clearResponse(world: World, from: Vec2, target: Entity): boolean {
  const to = target.components.position!, steps = Math.ceil(distance(from, to) / 0.4);
  for (let i = 1; i < steps; i++) {
    const p = { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps };
    if (!world.terrain.isLand(p.x, p.y) || !world.canStand(p, 0.1, target.id)) return false;
  }
  return true;
}

/** Emergency paths override ordinary jobs without losing a family's migration membership. */
export function emergencies(world: World, dt: number): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  const areas = hazardAreas(world);
  const hazards = [...world.query('position')].filter(e => e.components.explosive || e.components.thermal?.burning);
  const people = [...world.query('person', 'citizen', 'position', 'health')].filter(e => !lifted.has(e.id));
  const enemiesPossible = world.society.wars.length > 0 || people.some(e => e.components.person!.madness);
  const peaceful = !enemiesPossible && !hazards.length && !areas.length;
  const assigned = new Map<number, number>();
  for (const e of people) {
    const id = e.components.citizen!.emergency?.targetId;
    if (id != null) assigned.set(id, (assigned.get(id) ?? 0) + 1);
  }
  for (const entity of people) {
    const { person, citizen, position, health, thermal } = entity.components;
    const c = citizen!, p = position!;
    // With no danger or active response, only the existing staggered aid check can act.
    if (peaceful && !c.emergency && world.tick % 15 !== entity.id % 15
      && world.terrain.isLand(p.x, p.y) && !aboardFerry(world, entity.id)) continue;
    const block = decisionBlock(world, entity);
    if (block === 'Controlled by you' || block === 'Stunned') continue;
    if (person!.madness) { if (c.emergency) stop(entity); continue; }
    if (aboardFerry(world, entity.id) || !world.terrain.isLand(p.x, p.y)) { stop(entity); continue; }
    const local = hazards.filter(e => e.id !== entity.id && distance(p, e.components.position!) < (e.components.explosive?.radius ?? 7) + 5);
    // The existing movement escape also covers nearby enemies. Let the emergency
    // owner suspend work before movement, so a fleeing miner cannot keep extracting.
    if (enemiesPossible && (!isAdult(entity) || c.task !== 'fight')) for (const other of world.nearby(p, 4)) {
      if (other.id === entity.id || !other.components.citizen || local.includes(other)) continue;
      if (atWar(world, c.villageId, other.components.citizen.villageId)
        || !isAdult(entity) && other.components.person?.madness) local.push(other);
    }
    const pools = areas.filter(area => distance(p, area) < area.radius + 12);
    const risk = (q: Vec2, fireRadius = 3.3): number => local.reduce((sum, e) => sum
      + Math.max(0, (e.components.explosive ? e.components.explosive.radius + 2 : fireRadius) - distance(q, e.components.position!)), 0)
      + pools.reduce((sum, area) => sum + Math.max(0, area.radius + 1.5 - distance(q, area)), 0);
    const threatened = !!thermal?.burning || risk(p, 7) > 0;
    if (threatened) removeStatus(world, entity, 'sleeping', 'removed');
    if (statusStops(entity)) continue;
    if (threatened && c.neurons) delete c.neurons.sleepingUntil;
    const capable = hasCapability(world.registry, entity, 'citizenship') && !person!.plague && isAdult(entity) && health!.current >= health!.max * 0.65 && c.hunger < 80 && !thermal?.burning;
    const mustFlee = !!thermal?.burning || risk(p) > 0 || threatened && !capable;
    let state = c.emergency;
    if (state) state.reconsiderIn -= dt;
    if (mustFlee && state?.kind !== 'flee' && neuronReady(world, entity, 'run_away')) {
      if (state?.targetId != null) assigned.set(state.targetId, Math.max(0, (assigned.get(state.targetId) ?? 1) - 1));
      state = begin(world, entity, { kind: 'flee', targetId: null, path: [], reconsiderIn: 0 });
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
        && (state.kind !== 'extinguish' || !jobEligibility(world, entity, 'firefighter') && (c.villageId === null || claimJob(world, entity, 'firefighter', target.id)))
        && (state.kind === 'extinguish' ? target.components.thermal?.burning && !target.components.explosive
          : target.components.person && !target.components.person.plague && !target.components.person.madness
            && target.components.health!.current < target.components.health!.max * 0.85 && !target.components.thermal?.burning);
      if (!valid || distance(p, q!) > 16) {
        assigned.set(state.targetId!, Math.max(0, (assigned.get(state.targetId!) ?? 1) - 1));
        stop(entity); state = undefined;
      } else {
        const reach = emergencyReach(state.kind);
        if (!state.path.length && distance(p, q!) <= reach + 0.15 && clearResponse(world, p, target!)) {
          state.path = [];
          if (state.kind === 'extinguish') applyEvent(world, { kind: 'wet', target: target!.id, amount: dt * 0.65 });
          else target!.components.health!.current = Math.min(target!.components.health!.max * 0.85, target!.components.health!.current + dt * 5);
        } else if (state.reconsiderIn <= 0) {
          const path = responsePath(world, p, q!, reach, (_a, b) => risk(b) === 0);
          if (path === undefined || !clearResponse(world, path.at(-1) ?? p, target!)) { releaseJob(entity, 'No route to the target'); stop(entity); state = undefined; }
          else { state.path = path; state.reconsiderIn = 0.75; }
        }
        if (state) continue;
      }
    }
    // New responders are chosen on a staggered half-second cadence; escape is immediate.
    if (world.tick % 15 !== entity.id % 15) continue;
    if (capable && c.task !== 'migrate' && !decisionBlock(world, entity)) {
      const fires = local.filter(e => e.components.thermal?.burning && !e.components.explosive && !atWar(world, c.villageId, owner(e))
        && (assigned.get(e.id) ?? 0) < 2 && distance(p, e.components.position!) <= 12);
      const wounded = people.filter(e => e.id !== entity.id && !e.components.person!.plague && !e.components.person!.madness
        && !e.components.thermal?.burning && !atWar(world, c.villageId, owner(e))
        && e.components.health!.current < e.components.health!.max * 0.6 && !(assigned.get(e.id) ?? 0) && distance(p, e.components.position!) <= 10);
      fires.sort((a, b) => Number(!!b.components.person) - Number(!!a.components.person) || distance(p, a.components.position!) - distance(p, b.components.position!));
      wounded.sort((a, b) => distance(p, a.components.position!) - distance(p, b.components.position!));
      for (const target of [...fires, ...wounded]) {
        const kind = target.components.thermal?.burning ? 'extinguish' : 'aid';
        if (kind === 'extinguish' && !neuronReady(world, entity, 'put_out_fire')) continue;
        if (kind === 'extinguish' && jobEligibility(world, entity, 'firefighter')) continue;
        const path = responsePath(world, p, target.components.position!, emergencyReach(kind), (_a, b) => risk(b) === 0);
        if (path === undefined || !clearResponse(world, path.at(-1) ?? p, target)) {
          if (kind === 'extinguish') c.jobProblem = { kind: 'firefighter', reason: 'No route to the target' };
          continue;
        }
        begin(world, entity, { kind, targetId: target.id, path, reconsiderIn: 0.75 });
        if (kind === 'extinguish' && c.villageId !== null && !claimJob(world, entity, 'firefighter', target.id)) { stop(entity); continue; }
        assigned.set(target.id, (assigned.get(target.id) ?? 0) + 1); break;
      }
    }
    if (!c.emergency && threatened && neuronReady(world, entity, 'run_away')) begin(world, entity, { kind: 'flee', targetId: null, path: [], reconsiderIn: 0 });
  }
}
