import { hasTrait } from './traits';
import { canFeel, happinessValue } from './happiness';
import { applyStatus } from './status-effects';
import { taskLifecycle, type TaskContext } from './behaviour';
import { aboardFerry } from './ferries';
import type { Entity } from './types';
import type { World } from './world';
import { decisionBlock } from './neurons';
import { hasPhysiology } from './physiology';

export type ReflectionAction = 'wait' | 'happy_laughing' | 'crying' | 'singing' | 'play_jump' | 'play_spin' | 'play_dance' | 'tantrum';
export interface ReflectionInput {
  happiness: number;
  superPositivity?: boolean;
  strongMinded?: boolean;
  aggressive?: boolean;
}
/** Only executable expressions enter the pool; values use the absolute -100..100 scale. */
export function reflectionChoices(input: ReflectionInput): readonly { action: ReflectionAction; weight: number }[] {
  if (!Number.isFinite(input.happiness) || input.happiness < -100 || input.happiness > 100) return [];
  if (input.superPositivity) return [{ action: 'happy_laughing', weight: 43 }, { action: 'singing', weight: 14 },
    { action: 'play_jump', weight: 14 }, { action: 'play_spin', weight: 14 }, { action: 'play_dance', weight: 14 }];
  if (input.aggressive && input.happiness < 0) return [{ action: 'tantrum', weight: 3 }, { action: 'wait', weight: 1 }];
  if (input.happiness > 20) return [{ action: 'happy_laughing', weight: 3 }, { action: 'wait', weight: 1 }];
  if (input.happiness < -40 && !input.strongMinded) return [{ action: 'crying', weight: input.happiness === -100 ? 5 : 2 }, { action: 'wait', weight: 1 }];
  return [{ action: 'wait', weight: 1 }];
}

export function canReflect({ world, entity }: Pick<TaskContext, 'world' | 'entity'>): boolean {
  const c = entity.components.citizen, p = entity.components.position;
  return canFeel(world.registry, entity) && world.entities.get(entity.id) === entity && !decisionBlock(world, entity) && !!c && !!p && c.familyActionAt !== world.tick && c.task === 'idle' && c.hunger < 55
    && !c.emergency && !c.work?.cargo && !entity.components.thermal?.burning && !entity.components.person?.madness
    && (entity.components.health?.current ?? 0) > 0 && world.terrain.isLand(p.x, p.y) && !aboardFerry(world, entity.id);
}

export function startReflection(world: World, entity: Entity, input?: ReflectionInput): boolean {
  const c = entity.components.citizen;
  if (world.paused || !c || !canReflect({ world, entity }) || world.tick < (c.reflectionAfter ?? entity.id % 60 * 30)
    || c.behaviour?.status === 'active' || c.behaviour?.status === 'suspended') return false;
  const happiness = happinessValue(world, entity) ?? 0;
  const pool = reflectionChoices(input ?? { happiness, strongMinded: hasTrait(entity, 'strong-minded'),
    superPositivity: hasPhysiology(entity, 'super-positivity'), aggressive: hasPhysiology(entity, 'aggressive') });
  if (!pool.length) return false;
  let roll = world.rng.range(0, pool.reduce((sum, entry) => sum + entry.weight, 0));
  const chosen = pool.find(entry => (roll -= entry.weight) < 0) ?? pool[pool.length - 1];
  if (c.behaviour?.taskId === 'reflection') delete c.behaviour;
  if (!taskLifecycle.start(world, entity, 'reflection', chosen.action)) return false;
  c.path = []; c.targetId = null;
  const duration = chosen.action === 'crying' ? 3 : chosen.action === 'happy_laughing' ? 2 : world.rng.range(1, 5);
  c.behaviour!.retryAt = world.tick + Math.round(duration * 30);
  if (chosen.action !== 'wait') applyStatus(world, entity,
    chosen.action === 'crying' ? 'crying' : chosen.action === 'singing' ? 'singing' : chosen.action === 'tantrum' ? 'tantrum' : 'laughing', { seconds: duration });
  c.reflectionAfter = world.tick + 1800;
  return true;
}

/** Birth is one settlement transaction; no worker or second executor may also act in this tick. */
export function canPerformFamilyAction(world: World, entity: Entity): boolean {
  const c = entity.components.citizen;
  return !!c && !decisionBlock(world, entity) && c.task !== 'build' && c.task !== 'work' && c.task !== 'deliver' && c.task !== 'fight' && c.task !== 'migrate'
    && !c.emergency && !entity.components.thermal?.burning && !aboardFerry(world, entity.id)
    && c.behaviour?.status !== 'active' && c.behaviour?.status !== 'suspended';
}
