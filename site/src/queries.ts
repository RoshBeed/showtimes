import { learnTags, tagKind, type TagKind } from './tags';

// Every question the site asks of the listings. The listings are held in
// memory as plain arrays, so each answer is a loop: nothing here waits.

/** The listings as the site downloads them (see export.ts). */
export interface Data {
  /** The cinema chains the listings come from. */
  chains: Chain[];
  /** When the least fresh chain was last fetched, or null before any ingest. */
  ingested: string | null;
  /** The last day every chain's whole schedule is published; later days hold advance bookings only. */
  fullUntil: string | null;
  cinemas: Cinema[];
  films: Film[];
  /** Which cinemas have announced which films: cinema ID, film ID. */
  availability: [string, string][];
  /** Films that are special events (concerts, theatre, screen hire), as their chain says: film IDs. */
  events: string[];
  /** Seats per screen: cinema ID, screen ID, capacity. */
  screens: [string, string, number][];
  /** The showings, ordered by start, then cinema ID, then ID. Each is a list of
   *  positions in `values`: cinema ID, ID, film ID, date, start, time, film start,
   *  film end, screen, screen ID, formats, seat types, sold out. */
  rows: number[][];
  /** Every distinct value a showing holds, written once. */
  values: unknown[];
  /** Each tag a showing may have, and its kind. */
  tags: Record<string, TagKind>;
  /** Published exceptions to a chain's booking template; null means no booking link. */
  bookingLinks?: Record<string, string | null>;
}

export interface Chain {
  /** `odeon`; every ID it exports starts `odeon-`. */
  id: string;
  name: string;
  /** The page that books a showing, with `{id}` for the showing's ID and `{cinema}` for its cinema's. */
  booking: string;
  bookingByCinema?: Record<string, string>;
  ingested: string | null;
  fullUntil: string | null;
}

interface Cinema {
  /** The chain's ID, then the cinema's own: `odeon-155`. */
  id: string;
  chain: string;
  /** In full: `ODEON London West End`. */
  name: string;
  /** Without what the chain's cinemas share: `West End`. */
  short: string;
  /** The town or area it is listed under: `Greater London`, `Bath`. */
  town: string;
  /** Whether its screenings are stored. */
  stored: boolean;
  address: Record<string, string>;
}

interface Show {
  cinemaId: string;
  id: string;
  filmId: string;
  date: string;
  startsAt: string;
  time: string;
  filmStartsAt: string | null;
  filmEndsAt: string | null;
  screen: string;
  screenId: string;
  experiences: string[];
  seating: string[];
  soldOut: boolean;
  film?: Film;
  cinema?: Cinema;
  capacity: number | null;
  /** The film's title and the cinema's name in lower case, to sort by. */
  title: string;
  place: string;
  /** What a search looks through; made the first time one does. */
  text?: string;
  /** Its place in `Listings.shows`. */
  index: number;
}

export interface Listings {
  bookingLinks: Record<string, string | null>;
  chains: Map<string, Chain>;
  ingested: string | null;
  fullUntil: string | null;
  films: Map<string, Film>;
  cinemas: Cinema[];
  availability: [string, string][];
  /** Every showing, in the order of `Data.rows`. */
  shows: Show[];
  /** Films that are special events, as their chain says. */
  events: Set<string>;
  /** Showings by cinema ID and ID; made the first time one is asked for. */
  byId?: Map<string, Show>;
  /** What each showing offers each column, by its index; made the first time a column is shown. */
  keys?: Map<string, Keys>;
  /** The showings still to come, for each scope asked about (the finder's, a cinema's for
   *  double bills), kept until the next showing starts. */
  upcoming?: { low: number; scopes: Map<string, Show[]> };
}

export function open(data: Data): Listings {
  learnTags(data.tags);
  const films = new Map(data.films.map((film) => [film.id, film]));
  const cinemas = new Map(data.cinemas.map((cinema) => [cinema.id, cinema]));
  const capacity = new Map(data.screens.map(([cinema, screen, seats]) => [`${cinema}/${screen}`, seats]));
  const lowered = new Map<string, string>();
  const low = (text = '') => lowered.get(text) ?? (lowered.set(text, lower(text)), lowered.get(text)!);
  const shows = data.rows.map((row, index): Show => {
    const [cinemaId, id, filmId, date, startsAt, time, filmStartsAt, filmEndsAt, screen, screenId, experiences, seating, soldOut] =
      row.map((position) => data.values[position]) as never[];
    const [film, cinema] = [films.get(filmId), cinemas.get(cinemaId)];
    return {
      cinemaId, id, filmId, date, startsAt, time, filmStartsAt, filmEndsAt, screen, screenId, experiences, seating,
      soldOut: Boolean(soldOut),
      film,
      cinema,
      capacity: capacity.get(`${cinemaId}/${screenId}`) ?? null,
      title: low(film?.title),
      place: low(cinema?.name),
      index,
    };
  });
  return {
    bookingLinks: data.bookingLinks ?? {},
    chains: new Map(data.chains.map((chain) => [chain.id, chain])),
    ingested: data.ingested,
    fullUntil: data.fullUntil,
    films,
    cinemas: data.cinemas,
    availability: data.availability,
    shows,
    events: new Set(data.events),
  };
}

/** What the visitor is looking at: their ticked cinemas, and the present moment. */
export interface Scope {
  /** Ticked cinema IDs; empty means every cinema. */
  cinemas: string[];
  /** Films the visitor has hidden. */
  hidden: string[];
  /** Now, as stored times are written: UTC, `2026-11-16T18:00:00Z`. */
  now: string;
  /** Today's date in London. */
  today: string;
  /** Leave out special events: concerts, theatre, opera and the like. */
  noEvents?: boolean;
}

export interface Showing {
  cinemaId: string;
  id: string;
  filmId: string;
  date: string;
  startsAt: string;
  time: string;
  /** When the film itself ends. */
  endsAt: string | null;
  title: string;
  cinema: string;
  /** The cinema's short name, and its chain's ID. */
  short: string;
  chain: string;
  screen: string;
  capacity: number | null;
  experiences: string[];
  soldOut: boolean;
}



const order = <T>(a: T, b: T) => (a < b ? -1 : a > b ? 1 : 0);
const lower = (text: string) => text.toLowerCase();
/** Sorts by each key in turn. */
const by = <T>(...keys: ((item: T) => string | number)[]) => (a: T, b: T) => {
  for (const key of keys) {
    const result = order(key(a), key(b));
    if (result) return result;
  }
  return 0;
};

/** Showings that have not started; with `scoped`, only the visitor's cinemas, less their hidden films. */
function upcoming(l: Listings, scope: Scope, scoped = true): Show[] {
  // The showings are in start order, so the first one still to come is found by halving.
  let [low, high] = [0, l.shows.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (l.shows[middle].startsAt > scope.now) high = middle;
    else low = middle + 1;
  }
  if (l.upcoming?.low !== low) l.upcoming = { low, scopes: new Map() };
  const key = [scoped, scope.noEvents, scope.cinemas.join(), scope.hidden.join()].join('|');
  const kept = l.upcoming.scopes.get(key);
  if (kept) return kept;
  // A film that is an event anywhere is one everywhere, whatever its other showings say.
  let rest = scope.noEvents ? l.shows.slice(low).filter((show) => !l.events.has(show.filmId)) : l.shows.slice(low);
  if (scoped && (scope.cinemas.length || scope.hidden.length)) {
    const ticked = new Set(scope.cinemas);
    const hidden = new Set(scope.hidden);
    rest = rest.filter((show) => (!ticked.size || ticked.has(show.cinemaId)) && !hidden.has(show.filmId));
  }
  l.upcoming.scopes.set(key, rest);
  return rest;
}


export interface Film {
  id: string;
  title: string;
  runtime: number | null;
  certificate: string;
  release: string | null;
  genres: string[];
  people: { name: string; roles: string[] }[];
  distributor: string;
  synopsis: string;
  trailer: string | null;
  imdb: number | null;
  imdbId: string | null;
  metacritic: number | null;
}

export const film = (l: Listings, id: string): Film | null => l.films.get(id) ?? null;

/** Friday to Sunday of this week; from today when the weekend has begun. */
export function weekend(today: string): [string, string] {
  const day = new Date(today + 'T00:00:00Z');
  const weekday = (day.getUTCDay() + 6) % 7; // Monday is 0
  const shift = (days: number) =>
    new Date(day.getTime() + days * 86400000).toISOString().slice(0, 10);
  return [shift(Math.max(4 - weekday, 0)), shift(6 - weekday)];
}

/** A screen's name without "Screen ", and its number when that is all the name is. */
function screenName(show: Show): [name: string, number: number | null] {
  let found = screenNames.get(show.screen);
  if (!found) {
    const name = show.screen.startsWith('Screen ') ? show.screen.slice(7) : show.screen;
    screenNames.set(show.screen, (found = [name, /^[0-9]+$/.test(name) ? Number(name) : null]));
  }
  return found;
}
const screenNames = new Map<string, [string, number | null]>();

/** Sort orders for the showtimes table. Ties keep the order of start, cinema and ID. */
const SHOWING_ORDERS: Record<string, (sign: number) => (a: Show, b: Show) => number> = {
  date: (sign) => (a, b) => sign * order(a.startsAt, b.startsAt),
  time: (sign) => (a, b) => sign * order(a.time, b.time),
  film: (sign) => (a, b) => sign * order(a.title, b.title),
  cinema: (sign) => (a, b) => sign * order(a.place, b.place),
  chain: (sign) => (a, b) => sign * order(a.cinema?.chain ?? '', b.cinema?.chain ?? '') || order(a.startsAt, b.startsAt),
  // Numbered screens come before named ones, in number order.
  screen: (sign) => (a, b) => {
    const [[nameA, numberA], [nameB, numberB]] = [screenName(a), screenName(b)];
    if (numberA !== null && numberB !== null) return sign * (numberA - numberB || order(nameA, nameB));
    if (numberA === null && numberB === null) return sign * order(nameA, nameB);
    return sign * (numberA === null ? 1 : -1);
  },
  // Screens of unknown size come last, whichever way.
  seats: (sign) => (a, b) =>
    a.capacity === null || b.capacity === null
      ? Number(a.capacity === null) - Number(b.capacity === null)
      : sign * (a.capacity - b.capacity),
};

const asShowing = (show: Show): Showing => ({
  cinemaId: show.cinemaId, id: show.id, filmId: show.filmId, date: show.date, startsAt: show.startsAt,
  time: show.time, endsAt: show.filmEndsAt, title: show.film!.title, cinema: show.cinema!.name, short: show.cinema!.short, chain: show.cinema!.chain, screen: show.screen,
  capacity: show.capacity, experiences: show.experiences, soldOut: show.soldOut,
});

export interface Neighbour extends Showing {
  /** Minutes between one film ending and the other's advertised start. */
  gap: number;
}

/** Double bills: other films at the same cinema that end shortly before this
 *  showing starts, or start shortly after its film ends. */
export function around(l: Listings, scope: Scope, cinemaId: string, id: string, within = 45): { before: Neighbour[]; after: Neighbour[] } {
  l.byId ??= new Map(l.shows.map((show) => [`${show.cinemaId}/${show.id}`, show]));
  const here = l.byId.get(`${cinemaId}/${id}`);
  const [before, after]: Neighbour[][] = [[], []];
  if (!here) return { before, after };
  const minutes = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 60000);
  for (const show of upcoming(l, { ...scope, cinemas: [cinemaId] })) {
    if (show.filmId === here.filmId || !show.film || !show.cinema) continue;
    const wait = here.filmEndsAt ? minutes(here.filmEndsAt, show.startsAt) : -1;
    if (wait >= 0 && wait <= within) after.push({ ...asShowing(show), gap: wait });
    const lead = show.filmEndsAt ? minutes(show.filmEndsAt, here.startsAt) : -1;
    if (lead >= 0 && lead <= within) before.push({ ...asShowing(show), gap: lead });
  }
  return { before, after };
}

export interface ShowingDetail extends Showing {
  filmStartsAt: string | null;
  filmEndsAt: string | null;
  runtime: number | null;
  seating: string[];
  address: Record<string, string>;
}

/** One showing with what its own page and a calendar entry need. */
export function showing(l: Listings, cinemaId: string, id: string): ShowingDetail | null {
  l.byId ??= new Map(l.shows.map((show) => [`${show.cinemaId}/${show.id}`, show]));
  const show = l.byId.get(`${cinemaId}/${id}`);
  if (!show?.film || !show.cinema) return null;
  return {
    cinemaId, id, filmId: show.filmId, date: show.date, startsAt: show.startsAt, time: show.time, endsAt: show.filmEndsAt,
    title: show.film.title, cinema: show.cinema.name, short: show.cinema.short, chain: show.cinema.chain, screen: show.screen, capacity: show.capacity,
    experiences: show.experiences, soldOut: show.soldOut, filmStartsAt: show.filmStartsAt,
    filmEndsAt: show.filmEndsAt, runtime: show.film.runtime, seating: show.seating, address: show.cinema.address,
  };
}

/** The page that books a showing on its chain's site. */
export function booking(l: Listings, show: { cinemaId: string; id: string }): string | null {
  const key = JSON.stringify([show.cinemaId, show.id]);
  if (Object.hasOwn(l.bookingLinks, key)) return l.bookingLinks[key];
  const cinema = l.cinemas.find((each) => each.id === show.cinemaId);
  const chain = cinema && l.chains.get(cinema.chain);
  if (!chain) return null;
  // The chain's own IDs, each part of one kept apart: Vue's showing is film/session.
  const own = (id: string) => id.split('/').map(encodeURIComponent).join('/');
  const id = show.cinemaId.slice(chain.id.length + 1);
  const template = chain.bookingByCinema?.[id] ?? chain.booking;
  return template ? template.replace('{cinema}', own(id)).replace('{id}', own(show.id)) : null;
}

/** Titles of the given films, for listing what a visitor has hidden. */
export function titles(l: Listings, ids: string[]): { id: string; title: string }[] {
  return ids
    .flatMap((id) => {
      const film = l.films.get(id);
      return film ? [{ id, title: film.title }] : [];
    })
    .sort(by((film) => lower(film.title)));
}

// ---- The finder ------------------------------------------------------------

/** The columns a visitor can choose to show: what a showing can be chosen by. */
export const FACETS = [
  'day', 'film', 'cinema', 'location', 'picture', 'language', 'access', 'event', 'seat',
  'screen', 'cert', 'genre', 'person', 'distributor', 'release', 'chain',
] as const;
export type Facet = (typeof FACETS)[number];
/** One choice per column; a column left out means all. */
/** What is chosen in each column: one value or several, of which a showing must offer any. */
export type Picks = Partial<Record<Facet, string[]>>;

const certificate = (film: Film) => film.certificate || 'TBC';
const tagged = (kind: TagKind) => (show: Show) => show.experiences.filter((tag) => tagKind(tag) === kind);

/** Columns whose value is the film's, whichever showing of it: counted per film. */
const FILM_FACETS = new Set<Facet>(['film', 'cert', 'genre', 'person', 'distributor', 'release']);

/** What one showing offers a column. A showing can offer several (its tags, the film's genres) or none. */
function keyer(facet: Facet, today: string): (show: Show) => string[] {
  const [first, last] = weekend(today);
  switch (facet) {
    case 'day': return (show) => (show.date >= first && show.date <= last ? [show.date, 'weekend'] : [show.date]);
    case 'film': return (show) => [show.filmId];
    case 'cinema': return (show) => [show.cinemaId];
    case 'location': return (show) => (show.cinema ? [show.cinema.town] : []);
    case 'picture': return tagged('Picture');
    case 'language': return tagged('Language');
    case 'access': return tagged('Accessibility');
    case 'event': return tagged('Events');
    case 'seat': return (show) => show.seating;
    case 'screen': return (show) => [`${show.cinemaId}/${show.screenId}`];
    case 'cert': return (show) => (show.film ? [certificate(show.film)] : []);
    case 'genre': return (show) => show.film?.genres ?? [];
    case 'person': return (show) => [...new Set(show.film?.people.map((person) => person.name))];
    case 'distributor': return (show) => (show.film?.distributor ? [show.film.distributor] : []);
    case 'release': return (show) => [show.film?.release && show.film.release > today ? 'soon' : 'out'];
    case 'chain': return (show) => (show.cinema ? [show.cinema.chain] : []);
  }
}
/** What each showing offers a column, as numbers: `ids[show.index]` are positions in `names`.
 *  Counting numbers into an array is much quicker than counting strings into a map,
 *  which matters in a browser without its JIT (Safari's Lockdown Mode). */
interface Keys { names: string[]; ids: number[][] }
function keysOf(l: Listings, facet: Facet, today: string): Keys {
  l.keys ??= new Map();
  const name = `${facet}/${today}`;
  if (!l.keys.has(name)) {
    const names: string[] = [];
    const numbers = new Map<string, number>();
    const ids = l.shows.map(keyer(facet, today)).map((keys) => keys.map((key) => {
      let id = numbers.get(key);
      if (id === undefined) numbers.set(key, (id = names.push(key) - 1));
      return id;
    }));
    l.keys.set(name, { names, ids });
  }
  return l.keys.get(name)!;
}

/** For the finder: how many showings each choice in each column would give, with
 *  the choices in the other columns applied; and the showings every choice allows,
 *  in start order. A search narrows the showings, not the counts. */
export function find(l: Listings, scope: Scope, facets: Facet[], picks: Picks, text = ''): { counts: Map<string, number>[]; shows: Show[] } {
  const keys = facets.map((facet) => keysOf(l, facet, scope.today));
  // What each column asks for, as its value numbers, or null for anything. A choice the column
  // has never seen matches nothing, so a column asking only for those matches no showing.
  const wanted = facets.map((facet, column) => {
    const chosen = picks[facet];
    if (!chosen?.length) return null;
    return chosen.map((value) => keys[column].names.indexOf(value)).filter((id) => id >= 0);
  });
  const tallies = keys.map((column) => new Float64Array(column.names.length));
  // A column about the film (its people, say) is counted per film and spread after:
  // one tally a showing instead of one for each of its film's many people.
  const perFilm = facets.map((facet) => (FILM_FACETS.has(facet) ? new Map<string, { n: number; index: number }>() : null));
  const add = (column: number, show: Show) => {
    const films = perFilm[column];
    if (films) {
      const seen = films.get(show.filmId);
      if (seen) seen.n += 1;
      else films.set(show.filmId, { n: 1, index: show.index });
      return;
    }
    for (const id of keys[column].ids[show.index]) tallies[column][id] += 1;
  };
  const needle = text.toLowerCase();
  const shows: Show[] = [];
  for (const show of upcoming(l, scope)) {
    if (!show.film || !show.cinema) continue;
    // A showing that fails one column's choice still counts towards that column.
    let failed = -1;
    let failures = 0;
    for (let column = 0; column < facets.length && failures < 2; column += 1) {
      const asked = wanted[column];
      if (asked && !keys[column].ids[show.index].some((id) => asked.includes(id))) {
        failures += 1;
        failed = column;
      }
    }
    if (failures > 1) continue;
    if (failures === 1) { add(failed, show); continue; }
    for (let column = 0; column < facets.length; column += 1) add(column, show);
    if (needle) {
      show.text ??= lower([show.film.title, show.cinema.name, show.screen, show.time, ...show.experiences].join(' '));
      if (!show.text.includes(needle)) continue;
    }
    shows.push(show);
  }
  perFilm.forEach((films, column) => {
    for (const { n, index } of films?.values() ?? []) {
      for (const id of keys[column].ids[index]) tallies[column][id] += n;
    }
  });
  // In the order the values were first seen, as the maps were filled before.
  const counts = tallies.map((tally, column) => {
    const found = new Map<string, number>();
    tally.forEach((n, id) => { if (n) found.set(keys[column].names[id], n); });
    return found;
  });
  return { counts, shows };
}

export const SORTS = Object.keys(SHOWING_ORDERS);
/** Showings from find(), in another order and only the first `limit`. */
export function arrange(shows: Show[], sort = 'date', descending = false, limit = Infinity): { rows: Showing[]; total: number } {
  const sorted = sort === 'date' && !descending ? shows : [...shows].sort((SHOWING_ORDERS[sort] ?? SHOWING_ORDERS.date)(descending ? -1 : 1));
  return { total: shows.length, rows: sorted.slice(0, limit).map(asShowing) };
}

/** A screen's cinema, name and size, for its row in the Screen column. */
export function screenOf(l: Listings, key: string): { cinema: string; screen: string; capacity: number | null } | null {
  if (!screenMaps.has(l)) {
    const found = new Map<string, { cinema: string; screen: string; capacity: number | null }>();
    for (const show of l.shows) {
      const name = `${show.cinemaId}/${show.screenId}`;
      if (show.cinema && !found.has(name)) found.set(name, { cinema: show.cinema.short, screen: show.screen, capacity: show.capacity });
    }
    screenMaps.set(l, found);
  }
  return screenMaps.get(l)!.get(key) ?? null;
}
const screenMaps = new WeakMap<Listings, Map<string, { cinema: string; screen: string; capacity: number | null }>>();
