import { expect, test } from 'vitest';
import { listingsBadge } from './badge';

const chain = (name: string, ingested: string | null) => ({ id: name.toLowerCase(), name, booking: '', ingested, fullUntil: null });
const now = new Date('2026-11-22T12:00:00Z');

test('every chain fetched this week: green, with how many cinemas and when they were updated', () => {
  expect(listingsBadge([chain('ODEON', '2026-11-17T04:36:20Z'), chain('Vue', '2026-11-21T00:58:36Z')], 200, now))
    .toEqual({ schemaVersion: 1, label: 'listings', message: '200 cinemas, updated 17 Nov – 21 Nov', color: 'brightgreen' });
});

test('a chain not fetched for over a week, or never, is named', () => {
  const badge = listingsBadge([chain('ODEON', '2026-11-10T04:00:00Z'), chain('Vue', null), chain('Rio', '2026-11-21T00:00:00Z'), chain('Lexi', '2026-11-21T00:00:00Z'), chain('ActOne', '2026-11-21T00:00:00Z')], 5, now);
  expect(badge).toMatchObject({ message: 'ODEON, Vue out of date', color: 'orange' });
  expect(listingsBadge([chain('ODEON', null)], 1, now).color).toBe('red');
});
