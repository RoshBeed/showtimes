import { expect, test } from 'vitest';
import { listingsBadge } from './badge';

const chain = (name: string, ingested: string | null) => ({ id: name.toLowerCase(), name, booking: '', ingested, fullUntil: null });
const now = new Date('2026-11-22T12:00:00Z');
const fresh = '2026-11-21T00:00:00Z';

test('every chain updated this week and none failing: green, with when they were updated', () => {
  expect(listingsBadge([chain('ODEON', '2026-11-17T04:36:20Z'), chain('Vue', '2026-11-21T00:58:36Z')], new Set(), now))
    .toEqual({ schemaVersion: 1, label: 'listings', message: '2 chains, updated 17 Nov – 21 Nov', color: 'brightgreen' });
});

test('a chain whose latest run failed is named even while its earlier listings are recent', () => {
  expect(listingsBadge([chain('ODEON', fresh), chain('Vue', fresh), chain('Rio', fresh)], new Set(['odeon', 'vue']), now))
    .toEqual({ schemaVersion: 1, label: 'listings', message: 'ODEON, Vue failing', color: 'orange' });
});

test('a chain not updated for over a week, or never, is named as out of date', () => {
  const badge = listingsBadge([chain('ODEON', '2026-11-10T04:00:00Z'), chain('Vue', null), chain('Rio', fresh), chain('Lexi', fresh), chain('ActOne', fresh)], new Set(['odeon', 'rio']), now);
  expect(badge).toMatchObject({ message: 'Rio failing; ODEON, Vue out of date', color: 'orange' });
  expect(listingsBadge([chain('ODEON', null)], new Set(), now).color).toBe('red');
});
