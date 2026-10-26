import { harvestFoodPlant, plantContents } from './food-plants';
import { loseShipment } from './supply';
import { hasTrait } from './traits';
import { isAdult, unitStats } from './unit-stats';
import type { Entity } from './types';
import type { World } from './world';
import { BONE } from './bone';
import { leatherRemainsFire } from './leather';
import { raceOf } from './races';
import { depositContents, mineralDeposit, takeDeposit } from './deposits';
import { gemContents, gemProfile } from './gems';
import { FOREST, treeProblem, treeYield, treeOwner } from './forestry';
import { clearStorageApproach } from './stockpiles';
import { cargoContents, makeCargo, packedFood, recordLoss } from './resource-ledger';
import { bundleLoad, bundleSize, canCollectRemains, CREATURE_PROFILES, creatureDrops, entries, extractBundle, RESIDENT_DIET, RESOURCES, SOURCE_PROFILES, type ResourceBundle } from './resources';

export function sourceContents(entity: Entity): ResourceBundle | undefined {
  if (entity.components.foodPlant) return plantContents(entity);
  if (entity.components.gemSource) return gemContents(entity.components.gemSource);
  if (entity.components.resourcePile) return entity.components.resourcePile.goods;
  if (entity.components.stone) return depositContents(entity.components.stone);
  if (entity.components.commonMetal) return depositContents(entity.components.commonMetal);
  if (entity.components.farm) return { grain: entity.components.farm.grain ?? 0 };
  if (entity.typeId === 'core:tree' && entity.components.tree) return treeYield(entity);
}
export function mayGather(entity: Entity, source: Entity): boolean {
  const remains = source.components.resourcePile;
  // Permission belongs to the creature's profile, so gathering its meat first does not
  // strand the remaining hide/bones when the batch exceeds carrying capacity.
  return !remains || canCollectRemains(remains.species, CREATURE_PROFILES[remains.species].base, {
    species: raceOf(entity), savage: hasTrait(entity, 'savage') || (entity.components.resourceConsumer?.sapientRemains ?? false),
    scavenges: !!entity.components.citizen, diet: entity.components.resourceConsumer?.diet ?? RESIDENT_DIET,
  });
}
/** Caller must arrive and finish its work first. Depletion and cargo creation are synchronous. */
export function extractSource(world: World, worker: Entity, source: Entity): boolean {
  const c = worker.components.citizen, work = c?.work;
  if (world.paused || !work || work.cargo || !c.villageId || world.entities.get(worker.id) !== worker || world.entities.get(source.id) !== source || !mayGather(worker, source)
    || !world.society.villages.some(v => v.id === c.villageId) || (source.components.health?.current ?? 0) <= 0
    || !worker.components.position || !source.components.position || !world.terrain.isLand(source.components.position.x, source.components.position.y)
    || Math.hypot(worker.components.position.x - source.components.position.x, worker.components.position.y - source.components.position.y) > 2.1) return false;
  const remaining = sourceContents(source);
  if (!remaining) return false;
  if (source.components.foodPlant) {
    if (c.task !== 'work' || c.targetId !== source.id || work.progress < 1 || !worker.components.person || !isAdult(worker) || c.hunger >= 70 || c.emergency) return false;
    const goods = harvestFoodPlant(world, worker, source, goods => { work.cargo = makeCargo(goods, c.villageId!, source.components.foodPlant!.good); });
    if (!goods) return false;
    return !!work.cargo;
  }
  const mineral = mineralDeposit(source);
  if (mineral) {
    if (!clearStorageApproach(world, worker.components.position, source)) return false;
    const goods = takeDeposit(world, source, worker);
    if (!goods) return false;
    work.cargo = makeCargo(goods, c.villageId, SOURCE_PROFILES[mineral.profile].primary);
    if (!mineral.remaining) world.remove(source.id);
    return !!work.cargo;
  }
  if (source.components.gemSource) {
    const s = source.components.gemSource;
    if (c.task !== 'work' || c.targetId !== source.id || work.good !== 'gems' || work.progress < 4
      || s.remaining <= 0 || !worker.components.person || !isAdult(worker) || c.hunger >= 70 || c.emergency
      || worker.components.person.madness || worker.components.thermal?.burning || (worker.components.health?.current ?? 0) <= 0
      || (source.components.health?.current ?? 0) <= 0 || !world.society.villages.some(v => v.id === c.villageId)
      || !clearStorageApproach(world, worker.components.position, source)) return false;
    work.cargo = makeCargo(gemProfile(s).outputs, c.villageId, 'gems');
    if (--s.remaining === 0) world.remove(source.id);
    return true;
  }
  if (source.components.tree) {
    const tree = source.components.tree;
    if (treeProblem(source) || tree.age < FOREST.mature || tree.claim?.workerId !== worker.id || tree.claim.villageId !== c.villageId
      || treeOwner(world, source)?.id !== c.villageId || c.task !== 'work' || c.targetId !== source.id || work.progress < 4
      || !clearStorageApproach(world, worker.components.position, source)) return false;
    // One synchronous hand-off; removal invalidates every other worker's target.
    tree.remaining = 0; tree.claim = null;
    work.cargo = makeCargo(remaining, c.villageId, 'wood');
    world.remove(source.id);
    return !!work.cargo;
  }
  let requested: ResourceBundle;
  if (source.components.resourcePile) {
    if (world.tick >= source.components.resourcePile.createdAt + BONE.remainsTicks || c.task !== 'work' || c.targetId !== source.id
      || work.progress < 1 || c.path.length || c.hunger >= 70 || c.emergency || worker.components.person?.madness
      || !worker.components.person || !isAdult(worker)
      || worker.components.thermal?.burning || source.components.thermal?.burning || (worker.components.health?.current ?? 0) <= 0
      || !clearStorageApproach(world, worker.components.position, source)) return false;
    requested = {}; let weight = 36, volume = 24;
    for (const [id, n] of entries(remaining)) {
      const amount = Math.min(n, 12, Math.floor(weight / RESOURCES[id].weight), Math.floor(volume / RESOURCES[id].volume));
      if (amount > 0) { requested[id] = amount; weight -= amount * RESOURCES[id].weight; volume -= amount * RESOURCES[id].volume; }
    }
  } else requested = source.components.farm ? SOURCE_PROFILES.field.outputs : SOURCE_PROFILES.tree.outputs;
  const rest = { ...remaining }, goods = extractBundle(rest, requested);
  if (!bundleSize(goods)) return false;
  work.cargo = makeCargo(goods, c.villageId, work.good);
  if (source.components.resourcePile) {
    const pile = source.components.resourcePile;
    pile.goods = rest;
    if (pile.villageId !== c.villageId) recordLoss(world.society.villages.find(v => v.id === pile.villageId), goods);
  }
  else if (source.components.farm) source.components.farm.grain = rest.grain ?? 0;
  if (!source.components.farm && !bundleSize(rest)) world.remove(source.id);
  return true;
}

const deathSpecies = (entity: Entity): string | undefined => entity.components.creature?.speciesId
  ?? (entity.components.person ? raceOf(entity) : entity.components.animal?.kind);
/** Planning and final death share one mass/age calculation; an unknown form borrows no animal body profile. */
export function deathGoods(world: World, entity: Entity): ResourceBundle {
  const species = deathSpecies(entity), profile = species && CREATURE_PROFILES[species];
  if (!profile || entity.components.raisedRemains) return {};
  const drops = world.registry.species.get(species!)?.parameters?.drops;
  const stats = entity.components.stats && unitStats(world, entity).values;
  return creatureDrops(drops?.base ?? profile.base, { baseMass: stats ? stats.mass : drops?.baseMass ?? profile.mass,
    modifier: 0, size: stats ? stats.scale / 10 : 0.1, child: !isAdult(entity) });
}
/** After removal only. Cargo is lost once; biological loot is a separate, finite source. */
export function releaseResources(world: World, entity: Entity, died = false, killerId?: number,
  captured?: { goods: ResourceBundle; thermal?: Entity['components']['thermal'] }): void {
  if (world.entities.has(entity.id) || !world.consumeResourceRelease(entity)) return;
  const c = entity.components.citizen, cargo = c?.work?.cargo;
  const village = (id: number | null | undefined) => world.society.villages.find(v => v.id === id);
  if (cargo) recordLoss(village(cargo.villageId), cargoContents(cargo));
  loseShipment(world, entity);
  const caravan = entity.components.caravan, ship = entity.components.ship;
  if (caravan?.food) recordLoss(village(caravan.fromId), packedFood(caravan.food, caravan.foodGoods));
  if (caravan?.gems) recordLoss(village(caravan.fromId), { gems: caravan.gems });
  if (ship?.cargo) {
    const port = world.entities.get(ship.homeId ?? ship.targetId ?? -1);
    recordLoss(village(ship.cargoOwnerId ?? port?.components.harbor?.villageId), packedFood(ship.cargo, ship.foodGoods));
  }
  for (const group of world.society.migrations) if (group.members.length === 1 && group.members[0] === entity.id) recordLoss(village(group.fromId), packedFood(group.food, group.foodGoods));
  const pile = entity.components.resourcePile;
  if (pile && bundleSize(pile.goods)) recordLoss(village(pile.villageId), pile.goods);
  if (!died || entity.components.raisedRemains || !entity.components.position) return;
  const species = deathSpecies(entity), goods = captured?.goods ?? deathGoods(world, entity);
  if (!species || !bundleSize(goods)) return;
  const ownerId = c?.villageId ?? entity.components.animal?.villageId ?? null;
  if (!world.terrain.isLand(entity.components.position.x, entity.components.position.y)) { recordLoss(village(ownerId), goods); return; }
  const remains = world.spawn('core:resource-pile', entity.components.position);
  if (remains) {
    Object.assign(remains.components.resourcePile!, { goods, species, originId: entity.id, createdAt: world.tick, villageId: ownerId });
    Object.assign(remains.components.combustible!, leatherRemainsFire(goods.leather ?? 0).combustible);
    if (goods.leather && captured?.thermal?.burning) Object.assign(remains.components.thermal!, captured.thermal);
    const killer = world.entities.get(killerId ?? -1);
    if (killer) collectKillDrops(world, killer, remains);
  }
  else recordLoss(village(ownerId), goods);
}

/** The killer must reach the body and have a supported carrier. Overflow stays in the same finite pile. */
export function collectKillDrops(world: World, killer: Entity, remains: Entity): boolean {
  const c = killer.components.citizen, pile = remains.components.resourcePile, old = c?.work?.cargo;
  if (world.paused || world.entities.get(killer.id) !== killer || world.entities.get(remains.id) !== remains || !pile || !c?.villageId
    || killer.components.thermal?.burning || remains.components.thermal?.burning
    || (remains.components.health?.current ?? 0) <= 0 || world.tick >= pile.createdAt + BONE.remainsTicks
    || !world.society.villages.some(v => v.id === c.villageId) || (killer.components.health?.current ?? 0) <= 0
    || !killer.components.person || !isAdult(killer) || !mayGather(killer, remains) || c.work?.reservation || c.work?.orderId !== undefined
    || old && old.villageId !== c.villageId || !killer.components.position || !remains.components.position
    || Math.hypot(killer.components.position.x - remains.components.position.x, killer.components.position.y - remains.components.position.y) > 2.1
    || !clearStorageApproach(world, killer.components.position, remains)) return false;
  const goods = old ? cargoContents(old) : {}, load = bundleLoad(goods), requested: ResourceBundle = {};
  let weight = 36 - load.weight, volume = 24 - load.volume;
  for (const [id, n] of entries(pile.goods)) {
    const amount = Math.max(0, Math.min(n, 12 - (goods[id] ?? 0), Math.floor(weight / RESOURCES[id].weight), Math.floor(volume / RESOURCES[id].volume)));
    if (amount) { requested[id] = amount; goods[id] = (goods[id] ?? 0) + amount; weight -= amount * RESOURCES[id].weight; volume -= amount * RESOURCES[id].volume; }
  }
  if (!bundleSize(requested)) return false;
  const cargo = makeCargo(goods, c.villageId, old?.good ?? c.work?.good);
  if (!cargo) return false;
  c.work ??= { good: cargo.good, progress: 0, cargo: null };
  c.work.cargo = cargo; // Publish the carrier before consuming the source.
  extractBundle(pile.goods, requested);
  if (pile.villageId !== c.villageId) recordLoss(world.society.villages.find(v => v.id === pile.villageId), requested);
  if (!bundleSize(pile.goods)) world.remove(remains.id);
  return true;
}
