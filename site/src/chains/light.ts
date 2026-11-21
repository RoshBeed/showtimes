import type { Chain } from './chain';
import type { TagKind } from '../tags';
import { weekFullUntil } from './week.ts';

const TAGS: Record<string, [string, TagKind]> = {
  'Audio Description': ['Audio Described', 'Accessibility'],
  'Subtitled': ['English subtitles', 'Language'],
  'Captioned': ['Captioned', 'Language'],
  'Captioned for hard of hearing': ['Captioned', 'Language'],
  'Autism Friendly': ['Relaxed', 'Accessibility'],
  'Relaxed': ['Relaxed', 'Accessibility'],
  'Relaxed Screenings': ['Relaxed', 'Accessibility'],
  'Dementia-friendly screenings': ['Dementia-friendly', 'Accessibility'],
  '3D': ['3D', 'Picture'],
  'IMAX': ['IMAX', 'Picture'],
};

export const light: Chain = {
  id: 'light',
  name: 'The Light',
  booking: 'https://{cinema}.thelight.co.uk/#!book/cinema/{id}',
  cinemaName: (name) => `The Light ${name}`,
  short: (name) => name,
  town: (cinema) => cinema.city || cinema.name,
  tag: (raw) => {
    if (raw === '2D' || /certificate/i.test(raw)) return null;
    const named = TAGS[raw];
    return named ? { label: named[0], kind: named[1] } : { label: raw, kind: 'Events' };
  },
  seat: () => null,
  distributor: (raw) => raw,
  isEvent: ({ title, tags }) => tags.some((tag) => ['Event Cinema', 'Theatre', 'Opera & Dance', 'Museums & Galleries on Screen'].includes(tag)) || /^(National Theatre Live|NT Live|Royal (Ballet|Opera)|RBO|Met Opera|Andre Rieu)\b/i.test(title),
  fullUntil: weekFullUntil,
};
