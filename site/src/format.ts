// Dates and times as the finder writes them, in London time.

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/London' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
export const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
/** `Mon 16 Nov` for a stored time or a plain date. */
export function day(value: string | null): string {
  if (!value) return '–';
  return DAY.format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value)).replace(',', '');
}
export const fullDate = (value: string | null) => (value ? DAY_YEAR.format(new Date(value + 'T12:00:00Z')) : '–');
export const clock = (value: string | null) => (value ? TIME.format(new Date(value)) : '');
