import { foodAt, mealStores, spendNutrition } from '../core/food';
import { storageRoute, clearStorageApproach } from '../core/stockpiles';
import { hasPhysiology, metabolizes, physiologyDiet } from '../core/physiology';
import { settlementBiomeProblem } from '../core/biome-ecology';
import { enterTile, worldCell } from '../core/world-tiles';
import { lawEnabled, canJoinSettlement } from '../core/world-rules';
import { compatibleParents } from '../core/subspecies';
import { reproductionProfile } from '../core/reproduction';
import { hasCapability } from '../core/capabilities';
import { hasTrait } from '../core/traits';
import { isAdult, canBreed, unitStats } from '../core/unit-stats';
import { applyStatus, hasStatus, statusOf, statusStops } from '../core/status-effects';
import { happinessValue, recordHappiness, syncHappiness } from '../core/happiness';
import { recordService } from '../core/village-life';
import { operational } from '../core/buildings';
import { claimJob, hasCivilianService, jobEligibility, professionOf, releaseJob, storageHasRoom } from '../core/jobs';
import { beginWait, cancelBehaviour, completeBehaviour, continueWait, enterBehaviour, reconcileBehaviour } from '../core/behaviour';
import { canReflect, startReflection } from '../core/unit-tasks';
import { buyMeal } from '../core/currency';
import { availableStock } from '../core/resource-ledger';
import { canConsume } from '../core/resources';
import type { World } from '../core/world';
import { canMove, feedsBy } from '../core/creatures';
import { isRoadSurface, SOCIAL_EVENT_RATE, type Entity, type Vec2 } from '../core/types';
import { findPath, findShorePath, withDecisionRoutes } from './navigation';
import { assignHouse, atWar, villageOf } from './society';
import { expandingTerritory } from './territory';
import { foundingZones, territoryOwner } from '../core/territory';
import { RACES, raceOf } from '../core/races';
import { campaignObjective } from './diplomacy';
import { assignRepair, continueRepair, roadRepairs } from './road-repair';
import { seasonAt } from '../core/seasons';
import { aboardFerry, waitingForFerry } from '../core/ferries';
import { approachFerry } from './ferries';
import { reservedBeds } from './migration';
import { recordResidentMovement } from '../core/resident-animation';
import { assignConstruction, continueConstruction, startConstruction } from './construction';
import { emergencyReach, isEmergency } from './emergencies';
import { rebuildHome } from './recovery';
import { assignEquipment, assignVillageWork, continueEquipping, continueVillageWork } from './economy';
import { insideMine } from '../core/mines';
import { attackReach, combatStopped, equipmentSpeed, performAttack } from './equipment';
import { assignAnimalCare, continueAnimalCare } from './husbandry';
import { assignSocializing, continueSocializing } from './integration';
import { liftedIds } from '../core/cataclysms';
import { madnessIntent } from './afflictions';
import { creaturePath } from './navigation';
import { commitNeuron, decisionBlock, neuronReady, recordNeuronAttempt, type NeuronOffer } from '../core/neurons';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const endangered = (world: World, p: Vec2): boolean => world.nearby(p, 7).some(e => e.components.explosive || e.components.thermal?.burning);

function swim(world: World, entity: Entity, dt: number): void {
  const { motion, position, citizen } = entity.components, m = motion!, p = position!;
  if (citizen?.neurons?.disabled.includes('swim_to_island')) return;
  if (citizen && (citizen.behaviour?.taskId !== 'swim_to_island' || citizen.behaviour.status === 'completed')) {
    cancelBehaviour(world, entity, 'Action interrupted', false);
    citizen.path = []; citizen.reconsiderIn = 0; m.decisionIn = 0;
    enterBehaviour(world, entity, 'swim_to_island', 'find-shore');
  }
  if (m.decisionIn <= 0) {
    if (citizen && !neuronReady(world, entity, 'swim_to_island')) return;
    const path = findShorePath(world, p, entity.id);
    if (citizen) {
      citizen.path = path;
      enterBehaviour(world, entity, 'swim_to_island', path.length ? 'swim' : 'find-shore');
      if (!path.length) cancelBehaviour(world, entity, 'No route to the target', false);
      recordNeuronAttempt(world, entity, 'swim_to_island', path.length > 0, path.length ? 'Action started' : 'No route to the target');
    }
    if (!path.length) m.heading = world.rng.range(0, Math.PI * 2);
    else if (!citizen) m.heading = Math.atan2(path[0].y - p.y, path[0].x - p.x);
    m.decisionIn = 1;
  }
  while (citizen?.path.length && distance(p, citizen.path[0]) < 0.1) citizen.path.shift();
  const waypoint = citizen?.path[0];
  let speed = m.speed * equipmentSpeed(world, entity) * world.terrain.cell(p.x, p.y, { mode: 'swim' }).movement.speed
    * ((entity.components.stats?.stamina ?? 1) <= 0 ? 0.4 : 1) * (hasPhysiology(entity, 'fins') ? 1.6 : 1);
  if (waypoint) { m.heading = Math.atan2(waypoint.y - p.y, waypoint.x - p.x); speed = Math.min(speed, distance(p, waypoint) / dt); }
  const dx = (Math.cos(m.heading) * speed + m.vx) * dt, dy = (Math.sin(m.heading) * speed + m.vy) * dt;
  const substeps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
  for (let i = 0; i < substeps; i++) {
    const next = { x: p.x + dx / substeps, y: p.y + dy / substeps };
    if (!world.canStand(next, 0.17, entity.id, true)) { m.decisionIn = Math.min(m.decisionIn, 0.2); break; }
    p.x = next.x; p.y = next.y;
    if (world.terrain.isLand(p.x, p.y)) {
      m.decisionIn = 0;
      if (citizen) {
        citizen.path = []; citizen.reconsiderIn = 0;
        completeBehaviour(world, entity, () => true);
      }
      break;
    }
  }
  m.vx *= Math.exp(-6 * dt); m.vy *= Math.exp(-6 * dt); world.spatial.update(entity);
}

export function movement(world: World, dt: number): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  const enemiesPossible = world.society.wars.length > 0 || [...world.query('person')].some(e => e.components.person!.madness);
  for (const entity of world.query('motion', 'position')) {
    if (lifted.has(entity.id)) continue;
    const { motion: m, position: p, person, citizen } = entity.components;
    const previous = { ...p! };
    if (insideMine(entity) && !citizen?.emergency && !entity.components.thermal?.burning) { recordResidentMovement(entity, previous, dt); continue; }
    m!.decisionIn -= dt;
    if (hasPhysiology(entity, 'unmoving') || statusStops(entity) || citizen && decisionBlock(world, entity)) { recordResidentMovement(entity, previous, dt); continue; }
    if (canMove(world.registry, entity, 'fly') && !hasPhysiology(entity, 'hovering')) {
      // Generic flight uses the existing motion timers; unique creatures retain their own handlers.
      if (m!.decisionIn <= 0) { m!.heading = world.rng.range(0, Math.PI * 2); m!.decisionIn = world.rng.range(1, 3.5); }
      const destination = { x: p!.x + (Math.cos(m!.heading) * m!.speed + m!.vx) * dt, y: p!.y + (Math.sin(m!.heading) * m!.speed + m!.vy) * dt };
      const route = creaturePath(world, entity, destination, 0);
      if (route) { p!.x = destination.x; p!.y = destination.y; }
      else { m!.heading += Math.PI; m!.decisionIn = 0.2; }
      m!.vx *= Math.exp(-6 * dt); m!.vy *= Math.exp(-6 * dt); world.spatial.update(entity); continue;
    }
    if (person && (!isEmergency(entity) || aboardFerry(world, entity.id)) && approachFerry(world, entity, dt)) { recordResidentMovement(entity, previous, dt, aboardFerry(world, entity.id)); continue; }
    if (!hasPhysiology(entity, 'aquatic') && entity.components.physiology?.action?.kind !== 'water' && world.terrain.isOpenWater(p!.x, p!.y) && canMove(world.registry, entity, 'swim')) { swim(world, entity, dt); recordResidentMovement(entity, previous, dt); continue; }
    if (citizen?.behaviour?.taskId === 'swim_to_island' && citizen.behaviour.status === 'active') {
      completeBehaviour(world, entity, () => true); citizen.path = []; citizen.reconsiderIn = 0;
    }
    continueWait(world, entity);
    let speedLimit = Infinity, speedMultiplier = 1;
    let fleeX = 0, fleeY = 0;
    if (enemiesPossible) for (const other of world.nearby(p!, 8)) {
      if (other.id === entity.id) continue;
      const enemy = citizen && !person?.madness && other.components.citizen
        && (other.components.person?.madness ? !isAdult(entity)
          : atWar(world, citizen.villageId, other.components.citizen.villageId) && (!isAdult(entity) || citizen.task !== 'fight'));
      if (!enemy) continue;
      const op = other.components.position!, d = distance(p!, op);
      if (d > 4) continue;
      fleeX += (p!.x - op.x || 0.01) / Math.max(0.1, d * d);
      fleeY += (p!.y - op.y || 0.01) / Math.max(0.1, d * d);
    }
    const emergency = citizen?.emergency;
    if (emergency) {
      while (emergency.path.length && distance(p!, emergency.path[0]) < 0.2) emergency.path.shift();
      const waypoint = emergency.path[0], target = world.entities.get(emergency.targetId ?? -1)?.components.position;
      if (emergency.kind === 'flee') speedMultiplier = 2;
      if (waypoint) { m!.heading = Math.atan2(waypoint.y - p!.y, waypoint.x - p!.x); speedLimit = distance(p!, waypoint) / dt; }
      else if (target && distance(p!, target) > emergencyReach(emergency.kind) + 0.15 && distance(p!, target) < 5) m!.heading = Math.atan2(target.y - p!.y, target.x - p!.x);
      else speedLimit = 0;
    } else if ((fleeX || fleeY) && !citizen?.neurons?.disabled.includes('run_away')) {
      m!.heading = Math.atan2(fleeY, fleeX); speedMultiplier = 2.3;
      if (citizen) { citizen.path = []; citizen.reconsiderIn = 0; }
    } else if (citizen?.behaviour?.status === 'active' && world.registry.tasks.get(citizen.behaviour.taskId)?.waitSeconds) {
      speedLimit = 0;
    } else if (citizen && (citizen.task !== 'idle' || citizen.path.length > 0)) {
      while (citizen.path.length && distance(p!, citizen.path[0]) < 0.2) citizen.path.shift();
      const waypoint = citizen.path[0];
      if (waypoint) { m!.heading = Math.atan2(waypoint.y - p!.y, waypoint.x - p!.x); speedLimit = distance(p!, waypoint) / dt; }
      else {
        const target = world.entities.get(citizen.targetId ?? -1)?.components.position;
        const reach = citizen.task === 'fight' || citizen.task === 'guard' ? attackReach(world, entity) : 1.9;
        if (target && distance(p!, target) > reach && distance(p!, target) < 3) m!.heading = Math.atan2(target.y - p!.y, target.x - p!.x);
        else speedLimit = 0;
      }
    } else if (citizen?.neurons && hasCapability(world.registry, entity, 'sapience')) {
      speedLimit = 0;
    } else if (m!.decisionIn <= 0) {
      const home = person?.homeId ? world.entities.get(person.homeId)?.components.position : undefined;
      m!.heading = home && distance(home, p!) > 6 ? Math.atan2(home.y - p!.y, home.x - p!.x) : world.rng.range(0, Math.PI * 2);
      m!.decisionIn = world.rng.range(1, 3.5);
    }
    // Stationary residents need neither equipment stats nor a terrain speed lookup.
    let speed = 0;
    if (speedLimit > 0) {
      speed = m!.speed * equipmentSpeed(world, entity);
      speed *= worldCell(world, p!, entity).movement.speed;
      speed = Math.min(speed * speedMultiplier, speedLimit);
    }
    const dx = (Math.cos(m!.heading) * speed + m!.vx) * dt, dy = (Math.sin(m!.heading) * speed + m!.vy) * dt;
    const substeps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.25));
    for (let s = 0; s < substeps; s++) {
      const next = { x: p!.x + dx / substeps, y: p!.y + dy / substeps };
      if (hasPhysiology(entity, 'hovering') ? world.terrain.inside(next.x, next.y) : world.canStand(next, 0.17, entity.id, hasPhysiology(entity, 'aquatic') || entity.components.physiology?.action?.kind === 'water')) {
        const previousTile = { ...p! };
        if (person && (dx || dy)) world.terrain.useRoad(p!.x, p!.y);
        p!.x = next.x; p!.y = next.y;
        enterTile(world, entity, previousTile);
        if (person && (dx || dy)) world.terrain.useRoad(p!.x, p!.y);
      }
      else {
        m!.heading += world.rng.range(0.8, 2.3); m!.decisionIn = 0.2;
        // Yield around another resident instead of indefinitely blocking a shared route.
        const path = emergency?.path ?? citizen?.path;
        if (path?.length) {
          const side = { x: p!.x + Math.cos(m!.heading) * 0.5, y: p!.y + Math.sin(m!.heading) * 0.5 };
          if (world.canStand(side, 0.17, entity.id)) path.unshift(side);
          if (emergency) emergency.reconsiderIn = Math.min(emergency.reconsiderIn, 0.5);
          else citizen!.reconsiderIn = Math.min(citizen!.reconsiderIn, 0.5);
        }
        break;
      }
    }
    m!.vx *= Math.exp(-6 * dt); m!.vy *= Math.exp(-6 * dt); world.spatial.update(entity);
    recordResidentMovement(entity, previous, dt);
  }
}

function findSite(world: World, center: Vec2, radius: number, attempts: number, size: number): Vec2 | undefined {
  for (let i = 0; i < attempts; i++) {
    const angle = world.rng.range(0, Math.PI * 2), d = world.rng.range(2, radius);
    const p = { x: center.x + Math.cos(angle) * d, y: center.y + Math.sin(angle) * d };
    if (size > 1 && isRoadSurface(world.terrain.at(p.x, p.y))) continue;
    if (world.nearby(p, size + 1.8).some(e => e.components.farm)) continue;
    if (world.safeLand(p, size) && world.canStand(p, size)) return p;
  }
}

export function settlement(world: World): void {
  // Keep saved countdown units while slowing decisions and family milestones together.
  if (world.paused || world.tick % (15 / SOCIAL_EVENT_RATE) !== 0) return;
  const homeRoutes = { remaining: 48 };
  const residents = new Map<number, Entity[]>();
  const reserved = reservedBeds(world);
  const lifted = liftedIds(world);
  const people = [...world.query('person', 'position', 'citizen')];
  for (const entity of people) {
    const person = entity.components.person!;
    person.buildIn -= 0.5; person.reproduceIn = Math.max(0, person.reproduceIn - 0.5);
    if (person.homeId && !world.entities.has(person.homeId)) person.homeId = null;
    if (person.homeId) { const list = residents.get(person.homeId) ?? []; list.push(entity); residents.set(person.homeId, list); }
  }
  const moveIn = (entity: Entity, house: Entity): void => {
    if (settlementBiomeProblem(world, house.components.position!, entity)) return;
    if (house.components.dwelling!.villageId === null && !territoryOwner(world, house.components.position!)) {
      if (!isAdult(entity) || !foundingZones(world, house.components.position!).length) return;
      if (distance(entity.components.position!, house.components.position!) > 3.2) {
        const path = findPath(world, entity.components.position!, house.components.position!, 2.5);
        if (path) Object.assign(entity.components.citizen!, { task: 'visit', targetId: house.id, path, reconsiderIn: 2 });
        return;
      }
    }
    const village = assignHouse(world, house, entity);
    if (!canJoinSettlement(world, entity, village.id)) return;
    const person = entity.components.person!, old = residents.get(person.homeId ?? -1);
    if (old) { const index = old.indexOf(entity); if (index >= 0) old.splice(index, 1); }
    person.homeId = house.id; entity.components.citizen!.villageId = assignHouse(world, house).id;
    const citizen = entity.components.citizen!;
    if (citizen.integration && citizen.integration.villageId !== citizen.villageId) delete citizen.integration;
    delete person.displaced;
    const list = residents.get(house.id) ?? []; list.push(entity); residents.set(house.id, list);
  };
  for (const entity of people) {
    const person = entity.components.person!, citizen = entity.components.citizen!, position = entity.components.position!;
    if (entity.components.reproduction?.egg || !hasCapability(world.registry, entity, 'citizenship') || decisionBlock(world, entity) || person.madness || lifted.has(entity.id) || citizen.task === 'migrate' || isEmergency(entity) || aboardFerry(world, entity.id)) continue;
    if (!world.terrain.isLand(position.x, position.y) || entity.components.thermal?.burning || endangered(world, position)) continue;
    if (person.homeId !== null && world.entities.get(person.homeId)?.components.dwelling?.villageId === null) person.homeId = null;
    if (person.homeId !== null) {
      const home = world.entities.get(person.homeId)!;
      const target = assignHouse(world, home);
      if (canJoinSettlement(world, entity, target.id)) citizen.villageId = target.id;
      else person.homeId = null;
    }
    if (person.homeId === null) {
      if (!neuronReady(world, entity, 'find_house')) continue;
      if (person.displaced) {
        const restored = withDecisionRoutes(world, homeRoutes, () => rebuildHome(world, entity));
        recordNeuronAttempt(world, entity, 'find_house', !!restored);
        if (restored) { moveIn(entity, restored); continue; }
        // Shelter is assigned by the migration system only after the household walks there.
        if (person.displaced && world.tick - person.displaced.since < 1800) continue;
      }
      const home = withDecisionRoutes(world, homeRoutes, () => world.nearby(position, 18).find(e => e.components.dwelling && !e.components.thermal?.burning
        && raceOf(e) === raceOf(entity) && (villageOf(world, e.components.dwelling.villageId)?.race ?? raceOf(e)) === raceOf(entity)
        && canJoinSettlement(world, entity, e.components.dwelling.villageId) && !settlementBiomeProblem(world, e.components.position!, entity)
        && !atWar(world, citizen.villageId, e.components.dwelling.villageId)
        && (residents.get(e.id)?.length ?? 0) + (reserved.get(e.id) ?? 0) < e.components.dwelling.capacity
        && (!person.displaced || distance(position, e.components.position!) < 3.2)
        && findPath(world, position, e.components.position!, 1.8) !== undefined));
      if (home) moveIn(entity, home);
      else if (isAdult(entity) && person.buildIn <= 0 && homeRoutes.remaining > 0) {
        const site = findSite(world, position, citizen.villageId === null ? 2 : 6, citizen.villageId === null ? 3 : 12, 1.3), house = site && withDecisionRoutes(world, homeRoutes, () => startConstruction(world, site, entity));
        if (house) moveIn(entity, house);
        person.buildIn = world.rng.range(7, 12) * RACES[raceOf(entity)].construction;
      }
      recordNeuronAttempt(world, entity, 'find_house', person.homeId !== null);
    }
  }
  const villagePeople = new Map<number | null, Entity[]>();
  for (const entity of people) {
    const id = entity.components.citizen!.villageId;
    let residents = villagePeople.get(id);
    if (!residents) { residents = []; villagePeople.set(id, residents); }
    residents.push(entity);
  }
  for (const entity of people) {
    const person = entity.components.person!, citizen = entity.components.citizen!, village = villageOf(world, citizen.villageId);
    if (entity.components.reproduction?.egg || !hasCapability(world.registry, entity, 'citizenship') || decisionBlock(world, entity) || person.madness || lifted.has(entity.id) || citizen.task === 'migrate' || isEmergency(entity) || aboardFerry(world, entity.id) || !canBreed(entity) || !village || person.homeId === null || entity.components.thermal?.burning
      || !world.terrain.isLand(entity.components.position!.x, entity.components.position!.y)) continue;
    if (citizen.partnerId === null && entity.components.unit?.partnerId == null) {
      const hermaphroditic = reproductionProfile(entity)?.methods.includes('hermaphroditic');
      const partner = villagePeople.get(village.id)!.find(other => {
        const p = other.components.person!, c = other.components.citizen!;
        return other.id !== entity.id && !p.madness && !lifted.has(other.id) && c.task !== 'migrate'
          && c.partnerId === null && other.components.unit?.partnerId == null && canBreed(other)
          && (p.sex !== person.sex || hermaphroditic && reproductionProfile(other)?.methods.includes('hermaphroditic'))
          && compatibleParents(entity, other) && hasCapability(world.registry, other, 'citizenship')
          && world.terrain.isLand(other.components.position!.x, other.components.position!.y)
          && !other.components.thermal?.burning && !citizen.parents.includes(other.id) && !c.parents.includes(entity.id)
          && !citizen.parents.some(id => c.parents.includes(id));
      });
      if (partner) {
        citizen.partnerId = partner.id; partner.components.citizen!.partnerId = entity.id;
        recordHappiness(world, entity, 'love', partner); recordHappiness(world, partner, 'love', entity);
        applyStatus(world, entity, 'fell-in-love', { source: partner, targetId: partner.id });
        applyStatus(world, partner, 'fell-in-love', { source: entity, targetId: entity.id });
        world.visual({ kind: 'love', target: entity.id, ...entity.components.position!, radius: 1 });
        world.visual({ kind: 'love', target: partner.id, ...partner.components.position!, radius: 1 });
        world.announce(`${village.name}: a new couple formed`);
      }
    }
    // Housing remains owned by settlement; conception and birth belong to reproduction.
    const partner = world.entities.get(citizen.partnerId ?? -1), methods = reproductionProfile(entity)?.methods ?? [];
    if (!partner?.components.person || !compatibleParents(entity, partner) || !hasCapability(world.registry, partner, 'citizenship')
      || partner.components.citizen?.villageId !== village.id || decisionBlock(world, partner) || partner.components.person.madness
      || lifted.has(partner.id) || partner.components.citizen.task === 'migrate'
      || !world.terrain.isLand(partner.components.position!.x, partner.components.position!.y)
      || !(methods.includes('sexual') && person.sex === 'a' || methods.includes('hermaphroditic') && entity.id < partner.id)) continue;
    let home = world.entities.get(person.homeId)!;
    let members = residents.get(home.id)!;
    if (partner.components.person.homeId !== home.id && members.length + (reserved.get(home.id) ?? 0) < home.components.dwelling!.capacity) moveIn(partner, home);
    if (!home.components.building?.project && (members.length >= home.components.dwelling!.capacity || partner.components.person.homeId !== home.id) && person.buildIn <= 0) {
      const site = findSite(world, village, 11, 16, 1.3), newHome = site && homeRoutes.remaining > 0 && withDecisionRoutes(world, homeRoutes, () => startConstruction(world, site, entity));
      if (newHome) { newHome.components.dwelling!.villageId = village.id; moveIn(entity, newHome); moveIn(partner, newHome); home = newHome; members = residents.get(home.id)!; }
      person.buildIn = 12 * RACES[raceOf(entity)].construction;
    }
  }
}

export function intentions(world: World): void {
  if (world.paused) return;
  const phase = world.tick % 15, stagger = world.population > 48;
  if (!stagger && phase !== 0) return;
  const lifted = liftedIds(world);
  const season = seasonAt(world.tick);
  const people = [...world.query('person', 'citizen', 'position')].filter(e => !lifted.has(e.id) && !e.components.reproduction?.egg);
  const repairs = roadRepairs(world, people);
  const decisionRoutes = { remaining: stagger ? 6 + Number(phase < 6) : 96 };
  const houses = [...world.query('dwelling', 'position')], fields = [...world.query('farm', 'position')];
  const assignments = new Map<number, number>();
  for (const e of people) if (e.components.citizen!.task === 'farm') {
    const id = e.components.citizen!.targetId!; assignments.set(id, (assignments.get(id) ?? 0) + 1);
  }
  for (const entity of people) {
    if (phase !== 0 && entity.id % 15 !== phase) continue;
    const c = entity.components.citizen!, person = entity.components.person!, position = entity.components.position!;
    reconcileBehaviour(world, entity);
    const stats = unitStats(world, entity).values;
    const village = villageOf(world, c.villageId);
    if (phase === 0) {
      if (lawEnabled(world, 'hunger') && metabolizes(entity)) spendNutrition(entity, (!isAdult(entity) ? 0.4 : 0.55) * season.appetite * stats.metabolicRate);
      syncHappiness(world, entity);
      c.reconsiderIn -= 0.5;
    }
    // Keep metabolism on its original cadence; spread expensive decisions across that interval.
    if (stagger && entity.id % 15 !== phase) continue;
    if (lawEnabled(world, 'hunger') && c.hunger >= 90 && !hasStatus(entity, 'starving')) applyStatus(world, entity, 'starving');
    if (entity.components.reproduction?.egg || !hasCapability(world.registry, entity, 'sapience')) continue;
    if (c.familyActionAt === world.tick) continue;
    if (decisionBlock(world, entity) || combatStopped(entity)) continue;
    if (entity.components.physiology?.action) continue;
    if (expandingTerritory(world, entity.id) && !c.emergency && !entity.components.thermal?.burning && c.hunger < 65) continue;
    if ((hasStatus(entity, 'confused') || hasStatus(entity, 'suspicious') || hasStatus(entity, 'surprised') && (entity.components.physiology?.fleeUntil ?? world.tick + 1) > world.tick) && !c.emergency && c.hunger < 90) {
      if (c.reconsiderIn <= 0) {
        c.reconsiderIn = 1;
        const cause = statusOf(entity, 'suspicious') ?? statusOf(entity, 'surprised');
        const source = cause && world.entities.get(cause.source.id)?.components.position;
        const angle = source && cause!.source.id !== entity.id ? Math.atan2(position.y - source.y, position.x - source.x) : world.rng.range(0, Math.PI * 2);
        const destination = { x: position.x + Math.cos(angle) * 3, y: position.y + Math.sin(angle) * 3 };
        const path = world.canStand(destination, 0.35, entity.id) ? findPath(world, position, destination, 0.5) : undefined;
        c.task = 'idle'; c.targetId = null; c.path = path ?? [];
      }
      continue;
    }
    if (madnessIntent(world, entity, lifted)) continue;
    if (isEmergency(entity) || c.task === 'migrate' || aboardFerry(world, entity.id) || waitingForFerry(world, entity)) continue;
    if (!world.terrain.isLand(position.x, position.y) || continueWait(world, entity)) continue;
    if (c.task === 'visit' && c.targetId === person.homeId && c.hunger < 55) {
      const home = world.entities.get(person.homeId ?? -1);
      if (home?.components.position && operational(home) && distance(position, home.components.position) < 2.4
        && enterBehaviour(world, entity, 'home_rest', 'rest')) {
        c.path = []; c.behaviour!.retryAt = world.tick + ((happinessValue(world, entity) ?? 0) <= 0 ? 180 : 90);
        continue;
      }
    }
    if (continueEquipping(world, entity) || continueSocializing(world, entity)) continue;
    if (continueAnimalCare(world, entity) || continueVillageWork(world, entity)) continue;
    if (continueConstruction(world, entity)) continue;
    if (continueRepair(world, entity, repairs)) continue;
    if (!world.terrain.isLand(position.x, position.y)) continue;
    const current = world.entities.get(c.targetId ?? -1);
    const diet = feedsBy(world.registry, entity, 'settlement') ? physiologyDiet(entity) : [];
    const foodAvailable = village && diet.length
      ? diet.reduce((sum, id) => sum + (canConsume(id, diet) ? availableStock(world, village, id) : 0), 0) : 0;
    if (current && c.task === 'eat' && village && foodAt(world, entity, village, current, diet) && clearStorageApproach(world, position, current)) {
      if (enterBehaviour(world, entity, 'eating', 'consume')) completeBehaviour(world, entity, () => {
        const eaten = buyMeal(world, entity, village, hasTrait(entity, 'gluttonous') ? 2 : 1, diet);
        c.reconsiderIn = 0;
        return eaten > 0;
      });
    }
    if (c.reconsiderIn > 0) continue;
    // Active owners retain their targets; decisions never reassign a half-finished shipment.
    if (current && c.path.length && (c.task === 'eat' && c.hunger >= 55 && village && !!foodAt(world, entity, village, current, diet)
      || c.task === 'fight' && c.hunger < 85 && atWar(world, c.villageId, current.components.citizen?.villageId ?? current.components.dwelling?.villageId ?? null)
      || c.task === 'visit' && c.hunger < 55)) continue;
    if (current && c.task === 'farm' && c.hunger < 55 && operational(current) && season.growth > 0 && !current.components.thermal?.burning
      && village && !jobEligibility(world, entity, 'farmer') && storageHasRoom(world, village, 'provisions') && claimJob(world, entity, 'farmer', current.id, 'grain')) continue;
    if (world.tick < (c.neurons?.nextDecisionAt ?? 0)) continue;
    // Fixed-size proposals contain no path searches and spend no randomness.
    const adult = isAdult(entity), home = world.entities.get(person.homeId ?? -1);
    const serving = professionOf(world, entity).service !== 'civilian';
    const enemies = lawEnabled(world, 'armies') && serving && village && adult && c.hunger < 85
      ? people.filter(e => isAdult(e) && atWar(world, village.id, e.components.citizen!.villageId)) : [];
    const objective = lawEnabled(world, 'armies') && serving && village ? campaignObjective(world, village.id) : undefined;
    const opponents = [...enemies.filter(e => distance(position, e.components.position!) < 12),
      ...houses.filter(e => e.components.dwelling!.villageId === objective), ...enemies.filter(e => e.components.citizen!.villageId === objective)];
    const offers: NeuronOffer[] = [
      { id: 'try_to_eat_city_food', reason: !village ? 'No settlement' : c.hunger < 55 ? 'Not hungry' : foodAvailable < 1 ? 'No suitable food' : undefined },
      { id: 'find_city_job', weight: c.hunger >= 90 ? 0.3 : c.hunger >= 50 ? 1 : 2,
        reason: !village ? 'No settlement' : !adult ? 'Adults only' : c.hunger >= 70 || c.work?.cargo ? 'Not ready to rest' : undefined },
      { id: 'store_resources', reason: !c.work?.cargo ? 'No cargo to deliver' : c.hunger >= 70 ? 'Not ready to rest' : undefined },
      { id: 'try_to_take_city_item', reason: !village ? 'No settlement' : !adult ? 'Adults only' : c.hunger >= 55 || c.work?.cargo ? 'Not ready to rest' : undefined },
      { id: 'socialize_initial_check', reason: !village ? 'No settlement' : c.hunger >= 55 || c.work?.cargo ? 'Not ready to rest' : undefined },
      { id: 'stay_in_own_home', weight: (happinessValue(world, entity) ?? 0) <= 0 ? 1.5 : 0.5, reason: !home || !operational(home) ? 'No home' : c.hunger >= 55 || c.work?.cargo ? 'Not ready to rest' : undefined },
      { id: 'try_to_return_to_home_city', reason: !home || !village ? 'No home' : distance(position, home.components.position!) < 18 || c.work?.cargo ? 'Not ready to rest' : undefined },
      { id: 'city_walking_to_danger_zone', reason: !adult ? 'Adults only' : !opponents.length ? 'No danger nearby' : undefined },
      { id: 'reflection', reason: !canReflect({ world, entity }) || world.tick < (c.reflectionAfter ?? entity.id % 60 * 30) ? 'Not ready to rest' : undefined },
      { id: 'bored_sleep', weight: (entity.components.stats?.stamina ?? 100) < 20 ? 4 : 1, reason: c.hunger >= 40 || c.work?.cargo || opponents.length || c.task !== 'idle' ? 'Not ready to rest' : undefined },
      { id: 'random_move', weight: hasPhysiology(entity, 'inquisitive-nature') ? 1.5 : 1 }, { id: 'wait5' },
    ];
    const formerField = c.task === 'farm' ? c.targetId : null;
    const approach = (targets: Entity[], task: typeof c.task): boolean => {
      const sorted = [...targets].sort((a, b) => distance(position, a.components.position!) - distance(position, b.components.position!) || a.id - b.id);
      for (const target of sorted.slice(0, 4)) {
        if (target.components.thermal?.burning) continue;
        const path = task === 'eat' ? storageRoute(world, position, target) : findPath(world, position, target.components.position!, task === 'fight' ? attackReach(world, entity, target) * 0.85 : 1.8);
        if (path === undefined) continue;
        cancelBehaviour(world, entity, 'Action interrupted', false);
        if (task === 'visit' && c.behaviour?.taskId === 'home_rest' && c.behaviour.status === 'completed') delete c.behaviour;
        if (task === 'farm' && !claimJob(world, entity, 'farmer', target.id, 'grain')) continue;
        if (task !== 'farm') releaseJob(entity);
        c.task = task; c.targetId = target.id; c.path = path; c.repair = null; c.reconsiderIn = 2;
        return task === 'eat' || task === 'fight' ? enterBehaviour(world, entity, task === 'eat' ? 'eating' : 'combat', 'approach') : true;
      }
      return false;
    };
    const acted = withDecisionRoutes(world, decisionRoutes, () => commitNeuron(world, entity, offers, id => {
      if (id === 'try_to_eat_city_food') { const assigned = approach(mealStores(world, entity, village!), 'eat'); if (!assigned && entity.components.food) entity.components.food.problem = 'Food is unreachable'; return assigned; }
      if (id === 'city_walking_to_danger_zone') return approach(opponents, 'fight');
      if (id === 'try_to_take_city_item') return assignEquipment(world, entity);
      if (id === 'socialize_initial_check') return assignSocializing(world, entity);
      if (id === 'store_resources') return assignVillageWork(world, entity);
      if (id === 'find_city_job') {
        if (!hasCivilianService(world, entity)) return false;
        if (assignConstruction(world, entity) || assignRepair(world, entity, repairs) || assignAnimalCare(world, entity) || assignVillageWork(world, entity)) return true;
        const available = season.growth > 0 ? fields.filter(e => operational(e) && e.components.farm!.villageId === village!.id && !e.components.thermal?.burning) : [];
        available.sort((a, b) => ((assignments.get(a.id) ?? 0) - Number(c.targetId === a.id)) - ((assignments.get(b.id) ?? 0) - Number(c.targetId === b.id)) || distance(position, a.components.position!) - distance(position, b.components.position!));
        for (const field of available.slice(0, 4)) if (approach([field], 'farm')) return true;
        return false;
      }
      if (id === 'stay_in_own_home' || id === 'try_to_return_to_home_city') return !!home && approach([home], 'visit');
      if (id === 'reflection') return startReflection(world, entity);
      cancelBehaviour(world, entity);
      releaseJob(entity);
      c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null;
      if (id === 'random_move') {
        const angle = world.rng.range(0, Math.PI * 2);
        const next = { x: Math.floor(position.x + Math.cos(angle) * 2) + 0.5, y: Math.floor(position.y + Math.sin(angle) * 2) + 0.5 };
        const path = findPath(world, position, next, 0.2);
        if (path === undefined || !path.length) return false;
        c.path = path; entity.components.motion!.heading = angle; entity.components.motion!.decisionIn = 2;
        return true;
      }
      if (c.behaviour?.taskId === 'wait5') delete c.behaviour;
      const waiting = beginWait(world, entity, 'wait5');
      if (waiting && id === 'bored_sleep') applyStatus(world, entity, 'sleeping', { seconds: Math.max(1, c.behaviour!.retryAt - world.tick) / 30 });
      return waiting;
    }));
    if (!acted) {
      cancelBehaviour(world, entity);
      releaseJob(entity);
      c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null;
      // Safe bounded idle is a fallback, even when the player disables intentional waiting.
      c.reconsiderIn = 1;
    }
    if (formerField !== null && (c.task !== 'farm' || c.targetId !== formerField)) assignments.set(formerField, Math.max(0, (assignments.get(formerField) ?? 0) - 1));
    if (c.task === 'farm' && c.targetId !== formerField) assignments.set(c.targetId!, (assignments.get(c.targetId!) ?? 0) + 1);
  }
}

/** Combat timing uses the fixed step; selecting a target still belongs to intentions. */
export function residentCombat(world: World): void {
  if (world.paused) return;
  const lifted = liftedIds(world);
  for (const entity of world.query('person', 'citizen', 'position')) {
    const c = entity.components.citizen!, p = entity.components.position!, target = world.entities.get(c.targetId ?? -1);
    if (c.task !== 'fight' && c.task !== 'guard' || !target?.components.position || c.attackIn > 0 || decisionBlock(world, entity)
      || isEmergency(entity) || lifted.has(entity.id) || !world.terrain.isLand(p.x, p.y) || endangered(world, p)) continue;
    if (c.task === 'guard') {
      if (target.components.animal?.kind === 'wolf' && hasCivilianService(world, entity) && c.hunger < 70
        && !target.components.thermal?.burning && performAttack(world, entity, target)) recordService(entity, 0.1);
      continue;
    }
    const mad = !!entity.components.person?.madness;
    if (!mad && !target.components.person?.madness && !lawEnabled(world, 'armies')) continue;
    if (!mad && !target.components.person?.madness && !atWar(world, c.villageId, target.components.citizen?.villageId ?? target.components.dwelling?.villageId ?? null)) continue;
    if (distance(p, target.components.position) > attackReach(world, entity, target)) continue;
    if (mad || target.components.person?.madness) performAttack(world, entity, target, mad ? 1.25 : 1);
    else if (enterBehaviour(world, entity, 'combat', 'strike')) completeBehaviour(world, entity, () => performAttack(world, entity, target), true);
  }
}
