import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { CATACLYSMS, TORNADO, GRAVITY, cataclysms, liftedIds, gravityCaptivePose } from '../src/core/cataclysms';
import { Terrain } from '../src/core/types';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld } from './helpers';

const use = (world: World, id: string, x = 24, y = 24) => world.command({ kind: 'use-tool', toolId: id, x, y });
function residents(world: World, count = 12, x = 24, y = 24) {
  return Array.from({ length: count }, (_, i) => {
    const a = i * Math.PI * 2 / count;
    const entity = world.spawn('core:person', { x: x + Math.cos(a) * 4, y: y + Math.sin(a) * 4 })!;
    entity.components.person!.buildIn = entity.components.person!.reproduceIn = 10000;
    return entity;
  });
}

describe('blood tornado', () => {
  it('lifts residents, roams without pointer input, destroys scenery and dissolves into blood rain', () => {
    const world = flatWorld(), people = residents(world);
    const tree = world.spawn('core:tree', { x: 24, y: 24 })!, house = world.spawn('core:house', { x: 25, y: 24 })!;
    use(world, TORNADO.id); advance(world, 0.9);
    expect(liftedIds(world).size).toBe(people.length); expect(world.population).toBe(people.length);
    expect(world.entities.has(tree.id)).toBe(false);
    advance(world, 0.6);
    const t = cataclysms(world)!.tornadoes[0];
    expect(Math.hypot(t.x - 24, t.y - 24)).toBeGreaterThan(1);
    expect(t.captives.some(c => world.entities.get(c.id)!.components.position!.x !== c.x)).toBe(true);
    expect(world.entities.has(house.id)).toBe(false);
    advance(world, 1.8);
    expect(world.population).toBe(0); expect(liftedIds(world).size).toBe(0);
    expect(cataclysms(world)!.stains.length).toBeGreaterThanOrEqual(people.length);
    expect(cataclysms(world)!.bursts.some(b => b.z > 0 && b.kind === 'blood')).toBe(true);
    advance(world, TORNADO.life - t.age + 1);
    expect(t.released).toBe(TORNADO.life);
    expect(cataclysms(world)!.stains.length).toBeGreaterThan(people.length);
    advance(world, 30); expect(cataclysms(world)).toBeUndefined();
  });

  it('ignores aiming and mouse release throughout its autonomous lifetime', () => {
    const world = flatWorld(); residents(world);
    use(world, TORNADO.id); world.command({ kind: 'release-tool', toolId: TORNADO.id });
    advance(world, 1);
    expect(liftedIds(world).size).toBe(12);
    const saved = world.snapshot();
    world.command({ kind: 'aim-tool', toolId: TORNADO.id, x: 47, y: 0 });
    world.command({ kind: 'release-tool', toolId: TORNADO.id });
    expect(world.snapshot()).toEqual(saved);
    advance(world, 4);
    expect(cataclysms(world)!.tornadoes[0].released).toBeNull(); expect(world.population).toBe(0);
    advance(world, TORNADO.life + TORNADO.collapse + TORNADO.rain - 5 + 0.1);
    expect(cataclysms(world)!.tornadoes).toHaveLength(0);
  });

  it('continues the same autonomous path when loading resets held tools', () => {
    const world = flatWorld(); residents(world); use(world, TORNADO.id); advance(world, 1);
    const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
    for (const tool of restored.registry.tools.values()) tool.release?.(restored);
    advance(world, 6); advance(restored, 6);
    expect(restored.snapshot()).toEqual(world.snapshot());
    expect(liftedIds(restored).size).toBe(0); expect(cataclysms(restored)!.tornadoes[0].released).toBeNull();
  });
});

describe('gravity clap', () => {
  it('holds people alive during anticipation, pulls them in, then kills them at contact and sends a damaging wave', () => {
    const world = flatWorld(), people = residents(world);
    const house = world.spawn('core:house', { x: 28, y: 24 })!;
    const outside = world.spawn('core:tree', { x: 36, y: 24 })!;
    use(world, GRAVITY.id); advance(world, 0.6);
    expect(world.population).toBe(people.length);
    const g = cataclysms(world)!.claps[0];
    expect(g.captives).toHaveLength(people.length);
    expect(g.captives.every(c => gravityCaptivePose(g, c).z > 0)).toBe(true);
    advance(world, 1.5);
    expect(world.population).toBe(people.length); expect(g.fired).toBe(false);
    expect(people.every(e => Math.hypot(e.components.position!.x - 24, e.components.position!.y - 24) < 0.1)).toBe(true);
    advance(world, 0.1);
    expect(g.fired).toBe(true); expect(world.population).toBe(0); expect(world.entities.has(house.id)).toBe(true);
    const newArrival = world.spawn('core:tree', { x: 24, y: 24 })!;
    advance(world, 0.3);
    expect(world.entities.has(house.id)).toBe(false);
    expect(world.entities.has(newArrival.id)).toBe(true);
    expect(outside.components.health!.current).toBe(80);
    expect(world.terrain.at(24, 24)).toBe(Terrain.Crater);
  });

  it('does not multiply damage to a survivor following the expanding wave', () => {
    const world = flatWorld(), tree = world.spawn('core:tree', { x: 24, y: 24 })!;
    tree.components.health!.current = tree.components.health!.max = 1000;
    use(world, GRAVITY.id); advance(world, 2.3);
    const health = tree.components.health!.current;
    tree.components.position!.x = 30; world.spatial.update(tree);
    advance(world, 0.5); expect(tree.components.health!.current).toBe(health);
  });
});

describe('cataclysm state', () => {
  it.each([0, 0.6, 1.9, 2.3, 3.7])('freezes and continues exactly after saving overlapping powers at %s seconds', time => {
    const world = flatWorld(); residents(world, 10, 12, 24); residents(world, 10, 36, 24);
    use(world, TORNADO.id, 12, 24); use(world, GRAVITY.id, 36, 24); advance(world, time);
    world.paused = true; const saved = world.snapshot(); advance(world, 1); expect(world.snapshot()).toEqual(saved);
    const restored = new World(world.seed, world.registry, decodeSave(JSON.parse(JSON.stringify(saved)), world.registry));
    expect(restored.snapshot()).toEqual(saved);
    world.paused = restored.paused = false;
    advance(world, 1); advance(restored, 1); expect(restored.snapshot()).toEqual(world.snapshot());
  });

  it('never captures one person twice when powers overlap', () => {
    const world = flatWorld(); residents(world); use(world, TORNADO.id); advance(world, 0.7);
    use(world, GRAVITY.id); advance(world, 0.2);
    expect(cataclysms(world)!.claps[0].captives).toHaveLength(0);
    expect(liftedIds(world).size).toBe(12);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('keeps lifted residents above water and caps stacked effects without invalid saves', () => {
    const world = flatWorld(); world.terrain.tiles.fill(Terrain.Water);
    const person = world.spawn('core:person', { x: 1, y: 1 })!;
    use(world, GRAVITY.id, 1, 1); advance(world, 0.5);
    expect(person.components.health!.current).toBe(person.components.health!.max);
    for (let i = 0; i < 12; i++) { use(world, TORNADO.id, 0, 0); use(world, GRAVITY.id, 47.9, 47.9); }
    expect(cataclysms(world)!.tornadoes).toHaveLength(TORNADO.limit);
    expect(cataclysms(world)!.claps).toHaveLength(GRAVITY.limit);
    for (let i = 0; i < 35; i++) {
      advance(world, 0.1); expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
      for (const t of cataclysms(world)!.tornadoes) {
        expect(t.x).toBeGreaterThanOrEqual(0); expect(t.x).toBeLessThan(world.terrain.width);
        expect(t.y).toBeGreaterThanOrEqual(0); expect(t.y).toBeLessThan(world.terrain.height);
      }
    }
    expect(cataclysms(world)!.tornadoes.every(t => Math.hypot(t.x, t.y) > 2)).toBe(true);
    expect(world.terrain.tiles.every(tile => tile === Terrain.Water)).toBe(true);
    advance(world, 30); expect(cataclysms(world)).toBeUndefined();
  });

  it('keeps the maximum captured population and blood effects inside the save budget', () => {
    const world = flatWorld(); residents(world, 300); use(world, GRAVITY.id); advance(world, 0.1);
    expect(liftedIds(world).size).toBe(CATACLYSMS.captives);
    advance(world, 2.2);
    expect(cataclysms(world)!.bursts.length).toBeLessThanOrEqual(CATACLYSMS.bursts);
    expect(cataclysms(world)!.stains.length).toBeLessThanOrEqual(CATACLYSMS.stains);
    expect(() => decodeSave(world.snapshot(), world.registry)).not.toThrow();
  });

  it('rejects invalid phases, duplicate captives and unbounded particle arrays', () => {
    const world = flatWorld(); residents(world); use(world, GRAVITY.id); advance(world, 0.5);
    const corruptions = [
      (s: ReturnType<typeof cataclysms>) => { s!.claps[0].fired = true; },
      (s: ReturnType<typeof cataclysms>) => { s!.claps[0].captives.push(s!.claps[0].captives[0]); },
      (s: ReturnType<typeof cataclysms>) => { s!.claps[0].age = NaN; },
      (s: ReturnType<typeof cataclysms>) => { s!.stains = Array(161).fill({ x: 1, y: 1, age: 0, seed: 1, size: 1 }); },
    ];
    for (const corrupt of corruptions) {
      const broken = new World(world.seed, world.registry, world.snapshot()); corrupt(cataclysms(broken));
      expect(() => decodeSave(broken.snapshot(), world.registry)).toThrow();
    }
  });
});
