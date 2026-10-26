import { calendarAt, MONTHS } from '../core/calendar';
import { translate, type Language } from '../i18n';

/** Presentation only: never store a translated date or advance simulation time here. */
export function calendarDate(tick: number, language: Language, includeYear = true): string {
  const date = calendarAt(tick);
  return translate(includeYear ? 'calendar:date' : 'calendar:day-month', language, {
    ...date, month: translate(MONTHS[date.month - 1], language),
  });
}
