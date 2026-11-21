// The visitor's choices live in the page's address, not in the browser, so a
// bookmark or a shared link carries them:
//   ?cinemas=london&hidden=odeon-HO00012345&show=events  what is shown at all
//   #cols=day,film,cinema&day=2026-11-20&col=2&row=5    the view and what is chosen in it
import { FACETS, SORTS, type Facet, type Picks } from './queries';

declare const __LONDON__: string[];
/** Greater London's cinemas. Built into the page from the listings it was built with
 *  (scripts/export.ts writes data/areas.json), so the page knows which file to download
 *  before it has any; replaced by the listings' own once they arrive. */
export const LONDON = new Set<string>(typeof __LONDON__ === 'undefined' ? [] : __LONDON__);
export function learnLondon(ids: string[]) {
  LONDON.clear();
  for (const id of ids) LONDON.add(id);
}

// Greater London's cinemas all ticked are written as one word: ?cinemas=london.
// Read, it stays that word until the listings say which cinemas it means (expandArea).
export const AREA = 'london';

export function readChoice(search: string, name: string): Set<string> {
  return new Set((new URLSearchParams(search).get(name) ?? '').split(',').filter(Boolean));
}
/** The word `london` among ticked cinemas, swapped for the cinemas it means. */
export function expandArea(ticks: Set<string>) {
  if (ticks.delete(AREA)) for (const id of LONDON) ticks.add(id);
}

/** The query string for these choices; empty when nothing is chosen. */
export function writeChoices(choices: Record<string, Set<string>>): string {
  const parts = Object.entries(choices)
    .filter(([, chosen]) => chosen.size)
    .map(([name, chosen]) => {
      let values = [...chosen];
      if (name === 'cinemas' && LONDON.size && [...LONDON].every((id) => chosen.has(id))) values = [AREA, ...values.filter((id) => !LONDON.has(id))];
      return `${name}=${values.map(encodeURIComponent).join(',')}`;
    });
  return parts.length ? '?' + parts.join('&') : '';
}

/** Whether every cinema's showings are needed, or Greater London's alone will do. */
export const needsEveryCinema = (ticks: Set<string>) => !ticks.size || [...ticks].some((id) => id !== AREA && !LONDON.has(id));

/** Showtimes are drawn this many at a time; more follow as the reader nears the end. */
export const PAGE = 100;

export const DEFAULT_COLUMNS: Facet[] = ['chain', 'cinema', 'film'];
/** What each showtime may show besides its time and film, in the order they are shown. */
export const FIELDS = ['ends', 'picture', 'language', 'access', 'cert', 'chain', 'cinema', 'screen', 'seats'] as const;
export type Field = (typeof FIELDS)[number];
export const DEFAULT_FIELDS: Field[] = ['picture', 'cinema', 'screen'];
/** How a column of choices is ordered: its own way, by how many showings, or (films) by rating. */
export type Order = 'name' | 'count' | 'rating';

export interface View {
  /** The columns of choices, left to right. The showtimes and their details always follow. */
  columns: Facet[];
  picks: Picks;
  /** Columns ordered other than their own way. */
  orders: Partial<Record<Facet, Order>>;
  /** The focused column, counted from 0: a column of choices, then the showtimes, then (on a phone) the details. */
  focus: number;
  /** The highlighted showtime, counted from 0. */
  row: number;
  /** What each showtime shows besides its time and film. */
  fields: Field[];
  /** The showtimes' order, and a search through them. */
  sort: string;
  descending: boolean;
  text: string;
}

/** The view in the address after the `#`: `#cols=…`, or no `#` at all for the default view. */
export function readView(hash: string): View {
  const params = new URLSearchParams(hash.slice(1));
  const known = (name: string): name is Facet => (FACETS as readonly string[]).includes(name);
  const columns = params.has('cols') ? [...new Set(params.get('cols')!.split(',').filter(known))] : [...DEFAULT_COLUMNS];
  const picks: Picks = {};
  for (const column of columns) if (params.get(column)) picks[column] = params.get(column)!;
  const orders: View['orders'] = {};
  for (const entry of (params.get('order') ?? '').split(',')) {
    const [column, order] = entry.split(':');
    if (known(column) && ['name', 'count', 'rating'].includes(order)) orders[column] = order as Order;
  }
  const whole = (name: string) => {
    const value = Number(params.get(name) ?? 1);
    return Number.isInteger(value) && value >= 1 ? value - 1 : 0;
  };
  const fields = params.has('fields') ? FIELDS.filter((field) => params.get('fields')!.split(',').includes(field)) : [...DEFAULT_FIELDS];
  const sort = params.get('sort') ?? 'date';
  return {
    columns,
    picks,
    orders,
    fields,
    focus: Math.min(whole('col'), columns.length + 1),
    row: whole('row'),
    sort: SORTS.includes(sort) ? sort : 'date',
    descending: params.get('desc') === '1',
    text: params.get('q') ?? '',
  };
}

export function writeView(view: View): string {
  const parts = [
    view.columns.join(',') === DEFAULT_COLUMNS.join(',') ? '' : `cols=${view.columns.join(',')}`,
    ...view.columns.map((column) => (view.picks[column] ? `${column}=${encodeURIComponent(view.picks[column]!)}` : '')),
    Object.keys(view.orders).length ? `order=${Object.entries(view.orders).map(([column, order]) => `${column}:${order}`).join(',')}` : '',
    view.fields.join(',') === DEFAULT_FIELDS.join(',') ? '' : `fields=${view.fields.join(',')}`,
    view.sort === 'date' ? '' : `sort=${view.sort}`,
    view.descending ? 'desc=1' : '',
    view.text ? `q=${encodeURIComponent(view.text)}` : '',
    view.focus ? `col=${view.focus + 1}` : '',
    view.row ? `row=${view.row + 1}` : '',
  ].filter(Boolean);
  return parts.length ? '#' + parts.join('&') : '';
}
