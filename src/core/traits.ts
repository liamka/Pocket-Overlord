import { hasPhysiology } from './physiology';
import { canUseWorldEditors } from './world-rules';
import { unitName, memoryName } from './units';
import type { FormMark } from './metamorphosis';
import { removeStatus, adoptStatuses } from './status-effects';
import { TRAIT_DEFINITIONS, MIND_TRAITS, traitDefinitions, type TraitDefinition } from '../content/traits';
import { isAdult, reconcileStats, type StatModifier } from './unit-stats';
import type { Entity } from './types';
import type { World } from './world';
import { enrage, infect } from '../systems/afflictions';

export const TRAIT_SOURCES = ['birth','inherited','grown','event','editor','legacy','identity','book','biome'] as const;
export type TraitSource = typeof TRAIT_SOURCES[number];
export interface PersonalTrait { id: string; source: TraitSource; at: number; nextAt?: number; subject?: string }
export interface TraitState {
  biomeOrigin?: number | null;
  entries: PersonalTrait[]; born: boolean; inherited: boolean; grown: boolean; kills: number;
  nextEventId: number; lastTrigger?: { id: number; trait: string; at: number };
  lastBirthday: number;
}
const TRAIT_MARKS: Partial<Record<string, FormMark>> = {infected:'infected','mush-spores':'mush','tumor-infection':'tumor',blessed:'blessed'};
export function hasTrait(e: Entity, id: string): boolean {
  if (id === 'plague') return !!e.components.person?.plague;
  if (id === 'madness') return !!e.components.person?.madness;
  const mark = TRAIT_MARKS[id];
  return !!(mark && e.components.metamorphosis?.marks.includes(mark)) || (e.components.traits?.entries.some(t => t.id === id) ?? false);
}
export function traitCompatible(e: Entity, d: TraitDefinition): boolean {
  if (!e.components.unit || !e.components.health) return false;
  if (d.id === 'its-a-boat') return !!e.components.ship;
  if (['scar-of-divinity','metamorphed','clone'].includes(d.id)) return true;
  if (e.components.ship || e.components.ufo || e.components.kaiju) return false;
  if (d.scope === 'person' && !e.components.citizen) return false;
  if (['plague','madness','contagious','strong-minded'].includes(d.id)) return !!e.components.person || d.id === 'strong-minded';
  return true;
}
export function traitAvailable(d: TraitDefinition): boolean {
  return !d.pending || d.pending === 'actions' && d.id === 'the-chosen-one';
}
function addEntry(e: Entity, id: string, source: TraitSource, at: number, subject?: string): void {
  const s = e.components.traits, d = traitDefinitions[id];
  if (!s || !d || s.entries.some(t => t.id === id)) return;
  s.entries.push({id,source,at,...(d.interval ? {nextAt:at+d.interval} : {}),...(subject ? {subject} : {})});
  s.entries.sort((a,b) => a.id.localeCompare(b.id));
}
/** Adopt legacy owners without rerolling traits or resetting disease timers. */
export function initializeTraits(e: Entity, tick: number): void {
  if (!e.components.unit || !e.components.health || e.components.traits) return;
  e.components.traits = {entries:[],born:true,inherited:true,grown:isAdult(e),kills:0,nextEventId:1,
    lastBirthday:Math.floor(e.components.person?.age ?? e.components.animal?.age ?? 0)};
  if (e.components.ship) addEntry(e,'its-a-boat','identity',tick);
  if (e.components.stats?.immortal) addEntry(e,'immortal','legacy',tick);
  if (e.components.happiness?.psychopath) addEntry(e,'psychopath','legacy',tick);
  if (e.components.metamorphosis?.history.length) addEntry(e,'metamorphed','identity',tick);
  for (const [mark,id] of [['infected','infected'],['mush','mush-spores'],['tumor','tumor-infection'],['blessed','blessed']] as const) {
    if (e.components.metamorphosis?.marks.includes(mark)) addEntry(e,id,'legacy',tick);
  }
  adoptAfflictions(e,tick,'legacy');
}
export function adoptAfflictions(e: Entity, tick: number, source: TraitSource = 'event'): void {
  const s = e.components.traits;
  if (!s) return;
  for (const id of ['plague','madness']) {
    if (hasTrait(e,id)) addEntry(e,id,source,tick);
    else if (s.entries.some(t => t.id === id)) s.entries = s.entries.filter(t => t.id !== id);
  }
}
const modifierCache = new WeakMap<Entity, { ids: string[]; plague: boolean; madness: boolean; result: StatModifier[] }>();
export function traitModifiers(e: Entity): StatModifier[] {
  const entries = e.components.traits?.entries ?? [], plague = !!e.components.person?.plague, madness = !!e.components.person?.madness;
  const cached = modifierCache.get(e);
  if (cached && cached.plague === plague && cached.madness === madness && cached.ids.length === entries.length
    && entries.every((t, i) => t.id === cached.ids[i])) return cached.result;
  const result = entries.flatMap(t => {
    const d = traitDefinitions[t.id];
    if (!d || !hasTrait(e,t.id) || !traitAvailable(d)) return [];
    const flat = {...d.flat}, percent = {...d.percent};
    // Existing plague/madness keep their live severity and movement model. Never double-apply them.
    if (t.id === 'plague') { delete flat.stamina; delete percent.speed; }
    return [{id:`trait:${t.id}`,origin:'personal' as const,flat,percent}];
  });
  modifierCache.set(e, { ids: entries.map(t => t.id), plague, madness, result });
  return result;
}
export function traitOpinion(a: Entity, b: Entity): number {
  return (a.components.traits?.entries ?? []).reduce((n,t) => {
    const d = traitDefinitions[t.id];
    return n + (hasTrait(b,t.id) ? d.sameOpinion : d.conflicts.some(id => hasTrait(b,id)) ? d.oppositeOpinion : 0);
  },0);
}
function remove(world: World, e: Entity, id: string): void {
  const state = e.components.traits;
  if (!state) return;
  state.entries = state.entries.filter(t => t.id !== id);
  if (id === 'plague' || id === 'madness') removeStatus(world,e,id,'cured');
  if (id === 'immortal' && e.components.stats) e.components.stats.immortal = false;
  if (id === 'psychopath' && e.components.happiness) e.components.happiness.psychopath = false;
  if (id === 'plague' && e.components.person) delete e.components.person.plague;
  if (id === 'madness' && e.components.person) {
    delete e.components.person.madness;
    if (e.components.citizen) Object.assign(e.components.citizen,{task:'idle',targetId:null,path:[],reconsiderIn:0});
  }
  const mark = TRAIT_MARKS[id];
  if (mark && e.components.metamorphosis) e.components.metamorphosis.marks = e.components.metamorphosis.marks.filter(m => m !== mark);
}
/** A batch chooses conflicts in stable ID order, before a single stat reconciliation. */
export function acquireTraits(world: World, e: Entity, ids: readonly string[], source: TraitSource, subject?: string): string[] {
  if (world.entities.get(e.id) !== e || (e.components.health?.current ?? 0) <= 0 || !e.components.traits) return [];
  if (source === 'editor' && !canUseWorldEditors(world)) return [];
  const accepted: string[] = [];
  for (const id of [...new Set(ids)].sort()) {
    const d = Object.hasOwn(traitDefinitions,id) ? traitDefinitions[id] : undefined;
    if (!d || !traitCompatible(e,d) || !traitAvailable(d) || hasTrait(e,id)) continue;
    if (source === 'editor' && d.scope === 'special' || (source === 'birth' && (!d.randomBirth || !d.birth))) continue;
    if (d.conflicts.some(other => accepted.includes(other))) continue;
    const conflicts = d.conflicts.filter(other => hasTrait(e,other));
    // Immunity and an existing trait cannot be overwritten by an incoming infection or inheritance.
    if (conflicts.length && source !== 'editor') continue;
    for (const other of conflicts) remove(world,e,other);
    if (id === 'madness') { remove(world,e,'peaceful'); enrage(world,e); if (!e.components.person?.madness) continue; }
    if (id === 'plague') { infect(e); if (!e.components.person?.plague) continue; }
    addEntry(e,id,source,world.tick,subject);
    // enrage/infect may already have adopted the metadata; the request owns its provenance.
    const entry = e.components.traits.entries.find(t => t.id === id)!;
    Object.assign(entry,{source,at:world.tick,...(subject ? {subject} : {})});
    for (const status of [...(e.components.statuses?.active ?? [])]) if (traitBlocks(e,status.id)) removeStatus(world,e,status.id,'cured');
    accepted.push(id);
  }
  if (accepted.length && source === 'editor') addEntry(e,'scar-of-divinity','identity',world.tick);
  adoptStatuses(world,e);
  reconcileStats(world,e);
  return accepted;
}
export function removeTrait(world: World, e: Entity, id: string, method: 'cure' | 'editor' | 'status'): boolean {
  const d = Object.hasOwn(traitDefinitions,id) ? traitDefinitions[id] : undefined;
  if (method === 'editor' && !canUseWorldEditors(world)) return false;
  if (method === 'status' && id !== 'blessed') return false;
  if (world.entities.get(e.id) !== e || !d || !hasTrait(e,id) || method === 'cure' && !d.cure || method === 'editor' && d.scope === 'special') return false;
  remove(world,e,id);
  if (method === 'editor') addEntry(e,'scar-of-divinity','identity',world.tick);
  reconcileStats(world,e); return true;
}
export function editTrait(world: World, e: Entity, id: string, enabled: boolean): boolean {
  return enabled ? acquireTraits(world,e,[id],'editor').includes(id) : removeTrait(world,e,id,'editor');
}
function draw(world: World, e: Entity, weights: {id:string;weight:number}[]): string | undefined {
  const pool = weights.filter(w => w.weight > 0 && traitAvailable(traitDefinitions[w.id]) && traitCompatible(e,traitDefinitions[w.id])
    && !hasTrait(e,w.id) && !traitDefinitions[w.id].conflicts.some(id => hasTrait(e,id)));
  const total = pool.reduce((n,w) => n+w.weight,0);
  if (!total) return;
  let n = world.rng.next()*total;
  for (const w of pool) { n -= w.weight; if (n < 0) return w.id; }
}
/** Local balance: one weighted personal birth draw. Subspecies birth lists remain plan 31. */
export function birthTraits(world: World, e: Entity): void {
  const s = e.components.traits;
  if (!s || s.born) return;
  s.born = true;
  if (!e.components.person) return;
  const id = draw(world,e,TRAIT_DEFINITIONS.filter(d => d.randomBirth).map(d => ({id:d.id,weight:d.birth})));
  if (id) acquireTraits(world,e,[id],'birth');
}
/** One weighted parental draw, additive B+I; no reroll after loading or repeated birth callbacks. */
export function inheritTraits(world: World, e: Entity, parents: readonly Entity[]): void {
  const s = e.components.traits;
  if (!s || s.inherited) return;
  s.inherited = true;
  const weights = new Map<string,number>();
  const donors = new Map(parents.map(p => [p.id,{name:unitName(p),ids:(p.components.traits?.entries ?? []).filter(t => hasTrait(p,t.id)).map(t => t.id)}]));
  for (const id of e.components.citizen?.parents ?? e.components.animal?.parents ?? []) {
    const memory = world.unitHistory.find(m => m.id === id);
    if (!donors.has(id) && memory?.traitIds) donors.set(id,{name:memoryName(memory),ids:memory.traitIds});
  }
  for (const [,donor] of [...donors].sort(([a],[b]) => a-b)) for (const id of donor.ids) {
    const d = traitDefinitions[id];
    if (d.scope !== 'special' && d.birth+d.inherit > 0) weights.set(id,(weights.get(id) ?? 0)+d.birth+d.inherit);
  }
  if (parents.some(p => hasPhysiology(p, 'genetic-mirror'))) acquireTraits(world, e, [...weights.keys()], 'inherited');
  const id = draw(world,e,[...weights].sort(([a],[b]) => a.localeCompare(b)).map(([id,weight]) => ({id,weight})));
  if (id) acquireTraits(world,e,[id],'inherited',[...donors.values()].filter(d => d.ids.includes(id)).map(d => d.name).join(', ').slice(0,100));
  birthTraits(world,e);
}
export function growTraits(world: World, e: Entity): void {
  const s = e.components.traits;
  if (!s || s.grown || !isAdult(e)) return;
  s.grown = true;
  const count = Math.floor(world.rng.next() * 3);
  for (let i = 0; i < count; i++) {
    const id = draw(world,e,TRAIT_DEFINITIONS.map(d => ({id:d.id,weight:d.grow})));
    if (id) acquireTraits(world,e,[id],'grown');
  }
}
/** Integrations supply the next saved receipt only after their real action completes. */
export function traitEvent(world: World, e: Entity, eventId: number, ids: readonly string[], subject?: string, book = false): boolean {
  const s = e.components.traits;
  if (world.paused || !s || world.entities.get(e.id) !== e || (e.components.health?.current ?? 0) <= 0 || eventId !== s.nextEventId
    || !Number.isSafeInteger(eventId) || eventId >= Number.MAX_SAFE_INTEGER || ids.some(id => !Object.hasOwn(traitDefinitions,id))
    || subject !== undefined && (subject.length > 100 || /[\u0000-\u001f\u007f]/u.test(subject))) return false;
  s.nextEventId++;
  const unique = [...new Set(ids)].sort();
  const candidates = book ? unique.filter(id => MIND_TRAITS.includes(id) && world.rng.next() < 0.5) : unique;
  acquireTraits(world,e,candidates,book ? 'book' : 'event',subject);
  return true;
}
export function recordTraitTrigger(e: Entity, id: string, tick: number): void {
  const s = e.components.traits;
  if (s) { s.lastTrigger = {id:s.nextEventId++,trait:id,at:tick}; }
}

export function traitBlocks(e: Entity, effect: string): boolean {
  return (['plague','infected','mush-spores','tumor-infection','cough','coughing','ash-fever'].includes(effect) && hasTrait(e,'immune'))
    || effect === 'age' && hasTrait(e,'immortal')
    || effect === 'plague' && (hasTrait(e,'immortal') || hasTrait(e,'contagious'))
    || ['madness','rage','possessed','possessed-follower','tantrum','confused','join-or-die',
      'alien-mold-desire','evil-computer-desire','golden-egg-desire','ethereal-harp-desire'].includes(effect) && hasTrait(e,'strong-minded')
    || ['stun','stunned'].includes(effect) && hasTrait(e,'tough') || ['fire','burning'].includes(effect) && hasTrait(e,'fire-proof')
    || ['ice','frozen'].includes(effect) && hasTrait(e,'frost-proof') || ['poison','poisoned'].includes(effect) && hasTrait(e,'poison-immunity')
    || effect === 'cursed' && hasTrait(e,'evil') || ['angry','swearing'].includes(effect) && hasTrait(e,'peaceful')
    || effect === 'crying' && hasTrait(e,'strong-minded')
    || effect === 'acid' && (hasTrait(e,'acid-proof') || hasTrait(e,'acid-blood'));
}
