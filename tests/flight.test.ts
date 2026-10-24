import { describe, expect, it } from 'vitest';
import { World } from '../src/core/world';
import { LEGACY_ROCKET_HEADING, rocketPose } from '../src/core/flight';
import { NAPALM, napalmStrikes } from '../src/content/napalm';
import { decodeSave } from '../src/persistence/schema';
import { advance, flatWorld } from './helpers';

describe('airstrike flight directions', () => {
  it('chooses varied directions reproducibly and preserves them on reload', () => {
    const world = flatWorld(), other = new World(world.seed, world.registry, world.snapshot());
    const headings = { rocket: new Set<number>(), napalm: new Set<number>() };
    for (let i = 0; i < 16; i++) for (const current of [world, other]) {
      const rocket = current.spawn('core:rocket', { x: 24, y: 24 })!;
      current.command({ kind: 'use-tool', toolId: 'core:napalm', x: 24, y: 24 });
      if (current === world) {
        headings.rocket.add(rocket.components.projectile!.heading!);
        headings.napalm.add(napalmStrikes(world).at(-1)!.heading);
      }
    }
    expect(headings.rocket.size).toBeGreaterThanOrEqual(4); expect(headings.napalm.size).toBeGreaterThanOrEqual(4);
    expect(other.snapshot()).toEqual(world.snapshot());
    expect(decodeSave(JSON.parse(JSON.stringify(world.snapshot())), world.registry)).toEqual(world.snapshot());
  });

  it('rockets approach from every side, retain their path on pause and hit the selected target', () => {
    const source = flatWorld(), data = source.snapshot(), target = { x: 24, y: 24 };
    for (let direction = 0; direction < 8; direction++) {
      const world = new World(source.seed, source.registry, data), rocket = world.spawn('core:rocket', target)!;
      const projectile = rocket.components.projectile!; projectile.heading = direction * Math.PI / 4;
      const start = rocketPose(target, projectile);
      const dot = (start.ground.x - target.x) * Math.cos(projectile.heading) + (start.ground.y - target.y) * Math.sin(projectile.heading);
      expect(dot).toBeCloseTo(-41);
      advance(world, 0.6); world.paused = true;
      const pose = rocketPose(target, projectile), saved = decodeSave(world.snapshot(), world.registry);
      advance(world, 1); expect(rocketPose(target, projectile)).toEqual(pose);
      const restored = new World(world.seed, world.registry, saved);
      expect(rocketPose(target, restored.entities.get(rocket.id)!.components.projectile!)).toEqual(pose);
      restored.paused = false; advance(restored, 0.7);
      expect(restored.entities.has(rocket.id)).toBe(false);
      expect(restored.visuals.find(visual => visual.kind === 'blast')).toMatchObject({ ...target, radius: 4.5, style: 'rocket' });
      expect(rocketPose(target, { ...projectile, remaining: 0 })).toMatchObject(target);
    }
  });

  it('rotates the actual napalm strip without changing its length or blast radii', () => {
    const source = flatWorld(), data = source.snapshot();
    for (let direction = 0; direction < 8; direction++) {
      const world = new World(source.seed, source.registry, data);
      world.command({ kind: 'use-tool', toolId: 'core:napalm', x: 24, y: 24 });
      const strike = napalmStrikes(world)[0]; strike.heading = direction * Math.PI / 4;
      advance(world, 2);
      const restored = new World(world.seed, world.registry, decodeSave(world.snapshot(), world.registry));
      advance(world, 1.5); advance(restored, 1.5);
      expect(restored.snapshot()).toEqual(world.snapshot());
      const impacts = world.visuals.filter(visual => visual.kind === 'blast');
      expect(impacts).toHaveLength(NAPALM.count);
      for (const [index, impact] of impacts.entries()) {
        const dx = impact.x - 24, dy = impact.y - 24;
        expect(dx * Math.cos(strike.heading) + dy * Math.sin(strike.heading)).toBeCloseTo((index - 7) * NAPALM.spacing);
        expect(Math.abs(-dx * Math.sin(strike.heading) + dy * Math.cos(strike.heading))).toBeLessThanOrEqual(NAPALM.scatter + 1e-9);
        expect(impact.radius).toBe(NAPALM.radius);
      }
    }
  });

  it('migrates flights already in progress without turning them around', () => {
    const world = flatWorld(); world.spawn('core:rocket', { x: 24, y: 24 });
    world.command({ kind: 'use-tool', toolId: 'core:napalm', x: 24, y: 24 });
    const strike = napalmStrikes(world)[0]; strike.heading = 0; advance(world, 1.5);
    world.spawn('core:rocket', { x: 24, y: 24 });
    const old = world.snapshot(); old.version = 15;
    for (const entity of old.entities) if (entity.components.projectile) delete entity.components.projectile.heading;
    old.scenarios[0].state = { strikes: napalmStrikes(world).map(({ heading: _heading, ...pass }) => pass) };
    const migrated = decodeSave(old, world.registry);
    expect(migrated.entities.find(entity => entity.components.projectile)!.components.projectile!.heading).toBe(LEGACY_ROCKET_HEADING);
    const restored = new World(world.seed, world.registry, migrated);
    expect(napalmStrikes(restored)[0].heading).toBe(0);
    expect(napalmStrikes(restored)[0].bombs).toEqual(napalmStrikes(world)[0].bombs);
  });

  it('rejects invalid saved headings', () => {
    const world = flatWorld(); world.spawn('core:rocket', { x: 24, y: 24 });
    world.command({ kind: 'use-tool', toolId: 'core:napalm', x: 24, y: 24 });
    for (const heading of [NaN, -1, 9]) {
      const rocket = world.snapshot(); rocket.entities[0].components.projectile!.heading = heading;
      expect(() => decodeSave(rocket, world.registry)).toThrow();
      const napalm = world.snapshot(); napalm.scenarios[0].state = { strikes: [{ ...napalmStrikes(world)[0], heading }] };
      expect(() => decodeSave(napalm, world.registry)).toThrow();
    }
  });
});
