import { describe, expect, it } from 'vitest';
import { CLOUDS, clouds, cloudState, summonCloud, cancelCloud, type Cloud, type CloudType } from '../src/core/clouds';
import { World } from '../src/core/world';
import { Terrain } from '../src/core/types';
import { applyEvent } from '../src/systems/effects';
import { hasStatus, applyStatus } from '../src/core/status-effects';
import { unitStats } from '../src/core/unit-stats';
import { setWorldLaw } from '../src/core/world-rules';
import { subspeciesOf } from '../src/core/subspecies-state';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld } from './helpers';

const point = { x: 24.5, y: 24.5 };
const drop = (world: World, type: CloudType, seed = 1) => applyEvent(world, { kind: 'precipitation', ...point, type, seed, player: true });
const summon = (world: World, type: CloudType) => {
  const result = summonCloud(world, type, point); if (typeof result === 'string') throw new Error(result); return result;
};

describe('cloud precipitation', () => {
  it('extinguishes real bodies, buildings and ground, restores scorched soil and advances a crop without food', () => {
    const world = flatWorld();
    const person = world.spawn('core:person', point)!, house = world.spawn('core:house', point)!, farm = world.spawn('core:farm', point)!;
    person.components.traits!.entries = [];
    applyStatus(world, person, 'burning'); house.components.thermal!.burning = true;
    world.terrain.setLayers(point.x, point.y, { burning: 10 }); farm.components.farm!.growth = 0.25;
    drop(world, 'rain');
    expect(hasStatus(person, 'burning')).toBe(false); expect(house.components.thermal!.burning).toBe(false);
    expect(world.terrain.cell(point.x, point.y).burning).toBe(0);
    expect(farm.components.farm).toMatchObject({ growth: 0.5, harvests: 0 }); expect(farm.components.farm!.grain ?? 0).toBe(0);
    world.terrain.set(point.x, point.y, Terrain.Scorched); drop(world, 'rain'); expect(world.terrain.at(point.x, point.y)).toBe(Terrain.Grass);
  });
  it.each([Terrain.PitShallow, Terrain.PitClose, Terrain.PitDeep])('fills depression %s with its original depth', pit => {
    const world = flatWorld(); world.terrain.set(point.x, point.y, pit); drop(world, 'rain');
    expect(world.terrain.cell(point.x, point.y).waterDepth).toBe(pit - Terrain.PitShallow + 1);
  });
  it('consumes a water bomb once even when reloaded before its blast consequences', () => {
    const world = flatWorld(); world.terrain.setLayers(point.x, point.y, { top: 'water-bomb' }); drop(world, 'rain');
    expect(world.terrain.cell(point.x, point.y).top).toBeUndefined();
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    const pending = restored.events.length; drop(restored, 'rain'); expect(restored.events).toHaveLength(pending);
  });
  it('does not create a fourth object, and respects animal and sapient permissions', () => {
    const world = flatWorld();
    for (let i = 0; i < 3; i++) world.spawn('core:tree', { x: point.x + i - 1, y: point.y + 1 });
    drop(world, 'life'); expect(world.entities.size).toBe(3);
    for (const id of [...world.entities.keys()]) world.remove(id);
    setWorldLaw(world, 'animal-spawn', false); setWorldLaw(world, 'random-seeds', false);
    drop(world, 'life'); expect(world.entities.size).toBe(0);
    setWorldLaw(world, 'animal-spawn', true);
    for (let i = 0; i < 20; i++) drop(world, 'life', i);
    expect(world.population).toBe(0);
    for (const id of [...world.entities.keys()]) world.remove(id);
    setWorldLaw(world, 'drop-of-thoughts', true);
    world.registry.cloudSapientUnlocked = () => false; drop(world, 'life'); expect(world.population).toBe(0);
  });
  it('applies real magic and ash effects with environmental attribution', () => {
    const world = flatWorld(), person = world.spawn('core:person', point)!;
    person.components.traits!.entries = [];
    person.components.stats!.mana = 0; const max = unitStats(world, person).values.mana;
    drop(world, 'magic'); expect(person.components.stats!.mana).toBeGreaterThanOrEqual(max * 0.1);
    for (let seed = 0; seed < 20; seed++) { drop(world, 'magic', seed); drop(world, 'ash', seed); drop(world, 'rage', seed); }
    expect(hasStatus(person, 'spell-boost')).toBe(true); expect(hasStatus(person, 'ash-fever')).toBe(true); expect(hasStatus(person, 'rage')).toBe(true);
    expect(person.components.statuses!.active.find(s => s.id === 'ash-fever')!.source.name).toBe('Ash cloud');
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });
  it('allows forced rain cooling even under Eternal Lava and respects ground protection', () => {
    const world = flatWorld(); setWorldLaw(world, 'eternal-lava', true); drop(world, 'lava');
    expect(world.terrain.cell(point.x, point.y).lavaStage).toBe(4); drop(world, 'rain');
    expect(world.terrain.at(point.x, point.y)).toBe(Terrain.Hill); expect(world.terrain.cell(point.x, point.y).lavaStage).toBeUndefined();
    setWorldLaw(world, 'gaia', true); const before = world.terrain.snapshot(); drop(world, 'lava'); expect(world.terrain.snapshot()).toEqual(before);
  });
  it('keeps RNG and effects identical across pause and save/load, without a camera', () => {
    const world = flatWorld(); for (const type of ['life', 'magic', 'rain', 'snow', 'ash'] as const) summon(world, type);
    advance(world, 1); world.paused = true; const save = world.snapshot(); advance(world, 2); expect(world.snapshot()).toEqual(save);
    const restored = new World(world.seed, world.registry, decodeSave(save, world.registry));
    world.paused = restored.paused = false; advance(world, 3); advance(restored, 3); expect(restored.snapshot()).toEqual(world.snapshot());
  });
  it('expires plot sources after exactly 60 simulation seconds and cancels without future drops', () => {
    const world = flatWorld();
    const result = summonCloud(world, 'lightning', point, 'stormfront') as Cloud;
    advance(world, 59); expect(clouds(world)).toHaveLength(1); advance(world, 1); expect(clouds(world)).toHaveLength(0);
    const rain = summon(world, 'rain'); cancelCloud(world, rain.id);
    const ground = world.terrain.snapshot(); applyEvent(world, { kind: 'precipitation', ...point, type: 'lava', seed: 1, player: true, cloudId: rain.id });
    expect(world.terrain.snapshot()).toEqual(ground); expect(result.origin).toBe('stormfront');
  });
  it('does not emit a second Gaia cloud for the same dead identity after loading', () => {
    const world = flatWorld(), person = world.spawn('core:person', point)!;
    person.components.traits!.entries = []; subspeciesOf(person)!.traits.push('gaia-roots'); world.rng.state = 7;
    applyEvent(world, { kind: 'damage', target: person.id, amount: 1e6, cause: 'divine' });
    expect(clouds(world)).toHaveLength(1);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry)), before = restored.rng.state, count = clouds(restored).length;
    restored.die(person.id, { cause: 'divine' }); expect(clouds(restored)).toHaveLength(count); expect(restored.rng.state).toBe(before);
  });
  it('bounds source intensity and rejects malformed saved timers, speeds and duplicate IDs', () => {
    const world = flatWorld();
    for (let i = 0; i < 40; i++) summonCloud(world, 'rain', { x: 2 + i % 8 * 5, y: 2 + Math.floor(i / 8) * 5 });
    expect(clouds(world)).toHaveLength(CLOUDS.limit);
    const save = world.snapshot(), state = cloudState(world)!;
    for (const patch of [{ dropIn: -1 }, { speed: 100 }, { remaining: 61 }, { seed: NaN }]) {
      const broken = { ...state, clouds: [{ ...state.clouds[0], ...patch }] };
      expect(() => decodeSave({ ...save, scenarios: [{ id: CLOUDS.id, state: broken }] }, world.registry)).toThrow();
    }
    expect(() => decodeSave({ ...save, scenarios: [{ id: CLOUDS.id, state: { ...state, clouds: [state.clouds[0], state.clouds[0]] } }] }, world.registry)).toThrow();
  });
});
