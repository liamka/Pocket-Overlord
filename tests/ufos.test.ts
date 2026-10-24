import { describe, expect, it } from 'vitest';
import { UFO, UFO_ID, ufoPose } from '../src/content/ufos';
import { World } from '../src/core/world';
import { Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { applyEvent } from '../src/systems/effects';
import { advance, flatWorld } from './helpers';

function attackWorld() {
  const world = flatWorld(), saucer = world.spawn(UFO_ID, { x: 24, y: 24 })!;
  const house = world.spawn('core:house', { x: 24, y: 24 })!;
  return { world, saucer, house, state: saucer.components.ufo! };
}

describe('flying saucers', () => {
  it('spawns multiple independent saucers above land, buildings and water without blocking residents', () => {
    const world = flatWorld(); world.terrain.set(12, 12, Terrain.DeepWater);
    world.spawn('core:house', { x: 24, y: 24 });
    for (const p of [{ x: 12, y: 12 }, { x: 24, y: 24 }, { x: 36, y: 36 }]) {
      expect(world.command({ kind: 'use-tool', toolId: UFO_ID, ...p })).toBeUndefined();
    }
    const saucers = [...world.query('ufo')];
    expect(saucers).toHaveLength(3);
    expect(new Set(saucers.map(e => e.components.ufo!.offset)).size).toBe(3);
    expect(world.population).toBe(0); expect(world.canStand({ x: 36, y: 36 })).toBe(true);
    world.command({ kind: 'use-tool', toolId: UFO_ID, x: -1, y: 24 });
    expect([...world.query('ufo')]).toHaveLength(3);
  });

  it('accelerates, crosses water and mountains, then brakes into a stationary attack', () => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.DeepWater);
    for (let x = 18; x < 23; x++) world.terrain.set(x, 24, Terrain.Mountain);
    world.terrain.set(30, 24, Terrain.Grass);
    const saucer = world.spawn(UFO_ID, { x: 10, y: 24 })!, state = saucer.components.ufo!;
    world.spawn('core:house', { x: 30, y: 24 });
    world.step(); const initialSpeed = state.vx;
    advance(world, 0.5);
    expect(initialSpeed).toBeGreaterThan(0); expect(state.vx).toBeGreaterThan(initialSpeed);
    for (let i = 0; i < 180 && state.phase === 'cruise'; i++) world.step();
    expect(state.phase).toBe('charge'); expect(Math.abs(saucer.components.position!.x - 30)).toBeLessThan(0.45);
    expect(state.vx).toBe(0); expect(state.vy).toBe(0);
    const position = { ...saucer.components.position! }; advance(world, 0.3);
    expect(saucer.components.position).toEqual(position);
    expect(saucer.components.health!.current).toBe(UFO.health);
  });

  it('charges before impact, damages only the footprint and fires once per beam', () => {
    const { world, saucer, house, state } = attackWorld();
    const outside = world.spawn('core:tree', { x: 29, y: 24 })!;
    const neighbor = world.spawn(UFO_ID, { x: 24, y: 24 })!;
    neighbor.components.ufo!.attackIn = UFO.cooldown;
    world.step(); expect(state.phase).toBe('charge');
    advance(world, UFO.charge);
    expect(state.phase).toBe('beam'); expect(world.entities.has(house.id)).toBe(true);
    advance(world, 0.1); expect(world.entities.has(house.id)).toBe(true);
    advance(world, 0.1);
    expect(world.entities.has(house.id)).toBe(false);
    expect(world.terrain.at(24, 24)).toBe(Terrain.Crater);
    expect(outside.components.health!.current).toBe(80);
    expect(saucer.components.health!.current).toBe(UFO.health);
    expect(neighbor.components.health!.current).toBe(UFO.health);
    expect(world.visuals.filter(v => v.kind === 'blast')).toHaveLength(1);
    advance(world, 0.6);
    expect(world.visuals.filter(v => v.kind === 'blast')).toHaveLength(1);
    advance(world, 1);
    expect(state.phase).toBe('cruise'); expect(state.attackIn).toBeGreaterThan(0);
  });

  it('ignites surviving trees around the impact instead of dealing damage during charge', () => {
    const { world } = attackWorld();
    const tree = world.spawn('core:tree', { x: 26, y: 24 })!;
    advance(world, 0.5); expect(tree.components.thermal!.burning).toBe(false);
    advance(world, 0.3);
    expect(world.entities.has(tree.id)).toBe(true); expect(tree.components.thermal!.burning).toBe(true);
  });

  it('retargets missing prey and turns back from every map edge', () => {
    const { world, saucer, house, state } = attackWorld();
    world.remove(house.id); state.targetId = house.id;
    for (const [x, y, vx, vy] of [[0.5, 0.5, -11, -11], [47.5, 0.5, 11, -11], [0.5, 47.5, -11, 11], [47.5, 47.5, 11, 11]]) {
      Object.assign(saucer.components.position!, { x, y }); world.spatial.update(saucer);
      Object.assign(state, { vx, vy, goalX: 24, goalY: 24 }); advance(world, 1);
      const p = saucer.components.position!;
      expect(world.terrain.inside(p.x, p.y)).toBe(true); expect(Math.hypot(p.x - x, p.y - y)).toBeGreaterThan(1);
      expect(state.targetId).toBeNull();
    }
    applyEvent(world, { kind: 'damage', target: saucer.id, amount: UFO.health });
    advance(world, 1); expect([...world.query('ufo')]).toHaveLength(0);
  });

  it.each(['cruise', 'charge', 'beam', 'recover'] as const)('preserves %s, pause and subsequent random decisions through a save', phase => {
    const { world, state } = attackWorld();
    for (let i = 0; i < 120 && state.phase !== phase; i++) world.step();
    expect(state.phase).toBe(phase);
    world.paused = true; const saved = world.snapshot(); advance(world, 1);
    expect(world.snapshot()).toEqual(saved);
    const restored = new World(world.seed, world.registry, decodeSave(JSON.parse(JSON.stringify(saved)), world.registry));
    expect(restored.snapshot()).toEqual(saved);
    world.paused = restored.paused = false;
    advance(world, 6); advance(restored, 6);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(decodeSave(restored.snapshot(), world.registry)).toEqual(restored.snapshot());
  });

  it('keeps the beam attached to its emitter and lands at the exact damaging ground point', () => {
    const { saucer, state } = attackWorld(); const p = saucer.components.position!;
    state.phase = 'beam';
    for (const vx of [-UFO.speed, 0, UFO.speed]) {
      state.vx = vx; state.phaseTime = 0;
      const start = ufoPose(p, state); expect(start.tip).toEqual(start.emitter);
      state.phaseTime = UFO.contact / 2;
      const middle = ufoPose(p, state);
      expect(middle.tip.y).toBeGreaterThan(middle.emitter.y); expect(middle.tip.y).toBeLessThan(p.y);
      state.phaseTime = UFO.contact;
      const hit = ufoPose(p, state); expect(hit.tip).toEqual(p); expect(hit.emitter.x).toBe(p.x);
      expect(hit.altitude).toBeGreaterThan(8); expect(hit.strength).toBe(1);
    }
    state.phaseTime = UFO.beam; expect(ufoPose(p, state).strength).toBeCloseTo(0);
  });

  it('rejects invalid saved flight state while accepting older worlds without saucers', () => {
    const oldWorld = flatWorld(); expect(decodeSave(oldWorld.snapshot(), oldWorld.registry)).toEqual(oldWorld.snapshot());
    const { world, saucer } = attackWorld();
    for (const [key, value] of [['vx', NaN], ['vy', 12], ['age', -1], ['offset', Infinity], ['phase', 'unknown'],
      ['phaseTime', 100], ['targetId', 'bad'], ['goalX', -1], ['attackIn', 4]]) {
      const saved = world.snapshot(); Object.assign(saved.entities.find(e => e.id === saucer.id)!.components.ufo!, { [key]: value });
      expect(() => decodeSave(saved, world.registry), key.toString()).toThrow();
    }
    const missing = world.snapshot(); delete missing.entities.find(e => e.id === saucer.id)!.components.ufo;
    expect(() => decodeSave(missing, world.registry)).toThrow();
  });
});
