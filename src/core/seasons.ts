import { calendarAt, MONTHS_PER_SEASON, SEASON_TICKS } from './calendar';
export { SEASON_TICKS } from './calendar';
export const SEASONS = [
  { id: 'spring', label: 'Spring', growth: 1, yield: 8, appetite: 1 },
  { id: 'summer', label: 'Summer', growth: 1.25, yield: 8, appetite: 1 },
  { id: 'autumn', label: 'Autumn', growth: 1, yield: 12, appetite: 1 },
  { id: 'winter', label: 'Winter', growth: 0, yield: 0, appetite: 1.2 },
] as const;

/** The saved simulation tick is the calendar: pause, speed and reload cannot desynchronize it. */
export const seasonAt = (tick: number): typeof SEASONS[number] => SEASONS[Math.floor((calendarAt(tick).month - 1) / MONTHS_PER_SEASON)];
export const yearAt = (tick: number): number => calendarAt(tick).year;

/** Keep winter meals at home; caravans may only carry the surplus. */
export function foodReserve(tick: number, residents: number): number {
  const season = seasonAt(tick);
  const remaining = (SEASON_TICKS - tick % SEASON_TICKS) / 30;
  const meals = season.id === 'autumn' ? 2.5 : season.id === 'winter' ? remaining * 1.1 * season.appetite / 45 + 0.5 : 2;
  return Math.max(8, Math.ceil(residents * meals));
}
