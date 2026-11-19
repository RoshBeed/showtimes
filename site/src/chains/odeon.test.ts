import { expect, test } from 'vitest';
import { LONDON, odeon } from './odeon';

test("ODEON's tags are grouped and renamed for people", () => {
  const kinds = (tags: string[]) => tags.map((tag) => odeon.tag(tag)!.kind);
  const labels = (tags: string[]) => tags.map((tag) => odeon.tag(tag)!.label);
  expect(kinds(['IMAX 3D_Web', 'Hindi (Audio)', 'English (Sub)', 'Audio Described', '£5 Web', 'Kids', 'Recliner'])).toEqual([
    'Picture', 'Language', 'Language', 'Accessibility', 'Pricing', 'Events', 'Seating',
  ]);
  // ODEON's variants of a picture format are picture formats too.
  expect(kinds(['3D - Web', 'XL 3D Web', 'Laser 3D', 'Infinity Vision', 'Dolby', 'Dubbed', 'Watchword'])).toEqual([
    'Picture', 'Picture', 'Picture', 'Picture', 'Picture', 'Language', 'Accessibility',
  ]);
  expect(labels(['Hindi (Audio)', '3D - Web ', 'XL 3D Web', 'XL Web', 'IMAX', 'English (Sub)'])).toEqual(['Hindi', '3D', 'XL 3D', 'XL', 'IMAX', 'English subtitles']);
});

test('ODEON cinemas are placed by borough, override or address, and named in full and short', () => {
  expect(odeon.town({ id: '555', name: 'Wimbledon', city: 'London' })).toBe('Greater London');
  expect(odeon.town({ id: '031', name: 'Coolock', city: 'Coolock' })).toBe('Dublin');
  expect(odeon.town({ id: '1', name: 'Bath', city: ' Bath ' })).toBe('Bath');
  expect(odeon.town({ id: '2', name: 'Somewhere', city: '' })).toBe('Somewhere');
  expect(LONDON.size).toBe(19);
  expect([odeon.cinemaName('London West End'), odeon.short('London West End')]).toEqual(['ODEON London West End', 'West End']);
});

test('ODEON seats without price tiers, one distributor for the UK and Ireland, its events, its booking page and release week', () => {
  expect(['Recliner Saver', 'Premier Popular', 'Classic'].map(odeon.seat)).toEqual(['Recliner', 'Premier', 'Classic']);
  expect(odeon.distributor('Warner IR')).toBe('Warner');
  expect(odeon.isEvent({ title: 'Live Opera', tags: ['Event Cinema '] })).toBe(true);
  expect(odeon.isEvent({ title: 'Screen Hire - 4 Hours', tags: [] })).toBe(true);
  expect(odeon.isEvent({ title: 'Dune', tags: ['IMAX'] })).toBe(false);
  expect(odeon.booking.replace('{id}', '155-1')).toBe('https://www.odeon.co.uk/ticketing/seat-picker/?showtimeId=155-1');
  // The week published on Tuesday 10 November runs to Thursday 19.
  expect(odeon.fullUntil(new Map([['release_week', '2026-11-10']]))).toBe('2026-11-19');
  expect(odeon.fullUntil(new Map())).toBeNull();
});
