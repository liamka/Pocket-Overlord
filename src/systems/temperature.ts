import type { World } from '../core/world';
import { isBridge, Terrain, type Entity, type GameEvent, type Vec2 } from '../core/types';
import { NaturalBiome } from '../core/natural-biomes';
import { damageContext, type DamageContext } from '../core/death';
import { approachZero, cellHeatBand, lavaStageAt, TEMPERATURE, type ThermalReason } from '../core/temperature';
import { applyStatus, hasStatus, removeStatus } from '../core/status-effects';
import { architectureResists } from '../core/buildings';
import { touchesGround } from '../core/capabilities';
import { liftedIds } from '../core/cataclysms';
import { aboardFerry } from '../core/ferries';
import { lawEnabled, terrainChangeAllowed } from '../core/world-rules';
import { statusImmune } from './equipment';
import { applyEvent } from './effects';

function bodyReason(world: World, entity: Entity, reason: ThermalReason, source?: DamageContext): void {
  if (entity.components.thermal) entity.components.thermal.lastChange = { reason, tick: world.tick, ...(source ? { source } : {}) };
}

/** Ignition and direct heat shock have deliberately different immunity rules. */
export function igniteBody(world: World, entity: Entity, source: DamageContext): boolean {
  const { thermal, combustible } = entity.components;
  if (!thermal) return false;
  if (statusImmune(entity, 'fire') || entity.components.stockpile?.resistance === 'fireproof' || architectureResists(entity, 'fire')) {
    removeStatus(world, entity, 'burning', 'cured'); thermal.burning = false;
    bodyReason(world, entity, 'fireproof', source); return false;
  }
  if (thermal.wetness >= 0.25) { bodyReason(world, entity, 'wet', source); return false; }
  if (!combustible?.fuel) { bodyReason(world, entity, 'no-fuel', source); return false; }
  if (thermal.burning) return true; // Do not refresh a status, attribution or damage pulse.
  const applied = entity.components.statuses
    ? applyStatus(world, entity, 'burning', { source: world.entities.get(source.sourceId ?? -1) }) : true;
  thermal.burning = applied;
  if (applied) thermal.ignition = { ...source, cause: 'fire' };
  bodyReason(world, entity, applied ? 'ignited' : 'status-blocked', source);
  return applied;
}

export function changeBodyTemperature(world: World, event: GameEvent<'heat'>): void {
  if (world.paused || !Number.isFinite(event.amount)) return;
  const entity = world.entities.get(event.target), thermal = entity?.components.thermal;
  if (!entity || !thermal || !event.amount) return;
  const source = damageContext(world, { ...event, cause: event.cause ?? 'fire' });
  const p = entity.components.position;
  if (event.amount > 0 && p && !entity.components.ship && touchesGround(world.registry, entity)
    && !liftedIds(world).has(entity.id) && !aboardFerry(world, entity.id) && world.terrain.isOpenWater(p.x, p.y)) {
    applyEvent(world, { kind: 'wet', target: entity.id, amount: 1 });
    bodyReason(world, entity, 'wet', source); return;
  }
  const amount = event.amount > 0 ? event.amount * (1 - thermal.wetness * 0.85) : event.amount;
  thermal.temperature = Math.max(TEMPERATURE.bodyCold, Math.min(entity.components.unit ? TEMPERATURE.bodyHot : TEMPERATURE.cellMax, thermal.temperature + amount));
  bodyReason(world, entity, amount > 0 ? 'heated' : 'cooled', source);
  const hot = entity.components.unit ? TEMPERATURE.bodyHot : entity.components.combustible?.ignition ?? TEMPERATURE.cellMax;
  if (thermal.temperature >= hot) {
    thermal.temperature = 0; igniteBody(world, entity, source);
  } else if (entity.components.unit && thermal.temperature <= TEMPERATURE.bodyCold) {
    thermal.temperature = 0;
    if (statusImmune(entity, 'ice')) bodyReason(world, entity, 'frostproof', source);
    else if (!hasStatus(entity, 'frozen')) {
      const applied = applyStatus(world, entity, 'frozen', { source: world.entities.get(event.sourceId ?? -1) });
      bodyReason(world, entity, applied ? 'frozen' : 'status-blocked', source);
    }
  }
}

export function heatCell(world: World, point: Vec2, amount: number, context: DamageContext = { cause: 'fire' }): void {
  const map = world.terrain;
  if (world.paused || !map.inside(point.x, point.y) || !Number.isFinite(amount) || !amount) return;
  const i = map.index(point.x, point.y), source = damageContext(world, context);
  map.setTemperature(i, (map.layers.get(i)?.temperature ?? 0) + amount, world.tick, source);
  const layer = map.layers.get(i)!;
  if (!layer.thermalChange) layer.thermalChange = { reason: amount > 0 ? 'heated' : 'cooled', tick: world.tick, source };
}

/** Rain runs first. It cannot create cold and never consumes a heating transition receipt. */
export function coolCellWithRain(world: World, index: number, dt: number): void {
  const map = world.terrain, layer = map.layers.get(index);
  if (!layer || (layer.temperature ?? 0) <= 0) return;
  map.setTemperature(index, Math.max(0, layer.temperature! - dt * TEMPERATURE.rainCooling), world.tick);
  layer.thermalBand = Math.min(layer.thermalBand ?? 0, cellHeatBand(layer.temperature!));
  layer.thermalChange = { reason: 'wet', tick: world.tick };
}

/** Small local effects update immediately; a full map visits at most 768 cells per tick. */
export function temperatures(world: World): void {
  if (world.paused) return;
  const map = world.terrain, bucket = map.thermalActive.size <= TEMPERATURE.immediateCells ? map.thermalActive : map.thermalBuckets[world.tick % TEMPERATURE.buckets];
  if (!bucket.size) return;
  const shocks = new Map<number, DamageContext>();
  map.edit(() => {
    for (const i of [...bucket].sort((a, b) => a - b)) {
      let layer = map.layers.get(i)!;
      const x = i % map.width, y = Math.floor(i / map.width), before = map.cell(x, y);
      const value = layer.temperature ?? 0, band = cellHeatBand(value), oldBand = layer.thermalBand ?? 0;
      const source = layer.heatSource ?? { cause: 'fire' as const };
      const reason = (reason: ThermalReason): void => { map.layers.get(i)!.thermalChange = { reason, tick: world.tick, source: { ...source } }; };
      const canChange = terrainChangeAllowed(world, 'fire');
      if (band >= 2 && oldBand < 2) shocks.set(i, source);
      if (value <= TEMPERATURE.freezeCell && !before.frost && !layer.lavaStage && (before.land || before.water) && canChange) {
        if (map.setLayers(x, y, { frost: before.water ? 'ice' : 'snow', thermalFrost: true, burning: undefined })) reason('frozen');
      }
      // Crossing several boundaries is one ordered transaction, with only one shock/detonation.
      if (band > oldBand && canChange) {
        if (band >= 1 && oldBand < 1) {
          if (before.frost) { map.thaw(x, y); reason('thawed'); }
          else if (before.ice) { map.clearCover(x, y); map.set(x, y, Terrain.Water); reason('thawed'); }
          else if (before.water) {
            if (before.waterDepth > 1) map.setLayers(x, y, { waterDepth: (before.waterDepth - 1) as 1 | 2 });
            else { map.clearCover(x, y); map.set(x, y, Terrain.Sand); }
            reason('evaporated');
          }
          if (before.top === 'grey-goo') map.setLayers(x, y, { burning: 30 });
        }
        if (band >= 2 && oldBand < 2) {
          const cell = map.cell(x, y);
          if (cell.burn.rate) map.setLayers(x, y, { burning: 30 });
          if (cell.tile === Terrain.Grass && cell.burn.rate > 0) {
            map.clearCover(x, y); map.set(x, y, Terrain.Scorched); reason('scorched');
          }
        }
        const top = map.cell(x, y).top;
        if (top && ((top === 'tnt' || top === 'timed-tnt') && band >= 2 || band >= 3 && (top === 'landmine' || top === 'water-bomb' || top === 'fuse' || top.startsWith('firework-')))) {
          map.setLayers(x, y, { top: undefined, burning: undefined }); reason('detonated');
          // Only the thermal trigger lives here; timers, placement and propagation belong to plan 199.
          world.events.push({ kind: 'blast', x: x + 0.5, y: y + 0.5, radius: 2, power: 80, heat: 40, ...source, cause: 'explosion' });
        }
        if (band >= 3 && oldBand < 3 && map.at(x, y) === Terrain.Grass) {
          // Removing a biome does not turn its rocky substrate into ordinary soil.
          if (map.cell(x, y).surface?.kind === 'stone') map.setBiome(x, y, NaturalBiome.Grassland);
          else map.clearCover(x, y);
          map.set(x, y, Terrain.Scorched); reason('scorched');
        }
        let cell = map.cell(x, y);
        if (band >= 4 && cell.elevation < 2 && [Terrain.Grass, Terrain.Scorched, Terrain.Crater, Terrain.Road].includes(cell.tile) && cell.surface?.kind !== 'stone') {
          map.clearCover(x, y); map.set(x, y, Terrain.Sand); reason('sand'); cell = map.cell(x, y);
        }
        if (band >= 5 && cell.tile === Terrain.Sand && cell.elevation < 2 && cell.surface?.kind !== 'stone'
          || band >= 6 && cell.land && !cell.water && !isBridge(cell.tile)) {
          map.clearCover(x, y); map.set(x, y, Terrain.Sand);
          map.setLayers(x, y, { elevation: undefined, frost: undefined, burning: undefined, lavaStage: 4 });
          // Molten ground must not regrow while it is cooling.
          reason('lava');
        }
      }
      layer = map.layers.get(i)!;
      const elapsed = Math.max(0, world.tick - (layer.thermalAt ?? world.tick));
      const cooled = layer.lavaStage && lawEnabled(world, 'eternal-lava') && value > 0 ? value : approachZero(value, elapsed / TEMPERATURE.cellRecoveryTicks);
      map.setTemperature(i, cooled, world.tick);
      layer.thermalBand = cellHeatBand(cooled);
      if (layer.lavaStage) {
        if (cooled <= 0) {
          map.setLayers(x, y, { lavaStage: undefined }); map.set(x, y, before.tile === Terrain.Mountain ? Terrain.Mountain : Terrain.Scorched); reason('solidified');
        } else if (layer.lavaStage !== lavaStageAt(cooled)) map.setLayers(x, y, { lavaStage: lavaStageAt(cooled) });
      }
      if (!cooled && layer.thermalFrost) { map.thaw(x, y); reason('thawed'); }
      if (!cooled) { delete map.layers.get(i)!.heatSource; map.trackTemperature(i); }
    }
  });
  if (!shocks.size) return;
  const lifted = liftedIds(world);
  for (const entity of [...world.query('position')]) {
    const p = entity.components.position!, source = shocks.get(map.index(p.x, p.y));
    if (!source || !touchesGround(world.registry, entity) || lifted.has(entity.id) || aboardFerry(world, entity.id)) continue;
    igniteBody(world, entity, source);
    if (entity.components.explosive) entity.components.explosive.fuse = 0;
    if (entity.components.unit) applyEvent(world, { kind: 'damage', target: entity.id, amount: TEMPERATURE.surfaceShock, ...source, cause: 'fire', thermalShock: true });
  }
}
