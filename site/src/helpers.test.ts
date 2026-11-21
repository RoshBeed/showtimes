import { expect, test } from 'vitest';
import { ics } from './calendar';
import { DEFAULT_COLUMNS, expandArea, learnLondon, LONDON, needsEveryCinema, readChoice, readView, writeChoices, writeView } from './choices';
import type { ShowingDetail } from './queries';
import { certificateAge, formats, learnTags } from './tags';

test('a column shows the kinds of tag asked for, as the listings name them', () => {
  learnTags({ 'IMAX 3D': 'Picture', Saver: 'Pricing', 'Wheelchair Accessible': 'Accessibility', 'English subtitles': 'Language' });
  expect(formats(['IMAX 3D', 'Saver', 'Wheelchair Accessible', 'English subtitles', 'Kids'])).toBe('IMAX 3D, English subtitles');
  expect(formats(['Kids', 'Saver'], ['Events'])).toBe('Kids'); // a tag the listings do not name is an event
});

const show: ShowingDetail = {
  cinemaId: 'odeon-155', id: '155-1', filmId: 'odeon-F1', date: '2026-11-12', startsAt: '2026-11-12T18:00:00Z', time: '18:00', endsAt: '2026-11-12T21:00:00Z',
  title: 'Dune; Part, Two', cinema: 'ODEON London West End', short: 'West End', chain: 'odeon', screen: 'Screen 1', capacity: 300, experiences: ['IMAX', 'Saver'],
  soldOut: false, filmStartsAt: '2026-11-12T18:25:00Z', filmEndsAt: '2026-11-12T21:00:00Z', runtime: 155,
  seating: [], address: { line1: 'Leicester Square', city: 'London' },
};

test('a calendar entry covers the film, with the cinema as its place', () => {
  const file = ics(show, new Date('2026-11-11T09:00:00Z'));
  expect(file).toContain('DTSTART:20261112T182500Z\r\nDTEND:20261112T210000Z');
  expect(file).toContain('SUMMARY:Dune\\; Part\\, Two · ODEON London West End');
  expect(file).toContain('LOCATION:ODEON London West End\\, Leicester Square\\, London');
  expect(file).toContain('DESCRIPTION:Doors 18:00 · Screen 1 · 300 seats · IMAX');
  expect(file).toContain('UID:odeon-155.155-1@showtimes');
});

test('without film times the entry starts after the adverts and lasts the runtime', () => {
  const file = ics({ ...show, filmStartsAt: null, filmEndsAt: null, runtime: 100 }, new Date());
  expect(file).toContain('DTSTART:20261112T182500Z\r\nDTEND:20261112T200500Z');
});

test('choices are read from and written to the address', () => {
  expect([...readChoice('?cinemas=155,090&hidden=HO1', 'cinemas')]).toEqual(['155', '090']);
  expect([...readChoice('?cinemas=155%2C090', 'cinemas')]).toEqual(['155', '090']);
  expect(readChoice('', 'cinemas').size).toBe(0);
  expect(writeChoices({ cinemas: new Set(['155', '090']), hidden: new Set(['HO 1']) })).toBe('?cinemas=155,090&hidden=HO%201');
  expect(writeChoices({ cinemas: new Set(), hidden: new Set(['HO1']) })).toBe('?hidden=HO1');
  expect(writeChoices({ cinemas: new Set(), hidden: new Set() })).toBe('');
});

test("Greater London's listings will do while only its cinemas are ticked", () => {
  learnLondon(['odeon-155', 'odeon-090']);
  expect(needsEveryCinema(new Set())).toBe(true);
  expect(needsEveryCinema(new Set(['odeon-155', 'odeon-090']))).toBe(false);
  expect(needsEveryCinema(new Set(['london']))).toBe(false); // before the listings say which they are
  expect(needsEveryCinema(new Set(['odeon-155', 'odeon-001']))).toBe(true);
});

test('the view is read from and written to the address', () => {
  const view = readView('#cols=film,cinema,screen&film=HO1&cinema=155&order=film:rating&fields=seats,ends&sort=seats&desc=1&q=imax&col=3&row=12');
  expect(view).toEqual({
    columns: ['film', 'cinema', 'screen'], picks: { film: 'HO1', cinema: '155' }, orders: { film: 'rating' }, fields: ['ends', 'seats'],
    focus: 2, row: 11, sort: 'seats', descending: true, text: 'imax',
  });
  expect(writeView(view)).toBe('#cols=film,cinema,screen&film=HO1&cinema=155&order=film:rating&fields=ends,seats&sort=seats&desc=1&q=imax&col=3&row=12');
  // The default view is a bare address; unknown columns and choices for hidden columns are dropped.
  expect(writeView(readView(''))).toBe('');
  expect(readView('#cols=film,nonsense,film&day=2026-11-20').columns).toEqual(['film']);
  expect(readView('#cols=film&day=2026-11-20').picks).toEqual({});
  expect(readView('').columns).toEqual(DEFAULT_COLUMNS);
  expect(readView('#fields=nonsense').fields).toEqual([]); // just the time and film
});

test('certificates sort by age, with unrated films last', () => {
  const sorted = ['18', 'TBC', 'PG', '12A', 'U', '15', '', 'PG Ire', '15A', 'G']
    .sort((a, b) => (certificateAge(a) ?? 99) - (certificateAge(b) ?? 99));
  expect(sorted).toEqual(['U', 'G', 'PG', 'PG Ire', '12A', '15', '15A', '18', 'TBC', '']);
});

test('Greater London ticked whole is written as one word, and read back as its cinemas', () => {
  learnLondon(['odeon-155', 'odeon-090']);
  const ticks = readChoice('?cinemas=london,odeon-001', 'cinemas');
  expandArea(ticks);
  expect(ticks.size).toBe(LONDON.size + 1);
  expect(writeChoices({ cinemas: ticks })).toBe('?cinemas=london,odeon-001');
  ticks.delete('odeon-155'); // one London cinema unticked: each is listed again
  expect(writeChoices({ cinemas: ticks })).not.toContain('london');
  expect(readChoice('?hidden=london', 'hidden')).toEqual(new Set(['london']));
});
