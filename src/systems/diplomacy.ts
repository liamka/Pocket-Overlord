import type { World } from '../core/world';
import { raceAffinity } from '../core/races';
import { roadIsIntact } from '../core/roads';
import { dispatchCaravan } from './caravans';
import { alliedGroup, allianceGroups, opposingSides, sideName } from '../core/diplomacy';
import { noise } from '../core/random';
import { SOCIAL_EVENT_RATE, type Entity, type War } from '../core/types';

export function atWar(world: World, a: number | null, b: number | null): boolean {
  return a !== null && b !== null && a !== b && world.society.wars.some(war => opposingSides(war, a, b));
}
const livingAdults = (world: World, members: number[]): Entity[] => [...world.query('person', 'citizen')]
  .filter(e => e.components.person!.age >= 18 && e.components.citizen!.task !== 'migrate' && members.includes(e.components.citizen!.villageId ?? -1));
const participants = (war: War): number[] => [...war.attackers, ...war.defenders];
const activeWar = (world: World, id: number): War | undefined => world.society.wars.find(w => participants(w).includes(id));

function resetOrders(world: World, members: number[]): void {
  for (const e of world.query('citizen')) if (members.includes(e.components.citizen!.villageId ?? -1)) {
    const c = e.components.citizen!;
    c.reconsiderIn = 0;
    if (c.task === 'fight') { c.task = 'idle'; c.targetId = null; c.path = []; }
  }
}

function setWarRelations(world: World, war: War): void {
  for (const r of world.society.relations) if (opposingSides(war, r.a, r.b)) {
    r.status = 'war'; r.since = war.started; r.affinity = Math.min(r.affinity, -25);
    r.nextDecision = world.tick + 300 / SOCIAL_EVENT_RATE;
  }
}

function prepareReinforcements(world: World, members: number[]): void {
  resetOrders(world, members);
  for (const e of livingAdults(world, members)) {
    if (e.id % 3 === 0) continue; // Part of the population keeps producing food.
    const c = e.components.citizen!, village = world.society.villages.find(v => v.id === c.villageId)!;
    if (village.food >= 1) { village.food--; c.hunger = Math.max(0, c.hunger - 35); }
  }
}

function compatibleSide(world: World, members: number[]): boolean {
  return !world.society.wars.some(w => members.some(a => w.attackers.includes(a)) && members.some(b => w.defenders.includes(b)));
}

export function formAlliance(world: World, a: number, b: number): boolean {
  if (a === b || !world.society.villages.some(v => v.id === a) || !world.society.villages.some(v => v.id === b)) return false;
  const left = alliedGroup(world.society, a), right = alliedGroup(world.society, b);
  if (left.includes(b)) return false;
  const merged = [...new Set([...left, ...right])].sort((x, y) => x - y);
  if (!compatibleSide(world, merged)) return false;
  // Every member consents: one friendly pair cannot force rivals into the same alliance.
  if (world.society.relations.some(r => merged.includes(r.a) && merged.includes(r.b) && r.affinity < 0)) return false;
  const wars = world.society.wars.filter(w => participants(w).some(id => merged.includes(id)));
  // Do not merge simultaneous, incompatible fronts through a new treaty.
  if (wars.length > 1) return false;
  for (const r of world.society.relations) if (merged.includes(r.a) && merged.includes(r.b)) {
    r.status = 'alliance'; r.affinity = Math.max(25, r.affinity); r.since = world.tick; r.nextDecision = world.tick + 300 / SOCIAL_EVENT_RATE;
  }
  const war = wars[0];
  if (war) {
    const side = war.attackers.some(id => merged.includes(id)) ? war.attackers : war.defenders;
    const added = merged.filter(id => !side.includes(id));
    side.push(...added); side.sort((x, y) => x - y);
    if (side === war.attackers) war.initialAttackers += livingAdults(world, added).length;
    else war.initialDefenders += livingAdults(world, added).length;
    setWarRelations(world, war); prepareReinforcements(world, added);
    if (added.length) world.announce(`${sideName(world.society, added)} вступает в войну на стороне союзников`);
  }
  world.announce(`Создан союз: ${sideName(world.society, merged)}`);
  return true;
}

export function leaveAlliance(world: World, id: number): boolean {
  if (activeWar(world, id)) return false;
  const group = alliedGroup(world.society, id);
  if (group.length < 2) return false;
  for (const r of world.society.relations) if (r.status === 'alliance' && (r.a === id || r.b === id)) {
    r.status = 'neutral'; r.affinity = 0; r.since = world.tick; r.nextDecision = world.tick + 900 / SOCIAL_EVENT_RATE;
  }
  world.announce(`${sideName(world.society, [id])} выходит из союза`);
  return true;
}

function connected(world: World, a: number[], b: number[]): boolean {
  const reached = new Set(a);
  for (const id of reached) for (const road of world.society.roads) {
    if (!roadIsIntact(world, road)) continue;
    if (road.a === id) reached.add(road.b);
    if (road.b === id) reached.add(road.a);
  }
  return b.some(id => reached.has(id));
}

function chooseObjectives(world: World, war: War): void {
  const society = world.society;
  const occupied = new Set([...world.query('dwelling')].map(e => e.components.dwelling!.villageId));
  const defenders = society.villages.filter(v => war.defenders.includes(v.id));
  const attackers = society.villages.filter(v => war.attackers.includes(v.id));
  if (!war.defenders.includes(war.attackTarget) || !occupied.has(war.attackTarget)) {
    const target = defenders.filter(v => occupied.has(v.id)).sort((a, b) => {
      const score = (v: typeof a): number => Math.min(...attackers.map(other => Math.hypot(v.x - other.x, v.y - other.y)));
      return score(a) - score(b) || a.id - b.id;
    })[0] ?? defenders[0];
    if (target) war.attackTarget = target.id;
  }
  if (!war.attackers.includes(war.rallyVillage) || !occupied.has(war.rallyVillage)) {
    const target = society.villages.find(v => v.id === war.attackTarget);
    const rally = attackers.filter(v => occupied.has(v.id)).sort((a, b) => target
      ? Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y) || a.id - b.id : a.id - b.id)[0] ?? attackers[0];
    if (rally) war.rallyVillage = rally.id;
  }
}

export function declareWar(world: World, a: number, b: number): War | undefined {
  if (a === b || !world.society.villages.some(v => v.id === a) || !world.society.villages.some(v => v.id === b)) return;
  const attackers = alliedGroup(world.society, a), defenders = alliedGroup(world.society, b);
  if (attackers.includes(b) || !connected(world, attackers, defenders)) return;
  const initialAttackers = livingAdults(world, attackers).length, initialDefenders = livingAdults(world, defenders).length;
  if (initialAttackers < 3 || initialDefenders < 3) return;
  const involved = world.society.wars.filter(w => participants(w).some(id => [...attackers, ...defenders].includes(id)));
  if (involved.length > 1) return;
  const existing = involved[0];
  if (existing) {
    if (opposingSides(existing, a, b)) return existing;
    const aOnAttack = existing.attackers.includes(a) || existing.defenders.includes(b);
    const left = aOnAttack ? existing.attackers : existing.defenders, right = aOnAttack ? existing.defenders : existing.attackers;
    const newLeft = [...new Set([...left, ...attackers])], newRight = [...new Set([...right, ...defenders])];
    if (newLeft.some(id => newRight.includes(id)) || !compatibleSide(world, newLeft) || !compatibleSide(world, newRight)) return;
    const addedLeft = newLeft.filter(id => !left.includes(id)), addedRight = newRight.filter(id => !right.includes(id));
    left.push(...addedLeft); right.push(...addedRight); left.sort((x, y) => x - y); right.sort((x, y) => x - y);
    existing.initialAttackers += livingAdults(world, aOnAttack ? addedLeft : addedRight).length;
    existing.initialDefenders += livingAdults(world, aOnAttack ? addedRight : addedLeft).length;
    setWarRelations(world, existing); prepareReinforcements(world, [...addedLeft, ...addedRight]);
    world.announce(`Коалиция растёт: ${sideName(world.society, [...addedLeft, ...addedRight])} вступает в общую войну`);
    return existing;
  }
  const war: War = { id: world.society.nextWarId++, attackers, defenders, started: world.tick, musterUntil: world.tick + 240,
    attackTarget: b, rallyVillage: a, initialAttackers, initialDefenders, lossesAttackers: 0, lossesDefenders: 0 };
  // Pick one border settlement where the attacking armies can assemble.
  war.rallyVillage = -1; chooseObjectives(world, war);
  world.society.wars.push(war); setWarRelations(world, war); prepareReinforcements(world, participants(war));
  world.announce(`Война: ${sideName(world.society, attackers)} против ${sideName(world.society, defenders)}. Сбор войск`);
  return war;
}

export function endWar(world: World, war: War, reason: string): void {
  if (!world.society.wars.some(w => w.id === war.id)) return;
  world.society.wars = world.society.wars.filter(w => w.id !== war.id);
  for (const r of world.society.relations) if (opposingSides(war, r.a, r.b) && !atWar(world, r.a, r.b)) {
    r.status = 'neutral'; r.affinity = -5; r.since = world.tick; r.nextDecision = world.tick + 1800 / SOCIAL_EVENT_RATE;
  }
  resetOrders(world, participants(war));
  world.announce(`Общее перемирие: ${sideName(world.society, war.attackers)} — ${sideName(world.society, war.defenders)}. ${reason}`);
}

export function campaigns(world: World): void {
  const alive = new Set(world.society.villages.map(v => v.id));
  for (const war of [...world.society.wars]) {
    war.attackers = war.attackers.filter(id => alive.has(id)); war.defenders = war.defenders.filter(id => alive.has(id));
    const a = livingAdults(world, war.attackers).length, b = livingAdults(world, war.defenders).length;
    if (!war.attackers.length || !war.defenders.length || a < 2 || b < 2) { endWar(world, war, 'Одна из сторон больше не может сражаться'); continue; }
    const age = world.tick - war.started;
    const exhausted = war.lossesAttackers >= Math.max(2, war.initialAttackers * 0.45) || war.lossesDefenders >= Math.max(2, war.initialDefenders * 0.45);
    const food = (side: number[]): number => world.society.villages.filter(v => side.includes(v.id)).reduce((sum, v) => sum + v.food, 0);
    if (exhausted || age >= 2700 || age >= 900 && (food(war.attackers) < a * 0.2 || food(war.defenders) < b * 0.2)) {
      endWar(world, war, exhausted ? 'Слишком большие потери' : age >= 2700 ? 'Стороны устали от войны' : 'Не хватает припасов'); continue;
    }
    chooseObjectives(world, war);
    if (world.tick >= war.musterUntil && world.tick - war.musterUntil < 30) {
      resetOrders(world, participants(war));
      world.announce(`Общий поход на ${sideName(world.society, [war.attackTarget])}`);
    }
  }
}

/** A shared village objective gives allied soldiers one destination; nearby enemies take priority. */
export function campaignObjective(world: World, villageId: number): number | undefined {
  const war = activeWar(world, villageId);
  if (!war) return;
  if (war.attackers.includes(villageId)) return world.tick < war.musterUntil ? war.rallyVillage : war.attackTarget;
  const counterattack = world.tick >= war.musterUntil && war.lossesAttackers >= Math.max(1, war.initialAttackers * 0.25);
  return counterattack ? war.rallyVillage : war.attackTarget;
}

export function diplomacy(world: World): void {
  if (world.tick % 30 !== 0) return;
  campaigns(world);
  const counts = new Map<number, number>();
  for (const e of world.query('citizen')) {
    const id = e.components.citizen!.villageId;
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const r of world.society.relations) {
    if (world.tick < r.nextDecision || r.status === 'war') continue;
    r.nextDecision = world.tick + 300 / SOCIAL_EVENT_RATE;
    const a = world.society.villages.find(v => v.id === r.a)!, b = world.society.villages.find(v => v.id === r.b)!;
    const na = counts.get(a.id) ?? 0, nb = counts.get(b.id) ?? 0;
    if (!na || !nb) continue;
    const scarce = a.food < na || b.food < nb;
    const rival = Math.hypot(a.x - b.x, a.y - b.y) < 42 && noise(a.id, b.id, world.seed) > 0.45;
    const sharedEnemy = world.society.wars.some(w => w.attackers.includes(a.id) && w.attackers.includes(b.id) || w.defenders.includes(a.id) && w.defenders.includes(b.id));
    // Food aid sustains existing alliances instead of hunger instantly turning friends into enemies.
    if (r.status === 'alliance') {
      const [donor, receiver, donorCount, receiverCount] = a.food / na > b.food / nb ? [a, b, na, nb] : [b, a, nb, na];
      const gift = Math.min(8, Math.max(0, donor.food - donorCount * 2), Math.max(0, receiverCount * 2 - receiver.food));
      const sent = gift >= 1 && dispatchCaravan(world, donor.id, receiver.id, gift);
      if (sent) {
        world.announce(`${donor.name} отправляет еду союзникам в ${receiver.name}`);
      }
      const incoming = [...world.query('caravan')].some(e => e.components.caravan!.toId === receiver.id && !e.components.caravan!.returning);
      r.affinity = Math.max(-100, Math.min(100, r.affinity + (sent || incoming ? 8 : scarce ? -8 : 4)));
      if (r.affinity < -10) leaveAlliance(world, a.id);
    } else {
      r.affinity = Math.max(-100, Math.min(100, r.affinity + (sharedEnemy ? 14 : scarce ? -14 : 7) - (rival ? 12 : 0) + (sharedEnemy ? 0 : raceAffinity(a.race, b.race) / 4)));
      if (r.affinity >= 20) formAlliance(world, a.id, b.id);
      else if (r.affinity <= -25) declareWar(world, a.id, b.id);
    }
  }
}

export { allianceGroups };
