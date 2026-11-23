// What the finder holds between draws: the listings, what is shown at all (kept in the query
// string), the view (kept in the hash) and the page as drawn. Other modules read these live;
// only the setters below change the ones that are replaced whole.
import { LONDON, readChoice, type View, writeChoices } from './choices';
import * as q from './queries';

export let db: q.Listings;
export function setDb(listings: q.Listings) { db = listings; }
export const app = document.getElementById('app')!;
export const narrow = matchMedia('(max-width: 640px)');

// ---- What is shown at all, kept in the query string ------------------------

export const ticks = readChoice(location.search, 'cinemas');
export const hidden = readChoice(location.search, 'hidden');
/** What the visitor has asked to see that is otherwise left out: `events`. */
export const extras = readChoice(location.search, 'show');
export function address() {
  const search = writeChoices({ cinemas: ticks, hidden, show: extras });
  if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash);
}
export function toggle(set: Set<string>, ids: string[], on?: boolean) {
  for (const id of ids) {
    if (on ?? !set.has(id)) set.add(id);
    else set.delete(id);
  }
  address();
}
/** Whether the ticked cinemas are Greater London's, no more and no fewer. */
export const londonOnly = () => ticks.size === LONDON.size && [...LONDON].every((id) => ticks.has(id));

export function scope(): q.Scope {
  return {
    cinemas: [...ticks],
    hidden: [...hidden],
    noEvents: !extras.has('events'),
    now: new Date().toISOString().slice(0, 19) + 'Z',
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()),
  };
}

export let view: View;
export function setView(next: View) { view = next; }
/** The page as drawn: what the keys act on. */
export let page: {
  options: (string | undefined)[][];
  rows: q.Showing[];
  total: number;
  /** Extra batches of showtimes drawn. */
  more: number;
  /** Text typed into each column's search, which is not kept in the address. */
  filters: string[];
  draw(): void;
  mark(): void;
  focusSearch(): void;
} | undefined;
export function setPage(next: typeof page) { page = next; }
/** The address last drawn; a change from elsewhere (going back, an edited address) draws again. */
export let drawn = '';
export function setDrawn(hash: string) { drawn = hash; }
/** Columns where lines are marked (Space, V, Shift- or Ctrl-click), and the line in hand in each.
 *  There j and k move this cursor and leave the marks as they are, as in ranger or lf; elsewhere
 *  moving through a column chooses the line moved to. */
export const cursors = new Map<q.Facet, number>();
