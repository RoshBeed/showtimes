// The README's listings badge: a shields.io endpoint (shields.io/badges/endpoint-badge)
// written beside the listings at each build, so it says what the live site shows.
import type { Data } from './queries';

// Each chain is fetched weekly; a few days' grace covers its retries.
const STALE_DAYS = 9;
const DAY = 24 * 60 * 60 * 1000;

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });

export function listingsBadge(chains: Data['chains'], now = new Date()) {
  const stale = chains.filter((chain) => !chain.ingested || now.getTime() - Date.parse(chain.ingested) > STALE_DAYS * DAY);
  if (stale.length) {
    return {
      schemaVersion: 1,
      label: 'listings',
      message: `${stale.map((chain) => chain.name).join(', ')} out of date`,
      color: stale.length * 2 > chains.length ? 'red' : 'orange',
    };
  }
  const dates = chains.map((chain) => chain.ingested!).sort();
  const [first, last] = [day(dates[0]), day(dates[dates.length - 1])];
  return {
    schemaVersion: 1,
    label: 'listings',
    message: `${chains.length} chains, fetched ${first === last ? first : `${first} – ${last}`}`,
    color: 'brightgreen',
  };
}
