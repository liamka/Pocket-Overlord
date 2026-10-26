import { nimbleHit } from '../core/physiology-events';
import { physiologyHit } from './physiology';
import { rainCell, rainTarget } from './clouds';
import { hasPhysiology, needsFood } from '../core/physiology';
import { lawEnabled, terrainChangeAllowed, PROTECTED_TERRAIN_ACTIONS } from '../core/world-rules';
import { igniteTile } from './tiles';
import { changeBodyTemperature, coolCellWithRain, heatCell } from './temperature';
import { approachZero, TEMPERATURE } from '../core/temperature';
import { traitBlocks, acquireTraits, hasTrait } from '../core/traits';
import { unitStats } from '../core/unit-stats';
import { hasStatus, removeStatus, wetStatuses, interruptStatuses } from '../core/status-effects';
import { statusImmune } from './equipment';
import { damageContext, validDamageContext } from '../core/death';
import { touchesGround } from '../core/capabilities';
import { architectureResists, destroyBuilding } from '../core/buildings';
import { aboardFerry } from '../core/ferries';
import { liftedIds } from '../core/cataclysms';
import type { Registry } from '../content/registry';
import { integer, number, record } from '../core/validation';
import type { World } from '../core/world';
import { destroyHome } from './recovery';
import { LANDSCAPE_RECOVERY_RATE } from '../core/terrain';
import { ENTITY_LIMIT, EVENT_BUDGET, isBridge, Terrain, WORLD_HEIGHT, WORLD_WIDTH, type Entity, type GameEvent, type Vec2 } from '../core/types';

export const SEA_WAVES = { id: 'core:sea-waves', rays: 192, limit: 16, crests: 3 } as const;
export type SeaWave = { x: number; y: number; blastRadius: number; elapsed: number; shore: number[]; reach: number[]; hit: string[] };
type SeaWaveState = { waves: SeaWave[] };

export function seaWaveShape(blastRadius: number) {
  const tsunami = blastRadius >= 12;
  return { tsunami, range: tsunami ? Math.min(160, Math.max(64, blastRadius * 3.2)) : Math.min(24, Math.max(8, blastRadius * 3.2)),
    speed: tsunami ? 14 : 6, interval: tsunami ? 1.1 : 0.55, width: tsunami ? 4 : 0.7, runup: tsunami ? 8 : 0.75 };
}

export function seaWaves(world: World): readonly SeaWave[] {
  return (world.scenarios.find(scenario => scenario.id === SEA_WAVES.id)?.state as SeaWaveState | undefined)?.waves ?? [];
}

export function seaWaveCoast(wave: SeaWave, angle: number): { shore: number; reach: number } {
  const index = (angle / (Math.PI * 2) + 1) % 1 * SEA_WAVES.rays;
  const a = Math.floor(index), b = (a + 1) % SEA_WAVES.rays;
  return { shore: Math.min(wave.shore[a], wave.shore[b]), reach: Math.min(wave.reach[a], wave.reach[b]) };
}

function validSeaWaves(value: unknown): value is SeaWaveState {
  return record(value) && Array.isArray(value.waves) && value.waves.length <= SEA_WAVES.limit && value.waves.every(wave => {
    if (!record(wave) || !number(wave.x, 0, WORLD_WIDTH) || !number(wave.y, 0, WORLD_HEIGHT) || !number(wave.blastRadius, 0.1, 64)) return false;
    const shape = seaWaveShape(wave.blastRadius);
    if (!number(wave.elapsed, 0, shape.range / shape.speed + shape.interval * 2 + 1)
      || !Array.isArray(wave.shore) || wave.shore.length !== SEA_WAVES.rays || !wave.shore.every(d => number(d, 0, shape.range + 1))
      || !Array.isArray(wave.reach) || wave.reach.length !== SEA_WAVES.rays || !wave.reach.every((d, i) => number(d, 0, Math.min(shape.range, Number((wave.shore as number[])[i]) + shape.runup)))
      || !Array.isArray(wave.hit) || wave.hit.length !== SEA_WAVES.crests) return false;
    return wave.hit.every(hits => {
      // Delimited IDs keep this bounded scenario within the generic JSON node budget.
      if (typeof hits !== 'string' || hits.length > ENTITY_LIMIT * 18 || !/^(?:,[1-9]\d*,)*$/.test(hits)) return false;
      const ids = hits.split(',').filter(Boolean).map(Number);
      return ids.length <= ENTITY_LIMIT && ids.every(id => integer(id, 1)) && new Set(ids).size === ids.length;
    });
  });
}

/** Each ray stops at the first coast; only a tsunami can run a short way inland. */
export function launchSeaWave(world: World, point: Vec2, blastRadius: number): void {
  if (!world.terrain.inside(point.x, point.y) || world.terrain.isLand(point.x, point.y)) return;
  let scenario = world.scenarios.find(active => active.id === SEA_WAVES.id);
  if (!scenario) {
    if (!world.startScenario(SEA_WAVES.id)) return;
    scenario = world.scenarios.find(active => active.id === SEA_WAVES.id)!;
  }
  const state = scenario.state as SeaWaveState, shape = seaWaveShape(blastRadius);
  if (state.waves.length >= SEA_WAVES.limit) {
    const smaller = state.waves.findIndex(wave => wave.blastRadius < blastRadius);
    if (smaller < 0) return;
    state.waves.splice(smaller, 1);
  }
  const wave: SeaWave = { ...point, blastRadius, elapsed: 0, shore: [], reach: [], hit: ['', '', ''] };
  for (let ray = 0; ray < SEA_WAVES.rays; ray++) {
    const angle = ray * Math.PI * 2 / SEA_WAVES.rays, dx = Math.cos(angle), dy = Math.sin(angle);
    let shore = shape.range + 1, reach = shape.range;
    for (let d = 0.25; d <= shape.range; d += 0.5) {
      const x = point.x + dx * d, y = point.y + dy * d, land = world.terrain.isLand(x, y);
      if (!world.terrain.inside(x, y) || world.terrain.at(x, y) === Terrain.Mountain) { reach = Math.max(0, d - 0.5); break; }
      if (land) shore = Math.min(shore, d);
      if (d >= shore + shape.runup || d > shore && !land) { reach = Math.max(0, d - 0.5); break; }
    }
    wave.shore.push(shore); wave.reach.push(reach);
  }
  state.waves.push(wave);
}

function advanceSeaWaves(world: World, state: SeaWaveState, dt: number): 'complete' | void {
  for (let i = state.waves.length - 1; i >= 0; i--) {
    const wave = state.waves[i], shape = seaWaveShape(wave.blastRadius);
    wave.elapsed += dt;
    for (let crest = 0; crest < SEA_WAVES.crests; crest++) {
      const radius = (wave.elapsed - 0.15 - crest * shape.interval) * shape.speed;
      if (radius < 0 || radius > shape.range + shape.width) continue;
      for (const entity of world.nearby(wave, Math.min(shape.range, radius)).sort((a, b) => a.id - b.id)) {
        const { position, projectile, thermal, health, motion } = entity.components;
        if (!position || projectile || wave.hit[crest].includes(`,${entity.id},`)) continue;
        const dx = position.x - wave.x, dy = position.y - wave.y, distance = Math.hypot(dx, dy);
        if (distance < radius - shape.width || distance > radius) continue;
        const coast = seaWaveCoast(wave, Math.atan2(dy, dx));
        if (distance > coast.reach || world.terrain.at(position.x, position.y) === Terrain.Mountain) continue;
        wave.hit[crest] += `,${entity.id},`;
        const inland = Math.max(0, distance - coast.shore);
        const force = (1 - crest * 0.22) * (1 - distance / shape.range * 0.45) * Math.max(0.2, 1 - inland / shape.runup * 0.8);
        if (thermal) world.events.push({ kind: 'wet', target: entity.id, amount: 1 });
        if (motion) {
          const push = (shape.tsunami ? 24 : 3) * force / (distance || 1);
          world.events.push({ kind: 'impulse', target: entity.id, x: dx * push, y: dy * push });
        }
        if (shape.tsunami && health) world.events.push({ kind: 'damage', target: entity.id, amount: 220 * force, cause: 'water' });
      }
    }
    if (wave.elapsed >= shape.range / shape.speed + shape.interval * 2 + 1) state.waves.splice(i, 1);
  }
  if (!state.waves.length) return 'complete';
}

export function detonate(world: World, entity: Entity): void {
  const { position, explosive } = entity.components;
  if (!position || !explosive) return;
  const style = entity.typeId === 'core:rocket' ? 'rocket' : entity.typeId === 'core:dynamite' ? 'dynamite' : undefined;
  world.events.push({ kind: 'blast', ...position, radius: explosive.radius, power: explosive.power, heat: explosive.heat,
    ...damageContext(world, { ...entity.components.thermal?.ignition, cause: 'explosion' }), ...(style ? { style } : {}) });
  world.remove(entity.id);
}

export function applyEvent(world: World, event: GameEvent): void {
  world.registry.applyEvent(world, event);
}

/** Each effect owns its simulation handler and save validator. */
export function registerEffects(registry: Registry): void {
  registry.registerScenario<SeaWaveState>({ id: SEA_WAVES.id, create: () => ({ waves: [] }), validate: validSeaWaves, update: advanceSeaWaves });
  registry.registerEvent({ kind: 'blast',
    validate: (v, c) => number(v.x, 0, c.width) && number(v.y, 0, c.height) && number(v.radius, 0.1, 64) && number(v.power, 0, 1e6) && number(v.heat, 0, 1e6)
      && validDamageContext(v) && (v.style === undefined || v.style === 'napalm' || v.style === 'rocket' || v.style === 'dynamite'),
    apply: (world, event) => {
      if (event.heat > 0 && terrainChangeAllowed(world, 'blast'))
        world.terrain.circle(event.x, event.y, event.radius, (x, y) => heatCell(world, { x, y }, event.heat / 10, damageContext(world, { ...event, cause: 'fire' })));
      launchSeaWave(world, event, event.radius);
      world.visual({ kind: 'blast', x: event.x, y: event.y, radius: event.radius, ...(event.style ? { style: event.style } : {}) });
      world.events.push({ kind: 'surface', x: event.x, y: event.y, radius: event.radius, terrain: Terrain.Scorched });
      world.events.push({ kind: 'surface', x: event.x, y: event.y, radius: event.radius * 0.42, terrain: Terrain.Crater });
      for (const entity of world.nearby(event, event.radius).sort((a, b) => a.id - b.id)) {
        const { position, health, thermal, motion, projectile } = entity.components;
        if (projectile) continue;
        const dx = position!.x - event.x, dy = position!.y - event.y;
        const distance = Math.hypot(dx, dy);
        const falloff = Math.max(0, 1 - distance / event.radius);
        if (thermal) world.events.push({ kind: 'heat', target: entity.id, amount: event.heat * falloff, ...damageContext(world, { ...event, cause: 'fire' }) });
        if (health) world.events.push({ kind: 'damage', target: entity.id, amount: event.power * falloff, ...damageContext(world, { ...event, cause: 'explosion' }) });
        if (motion) world.events.push({ kind: 'impulse', target: entity.id, x: dx / (distance || 1) * falloff * 16, y: dy / (distance || 1) * falloff * 16 });
      }
    },
  }).registerEvent({ kind: 'surface',
    validate: (v, c) => number(v.x, 0, c.width) && number(v.y, 0, c.height) && number(v.radius, 0.1, 64) && integer(v.terrain, 2, 5)
      && (v.origin === undefined || [...PROTECTED_TERRAIN_ACTIONS, 'acid', 'volcano', 'stomp', 'manual', 'evil-wall'].some(origin => origin === v.origin)),
    apply: (world, event) => {
      if (!terrainChangeAllowed(world, event.origin ?? 'blast')) return;
      world.terrain.circle(event.x, event.y, event.radius, (x, y, i) => {
        const current = world.terrain.tiles[i];
        if (event.terrain === Terrain.Scorched) {
          // A new blast delays recovery without flattening an existing crater instantly.
          if (current === Terrain.Crater) { world.terrain.set(x, y, Terrain.Crater); return; }
          if (current !== Terrain.Grass && current !== Terrain.Scorched && current !== Terrain.Road && !isBridge(current)) return;
        }
        if (current < Terrain.Sand) return;
        world.terrain.set(x, y, event.terrain);
        world.terrain.moisture[i] = 0;
      });
    },
  }).registerEvent({ kind: 'damage',
    validate: v => integer(v.target, 1) && number(v.amount, 0, 1e6) && validDamageContext(v)
      && (v.thermalShock === undefined || v.thermalShock === true && v.cause === 'fire'),
    apply: (world, event) => {
      if (event.cause === 'hunger' && !lawEnabled(world, 'hunger') || event.cause === 'age' && !lawEnabled(world, 'old-age')) return;
      const entity = world.entities.get(event.target), health = entity?.components.health;
      if (!entity || !health || event.amount <= 0 || !(event.thermalShock && event.cause === 'fire') && traitBlocks(entity,event.cause ?? 'other')) return;
      if (hasStatus(entity, 'invincible')) return;
      if (event.cause === 'fire' && !event.thermalShock && (statusImmune(entity, 'fire') || entity.components.stockpile?.resistance === 'fireproof' || architectureResists(entity, 'fire'))
        || event.cause === 'acid' && (entity.components.stockpile?.resistance === 'acidproof' || architectureResists(entity, 'acid'))) return;
      if (event.cause === 'hunger' && !needsFood(entity) || event.cause === 'drowning' && hasPhysiology(entity, 'aquatic')) return;
      const actual = Math.min(health.current, event.amount);
      health.current = Math.max(0, health.current - event.amount);
      const feeder = world.entities.get(event.sourceId ?? -1);
      if (feeder) { physiologyHit(world, feeder, entity, actual); if (health.current > 0 && event.cause === 'conflict') nimbleHit(world, feeder, entity); }
      interruptStatuses(world, entity);
      if (health.current > 0 && event.cause === 'fire' && entity.components.traits && !hasTrait(entity, 'skin-burns') && world.rng.next() < 0.5) acquireTraits(world, entity, ['skin-burns'], 'event');
      if (health.current <= 0) {
        if (entity.components.dwelling && entity.components.position) {
          world.visual({ kind: 'collapse', ...entity.components.position, radius: 5, house: structuredClone(entity), tick: world.tick });
          destroyHome(world, entity); return;
        }
        if (entity.components.building) { destroyBuilding(world, entity); return; }
        if (entity.components.explosive) detonate(world, entity);
        else world.die(entity.id, damageContext(world, { ...event, cause: event.cause ?? 'other' }));
      }
    },
  }).registerEvent({ kind: 'heat',
    validate: v => integer(v.target, 1) && number(v.amount, -1e6, 1e6) && validDamageContext(v),
    apply: changeBodyTemperature,
  }).registerEvent({ kind: 'tile-heat',
    validate: (v, c) => number(v.x, 0, c.width) && number(v.y, 0, c.height) && number(v.radius, 0.1, 64)
      && number(v.amount, -1e6, 1e6) && validDamageContext(v),
    apply: (world, event) => world.terrain.circle(event.x, event.y, event.radius, (x, y) => heatCell(world, { x, y }, event.amount, damageContext(world, { ...event, cause: event.cause ?? 'fire' }))),
  }).registerEvent({ kind: 'wet',
    validate: v => integer(v.target, 1) && number(v.amount, 0, 1e6),
    apply: (world, event) => {
      const entity = world.entities.get(event.target), thermal = entity?.components.thermal;
      if (!thermal) return;
      thermal.wetness = Math.min(1, thermal.wetness + event.amount);
      if (thermal.temperature > 0) thermal.temperature = Math.max(0, thermal.temperature - event.amount * 100);
      if (event.amount > 0) thermal.lastChange = { reason: 'wet', tick: world.tick };
      if (thermal.wetness >= 0.25) { wetStatuses(world, entity!); thermal.burning = false; }
    },
  }).registerEvent({ kind: 'impulse',
    validate: v => integer(v.target, 1) && number(v.x) && number(v.y),
    apply: (world, event) => {
      const entity = world.entities.get(event.target), motion = entity?.components.motion;
      if (motion && entity) {
        const force = entity.components.stats ? Math.min(10, 65 / unitStats(world, entity).values.mass) : 1;
        motion.vx += event.x * force; motion.vy += event.y * force;
      }
    },
  });
}

export function processEvents(world: World): void {
  let processed = 0;
  while (processed < EVENT_BUDGET && processed < world.events.length) applyEvent(world, world.events[processed++]);
  world.events.splice(0, processed);
}

export function water(world: World, dt: number): void {
  const lifted = liftedIds(world);
  for (const entity of world.query('thermal', 'position')) {
    const p = entity.components.position!;
    if (!world.terrain.isOpenWater(p.x, p.y) || entity.components.ship || !touchesGround(world.registry, entity) || lifted.has(entity.id) || aboardFerry(world, entity.id)) continue;
    applyEvent(world, { kind: 'wet', target: entity.id, amount: 1 });
  }
  for (const entity of world.query('person', 'health', 'position')) {
    const p = entity.components.position!;
    // Exhaustion belongs to the saved stamina bar; only an exhausted swimmer drowns.
    if (entity.components.statuses || !world.terrain.isOpenWater(p.x, p.y) || (entity.components.stats?.stamina ?? 0) > 0
      || !touchesGround(world.registry, entity) || lifted.has(entity.id) || aboardFerry(world, entity.id)) continue;
    applyEvent(world, { kind: 'damage', target: entity.id, amount: 7 * dt, cause: 'drowning' });
  }
}

export function rain(world: World, dt: number): void {
  // Overlapping brush samples never multiply the rainfall rate.
  const wetted = new Set<number>();
  const watered = new Set<number>();
  for (const effect of world.effects) {
    for (const entity of world.nearby(effect, effect.radius)) {
      if (!wetted.has(entity.id)) {
        applyEvent(world, { kind: 'wet', target: entity.id, amount: dt * 2 });
        if (world.tick % 30 === entity.id % 30) rainTarget(world, entity, world.rng);
        wetted.add(entity.id);
      }
    }
    world.terrain.circle(effect.x, effect.y, effect.radius, (x, y, i) => {
      if (watered.has(i)) return;
      watered.add(i);
      if (world.tick % 30 === i % 30) rainCell(world, { x: x + 0.5, y: y + 0.5 }, world.rng);
      coolCellWithRain(world, i, dt);
      if (lawEnabled(world, 'grow-grass') && world.terrain.tiles[i] === Terrain.Scorched) {
        world.terrain.moisture[i] += dt * LANDSCAPE_RECOVERY_RATE;
        if (world.terrain.moisture[i] >= 3) world.terrain.set(x, y, world.terrain.recovery.get(i)?.target ?? Terrain.Grass);
      }
    });
    effect.remaining -= dt;
  }
  for (let i = world.effects.length - 1; i >= 0; i--) if (world.effects[i].remaining <= 0) world.effects.splice(i, 1);
}

export function fire(world: World, dt: number): void {
  if (world.paused) return;
  for (const entity of world.query('thermal')) {
    const { thermal, combustible, position, explosive } = entity.components;
    thermal!.temperature = approachZero(thermal!.temperature, entity.components.unit ? dt * 30 / TEMPERATURE.bodyRecoveryTicks : dt * 4);
    if (statusImmune(entity, 'fire') || entity.components.stockpile?.resistance === 'fireproof' || architectureResists(entity, 'fire')) {
      removeStatus(world, entity, 'burning', 'cured'); thermal!.burning = false;
    }
    thermal!.wetness = Math.max(0, thermal!.wetness - dt * 0.07);
    if (!thermal!.burning || !combustible || !position) {
      continue;
    }
    if (combustible.fuel <= 0 || thermal!.wetness >= 0.25) { removeStatus(world, entity, 'burning', 'condition-ended'); thermal!.burning = false; continue; }
    combustible.fuel = Math.max(0, combustible.fuel - dt);
    if (explosive) explosive.fuse = Math.min(explosive.fuse, 0.1);
    igniteTile(world, position);
    const context = damageContext(world, { ...thermal!.ignition, cause: 'fire' });
    if (terrainChangeAllowed(world, 'fire')) heatCell(world, position, dt * 4, context);
    if (!entity.components.statuses) applyEvent(world, { kind: 'damage', target: entity.id, amount: dt * 11, ...context });
    if (terrainChangeAllowed(world, 'fire') && world.tick % 15 === 0) {
      for (const neighbor of world.nearby(position, 3.1).sort((a, b) => a.id - b.id)) {
        if (neighbor.id !== entity.id && neighbor.components.combustible) world.events.push({ kind: 'heat', target: neighbor.id, amount: 21, ...context });
      }
    }
  }
}

export function explosives(world: World, dt: number): void {
  for (const entity of world.query('explosive', 'position')) {
    const { explosive, projectile } = entity.components;
    explosive!.fuse -= dt;
    if (projectile) projectile.remaining = Math.max(0, projectile.remaining - dt);
    if (explosive!.fuse <= 1e-7) detonate(world, entity);
  }
}
