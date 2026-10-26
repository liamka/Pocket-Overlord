import type { World } from '../core/world';
import type { Vec2 } from '../core/types';
import { Terrain } from '../core/types';
import { terrainChangeAllowed } from '../core/world-rules';
import { touchesGround } from '../core/capabilities';
import { liftedIds } from '../core/cataclysms';
import { aboardFerry } from '../core/ferries';
import { applyEvent } from './effects';
import { heatCell } from './temperature';
import { TEMPERATURE } from '../core/temperature';
import { geohazards, poolRadius } from '../core/geohazards';

/** One contact trial per simulated second; chance and subsequent fuel consumption are independent. */
export function igniteTile(world: World, point: Vec2): boolean {
  const map = world.terrain, cell = map.cell(point.x, point.y);
  if (world.paused || world.tick % 30 !== 0 || !terrainChangeAllowed(world, 'fire') || cell.burning || !cell.burn.chance) return false;
  return world.rng.next() < cell.burn.chance && map.setLayers(point.x, point.y, { burning: 30 });
}
export function tileEffects(world: World, dt: number): void {
  if (world.paused) return;
  const map = world.terrain, lifted = liftedIds(world);
  map.edit(() => {
    for (const i of map.burning) {
      const x = i % map.width, y = Math.floor(i / map.width), layer = map.layers.get(i)!;
      const rain = world.effects.some(r => Math.hypot(r.x - x - 0.5, r.y - y - 0.5) <= r.radius);
      if (rain) { map.setLayers(x, y, { burning: undefined }); continue; }
      heatCell(world, { x, y }, dt * 4, layer.heatSource);
      layer.burning = Math.max(0, layer.burning! - map.cell(x, y).burn.rate * dt);
      if (layer.burning <= 1e-9) {
        map.setLayers(x, y, { burning: undefined });
        if (layer.top === 'grey-goo' || layer.top === 'wall-wood') map.setLayers(x, y, { top: undefined });
        if (terrainChangeAllowed(world, 'fire')) map.set(x, y, Terrain.Scorched);
      }
    }
  });
  for (const entity of world.query('position', 'health')) {
    if (!touchesGround(world.registry, entity) || lifted.has(entity.id) || aboardFerry(world, entity.id) || entity.components.volcano) continue;
    const p = entity.components.position!, cell = map.cell(p.x, p.y);
    if (cell.lavaStage && !(geohazards(world)?.lava ?? []).some(pool => pool.remaining >= 2 && Math.hypot(pool.x - p.x, pool.y - p.y) < poolRadius(pool))) {
      const source = map.layers.get(map.index(p.x, p.y))?.heatSource;
      applyEvent(world, { kind: 'damage', target: entity.id, amount: TEMPERATURE.lavaDamage * cell.lavaStage / 4 * dt, ...source, cause: 'fire' });
      applyEvent(world, { kind: 'heat', target: entity.id, amount: 100 * cell.lavaStage / 4 * dt, ...source, cause: 'fire' });
    }
    // Other surface hazards use their own cause; a pool and molten ground never stack lava damage.
    if (cell.damagePerSecond && (entity.components.person || entity.components.animal || entity.components.creature)) {
      applyEvent(world, { kind: 'damage', target: entity.id, amount: cell.damagePerSecond * dt, cause: cell.top === 'grey-goo' ? 'acid' : 'divine' });
    }
  }
}
