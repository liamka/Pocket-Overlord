import { NEURONS, NEURON_BY_ID, type NeuronDefinition } from '../content/neurons';
import { hasStatus, statusStops } from './status-effects';
import { cancelBehaviour } from './behaviour';
import { releaseJob } from './jobs';
import type { Entity } from './types';
import type { World } from './world';

export const NEURON_REASONS = ['Ready to act', 'Disabled by you', 'This intention is unavailable', 'Waiting before another attempt',
  'Sleeping', 'Stunned', 'Controlled by you', 'Responding to danger', 'Already carrying out an action', 'Not hungry',
  'No suitable food', 'No settlement', 'Adults only', 'No home', 'Already has a home', 'No cargo to deliver',
  'No danger nearby', 'Not ready to rest', 'No suitable work or reachable target', 'No route to the target',
  'Action started', 'No available intention', 'Other intentions took priority', 'Continuing the current action',
  'Looking again soon'] as const;
export type NeuronReason = typeof NEURON_REASONS[number];
export interface NeuronState {
  disabled: string[];
  cooldowns: Record<string, number>;
  /** Failed attempts have a separate bounded retry, not a successful-action cooldown. */
  retries: Record<string, number>;
  nextDecisionAt: number;
  sleepingUntil?: number;
  playerControlled?: boolean;
  last?: { id: string | null; tick: number; reason: NeuronReason };
  observations?: Record<string, NeuronReason>;
}
export interface NeuronOffer { id: string; reason?: NeuronReason; weight?: number }
export interface NeuronCandidate { definition: NeuronDefinition; weight: number; reason: NeuronReason }
export const newNeurons = (): NeuronState => ({ disabled: [], cooldowns: {}, retries: {}, nextDecisionAt: 0 });
export const neuronsOf = (entity: Entity): NeuronState => entity.components.citizen!.neurons ??= newNeurons();

/** These are decision gates, not traits or a second status-effect system. */
export function decisionBlock(world: World, entity: Entity): NeuronReason | undefined {
  const c = entity.components.citizen, n = c?.neurons;
  if (n?.playerControlled) return 'Controlled by you';
  if (hasStatus(entity, 'sleeping')) return 'Sleeping';
  if (statusStops(entity)) return 'Stunned';
  if ((entity.components.combat?.statuses.stun ?? 0) > 0 || (entity.components.combat?.statuses.ice ?? 0) > 0) return 'Stunned';
  if ((n?.sleepingUntil ?? 0) > world.tick && !c?.emergency && !entity.components.thermal?.burning && (c?.hunger ?? 0) < 70) return 'Sleeping';
}
export function neuronReady(world: World, entity: Entity, id: string): boolean {
  const n = entity.components.citizen?.neurons;
  return !decisionBlock(world, entity) && !n?.disabled.includes(id)
    && world.tick >= Math.max(n?.cooldowns[id] ?? 0, n?.retries[id] ?? 0);
}

/** Pure: no RNG, paths, reservations, lazy initialization or clock updates. */
export function evaluateNeurons(world: World, entity: Entity, offers: readonly NeuronOffer[]): NeuronCandidate[] {
  const n = entity.components.citizen?.neurons, block = decisionBlock(world, entity);
  const byId = new Map(offers.map(o => [o.id, o]));
  return NEURONS.map(definition => {
    const offer = byId.get(definition.id), weight = offer?.weight ?? definition.weight;
    const reason = n?.disabled.includes(definition.id) ? 'Disabled by you'
      : definition.support === 'unavailable' || !offer ? 'This intention is unavailable'
      : block ?? (world.tick < Math.max(n?.cooldowns[definition.id] ?? 0, n?.retries[definition.id] ?? 0) ? 'Waiting before another attempt'
        : !Number.isFinite(weight) ? 'This intention is unavailable' : offer.reason ?? 'Ready to act');
    return { definition, weight, reason };
  });
}

/** Subtract the maximum before exp: even Number.MAX_VALUE stays finite. */
export function chooseNeuron(candidates: readonly NeuronCandidate[], layerRoll: number, weightRoll: number): NeuronCandidate | undefined {
  const ready = candidates.filter(c => c.reason === 'Ready to act' && Number.isFinite(c.weight));
  if (!ready.length) return;
  const priority = Math.max(...ready.map(c => c.definition.priority));
  const pool = layerRoll < 0.8 ? ready.filter(c => c.definition.priority === priority) : ready;
  const max = Math.max(...pool.map(c => c.weight));
  const weights = pool.map(c => Math.exp(c.weight - max));
  let roll = weightRoll * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((roll -= weights[i]) < 0) return pool[i];
  return pool[pool.length - 1];
}

/** Only a confirmed attempt changes the saved clock. No target references are duplicated here. */
export function recordNeuronAttempt(world: World, entity: Entity, id: string, success: boolean, reason?: NeuronReason): void {
  const definition = NEURON_BY_ID.get(id);
  if (!definition || world.paused) return;
  const n = neuronsOf(entity);
  if (success || definition.cooldownEvent === 'attempted') n.cooldowns[id] = world.tick + definition.cooldown * 30;
  if (!success) n.retries[id] = world.tick + Math.min(150, definition.cooldown * 30);
  n.last = { id, tick: world.tick, reason: reason ?? (success ? 'Action started' : 'No suitable work or reachable target') };
}

export function commitNeuron(world: World, entity: Entity, offers: readonly NeuronOffer[], start: (id: string) => boolean): boolean {
  if (world.paused || world.entities.get(entity.id) !== entity || !entity.components.citizen || decisionBlock(world, entity)) return false;
  const n = neuronsOf(entity);
  if (world.tick < n.nextDecisionAt) return false;
  const candidates = evaluateNeurons(world, entity, offers);
  n.observations = Object.fromEntries(candidates.filter(c => offers.some(o => o.id === c.definition.id)).map(c => [c.definition.id, c.reason]));
  n.nextDecisionAt = world.tick + 30;
  if (!candidates.some(c => c.reason === 'Ready to act')) {
    n.last = { id: null, tick: world.tick, reason: 'No available intention' }; return false;
  }
  const chosen = chooseNeuron(candidates, world.rng.next(), world.rng.next())!;
  for (const c of candidates) if (n.observations[c.definition.id] === 'Ready to act') n.observations[c.definition.id] = 'Other intentions took priority';
  const success = start(chosen.definition.id);
  recordNeuronAttempt(world, entity, chosen.definition.id, success);
  n.observations[chosen.definition.id] = n.last!.reason;
  return success;
}

export function setNeuronEnabled(world: World, entity: Entity, id: string, enabled: boolean): boolean {
  if (world.entities.get(entity.id) !== entity || !entity.components.citizen || NEURON_BY_ID.get(id)?.support !== 'adapted') return false;
  const n = neuronsOf(entity);
  if (enabled) n.disabled = n.disabled.filter(key => key !== id);
  else if (!n.disabled.includes(id)) n.disabled.push(id);
  if (!enabled && n.last?.id === id) {
    cancelBehaviour(world, entity);
    releaseJob(entity);
    const c = entity.components.citizen!;
    c.task = 'idle'; c.targetId = null; c.path = []; c.repair = null;
    if (id === 'run_away' && c.emergency?.kind === 'flee' || id === 'put_out_fire' && c.emergency?.kind === 'extinguish') delete c.emergency;
    delete n.sleepingUntil;
  }
  n.nextDecisionAt = world.tick; entity.components.citizen!.reconsiderIn = 0;
  return true;
}
