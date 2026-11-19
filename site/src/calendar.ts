// A calendar file for one showing, made in the browser.
import type { ShowingDetail } from './queries';
import { formats } from './tags';

const stamp = (moment: Date) => moment.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const escape = (text: string) => text.replace(/[;,\\]/g, '\\$&').replace(/\r?\n/g, '\\n');

/** The film itself, not the adverts: the chain's film start, else 25 minutes after the advertised time. */
export function ics(show: ShowingDetail, now = new Date()): string {
  const start = show.filmStartsAt
    ? new Date(show.filmStartsAt)
    : new Date(new Date(show.startsAt).getTime() + 25 * 60000);
  const end = show.filmEndsAt
    ? new Date(show.filmEndsAt)
    : new Date(start.getTime() + (show.runtime ?? 120) * 60000);
  const address = [show.address.line1, show.address.line2, show.address.city].filter(Boolean).join(', ');
  const details = [
    `Doors ${show.time}`,
    show.screen,
    show.capacity ? `${show.capacity} seats` : '',
    formats(show.experiences, ['Picture', 'Language', 'Events']),
  ].filter(Boolean);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//showtimes//EN',
    'BEGIN:VEVENT',
    `UID:${show.cinemaId}.${show.id}@showtimes`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escape(`${show.title} · ${show.cinema}`)}`,
    `LOCATION:${escape(`${show.cinema}${address ? ', ' + address : ''}`)}`,
    `DESCRIPTION:${escape(details.join(' · '))}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
