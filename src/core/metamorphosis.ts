import { hasPhysiology } from './physiology';
import { hasTrait, traitCompatible } from './traits';
import { birthReservations, reproductionSex } from './reproduction-state';
import { hasStatus, statusBlocks } from './status-effects';
import { traitDefinitions } from '../content/traits';
import { initializeStats, intrinsicStat, isAdult } from './unit-stats';
import { newExperience } from './unit-levels';
import type { Components, Entity, Vec2 } from './types';
import { ENTITY_LIMIT, POPULATION_LIMIT, Terrain } from './types';
import type { World } from './world';
import { Random } from './random';
import { raceOf } from './races';
import { initializeUnit, partnerOf, unitName } from './units';
import { compareElders, initializeKinship, parentsOf } from './families';
import { canUseEquipment, relocateItem, type EquipmentItem } from './equipment';
import { canGovern } from './capabilities';
import { deathOf, recordPosthumousForm, type DamageContext } from './death';

/** Inputs owned by transformations. These do not implement contagion, traits or epochs. */
export const FORM_MARKS = ['rebirth', 'wolf-rebirth', 'infected', 'mush', 'tumor', 'cursed', 'blessed', 'pure', 'rage', 'soul'] as const;
export type FormMark = typeof FORM_MARKS[number];
export type FormTrigger = 'death' | 'enemy-killed' | 'monolith' | 'snow' | 'appearance' | 'subspecies';
export interface TransformationContext {
  trigger: FormTrigger;
  sourceId?: number;
  cloudId?: number;
  age?: 'chaos' | 'despair';
  disasters?: boolean;
  death?: DamageContext;
}
export interface FormHistory {
  fromId: number; fromType: string; toType: string; rule: string; at: number;
  change: 'body' | 'appearance' | 'subspecies'; removed: string[];
}
export interface Metamorphosis {
  marks: FormMark[]; history: FormHistory[];
  attemptedKills?: { at: number; victims: number[] };
}
declare module './types' {
  interface ComponentMap { metamorphosis: Metamorphosis }
  interface GameEventMap { transform: { target: number; context: TransformationContext } }
}
export interface TransformationDefinition {
  id: string; label: string; trigger: FormTrigger; sources: readonly string[]; target: string | 'self'; priority: number;
  change: FormHistory['change']; identity: 'continue' | 'new'; items: 'compatible-or-ground' | 'leave';
  additional?: boolean; rejuvenate?: boolean; chance?: number; remove: readonly FormMark[];
  eligible: (world: World, entity: Entity, context: TransformationContext) => boolean;
  /** Appearance/subspecies integrations must supply their own real component migration. */
  migrate?: (components: Components, source: Entity, world: World, context: TransformationContext) => void;
}
export interface PreparedForm { rule: TransformationDefinition; source: Entity; components: Components; typeId: string; rngState: number }
export const marked = (e: Entity, mark: FormMark): boolean => {
  if (mark === 'pure' && hasPhysiology(e, 'pure') || mark === 'rebirth' && hasPhysiology(e, 'fenix-born') || mark === 'wolf-rebirth' && hasPhysiology(e, 'wolf-metamorphosis')) return true;
  if ((mark === 'cursed' || mark === 'rage') && hasStatus(e, mark)) return true;
  const id = ({ infected: 'infected', mush: 'mush-spores', tumor: 'tumor-infection', blessed: 'blessed' } as Partial<Record<FormMark, string>>)[mark];
  return id && e.components.traits ? hasTrait(e, id) : e.components.metamorphosis?.marks.includes(mark) ?? false;
};
export const lifespanOf = (e: Entity): number | undefined => e.components.person || e.components.animal ? intrinsicStat(e, 'lifespan') : undefined;
export function rebirthEligible(e: Entity): boolean {
  const lifespan = lifespanOf(e), age = e.components.person?.age ?? e.components.animal?.age;
  return lifespan !== undefined && age !== undefined && age >= lifespan * 0.7;
}
export function setRebirth(world: World, entity: Entity, choice: 'none' | 'self' | 'wolf'): boolean {
  if (world.entities.get(entity.id) !== entity || (entity.components.health?.current ?? 0) <= 0 || lifespanOf(entity) === undefined) return false;
  const rule = world.registry.transformations.get(choice === 'wolf' ? 'core:wolf-rebirth' : 'core:rebirth');
  if (choice !== 'none' && !rule?.sources.includes(entity.typeId)) return false;
  const state = entity.components.metamorphosis ??= { marks: [], history: [] };
  state.marks = state.marks.filter(mark => mark !== 'rebirth' && mark !== 'wolf-rebirth');
  if (choice !== 'none') state.marks.push(choice === 'self' ? 'rebirth' : 'wolf-rebirth');
  return true;
}

/** Check the whole footprint, including neighbouring terrain cells; no RNG draw. */
function placement(world: World, point: Vec2, components: Components, typeId: string, ignoreId: number): Vec2 | undefined {
  const runtime = world.registry.species.get(world.registry.entities.get(typeId)?.speciesId ?? '')?.runtime;
  const radius = components.solid?.radius ?? (components.person ? 0.25 : components.animal ? 0.4 : 0.6);
  const fly = runtime?.movement.includes('fly'), water = runtime?.movement.includes('swim') || runtime?.movement.includes('sail');
  const valid = (p: Vec2): boolean => {
    for (const dx of [-radius, 0, radius]) for (const dy of [-radius, 0, radius]) {
      if (!world.terrain.inside(p.x + dx, p.y + dy)) return false;
      if (!fly && !world.terrain.isLand(p.x + dx, p.y + dy) && !(water && world.terrain.at(p.x + dx, p.y + dy) <= Terrain.Water)) return false;
      if (runtime?.movement.includes('sail') && world.terrain.isLand(p.x + dx, p.y + dy)) return false;
    }
    return !!fly || world.canStand(p, radius, ignoreId, !!water);
  };
  if (valid(point)) return { ...point };
  for (let ring = 1; ring <= 12; ring++) for (let i = 0; i < ring * 8; i++) {
    const angle = i / (ring * 8) * Math.PI * 2, p = { x: point.x + Math.cos(angle) * ring * 0.5, y: point.y + Math.sin(angle) * ring * 0.5 };
    if (valid(p)) return p;
  }
}

export function prepareForm(world: World, entity: Entity, context: TransformationContext, additional = false): PreparedForm | undefined {
  if (!entity.components.position || !entity.components.unit) return;
  if (context.trigger === 'monolith' && statusBlocks(entity, 'evolve')) return;
  const attempted = entity.components.metamorphosis?.attemptedKills;
  if (context.trigger === 'enemy-killed' && context.sourceId !== undefined && attempted?.at === world.tick && attempted.victims.includes(context.sourceId)) return;
  const rules = [...world.registry.transformations.values()].filter(rule => rule.trigger === context.trigger && !!rule.additional === additional
    && rule.sources.includes(entity.typeId) && rule.eligible(world, entity, context)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const rule of rules) {
    const typeId = rule.target === 'self' ? entity.typeId : rule.target, definition = world.registry.entities.get(typeId);
    if (!definition?.speciesId || !world.registry.species.get(definition.speciesId)?.runtime) continue;
    if (rule.change !== 'body' && (typeId !== entity.typeId || !rule.migrate)) continue;
    if (additional && world.entities.size >= ENTITY_LIMIT) return;
    const rng = new Random(world.rng.state), components = rule.change === 'body' ? definition.create(entity.components.position, rng) : structuredClone(entity.components);
    const source = structuredClone(entity), c = source.components;
    if (rule.identity === 'continue') {
      components.unit = structuredClone(c.unit!);
      const parents = [...parentsOf(source)];
      if (components.citizen) components.citizen.parents = parents;
      if (components.animal) components.animal.parents = parents;
      if (components.person && c.person) components.person.sex = c.person.sex;
    }
    if (rule.rejuvenate) {
      if (components.person) components.person.age = 0;
      if (components.animal) components.animal.age = 0;
      if (components.unit) components.unit.bornAt = world.tick;
    } else if (rule.change === 'body') {
      if (components.person) components.person.age = c.person?.age ?? c.animal?.age ?? 20;
      if (components.animal) components.animal.age = c.person?.age ?? c.animal?.age ?? 20;
    }
    if (!components.person && !components.animal && components.unit) components.unit.bornAt = null;
    const removed: string[] = (c.metamorphosis?.marks ?? []).filter(mark => rule.remove.includes(mark));
    if (rule.change === 'body') {
      if (c.person?.plague) removed.push('Plague');
      if (c.person?.madness) removed.push('Madness');
      if (c.thermal?.burning) removed.push('Burning');
      if (c.combat && Object.keys(c.combat.statuses).length) removed.push('Combat effects');
    }
    components.metamorphosis = { marks: rule.identity === 'continue' ? (c.metamorphosis?.marks ?? []).filter(mark => !rule.remove.includes(mark)) : [],
      ...(rule.identity === 'continue' && c.metamorphosis?.attemptedKills ? { attemptedKills: structuredClone(c.metamorphosis.attemptedKills) } : {}),
      history: [...(c.metamorphosis?.history ?? []).slice(-15), { fromId: entity.id, fromType: entity.typeId, toType: typeId, rule: rule.id, at: world.tick, change: rule.change, removed }] };
    components.creature = { speciesId: definition.speciesId, origin: 'transformed', since: world.tick };
    if (rule.identity === 'continue' && c.happiness && world.registry.species.get(definition.speciesId)?.runtime?.amygdala) {
      components.happiness = structuredClone(c.happiness);
      components.happiness.starving = (components.citizen?.hunger ?? components.animal?.hunger ?? 0) >= (components.animal ? 95 : 90);
      components.happiness.grown = isAdult({ ...entity, components });
      if (!components.person) components.happiness.home = null;
    } else delete components.happiness;
    if (rule.identity === 'continue' && c.subspecies && c.creature?.speciesId === definition.speciesId) components.subspecies = structuredClone(c.subspecies);
    if (rule.identity === 'continue' && c.reproduction && (components.person || components.animal)) {
      components.reproduction = structuredClone(c.reproduction);
      if (rule.change === 'body') { delete components.reproduction.pending; delete components.reproduction.egg; }
      if (components.person) delete components.reproduction.sex;
      else components.reproduction.sex = reproductionSex(source);
    }
    if (c.raisedRemains) components.raisedRemains = structuredClone(c.raisedRemains);
    rule.migrate?.(components, source, world, context);
    initializeStats({ id: entity.id, typeId, components }, world.tick);
    if (components.stats && rule.identity === 'new') {
      components.stats.level = 1; components.stats.xpIntoLevel = 0; components.stats.experience = newExperience();
    }
    if (components.stats && c.stats && rule.identity === 'continue') {
      components.stats.level = c.stats.level;
      components.stats.xpIntoLevel = c.stats.xpIntoLevel;
      components.stats.experience = structuredClone(c.stats.experience);
      if (rule.change === 'body') delete components.stats.experience.ruling;
      components.stats.learned = structuredClone(c.stats.learned);
      components.stats.lastBirthday = Math.floor(components.person?.age ?? components.animal?.age ?? 0);
      // A new body has its own base and temporary effects; personal progress survives.
      if (rule.change === 'body') {
        components.stats.modifiers = structuredClone(c.stats.modifiers.filter(m => m.origin === 'personal' || m.origin === 'culture'));
        components.stats.stamina = Math.min(components.stats.stamina, c.stats.stamina);
        components.stats.mana = Math.min(components.stats.base.mana, c.stats.mana);
        components.stats.ageOvergrowth = rule.rejuvenate ? 0 : c.stats.ageOvergrowth;
        components.stats.immortal = c.stats.immortal;
      }
    }
    if (c.traits && rule.identity === 'continue') {
      const next = { id: entity.id, typeId, components };
      components.traits = structuredClone(c.traits);
      const removedTraits = new Set(rule.remove.flatMap(mark => ({infected:['infected'],mush:['mush-spores'],tumor:['tumor-infection'],blessed:['blessed']} as Record<string,string[]>)[mark] ?? []));
      if (rule.change === 'body') for (const id of ['plague','madness','peaceful']) removedTraits.add(id);
      components.traits.entries = components.traits.entries.filter(t => {
        const keep = !removedTraits.has(t.id) && traitCompatible(next,traitDefinitions[t.id]);
        if (!keep) components.metamorphosis!.history.at(-1)!.removed.push(traitDefinitions[t.id].label);
        return keep;
      });
      if (!components.traits.entries.some(t => t.id === 'metamorphed')) components.traits.entries.push({id:'metamorphed',source:'identity',at:world.tick});
      components.traits.lastBirthday = Math.floor(components.person?.age ?? components.animal?.age ?? 0);
      components.traits.grown = isAdult(next);
    }
    const reserved = birthReservations(world.entities.values());
    if (additional && world.entities.size + reserved.entities >= ENTITY_LIMIT) continue;
    if (components.person && world.population + reserved.people - Number(!!entity.components.person && !additional) >= POPULATION_LIMIT) continue;
    const point = placement(world, entity.components.position, components, typeId, additional ? -1 : entity.id);
    if (!point) continue;
    components.position = point;
    if (context.trigger === 'enemy-killed' && context.sourceId !== undefined) {
      const state = entity.components.metamorphosis ??= { marks: [], history: [] };
      if (state.attemptedKills?.at !== world.tick) state.attemptedKills = { at: world.tick, victims: [] };
      state.attemptedKills.victims.push(context.sourceId);
      components.metamorphosis!.attemptedKills = structuredClone(state.attemptedKills);
    }
    // Only eligible, placeable transitions consume randomness. A failed roll ends this trigger.
    if (rule.chance !== undefined && rng.next() >= rule.chance) { world.rng.state = rng.state; return; }
    return { rule, source, components, typeId, rngState: rng.state };
  }
}

export function keepsFamily(form: PreparedForm): boolean {
  return form.rule.identity === 'continue' && form.source.components.creature?.speciesId === form.components.creature?.speciesId;
}
export function keepsOffice(world: World, form: PreparedForm): boolean {
  return form.rule.identity === 'continue' && form.components.person?.race === form.source.components.person?.race
    && canGovern(world.registry, { id: form.source.id, typeId: form.typeId, components: form.components });
}
export function finishForm(world: World, form: PreparedForm, entity: Entity, died: boolean, items: EquipmentItem[] = []): void {
  const { source, rule } = form, oldId = source.id, c = entity.components;
  initializeUnit(entity, world.tick); initializeKinship(entity);
  if (rule.identity === 'continue') {
    for (const other of world.query('kinship')) {
      const herd = other.components.kinship?.herd;
      if (herd?.followId === oldId) { herd.followId = null; herd.moveIn = herd.followIn = 0; if (other.components.animal) other.components.animal.path = []; }
    }
    const k = source.components.kinship;
    if (k && c.kinship) {
      c.kinship.originFamilyId = k.originFamilyId;
      c.kinship.previousFamilyId = keepsFamily(form) ? k.previousFamilyId : k.familyId ?? k.previousFamilyId;
      if (keepsFamily(form) && k.familyId !== null) {
        const family = world.families.records.find(f => f.id === k.familyId && f.dissolvedAt === null);
        if (family) {
          family.members = family.members.map(id => id === oldId ? entity.id : id); c.kinship.familyId = family.id;
          if (family.type === 'alpha') family.alphaId = [...family.members].sort((a, b) => compareElders(world.entities.get(a)!, world.entities.get(b)!))[0];
        }
      }
    }
    const partnerId = partnerOf(source), partner = world.entities.get(partnerId ?? -1);
    if (!partner) c.unit!.partnerId = null;
    if (partner?.components.unit) {
      c.unit!.partnerId = partner.id; partner.components.unit.partnerId = entity.id;
      c.unit!.lostPartnerId = null; partner.components.unit.lostPartnerId = null;
      if (c.citizen && partner.components.citizen && raceOf(entity) === raceOf(partner)) {
        c.citizen.partnerId = partner.id; partner.components.citizen.partnerId = entity.id;
      }
    }
    for (const other of world.query('unit')) {
      const u = other.components.unit!;
      if (u.bestFriendId === oldId || u.lostFriendId === oldId) { u.bestFriendId = entity.id; u.lostFriendId = null; }
    }
    if (c.unit!.bestFriendId !== null && !world.entities.has(c.unit!.bestFriendId)) c.unit!.bestFriendId = null;
    if (died) {
      const memory = world.unitHistory.find(m => m.id === oldId);
      if (memory) { memory.continuedAs = entity.id; memory.identity.favorite = false; }
    }
    for (const item of items) relocateItem(world, item, canUseEquipment(entity, world.registry) && item.location.kind === 'equipped'
      ? { kind: 'equipped', entityId: entity.id } : { kind: 'ground', ...c.position! }, 'transformed');
  }
  if (died && !rule.additional) recordPosthumousForm(world, oldId, entity);
  if (died && rule.additional) {
    const memory = world.unitHistory.find(m => m.id === oldId);
    if (memory) memory.echoId = entity.id;
  }
  world.visual({ kind: 'birth', ...c.position!, radius: 1.5 });
  world.announce(`${unitName(entity)} changed form: ${rule.label}`);
}

/** No active transition timer: the saved event queue is the only pending work. */
export function transformLiving(world: World, id: number, context: TransformationContext): boolean {
  if (world.paused || context.trigger === 'death') return false;
  const source = world.entities.get(id);
  if (!source || (source.components.health?.current ?? 0) <= 0 || context.sourceId !== undefined
    && !world.entities.has(context.sourceId) && !(context.trigger === 'enemy-killed' && deathOf(world, context.sourceId)?.tick === world.tick)) return false;
  const form = prepareForm(world, source, context);
  if (!form) return false;
  world.applyLivingForm(form);
  return true;
}
