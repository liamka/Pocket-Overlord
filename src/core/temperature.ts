import { monthTicks } from './calendar';
import { validDamageContext, type DamageContext } from './death';
import { integer, number, record } from './validation';

/** Game heat units, never Celsius. These rates and scheduling limits are our balance. */
export const TEMPERATURE = {
  bodyHot: 300, bodyCold: -200, cellMin: -200, cellMax: 404,
  bodyRecoveryTicks: monthTicks(0.03), cellRecoveryTicks: monthTicks(0.1),
  buckets: 256, immediateCells: 256, rainCooling: 12, surfaceShock: 50, brushBody: 5, brushCell: 3,
  freezeCell: -5, lavaDamage: 48,
} as const;
export const THERMAL_REASONS = ['heated', 'cooled', 'ignited', 'frozen', 'fireproof', 'frostproof', 'wet', 'no-fuel', 'status-blocked', 'thawed', 'evaporated', 'scorched', 'sand', 'lava', 'solidified', 'detonated'] as const;
export type ThermalReason = typeof THERMAL_REASONS[number];
export interface ThermalChange { reason: ThermalReason; tick: number; source?: DamageContext }
export const approachZero = (value: number, amount: number): number => Math.sign(value) * Math.max(0, Math.abs(value) - amount);
export const cellHeatBand = (value: number): number => value > 160 ? 6 : value > 100 ? 5 : value > 30 ? 4 : value > 20 ? 3 : value > 10 ? 2 : value > 5 ? 1 : 0;
export const lavaStageAt = (value: number): 1 | 2 | 3 | 4 => value > 30 ? 4 : value > 20 ? 3 : value > 10 ? 2 : 1;
export const validThermalChange = (v: unknown): boolean => v === undefined || record(v) && integer(v.tick)
  && THERMAL_REASONS.includes(v.reason as ThermalReason) && (v.source === undefined || validDamageContext(v.source, true));
export const validTileTemperature = (v: { temperature?: unknown; thermalAt?: unknown; thermalBand?: unknown; heatSource?: unknown; thermalChange?: unknown; lavaStage?: unknown; thermalFrost?: unknown; frost?: unknown }): boolean =>
  (v.temperature === undefined || number(v.temperature, TEMPERATURE.cellMin, TEMPERATURE.cellMax))
  && (v.thermalAt === undefined || integer(v.thermalAt)) && (v.thermalBand === undefined || integer(v.thermalBand, 0, 6))
  && (v.heatSource === undefined || validDamageContext(v.heatSource, true)) && validThermalChange(v.thermalChange)
  && (v.lavaStage === undefined || integer(v.lavaStage, 1, 4))
  && (v.thermalFrost === undefined || v.thermalFrost === true && !!v.frost);
export const thermalReasonLabel: Record<ThermalReason, string> = {
  heated: 'Heat is accumulating', cooled: 'Cold is accumulating', ignited: 'Ignition threshold reached', frozen: 'Freezing threshold reached',
  fireproof: 'Fire resistance prevented ignition', frostproof: 'Frost resistance prevented freezing', wet: 'Water cooled the heat',
  'no-fuel': 'No fuel to ignite', 'status-blocked': 'Another condition prevented the effect', thawed: 'Heat melted the frost',
  evaporated: 'Heat evaporated the water', scorched: 'Heat burned away the biome', sand: 'Heat turned soil into sand',
  lava: 'Heat melted the ground', solidified: 'Lava cooled and solidified', detonated: 'Heat detonated the upper layer',
};
