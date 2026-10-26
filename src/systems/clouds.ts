import type { World } from '../core/world';
import { Terrain, type Entity, type Vec2 } from '../core/types';
import { Random } from '../core/random';
import { CLOUDS, cloudDefinitions, cloudRadius, type CloudDrop, type CloudState } from '../core/clouds';
import { applyEvent } from './effects';
import { applyStatus } from '../core/status-effects';
import { unitStats } from '../core/unit-stats';
import { plantProblem } from '../core/biome-ecology';
import { lawEnabled, terrainChangeAllowed } from '../core/world-rules';
import { applyBiomeChange, BIOME_CHANGE_BASE, biomeGrowthBlocked, winsBiomeSpread } from '../core/biome-spread';
import { NATURAL_BIOMES } from '../core/natural-biomes';
import { coolCellWithRain, heatCell, igniteBody } from './temperature';
import { geohazards, markHazardsChanged, poolRadius } from '../core/geohazards';
import { isAdult } from '../core/unit-stats';

/** One neighbour, using the same competition and law gates as natural spreading. */
function rainBiome(world: World, p: Vec2, random: Random): void {
  const climate = world.registry.biomeClimate(world), map = world.terrain, c = map.cell(p.x, p.y);
  if (!lawEnabled(world, 'biomes-overgrowth') || biomeGrowthBlocked(climate) || !c.plantable) return;
  const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][Math.floor(random.next() * 4)];
  const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
  if (!map.inside(x, y) || !map.cell(x, y).plantable) return;
  const before = map.biomeAt(x, y), after = c.biome;
  if (before.id !== after.id && winsBiomeSpread(after.ecology.strength, before.ecology.strength, random))
    applyBiomeChange(world, map.index(x, y) * BIOME_CHANGE_BASE ** 2 + before.id * BIOME_CHANGE_BASE + after.id);
}

/** Shared by cloud drops and the existing area-rain owner. No village stock is credited. */
export function rainCell(world: World, p: Vec2, random: Random): void {
  const map = world.terrain;
  if (world.paused || !map.inside(p.x, p.y)) return;
  const i = map.index(p.x, p.y), c = map.cell(p.x, p.y);
  map.edit(() => {
    if (c.top === 'water-bomb') {
      // Remove before dispatch: overlapping drops and loading cannot repeat the blast.
      map.setLayers(p.x, p.y, { top: undefined, burning: undefined });
      applyEvent(world, { kind: 'blast', ...p, radius: 2, power: 80, heat: 0, cause: 'explosion' });
    }
    map.setLayers(p.x, p.y, { burning: undefined });
    coolCellWithRain(world, i, 1);
    const pools = geohazards(world)?.lava;
    const lava = c.lavaStage || pools?.some(pool => Math.hypot(pool.x - p.x, pool.y - p.y) <= poolRadius(pool));
    if (pools) for (let n = pools.length - 1; n >= 0; n--) if (Math.hypot(pools[n].x - p.x, pools[n].y - p.y) <= poolRadius(pools[n])) {
      pools.splice(n, 1); markHazardsChanged(world);
    }
    if (lava && c.land && !c.water) {
      map.clearCover(p.x, p.y); map.set(p.x, p.y, Terrain.Hill);
      map.setLayers(p.x, p.y, { lavaStage: undefined, temperature: 0, thermalBand: 0, thermalAt: world.tick,
        heatSource: undefined, elevation: undefined, thermalChange: { reason: 'wet', tick: world.tick } });
    } else if (c.tile >= Terrain.PitShallow && c.tile <= Terrain.PitDeep) {
      const depth = (c.tile - Terrain.PitShallow + 1) as 1 | 2 | 3;
      map.set(p.x, p.y, depth === 3 ? Terrain.DeepWater : Terrain.Water); map.setLayers(p.x, p.y, { waterDepth: depth });
    } else if (map.at(p.x, p.y) === Terrain.Scorched && lawEnabled(world, 'grow-grass')) {
      map.set(p.x, p.y, map.recovery.get(i)?.target ?? Terrain.Grass);
    }
    rainBiome(world, p, random);
  });
}

function lifeDrop(world: World, p: Vec2, random: Random): string {
  const crowd = () => world.nearby(p, CLOUDS.densityRadius).filter(e => !e.components.projectile).length;
  if (crowd() >= CLOUDS.densityLimit) return 'Too much life nearby';
  const ecology = world.terrain.biomeAt(p.x, p.y).ecology;
  let result = 'No compatible life can grow here';
  if (lawEnabled(world, 'animal-spawn')) {
    const sapients = lawEnabled(world, 'drop-of-thoughts') ? ecology.sapients.filter(id => world.registry.cloudSapientUnlocked(world, id)) : [];
    const species = [...ecology.creatures, ...sapients].filter(id => {
      const profile = world.registry.species.get(id)?.runtime;
      const cell = world.terrain.cell(p.x, p.y);
      return profile && !cell.top && !cell.lavaStage && cell.damagePerSecond === 0
        && (cell.land ? profile.movement.includes('walk') || profile.movement.includes('fly') : cell.water && profile.movement.includes('swim'));
    });
    const types = [...world.registry.entities.values()].filter(e => e.speciesId && species.includes(e.speciesId)).sort((a, b) => a.id.localeCompare(b.id));
    if (types.length && !world.nearby(p, 1).length) {
      const type = types[Math.floor(random.next() * types.length)];
      if (world.spawn(type.id, p, undefined, 'natural', [], undefined, random)) result = 'Life appeared';
    }
  } else result = 'Animal spawning is disabled';
  // A second, nearby seed still obeys the same density and occupancy gate.
  const plant = { x: p.x + random.range(-1.5, 1.5), y: p.y + random.range(-1.5, 1.5) };
  if (lawEnabled(world, 'random-seeds') && crowd() < CLOUDS.densityLimit && world.terrain.inside(plant.x, plant.y)
    && world.nearby(plant, CLOUDS.densityRadius).length < CLOUDS.densityLimit && !plantProblem(world, plant) && !world.nearby(plant, 1).length) {
    if (world.spawn('core:tree', plant, 'natural', 'natural', [], undefined, random)) result = 'Life appeared';
  }
  return result;
}

export function rainTarget(world: World, e: Entity, random: Random, player = false): void {
  if (world.paused || !world.entities.has(e.id)) return;
  applyEvent(world, { kind: 'wet', target: e.id, amount: 1 });
  const age = world.registry.biomeClimate(world).age;
  if (e.components.farm) e.components.farm.growth = ['dark', 'ice', 'despair'].includes(age) && random.next() < 0.5
    ? 0 : Math.min(1, (Math.floor(e.components.farm.growth * 4 + 1e-8) + 1) / 4);
  if (e.components.creature?.speciesId === 'cybercore' || e.typeId === 'core:cybercore')
    applyEvent(world, { kind: 'damage', target: e.id, amount: 20, cause: 'water', player });
}

export function applyPrecipitation(world: World, drop: CloudDrop): string {
  if (world.paused || !world.terrain.inside(drop.x, drop.y)) return 'Outside the world';
  const random = new Random(drop.seed), map = world.terrain, p = { x: Math.floor(drop.x) + 0.5, y: Math.floor(drop.y) + 0.5 };
  const entities = world.nearby(p, 1).sort((a, b) => a.id - b.id).filter(e => !e.components.projectile);
  const source = { cause: 'fire' as const, player: drop.player };
  const age = world.registry.biomeClimate(world).age;
  if (drop.type === 'life') return lifeDrop(world, p, random);
  if (drop.type === 'rain') {
    rainCell(world, p, random);
    for (const e of entities) rainTarget(world, e, random, drop.player);
    return 'Rain watered the ground';
  }
  if (drop.type === 'snow') {
    heatCell(world, p, -6, source);
    let missing = false;
    for (const e of entities) {
      if (random.next() < 0.2) applyStatus(world, e, 'frozen', { sourceName: cloudDefinitions.snow.label });
      if (age === 'despair' && e.components.unit && !isAdult(e)) {
        if (world.registry.transformations.has('core:despair-cold')) applyEvent(world, { kind: 'transform', target: e.id,
          context: { trigger: 'snow', age: 'despair', cloudId: drop.cloudId, disasters: lawEnabled(world, 'natural-disasters') } });
        else missing = true;
      }
    }
    return missing ? 'Cold Ones are not available' : 'Snow cooled the ground';
  }
  if (drop.type === 'ash' || drop.type === 'magic' || drop.type === 'rage') {
    const statuses = drop.type === 'ash' ? [['coughing', 0.3], ['ash-fever', 0.1]] as const
      : drop.type === 'magic' ? [['shield', 0.2], ['powerup', 0.2], ['spell-boost', 0.2], ['caffeinated', 0.2]] as const : [['rage', 0.2]] as const;
    let affected = false;
    for (const e of entities) {
      for (const [status, chance] of statuses) if (random.next() < chance)
        affected = applyStatus(world, e, status, { sourceName: cloudDefinitions[drop.type].label }) || affected;
      if (drop.type === 'magic' && e.components.stats) {
        const stats = unitStats(world, e), before = e.components.stats.mana;
        e.components.stats.mana = Math.min(stats.values.mana, before + stats.values.mana * 0.1);
        affected ||= e.components.stats.mana > before;
      }
    }
    return affected ? 'Precipitation changed a creature' : 'No creature was affected';
  }
  if (drop.type === 'lightning') {
    const radius = random.next() < 0.5 ? 0.75 : 1.25;
    applyEvent(world, { kind: 'tile-heat', ...p, radius, amount: 9, ...source });
    for (const e of world.nearby(p, radius).sort((a, b) => a.id - b.id)) {
      if (e.components.thermal && e.components.combustible && map.isLand(e.components.position!.x, e.components.position!.y)) {
        e.components.thermal.wetness = 0; igniteBody(world, e, source);
      }
      applyEvent(world, { kind: 'damage', target: e.id, amount: radius < 1 ? 14 : 28, cause: 'divine', player: drop.player });
    }
    return 'Lightning struck';
  }
  if (drop.type === 'hell' || drop.type === 'lava') {
    for (const e of entities) igniteBody(world, e, source);
    if (!terrainChangeAllowed(world, 'fire')) return 'The ground is protected';
    if (drop.type === 'hell') heatCell(world, p, 12, source);
    else {
      const cell = map.cell(p.x, p.y);
      if (!cell.land || cell.water || cell.top?.startsWith('wall-')) return 'This ground cannot hold lava';
      map.edit(() => {
        // Mountains are the deposit left by this source. The temperature owner
        // controls its one cooling cycle; rain can replace it with a hill.
        map.clearCover(p.x, p.y); map.set(p.x, p.y, Terrain.Mountain);
        map.setLayers(p.x, p.y, { elevation: undefined, frost: undefined, burning: undefined, lavaStage: 4,
          temperature: 35, thermalAt: world.tick, thermalBand: 0, heatSource: source, thermalChange: { reason: 'lava', tick: world.tick, source } });
      });
    }
    return 'Fire reached the ground';
  }
  for (const e of entities) applyEvent(world, { kind: 'damage', target: e.id, amount: 8, cause: 'acid', player: drop.player });
  const cell = map.cell(p.x, p.y);
  const wasteland = NATURAL_BIOMES.find(b => String(b.key) === 'wasteland');
  if (terrainChangeAllowed(world, 'acid') && cell.land && !cell.water && !cell.top && cell.elevation < 2) map.edit(() => {
    map.clearCover(p.x, p.y); map.set(p.x, p.y, wasteland ? Terrain.Grass : Terrain.Scorched);
    if (wasteland) map.setBiome(p.x, p.y, wasteland.id);
  });
  return !wasteland && cell.land && cell.elevation < 2 && !cell.top ? 'Acid scorched the ground; wasteland is not available' : 'Acid fell';
}

export function updateClouds(world: World, state: CloudState, dt: number): 'complete' | void {
  if (world.paused) return;
  for (const cloud of state.clouds) {
    cloud.remaining = Math.max(0, cloud.remaining - dt); cloud.x += cloud.speed * dt;
    cloud.dropIn = Math.max(0, cloud.dropIn - dt);
    if (cloud.bolt) { cloud.bolt.remaining -= dt; if (cloud.bolt.remaining <= 1e-9) cloud.bolt = null; }
    if (cloud.lastDrop) { cloud.lastDrop.remaining -= dt; if (cloud.lastDrop.remaining <= 1e-9) cloud.lastDrop = null; }
  }
  state.clouds = state.clouds.filter(c => c.remaining > 1e-9);
  if (!state.clouds.length) return 'complete';
  // Fair, bounded scheduling; overdue sources wait without a catch-up burst.
  const ordered = [...state.clouds].sort((a, b) => Number(a.id <= state.cursor) - Number(b.id <= state.cursor) || a.id - b.id);
  let budget = CLOUDS.dropsPerTick;
  for (const cloud of ordered) {
    if (cloud.dropIn > 1e-9 || !budget) continue;
    budget--; state.cursor = cloud.id; cloud.dropIn = CLOUDS.interval;
    const random = new Random(cloud.seed), radius = cloudRadius(cloud.size);
    const point = { x: cloud.x + random.range(-radius, radius), y: cloud.y + random.range(-radius / 2, radius / 2) };
    const seed = Math.floor(random.next() * 0x100000000), strike = cloud.type !== 'lightning' || random.next() < 0.25;
    cloud.seed = random.state;
    if (!world.terrain.inside(point.x, point.y) || !strike) continue;
    cloud.lastDrop = { ...point, remaining: CLOUDS.interval };
    if (cloud.type === 'lightning') cloud.bolt = { ...point, remaining: CLOUDS.boltLife, seed };
    world.registry.applyEvent(world, { kind: 'precipitation', ...point, type: cloud.type, seed, player: cloud.origin === 'manual', cloudId: cloud.id });
  }
}
