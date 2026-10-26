import type { World } from '../core/world';
import { cleanTreeClaim } from '../core/forestry';
import { runWorldProcesses } from '../core/world-processes';

export function forestry(world: World): void {
  if (world.paused) return;
  // Claims, fire damage and submerged sources remain live even when growth is disabled.
  if (world.tick % 30 === 0) for (const entity of world.query('tree', 'position')) {
    const t = entity.components.tree!, p = entity.components.position!;
    if (!world.terrain.isLand(p.x, p.y)) { world.remove(entity.id); continue; }
    cleanTreeClaim(world, entity);
    if (entity.components.thermal?.burning) {
      t.remaining = Math.min(t.remaining, Math.max(0, Math.floor(5 * (entity.components.combustible?.fuel ?? 0) / 45)));
      continue;
    }
  }
  runWorldProcesses(world, 'resources');
}
