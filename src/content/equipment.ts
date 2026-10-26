import type { Registry } from './registry';
import type { CombatState } from '../core/equipment';
import { HIT_STATUSES, NATURAL_ATTACKS } from '../core/equipment-catalog';
import { number, record } from '../core/validation';
import { equipmentSystem } from '../systems/equipment';

declare module '../core/types' { interface ComponentMap { combat: CombatState; naturalAttack: { kind: string } } }
export function registerEquipment(registry: Registry): void {
  registry.registerComponent('combat', c => number(c.baseHealth, 0.001, 1e6) && Array.isArray(c.immunities)
    && c.immunities.length <= HIT_STATUSES.length && new Set(c.immunities).size === c.immunities.length && c.immunities.every(s => HIT_STATUSES.includes(s as typeof HIT_STATUSES[number]))
    && record(c.statuses) && Object.entries(c.statuses).every(([s, duration]) => HIT_STATUSES.includes(s as typeof HIT_STATUSES[number]) && number(duration, 0, 10)));
  registry.registerComponent('naturalAttack', n => typeof n.kind === 'string' && Object.hasOwn(NATURAL_ATTACKS, n.kind));
  registry.registerSystem({ id: 'core:equipment', after: ['core:ferries'], before: ['core:emergencies'], update: equipmentSystem });
}
