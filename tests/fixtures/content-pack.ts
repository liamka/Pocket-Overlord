import type { ContentPack, PixelSprite } from '../../src/content/registry';
import { integer, number, record } from '../../src/core/validation';

// This module extends the engine without editing its types, validators or dispatchers.
declare module '../../src/core/types' {
  interface ComponentMap { 'test:charge': { value: number } }
  interface GameEventMap { 'test:charge': { target: number; amount: number } }
}
const sprite: PixelSprite = { pixels: ['aa', 'aa'], palette: { a: '#ed78c6' }, anchor: { x: 1, y: 2 } };
export const testContent: ContentPack = {
  id: 'test:content',
  install(registry) {
    registry.registerComponent('test:charge', v => number(v.value, 0, 10000));
    registry.registerEntity({ id: 'test:lantern', sprite,
      required: ['position', 'health', 'combustible', 'thermal', 'test:charge'],
      create: position => ({ position: { ...position }, health: { current: 100, max: 100 }, combustible: { fuel: 50, ignition: 25 },
        thermal: { temperature: 0, wetness: 0, burning: false }, 'test:charge': { value: 0 } }),
    });
    registry.registerTool({ id: 'test:lantern', label: 'Test lantern', hint: 'Test content', radius: 1, color: '#ed78c6', icon: sprite, category: 'nature',
      apply: (world, p) => { world.spawn('test:lantern', p); },
    });
    registry.registerEvent({ kind: 'test:charge', validate: v => integer(v.target, 1) && number(v.amount, 0, 100),
      apply: (world, event) => {
        const charge = world.entities.get(event.target)?.components['test:charge'];
        if (charge) charge.value += event.amount;
      },
    });
    registry.registerSystem({ id: 'test:charging', after: ['core:fire'], before: ['core:landscape'], update: (world, dt) => {
      for (const entity of world.query('test:charge')) entity.components['test:charge']!.value += dt;
    } });
    registry.registerScenario({ id: 'test:lantern-rain',
      create: world => ({ nextTick: world.tick + 15, remaining: 3 }),
      validate: (v): v is { nextTick: number; remaining: number } => record(v) && integer(v.nextTick) && integer(v.remaining, 1, 3),
      update: (world, state) => {
        if (world.tick < state.nextTick) return;
        const p = { x: world.rng.range(10, 30), y: world.rng.range(10, 30) };
        const entity = world.spawn('test:lantern', p);
        if (entity) world.events.push({ kind: 'test:charge', target: entity.id, amount: 2 });
        world.addRain(p, 2, 0.3);
        state.nextTick += 15;
        if (--state.remaining === 0) return 'complete';
      },
    });
  },
};

