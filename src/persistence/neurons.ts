import { NEURON_BY_ID } from '../content/neurons';
import { NEURON_REASONS } from '../core/neurons';
import { integer, record } from '../core/validation';
import type { WorldSnapshot } from '../core/types';

const known = (id: string): boolean => NEURON_BY_ID.has(id);
const reason = (v: unknown): boolean => NEURON_REASONS.some(r => r === v);
export function validNeurons(value: unknown): boolean {
  if (value === undefined) return true; // Optional extension: older saves retain their exact RNG and resources.
  if (!record(value) || !Array.isArray(value.disabled) || value.disabled.length > NEURON_BY_ID.size
    || !value.disabled.every(id => typeof id === 'string' && known(id)) || new Set(value.disabled).size !== value.disabled.length
    || !integer(value.nextDecisionAt) || value.sleepingUntil !== undefined && !integer(value.sleepingUntil)
    || value.playerControlled !== undefined && typeof value.playerControlled !== 'boolean') return false;
  for (const table of [value.cooldowns, value.retries]) {
    if (!record(table) || Object.keys(table).length > NEURON_BY_ID.size || !Object.entries(table).every(([id, tick]) => known(id) && integer(tick))) return false;
  }
  if (value.observations !== undefined && (!record(value.observations) || Object.keys(value.observations).length > NEURON_BY_ID.size
    || !Object.entries(value.observations).every(([id, r]) => known(id) && reason(r)))) return false;
  return value.last === undefined || record(value.last) && (value.last.id === null || typeof value.last.id === 'string' && known(value.last.id))
    && integer(value.last.tick) && reason(value.last.reason);
}
export function validNeuronSave(save: WorldSnapshot): boolean {
  return save.entities.every(entity => {
    const n = entity.components.citizen?.neurons;
    if (!n) return true;
    return validNeurons(n) && n.nextDecisionAt <= save.tick + 30 && (n.last?.tick ?? 0) <= save.tick
      && (n.sleepingUntil ?? 0) <= save.tick + 150
      && Object.entries(n.cooldowns).every(([id, tick]) => tick <= save.tick + NEURON_BY_ID.get(id)!.cooldown * 30)
      && Object.values(n.retries).every(tick => tick <= save.tick + 150);
  });
}
