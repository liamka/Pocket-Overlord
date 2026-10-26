import type { World } from '../core/world';
import { runWorldProcesses } from '../core/world-processes';

/** Runs after fire/geohazards and before route planning; only active cells are queued. */
export function landscape(world: World): void {
  runWorldProcesses(world, 'landscape');
}
