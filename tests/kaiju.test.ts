import { describe, expect, it } from 'vitest';
import { KAIJU, KAIJU_ID, kaijuBeam, kaijuPose } from '../src/content/kaiju';
import { World } from '../src/core/world';
import { Terrain, type ToolControl } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld } from './helpers';

function arena() {
  const source = flatWorld(), snapshot = source.snapshot();
  snapshot.terrain = { width: 96, height: 96, tiles: Array(96 * 96).fill(Terrain.Grass), moisture: Array(96 * 96).fill(0), recovery: [] };
  const world = new World(source.seed, source.registry, snapshot);
  const titan = world.spawn(KAIJU_ID, { x: 30, y: 48 })!;
  Object.assign(titan.components.kaiju!, { heading: 0, aimX: 54, aimY: 48, goalX: 80, goalY: 48 });
  return { world, titan, state: titan.components.kaiju! };
}
const control = (world: World, input: Partial<ToolControl> = {}) => world.command({ kind: 'control-tool', toolId: KAIJU_ID, x: 0, y: 0, active: true, attacking: false, ...input });

describe('giant kaiju', () => {
  it('summons on land or water and subsequent clicks aim the same monster', () => {
    const world = flatWorld(); world.terrain.set(24, 24, Terrain.DeepWater);
    world.command({ kind: 'use-tool', toolId: KAIJU_ID, x: 24, y: 24 });
    world.command({ kind: 'use-tool', toolId: KAIJU_ID, x: 36, y: 12 });
    const monsters = [...world.query('kaiju')]; expect(monsters).toHaveLength(1);
    expect(monsters[0].components.kaiju).toMatchObject({ aimX: 36, aimY: 12 });
    expect(world.population).toBe(0);
    expect(decodeSave(world.snapshot(), world.registry)).toEqual(world.snapshot());
  });

  it('walks in eight directions at a fixed speed and stops on key release', () => {
    const { world, titan, state } = arena();
    control(world, { x: 1 }); advance(world, 1);
    expect(titan.components.position).toEqual({ x: expect.closeTo(35), y: 48 });
    const gait = state.gait;
    control(world); advance(world, 0.6);
    expect(titan.components.position!.x).toBeCloseTo(35); expect(state.gait).toBe(gait);
    control(world, { x: -1, y: -1 }); advance(world, 1);
    expect(Math.hypot(titan.components.position!.x - 35, titan.components.position!.y - 48)).toBeCloseTo(5);
    expect(titan.components.position!.y).toBeLessThan(48);
  });

  it('crushes buildings, people and roads beneath its body without hurting itself', () => {
    const { world, titan } = arena();
    const house = world.spawn('core:house', { x: 34, y: 48 })!, tree = world.spawn('core:tree', { x: 32, y: 50 })!;
    const outside = world.spawn('core:house', { x: 34, y: 60 })!;
    world.terrain.set(32, 48, Terrain.Road);
    control(world, { x: 1 }); advance(world, 1);
    expect(world.entities.has(house.id)).toBe(false); expect(world.entities.has(tree.id)).toBe(false);
    expect(outside.components.health!.current).toBe(180);
    expect(world.terrain.at(32, 48)).toBe(Terrain.Crater);
    expect(titan.components.health!.current).toBe(KAIJU.health);
  });

  it('crosses sea and mountains, leaving water intact and staying inside map edges', () => {
    const { world, titan } = arena(); world.terrain.tiles.fill(Terrain.DeepWater);
    world.terrain.set(34, 48, Terrain.Mountain);
    control(world, { x: 1 }); advance(world, 2);
    expect(titan.components.position!.x).toBeCloseTo(40);
    expect(world.terrain.at(34, 48)).toBe(Terrain.Crater);
    expect(world.terrain.at(32, 48)).toBe(Terrain.DeepWater);
    Object.assign(titan.components.position!, { x: 95.4, y: 95.4 }); world.spatial.update(titan);
    control(world, { x: 1, y: 1 }); advance(world, 0.5);
    expect(titan.components.position).toEqual({ x: 95.5, y: 95.5 });
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('charges before its mouth beam destroys the ground impact and leaves objects beneath its flight intact', () => {
    const { world, titan, state } = arena();
    const upper = world.spawn('core:house', { x: 54, y: 46.5 })!, lower = world.spawn('core:house', { x: 54, y: 49.5 })!;
    const underneath = world.spawn('core:house', { x: 40, y: 48 })!;
    const behind = world.spawn('core:house', { x: 15, y: 48 })!, outside = world.spawn('core:house', { x: 46, y: 65 })!;
    control(world, { attacking: true }); advance(world, 0.5);
    expect(state.phase).toBe('charge'); expect(upper.components.health!.current).toBe(180);
    advance(world, 0.3);
    expect(state.phase).toBe('beam'); expect(world.entities.has(upper.id)).toBe(false); expect(world.entities.has(lower.id)).toBe(false);
    expect(behind.components.health!.current).toBe(180); expect(outside.components.health!.current).toBe(180);
    expect(world.terrain.at(54, 48)).toBe(Terrain.Crater);
    expect(underneath.components.health!.current).toBe(180);
    expect(titan.components.health!.current).toBe(KAIJU.health);
    control(world); advance(world, 3);
    expect(state.phase).toBe('idle');
  });

  it('turns toward aim and caps its mouth beam at the maximum reach', () => {
    const { world, titan, state } = arena();
    control(world, { attacking: true }); world.command({ kind: 'aim-tool', toolId: KAIJU_ID, x: 30, y: 0 });
    world.step(); expect(state.phase).toBe('idle');
    advance(world, 1.5); expect(state.phase).toBe('beam');
    const beam = kaijuBeam(titan.components.position!, state);
    expect(beam.from).toEqual(kaijuPose(titan.components.position!, state).mouth);
    expect(beam.from.height).toBeGreaterThan(12);
    expect(beam.to.y).toBeCloseTo(20);
    expect(Math.hypot(beam.to.x - 30, beam.to.y - 48)).toBeCloseTo(28);
  });

  it('keeps the head upright in every direction and alternates two weight-bearing feet', () => {
    const { titan, state } = arena();
    for (let i = 0; i < 8; i++) {
      state.heading = i * Math.PI / 4;
      const pose = kaijuPose(titan.components.position!, state);
      expect(pose.feet).toHaveLength(2); expect(pose.mouth.height).toBeGreaterThan(12);
      expect(kaijuBeam(titan.components.position!, state).from).toEqual(pose.mouth);
    }
    state.gait = 0.25;
    const first = kaijuPose(titan.components.position!, state).feet;
    state.gait = 0.75;
    const second = kaijuPose(titan.components.position!, state).feet;
    expect(first[0].height).toBeCloseTo(0); expect(first[1].height).toBeCloseTo(0.8);
    expect(second[0].height).toBeCloseTo(0.8); expect(second[1].height).toBeCloseTo(0);
  });

  it('resumes autonomous destruction after the player selects another power', () => {
    const { world, state, titan } = arena();
    const house = world.spawn('core:house', { x: 54, y: 48 })!;
    control(world); advance(world, 1); expect(state.phase).toBe('idle'); expect(titan.components.position!.x).toBe(30);
    control(world, { active: false }); advance(world, 1.8);
    expect(titan.components.position!.x).toBeGreaterThan(30);
    expect(world.entities.has(house.id)).toBe(false);
  });

  it.each([0.3, 1.2, 2.8])('preserves an autonomous attack, gait and damage through pause and reload at %s seconds', time => {
    const { world } = arena(); world.spawn('core:house', { x: 54, y: 48 });
    advance(world, time); world.paused = true;
    const snapshot = world.snapshot(); advance(world, 1); expect(world.snapshot()).toEqual(snapshot);
    const restored = new World(world.seed, world.registry, decodeSave(JSON.parse(JSON.stringify(snapshot)), world.registry));
    expect(restored.snapshot()).toEqual(snapshot);
    world.paused = restored.paused = false; advance(world, 0.8); advance(restored, 0.8);
    expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('ignores malformed controls and rejects corrupt monster state', () => {
    const { world, titan, state } = arena(); control(world);
    for (const x of [NaN, Infinity, -2, 2]) control(world, { x });
    advance(world, 0.5); expect(titan.components.position).toEqual({ x: 30, y: 48 });
    for (const invalid of [{ heading: NaN }, { phase: 'explode' }, { phaseTime: -1 }, { gait: 2 }, { pulseIn: 2 }, { aimX: Infinity }]) {
      const snapshot = world.snapshot(); Object.assign(snapshot.entities.find(e => e.id === titan.id)!.components.kaiju!, invalid);
      expect(() => decodeSave(snapshot, world.registry)).toThrow();
    }
    expect(state.phase).toBe('idle');
  });

  it('can be destroyed and summoned again', () => {
    const { world, titan } = arena(); control(world);
    world.events.push({ kind: 'damage', target: titan.id, amount: KAIJU.health }); world.step();
    expect(world.entities.has(titan.id)).toBe(false);
    world.command({ kind: 'use-tool', toolId: KAIJU_ID, x: 48, y: 48 });
    expect([...world.query('kaiju')]).toHaveLength(1);
  });
});
