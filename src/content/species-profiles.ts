import { RACES } from '../core/races';
import { CREATURE_PROFILES, type ResourceBundle } from '../core/resources';
import type { StatValues } from '../core/unit-stats';
import type { ChromosomeSize } from './genes';
import type { GenomeBudget } from './species-reference';

export const DROP_RULES = Object.freeze({ childMass: 0.4, maximum: 30, minimum: 1, rounding: 'floor-multiplier' as const,
  defaultMassPerDrop: 50, massPerDrop: Object.freeze({ mushrooms: 40, peppers: 40, bone: 100, leather: 100, crystalSalt: 150, stone: 150, gems: 200 }) });
export interface DropProfile { baseMass: number; base: ResourceBundle; rules: typeof DROP_RULES }
export interface SpeciesParameters {
  balance: 'compatibility-v1'; baseStats: Partial<StatValues>; genomeBudget: GenomeBudget | null;
  firstChromosome: ChromosomeSize | null; drops: DropProfile | null; roads?: boolean;
}
/** Keep the project's existing values, including the additive budget introduced by plan 33.
 * Reference budgets are comparison data; substituting them here would silently rebalance the game. */
export function compatibilityParameters(speciesId: string): SpeciesParameters | undefined {
  const race = RACES[speciesId as keyof typeof RACES], body = CREATURE_PROFILES[speciesId];
  if (!race && !body && !['dragon', 'crabzilla', 'ufo', 'boat'].includes(speciesId)) return;
  const baseStats: Partial<StatValues> = race ? { damage: race.damage, attackSpeed: 1 / race.attackInterval, lifespan: race.lifespan,
    construction: 10 / race.construction, recovery: race.recovery * 2, stamina: 100, mana: 20,
    diplomacy: 2, warfare: 2, stewardship: 2, intelligence: 2, mass: body.mass }
    : body ? { damage: speciesId === 'dog' ? 9 : 5, stamina: 100, lifespan: 160, mass: body.mass } : {};
  return { balance: 'compatibility-v1', baseStats, ...(race ? { roads: race.roads } : {}), genomeBudget: body ? { health: 10, stamina: 10, damage: 1 } : null,
    firstChromosome: body ? 'tiny' : null, drops: body ? { baseMass: body.mass, base: { ...body.base }, rules: DROP_RULES } : null };
}
