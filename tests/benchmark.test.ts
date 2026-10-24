import { expect, it } from 'vitest';
import { World } from '../src/core/world';
import { Terrain } from '../src/core/types';
import { applyEvent } from '../src/systems/effects';
import { flatWorld } from './helpers';

it('measures a 300-person world with houses, fires and a sequence of blasts', () => {
  const source = flatWorld(), data = source.snapshot();
  data.seed = data.rngState = 4831;
  data.terrain = { width: 160, height: 112, tiles: Array(160 * 112).fill(Terrain.Grass), moisture: Array(160 * 112).fill(0), recovery: [] };
  const world = new World(data.seed, source.registry, data);
  let spawned = 0;
  for (let y = 15; y < 95 && spawned < 300; y += 2) {
    for (let x = 25; x < 140 && spawned < 300; x += 2) {
      if (!world.canStand({ x, y })) continue;
      const human = world.spawn('core:person', { x, y })!;
      human.components.health = { current: 100000, max: 100000 }; spawned++;
    }
  }
  for (let i = 0; i < 40; i++) world.spawn('core:house', { x: 50 + i % 10 * 4, y: 40 + Math.floor(i / 10) * 5 });
  expect(spawned).toBe(300); expect(world.population).toBe(300); expect(world.houseCount).toBe(40);
  for (const entity of [...world.query('combustible')].filter((_, i) => i % 18 === 0)) applyEvent(world, { kind: 'heat', target: entity.id, amount: 100 });
  const times: number[] = [];
  for (let i = 0; i < 600; i++) {
    if (i % 30 === 0) world.events.push({ kind: 'blast', x: 55 + i % 47, y: 50, radius: 9, power: 150, heat: 100 });
    const start = performance.now(); world.step(); times.push(performance.now() - start);
    world.visuals.length = 0;
  }
  times.sort((a, b) => a - b);
  const average = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(JSON.stringify({ scene: '300 people, 40 houses, fire, 20 blasts, 600 steps', population: world.population, entities: world.entities.size, averageMs: +average.toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3), maxMs: +times.at(-1)!.toFixed(3) }));
  expect(world.population).toBe(300);
  expect(world.events.length).toBeLessThan(50000);
}, 30000);
