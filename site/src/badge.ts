// The README's listings badge: a shields.io endpoint (shields.io/badges/endpoint-badge)
// written beside the listings at each build, so it says what the live site shows.
import type { Data } from './queries';

// Each chain is fetched weekly; a few days' grace covers its retries.
const STALE_DAYS = 9;
const DAY = 24 * 60 * 60 * 1000;

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
/** A listings day (YYYY-MM-DD) as people read it: Thu 3 Dec. */
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
/** The Thursday ending the Friday-to-Thursday week a fetch belongs to: chains publish it by the
 *  Tuesday before, so a fetch from Tuesday on is for the week ending nine days after that Tuesday
 *  (as release_week in the ingest's week.py). */
export function weekEnd(fetched: string) {
  const date = new Date(new Date(fetched).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }) + 'T12:00:00Z');
  const tuesday = date.getTime() - ((date.getUTCDay() - 2 + 7) % 7) * DAY;
  return new Date(tuesday + 9 * DAY).toISOString().slice(0, 10);
}
const names = (chains: Data['chains']) => chains.map((chain) => chain.name).join(', ');

/** Green with the day every chain's listings are full to (else when they were updated); otherwise the chains whose latest run failed
 *  (still showing their earlier listings) and those not updated for over nine days. */
export function listingsBadge(chains: Data['chains'], failing: Set<string>, now = new Date()) {
  const stale = chains.filter((chain) => !chain.ingested || now.getTime() - Date.parse(chain.ingested) > STALE_DAYS * DAY);
  const failed = chains.filter((chain) => failing.has(chain.id) && !stale.includes(chain));
  if (stale.length || failed.length) {
    return {
      schemaVersion: 1,
      label: 'listings',
      message: [failed.length && `${names(failed)} failing`, stale.length && `${names(stale)} out of date`].filter(Boolean).join('; '),
      color: stale.length * 2 > chains.length ? 'red' : 'orange',
    };
  }
  // Which week the site shows: the Thursday that ends the week every chain was fetched for (its
  // own full-until day where it records one), the earliest of them.
  const full = chains.map((chain) => chain.fullUntil ?? weekEnd(chain.ingested!)).sort()[0];
  if (full) return { schemaVersion: 1, label: 'listings', message: `${chains.length} chains, to ${weekday(full)}`, color: 'brightgreen' };
  const dates = chains.map((chain) => chain.ingested!).sort();
  const [first, last] = [day(dates[0]), day(dates[dates.length - 1])];
  return {
    schemaVersion: 1,
    label: 'listings',
    message: `${chains.length} chains, updated ${first === last ? first : `${first} – ${last}`}`,
    color: 'brightgreen',
  };
}
