/** Our balance: keep the existing 1800-tick seasons and 7200-tick years. */
export const DAY_TICKS = 20;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_SEASON = 3;
export const MONTHS = [
  'Crabuary', 'Greguary', 'Musch', 'Monolith', 'Meow', 'Joon',
  'Jooly', 'Citrust', 'Septbark', 'Makotober', 'Novembear', 'Endember',
] as const;
export const MONTH_TICKS = DAY_TICKS * DAYS_PER_MONTH;
export const SEASON_TICKS = MONTH_TICKS * MONTHS_PER_SEASON;
export const YEAR_TICKS = MONTH_TICKS * MONTHS.length;

/** Periodic processes share the calendar scale, rounding fractional months up to one tick. */
export const monthTicks = (months: number): number => Math.max(1, Math.round(months * MONTH_TICKS));

/** Tick zero is day 1 of month 1, year 1, including worlds saved before named months. */
export function calendarAt(tick: number): { day: number; month: number; year: number } {
  const days = Math.floor(tick / DAY_TICKS);
  const months = Math.floor(days / DAYS_PER_MONTH);
  return { day: 1 + days % DAYS_PER_MONTH, month: 1 + months % MONTHS.length, year: 1 + Math.floor(months / MONTHS.length) };
}
