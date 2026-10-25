import type { Entity } from './types';

export const STONE = {
  deposit: 24, batch: 4,
  houseCost: 8, houseWood: 2, houseCapacity: 7, houseHealth: 120,
  axeCost: 2, axeWood: 1, axeDamage: 4,
} as const;

export const weaponBonus = (entity: Entity): number => entity.components.citizen?.weapon === 'stone-axe' ? STONE.axeDamage : 0;
