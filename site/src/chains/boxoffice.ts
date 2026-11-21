// Chains on Webedia's boxoffice platform (Everyman, Showcase): the platform's tag
// codes ("Format.Projection.Laser", "Showtime.Accessibility.Subtitled") read the same
// way for each; a chain adds its name, booking page and how its cinemas are named.
import type { Chain } from './chain';
import { inGreaterLondon } from './london.ts';
import { weekFullUntil } from './week.ts';
import type { TagKind } from '../tags';

// Codes every showing carries, or that only matter to the platform.
const DROP = new Set(['Format.Projection.Digital', 'Auditorium.Comfort.ReservedSeating', 'Auditorium.Experience.Upstairs']);
const NAMED: Record<string, [string, TagKind]> = {
  'Format.Projection.3d': ['3D', 'Picture'],
  'Format.Projection.4k': ['4K', 'Picture'],
  'Format.Projection.Imax': ['IMAX', 'Picture'],
  'Auditorium.Experience.RealD3D': ['RealD 3D', 'Picture'],
  'Auditorium.Experience.PLF': ['Large format', 'Picture'],
  'Auditorium.Experience.InfinityVision': ['Infinity Vision', 'Picture'],
  'Internal.Brand.XPlus': ['XPlus', 'Picture'],
  'Auditorium.Comfort.Recliners': ['Recliner', 'Seating'],
  'Showtime.Accessibility.Subtitled': ['English subtitles', 'Language'],
  'Showtime.Accessibility.ClosedCaption': ['Captioned', 'Language'],
  'Showtime.Accessibility.AudioDescribed': ['Audio Described', 'Accessibility'],
  'Showtime.Accessibility.AudioDescription': ['Audio Described', 'Accessibility'],
  'Showtime.Event.Directorshall': ['Director\'s Hall', 'Events'],
  'Showtime.Event.QandAEvent': ['Q&A', 'Events'],
  'Showtime.Event.QandARecorded': ['Recorded Q&A', 'Events'],
  'Showtime.Experience.QALiveSatellite': ['Live Q&A', 'Events'],
  'Showtime.Experience.LiveSatellite': ['Live', 'Events'],
  'Showtime.Experience.EncoreShow': ['Encore', 'Events'],
  'Showtime.Restriction.KidsFriendly': ['Kids', 'Events'],
};
const KINDS: [string, TagKind][] = [
  ['Format.', 'Picture'],
  ['Auditorium.Experience.', 'Picture'],
  ['Auditorium.Comfort.', 'Seating'],
  ['Localization.Language.', 'Language'],
  ['Showtime.Accessibility.', 'Accessibility'],
];
// Live broadcasts and their recorded encores: theatre, opera, ballet, concerts.
const EVENTS = new Set(['Showtime.Experience.LiveSatellite', 'Showtime.Experience.EncoreShow']);

/** "SensoryFriendly" → "Sensory Friendly", as ODEON names its tags; "35mm" stays. */
const words = (code: string) => code.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());

export function readTag(code: string): { label: string; kind: TagKind } | null {
  if (DROP.has(code) || code.startsWith('Internal.Data.')) return null;
  if (NAMED[code]) return { label: NAMED[code][0], kind: NAMED[code][1] };
  if (code.startsWith('Internal.')) return null;
  const kind = KINDS.find(([prefix]) => code.startsWith(prefix))?.[1] ?? 'Events';
  return { label: words(code.split('.').pop()!), kind };
}

export function boxOffice(chain: { id: string; name: string; booking: string }): Chain {
  return {
    ...chain,
    cinemaName: (name) => `${chain.name} ${name}`,
    short: (name) => name,
    town: (cinema) => (inGreaterLondon(cinema.postcode ?? '', cinema.city) ? 'Greater London' : cinema.city.trim() || cinema.name),
    tag: readTag,
    seat: (raw) => (raw === 'Auditorium.Comfort.Recliners' ? 'Recliner' : null),
    distributor: (raw) => raw,
    isEvent: ({ tags }) => tags.some((tag) => EVENTS.has(tag)),
    fullUntil: weekFullUntil,
  };
}

export const everyman = boxOffice({ id: 'everyman', name: 'Everyman', booking: 'https://purchase.everymancinema.com/launch/ticketing/{id}' });
export const showcase = boxOffice({ id: 'showcase', name: 'Showcase', booking: 'https://tickets.showcasecinemas.co.uk/launch/ticketing/{id}' });
