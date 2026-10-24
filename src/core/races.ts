import type { Entity } from './types';

export const RACE_IDS = ['human', 'elf', 'orc', 'dwarf'] as const;
export type RaceId = typeof RACE_IDS[number];
export const isRace = (value: unknown): value is RaceId => RACE_IDS.some(id => id === value);

/** Relative to the existing human simulation; these are Pocket World's balance values. */
export const RACES = {
  human: { entityId: 'core:person', label: 'Human', health: 70, speed: 1.7, lifespan: 85, damage: 12, attackInterval: 1.2, recovery: 0.25, construction: 1, houseHealth: 180 },
  elf: { entityId: 'core:elf', label: 'Elf', health: 60, speed: 2.05, lifespan: 150, damage: 10, attackInterval: 1, recovery: 0.25, construction: 1, houseHealth: 150 },
  orc: { entityId: 'core:orc', label: 'Orc', health: 100, speed: 1.55, lifespan: 65, damage: 18, attackInterval: 1.5, recovery: 0.75, construction: 1.1, houseHealth: 210 },
  dwarf: { entityId: 'core:dwarf', label: 'Dwarf', health: 90, speed: 1.3, lifespan: 120, damage: 14, attackInterval: 1.3, recovery: 0.25, construction: 0.8, houseHealth: 260 },
} as const;

export const raceOf = (entity: Entity): RaceId => entity.components.person?.race ?? entity.components.dwelling?.race ?? 'human';

/** Diplomatic tendencies influence decisions, without forcing permanent wars. */
export function raceAffinity(a: RaceId = 'human', b: RaceId = 'human'): number {
  if (a === b) return 0;
  if (a === 'orc' || b === 'orc') return -24;
  if (a === 'elf' && b === 'dwarf' || a === 'dwarf' && b === 'elf') return -12;
  return 0;
}
