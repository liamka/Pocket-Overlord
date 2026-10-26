import { newFood } from './food';
import { seedFoodPlants } from './food-plants';
import { migrateFood } from '../persistence/food';
import { physiologyDeath } from './physiology-events';
import { migrateClouds } from '../persistence/clouds';
import { cloudOnDeath } from './clouds';
import { migratePhysiology } from '../persistence/physiology';
import { newPhysiology, subspeciesRoom } from './physiology';
import { migrateGold } from '../persistence/gold';
import { migrateBiomeEcology } from '../persistence/biome-ecology';
import { migrateTemperature } from '../persistence/temperature';
import { seedBiomeDeposits } from './biome-minerals';
import { applyBiomeOrigin } from './biome-ecology';
import { walletOf, releaseMoney, type MoneyEntry } from './currency';
import { migrateCurrency } from '../persistence/currency';
import { newWorldRules, syncWorldRuleProcesses, lawEnabled, settlementRoom, type WorldRules } from './world-rules';
import { reconcileTileChanges } from './world-tiles';
import { initializeReproduction, birthReservations } from './reproduction-state';
import { releaseReproductionReferences } from './reproduction';
import { migrateReproduction } from '../persistence/reproduction';
import { migrateLeather } from '../persistence/leather';
import { migrateGenetics } from '../persistence/genetics';
import { migratePhenotypes } from '../persistence/phenotypes';
import { attachSubspecies, leaveSubspecies, applySubspeciesBirthTraits } from './subspecies';
import { newSubspeciesState, type SubspeciesState } from './subspecies-state';
import { migrateSubspecies } from '../persistence/subspecies';
import { initializeTraits, birthTraits, hasTrait } from './traits';
import { traitDeath } from '../systems/traits';
import { initializeHappiness, recordHappiness, mournUnit, forgetHappinessHome } from './happiness';
import { newEquipment, maintainEquipment, releaseEquipment, equippedItems, type EquipmentState } from './equipment';
import { initializeStats, reconcileStats } from './unit-stats';
import { migrateLifespans } from '../persistence/unit-stats';
import { newStatuses, clearStatuses, releaseStatusTarget } from './status-effects';
import { EXPERIENCE, publishExperience } from './unit-levels';
import { initializeUnit, rememberUnit, type UnitMemory } from './units';
import { initializeKinship, newFamilies, removeFamilyMember, type FamilyState } from './families';
import { newDeaths, recordDeath, recordPosthumousForm, type DamageContext, type DeathState } from './death';
import { finishForm, keepsFamily, keepsOffice, prepareForm, type PreparedForm } from './metamorphosis';
import { electSuccessor } from '../systems/governance';
import { reconcileBehaviour, removeBehaviourTarget } from './behaviour';
import { reconcileJobs, removeJobTarget } from './jobs';
import { insideMine } from './mines';
import { newCrafting, type CraftingState } from './crafting';
import { maintainCrafting } from '../systems/crafting';
import { maintainBuildings } from './buildings';
import { aboardFerry, ferryRoutes } from './ferries';
import { createRegistry } from '../content/defaults';
import { refreshLegacySettlementNames } from '../content/settlement-names';
import { seedStone } from '../content/stone';
import { BONE } from './bone';
import { addBundle } from './resources';
import { economyOf } from './village-life';
import { cleanDepositClaims, releaseDepositClaim } from './deposits';
import { deathGoods, releaseResources } from './resource-sources';
import { cleanTreeClaim, newTree, releaseTreeClaim, type Tree } from './forestry';
import { destroyStorage, initializeStorage, maintainStorage, releaseReservation, storageOwner } from './stockpiles';
import type { Registry } from '../content/registry';
import { Random } from './random';
import { releaseCreatureTargets, type CreatureOrigin } from './creatures';
import { SpatialGrid } from './spatial';
import { generateTerrain, TerrainMap } from './terrain';
import type { BiomeId } from './biomes';
import { naturalTreeSite, type NaturalBiome } from './natural-biomes';
import type { System } from './systems';
import { ENTITY_LIMIT, POPULATION_LIMIT, SAVE_VERSION, STEP, Terrain, isSimulationSpeed, newSociety, type SimulationSpeed, type Society, type ComponentKey, type Entity, type GameCommand, type GameEvent, type RainEffect, type Vec2, type VisualEvent, type WorldSnapshot } from './types';
import { initializeTerritories } from './territory';
import { packedFood, recordLoss } from './resource-ledger';
import { newWorldProcesses, type WorldProcesses } from './world-processes';

export class World {
  readonly entities = new Map<number, Entity>();
  readonly spatial = new SpatialGrid();
  private readonly componentIndex = new Map<ComponentKey, Set<number>>();
  readonly rng: Random;
  readonly terrain: TerrainMap;
  readonly events: GameEvent[] = [];
  readonly effects: RainEffect[] = [];
  readonly visuals: VisualEvent[] = [];
  readonly systems: readonly System[];
  readonly processes: WorldProcesses;
  readonly worldRules: WorldRules;
  readonly society: Society;
  readonly equipment: EquipmentState;
  readonly crafting: CraftingState;
  readonly moneyHistory: MoneyEntry[];
  readonly unitHistory: UnitMemory[];
  readonly families: FamilyState;
  readonly deaths: DeathState;
  readonly subspecies: SubspeciesState;
  readonly scenarios: WorldSnapshot['scenarios'] = [];
  tick = 0;
  nextEntityId = 1;
  paused = false;
  speed: SimulationSpeed = 1;
  private spawnOrigin: CreatureOrigin = 'natural';
  private readonly dying = new Set<number>();
  private resourceRelease?: Entity;

  /** A synchronous, single-use hand-off from removal; never restored from a save. */
  consumeResourceRelease(entity: Entity): boolean {
    if (this.resourceRelease !== entity) return false;
    this.resourceRelease = undefined; return true;
  }

  constructor(readonly seed: number, readonly registry: Registry = createRegistry(), snapshot?: WorldSnapshot, systems: readonly System[] = registry.resolveSystems(), biome?: BiomeId, nature?: NaturalBiome) {
    if (snapshot && !snapshot.subspecies) snapshot = migrateSubspecies(structuredClone(snapshot) as unknown as Record<string, unknown>, registry) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 56) snapshot = migrateReproduction(structuredClone(snapshot) as unknown as Record<string, unknown>, registry) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 57) snapshot = migrateGenetics(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 58) snapshot = migratePhenotypes(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 59) snapshot = migrateLeather(structuredClone(snapshot) as unknown as Record<string, unknown>, registry) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 64) snapshot = migrateCurrency(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 65) snapshot = migrateGold(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 66) snapshot = migrateBiomeEcology(structuredClone(snapshot) as unknown as Record<string, unknown>, registry) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 67) snapshot = migrateTemperature(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 68) snapshot = migratePhysiology(structuredClone(snapshot) as unknown as Record<string, unknown>, registry) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 70) snapshot = migrateClouds(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 71) snapshot = migrateFood(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    if (snapshot && snapshot.version < 72) snapshot = migrateLifespans(structuredClone(snapshot) as unknown as Record<string, unknown>) as unknown as WorldSnapshot;
    this.subspecies = structuredClone(snapshot?.subspecies ?? newSubspeciesState());
    this.systems = systems;
    this.worldRules = structuredClone(snapshot?.worldRules ?? newWorldRules());
    this.processes = structuredClone(snapshot?.processes ?? newWorldProcesses(seed, snapshot?.tick ?? 0, registry));
    this.equipment = structuredClone(snapshot?.equipment ?? newEquipment());
    this.crafting = structuredClone(snapshot?.crafting ?? newCrafting());
    this.moneyHistory = structuredClone(snapshot?.moneyHistory ?? []);
    this.unitHistory = structuredClone(snapshot?.unitHistory ?? []);
    this.families = structuredClone(snapshot?.families ?? newFamilies());
    this.deaths = structuredClone(snapshot?.deaths ?? newDeaths());
    this.society = snapshot ? structuredClone(snapshot.society) : newSociety();
    if (snapshot) refreshLegacySettlementNames(seed, this.society.villages);
    this.rng = new Random(snapshot?.rngState ?? seed);
    this.terrain = snapshot ? new TerrainMap(snapshot.terrain.width, snapshot.terrain.height, snapshot.terrain) : generateTerrain(seed, undefined, undefined, biome, nature);
    if (snapshot) {
      this.tick = snapshot.tick;
      this.nextEntityId = snapshot.nextEntityId;
      this.paused = snapshot.paused;
      this.speed = snapshot.speed;
      for (const entity of structuredClone(snapshot.entities)) {
        const speciesId = registry.entities.get(entity.typeId)?.speciesId;
        if (speciesId && !entity.components.creature) entity.components.creature = { speciesId, origin: 'legacy', since: null };
        if (entity.typeId === 'core:tree' && !entity.components.tree && entity.components.position) {
          const p = entity.components.position;
          entity.components.tree = newTree(this.terrain.biomeAt(p.x, p.y).id, entity.components.appearance?.variant ?? 0, 'legacy');
        }
        this.insert(entity, [], true);
      }
      for (const event of structuredClone(snapshot.events)) this.events.push(event);
      this.effects.push(...structuredClone(snapshot.effects));
      this.scenarios.push(...structuredClone(snapshot.scenarios));
    } else {
      for (let y = 4; y < this.terrain.height - 4; y++) {
        for (let x = 4; x < this.terrain.width - 4; x++) {
          if (this.terrain.at(x, y) !== Terrain.Grass || this.terrain.surfaceAt(x, y)) continue;
          const p = naturalTreeSite(x, y, seed, this.terrain.biomeAt(x, y).id);
          if (p && !this.nearby(p, 1.65).length) this.spawn('core:tree', p);
        }
      }
      seedStone(this);
      seedBiomeDeposits(this);
      seedFoodPlants(this);
    }
    initializeTerritories(this);
    syncWorldRuleProcesses(this, !!snapshot);
    this.terrain.onChange = indices => reconcileTileChanges(this, indices);
  }
  get population(): number { return this.componentIndex.get('person')?.size ?? 0; }
  get houseCount(): number { return this.componentIndex.get('dwelling')?.size ?? 0; }
  *query(...keys: ComponentKey[]): IterableIterator<Entity> {
    if (!keys.length) { yield* this.entities.values(); return; }
    let smallest: Set<number> | undefined;
    for (const key of keys) {
      const index = this.componentIndex.get(key);
      if (!index) return;
      if (!smallest || index.size < smallest.size) smallest = index;
    }
    entities: for (const id of smallest ?? []) {
      const entity = this.entities.get(id)!;
      for (const key of keys) if (entity.components[key] === undefined) continue entities;
      yield entity;
    }
  }
  private insert(entity: Entity, parents: readonly number[] = [], loading = false): void {
    attachSubspecies(this, entity, parents, loading);
    if (entity.components.subspecies) entity.components.physiology ??= newPhysiology(this.tick);
    if (entity.components.citizen || entity.components.animal) entity.components.food ??= newFood();
    initializeUnit(entity, this.tick);
    initializeKinship(entity);
    initializeReproduction(entity, this.tick);
    initializeStats(entity, this.tick);
    if (entity.components.unit && entity.components.health) entity.components.statuses ??= newStatuses();
    reconcileStats(this, entity);
    initializeHappiness(this.registry, entity);
    if (entity.components.citizen) walletOf(this, entity);
    initializeTraits(entity, this.tick);
    reconcileStats(this, entity);
    this.entities.set(entity.id, entity);
    for (const key of Object.keys(entity.components) as ComponentKey[]) {
      let index = this.componentIndex.get(key);
      if (!index) this.componentIndex.set(key, index = new Set());
      index.add(entity.id);
    }
    this.spatial.update(entity);
  }
  spawn(typeId: string, point: Vec2, treeOrigin?: Tree['origin'], origin: CreatureOrigin = this.spawnOrigin, parents: readonly number[] = [], birthOwnerId?: number, factoryRandom: Random = this.rng): Entity | undefined {
    const definition = this.registry.entities.get(typeId);
    if (!definition) throw new Error(`Unknown entity type: ${typeId}`);
    const reservations = birthReservations(this.entities.values());
    const pending = this.entities.get(birthOwnerId ?? -1)?.components.reproduction?.pending;
    const ownsSlot = origin === 'born' && pending?.typeId === typeId && pending.children.length && pending.parents.length === parents.length && parents.every((id, i) => pending.parents[i] === id);
    const release = ownsSlot && pending.reserved ? 1 : 0;
    if (this.entities.size + reservations.entities - release >= ENTITY_LIMIT) return;
    if (definition.speciesId && !this.terrain.inside(point.x, point.y)) return;
    if ((origin === 'born' || origin === 'cloned') && parents.some(id => {
      const parent = this.entities.get(id), memory = this.unitHistory.find(m => m.id === id);
      const speciesId = parent?.components.creature?.speciesId ?? this.registry.entities.get(memory?.typeId ?? '')?.speciesId;
      return !speciesId || speciesId !== definition.speciesId;
    })) return;
    if (!ownsSlot && (origin === 'born' || origin === 'cloned')) {
      const parent = this.entities.get(parents[0] ?? -1);
      if (parent && (subspeciesRoom(this, parent) < 1 || !lawEnabled(this, parent.components.person ? 'civ-babies' : 'animal-babies')
        || parent.components.person && settlementRoom(this, parent.components.citizen?.villageId ?? null) < 1)) return;
    }
    const previousState = factoryRandom.state;
    const components = definition.create(point, factoryRandom);
    if (components.person && this.population + reservations.people - release >= POPULATION_LIMIT) { factoryRandom.state = previousState; return; }
    if (definition.speciesId) components.creature = { speciesId: definition.speciesId, origin, since: origin === 'legacy' ? null : this.tick };
    const entity = { id: this.nextEntityId++, typeId, components };
    if (components.stone) components.stone.biome = this.terrain.biomeAt(point.x, point.y).id;
    if (components.commonMetal) components.commonMetal.biome = this.terrain.biomeAt(point.x, point.y).id;
    if (typeId === 'core:tree') components.tree = newTree(this.terrain.biomeAt(point.x, point.y).id, components.appearance?.variant ?? 0, treeOrigin ?? 'natural', treeOrigin ? 0 : undefined, factoryRandom.next());
    this.insert(entity, parents);
    applySubspeciesBirthTraits(this, entity);
    applyBiomeOrigin(this, entity);
    if (components.traits) {
      components.traits.born = false; components.traits.inherited = origin !== 'born' && origin !== 'cloned';
      if (origin === 'born' || origin === 'cloned') components.traits.grown = false; else birthTraits(this, entity);
    }
    if ((origin === 'born' || origin === 'cloned') && components.happiness) {
      components.happiness.grown = false;
      if (ownsSlot && pending.form === 'oviparity') components.happiness.egg = true;
      else recordHappiness(this, entity, 'birth');
    }
    return entity;
  }
  /** Integration for the future living-plants power: retain identity, cancel harvesting, award no loot. */
  awakenTree(id: number, creatureType: string): Entity | undefined {
    const source = this.entities.get(id), definition = this.registry.entities.get(creatureType);
    if (!source?.components.tree || source.typeId !== 'core:tree' || !source.components.position || !definition || creatureType === 'core:tree') return;
    const previousState = this.rng.state, components = definition.create(source.components.position, this.rng);
    if ((!components.person && !components.animal && !components.motion) || components.person && this.population + birthReservations(this.entities.values()).people >= POPULATION_LIMIT) { this.rng.state = previousState; return; }
    for (const worker of this.query('citizen')) {
      const c = worker.components.citizen!;
      if (c.targetId === id && c.task === 'work') { Object.assign(c, { targetId: null, task: 'idle', path: [], reconsiderIn: 0 }); if (!c.work?.cargo) delete c.work; }
    }
    for (const key of Object.keys(source.components) as ComponentKey[]) this.componentIndex.get(key)?.delete(id);
    source.typeId = creatureType; source.components = components;
    if (definition.speciesId) components.creature = { speciesId: definition.speciesId, origin: 'transformed', since: this.tick };
    this.insert(source);
    return source;
  }
  /** Integration for necromancy: close this pile, consume its remaining goods and
   * retain a saved origin marker. No spell or new creature species is introduced. */
  raiseRemains(id: number, creatureType: string): Entity | undefined {
    const source = this.entities.get(id), pile = source?.components.resourcePile, definition = this.registry.entities.get(creatureType);
    if (this.paused || !source || !pile || !source.components.position || !definition || this.tick >= pile.createdAt + BONE.remainsTicks
      || (source.components.health?.current ?? 0) <= 0 || !this.safeLand(source.components.position, 0.5)) return;
    const previousState = this.rng.state, components = definition.create(source.components.position, this.rng);
    if ((!components.person && !components.animal) || components.resourcePile || components.person && this.population + birthReservations(this.entities.values()).people >= POPULATION_LIMIT) {
      this.rng.state = previousState; return;
    }
    const owner = this.society.villages.find(v => v.id === pile.villageId);
    if (owner) addBundle(economyOf(owner).spent ??= {}, pile.goods);
    components.raisedRemains = { originId: pile.originId };
    if (definition.speciesId) components.creature = { speciesId: definition.speciesId, origin: 'transformed', since: this.tick };
    for (const worker of this.query('citizen')) {
      const c = worker.components.citizen!;
      if (c.targetId === id && c.task === 'work') {
        Object.assign(c, { targetId: null, task: 'idle', path: [], reconsiderIn: 0 });
        if (!c.work?.cargo) delete c.work;
      }
    }
    for (const key of Object.keys(source.components) as ComponentKey[]) this.componentIndex.get(key)?.delete(id);
    source.typeId = creatureType; source.components = components;
    this.insert(source);
    recordPosthumousForm(this, pile.originId, source);
    return source;
  }
  /** First lethal effect in system/FIFO event order wins. Completion is synchronous,
   * so later effects cannot award loot or count the same identity again. */
  die(id: number, context: DamageContext): void {
    const entity = this.entities.get(id);
    if (!entity?.components.health || entity.components.health.current > 0 || this.dying.has(id)) return;
    this.dying.add(id);
    try {
      const source = structuredClone(entity), form = prepareForm(this, entity, { trigger: 'death', death: context });
      const items = form?.rule.items === 'compatible-or-ground' ? equippedItems(this, id) : [];
      if (form) this.rng.state = form.rngState;
      const death = recordDeath(this, entity, context);
      const killer = context.sourceId === id ? undefined : this.entities.get(context.sourceId ?? -1);
      if (death && killer && !context.player && ['conflict', 'eaten', 'fire', 'explosion', 'poison', 'acid'].includes(context.cause)) {
        publishExperience(this, killer, 'kill', death.name, entity.components.dragon ? EXPERIENCE.dragon : EXPERIENCE.kill);
      }
      if (death) { traitDeath(this, entity, killer, death); physiologyDeath(this, entity); cloudOnDeath(this, entity); }
      this.removeEntity(id, context, form);
      if (death?.ruler && death.villageId !== null) {
        const successor = this.entities.get(this.society.villages.find(v => v.id === death.villageId)?.government?.leaderId ?? -1);
        if (successor?.components.unit) death.successor = { id: successor.id, name: successor.components.unit.customName ?? successor.components.unit.displayName };
      }
      if (form) {
        if (form.rule.identity === 'continue' && form.components.unit) form.components.unit.previousBodyId = id;
        const body = { id: this.nextEntityId++, typeId: form.typeId, components: form.components };
        this.insert(body); finishForm(this, form, body, true, items);
      }
      const echo = prepareForm(this, source, { trigger: 'death', death: context }, true);
      if (echo && this.entities.size < ENTITY_LIMIT) {
        this.rng.state = echo.rngState;
        echo.components.raisedRemains = { originId: id };
        const body = { id: this.nextEntityId++, typeId: echo.typeId, components: echo.components };
        this.insert(body); finishForm(this, echo, body, true);
      }
    } finally { this.dying.delete(id); }
  }
  /** A living change replaces components and indexes without inventing a death. */
  applyLivingForm(form: PreparedForm): void {
    const source = this.entities.get(form.source.id);
    if (!source) return;
    if (form.components.citizen && source.components.citizen?.wallet) form.components.citizen.wallet = source.components.citizen.wallet;
    else if (source.components.citizen) releaseMoney(this, source);
    const items = form.rule.items === 'compatible-or-ground' ? equippedItems(this, source.id) : [];
    if (keepsOffice(this, form) && form.components.citizen && source.components.citizen) {
      form.components.citizen.villageId = source.components.citizen.villageId;
      form.components.citizen.service = source.components.citizen.service;
      if (form.components.person && source.components.person) form.components.person.homeId = source.components.person.homeId;
    }
    this.rng.state = form.rngState;
    if (form.rule.change === 'body') this.removeEntity(source.id, undefined, form, true);
    else {
      for (const key of Object.keys(source.components) as ComponentKey[]) this.componentIndex.get(key)?.delete(source.id);
    }
    const body = { id: source.id, typeId: form.typeId, components: form.components };
    this.insert(body, [], form.rule.change !== 'body'); finishForm(this, form, body, false, items);
  }
  /** Administrative removal never counts as a death, even for a depleted object. */
  remove(id: number): void { this.removeEntity(id); }
  private removeEntity(id: number, death?: DamageContext, form?: PreparedForm, livingChange = false): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (!livingChange) releaseMoney(this, entity, death && !death.player ? death.sourceId : undefined);
    const loot = death && !form ? { goods: deathGoods(this, entity), thermal: entity.components.thermal && { ...entity.components.thermal } } : undefined;
    const personalTraits = (entity.components.traits?.entries ?? []).filter(t => hasTrait(entity,t.id)).map(t => t.id);
    releaseReproductionReferences(this, id);
    leaveSubspecies(entity, !!death);
    releaseCreatureTargets(this, id);
    clearStatuses(this, entity, death ? 'death' : 'removed');
    releaseStatusTarget(this, id);
    removeJobTarget(this, id);
    removeBehaviourTarget(this, id);
    if (death) mournUnit(this, entity);
    if (entity.components.dwelling) forgetHappinessHome(this, entity);
    if (!livingChange) rememberUnit(this, entity, !!death, personalTraits);
    if (!form || !keepsFamily(form)) removeFamilyMember(this, entity);
    releaseTreeClaim(this, id);
    releaseDepositClaim(this, id);
    const owner = this.society.villages.find(v => v.id === storageOwner(entity));
    if (owner) initializeStorage(this, owner);
    releaseEquipment(this, entity, !form && !hasTrait(entity, 'infected') && death && ['conflict', 'eaten', 'fire', 'explosion'].includes(death.cause) ? death.sourceId : undefined,
      form?.rule.items === 'compatible-or-ground' ? equippedItems(this, id) : []);
    destroyStorage(this, id);
    for (const village of this.society.villages) releaseReservation(village, id);
    if (death && entity.components.person && entity.components.citizen?.villageId) {
      for (const war of this.society.wars) {
        if (war.attackers.includes(entity.components.citizen.villageId)) war.lossesAttackers++;
        if (war.defenders.includes(entity.components.citizen.villageId)) war.lossesDefenders++;
      }
    }
    for (const key of Object.keys(entity.components) as ComponentKey[]) this.componentIndex.get(key)?.delete(id);
    for (const actor of this.query('physiology')) if (actor.components.physiology!.action?.targetId === id) delete actor.components.physiology!.action;
    this.spatial.remove(id);
    this.entities.delete(id);
    for (const village of this.society.villages) if (village.territory?.expansion?.actorId === id) delete village.territory.expansion;
    // The body becomes the new form; it cannot also become a harvestable corpse.
    this.resourceRelease = entity;
    releaseResources(this, entity, !!death && !form, death && !death.player ? death.sourceId : undefined, loot);
    for (const village of this.society.villages) if (village.government?.leaderId === id && !(livingChange && form && keepsOffice(this, form))) {
      village.government.leaderId = null;
      electSuccessor(this, village);
    }
    for (const animal of this.query('animal')) {
      const state = animal.components.animal!;
      if (state.ownerId === id) state.ownerId = null;
      if (state.targetId === id) { state.targetId = null; state.path = []; state.decisionIn = 0; }
    }
    for (const { ferry } of ferryRoutes(this)) ferry.passengers = ferry.passengers.filter(passenger => passenger !== id);
    for (const group of this.society.migrations) {
      group.members = group.members.filter(member => member !== id);
      group.homeIds = group.homeIds.filter(home => home !== id);
      if (!group.members.length) recordLoss(this.society.villages.find(v => v.id === group.fromId), group.foodGoods ?? packedFood(group.food));
    }
    this.society.migrations = this.society.migrations.filter(group => group.members.length > 0);
    if (entity.components.dwelling) {
      for (const resident of this.query('person')) {
        if (resident.components.person!.homeId === id) resident.components.person!.homeId = null;
      }
    }
    for (const other of this.query('citizen')) {
      const citizen = other.components.citizen!;
      if (citizen.conversation?.partnerId === id) delete citizen.conversation;
      if (citizen.partnerId === id) citizen.partnerId = null;
      if (citizen.integration?.friendId === id) citizen.integration.friendId = null;
      if (citizen.integration?.contactId === id) { citizen.integration.contactId = null; citizen.integration.contact = 0; }
      if (citizen.targetId === id) { citizen.targetId = null; citizen.path = []; citizen.reconsiderIn = 0; citizen.task = 'idle'; }
      if (citizen.emergency?.targetId === id) { delete citizen.emergency; citizen.reconsiderIn = 0; }
    }
  }
  nearby(point: Vec2, radius: number): Entity[] { return this.spatial.query(point, radius, this.entities); }
  canStand(point: Vec2, radius = 0.35, ignoreId?: number, allowWater = false): boolean {
    if (!this.terrain.inside(point.x, point.y) || !this.terrain.cell(point.x, point.y, { mode: allowWater ? 'swim' : 'walk' }).movement.passable) return false;
    return !this.spatial.some(point, radius + 1.2, this.entities, entity => {
      if (entity.id === ignoreId || aboardFerry(this, entity.id) || insideMine(entity)) return false;
      const p = entity.components.position!;
      const otherRadius = entity.components.solid?.radius ?? (entity.components.person ? 0.25 : entity.components.caravan ? 0.4 : 0);
      return otherRadius > 0 && Math.hypot(p.x - point.x, p.y - point.y) < radius + otherRadius;
    });
  }
  findFreePosition(point: Vec2, radius = 0.35, allowWater = false): Vec2 | undefined {
    if (!this.terrain.inside(point.x, point.y) || !allowWater && !this.terrain.isLand(point.x, point.y)) return;
    if (this.canStand(point, radius, undefined, allowWater)) return point;
    // Search nearby rings without consuming simulation randomness; also used by the cursor.
    for (let ring = 1; ring <= 6; ring++) {
      const distance = ring * 0.5;
      const samples = Math.ceil(Math.PI * 2 * distance / 0.5);
      for (let i = 0; i < samples; i++) {
        const angle = i * Math.PI * 2 / samples;
        const candidate = { x: point.x + Math.cos(angle) * distance, y: point.y + Math.sin(angle) * distance };
        if (this.canStand(candidate, radius, undefined, allowWater)) return candidate;
      }
    }
  }
  safeLand(point: Vec2, radius = 1): boolean {
    return [[-radius, -radius], [radius, -radius], [-radius, radius], [radius, radius]].every(([x, y]) =>
      this.terrain.inside(point.x + x, point.y + y) && this.terrain.cell(point.x + x, point.y + y).buildable);
  }
  addRain(point: Vec2, radius: number, duration: number): void {
    const existing = this.effects.find(e => Math.hypot(e.x - point.x, e.y - point.y) < radius * 0.4);
    if (existing) { existing.x = point.x; existing.y = point.y; existing.remaining = duration; return; }
    if (this.effects.length < 64) this.effects.push({ ...point, kind: 'rain', radius, remaining: duration });
  }
  command(command: GameCommand): string | undefined {
    if (command.kind === 'release-tool') { this.registry.tools.get(command.toolId)?.release?.(this); return; }
    if (command.kind === 'control-tool') {
      if (Number.isFinite(command.x) && Number.isFinite(command.y) && Math.abs(command.x) <= 1 && Math.abs(command.y) <= 1
        && typeof command.attacking === 'boolean' && typeof command.active === 'boolean') this.registry.tools.get(command.toolId)?.control?.(this, command);
      return;
    }
    if (command.kind === 'start-scenario') { this.startScenario(command.scenarioId); return; }
    if (command.kind === 'pause') { this.paused = command.paused; return; }
    if (command.kind === 'speed') {
      if (command.speed !== 0 && !isSimulationSpeed(command.speed)) return;
      this.paused = command.speed === 0;
      if (command.speed !== 0) this.speed = command.speed;
      return;
    }
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y) || !this.terrain.inside(command.x, command.y)) {
      return command.kind === 'aim-tool' ? undefined : 'Выберите точку на карте';
    }
    if (command.kind === 'aim-tool') {
      this.registry.tools.get(command.toolId)?.aim?.(this, { x: command.x, y: command.y });
      return;
    }
    const previousOrigin = this.spawnOrigin;
    this.spawnOrigin = 'placed';
    try {
      const result = this.terrain.edit(() => this.registry.tools.get(command.toolId)?.apply(this, { x: command.x, y: command.y }, command.viewport));
      return typeof result === 'string' ? result : undefined;
    } finally { this.spawnOrigin = previousOrigin; }
  }
  step(): void {
    if (this.paused) return;
    this.tick++;
    reconcileJobs(this);
    if (this.tick % 30 === 1) { maintainBuildings(this); maintainStorage(this); maintainCrafting(this); }
    // Scenario decisions run before the ordinary systems and share the same event budget.
    for (let i = 0, remaining = this.scenarios.length; remaining > 0; remaining--) {
      const scenario = this.scenarios[i];
      const definition = this.registry.scenarios.get(scenario.id)!;
      if (definition.update(this, scenario.state, STEP) === 'complete') this.scenarios.splice(i, 1);
      else i++;
    }
    for (const system of this.systems) system.update(this, STEP);
    for (const entity of this.query('citizen')) reconcileBehaviour(this, entity);
    reconcileJobs(this);
  }
  startScenario(id: string): boolean {
    const definition = this.registry.scenarios.get(id);
    if (!definition) throw new Error(`Unknown scenario: ${id}`);
    if (this.scenarios.some(scenario => scenario.id === id) || this.scenarios.length >= 64) return false;
    const state = definition.create(this);
    if (!definition.validate(state)) throw new Error(`Invalid initial scenario state: ${id}`);
    this.scenarios.push({ id, state });
    return true;
  }
  visual(event: VisualEvent): void { if (this.visuals.length < 128) this.visuals.push(event); }
  announce(text: string): void {
    this.society.history.push({ tick: this.tick, text: text.length > 300 ? `${text.slice(0, 299)}…` : text });
    if (this.society.history.length > 40) this.society.history.shift();
  }
  snapshot(terrain?: WorldSnapshot['terrain']): WorldSnapshot {
    reconcileJobs(this);
    for (const deposit of this.query('stone')) cleanDepositClaims(this, deposit);
    for (const deposit of this.query('commonMetal')) cleanDepositClaims(this, deposit);
    for (const tree of this.query('tree')) cleanTreeClaim(this, tree);
    maintainStorage(this);
    maintainEquipment(this);
    maintainCrafting(this);
    for (const entity of this.query('stats')) reconcileStats(this, entity);
    // Terrain already owns fresh flat arrays; cloning them again dominates autosave time.
    return { ...structuredClone({ version: SAVE_VERSION, seed: this.seed, rngState: this.rng.state, tick: this.tick, nextEntityId: this.nextEntityId,
      paused: this.paused, speed: this.speed, worldRules: this.worldRules, processes: this.processes, entities: [...this.entities.values()], effects: this.effects, events: this.events, society: this.society, equipment: this.equipment, crafting: this.crafting,
      subspecies: this.subspecies, moneyHistory: this.moneyHistory, unitHistory: this.unitHistory, families: this.families, deaths: this.deaths, contentPacks: this.registry.packIds, scenarios: this.scenarios }), terrain: terrain ?? this.terrain.snapshot() };
  }
}
