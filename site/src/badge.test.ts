import { expect, test } from 'vitest';
import { listingsBadge, weekEnd } from './badge';

const chain = (name: string, ingested: string | null, fullUntil: string | null = null) => ({ id: name.toLowerCase(), name, booking: '', ingested, fullUntil });
const now = new Date('2026-11-22T12:00:00Z');
const fresh = '2026-11-21T00:00:00Z';

test('every chain updated and none failing: green, with the Thursday the week they were fetched for ends', () => {
  // Fetched Tuesday 17 and Saturday 21 November: both are for the week ending Thursday 26 November.
  expect(listingsBadge([chain('ODEON', '2026-11-17T04:36:20Z'), chain('Vue', '2026-11-21T00:58:36Z')], new Set(), now))
    .toEqual({ schemaVersion: 1, label: 'listings', message: '2 chains, to Thu 26 Nov', color: 'brightgreen' });
});

test('a fetch on Monday still belongs to the week published the Tuesday before', () => {
  expect(weekEnd('2026-11-23T20:00:00Z')).toBe('2026-11-26');
  expect(weekEnd('2026-11-24T06:15:00Z')).toBe('2026-12-03');
  expect(weekEnd('2026-11-25T06:15:00Z')).toBe('2026-12-03');
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

test('a chain\'s own full-until day counts, and the earliest of them is what every chain is full to', () => {
  expect(listingsBadge([chain('ODEON', fresh, '2026-12-03'), chain('Vue', fresh, '2026-12-10')], new Set(), now))
    .toEqual({ schemaVersion: 1, label: 'listings', message: '2 chains, to Thu 3 Dec', color: 'brightgreen' });
  // One fetched a week earlier holds the badge to its own week.
  expect(listingsBadge([chain('ODEON', fresh, '2026-12-03'), chain('Rio', fresh)], new Set(), now).message).toBe('2 chains, to Thu 26 Nov');
});
