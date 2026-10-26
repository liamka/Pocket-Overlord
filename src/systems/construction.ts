import { settlementBiomeProblem, villageBiomeProblem } from '../core/biome-ecology';
import { isAdult, unitStats } from '../core/unit-stats';
import { foundingZones, ownsPosition, territoryOwner } from '../core/territory';
import { developmentProblem, projectAllowed } from '../core/village-development';
import { consumeReservation, releaseReservation, reserveGoods, clearStorageApproach, attachStorage, storesOf } from '../core/stockpiles';
import { canAfford } from '../core/resource-ledger';
import { payWork } from '../core/currency';
import { cancelBehaviour, completeBehaviour, enterBehaviour } from '../core/behaviour';
import { decisionBlock } from '../core/neurons';
import { ARCHITECTURES, BUILDINGS, beginProject, buildingCost, buildingEntrances, buildingGround, buildingOwner, buildingProfile, buildingRoute, configureArchitecture, hasCapability, hasOrderedBuilding, housingLimit, operational, setBuildingOwner, transferBuilding, type BuildingAction } from '../core/buildings';
import type { Entity, Vec2, Village } from '../core/types';
import type { World } from '../core/world';
import { recordService } from '../core/village-life';
import { STONE } from '../core/stone';
import { HAMMER_CONTACT, angleDelta, initialResidentAnimation, residentAction } from '../core/resident-animation';
import { raceOf } from '../core/races';
import { aboardFerry } from '../core/ferries';
import { harborSite } from '../core/seafaring';
import { atWar, assignHouse, fertilePatch, villageOf } from './society';
import { claimJob, constructionJob, jobEligibility, releaseJob } from '../core/jobs';
import { mineDepositSite, mineRoute } from '../core/mines';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const danger = (world: World, p: Vec2): boolean => world.nearby(p, 5).some(e => e.components.explosive || e.components.thermal?.burning);
const stop = (world: World, entity: Entity): void => {
  releaseJob(entity);
  cancelBehaviour(world, entity);
  Object.assign(entity.components.citizen!, { task: 'idle', targetId: null, path: [], reconsiderIn: 0, repair: null });
  if (entity.components.person?.animation) entity.components.person.animation.work = 0;
};
function eligible(world: World, entity: Entity, site: Entity): boolean {
  if (decisionBlock(world, entity)) return false;
  const { person, citizen, position } = entity.components, p = site.components.position;
  return !!person && !!citizen && !!position && !!site.components.building?.project && !!p && isAdult(entity) && !person.madness && citizen.hunger < 80
    && !jobEligibility(world, entity, constructionJob(site))
    && !citizen.emergency && !citizen.work?.cargo && !entity.components.thermal?.burning && !site.components.thermal?.burning && citizen.task !== 'migrate'
    && !aboardFerry(world, entity.id) && (!site.components.dwelling || raceOf(entity) === raceOf(site))
    && (citizen.villageId === null || citizen.villageId === buildingOwner(site))
    && (buildingOwner(site) === null || ownsPosition(world, buildingOwner(site)!, p))
    && !atWar(world, citizen.villageId, buildingOwner(site)) && buildingGround(world, site) && !settlementBiomeProblem(world, p, entity)
    && world.terrain.isLand(position.x, position.y) && !danger(world, position) && !danger(world, p);
}
function reserveProject(world: World, site: Entity, from: Vec2): boolean {
  const b = site.components.building!, project = b.project!;
  if (project.paid) return true;
  const owner = villageOf(world, buildingOwner(site));
  if (Object.keys(project.cost).length && (!owner || !reserveGoods(world, owner, project.cost, site.id, from))) { b.state = 'planned'; return false; }
  b.state = 'reserved'; return true;
}
function takeJob(world: World, entity: Entity, site: Entity): boolean {
  if (entity.components.citizen!.work?.cargo || jobEligibility(world, entity, constructionJob(site))) return false;
  const path = buildingRoute(world, entity.components.position!, site);
  if (path === undefined) { entity.components.citizen!.jobProblem = { kind: constructionJob(site), reason: 'No route to the target' }; return false; }
  if (!reserveProject(world, site, entity.components.position!)) { entity.components.citizen!.jobProblem = { kind: constructionJob(site), reason: 'Materials are missing' }; return false; }
  // The first house assigns citizenship immediately after placement in settlement().
  if (entity.components.citizen!.villageId !== null && !claimJob(world, entity, constructionJob(site), site.id)) return false;
  if (entity.components.citizen!.work) delete entity.components.citizen!.work!.reservation;
  Object.assign(entity.components.citizen!, { task: 'build', targetId: site.id, path, reconsiderIn: 2, repair: null });
  if (entity.components.person?.animation) entity.components.person.animation.work = 0;
  return enterBehaviour(world, entity, 'construction', 'approach');
}
export function placementProblem(world: World, kind: string, p: Vec2, village?: Village, ignoreId?: number): string | undefined {
  const profile = BUILDINGS[kind];
  if (!profile) return 'Unknown building';
  if (village) { const reason = villageBiomeProblem(world, p, village.id); if (reason) return reason; }
  if (profile.uniquePerVillage && (!village || hasOrderedBuilding(world, kind, village.id, ignoreId)))
    return kind === 'core:mine' ? village ? 'This settlement already has a mine or a mine project' : 'Place a mine within settlement borders'
      : village ? 'This settlement already has a temple or a temple project' : 'Place a temple within settlement borders';
  if (village && !ownsPosition(world, village.id, p)) return 'Plot is outside the settlement borders';
  if (village) { const reason = developmentProblem(world, village, kind); if (reason) return reason; }
  if (profile.capabilities.includes('housing') && village) { const count = housingLimit(world, village); if (count.used >= count.limit) return 'Housing limit reached'; }
  if (profile.placement === 'coast') { if (harborSite(world, p) === undefined) return 'Choose an open coast with room for a pier'; }
  else if (!world.safeLand(p, 1.3) || profile.placement === 'field' && !fertilePatch(world, p)) return 'Choose clear dry ground';
  const cells = profile.footprint.map(q => ({ x: Math.floor(p.x + q.x), y: Math.floor(p.y + q.y) }));
  if (kind === 'core:temple' || kind === 'core:mine') for (const cell of cells) {
    if (!world.terrain.inside(cell.x, cell.y) || !world.terrain.cell(cell.x, cell.y).buildable) return 'Choose clear dry ground';
    if (!ownsPosition(world, village!.id, cell)) return 'Plot is outside the settlement borders';
    const center = { x: cell.x + 0.5, y: cell.y + 0.5 };
    if (world.nearby(center, 2).some(e => e.id !== ignoreId && e.components.solid
      && distance(center, e.components.position!) < 0.7 + e.components.solid.radius)) return 'Choose clear dry ground';
  }
  for (const other of world.nearby(p, 6)) {
    if (other.id === ignoreId || !other.components.building) continue;
    const q = other.components.position!, occupied = buildingProfile(other)!.footprint;
    if (occupied.some(t => cells.some(c => c.x === Math.floor(q.x + t.x) && c.y === Math.floor(q.y + t.y)))) return 'Choose clear dry ground';
  }
  if (profile.placement !== 'field' && !world.canStand(p, 1.2, ignoreId)) return 'Choose clear dry ground';
  if (profile.placement === 'field' && world.nearby(p, 3).some(e => e.id !== ignoreId && e.components.solid
    && distance(p, e.components.position!) < 1.5 + e.components.solid.radius)) return 'Choose clear dry ground';
}
/** A reserved plot with missing supplies stays a plan, never an active building. */
export function planBuilding(world: World, kind: string, p: Vec2, owner?: Village, builder?: Entity, ruin?: Entity): Entity | undefined {
  if (!owner && kind === 'core:house' && (!foundingZones(world, p).length || !builder || !isAdult(builder))) return;
  if (placementProblem(world, kind, p, owner, ruin?.id) || builder && settlementBiomeProblem(world, p, builder)) return;
  const direction = kind === 'core:harbor' ? harborSite(world, p) : undefined;
  const building = world.spawn(kind, p);
  if (!building) return;
  configureArchitecture(building, builder ? raceOf(builder) : owner?.race ?? 'human');
  setBuildingOwner(building, owner?.id ?? null);
  beginProject(building, 'build');
  if (building.components.harbor) Object.assign(building.components.harbor, { built: 0, direction });
  if (building.components.temple && (!buildingEntrances(world, building).length || ![...world.query('person', 'citizen', 'position')]
    .some(e => e.components.citizen!.villageId === owner!.id && isAdult(e) && !jobEligibility(world, e, 'builder')
      && buildingRoute(world, e.components.position!, building) !== undefined))) { world.remove(building.id); return; }
  if (building.components.mine && (!mineDepositSite(world, building) || ![...world.query('person', 'citizen', 'position')]
    .some(e => e.components.citizen!.villageId === owner!.id && !jobEligibility(world, e, 'builder')
      && mineRoute(world, e.components.position!, building) !== undefined))) { world.remove(building.id); return; }
  if (builder && buildingRoute(world, builder.components.position!, building) === undefined) { world.remove(building.id); return; }
  if (building.components.dwelling && !owner) owner = assignHouse(world, building, builder);
  if (builder) takeJob(world, builder, building);
  if (ruin) {
    building.components.building!.architecture = ruin.components.building!.architecture;
    if (building.components.appearance) building.components.appearance.variant = ruin.components.appearance?.variant ?? 0;
    world.remove(ruin.id);
  }
  return building;
}
export function startConstruction(world: World, position: Vec2, builder: Entity, ruin?: Entity): Entity | undefined {
  if (world.paused || decisionBlock(world, builder)) return;
  const owner = villageOf(world, builder.components.citizen?.villageId) ?? territoryOwner(world, position);
  if (owner && (owner.race ?? 'human') !== raceOf(builder)) return;
  if (!owner && (distance(builder.components.position!, position) > 3.2 || world.nearby(position, 16).some(e => e.components.person?.madness
    || e.components.citizen && atWar(world, builder.components.citizen?.villageId ?? null, e.components.citizen.villageId)))) return;
  return planBuilding(world, 'core:house', position, owner, builder, ruin);
}
export function continueConstruction(world: World, entity: Entity): boolean {
  const c = entity.components.citizen!;
  if (world.paused || c.task !== 'build') return false;
  const site = world.entities.get(c.targetId ?? -1);
  if (!site || !eligible(world, entity, site)) { stop(world, entity); return false; }
  if (c.villageId !== null && !claimJob(world, entity, constructionJob(site), site.id)) { stop(world, entity); return false; }
  if (clearStorageApproach(world, entity.components.position!, site)) c.path = [];
  else if ((c.reconsiderIn <= 0 || !c.path.length) && !takeJob(world, entity, site)) { cancelBehaviour(world, entity, 'No route to the target'); stop(world, entity); return false; }
  return true;
}
export function requestBuildingWork(world: World, site: Entity, action: Exclude<BuildingAction, 'build'>): boolean {
  const b = site.components.building;
  if (!world.entities.has(site.id)) return false;
  const owner = villageOf(world, buildingOwner(site));
  if (owner && !projectAllowed(world, owner, site, action)) return false;
  if (!b || b.project || action === 'clear' && !site.components.ruin || action !== 'clear' && !operational(site)
    || action === 'upgrade' && (!site.components.dwelling || b.level >= ARCHITECTURES[b.architecture].levels)
    || action === 'repair' && site.components.health!.current >= site.components.health!.max) return false;
  beginProject(site, action); return true;
}
/** Claims belong to the site, so replacement workers never pay a second time. */
export function assignConstruction(world: World, entity: Entity): boolean {
  if (world.paused) return false;
  const p = entity.components.position!, c = entity.components.citizen!;
  const sites = [...world.query('building', 'position')].filter(h => eligible(world, entity, h) && distance(p, h.components.position!) < 22)
    .sort((a, b) => distance(p, a.components.position!) - distance(p, b.components.position!));
  for (const site of sites) {
    const workers = [...world.query('citizen')].filter(e => e.components.citizen!.task === 'build' && e.components.citizen!.targetId === site.id);
    if (workers.length < 2 && takeJob(world, entity, site)) return true;
  }
  const village = villageOf(world, c.villageId);
  if (!village || c.work?.cargo || c.hunger >= 55 || !isAdult(entity) || entity.components.person!.madness || c.emergency) return false;
  for (const site of world.query('building', 'position')) {
    const b = site.components.building!;
    if (buildingOwner(site) === null && b.state === 'abandoned' && !site.components.ruin && distance(p, site.components.position!) < 22) {
      const path = buildingRoute(world, p, site);
      if (path === undefined) continue;
      if (clearStorageApproach(world, p, site)) {
        if (!transferBuilding(world, site, village)) continue;
        b.state = site.components.health!.current < site.components.health!.max ? 'damaged' : 'active'; stop(world, entity);
      } else Object.assign(c, { task: 'visit', targetId: site.id, path, reconsiderIn: 2 });
      return true;
    }
    if (buildingOwner(site) !== village.id || b.project || distance(p, site.components.position!) > 22) continue;
    if (site.components.ruin && !hasCapability(site, 'housing')) {
      const restored = planBuilding(world, b.kind, site.components.position!, village, entity, site);
      if (restored && c.task === 'build') return true;
      continue;
    }
    const action = site.components.health && site.components.health.current < site.components.health.max * 0.75 ? 'repair'
      : site.components.dwelling && b.level < ARCHITECTURES[b.architecture].levels ? 'upgrade' : undefined;
    if (!action || !operational(site) || !canAfford(world, village, buildingCost(site, action))) continue;
    if (!requestBuildingWork(world, site, action)) continue;
    if (!eligible(world, entity, site) || !takeJob(world, entity, site)) { delete b.project; b.state = 'active'; continue; }
    return true;
  }
  return false;
}
export function construction(world: World, dt: number): void {
  if (world.paused) return;
  for (const entity of world.query('person', 'citizen', 'position')) {
    const { person, citizen: c, position: p } = entity.components;
    const animation = person!.animation ??= initialResidentAnimation(entity.components.motion?.heading);
    const action = residentAction(world, entity), site = world.entities.get(c!.targetId ?? -1);
    if (!['build', 'repair', 'farm', 'fight', 'extinguish', 'aid'].includes(action)) { animation.work = 0; continue; }
    if (action === 'build' && (!site || !eligible(world, entity, site) || !clearStorageApproach(world, p!, site))) { stop(world, entity); continue; }
    if (action === 'build' && !enterBehaviour(world, entity, 'construction', 'construct', site!.components.building!.project!.progress)) continue;
    const target = c!.emergency ? world.entities.get(c!.emergency.targetId ?? -1)?.components.position
      : c!.repair ? { x: c!.repair.tile % world.terrain.width + 0.5, y: Math.floor(c!.repair.tile / world.terrain.width) + 0.5 } : site?.components.position;
    if (target) {
      const turn = angleDelta(Math.atan2(target.y - p!.y, target.x - p!.x), animation.heading);
      animation.heading = angleDelta(animation.heading + Math.max(-dt * 8, Math.min(dt * 8, turn)), 0);
    }
    const before = animation.work, duration = action === 'build' ? 9 / unitStats(world, entity).values.construction : 0.9;
    animation.work = (before + dt / duration) % 1;
    if (action !== 'build' || before >= HAMMER_CONTACT || animation.work < HAMMER_CONTACT) continue;
    const b = site!.components.building!, project = b.project!, owner = villageOf(world, buildingOwner(site!));
    completeBehaviour(world, entity, () => {
      if (!project.paid) {
        if (!reserveProject(world, site!, p!) || Object.keys(project.cost).length && (!owner || !consumeReservation(owner, site!.id, project.cost))) { stop(world, entity); return false; }
        project.paid = true; b.state = 'construction';
      }
      project.progress = Math.min(1, project.progress + 1 / (project.action === 'clear' || project.action === 'repair' ? 6 : buildingProfile(site!)!.hits)); project.struckAt = world.tick;
      if (site!.components.harbor) site!.components.harbor.built = project.progress;
      if (project.progress < 1 - 1e-8) return true;
      recordService(entity, 3);
      payWork(world, entity, project.action === 'clear' ? 'clearing' : 'construction', project.action === 'build' || project.action === 'upgrade' ? 6 : 1);
      if (project.action === 'upgrade') {
        const home = site!.components.dwelling!, health = site!.components.health!;
        b.level = 2; home.level = 2; home.capacity = STONE.houseCapacity;
        health.max += STONE.houseHealth; health.current += STONE.houseHealth;
        if (owner) world.announce(`${owner.name}: a home was upgraded with stone`);
      }
      if (project.action === 'repair') site!.components.health!.current = site!.components.health!.max;
      if (project.action === 'clear') { world.remove(site!.id); return true; }
      delete b.project; b.state = 'active';
      if (owner) {
        releaseReservation(owner, site!.id);
        if (hasCapability(site!, 'storage') && (!site!.components.dwelling || !storesOf(owner).length)) attachStorage(owner, site!);
        if (site!.components.workplace?.kind === 'market') world.announce(`${owner.name}: the market opened`);
        if (site!.components.temple && project.action === 'build') world.announce(`${owner.name}: a temple is complete; one temple grants two extra house plots`);
      }
      for (const worker of world.query('citizen')) if (worker.components.citizen!.task === 'build' && worker.components.citizen!.targetId === site!.id) stop(world, worker);
      world.visual({ kind: 'build', ...site!.components.position!, radius: 2 });
      return true;
    }, true);
    if (c!.behaviour?.status === 'active') c!.behaviour.progress = project.progress;
  }
}
