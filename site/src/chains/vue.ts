// Vue: its showings' attributes come typed ("Language: Hindi", "Session_Special: Laser",
// "Movie: Big Screen Opera"), so each type reads as a kind of tag.
import type { Chain } from './chain';
import { inGreaterLondon } from './london.ts';
import { weekFullUntil } from './week.ts';
import type { TagKind } from '../tags';

const NAMED: Record<string, [string, TagKind] | null> = {
  'Language: English': null, // nearly every showing
  'Language: Subtitled': ['English subtitles', 'Language'],
  'Session: Single Seat': null,
  'Session: Audio Description (AD)': ['Audio Described', 'Accessibility'],
  'Session: Autism Friendly': ['Autism Friendly', 'Accessibility'],
  'Session: Open Captioned': ['Captioned', 'Language'],
  'Session: Dolby Atmos': ['Dolby Atmos', 'Picture'],
  'Session: HDR by Barco': ['HDR', 'Picture'],
  'Session: EPIC': ['EPIC', 'Picture'],
  'Session: Biggest Screen': ['Biggest screen', 'Picture'],
  'Movie: Strobe Lighting': ['Flash Warning', 'Accessibility'],
};
const KINDS: Record<string, TagKind> = { Language: 'Language', Session_Special: 'Picture', Session: 'Events' };
// Vue files picture formats and seat types among its "Session" attributes too.
const PICTURE = /\b(IMAX|3D|4K|Dolby|Laser|HDR|EPIC|ScreenX|4DX)\b/;
const SEATS = /\b(Lux|VIP|Recliner)\b/i;
// Event cinema: Vue files concerts, opera, theatre and the like as "Big Screen" films.
const EVENT = /^Movie: Big Screen (Events|Dance|Music|Musicals|Opera|Theatre|Sports|TV)$/;

export const vue: Chain = {
  id: 'vue',
  name: 'Vue',
  booking: 'https://www.myvue.com/book-tickets/summary/{cinema}/{id}',
  cinemaName: (name) => `Vue ${name}`,
  // "London - Finchley Road (02 Centre)" → "Finchley Road"; "Dublin (Liffey Valley Shopping Centre)" stays a place.
  short: (name) => name.replace(/^London - /, '').replace(/ \((?:[^)]*Centre|[^)]*Park|[^)]*Village)\)$/, ''),
  town: (cinema) => (inGreaterLondon(cinema.postcode ?? '') || cinema.city.trim() === 'London' ? 'Greater London' : cinema.city.trim() || cinema.name),
  tag(raw) {
    if (raw in NAMED) return NAMED[raw] && { label: NAMED[raw]![0], kind: NAMED[raw]![1] };
    const [type, name = ''] = raw.split(': ');
    if (!name || type === 'Movie') return null; // a film's category, not the showing's
    const kind = PICTURE.test(name) ? 'Picture' : SEATS.test(name) ? 'Seating' : KINDS[type] ?? 'Events';
    return { label: name, kind };
  },
  seat: (raw) => raw,
  distributor: (raw) => raw.replace(/ \(UK \+ EIRE\)$/, ''),
  isEvent: ({ tags }) => tags.some((tag) => EVENT.test(tag)),
  fullUntil: weekFullUntil,
};
