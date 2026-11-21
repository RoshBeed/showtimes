// Picturehouse: its showings' attributes are Vista codes cut to ten letters
// ("Audio D", "Silver Scr", "Toddler Ti"), named here in full.
import type { Chain } from './chain';
import { inGreaterLondon } from './london.ts';
import { weekFullUntil } from './week.ts';
import type { TagKind } from '../tags';

const NAMED: Record<string, [string, TagKind] | null> = {
  '2D': null,
  'ad-trailer': null,
  Basement: null,
  Upstairs: null,
  '35mm': ['35mm', 'Picture'],
  '70mm': ['70mm', 'Picture'],
  Laser: ['Laser', 'Picture'],
  'Audio D': ['Audio Described', 'Accessibility'],
  HOHSub: ['Captioned', 'Language'],
  'Sub Cinema': ['English subtitles', 'Language'],
  Relaxed: ['Relaxed', 'Accessibility'],
  'Q+A': ['Q&A', 'Events'],
  LiveSat: ['Live', 'Events'],
  "Kids' Club": ["Kids' Club", 'Events'],
  'Silver Scr': ['Silver Screen', 'Events'],
  'Toddler Ti': ['Toddler Time', 'Events'],
  'Watch Baby': ['Watch with Baby', 'Events'],
  DogFriend: ['Dog Friendly', 'Events'],
  'Picture Do': ['Picture Doc', 'Events'],
  'Screen Art': ['Screen Arts', 'Events'],
  FilmCourse: ['Film Course', 'Events'],
};

export const picturehouse: Chain = {
  id: 'picturehouse',
  name: 'Picturehouse',
  booking: 'https://web.picturehouses.com/order/showtimes/{cinema}-{id}/seats',
  // Its cinemas are called "Arts Picturehouse", "Ritzy Picturehouse"; a few have names of
  // their own ("Cinema City", "Little Theatre Cinema", "City Screen York").
  cinemaName: (name) => (/Picturehouse|Cinema|Screen|Theatre/.test(name) ? name : `${name} Picturehouse`),
  // "Picturehouse at FACT Liverpool" → "FACT Liverpool"; "Arts Picturehouse" keeps its name.
  short: (name) => name.replace(/^Picturehouse (at )?/, ''),
  town: (cinema) => (inGreaterLondon(cinema.postcode ?? '', cinema.city) ? 'Greater London' : cinema.city.trim() || cinema.name),
  tag: (raw) => (raw in NAMED ? NAMED[raw] && { label: NAMED[raw]![0], kind: NAMED[raw]![1] } : { label: raw, kind: 'Events' }),
  seat: (raw) => raw,
  distributor: (raw) => raw,
  // Live satellite broadcasts: theatre, opera, ballet.
  isEvent: ({ tags }) => tags.includes('LiveSat'),
  fullUntil: weekFullUntil,
};
