import { spendNutrition } from './food';
import { physiologyBirth } from './physiology-events';
import { hasPhysiology, needsFood } from './physiology';
import { subspeciesRoom } from './physiology';
import { lawEnabled, settlementRoom } from './world-rules';
import type { World } from './world';
import { ENTITY_LIMIT, POPULATION_LIMIT, type Entity, type Vec2 } from './types';
import { birthReservations, reproductionSex, REPRODUCTION_INTERVAL, type PendingBirth, type ReproductionMethod, type ReproductionProfile, type ReproductionReason } from './reproduction-state';
import { subspeciesOf } from './subspecies-state';
import { compatibleParents } from './subspecies';
import { acquireTraits, hasTrait, inheritTraits } from './traits';
import { traitDefinitions } from '../content/traits';
import { biologicalAge, canBreed, intrinsicStat, isAdult, nutritionRemaining, preserveNutrition, reconcileStats } from './unit-stats';
import { applyStatus, hasStatus, removeStatus, statusBlocks, statusStops, statusRejection } from './status-effects';
import { hasCapability } from './capabilities';
import { collectivePolicy, familyOf, parentsOf, recordFamilyBirth } from './families';
import { canPerformFamilyAction } from './unit-tasks';
import { partnerOf } from './units';
import { findPath } from '../systems/navigation';
import { reservedBeds } from '../systems/migration';
import { marked, transformLiving } from './metamorphosis';
import { validReproductionProfile } from '../persistence/reproduction';
import { recordCreatureResult } from './creatures';
import { recordHappiness } from './happiness';
import { reproductionGeneBonus } from './gene-editor';
import { METHOD_TRAITS, changePhysiology, validPhysiology } from '../content/subspecies-traits';

export const reproductionProfile = (e: Entity): ReproductionProfile | undefined => {
  const profile = subspeciesOf(e)?.reproduction;
  if (!profile) return;
  const genes = reproductionGeneBonus(e);
  return { ...profile, offspringLimit: profile.offspringLimit + genes.offspring,
    birthRate: profile.birthRate + genes.birthRate + (hasPhysiology(e, 'high-fecundity') ? 5 : 0) };
};
const paired = (m: ReproductionMethod): boolean => m === 'sexual' || m === 'hermaphroditic';
const living = (world: World, e: Entity): boolean => world.entities.get(e.id) === e && (e.components.health?.current ?? 0) > 0;
const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const busy = (w: World, e: Entity): boolean => !!e.components.thermal?.burning || statusStops(e)
  || (e.components.citizen ? !canPerformFamilyAction(w, e) : e.components.animal?.targetId != null);
const receipt = (w: World, e: Entity, method: ReproductionMethod, reason: ReproductionReason): false => {
  if (e.components.reproduction) e.components.reproduction.last = { method, at: w.tick, reason };
  return false;
};
const pendingFor = (w: World, id: number): number => [...w.query('reproduction')].reduce((n, e) => {
  const p = e.components.reproduction!.pending; return n + (p?.parents.includes(id) ? p.children.length : 0);
}, 0);
const extra = (e: Entity, key: string): number => (e.components.traits?.entries ?? []).reduce((n, t) => n + (hasTrait(e, t.id) ? traitDefinitions[t.id].external[key] ?? 0 : 0), 0);

/** Profile selection belongs to physiology/editor integrations; active conceptions keep their captured form. */
export function setReproductionProfile(world: World, subspeciesId: number, profile: ReproductionProfile): boolean {
  const s = world.subspecies.records.find(s => s.id === subspeciesId);
  if (world.paused || !s || !validReproductionProfile(profile)) return false;
  const members = [...world.query('reproduction')].filter(e => e.components.subspecies?.id === s.id);
  if (!members.length || members.some(e => e.components.reproduction!.pending || e.components.reproduction!.egg)) return false;
  if (profile.habitat === 'water' && !world.registry.species.get(s.speciesId)?.runtime?.movement.includes('swim')) return false;
  let traits = [...s.traits];
  for (const id of METHOD_TRAITS) traits = changePhysiology(traits, id, false);
  traits = changePhysiology(changePhysiology(traits, 'oviparity', false), 'viviparity', false);
  if (profile.form !== 'direct') traits = changePhysiology(traits, profile.form, true);
  for (const id of profile.methods) traits = changePhysiology(traits, id, true);
  traits = changePhysiology(traits, 'aquatic', profile.habitat === 'water');
  if (!validPhysiology(traits) || profile.methods.some(id => !traits.includes(id))) return false;
  s.traits = traits;
  s.reproduction = structuredClone(profile); s.revision++; s.changedAt = world.tick;
  return true;
}

export function reproductionBlock(world: World, e: Entity, method: ReproductionMethod): ReproductionReason | undefined {
  const r = e.components.reproduction, profile = reproductionProfile(e);
  if (!living(world, e) || !r || !profile?.methods.includes(method)) return 'No reproduction method';
  if (!lawEnabled(world, e.components.person ? 'civ-babies' : 'animal-babies')) return 'Births disabled by world law';
  if (r.egg || !canBreed(e)) return 'Still growing';
  if (r.pending || pendingFor(world, e.id)) return 'Already expecting offspring';
  if ((r.cooldowns[method] ?? 0) > world.tick || statusBlocks(e, 'breed')) return 'Recovering after reproduction';
  if (needsFood(e) && nutritionRemaining(e) < 50) return 'Needs at least 50 nutrition';
  if (busy(world, e)) return 'Busy or in danger';
  if (r.born >= Math.max(0, Math.floor(profile.offspringLimit * (1 + extra(e, 'offspring') / 100)))) return 'Offspring limit reached';
  if ((method === 'budding' || method === 'fission') && e.components.health!.current < e.components.health!.max * 0.9) return 'Needs 90% health';
  if (method === 'parthenogenesis' && reproductionSex(e) !== 'a') return 'No compatible partner';
  if (method === 'divine') {
    if (r.divineUsed || hasTrait(e, 'miracle-bearer')) return 'Divine birth already used';
    if (biologicalAge(e) < intrinsicStat(e, 'lifespan') * 0.6) return 'Too young for divine birth';
    if (partnerOf(e) !== null) return 'Divine birth requires no partner';
  }
  if (method === 'spore' && !hasStatus(e, 'just-ate')) return 'Needs a recent meal';
  if (method === 'soulborne' && !hasStatus(e, 'soul-harvested')) return 'Needs a harvested soul';
}

function homeCapacity(w: World, e: Entity, mate?: Entity): { homeId: number | null; capacity: number } {
  const first = e.components.reproduction!.born === 0 && (!mate || mate.components.reproduction!.born === 0);
  if (!e.components.person) return { homeId: null, capacity: 9 };
  const homes = [...new Set([mate?.components.person?.homeId, e.components.person.homeId])];
  const reserved = reservedBeds(w);
  for (const id of homes) {
    const home = w.entities.get(id ?? -1), d = home?.components.dwelling;
    if (!home || !d || home.components.building?.project || home.components.thermal?.burning
      || d.villageId !== e.components.citizen?.villageId) continue;
    const residents = [...w.query('person')].filter(n => n.components.person!.homeId === id).length;
    const capacity = d.capacity - residents - (reserved.get(home.id) ?? 0);
    if (capacity > 0) return { homeId: home.id, capacity };
  }
  return { homeId: null, capacity: first ? 1 : 0 };
}
function familyCapacity(w: World, parents: Entity[]): number {
  const family = familyOf(w, parents[0]);
  if (family && family.founders.length === parents.length && parents.every(e => family.founders.includes(e.id))) {
    return family.limit - family.members.length - pendingFor(w, parents[0].id);
  }
  return (collectivePolicy(w.registry, parents[0])?.limit ?? 0) - parents.length;
}
function freeBirthplace(w: World, e: Entity, habitat: 'land' | 'water', fixed?: Vec2): Vec2 | undefined {
  const p = e.components.position!;
  const valid = (q: Vec2): boolean => w.terrain.inside(q.x, q.y) && w.terrain.isLand(q.x, q.y) === (habitat === 'land')
    && w.canStand(q, 0.2, -1, habitat === 'water') && !w.nearby(q, 1).some(n => n.components.thermal?.burning);
  if (fixed) return valid(fixed) ? { ...fixed } : undefined;
  for (const radius of [0.8, 1.4, 2]) for (let i = 0; i < 8; i++) {
    const q = { x: p.x + Math.cos(i * Math.PI / 4) * radius, y: p.y + Math.sin(i * Math.PI / 4) * radius };
    if (valid(q) && (habitat === 'water' || findPath(w, p, q, 0.3)?.every((v, index, path) => distance(index ? path[index - 1] : p, v) < 1.6))) return q;
  }
}
function compatibleMate(w: World, e: Entity, other: Entity, method: ReproductionMethod): boolean {
  const a = e.components.reproduction, b = other.components.reproduction;
  return other.id !== e.id && !!b && !!a && compatibleParents(e, other) && !reproductionBlock(w, other, method)
    && (method !== 'sexual' || reproductionSex(e) !== reproductionSex(other)) && !parentsOf(e).includes(other.id) && !parentsOf(other).includes(e.id)
    && !parentsOf(e).some(id => parentsOf(other).includes(id));
}

/** Start owns both reservation and food transfer. A failed start never spends food or rolls children. */
export function startReproduction(w: World, e: Entity, method: ReproductionMethod, partner?: Entity): boolean {
  if (w.paused) return false;
  const blocked = reproductionBlock(w, e, method);
  if (blocked) return receipt(w, e, method, blocked);
  if (method === 'metamorph') return receipt(w, e, method, 'Needs a harvested soul');
  const r = e.components.reproduction!, profile = reproductionProfile(e)!;
  let mate = partner;
  if (paired(method)) {
    mate ??= w.entities.get(partnerOf(e) ?? -1);
    if (!mate || !compatibleMate(w, e, mate, method)) return receipt(w, e, method, 'No compatible partner');
    if (method === 'sexual' && reproductionSex(e) !== 'a') return startReproduction(w, mate, method, e);
    const route = findPath(w, e.components.position!, mate.components.position!, 0.8);
    if (!route || route.some((p, i) => distance(i ? route[i - 1] : e.components.position!, p) > 1.6)) return receipt(w, e, method, 'No route to the partner');
    if (distance(e.components.position!, mate.components.position!) > 2.4) {
      if (e.components.citizen) Object.assign(e.components.citizen, { task: 'visit', targetId: mate.id, path: route, reconsiderIn: 2 });
      else if (e.components.animal) e.components.animal.path = route;
      return receipt(w, e, method, 'Partner is too far away');
    }
  } else mate = undefined;
  const parents = mate ? [e, mate] : [e], reservations = birthReservations(w.entities.values());
  const global = Math.min(ENTITY_LIMIT - w.entities.size - reservations.entities,
    e.components.person ? Math.min(POPULATION_LIMIT - w.population - reservations.people, settlementRoom(w, e.components.citizen?.villageId ?? null)) : ENTITY_LIMIT);
  const home = homeCapacity(w, e, mate), family = familyCapacity(w, parents);
  const offspring = Math.min(...parents.map(p => Math.floor(reproductionProfile(p)!.offspringLimit * (1 + extra(p, 'offspring') / 100)) - p.components.reproduction!.born - pendingFor(w, p.id)));
  const minimum = method === 'divine' ? 2 : method === 'spore' ? 3 : 1;
  if (e.components.person && settlementRoom(w, e.components.citizen?.villageId ?? null) < minimum) return receipt(w, e, method, 'Settlement population limit');
  if (global < minimum) return receipt(w, e, method, 'World population limit');
  if (subspeciesRoom(w, e) < minimum) return receipt(w, e, method, 'Subspecies population limit');
  if (offspring < minimum) return receipt(w, e, method, 'Offspring limit reached');
  if (family < minimum) return receipt(w, e, method, 'Family is full');
  // The first birth exception admits an entire divine/spore event outdoors, without overfilling a house.
  if (home.capacity < minimum && parents.every(p => p.components.reproduction!.born === 0)) { home.homeId = null; home.capacity = minimum; }
  if (home.capacity < minimum) return receipt(w, e, method, 'No room at home');
  if (!freeBirthplace(w, e, profile.habitat)) return receipt(w, e, method, 'No safe birthplace');
  const rngBefore = w.rng.state;
  const capacity = Math.min(9, global, offspring, family, home.capacity, subspeciesRoom(w, e));
  let count = minimum;
  if (method === 'spore') count = Math.min(capacity, 3 + Math.floor(w.rng.next() * 7));
  else if (method === 'divine') { if (capacity > 2 && w.rng.next() < 0.5) count++; }
  else if (method !== 'fission') {
    const attempts = Math.min(8, Math.max(0, Math.floor(profile.birthRate + extra(e, 'birthRate') + (method === 'sexual' ? 3 : 0))));
    for (let n = 0; n < attempts && count < capacity; n++) { if (w.rng.next() >= 0.5 * 0.85 ** n) break; count++; }
  }
  const form = ['budding', 'fission', 'vegetative', 'spore', 'divine'].includes(method) ? 'direct'
    : method === 'soulborne' && reproductionSex(e) !== 'a' ? 'direct' : profile.form;
  const ticks = Math.max(1, Math.round(150 * (profile.baseMaturation + profile.maturation)));
  const pending: PendingBirth = { method, form, parents: parents.map(p => p.id), typeId: e.typeId, subspeciesId: subspeciesOf(e)!.id,
    startedAt: w.tick, dueAt: w.tick + (method === 'spore' ? 90 : form === 'oviparity' || method === 'fission' || method === 'divine' || form === 'direct' && method === 'soulborne' ? 0 : ticks),
    homeId: home.homeId, children: [], reserved: true, habitat: profile.habitat };
  for (let i = 0; i < count; i++) {
    const sex = method === 'divine' && i < 2 ? i === 0 ? 'a' : 'b' : w.rng.next() < 0.5 ? 'a' : 'b';
    const angle = method === 'spore' ? w.rng.range(0, Math.PI * 2) : 0;
    const radius = method === 'spore' ? w.rng.range(1, 5) : 0, p = e.components.position!;
    pending.children.push({ sex, ...(method === 'spore' ? { point: { x: p.x + Math.cos(angle) * radius, y: p.y + Math.sin(angle) * radius } } : {}) });
  }
  r.pending = pending;
  const status = pendingStatus(pending);
  if (status && statusRejection(e, status)) {
    delete r.pending; w.rng.state = rngBefore;
    return receipt(w, e, method, 'Busy or in danger');
  }
  for (const p of parents) {
    p.components.reproduction!.cooldowns[method] = w.tick + REPRODUCTION_INTERVAL[method];
    if (method !== 'fission' && needsFood(p)) spendNutrition(p, 25);
    if (p.components.citizen) p.components.citizen.familyActionAt = w.tick;
    if (paired(method)) {
      const other = p === e ? mate : e;
      applyStatus(w, p, 'afterglow', { seconds: 15, source: other }); recordHappiness(w, p, 'kiss', other);
    }
  }
  if (status) applyStatus(w, e, status, { seconds: Math.max(1 / 30, (pending.dueAt - w.tick) / 30), source: mate });
  if (method === 'spore') removeStatus(w, e, 'just-ate', 'condition-ended');
  if (method === 'divine') { r.divineUsed = true; acquireTraits(w, e, ['miracle-bearer'], 'event'); }
  receipt(w, e, method, 'Waiting for maturation');
  resolveReproduction(w, e);
  return true;
}

export function pendingStatus(p: PendingBirth): 'pregnant' | 'budding' | 'taking-roots' | undefined {
  return p.method === 'budding' ? 'budding' : p.method === 'vegetative' ? 'taking-roots' : p.form === 'viviparity' ? 'pregnant' : undefined;
}
export function cancelReproduction(w: World, e: Entity, reason: ReproductionReason = 'Reproduction cancelled'): void {
  const r = e.components.reproduction, p = r?.pending;
  if (!r || !p) return;
  delete r.pending;
  const status = pendingStatus(p);
  if (status) removeStatus(w, e, status, 'removed');
  removeStatus(w, e, 'soul-harvested', 'condition-ended');
  receipt(w, e, p.method, reason);
}
export function releaseReproductionReferences(w: World, id: number): void {
  for (const e of [...w.query('reproduction')]) {
    const r = e.components.reproduction!;
    if (r.pending?.parents.includes(id)) cancelReproduction(w, e, 'Parent is gone');
    if (e.id !== id && r.egg?.parents.includes(id)) w.remove(e.id);
    if (r.pending?.homeId === id) r.pending.homeId = null;
  }
}
export function resolveReproduction(w: World, e: Entity): void {
  const r = e.components.reproduction, pending = r?.pending;
  if (w.paused || !r || !pending || !living(w, e) || w.tick < pending.dueAt) return;
  // Conception is already paid. Hunger, ordinary work and a lost home cannot restart or erase it.
  if (e.typeId !== pending.typeId || e.components.subspecies?.id !== pending.subspeciesId) { cancelReproduction(w, e, 'Body changed'); return; }
  while (pending.children.length) {
    const slot = pending.children[0], point = freeBirthplace(w, e, pending.habitat, slot.point);
    if (!point) {
      if (pending.method === 'spore') { pending.children.shift(); receipt(w, e, pending.method, 'Spore could not take root'); continue; }
      receipt(w, e, pending.method, 'Waiting for a free birthplace'); return;
    }
    const health = e.components.health!.current, food = nutritionRemaining(e), mood = e.components.happiness?.value ?? 0;
    const child = w.spawn(pending.typeId, point, undefined, 'born', pending.parents, e.id);
    if (!child) { receipt(w, e, pending.method, 'World population limit'); return; }
    pending.children.shift();
    const c = child.components, age = c.person ?? c.animal;
    if (age) age.age = 0;
    if (c.animal) c.reproduction!.sex = slot.sex;
    if (c.person) { c.person.sex = slot.sex; c.person.reproduceIn = 30; }
    if (c.stats) c.stats.lastBirthday = 0;
    if (c.unit) c.unit.bornAt = w.tick;
    if (c.citizen) { c.citizen.parents = [...pending.parents]; c.citizen.villageId = hasCapability(w.registry, child, 'citizenship') ? e.components.citizen?.villageId ?? null : null; }
    if (c.animal) { c.animal.parents = [...pending.parents]; c.animal.villageId = e.components.animal?.villageId ?? null; }
    const home = w.entities.get(pending.homeId ?? -1);
    if (c.person && c.citizen?.villageId != null && home?.components.dwelling?.villageId === c.citizen.villageId && !home.components.building?.project && !home.components.thermal?.burning
      && [...w.query('person')].filter(n => n.components.person!.homeId === home.id).length < home.components.dwelling.capacity) c.person.homeId = home.id;
    recordFamilyBirth(w, child, pending.parents);
    inheritTraits(w, child, pending.parents.map(id => w.entities.get(id)).filter((p): p is Entity => !!p));
    for (const id of pending.parents) { const p = w.entities.get(id)?.components.reproduction; if (p) p.born++; }
    if (pending.method === 'divine') acquireTraits(w, child, ['miracle-born'], 'identity');
    if (pending.method === 'vegetative') applyStatus(w, child, 'uprooting', { seconds: 8, source: e });
    if (pending.method === 'fission') {
      e.components.health!.current = health / 2; c.health!.current = Math.min(c.health!.max, health / 2);
      preserveNutrition(e, food / 2); preserveNutrition(child, food / 2);
      if (e.components.happiness) e.components.happiness.value = mood / 2;
      if (c.happiness) c.happiness.value = mood / 2;
      if (e.components.stats && c.stats) { c.stats.stamina = e.components.stats.stamina / 2; e.components.stats.stamina /= 2; c.stats.mana = e.components.stats.mana / 2; e.components.stats.mana /= 2; }
    }
    if (pending.form === 'oviparity') {
      const p = reproductionProfile(e)!, ticks = Math.max(1, Math.round(150 * (p.baseMaturation + p.maturation)));
      c.reproduction!.egg = { parents: [...pending.parents], laidAt: w.tick, hatchAt: w.tick + ticks };
      applyStatus(w, child, 'egg', { seconds: ticks / 30, source: e });
    }
    physiologyBirth(w, child);
    reconcileStats(w, child); reconcileStats(w, e);
    recordCreatureResult(w, e, 'born', child.id);
    receipt(w, e, pending.method, pending.form === 'oviparity' ? 'Egg laid' : 'Offspring born');
    w.visual({ kind: 'birth', ...point, radius: 1 });
  }
  delete r.pending;
  const status = pendingStatus(pending);
  if (status) removeStatus(w, e, status, 'condition-ended');
  removeStatus(w, e, 'soul-harvested', 'condition-ended');
}

export function reproductionSystem(w: World): void {
  if (w.paused) return;
  for (const e of [...w.query('reproduction', 'position', 'health')]) {
    if (!living(w, e)) continue;
    const r = e.components.reproduction!;
    if (r.egg) {
      if (w.tick >= r.egg.hatchAt) {
        delete r.egg; physiologyBirth(w, e, true); removeStatus(w, e, 'egg', 'condition-ended'); applyStatus(w, e, 'stunned', { seconds: 5 });
        if (e.components.happiness) delete e.components.happiness.egg;
        if (e.components.unit) e.components.unit.bornAt = w.tick;
        recordHappiness(w, e, 'birth'); w.visual({ kind: 'birth', ...e.components.position!, radius: 1 });
        receipt(w, e, 'sexual', 'Egg hatched');
      }
      continue;
    }
    if (r.pending) { resolveReproduction(w, e); continue; }
    if (w.tick % 30 !== e.id % 30) continue;
    for (const method of reproductionProfile(e)?.methods ?? []) {
      if (method === 'metamorph') continue;
      if ((r.cooldowns[method] ?? 0) > w.tick) continue;
      let mate = w.entities.get(partnerOf(e) ?? -1);
      if (paired(method) && !mate && e.components.animal) mate = w.nearby(e.components.position!, 6).filter(n => compatibleMate(w, e, n, method)).sort((a, b) => a.id - b.id)[0];
      if (method === 'sexual' && reproductionSex(e) !== 'a' || method === 'hermaphroditic' && mate && e.id > mate.id) continue;
      if (startReproduction(w, e, method, mate)) break;
      // Approaching uses the normal movement owner; retries do not become remote conceptions.
      r.cooldowns[method] = w.tick + (r.last?.reason === 'Partner is too far away' ? 30 : REPRODUCTION_INTERVAL[method]);
    }
  }
}
export function reproductionHit(w: World, attacker: Entity | undefined, target: Entity, damage: number): void {
  if (!attacker || w.paused || damage <= 0 || !living(w, attacker) || attacker.id === target.id) return;
  const profile = reproductionProfile(attacker);
  const soul = marked(target, 'soul') || !!w.registry.species.get(target.components.creature?.speciesId ?? '')?.runtime?.sapience;
  if (!profile || !soul) return;
  if (profile.methods.includes('metamorph') && living(w, target) && !isAdult(target) && !target.components.reproduction?.egg
    && target.components.subspecies?.id !== attacker.components.subspecies?.id) {
    transformLiving(w, target.id, { trigger: 'subspecies', sourceId: attacker.id });
    return;
  }
  if (profile.methods.includes('soulborne') && !attacker.components.reproduction?.pending && !hasStatus(attacker, 'soul-harvested')) {
    applyStatus(w, attacker, 'soul-harvested', { source: attacker });
    startReproduction(w, attacker, 'soulborne');
  }
}

/** Hook for cloning powers. The original is one parent, never its own child or partner. */
export function cloneOffspring(w: World, source: Entity): Entity | undefined {
  const profile = reproductionProfile(source);
  if (w.paused || subspeciesRoom(w, source) < 1 || !living(w, source) || !source.components.reproduction || !profile || familyCapacity(w, [source]) < 1) return;
  const point = freeBirthplace(w, source, profile.habitat);
  const child = point && w.spawn(source.typeId, point, undefined, 'cloned', [source.id]);
  if (!child) return;
  const c = child.components;
  c.creature!.origin = 'cloned'; c.reproduction!.cloneOf = source.id;
  if (c.person) { c.person.age = 0; c.person.sex = reproductionSex(source); c.citizen!.parents = [source.id]; }
  if (c.animal) { c.animal.age = 0; c.animal.parents = [source.id]; c.reproduction!.sex = reproductionSex(source); }
  c.unit!.bornAt = w.tick; c.stats!.lastBirthday = 0;
  c.subspecies!.deviations = structuredClone(source.components.subspecies!.deviations);
  recordFamilyBirth(w, child, [source.id]); inheritTraits(w, child, [source]);
  acquireTraits(w, child, ['clone', 'miracle-born'], 'identity');
  source.components.reproduction.born++; reconcileStats(w, child);
  w.visual({ kind: 'birth', ...point!, radius: 1 });
  return child;
}
