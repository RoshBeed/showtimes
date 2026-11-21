// Other Vista operators share response fields with ODEON; their names and tags differ.
import type { Chain } from './chain';
import { inGreaterLondon } from './london.ts';
import { weekFullUntil } from './week.ts';

function chain(id: string, name: string, booking: string): Chain {
  const short = (raw: string) => raw.replace(new RegExp(`^${name}\\s+`, 'i'), '');
  return {
    id, name, booking,
    cinemaName: (raw) => new RegExp(`^${name}\\b`, 'i').test(raw) ? raw : `${name} ${raw}`,
    short,
    town: (c) => inGreaterLondon(c.postcode ?? '', c.city) ? 'Greater London' : c.city.trim() || short(c.name),
    tag(raw) {
      const value = raw.trim();
      if (/^2D(?: Film)?$/i.test(value)) return null;
      if (/^(IMAX|4DX|3D|4K|Laser|Superscreen|ScreenX|Dolby|Infinity Vision)\b/i.test(value)) return { label: value.replace(/ Film$/i, ''), kind: 'Picture' };
      if (/subtitl|caption/i.test(value)) return { label: value, kind: 'Language' };
      if (/audio desc|autism|relaxed|wheelchair|hard of hearing|strobe/i.test(value)) return { label: value, kind: 'Accessibility' };
      if (/^(Recliner|VIP|Sofa)\b/i.test(value)) return { label: value, kind: 'Seating' };
      if (/^(Hindi|Tamil|Telugu|Punjabi|Urdu|Malayalam|Kannada|Polish|Bengali)$/i.test(value)) return { label: value, kind: 'Language' };
      return { label: value, kind: 'Events' };
    },
    seat: (raw) => raw.trim() || null,
    distributor: (raw) => raw,
    isEvent: ({ title, tags }) => tags.some((t) => /^(Event Cinema|Alt Content|Screen Hire)/i.test(t)) || /^(NT Live|National Theatre Live|Royal (Ballet|Opera)|RBO|Met Opera|Screen Hire)\b/i.test(title),
    fullUntil: weekFullUntil,
  };
}

export const cineworld = chain('cineworld', 'Cineworld', 'https://web.cineworld.co.uk/order/showtimes/{id}/seats');
export const curzon = chain('curzon', 'Curzon', 'https://www.curzon.com/ticketing/seats/?showtimeId={id}');
