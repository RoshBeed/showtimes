import type { Chain } from './chain';
import type { TagKind } from '../tags';
import { inGreaterLondon } from './london.ts';
import { weekFullUntil } from './week.ts';

const TAGS: Record<string, [string, TagKind]> = {
  '3D': ['3D', 'Picture'],
  'Subtitled': ['English subtitles', 'Language'],
  'Lounge': ['Lounge', 'Seating'],
  'Recliner': ['Recliner', 'Seating'],
  'Audio Described': ['Audio Described', 'Accessibility'],
  'Autism Friendly': ['Relaxed', 'Accessibility'],
};

export const reel: Chain = {
  id: 'reel',
  name: 'Reel',
  booking: 'https://reelcinemas.co.uk/{cinema}/booknow/{id}/',
  bookingByCinema: {
    hull: 'https://hull.reelcinemas.co.uk/hull/booking/{id}',
    morecambe: 'https://morecambe.reelcinemas.co.uk/morecambe/booking/{id}',
    quinton: 'https://quinton.reelcinemas.co.uk/quinton/booking/{id}',
  },
  filmTitle: (title) => title.replace(/ - Subtitled Screening$/i, ''),
  cinemaName: (name) => `Reel ${name}`,
  short: (name) => name,
  town: (cinema) => inGreaterLondon(cinema.postcode ?? '', cinema.city) ? 'Greater London' : cinema.city.replace(/ - .*/, '') || cinema.name,
  tag: (raw) => {
    if (raw === '2D') return null;
    const named = TAGS[raw];
    return named ? { label: named[0], kind: named[1] } : { label: raw, kind: 'Events' };
  },
  seat: (raw) => raw,
  distributor: (raw) => raw,
  isEvent: ({ title, tags }) => tags.some((tag) => tag === 'Event Cinema' || tag === 'Party Event') || /^(National Theatre Live|NT Live|Royal (Ballet|Opera)|RBO|Met Opera|Andre Rieu)\b/i.test(title),
  fullUntil: weekFullUntil,
};
