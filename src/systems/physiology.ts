import { canEatNow, consumeFood, foodAt, mealStores } from '../core/food';
import { harvestFoodPlant } from '../core/food-plants';
import { physiologyDiet } from '../core/physiology';
import { isFood } from '../content/food-catalog';
import type { World } from '../core/world';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import { hasPhysiology, needsFood, newPhysiology } from '../core/physiology';
import { intrinsicStat, nutritionRemaining, preserveNutrition, reconcileStats } from '../core/unit-stats';
import { applyStatus, hasStatus, removeStatus, statusStops } from '../core/status-effects';
import { acquireTraits, removeTrait } from '../core/traits';
import { subspeciesOf } from '../core/subspecies-state';
import { cleanDepositClaims, depositUnit, mineralDeposit } from '../core/deposits';
import { SOURCE_PROFILES } from '../core/resources';
import { canPlaceGold, placeGoldOre } from '../content/gold';
import { spawnGemSource } from '../core/gems';
import { canMove, recordCreatureResult } from '../core/creatures';
import { findPath } from './navigation';
import { cancelJob } from '../core/jobs';
import { clearStorageApproach, deliveryStore } from '../core/stockpiles';
import { deposit, withdraw } from '../core/resource-ledger';
import { lawEnabled } from '../core/world-rules';
import { seasonAt } from '../core/seasons';
import { deathGoods } from '../core/resource-sources';
import { attackReach, performAttack } from './equipment';
import { liftedIds } from '../core/cataclysms';
import { aboardFerry } from '../core/ferries';
import { decisionBlock } from '../core/neurons';
import { cancelBehaviour } from '../core/behaviour';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const report = (w: World, e: Entity, text: string): void => { e.components.physiology!.result = { at: w.tick, text }; };
const feed = (w: World, e: Entity, amount: number): void => {
  preserveNutrition(e, nutritionRemaining(e) + amount); e.components.physiology!.lastMealAt = w.tick;
  applyStatus(w, e, 'just-ate'); removeStatus(w, e, 'starving', 'condition-ended'); recordCreatureResult(w, e, 'fed', null); report(w, e, 'Food consumed');
};
/** Mineral claims remain authoritative: a mouth can only take an unreserved lot. */
export function consumeMineral(world: World, actor: Entity, source: Entity): boolean {
  const p = actor.components.position, q = source.components.position, state = actor.components.physiology;
  if (!canEatNow(world, actor) || !state || state.lastMealAt === world.tick || !hasPhysiology(actor, 'lithotroph') || !needsFood(actor)
    || world.entities.get(actor.id) !== actor || world.entities.get(source.id) !== source || !p || !q || distance(p, q) > 2.1
    || (actor.components.health?.current ?? 0) <= 0 || (source.components.health?.current ?? 0) <= 0
    || actor.components.thermal?.burning || source.components.thermal?.burning || nutritionRemaining(actor) >= intrinsicStat(actor, 'nutrition')
    || !clearStorageApproach(world, p, source)) return false;
  const d = mineralDeposit(source);
  if (d) {
    cleanDepositClaims(world, source);
    const amount = depositUnit(d.profile)[SOURCE_PROFILES[d.profile].primary]!;
    if (d.remaining - d.claims.reduce((n, c) => n + c.amount, 0) < amount) return false;
    const good = SOURCE_PROFILES[d.profile].primary;
    if (!isFood(good) || !physiologyDiet(actor).includes(good)) return false;
    d.remaining -= amount; if (!d.remaining) world.remove(source.id);
    return consumeFood(world, actor, { [good]: amount });
  }
  const gem = source.components.gemSource;
  if (!gem || gem.kind !== 'ore' || gem.remaining <= 0 || !physiologyDiet(actor).includes('gems')) return false;
  if (--gem.remaining === 0) world.remove(source.id);
  return consumeFood(world, actor, { gems: 1 });
}
export function photosynthesize(world: World, actor: Entity): boolean {
  const s = actor.components.physiology;
  if (world.paused || world.entities.get(actor.id) !== actor || !s || world.tick < s.photoAfter || !hasPhysiology(actor, 'photosynthetic-skin') || (actor.components.health?.current ?? 0) <= 0) return false;
  s.photoAfter = world.tick + 300;
  if (['dark', 'despair'].includes(world.registry.biomeClimate(world).age)) { report(world, actor, 'No sunlight'); return false; }
  preserveNutrition(actor, nutritionRemaining(actor) + 2 + Math.floor(world.rng.next() * 8)); report(world, actor, 'Nutrition from sunlight'); return true;
}
export function produceMineral(world: World, actor: Entity): boolean {
  const s = actor.components.physiology, p = actor.components.position;
  if (world.paused || world.entities.get(actor.id) !== actor || !s || !p || world.tick < s.produceAfter || (actor.components.health?.current ?? 0) <= 0) return false;
  s.produceAfter = world.tick + 1800;
  const kind = (['stone', 'gold', 'gem'] as const).find(k => hasPhysiology(actor, `${k}-production`));
  if (!kind || !needsFood(actor) || nutritionRemaining(actor) < 30) return false;
  // Local balance: one production consumes 20 nutrition; a failed placement consumes nothing.
  for (let i = 0; i < 8; i++) {
    const q = { x: p.x + Math.cos(i * Math.PI / 4) * 2.8, y: p.y + Math.sin(i * Math.PI / 4) * 2.8 };
    if (!canPlaceGold(world, q)) continue;
    const source = kind === 'gold' ? placeGoldOre(world, q, 'biology') : kind === 'gem' ? spawnGemSource(world, q, 'biology') : world.spawn('core:stone', q);
    if (!source) continue;
    if (source.components.stone) source.components.stone.origin = 'biology';
    preserveNutrition(actor, nutritionRemaining(actor) - 20); report(world, actor, 'Biological deposit created'); return true;
  }
  report(world, actor, 'No room for a biological deposit'); return false;
}
export function physiologyBirthday(world: World, actor: Entity): void {
  if (world.paused || world.entities.get(actor.id) !== actor || (actor.components.health?.current ?? 0) <= 0) return;
  if (hasPhysiology(actor, 'accelerated-healing')) for (const id of ['infected', 'mush-spores', 'tumor-infection', 'plague', 'crippled', 'one-eyed', 'skin-burns']) removeTrait(world, actor, id, 'cure');
  if (hasPhysiology(actor, 'genetic-psychosis') && (actor.components.person?.age ?? actor.components.animal?.age ?? 0) >= intrinsicStat(actor, 'lifespan') * 0.7 && world.rng.next() < 0.01) acquireTraits(world, actor, ['madness'], 'event');
  if (hasPhysiology(actor, 'bad-genes') && world.rng.next() < 0.01) acquireTraits(world, actor, [['fragile-health', 'weak', 'slow', 'fat', 'ugly'][Math.floor(world.rng.next() * 5)]], 'event');
  if (hasPhysiology(actor, 'rapid-aging')) for (let i = 0; i < 2; i++) if (world.rng.next() < 0.5) {
    const body = actor.components.person ?? actor.components.animal; if (body) body.age = Math.min(1e8, body.age + 1);
  }
}
function prey(world: World, actor: Entity, target: Entity): boolean {
  if (target.id === actor.id || (target.components.health?.current ?? 0) <= 0 || !target.components.creature || !deathGoods(world, target).meat) return false;
  if (target.components.creature.speciesId === actor.components.creature?.speciesId) return hasPhysiology(actor, 'cannibalism') && hasStatus(actor, 'starving') && nutritionRemaining(actor) < intrinsicStat(actor, 'nutrition') * 0.1;
  if (hasPhysiology(actor, 'insectivore')) return world.registry.species.get(target.components.creature.speciesId)?.group === 'insects';
  return (hasPhysiology(actor, 'carnivore') || hasPhysiology(actor, 'hematophagy')) && intrinsicStat(target, 'scale') <= intrinsicStat(actor, 'scale');
}
function stop(actor: Entity): void {
  delete actor.components.physiology!.action;
  if (actor.components.citizen) { actor.components.citizen.path = []; actor.components.citizen.targetId = null; actor.components.citizen.task = 'idle'; }
  if (actor.components.animal) { actor.components.animal.path = []; actor.components.animal.targetId = null; }
}
function route(world: World, actor: Entity, target: Vec2, reach: number): Vec2[] | undefined {
  if (hasPhysiology(actor, 'unmoving')) return distance(actor.components.position!, target) <= reach ? [] : undefined;
  if (hasPhysiology(actor, 'hovering')) return [{ ...target }];
  const swimming = hasPhysiology(actor, 'aquatic') || canMove(world.registry, actor, 'swim') && (hasPhysiology(actor, 'algivore') || hasPhysiology(actor, 'piscivore'));
  return findPath(world, actor.components.position!, target, reach, undefined, swimming);
}
function setPath(actor: Entity, path: Vec2[]): void {
  if (actor.components.citizen) actor.components.citizen.path = path;
  if (actor.components.animal) actor.components.animal.path = path;
}
function act(world: World, actor: Entity): boolean {
  const s = actor.components.physiology!, a = s.action, p = actor.components.position!;
  if (!a) return false;
  const target = world.entities.get(a.targetId ?? -1), point = target?.components.position ?? a;
  if (a.targetId !== null && !target || actor.components.thermal?.burning || actor.components.citizen?.emergency || statusStops(actor)) { stop(actor); return false; }
  const reach = a.kind === 'prey' ? attackReach(world, actor, target) * 0.9 : a.kind === 'water' || a.kind === 'soil' || a.kind === 'flower' ? 0.8 : 2;
  if (distance(p, point) > reach || target && a.kind !== 'prey' && !clearStorageApproach(world, p, target)) {
    const path = route(world, actor, point, reach * 0.8);
    if (!path) { report(world, actor, 'No route to food'); stop(actor); return false; }
    setPath(actor, path); return true;
  }
  let eaten = false;
  const broad = hasPhysiology(actor, 'herbivore') || hasPhysiology(actor, 'omnivore');
  if (a.kind === 'honey' && target && s.pollen >= 10) {
    const village = world.society.villages.find(v => v.id === (actor.components.citizen?.villageId ?? actor.components.animal?.villageId));
    if (village && deposit(village, { honey: 1 }, target.id).honey === 1) { s.pollen = 0; report(world, actor, 'Honey delivered'); }
    stop(actor); return true;
  }
  if (a.kind === 'fruit' && target?.components.foodPlant && canEatNow(world, actor) && physiologyDiet(actor).includes(target.components.foodPlant.good)) {
    const goods = harvestFoodPlant(world, actor, target); if (goods) eaten = consumeFood(world, actor, goods);
  }
  if (a.kind === 'meal' && target && actor.components.animal && canEatNow(world, actor)) {
    const village = world.society.villages.find(v => v.id === actor.components.animal!.villageId);
    const good = village && foodAt(world, actor, village, target);
    if (village && good && withdraw(village, { [good]: 1 }, 'consume', target.id)) eaten = consumeFood(world, actor, { [good]: 1 });
  }
  if (a.kind === 'mineral' && target) eaten = consumeMineral(world, actor, target);
  if (a.kind === 'wood' && canEatNow(world, actor) && physiologyDiet(actor).includes('wood') && hasPhysiology(actor, 'xylophagy') && target?.components.tree && !target.components.tree.claim) {
    world.remove(target.id); eaten = consumeFood(world, actor, { wood: 1 });
  }
  if (a.kind === 'crop' && canEatNow(world, actor) && physiologyDiet(actor).includes('grain') && (hasPhysiology(actor, 'granivore') || hasPhysiology(actor, 'herbivore')) && target?.components.farm && (target.components.farm.grain ?? 0) >= 1) {
    target.components.farm.grain!--; eaten = consumeFood(world, actor, { grain: 1 });
  }
  if (a.kind === 'prey' && target && prey(world, actor, target)) {
    const wanted = target.components.health!.max * (hasPhysiology(actor, 'hematophagy') ? 0.05 : 0.15) + 1;
    if (performAttack(world, actor, target, wanted / Math.max(1, intrinsicStat(actor, 'damage')))) report(world, actor, 'Hunting for food');
    return true;
  }
  if (a.kind === 'water' && world.terrain.isOpenWater(p.x, p.y)) {
    if (hasPhysiology(actor, 'piscivore')) eaten = consumeFood(world, actor, { fish: 1 });
    else if (hasPhysiology(actor, 'algivore')) { feed(world, actor, intrinsicStat(actor, 'nutrition')); eaten = true; }
    stop(actor); return true;
  }
  const cell = world.terrain.cell(a.x, a.y), flower = cell.top?.startsWith('flower-');
  if ((a.kind === 'soil' || a.kind === 'flower') && (!world.canStand(a, 0.2, actor.id)
    || world.nearby(a, 1).some(e => e.components.building || e.components.farm))) {
    report(world, actor, 'Food source is unavailable'); stop(actor); return false;
  }
  if (a.kind === 'flower' && flower && hasPhysiology(actor, 'pollinator')) {
    const index = world.terrain.index(a.x, a.y);
    if (s.flower !== index) { s.flower = index; s.visits = 0; }
    s.pollen = Math.min(10, s.pollen + 1); s.visits++;
    if (s.visits >= 6) {
      s.visits = 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const q = { x: a.x + dx, y: a.y + dy }, next = world.terrain.cell(q.x, q.y);
        if (next.plantable && !next.top && world.canStand(q, 0.3)) { world.terrain.setLayers(q.x, q.y, { top: cell.top }); break; }
      }
    }
    report(world, actor, 'Flower pollinated'); eaten = true;
  } else if (a.kind === 'flower' && flower && (broad || hasPhysiology(actor, 'folivore') || hasPhysiology(actor, 'florivore') || hasPhysiology(actor, 'nectarivore'))) {
    const nectar = hasPhysiology(actor, 'nectarivore');
    if (!nectar) world.terrain.setLayers(a.x, a.y, { top: undefined });
    feed(world, actor, nectar ? 7.5 : hasPhysiology(actor, 'folivore') ? 10 : 15); eaten = true;
  }
  if (a.kind === 'soil' && cell.tile === Terrain.Grass && !cell.top && seasonAt(world.tick).growth > 0
    && (hasPhysiology(actor, 'geophagy') || hasPhysiology(actor, 'graminivore') || hasPhysiology(actor, 'herbivore'))) {
    const geophagy = hasPhysiology(actor, 'geophagy');
    world.terrain.set(a.x, a.y, geophagy ? Terrain.Crater : Terrain.Sand);
    if (cell.biome.ecology.origin.creature.length && world.rng.next() < 0.3) {
      const pool = cell.biome.ecology.origin.creature; acquireTraits(world, actor, [pool[Math.floor(world.rng.next() * pool.length)]], 'biome');
    }
    feed(world, actor, 30); eaten = true;
  }
  if (!eaten) report(world, actor, 'Food source is unavailable'); stop(actor); return eaten;
}
function choose(world: World, actor: Entity): void {
  const s = actor.components.physiology!, p = actor.components.position!, c = actor.components.citizen;
  if (c?.work?.cargo || c?.task === 'migrate' || c?.emergency || actor.components.thermal?.burning || decisionBlock(world, actor)) return;
  const hungry = needsFood(actor) && nutritionRemaining(actor) < intrinsicStat(actor, 'nutrition') * 0.45;
  const water = hasPhysiology(actor, 'aquatic') && world.terrain.isLand(p.x, p.y);
  if (!hungry && !water && !hasPhysiology(actor, 'pollinator')) return;
  const options: NonNullable<typeof s.action>[] = [];
  if (hungry) for (const target of world.nearby(p, 12)) {
    const q = target.components.position!;
    if (target.components.thermal?.burning) continue;
    if (target.components.foodPlant?.remaining && physiologyDiet(actor).includes(target.components.foodPlant.good)) options.push({ kind: 'fruit', targetId: target.id, ...q });
    else if (hasPhysiology(actor, 'lithotroph') && (mineralDeposit(target) && physiologyDiet(actor).includes(SOURCE_PROFILES[mineralDeposit(target)!.profile].primary)
      || target.components.gemSource?.kind === 'ore' && physiologyDiet(actor).includes('gems'))) options.push({ kind: 'mineral', targetId: target.id, ...q });
    else if (hasPhysiology(actor, 'xylophagy') && target.components.tree && !target.components.tree.claim) options.push({ kind: 'wood', targetId: target.id, ...q });
    else if ((hasPhysiology(actor, 'granivore') || hasPhysiology(actor, 'herbivore')) && (target.components.farm?.grain ?? 0) >= 1) options.push({ kind: 'crop', targetId: target.id, ...q });
    else if (prey(world, actor, target) && !lawEnabled(world, 'peaceful-monsters')) options.push({ kind: 'prey', targetId: target.id, ...q });
  }
  if (hungry && actor.components.animal) {
    const village = world.society.villages.find(v => v.id === actor.components.animal!.villageId);
    if (village) for (const store of mealStores(world, actor, village)) options.push({ kind: 'meal', targetId: store.id, ...store.components.position! });
  }
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) {
    const q = { x: Math.floor(p.x) + dx + 0.5, y: Math.floor(p.y) + dy + 0.5 };
    if (!world.terrain.inside(q.x, q.y)) continue;
    const cell = world.terrain.cell(q.x, q.y);
    if ((water || hungry && (hasPhysiology(actor, 'algivore') || hasPhysiology(actor, 'piscivore'))) && cell.water && !cell.ice) options.push({ kind: 'water', targetId: null, ...q });
    else if (cell.top?.startsWith('flower-') && (hasPhysiology(actor, 'pollinator') || hungry && ['herbivore', 'omnivore', 'folivore', 'florivore', 'nectarivore'].some(id => subspeciesOf(actor)?.traits.includes(id as 'herbivore')))) options.push({ kind: 'flower', targetId: null, ...q });
    else if (hungry && cell.tile === Terrain.Grass && !cell.top && seasonAt(world.tick).growth > 0 && ['herbivore', 'graminivore', 'geophagy'].some(id => subspeciesOf(actor)?.traits.includes(id as 'herbivore'))
      && !world.nearby(q, 1).some(e => e.components.building || e.components.farm)) options.push({ kind: 'soil', targetId: null, ...q });
  }
  options.sort((a, b) => distance(p, a) - distance(p, b) || (a.targetId ?? 0) - (b.targetId ?? 0));
  for (const choice of options.slice(0, 4)) {
    const path = route(world, actor, choice, choice.targetId === null ? 0.6 : 1.6);
    if (!path) continue;
    if (c) { cancelJob(world, actor, 'Target is no longer available'); cancelBehaviour(world, actor); c.task = 'idle'; c.targetId = null; }
    s.action = choice; setPath(actor, path); report(world, actor, 'Approaching food source'); return;
  }
  if (hungry || water) report(world, actor, 'No reachable food source');
}
export function physiologySystem(world: World): void {
  if (world.paused) return;
  if (lawEnabled(world, 'grin-reaper') && world.tick % 30 === 0) {
    const marked = world.subspecies.records.filter(s => s.traits.includes('grin-mark') && s.created > s.died + s.departed);
    if (marked.length) {
      const selected = marked[Math.floor(world.rng.next() * marked.length)];
      const members = [...world.query('subspecies', 'health')].filter(e => e.components.subspecies!.id === selected.id && e.components.health!.current > 0);
      if (members.length) { const victim = members[Math.floor(world.rng.next() * members.length)]; world.events.push({ kind: 'damage', target: victim.id, amount: 1e6, cause: 'divine' }); }
    }
  }
  const lifted = liftedIds(world), age = world.registry.biomeClimate(world).age;
  for (const actor of world.query('subspecies', 'position', 'health')) {
    if (actor.components.health!.current <= 0 || lifted.has(actor.id) || aboardFerry(world, actor.id)) continue;
    const s = actor.components.physiology ??= newPhysiology(world.tick), p = actor.components.position!;
    if (world.tick < s.after) continue;
    s.after = world.tick + 30;
    if (actor.components.reproduction?.egg) continue;
    photosynthesize(world, actor); produceMineral(world, actor);
    const indoors = world.nearby(p, 2).some(e => e.components.dwelling && !e.components.building?.project && !e.components.thermal?.burning);
    if (hasPhysiology(actor, 'aquatic') && world.terrain.isLand(p.x, p.y) || hasPhysiology(actor, 'hydrophobia') && (world.terrain.isOpenWater(p.x, p.y)
      || (actor.components.thermal?.wetness ?? 0) > 0.25 || !indoors && ['tears', 'ice', 'despair'].includes(age))) {
      if (actor.components.stats) actor.components.stats.stamina = Math.max(0, actor.components.stats.stamina - 5);
      world.events.push({ kind: 'damage', target: actor.id, amount: Math.max(1, actor.components.health!.max * 0.1), cause: 'water' });
    }
    if (s.pollen >= 10) {
      const village = world.society.villages.find(v => v.id === (actor.components.citizen?.villageId ?? actor.components.animal?.villageId));
      const store = village && deliveryStore(world, village, p, { honey: 1 });
      if (store && distance(p, store.building.components.position!) <= 2.1 && clearStorageApproach(world, p, store.building)
        && deposit(village!, { honey: 1 }, store.building.id).honey === 1) { s.pollen = 0; report(world, actor, 'Honey delivered'); }
      else if (store && !s.action && !decisionBlock(world, actor) && !actor.components.citizen?.work?.cargo) {
        cancelJob(world, actor, 'Target is no longer available'); cancelBehaviour(world, actor);
        s.action = { kind: 'honey', targetId: store.building.id, ...store.building.components.position! }; setPath(actor, store.path);
      }
    }
    if (hasPhysiology(actor, 'unstable-genome') && world.tick >= s.shuffleAfter) {
      s.shuffleAfter = world.tick + 1800;
      const shared = subspeciesOf(actor)!;
      if (shared.genetics && ![...world.query('subspecies')].some(e => e.id < actor.id && e.components.subspecies!.id === shared.id)) {
        const next = structuredClone(shared.genetics), cells = next.chromosomes.flatMap(c => c.cells).filter(n => n.kind === 'open');
        for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(world.rng.next() * (i + 1)); [cells[i].gene, cells[j].gene] = [cells[j].gene, cells[i].gene]; }
        const members = [...world.query('subspecies')].filter(e => e.components.subspecies!.id === shared.id), nutrition = members.map(nutritionRemaining);
        shared.genetics = next; shared.revision++; shared.changedAt = world.tick;
        members.forEach((e, i) => { preserveNutrition(e, nutrition[i]); reconcileStats(world, e); });
      }
    }
    const hibernate = hasPhysiology(actor, 'nocturnal-dormancy') && ['dark', 'despair'].includes(age)
      || hasPhysiology(actor, 'circadian-drift') && ['hope', 'wonders'].includes(age) || hasPhysiology(actor, 'winter-slumberers') && ['ice', 'despair'].includes(age)
      || hasPhysiology(actor, 'chaos-driven') && age !== 'chaos';
    if (world.tick >= s.sleepAfter && !s.action && !decisionBlock(world, actor) && !actor.components.citizen?.emergency
      && (!actor.components.citizen || actor.components.citizen.task === 'idle' && !actor.components.citizen.path.length && actor.components.citizen.behaviour?.status !== 'active')
      && !actor.components.thermal?.burning && nutritionRemaining(actor) > intrinsicStat(actor, 'nutrition') * 0.6
      && (hibernate || hasPhysiology(actor, 'polyphasic-sleep') || hasPhysiology(actor, 'monophasic-sleep'))) {
      const mono = hasPhysiology(actor, 'monophasic-sleep');
      const hasDormancy = (['nocturnal-dormancy', 'circadian-drift', 'winter-slumberers', 'chaos-driven'] as const).some(id => hasPhysiology(actor, id));
      const seconds = (hibernate || !mono && !hasDormancy ? 100 : mono ? world.rng.range(40, 90) : world.rng.range(20, 60)) * (hasPhysiology(actor, 'prolonged-rest') ? 2 : 1);
      s.sleepAfter = world.tick + Math.round(seconds * 30) + (hibernate ? 900 : mono ? 6000 : 2700);
      applyStatus(world, actor, 'sleeping', { seconds });
    }
    if (!act(world, actor)) choose(world, actor);
  }
}

/** The damage owner supplies the actual hit, after armor, once. */
export function physiologyHit(world: World, actor: Entity, victim: Entity, damage: number): void {
  if (damage <= 0 || !actor.components.physiology || actor.components.physiology.lastMealAt === world.tick || !needsFood(actor)
    || actor.components.physiology.action?.kind !== 'prey' || actor.components.physiology.action.targetId !== victim.id) return;
  if (physiologyDiet(actor).includes('meat')) consumeFood(world, actor, { meat: Math.min(1, damage / Math.max(1, victim.components.health!.max)) });
  else feed(world, actor, hasPhysiology(actor, 'hematophagy') ? 10 : damage);
}
