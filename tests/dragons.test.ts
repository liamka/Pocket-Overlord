import { describe, expect, it } from 'vitest';
import { DRAGON, DRAGON_FIRE_ID, DRAGON_ID, dragonAltitude, dragonBreathPoint, dragonBreathPose, dragonGroundPosition, setDragonViewport } from '../src/content/dragons';
import { World } from '../src/core/world';
import { SAVE_VERSION, STEP, Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent } from '../src/systems/effects';
import { advance, flatWorld } from './helpers';

function attackWorld() {
  const world = flatWorld();
  const dragon = world.spawn(DRAGON_ID, { x: 15, y: 24 })!;
  Object.assign(dragon.components.dragon!, { heading: 0, attackIn: 0, goalX: 40, goalY: 24 });
  const house = world.spawn('core:house', { x: 21, y: 24 })!;
  const behind = world.spawn('core:tree', { x: 9, y: 24 })!;
  const outside = world.spawn('core:tree', { x: 24, y: 32 })!;
  return { world, dragon, house, behind, outside };
}

describe('dragons', () => {
  it.each([0, 2, 8, 5])('flies in from a screen corner to the selected point without breathing fire (seed %i)', seed => {
    const world = flatWorld(), target = { x: 24, y: 24 }, viewport = { left: 10, top: 8, right: 38, bottom: 36 };
    world.rng.state = seed; world.command({ kind: 'use-tool', toolId: DRAGON_ID, ...target, viewport });
    const dragon = [...world.query('dragon')][0], state = dragon.components.dragon!;
    const start = dragonGroundPosition(dragon.components.position!, state), flight = { ...state.arrival! };
    expect(start.x < viewport.left - 8 || start.x > viewport.right + 8).toBe(true);
    expect(start.y < viewport.top - 8 || start.y > viewport.bottom + DRAGON.altitude + 8).toBe(true);
    let previous = Math.hypot(start.x - target.x, start.y - target.y);
    for (let i = 0; i < Math.ceil(flight.duration / STEP) && state.arrival; i++) {
      world.step(); const ground = dragonGroundPosition(dragon.components.position!, state);
      const distance = Math.hypot(ground.x - target.x, ground.y - target.y);
      expect(distance).toBeLessThanOrEqual(previous); previous = distance;
      expect(state.breath).toBe(0);
    }
    expect(state.arrival).toBeUndefined(); expect(dragon.components.position).toEqual(target);
    expect(state.returnPoint).toEqual(start);
    expect([...world.entities.values()].filter(e => e.typeId === DRAGON_FIRE_ID)).toHaveLength(0);
    world.step(); expect(Math.hypot(dragon.components.position!.x - target.x, dragon.components.position!.y - target.y)).toBeCloseTo(DRAGON.speed * STEP);
  });

  it('begins its return at 35 seconds, stops fire and flies fully outside the viewport before removal', () => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.DeepWater);
    const dragon = world.spawn(DRAGON_ID, { x: 24, y: 24 })!, state = dragon.components.dragon!;
    advance(world, DRAGON.lifetime - STEP); expect(state.departure).toBeUndefined();
    const before = { ...dragon.components.position! }; state.breath = 1; state.pulseIn = 0;
    world.step(); expect(state.age).toBeCloseTo(35); expect(state.departure).toBeDefined();
    expect(state.breath).toBe(0); expect(state.targetId).toBeNull();
    expect(dragonGroundPosition(dragon.components.position!, state)).toEqual(before);
    const heading = state.heading; world.step();
    const turn = Math.atan2(Math.sin(state.heading - heading), Math.cos(state.heading - heading));
    expect(Math.abs(turn)).toBeLessThanOrEqual(STEP * 1.8 + 1e-9);
    advance(world, 0.5); expect(world.entities.has(dragon.id)).toBe(true);
    expect(dragonGroundPosition(dragon.components.position!, state)).not.toEqual(before);
    advance(world, 4); expect(world.entities.has(dragon.id)).toBe(false);
    expect([...world.entities.values()].filter(e => e.typeId === DRAGON_FIRE_ID)).toHaveLength(0);
  });

  it.each(['arrival', 'departure'] as const)('freezes and restores its %s without resetting the deadline', phase => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.DeepWater);
    world.command({ kind: 'use-tool', toolId: DRAGON_ID, x: 24, y: 24 });
    const dragon = [...world.query('dragon')][0], state = dragon.components.dragon!;
    if (phase === 'departure') { advance(world, 4); state.age = DRAGON.lifetime - STEP; world.step(); }
    advance(world, 0.5); expect(state[phase]).toBeDefined();
    world.paused = true; const saved = world.snapshot(); advance(world, 1); expect(world.snapshot()).toEqual(saved);
    const restored = new World(world.seed, world.registry, decodeSave(JSON.parse(JSON.stringify(saved)), world.registry));
    const copy = restored.entities.get(dragon.id)!;
    expect(dragonGroundPosition(copy.components.position!, copy.components.dragon!)).toEqual(dragonGroundPosition(dragon.components.position!, state));
    world.paused = restored.paused = false; advance(world, 6); advance(restored, 6);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('keeps flying if the camera follows it beyond the original exit point', () => {
    const world = flatWorld(), dragon = world.spawn(DRAGON_ID, { x: 24, y: 24 })!, state = dragon.components.dragon!;
    Object.assign(state, { age: 35 - STEP, returnPoint: { x: -12, y: -12 } });
    setDragonViewport(world, { left: -90, top: -70, right: 110, bottom: 90 }); world.step();
    const first = { ...state.departure! };
    expect(first.toX < -98 || first.toY < -78).toBe(true);
    setDragonViewport(world, { left: first.toX - 40, top: first.toY - 40, right: first.toX + 40, bottom: first.toY + 40 });
    advance(world, first.duration + STEP);
    expect(world.entities.has(dragon.id)).toBe(true); expect(state.departure!.toX).toBeLessThan(first.toX);
    advance(world, 4); expect(world.entities.has(dragon.id)).toBe(false);
  });

  it('migrates existing dragons in place and rejects broken arrival and departure saves', () => {
    const world = flatWorld(), dragon = world.spawn(DRAGON_ID, { x: 24, y: 24 })!;
    const legacy = JSON.parse(JSON.stringify(world.snapshot())); legacy.version = 25;
    delete legacy.entities[0].components.dragon.age;
    const loaded = decodeSave(legacy, world.registry);
    expect(loaded.version).toBe(SAVE_VERSION); expect(loaded.entities[0].components.dragon!.age).toBe(0);
    expect(loaded.entities[0].components.position).toEqual(dragon.components.position);
    expect(loaded.entities[0].components.dragon!.arrival).toBeUndefined();
    world.remove(dragon.id); world.command({ kind: 'use-tool', toolId: DRAGON_ID, x: 24, y: 24 });
    const state = [...world.query('dragon')][0].components.dragon!;
    for (const phase of ['arrival', 'departure'] as const) {
      if (phase === 'departure') { advance(world, 4); state.age = DRAGON.lifetime; world.step(); }
      for (const [key, value] of [['fromX', NaN], ['toY', Infinity], ['duration', 0], ['elapsed', 10]]) {
        const saved = world.snapshot(); Object.assign(saved.entities.find(e => e.components.dragon)!.components.dragon![phase]!, { [key]: value });
        expect(() => decodeSave(saved, world.registry)).toThrow();
      }
      expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
    }
  });

  it('spawns over land, water and buildings without adding residents or blocking ground movement', () => {
    const world = flatWorld();
    world.terrain.set(12, 12, Terrain.DeepWater);
    world.spawn('core:tree', { x: 24, y: 24 });
    for (const point of [{ x: 12, y: 12 }, { x: 24, y: 24 }, { x: 36, y: 36 }]) {
      expect(world.command({ kind: 'use-tool', toolId: DRAGON_ID, ...point })).toBeUndefined();
    }
    expect([...world.query('dragon')]).toHaveLength(3);
    expect(world.population).toBe(0);
    expect(world.canStand({ x: 36, y: 36 })).toBe(true);
    world.command({ kind: 'use-tool', toolId: DRAGON_ID, x: -1, y: 24 });
    expect([...world.query('dragon')]).toHaveLength(3);
  });

  it('flies across water and mountains and stays inside every edge of the map', () => {
    const world = flatWorld();
    world.terrain.tiles.fill(Terrain.DeepWater);
    for (let x = 20; x < 30; x++) world.terrain.set(x, 24, Terrain.Mountain);
    const dragon = world.spawn(DRAGON_ID, { x: 15, y: 24 })!;
    Object.assign(dragon.components.dragon!, { heading: 0, goalX: 44, goalY: 24 });
    advance(world, 3);
    expect(dragon.components.position!.x).toBeCloseTo(30);
    expect(dragon.components.health!.current).toBe(1800);
    for (const [x, y, heading] of [[0.5, 0.5, Math.PI], [47.5, 0.5, 0], [0.5, 47.5, Math.PI / 2], [47.5, 47.5, Math.PI / 2]]) {
      Object.assign(dragon.components.position!, { x, y }); world.spatial.update(dragon);
      dragon.components.dragon!.heading = heading;
      advance(world, 2);
      const p = dragon.components.position!;
      expect(world.terrain.inside(p.x, p.y)).toBe(true);
      expect(Math.hypot(p.x - x, p.y - y)).toBeGreaterThan(1);
    }
  });

  it('aims at a settlement, breathes forward, ignites targets and leaves fire without craters', () => {
    const { world, dragon, house, behind, outside } = attackWorld();
    world.step();
    expect(dragon.components.dragon!.targetId).toBe(house.id);
    expect(dragon.components.dragon!.breath).toBeGreaterThan(0);
    expect(house.components.thermal!.burning).toBe(true);
    expect(house.components.health!.current).toBeLessThan(180);
    expect(behind.components.health!.current).toBe(80);
    expect(outside.components.health!.current).toBe(80);
    expect([...world.entities.values()].some(e => e.typeId === DRAGON_FIRE_ID)).toBe(true);
    expect(world.terrain.tiles).toContain(Terrain.Scorched);
    expect(world.terrain.tiles).not.toContain(Terrain.Crater);
    advance(world, 18);
    expect(world.entities.has(house.id)).toBe(false);
    expect(dragon.components.health!.current).toBe(1800);
  });

  it('turns toward targets before breathing and does not burn behind itself', () => {
    const { world, dragon, house, behind, outside } = attackWorld();
    world.remove(behind.id); world.remove(outside.id);
    dragon.components.dragon!.heading = Math.PI;
    world.step();
    expect(dragon.components.dragon!.breath).toBe(0);
    expect(house.components.thermal!.burning).toBe(false);
    advance(world, 6);
    expect(house.components.health!.current).toBeLessThan(180);
  });

  it('makes attack passes through a dense settlement instead of circling the closest roof', () => {
    const world = flatWorld();
    const houses = [];
    for (let y = 12; y <= 36; y += 6) for (let x = 16; x <= 40; x += 8) houses.push(world.spawn('core:house', { x, y })!);
    const dragon = world.spawn(DRAGON_ID, { x: 15, y: 24 })!;
    Object.assign(dragon.components.dragon!, { heading: 0, attackIn: 0 });
    advance(world, 2);
    expect(houses.some(house => house.components.health!.current < 180)).toBe(true);
    expect(world.terrain.tiles).toContain(Terrain.Scorched);
  });

  it('extinguishes lingering fires with rain and removes spent fire entities', () => {
    const { world, dragon } = attackWorld();
    world.step(); world.remove(dragon.id);
    const fires = [...world.entities.values()].filter(e => e.typeId === DRAGON_FIRE_ID);
    expect(fires.length).toBeGreaterThan(0);
    world.addRain({ x: 23, y: 24 }, 16, 1);
    advance(world, 0.5);
    expect(fires.every(e => !world.entities.has(e.id))).toBe(true);
    const spent = world.spawn(DRAGON_FIRE_ID, { x: 40, y: 40 })!;
    advance(world, DRAGON.fireSeconds + 0.1);
    expect(world.entities.has(spent.id)).toBe(false);
  });

  it('does not leave ground fires in the sea or beneath active rain', () => {
    const world = flatWorld(), dragon = world.spawn(DRAGON_ID, { x: 15, y: 24 })!;
    Object.assign(dragon.components.dragon!, { heading: 0, breath: DRAGON.breathSeconds });
    world.terrain.tiles.fill(Terrain.DeepWater); advance(world, 0.5);
    expect([...world.entities.values()].filter(e => e.typeId === DRAGON_FIRE_ID)).toHaveLength(0);
    world.terrain.tiles.fill(Terrain.Grass);
    world.addRain({ x: 24, y: 24 }, 20, 1); advance(world, 0.5);
    expect([...world.entities.values()].filter(e => e.typeId === DRAGON_FIRE_ID)).toHaveLength(0);
  });

  it('burns empty ground during a full-speed low pass and leaves a continuous stationary trail', () => {
    const world = flatWorld(), dragon = world.spawn(DRAGON_ID, { x: 15, y: 24 })!;
    Object.assign(dragon.components.dragon!, { heading: 0, goalX: 42, goalY: 24, attackIn: 0 });
    advance(world, 0.2);
    const first = [...world.entities.values()].find(e => e.typeId === DRAGON_FIRE_ID)!;
    expect(first).toBeDefined();
    const firstPosition = { ...first.components.position! };
    advance(world, 2);
    expect(dragon.components.position!.x).toBeCloseTo(26);
    expect(dragon.components.position!.y).toBeCloseTo(24);
    expect(dragon.components.dragon!.breath).toBe(0);
    expect(first.components.position).toEqual(firstPosition);
    expect(first.components.position!.x).toBeLessThan(dragon.components.position!.x);
    expect(first.components.thermal!.burning).toBe(true);
    for (let x = 21; x <= 29; x++) expect(world.terrain.at(x, 24)).toBe(Terrain.Scorched);
    expect(world.terrain.at(34, 24)).toBe(Terrain.Grass);
  });

  it('burns only the ground impact, leaving objects under the airborne jet and farther ahead untouched', () => {
    const { world, dragon, house } = attackWorld();
    const underneath = world.spawn('core:tree', { x: 18, y: 24 })!;
    const distant = world.spawn('core:tree', { x: 25.5, y: 24 })!;
    world.step();
    expect(house.components.thermal!.burning).toBe(true);
    for (const tree of [underneath, distant]) {
      expect(tree.components.thermal!.burning).toBe(false);
      expect(tree.components.health!.current).toBe(80);
    }
    const impact = dragonBreathPoint(dragon.components.position!, dragon.components.dragon!.heading, DRAGON.reach);
    const fire = [...world.entities.values()].filter(e => e.typeId === DRAGON_FIRE_ID);
    expect(fire).toHaveLength(1);
    expect(fire[0].components.position).toEqual(impact);
  });

  it('connects the mouth to the actual ground impact in every flight direction', () => {
    const p = { x: 24, y: 24 }, time = 1.25;
    // The airborne body clears the ground shadow while the jet still reaches its actual impact.
    expect(dragonAltitude(time) * 8).toBeGreaterThan(24);
    expect(dragonAltitude(time) * 8).toBeLessThan(28);
    for (let i = 0; i < 8; i++) {
      const heading = i * Math.PI / 4;
      const mouth = dragonBreathPose(p, heading, time, 0);
      const middle = dragonBreathPose(p, heading, time, 0.5);
      const impact = dragonBreathPose(p, heading, time, 1);
      expect(mouth.altitude).toBeGreaterThan(middle.altitude);
      expect(middle.altitude).toBeGreaterThan(0);
      expect(impact.altitude).toBe(0);
      expect({ x: impact.x, y: impact.y }).toEqual(dragonBreathPoint(p, heading, DRAGON.reach));
      expect(Math.hypot(impact.ground.x - mouth.ground.x, impact.ground.y - mouth.ground.y)).toBeLessThan(2);
    }
  });

  it('preserves flight, breath, cooldowns, fires and random choices through pause and reload', () => {
    const { world, dragon } = attackWorld(); advance(world, 0.6);
    expect(dragon.components.dragon!.breath).toBeGreaterThan(0);
    world.paused = true;
    const saved = world.snapshot(); advance(world, 1);
    expect(world.snapshot()).toEqual(saved);
    const decoded = decodeSave(JSON.parse(JSON.stringify(saved)), world.registry);
    const restored = new World(world.seed, world.registry, decoded);
    expect(restored.snapshot()).toEqual(saved);
    world.paused = false; restored.paused = false;
    advance(world, 8); advance(restored, 8);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(decodeSave(restored.snapshot(), world.registry)).toEqual(restored.snapshot());
  });

  it('can be killed and safely retargets after its victim disappears', () => {
    const { world, dragon, house } = attackWorld(); world.step();
    world.remove(house.id); advance(world, 2);
    expect(dragon.components.dragon!.targetId).not.toBe(house.id);
    applyEvent(world, { kind: 'blast', ...dragon.components.position!, radius: 4, power: 2000, heat: 100 });
    world.step();
    expect(world.entities.has(dragon.id)).toBe(false);
    expect([...world.query('dragon')]).toHaveLength(0);
  });

  it('validates saved dragon state and still reads existing worlds without dragons', () => {
    const world = flatWorld(); expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
    world.spawn(DRAGON_ID, { x: 24, y: 24 });
    for (const [key, value] of [['heading', NaN], ['breath', -1], ['pulseIn', 12], ['targetId', 'bad'], ['goalX', -1]]) {
      const saved = world.snapshot(); Object.assign(saved.entities[0].components.dragon!, { [key]: value });
      expect(() => decodeSave(saved, world.registry)).toThrow();
    }
    const missing = world.snapshot(); delete missing.entities[0].components.dragon;
    expect(() => decodeSave(missing, world.registry)).toThrow();
  });
});
