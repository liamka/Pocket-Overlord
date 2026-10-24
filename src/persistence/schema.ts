import { legacyBridges } from '../core/roads';
import type { Registry } from '../content/registry';
import { Random } from '../core/random';
import { NAPALM } from '../content/napalm';
import { LEGACY_ROCKET_HEADING } from '../core/flight';
import { isRace, RACES, RACE_IDS } from '../core/races';
import { bool, integer, number, record, type RecordValue } from '../core/validation';
import { isDamagedTerrain, recoveryDuration } from '../core/terrain';
import { NaturalBiome, NATURAL_BIOMES, BIOME_SURFACES } from '../core/natural-biomes';
import { alliedGroup, allianceGroups, normalizeLegacyAlliances, opposingSides } from '../core/diplomacy';
import { ENTITY_LIMIT, FERRY_CAPACITY, MAX_BRIDGE_SPAN, MAX_FERRY_SPAN, POPULATION_LIMIT, ROAD_OVERGROWTH_SECONDS, SAVE_VERSION, Terrain, WORLD_WIDTH, WORLD_HEIGHT, isSimulationSpeed, newCitizen, newSociety, type ComponentKey, type Road, type Society, type War, type WorldSnapshot } from '../core/types';

const migrations = new Map<number, (save: RecordValue) => RecordValue>([
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
]);

export function decodeSave(raw: unknown, registry: Registry): WorldSnapshot {
  if (!record(raw) || !integer(raw.version, 1)) throw new Error('Не удалось прочитать сохранённый мир');
  let save: RecordValue = structuredClone(raw);
  if (Number(save.version) > SAVE_VERSION) throw new Error('Этот мир сохранён в более новой версии игры');
  while (save.version !== SAVE_VERSION) {
    const migrate = migrations.get(Number(save.version));
    if (!migrate) throw new Error('Версия сохранения больше не поддерживается');
    save = migrate(save);
  }
  const fail = (): never => { throw new Error('Сохранённый мир повреждён или содержит неподдерживаемые данные'); };
  if (!Array.isArray(save.contentPacks) || save.contentPacks.length > 1024 || new Set(save.contentPacks).size !== save.contentPacks.length) return fail();
  const installedPacks = new Set(registry.packIds);
  for (const id of save.contentPacks) {
    if (typeof id !== 'string') return fail();
    if (!installedPacks.has(id)) throw new Error(`Для сохранения нужен пакет контента: ${id}`);
  }
  if (!integer(save.seed, 0, 0xffffffff) || !integer(save.rngState, 0, 0xffffffff) || !integer(save.tick) || !integer(save.nextEntityId, 1) || !bool(save.paused)) fail();
  if (!isSimulationSpeed(save.speed)) fail();
  const terrain = save.terrain;
  if (!record(terrain) || !integer(terrain.width, 16, WORLD_WIDTH) || !integer(terrain.height, 16, WORLD_HEIGHT)) return fail();
  const width = terrain.width as number, height = terrain.height as number;
  if (!Array.isArray(terrain.tiles) || terrain.tiles.length !== width * height || !terrain.tiles.every(t => integer(t, 0, Terrain.BridgeVertical))) fail();
  if (!Array.isArray(terrain.moisture) || terrain.moisture.length !== width * height || !terrain.moisture.every(m => number(m, 0, 3.1))) fail();
  if (!Array.isArray(terrain.biomes) || terrain.biomes.length !== width * height || !Array.from(terrain.biomes).every(b => integer(b, 0, NATURAL_BIOMES.length - 1))) fail();
  const biomes = terrain.biomes as number[];
  if (!Array.isArray(terrain.surfaces) || terrain.surfaces.length !== width * height || !Array.from(terrain.surfaces).every((surface, i) => integer(surface, 0, BIOME_SURFACES[biomes[i]].length))) fail();
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
      || !integer(state.age, 0, ROAD_OVERGROWTH_SECONDS) || (state.target !== Terrain.Sand && state.target !== Terrain.Grass)
      || (state.age === ROAD_OVERGROWTH_SECONDS ? tiles[state.index] !== state.target : tiles[state.index] !== Terrain.Road)) return fail();
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
      || !number(village.food, 0, 2000) || !integer(village.harvested) || !integer(village.founded, 0, Number(save.tick)) || !integer(village.migrationAfter)) return fail();
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
    if (!record(road) || !pairs.has(`${road.a}:${road.b}`) || roads.has(`${road.a}:${road.b}`) || !Array.isArray(road.tiles)
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
    roads.add(`${road.a}:${road.b}`);
  }
  if (!Array.isArray(society.history) || society.history.length > 40 || !society.history.every(e => record(e) && integer(e.tick, 0, Number(save.tick)) && typeof e.text === 'string' && e.text.length <= 300)) fail();
  const ids = new Set<number>();
  const homes = new Map<number, number>();
  const inhabitants = new Map<number, number>();
  let population = 0;
  const requiredByType = new Map<string, readonly string[]>();
  for (const entity of save.entities) {
    if (!record(entity) || !integer(entity.id, 1) || ids.has(entity.id) || entity.id >= Number(save.nextEntityId) || !record(entity.components) || typeof entity.typeId !== 'string') return fail();
    const definition = registry.entities.get(entity.typeId);
    if (!definition) throw new Error(`В сохранении есть неизвестный тип: ${entity.typeId}`);
    let required = requiredByType.get(definition.id);
    if (!required) {
      required = definition.required ?? Object.keys(definition.create({ x: 0, y: 0 }, new Random(1)));
      requiredByType.set(definition.id, required);
    }
    const components = entity.components;
    if (required.some(key => !(key in components))) fail();
    const nativeRace = RACE_IDS.find(race => RACES[race].entityId === entity.typeId);
    if (nativeRace && (!record(components.person) || (components.person.race ?? 'human') !== nativeRace)) fail();
    for (const [key, component] of Object.entries(entity.components)) {
      const validate = registry.components.get(key as ComponentKey);
      if (!validate || !record(component) || !validate(component)) fail();
    }
    const p = entity.components.position;
    if (record(p) && (Number(p.x) >= width || Number(p.y) >= height)) fail();
    if (record(entity.components.dwelling)) homes.set(entity.id, Number(entity.components.dwelling.capacity));
    if (record(entity.components.person)) {
      population++;
      const homeId = entity.components.person.homeId;
      if (homeId !== null) inhabitants.set(Number(homeId), (inhabitants.get(Number(homeId)) ?? 0) + 1);
    }
    for (const key of ['citizen', 'dwelling', 'farm']) {
      const component = components[key];
      if (record(component) && component.villageId !== null && !villages.has(Number(component.villageId))) fail();
      if (record(component) && component.villageId !== null && key !== 'farm') {
        const race = key === 'dwelling' ? component.race : record(components.person) ? components.person.race : undefined;
        const village = typedSociety.villages.find(v => v.id === component.villageId);
        if ((race ?? 'human') !== (village?.race ?? 'human')) fail();
      }
    }
    const citizen = components.citizen;
    if (record(citizen)) {
      if ((citizen.parents as number[]).includes(entity.id) || (citizen.path as { x: number; y: number }[]).some(p => p.x >= width || p.y >= height)) fail();
      if (record(citizen.repair) && Number(citizen.repair.tile) >= width * height) fail();
    }
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
  if (!integer(society.nextMigrationId, 1) || !Array.isArray(society.migrations) || society.migrations.length > 16) return fail();
  const migrationIds = new Set<number>(), travelers = new Set<number>(), reserved = new Map<number, number>();
  for (const group of society.migrations) {
    if (!record(group) || !integer(group.id, 1) || group.id >= Number(society.nextMigrationId) || migrationIds.has(group.id)
      || !integer(group.fromId, 1) || !villages.has(group.fromId)
      || group.toId !== null && (!integer(group.toId, 1) || !villages.has(group.toId) || group.toId === group.fromId)
      || !record(group.destination) || !number(group.destination.x, 0, width - 0.001) || !number(group.destination.y, 0, height - 0.001)
      || !Array.isArray(group.members) || group.members.length < 1 || group.members.length > 10
      || !Array.isArray(group.homeIds) || group.homeIds.length > 1 || group.toId === null && group.homeIds.length !== 0
      || !number(group.food, 0, 30) || !integer(group.started, 0, Number(save.tick))) return fail();
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
    if (c.targetId !== null && !ids.has(Number(c.targetId))) fail();
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
  return save as unknown as WorldSnapshot;
}
