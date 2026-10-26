import { migrateFood, validFoodSave } from './food';
import { validSupplySave } from './supply';
import { migrateClouds } from './clouds';
import { migratePhysiology, validPhysiologySave } from './physiology';
import { migrateBiomeEcology } from './biome-ecology';
import { migrateTemperature } from './temperature';
import { validTileLayers } from './tiles';
import { migrateCurrency, validCurrencySave } from './currency';
import { newWorldRules } from '../core/world-rules';
import { validTerritories } from './territory';
import { validWorldRules } from './world-rules';
import { newWorldProcesses } from '../core/world-processes';
import { validWorldProcesses } from './world-processes';
import { migrateReproduction, validReproductionSave } from './reproduction';
import { migrateLeather } from './leather';
import { migrateGenetics } from './genetics';
import { migratePhenotypes, normalizeUnknownPhenotypes } from './phenotypes';
import { migrateSubspecies, validSubspeciesSave } from './subspecies';
import { validTraitsSave } from './traits';
import { isAdult } from '../core/unit-stats';
import { migrateLifespans, migrateStats, validStatsSave } from './unit-stats';
import { migrateStatuses, validStatusesSave } from './status-effects';
import { migrateLevels } from './unit-levels';
import { migrateHappiness, validHappinessSave } from './happiness';
import { migrateEquipment, validEquipmentSave } from './equipment';
import { migrateUnits, validUnitsSave } from './units';
import { migrateFamilies, validFamiliesSave } from './families';
import { newDeaths } from '../core/death';
import { validDeathsSave } from './death';
import { validTransformationsSave } from './metamorphosis';
import { canGovern, validateSpeciesComponents } from '../core/capabilities';
import { migrateCrafting, validCraftingSave } from './crafting';
import { migrateCommonMetals } from './common-metals';
import { migrateSilver } from './silver';
import { migrateGold } from './gold';
import { migrateCreatures } from './creatures';
import { validBehaviourSave } from './behaviour';
import { validNeuronSave } from './neurons';
import { validJobsSave } from '../core/jobs';
import { validMinesSave } from '../core/mines';
import { ARCHITECTURES, BUILDINGS, buildingCost, hasCapability, newBuilding, type Building } from '../core/buildings';
import { storageOwner, type Storage } from '../core/stockpiles';
import { newTree } from '../core/forestry';
import { GEMS } from '../core/gems';
import { newDeposit, type Deposit } from '../core/deposits';
import { STONE, STONE_WEAPONS } from '../core/stone';
import { SILVER_WEIGHTS } from '../core/silver';
import { SOURCE_PROFILES } from '../core/resources';
import { addBundle, bundleLoad, canConsume, entries, LEGACY_GOODS, RESIDENT_DIET, validFoodGoods, type ResourceBundle } from '../core/resources';
import { isCrafted, RECIPES } from '../core/resource-ledger';
import { ROAD_PROBLEMS, legacyBridges } from '../core/roads';
import type { Registry } from '../content/registry';
import { validVillageLife } from '../content/village-life';
import { Random } from '../core/random';
import { NAPALM } from '../content/napalm';
import { LEGACY_ROCKET_HEADING } from '../core/flight';
import { isRace, RACES, RACE_IDS } from '../core/races';
import { bool, integer, number, record, type RecordValue } from '../core/validation';
import { isDamagedTerrain, recoveryDuration } from '../core/terrain';
import { NaturalBiome, NATURAL_BIOMES } from '../core/natural-biomes';
import { alliedGroup, allianceGroups, normalizeLegacyAlliances, opposingSides } from '../core/diplomacy';
import { ENTITY_LIMIT, FERRY_CAPACITY, MAX_BRIDGE_SPAN, MAX_FERRY_SPAN, POPULATION_LIMIT, isBridge, ROAD_OVERGROWTH_SECONDS, SAVE_VERSION, Terrain, WORLD_WIDTH, WORLD_HEIGHT, isSimulationSpeed, newCitizen, newSociety, type ComponentKey, type Road, type Society, type War, type WorldSnapshot } from '../core/types';

const migrations = new Map<number, (save: RecordValue, registry: Registry) => RecordValue>([
  [1, save => {
    if (!record(save.terrain) || !integer(save.terrain.width, 16, 256) || !integer(save.terrain.height, 16, 192)) throw new Error('Повреждена карта сохранённого мира');
    return { ...save, version: 2, terrain: { ...save.terrain, moisture: new Array(save.terrain.width * save.terrain.height).fill(0) } };
  }],
  [2, save => ({ ...save, version: 3, society: save.society ?? newSociety(),
    entities: Array.isArray(save.entities) ? save.entities.map(entity => {
      if (!record(entity) || !record(entity.components)) return entity;
      const components = { ...entity.components };
      if (record(components.person)) components.citizen = components.citizen ?? newCitizen();
      if (record(components.dwelling)) components.dwelling = { ...components.dwelling, villageId: components.dwelling.villageId ?? null };
      return { ...entity, components };
    }) : save.entities,
  })],
  [3, save => {
    if (!record(save.society) || !Array.isArray(save.society.villages) || !Array.isArray(save.society.relations) || !Array.isArray(save.entities) || !integer(save.tick)) throw new Error('Повреждена дипломатия сохранённого мира');
    const society = { ...save.society, wars: [], nextWarId: 1 } as unknown as Society;
    if (!society.villages.every(v => record(v) && integer(v.id, 1)) || !society.relations.every(r => record(r) && integer(r.a, 1) && integer(r.b, 1) && number(r.affinity) && integer(r.since) && ['neutral', 'alliance', 'war'].includes(r.status))) throw new Error('Повреждены отношения поселений');
    normalizeLegacyAlliances(society);
    const strength = (members: number[]): number => (save.entities as unknown[]).filter(e => record(e) && record(e.components) && record(e.components.person) && Number(e.components.person.age) >= 18
      && record(e.components.citizen) && members.includes(Number(e.components.citizen.villageId))).length;
    const formerWars = society.relations.filter(r => r.status === 'war');
    for (const r of formerWars) {
      if (society.wars.some(w => opposingSides(w, r.a, r.b))) continue;
      const attackers = alliedGroup(society, r.a), defenders = alliedGroup(society, r.b);
      const started = Math.min(r.since, Number(save.tick));
      society.wars.push({ id: society.nextWarId++, attackers, defenders, started, musterUntil: started + 240, attackTarget: r.b, rallyVillage: r.a,
        initialAttackers: strength(attackers), initialDefenders: strength(defenders), lossesAttackers: 0, lossesDefenders: 0 });
    }
    for (const r of society.relations) if (society.wars.some(w => opposingSides(w, r.a, r.b))) r.status = 'war';
    return { ...save, version: 4, society };
  }],
  [4, save => ({ ...save, version: 5, speed: 1 })],
  [5, save => {
    if (!record(save.terrain) || !Array.isArray(save.terrain.tiles)) throw new Error('Повреждена карта сохранённого мира');
    // Older saves did not retain the original surface beneath a crater.
    const recovery = save.terrain.tiles.flatMap((tile, index) => isDamagedTerrain(Number(tile)) ? [{ index, age: 0, target: 3 }] : []);
    return { ...save, version: 6, terrain: { ...save.terrain, recovery } };
  }],
  [6, save => ({ ...save, version: 7 })],
  [7, save => ({ ...save, version: 8, entities: Array.isArray(save.entities) ? save.entities.map(entity => {
    if (!record(entity) || !record(entity.components) || !record(entity.components.citizen)) return entity;
    return { ...entity, components: { ...entity.components, citizen: { ...entity.components.citizen, repair: entity.components.citizen.repair ?? null } } };
  }) : save.entities })],
  [8, save => ({ ...save, version: 9 })],
  [9, save => ({ ...save, version: 10, contentPacks: ['core'], scenarios: [] })],
  [10, save => {
    if (!record(save.society) || !Array.isArray(save.society.villages)) throw new Error('Invalid saved society');
    return { ...save, version: 11, society: { ...save.society,
      nextMigrationId: save.society.nextMigrationId ?? 1, migrations: save.society.migrations ?? [],
      villages: save.society.villages.map(v => record(v) ? { ...v, migrationAfter: v.migrationAfter ?? Number(save.tick) + 900 } : v),
    } };
  }],
  [11, save => ({ ...save, version: 12, speed: save.speed === 50 || save.speed === 500 || save.speed === 5000 ? 40 : save.speed })],
  [12, save => ({ ...save, version: 13 })],
  [13, save => ({ ...save, version: 14 })],
  [14, save => ({ ...save, version: 15,
    entities: Array.isArray(save.entities) ? save.entities.map(entity => {
      if (!record(entity) || !record(entity.components) || !record(entity.components.explosive)) return entity;
      const explosive = entity.components.explosive;
      const oldRadius = entity.typeId === 'core:dynamite' ? 5.5 : entity.typeId === 'core:rocket' ? 9 : null;
      if (oldRadius === null || explosive.radius !== oldRadius) return entity;
      return { ...entity, components: { ...entity.components, explosive: { ...explosive, radius: oldRadius / 2 } } };
    }) : save.entities,
    effects: Array.isArray(save.effects) ? save.effects.map(effect => record(effect) && effect.kind === 'rain' && effect.radius === 7
      ? { ...effect, radius: 3.5 } : effect) : save.effects,
    scenarios: Array.isArray(save.scenarios) ? save.scenarios.map(scenario => {
      if (!record(scenario) || scenario.id !== 'core:napalm-strike' || !record(scenario.state) || !Array.isArray(scenario.state.strikes)) return scenario;
      return { ...scenario, state: { strikes: scenario.state.strikes.map(strike => {
        if (!record(strike) || !integer(strike.next, 0, 14) || !number(strike.remaining, 0, 0.055)) throw new Error('Invalid saved napalm strike');
        return { x: strike.x, y: strike.y, next: strike.next, bombs: [],
          elapsed: strike.next === 0 ? 0 : NAPALM.approach + (strike.next - strike.remaining / 0.055) * NAPALM.interval };
      }) } };
    }) : save.scenarios,
  })],
  [15, save => ({ ...save, version: 16,
    entities: Array.isArray(save.entities) ? save.entities.map(entity => {
      if (!record(entity) || entity.typeId !== 'core:rocket' || !record(entity.components) || !record(entity.components.projectile)) return entity;
      return { ...entity, components: { ...entity.components, projectile: { ...entity.components.projectile,
        heading: entity.components.projectile.heading ?? LEGACY_ROCKET_HEADING } } };
    }) : save.entities,
    scenarios: Array.isArray(save.scenarios) ? save.scenarios.map(scenario => {
      if (!record(scenario) || scenario.id !== 'core:napalm-strike' || !record(scenario.state) || !Array.isArray(scenario.state.strikes)) return scenario;
      return { ...scenario, state: { strikes: scenario.state.strikes.map(strike => record(strike) ? { ...strike, heading: strike.heading ?? 0 } : strike) } };
    }) : save.scenarios,
  })],
  [16, save => ({ ...save, version: 17,
    scenarios: Array.isArray(save.scenarios) ? save.scenarios.map(scenario => {
      if (!record(scenario) || scenario.id !== 'core:hammer-of-dawn' || !record(scenario.state) || !Array.isArray(scenario.state.strikes)) return scenario;
      return { ...scenario, state: { strikes: scenario.state.strikes.map(strike => record(strike)
        ? { ...strike, targetX: strike.targetX ?? strike.x, targetY: strike.targetY ?? strike.y } : strike) } };
    }) : save.scenarios,
  })],
  [17, save => {
    if (!record(save.terrain)) throw new Error('Invalid saved terrain');
    return { ...save, version: 18, terrain: { ...save.terrain, roadWear: save.terrain.roadWear ?? [] } };
  }],
  [18, save => ({ ...save, version: 19,
    entities: Array.isArray(save.entities) ? save.entities.map(entity => {
      if (!record(entity) || !record(entity.components)) return entity;
      const components = { ...entity.components };
      for (const key of ['person', 'dwelling']) {
        const component = components[key];
        if (record(component)) components[key] = { ...component, race: component.race ?? 'human' };
      }
      return { ...entity, components };
    }) : save.entities,
    society: record(save.society) && Array.isArray(save.society.villages) ? { ...save.society,
      villages: save.society.villages.map(v => record(v) ? { ...v, race: v.race ?? 'human' } : v),
    } : save.society,
  })],
  [19, save => {
    if (!record(save.terrain) || !Array.isArray(save.terrain.tiles)) throw new Error('Invalid saved terrain');
    return { ...save, version: 20, terrain: { ...save.terrain, biomes: save.terrain.biomes ?? new Array(save.terrain.tiles.length).fill(NaturalBiome.Grassland) } };
  }],
  [20, save => {
    if (!record(save.terrain) || !Array.isArray(save.terrain.tiles) || !integer(save.terrain.width)
      || !record(save.society) || !Array.isArray(save.society.roads)) throw new Error('Invalid saved crossings');
    const tiles = save.terrain.tiles as number[], width = save.terrain.width;
    return { ...save, version: 21, society: { ...save.society, roads: save.society.roads.map(road => {
      if (!record(road) || !Array.isArray(road.tiles) || !integer(road.built, 0, road.tiles.length)) throw new Error('Invalid saved road');
      const bridges = road.bridges ?? legacyBridges(road as unknown as Road, tiles, width);
      return { ...road, ...(Array.isArray(bridges) && bridges.length ? { bridges } : {}) };
    }) } };
  }],
  [21, save => {
    if (!record(save.terrain) || !Array.isArray(save.terrain.tiles)) throw new Error('Invalid saved terrain');
    return { ...save, version: 22, terrain: { ...save.terrain, surfaces: save.terrain.surfaces ?? new Array(save.terrain.tiles.length).fill(0) } };
  }],
  // Existing saucers are already in flight; only new summons have an arrival path.
  [22, save => ({ ...save, version: 23 })],
  // Existing homes stay complete; new construction and resident poses are optional state.
  [23, save => ({ ...save, version: 24 })],
  [24, save => ({ ...save, version: 25 })],
  [25, save => ({ ...save, version: 26, entities: Array.isArray(save.entities) ? save.entities.map(entity => {
    if (!record(entity) || !record(entity.components) || !record(entity.components.dragon)) return entity;
    return { ...entity, components: { ...entity.components, dragon: { ...entity.components.dragon, age: entity.components.dragon.age ?? 0 } } };
  }) : save.entities })],
  // Held orbital beams can run beyond the old three-second timeline.
  [26, save => ({ ...save, version: 27, scenarios: Array.isArray(save.scenarios) ? save.scenarios.map(scenario => {
    if (!record(scenario) || scenario.id !== 'core:hammer-of-dawn' || !record(scenario.state) || !Array.isArray(scenario.state.strikes)) return scenario;
    return { ...scenario, state: { ...scenario.state, strikes: scenario.state.strikes.map(strike =>
      record(strike) && number(strike.elapsed, 3.6 - 1e-9, 4.3) && strike.next === 30
        ? { ...strike, next: Math.floor((strike.elapsed - 0.6 + 1e-9) / 0.1) + 1 } : strike) } };
  }) : save.scenarios })],
  // Old titans acquire planted-foot poses on their next simulation step.
  [27, save => ({ ...save, version: 28 })],
  // Disaster response and displaced households are optional in older worlds.
  [28, save => ({ ...save, version: 29 })],
  // Village life is initialized lazily so older settlements retain their existing supplies.
  [29, save => ({ ...save, version: 30 })],
  // Existing residents keep their lives; integration starts with the next arrival.
  [30, save => ({ ...save, version: 31 })],
  [31, save => {
    if (record(save.society) && Array.isArray(save.society.villages)) for (const village of save.society.villages) {
      if (record(village) && record(village.economy) && record(village.economy.stocks)) {
        village.economy.stocks.stone = 0; village.economy.stocks.stoneAxes = 0;
      }
    }
    return { ...save, version: 32 };
  }],
  // Preserve existing goods and aggregate food. No resources are seeded from map objects.
  [32, save => {
    if (record(save.society) && Array.isArray(save.society.villages)) for (const v of save.society.villages) {
      if (record(v) && number(v.food, 0, 2000) && record(v.economy) && record(v.economy.stocks) && number(v.economy.stocks.bread, 0, 2000)) {
        // Legacy food was authoritative. Match the old economy's clamp when a previous
        // meal/transport left a stale bread subset; never refund that already-used food.
        v.economy.stocks.bread = Math.min(v.food, v.economy.stocks.bread);
      }
    }
    return { ...save, version: 33 };
  }],
  [33, save => {
    if (!record(save.society) || !Array.isArray(save.society.villages) || !Array.isArray(save.entities) || !integer(save.nextEntityId, 1)) throw new Error('Invalid legacy storage');
    const entities = save.entities;
    for (const village of save.society.villages) {
      if (!record(village) || !validVillageLife(village) || !number(village.food, 0, 2000)) throw new Error('Invalid legacy goods');
      const economy = record(village.economy) ? village.economy : { stocks: Object.fromEntries(LEGACY_GOODS.map(id => [id, 0])), deliveries: 0, buildAfter: Number(village.founded) + 900 };
      village.economy = economy;
      if (economy.storage !== undefined) continue;
      const stocks = economy.stocks as ResourceBundle;
      const goods = { ...stocks, provisions: Number(village.food) - entries(stocks).reduce((sum, [id, n]) => sum + (canConsume(id, RESIDENT_DIET) ? n : 0), 0) };
      const owned = entities.filter(e => record(e) && record(e.components) && [e.components.workplace, e.components.dwelling].some(c => record(c) && c.villageId === village.id));
      let anchor = owned.find(e => record(e.components.workplace) && e.components.workplace.kind === 'market') ?? owned.find(e => record(e.components.dwelling));
      if (!anchor) {
        anchor = { id: Number(save.nextEntityId), typeId: 'core:stockpile', components: { position: { x: village.x, y: village.y },
          health: { current: 180, max: 180 }, solid: { radius: 1.1 }, combustible: { fuel: 45, ignition: 38 }, thermal: { temperature: 0, wetness: 0, burning: false },
          stockpile: { villageId: village.id, resistance: 'ordinary' } } };
        save.nextEntityId = Number(save.nextEntityId) + 1; entities.push(anchor);
      }
      const store: Storage = { buildingId: Number(anchor.id), capacity: Math.max(256, bundleLoad(goods).volume), limits: {}, goods, reservations: [] };
      for (const e of entities) {
        if (!record(e) || !record(e.components) || !record(e.components.citizen)) continue;
        const c = e.components.citizen, work = c.work;
        if (c.villageId !== village.id || !entities.some(t => record(t) && t.id === c.targetId)) continue;
        if (c.task === 'work' && record(work) && record(work.reservation) && work.reservation.villageId === village.id)
          store.reservations.push({ claimant: Number(e.id), goods: { ...work.reservation.inputs as ResourceBundle } });
        if (c.task === 'equip' && !c.weapon) store.reservations.push({ claimant: Number(e.id), goods: { stoneAxes: 1 } });
      }
      economy.storage = [store];
    }
    return { ...save, version: 34 };
  }],

  [34, save => {
    if (!Array.isArray(save.entities)) throw new Error('Invalid legacy buildings');
    for (const e of save.entities) {
      if (!record(e) || !record(e.components) || typeof e.typeId !== 'string') continue;
      const c = e.components, kind = e.typeId === 'core:ruin' ? 'core:house' : e.typeId;
      if (!Object.hasOwn(BUILDINGS, kind)) continue;
      if (!c.building) {
        const race = record(c.dwelling) ? c.dwelling.race : record(c.ruin) ? c.ruin.race : 'human';
        const b = newBuilding(kind, isRace(race) ? race : 'human'); c.building = b;
        if (record(c.dwelling) && c.dwelling.level === 2) b.level = 2;
        if (record(c.ruin)) b.state = 'ruined';
        const old = record(c.dwelling) && record(c.dwelling.construction) ? c.dwelling.construction : undefined;
        if (old || record(c.harbor) && Number(c.harbor.built) < 1) {
          const action = old?.upgrade ? 'upgrade' : 'build';
          b.project = { action, progress: Number(old?.progress ?? (c.harbor as RecordValue).built), struckAt: Number(old?.struckAt ?? -1),
            paid: true, cost: buildingCost(e as unknown as import('../core/types').Entity, action) };
          b.state = 'construction';
        }
      }
      if (record(c.dwelling)) delete c.dwelling.construction;
    }
    return { ...save, version: 35 };
  }],

  [35, migrateEquipment],
  [36, migrateCrafting],
  [37, save => {
    if (!Array.isArray(save.entities) || !record(save.terrain) || !Array.isArray(save.terrain.biomes) || !integer(save.terrain.width, 16)) throw new Error('Invalid legacy forest');
    for (const entity of save.entities) {
      if (!record(entity) || !record(entity.components)) continue;
      const c = entity.components, p = c.position;
      if (entity.typeId === 'core:tree' && c.tree === undefined && record(p) && number(p.x) && number(p.y)) {
        const biome = save.terrain.biomes[Math.floor(p.y) * save.terrain.width + Math.floor(p.x)];
        c.tree = newTree(integer(biome, 0, NATURAL_BIOMES.length - 1) ? biome : NaturalBiome.Grassland, record(c.appearance) ? Number(c.appearance.variant ?? 0) : 0, 'legacy');
      }
      // Existing paid work stays paid. Do not charge a completed hut retroactively.
      if (entity.typeId === 'core:house' && record(c.building) && record(c.building.project) && c.building.project.action === 'build') {
        c.building.project.cost = { ...BUILDINGS['core:house'].cost };
        if (!c.building.project.paid) c.building.state = 'planned';
      }
    }
    return { ...save, version: 38 };
  }],
  [38, save => {
    if (!Array.isArray(save.entities) || !record(save.terrain) || !Array.isArray(save.terrain.biomes) || !integer(save.terrain.width, 16)) throw new Error('Invalid legacy deposits');
    for (const entity of save.entities) {
      if (!record(entity) || !record(entity.components)) continue;
      const c = entity.components, p = c.position;
      if (record(c.stone) && c.stone.profile === undefined && record(p) && number(p.x) && number(p.y)) {
        const biome = save.terrain.biomes[Math.floor(p.y) * save.terrain.width + Math.floor(p.x)];
        c.stone = { ...newDeposit(integer(biome, 0, NATURAL_BIOMES.length - 1) ? biome : NaturalBiome.Grassland, 'legacy'), remaining: c.stone.remaining };
      }
    }
    // Unfinished stone work releases its old, unspent reservation before repricing.
    const release = new Set<number>();
    if (record(save.crafting) && Array.isArray(save.crafting.orders)) for (const order of save.crafting.orders) {
      if (!record(order) || !Object.hasOwn(STONE_WEAPONS, String(order.recipe)) || order.recipe === 'stone-axe') continue;
      order.inputs = { ...STONE_WEAPONS[order.recipe as keyof typeof STONE_WEAPONS].inputs };
      if (order.paid || !['waiting', 'working'].includes(String(order.state))) continue;
      const worker = save.entities.find(e => record(e) && e.id === order.workerId);
      if (record(worker) && record(worker.components) && record(worker.components.citizen)) {
        const c = worker.components.citizen;
        if (record(c.work) && c.work.orderId === order.id) {
          release.add(Number(worker.id)); delete c.work;
          if (c.task === 'work') { c.task = 'idle'; c.targetId = null; c.path = []; }
        }
      }
      Object.assign(order, { workerId: null, workplaceId: null, progress: 0, state: 'waiting', reason: 'materials' });
    }
    if (record(save.society) && Array.isArray(save.society.villages)) for (const v of save.society.villages) {
      if (!record(v) || !record(v.economy) || !Array.isArray(v.economy.storage)) continue;
      for (const store of v.economy.storage) if (record(store) && Array.isArray(store.reservations))
        store.reservations = store.reservations.filter(r => !record(r) || !release.has(Number(r.claimant)));
    }
    return { ...save, version: 39 };
  }],
  [39, migrateCommonMetals],
  [40, save => {
    // Preserve old stock and sources. Only active rare-material reservations gain a deadline.
    if (record(save.crafting) && Array.isArray(save.crafting.orders)) for (const o of save.crafting.orders) {
      if (record(o) && record(o.inputs) && o.inputs.gems && o.state === 'working') o.reservedUntil = Number(save.tick) + GEMS.reservationTicks;
    }
    return { ...save, version: 41 };
  }],
  [41, migrateSilver],
  // Existing bones and original death times survive. Optional consumer/raised
  // policies stay absent; no deposits, traits or resources are granted on load.
  [42, save => ({ ...save, version: 43 })],
  [43, migrateUnits],
  [44, migrateCreatures],
  // Existing owners retain their work, cargo and timers. Stages are adopted lazily, without RNG.
  [45, save => ({ ...save, version: 46 })],
  // Optional lifecycle context is adopted without rerunning actions or drawing randomness.
  [46, save => ({ ...save, version: 47 })],
  [48, migrateFamilies],
  // No cause can be reconstructed reliably from old animations or nearby units.
  [47, save => ({ ...save, deaths: newDeaths(), version: 48 })],
  // Optional form history and personal bonds. Existing units gain no rebirth grant.
  [49, save => ({ ...save, version: 50 })],
  [50, migrateHappiness],
  [51, migrateStats],
  [52, migrateLevels],
  [53, migrateStatuses],
  [54, migrateSubspecies],
  [55, migrateReproduction],
  [56, migrateGenetics],
  [57, migratePhenotypes],
  [58, migrateLeather],
  [59, save => ({ ...save, version: 60, speed: save.speed === 40 ? 20 : save.speed })],
  [60, (save, registry) => ({ ...save, version: 61, processes: newWorldProcesses(Number(save.seed), Number(save.tick), registry) })],
  [61, save => ({ ...save, version: 62, worldRules: newWorldRules() })],
  [62, save => {
    if (!record(save.terrain)) throw new Error('Invalid saved terrain');
    return { ...save, version: 63, terrain: { ...save.terrain, layers: [], visualSeed: Number(save.seed) >>> 0 } };
  }],
  [63, migrateCurrency],
  [64, migrateGold],
  [65, migrateBiomeEcology],
  [66, migrateTemperature],
  [67, migratePhysiology],
  // Legacy transport retains its existing cargo and receipts; no retroactive supply or income.
  [68, save => ({ ...save, version: 69 })],
  [69, migrateClouds],
  [70, migrateFood],
  [71, migrateLifespans],
]);

export function decodeSave(raw: unknown, registry: Registry): WorldSnapshot {
  if (!record(raw) || !integer(raw.version, 1)) throw new Error('Не удалось прочитать сохранённый мир');
  let save: RecordValue = structuredClone(raw);
  if (Number(save.version) > SAVE_VERSION) throw new Error('Этот мир сохранён в более новой версии игры');
  while (save.version !== SAVE_VERSION) {
    const migrate = migrations.get(Number(save.version));
    if (!migrate) throw new Error('Версия сохранения больше не поддерживается');
    save = migrate(save, registry);
  }
  normalizeUnknownPhenotypes(save);
  const fail = (): never => { throw new Error('Сохранённый мир повреждён или содержит неподдерживаемые данные'); };
  if (!Array.isArray(save.contentPacks) || save.contentPacks.length > 1024 || new Set(save.contentPacks).size !== save.contentPacks.length) return fail();
  const installedPacks = new Set(registry.packIds);
  for (const id of save.contentPacks) {
    if (typeof id !== 'string') return fail();
    if (!installedPacks.has(id)) throw new Error(`Для сохранения нужен пакет контента: ${id}`);
  }
  if (!integer(save.seed, 0, 0xffffffff) || !integer(save.rngState, 0, 0xffffffff) || !integer(save.tick) || !integer(save.nextEntityId, 1) || !bool(save.paused)) fail();
  if (!isSimulationSpeed(save.speed) || !validWorldRules(save.worldRules, Number(save.tick))) fail();
  const terrain = save.terrain;
  if (!record(terrain) || !integer(terrain.width, 16, WORLD_WIDTH) || !integer(terrain.height, 16, WORLD_HEIGHT)) return fail();
  const width = terrain.width as number, height = terrain.height as number;
  if (!validWorldProcesses(save.processes, registry, Number(save.tick), width * height, Number(save.nextEntityId))) return fail();
  if (!Array.isArray(terrain.tiles) || terrain.tiles.length !== width * height || !terrain.tiles.every(t => integer(t, 0, Terrain.Summit))) fail();
  if (!Array.isArray(terrain.moisture) || terrain.moisture.length !== width * height || !terrain.moisture.every(m => number(m, 0, 3.1))) fail();
  if (!Array.isArray(terrain.biomes) || terrain.biomes.length !== width * height || !Array.from(terrain.biomes).every(b => integer(b, 0, NATURAL_BIOMES.length - 1))) fail();
  if (!Array.isArray(terrain.surfaces) || terrain.surfaces.length !== width * height || !Array.from(terrain.surfaces).every(surface => integer(surface, 0, 3))) fail();
  if (!validTileLayers(terrain as unknown as WorldSnapshot['terrain'])) fail();
  for (const layer of (terrain as unknown as WorldSnapshot['terrain']).layers ?? [])
    if ((layer.thermalAt ?? 0) > Number(save.tick) || (layer.thermalChange?.tick ?? 0) > Number(save.tick)) fail();
  if (!Array.isArray(terrain.recovery) || terrain.recovery.length > width * height) return fail();
  const recovering = new Set<number>();
  const tiles = terrain.tiles as number[];
  for (const state of terrain.recovery) {
    if (!record(state) || !integer(state.index, 0, tiles.length - 1) || recovering.has(state.index)
      || !isDamagedTerrain(tiles[state.index]) || (state.target !== 2 && state.target !== 3)
      || !integer(state.age, 0, recoveryDuration(tiles[state.index], state.index % width, Math.floor(state.index / width), Number(save.seed)) - 1)) return fail();
    recovering.add(state.index);
  }
  if (tiles.some((tile, i) => isDamagedTerrain(tile) && !recovering.has(i))) fail();
  if (!Array.isArray(terrain.roadWear) || terrain.roadWear.length > tiles.length) return fail();
  const worn = new Set<number>();
  for (const state of terrain.roadWear) {
    if (!record(state) || !integer(state.index, 0, tiles.length - 1) || worn.has(state.index)
      || !integer(state.age, 0, ROAD_OVERGROWTH_SECONDS) || !integer(state.target, Terrain.DeepWater, Terrain.Grass)
      || state.waterDepth !== undefined && (Number(state.target) >= Terrain.Sand || !integer(state.waterDepth, 1, 3))) return fail();
    const base = tiles[state.index], water = Number(state.target) < Terrain.Sand;
    if (state.age === ROAD_OVERGROWTH_SECONDS ? base !== state.target && (water || !isDamagedTerrain(base))
      : water ? !isBridge(base) && base !== state.target
      : base !== Terrain.Road && !isDamagedTerrain(base) && base !== state.target) return fail();
    worn.add(state.index);
  }
  if (!Array.isArray(save.entities) || save.entities.length > ENTITY_LIMIT) return fail();
  const society = save.society;
  if (!record(society) || !integer(society.nextVillageId, 1) || !Array.isArray(society.villages) || society.villages.length > 300) return fail();
  const villages = new Set<number>();
  for (const village of society.villages) {
    if (!record(village) || !integer(village.id, 1) || villages.has(village.id) || village.id >= Number(society.nextVillageId)
      || village.race !== undefined && !isRace(village.race)
      || typeof village.name !== 'string' || village.name.length > 80 || !number(village.x, 0, width) || !number(village.y, 0, height)
      || !number(village.food, 0, 2000) || !integer(village.harvested) || !integer(village.founded, 0, Number(save.tick)) || !integer(village.migrationAfter) || !validVillageLife(village)
      || record(village.government) && Number(village.government.electedAt) > Number(save.tick)) return fail();
    if (village.roadPlan !== undefined && (!record(village.roadPlan) || !integer(village.roadPlan.after)
      || !integer(village.roadPlan.cursor, 0, ENTITY_LIMIT) || !ROAD_PROBLEMS.includes(village.roadPlan.problem as typeof ROAD_PROBLEMS[number]))) return fail();
    villages.add(village.id);
  }
  const pairs = new Set<string>();
  if (!Array.isArray(society.relations) || society.relations.length > 44850) return fail();
  for (const r of society.relations) {
    if (!record(r) || !integer(r.a, 1) || !integer(r.b, r.a + 1) || !villages.has(r.a) || !villages.has(r.b) || pairs.has(`${r.a}:${r.b}`)
      || !['neutral', 'alliance', 'war'].includes(String(r.status)) || !number(r.affinity, -100, 100)
      || !integer(r.since, 0, Number(save.tick)) || !integer(r.nextDecision) || !integer(r.roadAttempt, -1)) return fail();
    pairs.add(`${r.a}:${r.b}`);
  }
  if (pairs.size !== villages.size * (villages.size - 1) / 2) fail();
  if (!integer(society.nextWarId, 1) || !Array.isArray(society.wars) || society.wars.length > 44850) return fail();
  const warIds = new Set<number>(), warPairs = new Set<string>();
  const validSide = (side: unknown): side is number[] => Array.isArray(side) && side.length > 0 && side.length <= 300
    && side.every(id => integer(id, 1) && villages.has(id)) && new Set(side).size === side.length;
  for (const war of society.wars) {
    if (!record(war) || !integer(war.id, 1) || war.id >= Number(society.nextWarId) || warIds.has(war.id)
      || !validSide(war.attackers) || !validSide(war.defenders) || war.attackers.some(id => (war.defenders as number[]).includes(id))
      || !integer(war.started, 0, Number(save.tick)) || !integer(war.musterUntil, war.started, war.started + 240)
      || !integer(war.attackTarget, 1) || !war.defenders.includes(war.attackTarget) || !integer(war.rallyVillage, 1) || !war.attackers.includes(war.rallyVillage)
      || !integer(war.initialAttackers, 0, 1e6) || !integer(war.initialDefenders, 0, 1e6) || !integer(war.lossesAttackers) || !integer(war.lossesDefenders)) return fail();
    for (const a of war.attackers) for (const b of war.defenders) {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (warPairs.has(key) || !pairs.has(key)) fail();
      warPairs.add(key);
    }
    warIds.add(war.id);
  }
  for (const r of society.relations) {
    if ((r.status === 'war') !== warPairs.has(`${r.a}:${r.b}`)) fail();
  }
  const typedSociety = society as unknown as Society;
  for (const group of allianceGroups(typedSociety)) {
    for (const r of typedSociety.relations) if (group.includes(r.a) && group.includes(r.b) && r.status !== 'alliance') fail();
    for (const war of society.wars as War[]) {
      for (const side of [war.attackers, war.defenders]) if (group.some(id => side.includes(id)) && !group.every(id => side.includes(id))) fail();
    }
  }
  if (!Array.isArray(society.roads) || society.roads.length > 300) return fail();
  const roads = new Set<string>();
  for (const road of society.roads) {
    if (!record(road)) return fail();
    const local = road.buildings !== undefined;
    if (local && (!integer(road.a, 1) || road.a !== road.b || !villages.has(Number(road.a)) || !Array.isArray(road.buildings) || road.buildings.length !== 2
      || !road.buildings.every(id => integer(id, 1, Number(save.nextEntityId) - 1)) || road.buildings[0] === road.buildings[1])) return fail();
    const roadKey = local ? `${road.a}:buildings:${[...(road.buildings as number[])].sort((a, b) => a - b).join(':')}` : `${road.a}:${road.b}`;
    if (!local && !pairs.has(roadKey) || roads.has(roadKey) || !Array.isArray(road.tiles)
      || !road.tiles.length || road.tiles.length > width * height || !road.tiles.every(i => integer(i, 0, width * height - 1)) || !integer(road.built, 0, road.tiles.length)) return fail();
    for (let i = 1; i < road.tiles.length; i++) {
      const a = Number(road.tiles[i - 1]), b = Number(road.tiles[i]);
      if (Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width)) !== 1) fail();
    }
    const deckTiles = new Set<number>(), ferryTiles = new Set<number>();
    if (road.bridges !== undefined) {
      if (!Array.isArray(road.bridges) || road.bridges.length > Number(road.built)) return fail();
      for (const deck of road.bridges) {
        if (!record(deck) || !integer(deck.tile, 0, tiles.length - 1) || deckTiles.has(deck.tile)
          || deck.terrain !== Terrain.BridgeHorizontal && deck.terrain !== Terrain.BridgeVertical) return fail();
        const n = road.tiles.indexOf(deck.tile), stride = deck.terrain === Terrain.BridgeHorizontal ? 1 : width;
        if (n <= 0 || n >= Number(road.built) || n + 1 >= road.tiles.length
          || Math.abs(Number(road.tiles[n - 1]) - deck.tile) !== stride || Math.abs(Number(road.tiles[n + 1]) - deck.tile) !== stride) return fail();
        deckTiles.add(deck.tile);
      }
    }
    if (road.ferries !== undefined) {
      if (!Array.isArray(road.ferries) || road.ferries.length > road.tiles.length) return fail();
      for (const ferry of road.ferries) {
        if (!record(ferry) || !integer(ferry.start, 0, Number(road.built) - 1) || !integer(ferry.end, Number(ferry.start) + MAX_BRIDGE_SPAN + 2, Math.min(Number(road.built), road.tiles.length - 1))
          || Number(ferry.end) - Number(ferry.start) > MAX_FERRY_SPAN + 1 || !number(ferry.progress, 0, 1)
          || ferry.target !== 0 && ferry.target !== 1 || !number(ferry.wait, 0, 1)
          || !Array.isArray(ferry.passengers) || ferry.passengers.length > FERRY_CAPACITY || new Set(ferry.passengers).size !== ferry.passengers.length) return fail();
        const stride = Number(road.tiles[ferry.start + 1]) - Number(road.tiles[ferry.start]);
        for (let n = ferry.start + 1; n <= ferry.end; n++) {
          const tile = Number(road.tiles[n]);
          if (tile - Number(road.tiles[n - 1]) !== stride || deckTiles.has(tile) || ferryTiles.has(tile)) fail();
          if (n < ferry.end) ferryTiles.add(tile);
        }
      }
    }
    roads.add(roadKey);
  }
  if (!Array.isArray(society.history) || society.history.length > 40 || !society.history.every(e => record(e) && integer(e.tick, 0, Number(save.tick)) && typeof e.text === 'string' && e.text.length <= 300)) fail();
  if (!validPhysiologySave(save as unknown as WorldSnapshot)) return fail();
  if (!validSubspeciesSave(save as unknown as WorldSnapshot, registry)) return fail();
  const ids = new Set<number>();
  const lootOrigins = new Set<number>();
  const homes = new Map<number, number>();
  const inhabitants = new Map<number, number>();
  let population = 0;
  const requiredByType = new Map<string, readonly string[]>();
  for (const entity of save.entities) {
    if (!record(entity) || !integer(entity.id, 1) || ids.has(entity.id) || entity.id >= Number(save.nextEntityId) || !record(entity.components) || typeof entity.typeId !== 'string') return fail();
    const definition = registry.entities.get(entity.typeId);
    if (record(entity.components.thermal)) {
      const thermal = entity.components.thermal;
      if (record(thermal.lastChange) && Number(thermal.lastChange.tick) > Number(save.tick)
        || entity.components.unit && Number(thermal.temperature) > 300) fail();
    }
    if (!definition) throw new Error(`В сохранении есть неизвестный тип: ${entity.typeId}`);
    let required = requiredByType.get(definition.id);
    if (!required) {
      required = definition.required ?? Object.keys(definition.create({ x: 0, y: 0 }, new Random(1)));
      requiredByType.set(definition.id, required);
    }
    const components = entity.components;
    if (definition.speciesId ? !record(components.creature) || components.creature.speciesId !== definition.speciesId : components.creature !== undefined) fail();
    if (record(components.creature) && (components.creature.since !== null && Number(components.creature.since) > Number(save.tick)
      || record(components.creature.result) && (Number(components.creature.result.at) > Number(save.tick)
        || components.creature.since !== null && Number(components.creature.result.at) < Number(components.creature.since)))) fail();
    if (required.some(key => !(key in components))) fail();
    if (definition.speciesId) {
      try { validateSpeciesComponents(registry.species.get(definition.speciesId)!, definition, components as import('../core/types').Components); }
      catch { fail(); }
    }
    const nativeRace = RACE_IDS.find(race => RACES[race].entityId === entity.typeId);
    if (nativeRace && (!record(components.person) || (components.person.race ?? 'human') !== nativeRace)) fail();
    for (const [key, component] of Object.entries(entity.components)) {
      const validate = registry.components.get(key as ComponentKey);
      if (!validate || !record(component) || !validate(component)) fail();
    }
    const p = entity.components.position;
    if (entity.typeId === 'core:gold-ore' && (!record(components.stone) || components.stone.profile !== 'goldOre')) fail();
    if (record(components.stone) && components.stone.profile === 'goldOre'
      && (entity.typeId !== 'core:gold-ore' || components.commonMetal !== undefined
        || !['placed', 'mine', 'biology'].includes(String(components.stone.origin)))) fail();
    if (record(components.stone) && components.stone.origin === 'biology' && components.stone.profile !== 'goldOre') fail();
    if (record(components.ship) && record(components.ship.goldVoyage)) {
      const voyage = components.ship.goldVoyage;
      if (Number(voyage.departed) > Number(save.tick) || Number(voyage.fromId) >= society.nextVillageId
        || Number(voyage.toId) >= society.nextVillageId
        || !voyage.settled && (components.ship.cargoOwnerId !== voyage.fromId || Number(components.ship.cargo) <= 0 && !record(components.shipment))) fail();
    }
    if (record(components.temple) && (entity.typeId !== 'core:temple' || !record(components.building)
      || components.building.level !== 1 || components.dwelling !== undefined || components.workplace !== undefined
      || components.stockpile !== undefined || components.harbor !== undefined || components.farm !== undefined
      || components.ruin !== undefined || record(components.thermal) && components.thermal.burning)) fail();
    if (entity.typeId === 'core:silver-ore' && (!record(components.stone) || components.stone.profile !== 'silverOre')) fail();
    if (record(components.stone) && components.stone.profile === 'silverOre'
      && (entity.typeId !== 'core:silver-ore' || components.commonMetal !== undefined
        || !['natural', 'placed', 'mine', 'legacy'].includes(String(components.stone.origin))
        || components.stone.origin === 'natural' && !SILVER_WEIGHTS[components.stone.biome as NaturalBiome])) fail();
    if (entity.typeId === 'core:bone-deposit' && (!record(components.stone) || components.stone.profile !== 'boneDeposit')) fail();
    if (record(components.stone) && components.stone.profile === 'boneDeposit'
      && (entity.typeId !== 'core:bone-deposit' || components.stone.biome !== NaturalBiome.Corrupted || !['natural', 'mine'].includes(String(components.stone.origin)))) fail();
    if (record(components.resourceConsumer) && !record(components.person)) fail();
    if (record(components.gemSource) && (Number(components.gemSource.createdAt) > Number(save.tick)
      || entity.typeId !== (components.gemSource.kind === 'ore' ? 'core:gem-ore' : 'core:crystal-plant'))) fail();
    if (entity.typeId === 'core:tree' && !record(components.tree)) fail();
    if (record(p) && (Number(p.x) >= width || Number(p.y) >= height)) fail();
    if (record(entity.components.dwelling)) homes.set(entity.id, Number(entity.components.dwelling.capacity));
    if (record(components.building)) {
      const b = components.building as unknown as Building, project = b.project;
      if (['core:temple', 'core:mine'].includes(b.kind) && (b.level !== 1 || project?.legacyGoldCost)) fail();
      if (b.level > ARCHITECTURES[b.architecture].levels || (entity.typeId !== 'core:ruin' && b.kind !== entity.typeId)
        || entity.typeId === 'core:ruin' && b.state !== 'ruined' && project?.action !== 'clear') fail();
      if (project) {
        const cost = buildingCost(entity as unknown as import('../core/types').Entity, project.action);
        if (project.legacyGoldCost) {
          if (!cost.gold || project.cost.gold !== undefined) fail();
          delete cost.gold;
        }
        if (project.struckAt > Number(save.tick) || project.progress > 0 && !project.paid
          || project.paid && b.state !== 'construction' || !project.paid && !['planned', 'reserved'].includes(b.state)
          || project.action === 'clear' && entity.typeId !== 'core:ruin'
          || project.action === 'upgrade' && (!record(components.dwelling) || b.level !== 1)
          || entries(cost).some(([id, n]) => project.cost[id] !== n) || entries(project.cost).some(([id, n]) => cost[id] !== n)) fail();
      } else if (['planned', 'reserved', 'construction'].includes(b.state)) fail();
    }
    if (record(entity.components.person)) {
      population++;
      const displaced = entity.components.person.displaced;
      if (record(displaced) && (Number(displaced.since) > Number(save.tick) || Number(displaced.homeId) >= Number(save.nextEntityId))) fail();
      const homeId = entity.components.person.homeId;
      if (homeId !== null) inhabitants.set(Number(homeId), (inhabitants.get(Number(homeId)) ?? 0) + 1);
    }
    for (const key of ['citizen', 'dwelling', 'farm', 'animal', 'workplace', 'stockpile', 'temple', 'mine']) {
      const component = components[key];
      if (record(component) && component.villageId !== null && !villages.has(Number(component.villageId))) fail();
      if (record(component) && component.villageId !== null && key === 'citizen') {
        const race = record(components.person) ? components.person.race : undefined;
        const village = typedSociety.villages.find(v => v.id === component.villageId);
        if ((race ?? 'human') !== (village?.race ?? 'human')) fail();
      }
    }
    const pile = components.resourcePile;
    if (record(pile)) {
      if (!record(components.thermal) || !record(components.combustible)) fail();
      if (Number(pile.createdAt) > Number(save.tick) || Number(pile.originId) >= Number(save.nextEntityId) || lootOrigins.has(Number(pile.originId))
        || save.entities.some(e => e.id === pile.originId)) fail();
      lootOrigins.add(Number(pile.originId));
    }
    const raised = components.raisedRemains;
    if (record(raised)) {
      if ((!record(components.person) && !record(components.animal)) || record(pile) || Number(raised.originId) >= Number(save.nextEntityId)
        || lootOrigins.has(Number(raised.originId)) || save.entities.some(e => e.id === raised.originId)) fail();
      lootOrigins.add(Number(raised.originId));
    }
    const citizen = components.citizen;
    if (record(citizen)) {
      if ((citizen.parents as number[]).includes(entity.id) || (citizen.path as { x: number; y: number }[]).some(p => p.x >= width || p.y >= height)) fail();
      if (record(citizen.repair) && Number(citizen.repair.tile) >= width * height) fail();
      if (record(citizen.emergency) && (citizen.emergency.path as { x: number; y: number }[]).some(p => p.x >= width || p.y >= height)) fail();
    }
    if (record(components.ruin) && (Number(components.ruin.destroyedAt) > Number(save.tick) || Number(components.ruin.homeId) >= Number(save.nextEntityId))) fail();
    const caravan = components.caravan;
    if (record(caravan) && (!record(p) || !villages.has(Number(caravan.fromId)) || caravan.toId !== null && !villages.has(Number(caravan.toId))
      || (caravan.path as { x: number; y: number }[]).some(p => p.x >= width || p.y >= height))) fail();
    ids.add(entity.id);
  }
  const passengers = new Set<number>();
  for (const road of typedSociety.roads) for (const ferry of road.ferries ?? []) {
    let seats = 0;
    const first = road.tiles[ferry.start], last = road.tiles[ferry.end];
    const x = first % width + 0.5 + (last % width - first % width) * ferry.progress;
    const y = Math.floor(first / width) + 0.5 + (Math.floor(last / width) - Math.floor(first / width)) * ferry.progress;
    for (const id of ferry.passengers) {
      if (!integer(id, 1) || passengers.has(id)) fail();
      const e = save.entities.find(e => e.id === id), c = e?.components;
      if (!c || !record(c.position) || !record(c.citizen) && !record(c.caravan)
        || Math.hypot(Number(c.position.x) - x, Number(c.position.y) - y) > 0.01) return fail();
      seats += record(c.caravan) ? FERRY_CAPACITY : 1; passengers.add(id);
    }
    if (seats > FERRY_CAPACITY) fail();
  }
  const byId = new Map(save.entities.map(e => [e.id as number, e.components as RecordValue]));
  for (const c of byId.values()) {
    if (record(c.creature) && record(c.creature.result) && c.creature.result.targetId !== null && !byId.has(Number(c.creature.result.targetId))) fail();
  }
  const storedBuildings = new Set<number>();
  const miners = new Set<number>();
  for (const entity of save.entities) {
    const deposit = (entity.components.stone ?? entity.components.commonMetal) as Deposit | undefined;
    if (!deposit) continue;
    for (const claim of deposit.claims) {
      const worker = byId.get(claim.workerId)?.citizen;
      if (miners.has(claim.workerId) || claim.expires <= Number(save.tick) || claim.expires > Number(save.tick) + STONE.claimTicks
        || !villages.has(claim.villageId) || !record(worker) || worker.villageId !== claim.villageId || worker.task !== 'work'
        || worker.targetId !== entity.id || !record(worker.work) || worker.work.good !== SOURCE_PROFILES[deposit.profile].primary
        || worker.work.cargo !== null || worker.work.orderId !== undefined) fail();
      miners.add(claim.workerId);
    }
  }
  for (const entity of save.entities) {
    const tree = entity.components.tree;
    if (!record(tree) || tree.claim === null) continue;
    const claim = tree.claim as RecordValue, worker = byId.get(Number(claim.workerId))?.citizen;
    if (!villages.has(Number(claim.villageId)) || !record(worker) || worker.villageId !== claim.villageId || worker.task !== 'work'
      || worker.targetId !== entity.id || !record(worker.work) || worker.work.good !== 'wood' || worker.work.cargo !== null || worker.work.orderId !== undefined) fail();
  }
  for (const village of typedSociety.villages) {
    const storage = village.economy?.storage;
    if (!storage) return fail();
    const total: ResourceBundle = {}, claims = new Map<number, ResourceBundle>();
    for (const store of storage) {
      const building = save.entities.find(e => e.id === store.buildingId);
      if (!building || record(building.components.ruin) || !hasCapability(building as unknown as import('../core/types').Entity, 'storage')
        || storedBuildings.has(store.buildingId) || storageOwner(building as unknown as import('../core/types').Entity) !== village.id) return fail();
      storedBuildings.add(store.buildingId); addBundle(total, store.goods);
      const reserved: ResourceBundle = {}, claimants = new Set<number>();
      for (const r of store.reservations) {
        if (!ids.has(r.claimant) || claimants.has(r.claimant)) return fail();
        claimants.add(r.claimant); addBundle(reserved, r.goods);
        const sum = claims.get(r.claimant) ?? {}; addBundle(sum, r.goods); claims.set(r.claimant, sum);
      }
      if (entries(reserved).some(([id, n]) => n > (store.goods[id] ?? 0) + 1e-8)) return fail();
    }
    if (entries(total).some(([id, n]) => n > 2000 + 1e-8 || id !== 'provisions' && Math.abs(n - (village.economy!.stocks[id] ?? 0)) > 1e-8)
      || entries(village.economy!.stocks).some(([id, n]) => Math.abs(n - (total[id] ?? 0)) > 1e-8)
      || Math.abs(entries(total).reduce((sum, [id, n]) => sum + (canConsume(id, RESIDENT_DIET) ? n : 0), 0) - village.food) > 1e-8) return fail();
    for (const [claimant, goods] of claims) {
      const holder = byId.get(claimant), c = holder?.citizen, b = holder?.building;
      const project = record(b) && record(b.project) ? b.project : undefined;
      let expected: ResourceBundle | undefined;
      if (project && !project.paid) {
        const entity = save.entities.find(e => e.id === claimant)!;
        if (storageOwner(entity as unknown as import('../core/types').Entity) !== village.id || (b as RecordValue).state !== 'reserved') return fail();
        expected = project.cost as ResourceBundle;
      } else {
        if (!record(c) || c.villageId !== village.id) return fail();
        const work = c.work, target = byId.get(Number(c.targetId));
        expected = c.task === 'work' && record(work) && record(work.reservation) && work.cargo === null
          && record(target?.workplace) && isCrafted(String(work.good)) && target.workplace.kind === RECIPES[work.good as keyof typeof RECIPES].station && target.workplace.villageId === village.id ? work.reservation.inputs as ResourceBundle : undefined;
      }
      if (!expected || entries(expected).some(([id, n]) => Math.abs(n - (goods[id] ?? 0)) > 1e-8)
        || entries(goods).some(([id, n]) => Math.abs(n - (expected[id] ?? 0)) > 1e-8)) return fail();
    }
  }
  const reservations = new Map<number, ResourceBundle>();
  for (const components of byId.values()) {
    const c = components.citizen;
    if (!record(c) || c.task !== 'work' || !record(c.work) || !record(c.work.reservation)) continue;
    const r = c.work.reservation, station = byId.get(Number(c.targetId))?.workplace;
    // A changed task, settlement or destroyed station releases its claim immediately,
    // even if the worker has not yet reconsidered its old route.
    if (r.villageId !== c.villageId || !isCrafted(String(c.work.good)) || !record(station)
      || station.villageId !== r.villageId || station.kind !== RECIPES[c.work.good as keyof typeof RECIPES].station) continue;
    const total = reservations.get(Number(r.villageId)) ?? {};
    addBundle(total, r.inputs as ResourceBundle); reservations.set(Number(r.villageId), total);
  }
  for (const village of typedSociety.villages) {
    if (entries(reservations.get(village.id) ?? {}).some(([id, n]) => n > (village.economy?.stocks[id] ?? 0) + 1e-8)) fail();
    const leader = village.government?.leaderId;
    if (leader != null && !record(byId.get(leader)?.person)) fail();
    if (leader != null) {
      const entity = (save.entities as WorldSnapshot['entities']).find(e => e.id === leader)!;
      if (entity.components.citizen?.villageId !== village.id || !canGovern(registry, entity)) village.government!.leaderId = null;
    }
  }
  for (const entity of save.entities) {
    const animal = entity.components.animal;
    if (record(animal)) {
      if (animal.ownerId !== null && !record(byId.get(Number(animal.ownerId))?.person)
        || animal.targetId !== null && !ids.has(Number(animal.targetId))
        || (animal.path as { x: number; y: number }[]).some(p => p.x >= width || p.y >= height)) fail();
    }
  }
  if (!integer(society.nextMigrationId, 1) || !Array.isArray(society.migrations) || society.migrations.length > 16) return fail();
  const migrationIds = new Set<number>(), travelers = new Set<number>(), reserved = new Map<number, number>();
  for (const group of society.migrations) {
    if (!record(group) || !integer(group.id, 1) || group.id >= Number(society.nextMigrationId) || migrationIds.has(group.id)
      || !integer(group.fromId, 1) || !villages.has(group.fromId)
      || group.toId !== null && (!integer(group.toId, 1) || !villages.has(group.toId))
      || !record(group.destination) || !number(group.destination.x, 0, width - 0.001) || !number(group.destination.y, 0, height - 0.001)
      || !Array.isArray(group.members) || group.members.length < 1 || group.members.length > 10
      || !Array.isArray(group.homeIds) || group.homeIds.length > 1 || group.toId === null && group.homeIds.length !== 0
      || !number(group.food, 0, 30) || !validFoodGoods(group.foodGoods, Number(group.food)) || !integer(group.started, 0, Number(save.tick))) return fail();
    migrationIds.add(group.id);
    for (const id of group.members) {
      if (!integer(id, 1) || travelers.has(id)) return fail();
      const c = byId.get(id);
      if (!c || !record(c.person) || c.person.homeId !== null || !record(c.citizen) || c.citizen.task !== 'migrate'
        || c.citizen.villageId !== group.fromId || c.citizen.targetId !== null) return fail();
      travelers.add(id);
    }
    for (const id of group.homeIds) {
      if (!integer(id, 1)) return fail();
      const home = byId.get(id)?.dwelling;
      if (!record(home) || home.villageId !== group.toId) return fail();
      reserved.set(id, (reserved.get(id) ?? 0) + group.members.length);
    }
  }
  for (const entity of save.entities) {
    const c = entity.components.citizen;
    if (!record(c)) continue;
    const person = entity.components.person;
    if (record(person) && person.homeId !== null) {
      const home = byId.get(Number(person.homeId))?.dwelling;
      if (!record(home) || (home.race ?? 'human') !== (person.race ?? 'human')) fail();
    }
    if (c.task === 'migrate' && !travelers.has(entity.id)) fail();
    if (c.task === 'socialize' && (!record(byId.get(Number(c.targetId))?.person) || c.targetId === entity.id)) fail();
    if (record(c.integration)) {
      const state = c.integration;
      if (state.villageId !== c.villageId || Number(state.arrived) > Number(save.tick)
        || Number(state.groupId) >= Number(society.nextMigrationId)) fail();
      for (const key of ['friendId', 'contactId']) if (state[key] !== null
        && (state[key] === entity.id || !record(byId.get(Number(state[key]))?.person))) fail();
    }
    if (c.task === 'build') {
      const site = byId.get(Number(c.targetId));
      if (!record(person) || !isAdult(entity as unknown as WorldSnapshot['entities'][number]) || !record(site?.building) || !record(site.building.project)
        || record(site.dwelling) && (site.dwelling.race ?? 'human') !== (person.race ?? 'human')) fail();
    }
    if (c.targetId !== null && !ids.has(Number(c.targetId))) fail();
    if (record(c.emergency) && c.emergency.targetId !== null) {
      const target = byId.get(Number(c.emergency.targetId));
      if (!target || c.emergency.targetId === entity.id || !record(person) || !isAdult(entity as unknown as WorldSnapshot['entities'][number])
        || c.emergency.kind === 'aid' && (!record(target.person) || !record(target.health))
        || c.emergency.kind === 'extinguish' && !record(target.thermal)) fail();
    }
    if (c.partnerId !== null) {
      const partnerComponents = byId.get(Number(c.partnerId));
      const partner = partnerComponents?.citizen;
      if (!record(partner) || partner.partnerId !== entity.id || c.partnerId === entity.id) fail();
      if (record(person) && record(partnerComponents?.person) && (person.race ?? 'human') !== (partnerComponents.person.race ?? 'human')) fail();
    }
  }
  if (population > POPULATION_LIMIT || [...inhabitants].some(([id, count]) => !homes.has(id) || count + (reserved.get(id) ?? 0) > homes.get(id)!)
    || [...reserved].some(([id, count]) => count + (inhabitants.get(id) ?? 0) > homes.get(id)!)) fail();
  if (!Array.isArray(save.effects) || save.effects.length > 64 || !save.effects.every(e => record(e) && e.kind === 'rain' && number(e.x, 0, width) && number(e.y, 0, height) && number(e.radius, 0.1, 64) && number(e.remaining, 0, 1e6))) fail();
  if (!Array.isArray(save.events) || save.events.length > 200000) return fail();
  const context = { width, height };
  for (const event of save.events) if (!registry.validateEvent(event, context)) fail();
  if (!Array.isArray(save.scenarios) || save.scenarios.length > 64) return fail();
  const scenarios = new Set<string>();
  for (const scenario of save.scenarios) {
    if (!record(scenario) || typeof scenario.id !== 'string' || scenarios.has(scenario.id)) return fail();
    const definition = registry.scenarios.get(scenario.id);
    if (!definition) throw new Error(`В сохранении есть неизвестный сценарий: ${scenario.id}`);
    if (!definition.validate(scenario.state)) fail();
    scenarios.add(scenario.id);
  }
  if (!validSupplySave(save as unknown as WorldSnapshot)) fail();
  if (!validEquipmentSave(save as unknown as WorldSnapshot)) fail();
  if (!validCurrencySave(save as unknown as WorldSnapshot)) fail();
  if (!validStatsSave(save as unknown as WorldSnapshot)) fail();
  if (!validTraitsSave(save as unknown as WorldSnapshot)) fail();
  if (!validReproductionSave(save as unknown as WorldSnapshot, registry)) return fail();
  if (!validStatusesSave(save as unknown as WorldSnapshot)) fail();
  if (!validCraftingSave(save as unknown as WorldSnapshot)) fail();
  if (!validUnitsSave(save as unknown as WorldSnapshot, registry)) fail();
  if (!validFoodSave(save as unknown as WorldSnapshot)) fail();
  if (!validHappinessSave(save as unknown as WorldSnapshot, registry)) fail();
  if (!validFamiliesSave(save as unknown as WorldSnapshot, registry)) fail();
  if (!validDeathsSave(save as unknown as WorldSnapshot, registry)) fail();
  if (!validTransformationsSave(save as unknown as WorldSnapshot, registry)) fail();
  if (!validBehaviourSave(save as unknown as WorldSnapshot, registry)) fail();
  if (!validNeuronSave(save as unknown as WorldSnapshot)) fail();
  if (!validJobsSave(save as unknown as WorldSnapshot)) fail();
  if (!validMinesSave(save as unknown as WorldSnapshot)) fail();
  if (!validTerritories(save as unknown as WorldSnapshot)) fail();
  return save as unknown as WorldSnapshot;
}
