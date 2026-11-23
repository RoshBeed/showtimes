// The README's listings badge: a shields.io endpoint (shields.io/badges/endpoint-badge)
// written beside the listings at each build, so it says what the live site shows.
import type { Data } from './queries';

// Each chain is fetched weekly; a few days' grace covers its retries.
const STALE_DAYS = 9;
const DAY = 24 * 60 * 60 * 1000;

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const names = (chains: Data['chains']) => chains.map((chain) => chain.name).join(', ');

/** Green with when the chains were updated; otherwise the chains whose latest run failed
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
  const dates = chains.map((chain) => chain.ingested!).sort();
  const [first, last] = [day(dates[0]), day(dates[dates.length - 1])];
  return {
    schemaVersion: 1,
    label: 'listings',
    message: `${chains.length} chains, updated ${first === last ? first : `${first} – ${last}`}`,
    color: 'brightgreen',
  };
}
