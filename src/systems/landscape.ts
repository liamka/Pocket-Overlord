import type { World } from '../core/world';
import { isDamagedTerrain, LANDSCAPE_RECOVERY_RATE, recoveryDuration, recoveryStage } from '../core/terrain';
import { Terrain } from '../core/types';

/** Only damaged cells age; regrowth follows simulation time, including pause and speed. */
export function landscape(world: World): void {
  if (world.tick % 30 === 0) world.terrain.ageRoads();
  if (world.tick % (30 / LANDSCAPE_RECOVERY_RATE) !== 0 || world.terrain.recovery.size === 0) return;
  const terrain = world.terrain, burning = new Set<number>();
  for (const entity of world.query('thermal', 'position')) {
    if (!entity.components.thermal!.burning) continue;
    const p = entity.components.position!;
    terrain.circle(p.x, p.y, 1.5, (_x, _y, i) => burning.add(i));
  }
  for (const [i, state] of terrain.recovery) {
    const tile = terrain.tiles[i];
    if (!isDamagedTerrain(tile)) { terrain.recovery.delete(i); continue; }
    const previousStage = recoveryStage(tile, state.age);
    state.age = burning.has(i) ? 0 : state.age + 1;
    const x = i % terrain.width, y = Math.floor(i / terrain.width);
    if (state.age >= recoveryDuration(tile, x, y, world.seed)) {
      terrain.set(x, y, tile === Terrain.Crater ? Terrain.Scorched : state.target);
    } else if (previousStage !== recoveryStage(tile, state.age)) terrain.dirty.add(i);
  }
}
