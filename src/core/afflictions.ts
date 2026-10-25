import type { Entity } from './types';

export const PLAGUE = { id: 'core:plague', brush: 4.5, incubation: 2.5, contact: 2.4, interval: 0.8 } as const;
export const MADNESS = { id: 'core:madness', brush: 4.5, sight: 12, reach: 1.5 } as const;

export function plagueSeverity(entity: Entity): number {
  const plague = entity.components.person?.plague;
  return plague ? Math.max(0, Math.min(1, (plague.age - PLAGUE.incubation) / 10)) : 0;
}
