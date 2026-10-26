import { leatherRemainsFire } from '../core/leather';
import { record } from '../core/validation';
import { wornOutLeather } from '../core/equipment-catalog';
import { calculateStats } from '../core/unit-stats';
import type { WorldSnapshot } from '../core/types';
import type { Registry } from '../content/registry';
import { validSubspeciesSave } from './subspecies';

/** Adopt fire and exhausted-item effects; never seed leather, recreate corpses or repair items. */
export function migrateLeather(save: Record<string, unknown>, registry: Registry): Record<string, unknown> {
  if (Array.isArray(save.entities)) for (const e of save.entities) {
    if (!record(e) || !record(e.components) || !record(e.components.resourcePile)) continue;
    const c = e.components, pile = c.resourcePile as Record<string, unknown>;
    const fire = leatherRemainsFire(record(pile.goods) ? Number(pile.goods.leather ?? 0) : 0);
    c.thermal ??= fire.thermal; c.combustible ??= fire.combustible;
  }
  const snapshot = save as unknown as WorldSnapshot;
  const items = snapshot.equipment?.items;
  if (Array.isArray(items) && items.some(i => i && wornOutLeather(i) && i.location?.kind === 'equipped')) {
    if (!validSubspeciesSave(snapshot, registry)) throw new Error('Invalid leather migration');
    for (const e of snapshot.entities) {
      const worn = items.filter(i => i.location.kind === 'equipped' && i.location.entityId === e.id);
      if (!worn.some(wornOutLeather) || !e.components.health) continue;
      // Old zero-condition items still contributed bonuses. Adopt the new maximum without healing.
      const health = e.components.health;
      health.max = calculateStats(e, worn).values.health; health.current = Math.min(health.current, health.max);
    }
  }
  return { ...save, version: 59 };
}
