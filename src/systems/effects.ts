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
      for (const entity of world.nearby(wave, Math.min(shape.range, radius))) {
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
        if (shape.tsunami && health) world.events.push({ kind: 'damage', target: entity.id, amount: 220 * force });
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
  world.events.push({ kind: 'blast', ...position, radius: explosive.radius, power: explosive.power, heat: explosive.heat, ...(style ? { style } : {}) });
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
      && (v.style === undefined || v.style === 'napalm' || v.style === 'rocket' || v.style === 'dynamite'),
    apply: (world, event) => {
      launchSeaWave(world, event, event.radius);
      world.visual({ kind: 'blast', x: event.x, y: event.y, radius: event.radius, ...(event.style ? { style: event.style } : {}) });
      world.events.push({ kind: 'surface', x: event.x, y: event.y, radius: event.radius, terrain: Terrain.Scorched });
      world.events.push({ kind: 'surface', x: event.x, y: event.y, radius: event.radius * 0.42, terrain: Terrain.Crater });
      for (const entity of world.nearby(event, event.radius)) {
        const { position, health, thermal, motion, projectile } = entity.components;
        if (projectile) continue;
        const dx = position!.x - event.x, dy = position!.y - event.y;
        const distance = Math.hypot(dx, dy);
        const falloff = Math.max(0, 1 - distance / event.radius);
        if (thermal) world.events.push({ kind: 'heat', target: entity.id, amount: event.heat * falloff });
        if (health) world.events.push({ kind: 'damage', target: entity.id, amount: event.power * falloff });
        if (motion) world.events.push({ kind: 'impulse', target: entity.id, x: dx / (distance || 1) * falloff * 16, y: dy / (distance || 1) * falloff * 16 });
      }
    },
  }).registerEvent({ kind: 'surface',
    validate: (v, c) => number(v.x, 0, c.width) && number(v.y, 0, c.height) && number(v.radius, 0.1, 64) && integer(v.terrain, 2, 5),
    apply: (world, event) => {
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
    validate: v => integer(v.target, 1) && number(v.amount, 0, 1e6),
    apply: (world, event) => {
      const entity = world.entities.get(event.target), health = entity?.components.health;
      if (!entity || !health) return;
      health.current -= event.amount;
      if (health.current <= 0) {
        if (entity.components.dwelling && entity.components.position) {
          world.visual({ kind: 'collapse', ...entity.components.position, radius: 5, house: structuredClone(entity), tick: world.tick });
          destroyHome(world, entity); return;
        }
        if (entity.components.explosive) detonate(world, entity);
        else world.remove(entity.id);
      }
    },
  }).registerEvent({ kind: 'heat',
    validate: v => integer(v.target, 1) && number(v.amount, 0, 1e6),
    apply: (world, event) => {
      const entity = world.entities.get(event.target);
      if (!entity) return;
      const { thermal, combustible, position } = entity.components;
      if (!thermal) return;
      if (position && !entity.components.ship && !world.terrain.isLand(position.x, position.y)) {
        thermal.wetness = 1; thermal.burning = false; thermal.temperature = 0;
        return;
      }
      thermal.temperature += event.amount * (1 - thermal.wetness * 0.85);
      if (combustible && combustible.fuel > 0 && thermal.wetness < 0.3 && thermal.temperature >= combustible.ignition) thermal.burning = true;
    },
  }).registerEvent({ kind: 'wet',
    validate: v => integer(v.target, 1) && number(v.amount, 0, 1e6),
    apply: (world, event) => {
      const thermal = world.entities.get(event.target)?.components.thermal;
      if (!thermal) return;
      thermal.wetness = Math.min(1, thermal.wetness + event.amount);
      thermal.temperature = Math.max(0, thermal.temperature - event.amount * 100);
      if (thermal.wetness >= 0.25 || thermal.temperature < 5) thermal.burning = false;
    },
  }).registerEvent({ kind: 'impulse',
    validate: v => integer(v.target, 1) && number(v.x) && number(v.y),
    apply: (world, event) => {
      const motion = world.entities.get(event.target)?.components.motion;
      if (motion) { motion.vx += event.x; motion.vy += event.y; }
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
    if (entity.components.ship || lifted.has(entity.id) || aboardFerry(world, entity.id)) continue;
    const p = entity.components.position!;
    if (!world.terrain.isLand(p.x, p.y)) applyEvent(world, { kind: 'wet', target: entity.id, amount: 1 });
  }
  for (const entity of world.query('person', 'health', 'position')) {
    if (lifted.has(entity.id) || aboardFerry(world, entity.id)) continue;
    const p = entity.components.position!;
    // Existing health stores exhaustion across saves; a healthy adult lasts about ten seconds.
    if (!world.terrain.isLand(p.x, p.y)) applyEvent(world, { kind: 'damage', target: entity.id, amount: 7 * dt });
  }
}

export function rain(world: World, dt: number): void {
  // Overlapping brush samples never multiply the rainfall rate.
  const wetted = new Set<number>();
  const watered = new Set<number>();
  for (const effect of world.effects) {
    for (const entity of world.nearby(effect, effect.radius)) {
      if (!wetted.has(entity.id)) { applyEvent(world, { kind: 'wet', target: entity.id, amount: dt * 2 }); wetted.add(entity.id); }
    }
    world.terrain.circle(effect.x, effect.y, effect.radius, (x, y, i) => {
      if (watered.has(i)) return;
      watered.add(i);
      if (world.terrain.tiles[i] === Terrain.Scorched) {
        world.terrain.moisture[i] += dt * LANDSCAPE_RECOVERY_RATE;
        if (world.terrain.moisture[i] >= 3) world.terrain.set(x, y, world.terrain.recovery.get(i)?.target ?? Terrain.Grass);
      }
    });
    effect.remaining -= dt;
  }
  for (let i = world.effects.length - 1; i >= 0; i--) if (world.effects[i].remaining <= 0) world.effects.splice(i, 1);
}

export function fire(world: World, dt: number): void {
  for (const entity of world.query('thermal')) {
    const { thermal, combustible, position, explosive } = entity.components;
    thermal!.wetness = Math.max(0, thermal!.wetness - dt * 0.07);
    if (!thermal!.burning || !combustible || !position) {
      thermal!.temperature = Math.max(0, thermal!.temperature - dt * 4);
      continue;
    }
    if (combustible.fuel <= 0 || thermal!.wetness >= 0.25) { thermal!.burning = false; continue; }
    combustible.fuel = Math.max(0, combustible.fuel - dt);
    thermal!.temperature = Math.max(thermal!.temperature, 75);
    if (explosive) explosive.fuse = Math.min(explosive.fuse, 0.1);
    if (world.terrain.at(position.x, position.y) === Terrain.Grass) world.terrain.set(position.x, position.y, Terrain.Scorched);
    applyEvent(world, { kind: 'damage', target: entity.id, amount: dt * 11 });
    if (world.tick % 15 === 0) {
      for (const neighbor of world.nearby(position, 3.1)) {
        if (neighbor.id !== entity.id && neighbor.components.combustible) world.events.push({ kind: 'heat', target: neighbor.id, amount: 21 });
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
