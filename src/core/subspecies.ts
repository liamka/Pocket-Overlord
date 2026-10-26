import { normalizedPhysiology, physiologyProblem, physiologyReproduction, needsFood, drawPhysiologyMutation } from './physiology';
import { cancelReproduction } from './reproduction';
import { validReproductionProfile } from '../persistence/reproduction';
import { removeStatus } from './status-effects';
import { cancelJob } from './jobs';
import { drawOriginTraits } from './biome-ecology';
import { lawEnabled } from './world-rules';
import { GENOME_GENERATION } from '../content/genes';
import type { Entity, Vec2 } from './types';
import type { World } from './world';
import { bindSubspecies, defaultReproduction, defaultSubspeciesTraits, emptyGenome, hasSubspecies, SUBSPECIES_RADIUS, subspeciesOf, SUBSPECIES_TRAITS, type Genome, type Subspecies, type SubspeciesTrait } from './subspecies-state';
import { validBirthTraits, validGenes, validSubspeciesTraits } from '../persistence/subspecies';
import { nutritionRemaining, preserveNutrition, reconcileStats } from './unit-stats';
import { acquireTraits } from './traits';
import { reconcileOffices, suspendCivilDuties } from '../systems/capabilities';
import { releaseJob } from './jobs';
import { cancelFerryBoarding } from './ferries';
import { cargoContents, makeCargo, packedFood } from './resource-ledger';
import { bundleLoad, bundleSize, entries, extractBundle, RESOURCES } from './resources';
import type { Cargo } from './village-life';
import { calculateGenome, generateGenome, geneticSex, mutateGenome } from './genetics';
import { BIRTH_MUTATION } from '../content/genes';
import { newPhenotype } from './phenotypes';

/** Pure preview and placement share radius, species check and stable tie-breaking. */
export function nearbySubspecies(world: World, speciesId: string, point: Vec2): Entity | undefined {
  return world.nearby(point, SUBSPECIES_RADIUS).filter(e => e.components.creature?.speciesId === speciesId
    && subspeciesOf(e) && (e.components.health?.current ?? 0) > 0
    && Math.hypot(e.components.position!.x - point.x, e.components.position!.y - point.y) <= SUBSPECIES_RADIUS)
    .sort((a, b) => Math.hypot(a.components.position!.x - point.x, a.components.position!.y - point.y)
      - Math.hypot(b.components.position!.x - point.x, b.components.position!.y - point.y) || a.id - b.id)[0];
}
export function compatibleParents(a: Entity, b: Entity): boolean {
  return !!a.components.creature && a.components.creature.speciesId === b.components.creature?.speciesId;
}
/** Maternal line for residents; lowest parent ID for the existing sexless herd model. */
export function inheritedSubspecies(world: World, speciesId: string, parents: readonly number[]): Subspecies | undefined {
  const donors = parents.map(id => world.entities.get(id)).filter((e): e is Entity => !!e && e.components.creature?.speciesId === speciesId)
    .sort((a, b) => Number(b.components.person?.sex === 'a') - Number(a.components.person?.sex === 'a') || a.id - b.id);
  return donors.length ? subspeciesOf(donors[0]) : undefined;
}
export function attachSubspecies(world: World, entity: Entity, parents: readonly number[] = [], loading = false): void {
  const species = world.registry.species.get(entity.components.creature?.speciesId ?? '');
  if (!hasSubspecies(species)) { delete entity.components.subspecies; return; }
  let shared = world.subspecies.records.find(s => s.id === entity.components.subspecies?.id && s.speciesId === species!.id);
  if (!shared && loading) throw new Error('Missing subspecies in saved world');
  if (!shared) {
    shared = inheritedSubspecies(world, species!.id, parents)
      ?? subspeciesOf(nearbySubspecies(world, species!.id, entity.components.position!));
    if (!shared) {
      const parameters = species!.parameters;
      const targets = parameters?.genomeBudget && Object.fromEntries(Object.entries(parameters.genomeBudget).filter((entry): entry is [string, number] => entry[1] !== null));
      shared = { id: world.subspecies.nextId++, speciesId: species!.id, reproduction: defaultReproduction(species!.runtime?.reproduction), genome: emptyGenome(),
        ...(parameters?.genomeBudget === null ? {} : { genetics: generateGenome(world.rng, world.seed, parameters?.firstChromosome ?? 'tiny', targets || undefined, { ...GENOME_GENERATION, spaghetti: lawEnabled(world, 'gene-spaghetti') }) }),
        traits: defaultSubspeciesTraits(species!), birthTraits: [], phenotype: newPhenotype(world, species!, entity),
        origin: { kind: entity.components.creature!.origin, at: world.tick, founderId: entity.id },
        created: 0, born: 0, died: 0, departed: 0, revision: 0, changedAt: world.tick };
      const biome = world.terrain.biomeAt(entity.components.position!.x, entity.components.position!.y);
      shared.biomeOrigin = biome.id;
      const ecology = biome.ecology;
      for (const trait of drawOriginTraits(ecology.origin.subspecies, () => world.rng.next())) if (!shared.traits.includes(trait)) shared.traits.push(trait);
      if (ecology.adaptation && !shared.traits.includes(ecology.adaptation)) shared.traits.push(ecology.adaptation);
      if (lawEnabled(world, 'mutant-box')) {
        const count = 1 + Math.floor(world.rng.next() * 4), before = shared.traits;
        for (let i = 0; i < count; i++) shared.traits = drawPhysiologyMutation(world, entity, shared.traits);
        const profile = physiologyReproduction(shared.reproduction!, before, shared.traits);
        if (validReproductionProfile(profile)) shared.reproduction = profile;
        else shared.traits = before;
      }
      world.subspecies.records.push(shared);
    }
    if (entity.components.creature?.origin === 'born' && parents.length && shared.genetics) {
      const donor = parents.map(id => world.entities.get(id)).find(e => subspeciesOf(e)?.id === shared!.id);
      const mutation = calculateGenome(shared.genetics, donor ? geneticSex(donor) : 'a').mutation;
      if (mutation > 0 && world.rng.next() < Math.min(BIRTH_MUTATION.maximumChance, mutation * BIRTH_MUTATION.chancePerPoint)) {
        const { genome, changes } = mutateGenome(shared.genetics, world.rng, mutation), parentId = shared.id;
        if (changes) {
          // A birth branches before changing physiology; existing relatives keep their profile.
          shared = { ...structuredClone(shared), id: world.subspecies.nextId++, genetics: genome,
            origin: { kind: 'born', at: world.tick, founderId: entity.id }, created: 0, born: 0, died: 0, departed: 0, revision: 0, changedAt: world.tick };
          genome.lineage = { parentId, at: world.tick, reason: 'birth-mutation', geneChanges: changes, traitChanges: 0 };
          const before = shared.traits;
          const next = drawPhysiologyMutation(world, entity, before, world.rng.next() < 0.5);
          const reproduction = physiologyReproduction(shared.reproduction!, before, next);
          if (validReproductionProfile(reproduction)) {
            shared.traits = next; shared.reproduction = reproduction;
            genome.lineage.traitChanges = next.filter(id => !before.includes(id)).length + before.filter(id => !next.includes(id)).length;
          }
          world.subspecies.records.push(shared);
        }
      }
    }
    entity.components.subspecies = { id: shared.id, deviations: {} };
  }
  bindSubspecies(entity, shared);
  if (!loading) { shared.created++; if (entity.components.creature?.origin === 'born') shared.born++; }
}
export function leaveSubspecies(entity: Entity, died: boolean): void {
  const shared = subspeciesOf(entity);
  if (shared) { if (died) shared.died++; else shared.departed++; }
}
export function applySubspeciesBirthTraits(world: World, entity: Entity): void {
  const s = subspeciesOf(entity);
  if (s) acquireTraits(world, entity, s.birthTraits, 'inherited');
}
export interface SubspeciesPatch { genome?: Partial<Genome>; traits?: SubspeciesTrait[]; birthTraits?: string[] }
/** All callers share one synchronous transition. No resource/office state exists half-updated. */
export function updateSubspecies(world: World, id: number, patch: SubspeciesPatch, edited = true): boolean {
  const shared = world.subspecies.records.find(s => s.id === id);
  if (shared && patch?.traits) {
    if (patch.traits.some(id => !SUBSPECIES_TRAITS.includes(id))) return false;
    patch = { ...patch, traits: normalizedPhysiology(shared.traits, patch.traits) };
  }
  if (!shared || world.paused || !patch || Object.keys(patch).some(k => !['genome', 'traits', 'birthTraits'].includes(k))
    || patch.genome !== undefined && !validGenes(patch.genome)
    || patch.traits !== undefined && !validSubspeciesTraits(patch.traits, world.registry.species.get(shared.speciesId)!)
    || patch.birthTraits !== undefined && !validBirthTraits(patch.birthTraits, world.registry.species.get(shared.speciesId)!)) return false;
  const members = [...world.query('subspecies')].filter(e => e.components.subspecies!.id === id).sort((a, b) => a.id - b.id);
  if (patch.traits && members.some(e => patch.traits!.some(id => !shared.traits.includes(id) && physiologyProblem(world, e, id)))) return false;
  const reproduction = patch.traits && shared.reproduction ? physiologyReproduction(shared.reproduction, shared.traits, patch.traits) : shared.reproduction;
  if (reproduction && !validReproductionProfile(reproduction)) return false;
  const losing = shared.traits.includes('sapience') && patch.traits !== undefined && !patch.traits.includes('sapience');
  const ids = new Set(members.map(e => e.id));
  // Shared travel provisions move to a real carrier if the whole group stops.
  const ending = losing ? world.society.migrations.filter(g => g.members.every(n => ids.has(n))) : [];
  const provisions = new Map<number, Cargo>();
  for (const group of ending) {
    const remaining = { ...packedFood(group.food, group.foodGoods) };
    for (const e of members.filter(e => group.members.includes(e.id))) {
      const old = e.components.citizen!.work?.cargo;
      if (old && old.villageId !== group.fromId) continue;
      const goods = old ? { ...cargoContents(old) } : {}, load = bundleLoad(goods);
      let weight = 36 - load.weight, volume = 24 - load.volume;
      for (const [key, amount] of entries(remaining)) {
        const take = Math.max(0, Math.min(amount, 12 - (goods[key] ?? 0), weight / RESOURCES[key].weight, volume / RESOURCES[key].volume));
        if (!take) continue;
        extractBundle(remaining, { [key]: take }); goods[key] = (goods[key] ?? 0) + take;
        weight -= take * RESOURCES[key].weight; volume -= take * RESOURCES[key].volume;
      }
      const cargo = makeCargo(goods, group.fromId, old?.good);
      if (cargo) provisions.set(e.id, cargo);
    }
    if (bundleSize(remaining) > 1e-8) return false;
  }
  const nutrition = members.map(nutritionRemaining);
  const reproductionChanged = JSON.stringify(reproduction) !== JSON.stringify(shared.reproduction);
  Object.assign(shared.genome, patch.genome);
  const physiologyChanged = !!patch.traits;
  if (patch.traits) shared.traits = [...new Set([...patch.traits, ...(edited ? ['gmo' as const] : [])])];
  shared.reproduction = reproduction;
  if (patch.birthTraits) shared.birthTraits = [...patch.birthTraits];
  shared.revision++; shared.changedAt = world.tick;
  reconcileOffices(world);
  for (const [i, e] of members.entries()) {
    if (physiologyChanged) {
      if (reproductionChanged || losing) cancelReproduction(world, e);
      if (e.components.citizen) cancelJob(world, e, 'Target is no longer available');
      if (e.components.animal) { e.components.animal.path = []; e.components.animal.targetId = null; }
      if (e.components.physiology) delete e.components.physiology.action;
    }
    preserveNutrition(e, nutrition[i]);
    if (!needsFood(e)) removeStatus(world, e, 'starving', 'condition-ended');
    if (shared.traits.includes('aquatic') || shared.traits.includes('hovering')) removeStatus(world, e, 'drowning', 'condition-ended');
    if (shared.traits.includes('cold-resistance')) removeStatus(world, e, 'frozen', 'condition-ended');
    if (shared.traits.includes('heat-resistance')) removeStatus(world, e, 'burning', 'condition-ended');
    if (losing && e.components.citizen) suspendSubspeciesCitizen(world, e);
    reconcileStats(world, e);
  }
  for (const [entityId, cargo] of provisions) {
    const c = world.entities.get(entityId)!.components.citizen!;
    c.work = { good: cargo.good, progress: 0, cargo };
  }
  return true;
}
export function suspendSubspeciesCitizen(world: World, entity: Entity): void {
  const c = entity.components.citizen, p = entity.components.person;
  if (!c || !p) return;
  suspendCivilDuties(world, entity); releaseJob(entity); cancelFerryBoarding(world, entity);
  for (const group of world.society.migrations) group.members = group.members.filter(id => id !== entity.id);
  world.society.migrations = world.society.migrations.filter(g => g.members.length > 0);
  for (const other of world.query('citizen')) if (other.components.citizen?.conversation?.partnerId === entity.id) delete other.components.citizen.conversation;
  Object.assign(c, { villageId: null, task: 'idle', targetId: null, path: [], repair: null, reconsiderIn: 0 });
  delete c.profession; delete c.integration; delete c.conversation; delete c.emergency;
  if (c.work) delete c.work.reservation;
  p.homeId = null; delete p.displaced;
}
/** Personal mutations never edit the shared record or inherit silently. */
export function setIndividualGenes(world: World, entity: Entity, deviations: Partial<Genome>): boolean {
  if (world.paused || world.entities.get(entity.id) !== entity || !subspeciesOf(entity) || !validGenes(deviations)) return false;
  const nutrition = nutritionRemaining(entity);
  entity.components.subspecies!.deviations = { ...deviations };
  preserveNutrition(entity, nutrition); reconcileStats(world, entity); return true;
}
