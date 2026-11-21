// Turns the chains' SQLite files into the one JSON document the site reads.
// Runs in Node when the site is built (scripts/export.ts) and in the tests.
// Each file is read through its chain's module (src/chains/), so what leaves
// here is in the shared vocabulary and the site knows no chain's own strings.
import type { DatabaseSync } from 'node:sqlite';
import type { Chain } from './chains/chain';
import type { Data, Film } from './queries';
import type { TagKind } from './tags';

/** A chain's stored listings: its file, opened, and its module. */
export interface Source {
  chain: Chain;
  sqlite: DatabaseSync;
}

/** Everything, or with `only`, the showings and announcements of just those cinemas (exported IDs). */
export function exportListings(sources: Source[], only?: Set<string>): Data {
  // Most of a showing repeats in others (its cinema, film, date, formats),
  // so each distinct value is written once and showings refer to it by number.
  const values: unknown[] = [];
  const numbers = new Map<string, number>();
  const number = (value: unknown) => {
    const key = JSON.stringify(value);
    if (!numbers.has(key)) numbers.set(key, values.push(value) - 1);
    return numbers.get(key)!;
  };
  const read = (sqlite: DatabaseSync, sql: string) => {
    const statement = sqlite.prepare(sql);
    statement.setReturnArrays(true); // two columns may share a name
    return statement.all() as unknown as never[][];
  };
  /** An ID as the site knows it: the chain's name, then its own ID. */
  const own = (chain: Chain, id: string) => `${chain.id}-${id}`;

  // A film is often listed more than once: by one chain for the UK and for Ireland,
  // or by two chains. Titles that match once case and punctuation are set aside
  // become one film: the listing with the most showings, which borrows any rating it lacks.
  const editions = new Map<string, Film[]>();
  const showings = new Map<string, number>();
  for (const { chain, sqlite } of sources) {
    for (const [id, count] of read(sqlite, 'SELECT film_id, count(*) FROM screenings GROUP BY film_id') as unknown as [string, number][]) {
      showings.set(own(chain, id), count);
    }
    for (const film of read(sqlite,
      `SELECT f.id, f.title, f.runtime, f.certificate, f.release_date, f.genres, f.people,
              f.distributor, f.synopsis, f.trailer_url, imdb.score, imdb.external_id, mc.score
       FROM films f
       LEFT JOIN ratings imdb ON imdb.film_id = f.id AND imdb.source = 'imdb'
       LEFT JOIN ratings mc ON mc.film_id = f.id AND mc.source = 'metacritic'
       ORDER BY f.id`,
    ).map(([id, title, runtime, certificate, release, genres, people, distributor, synopsis, trailer, imdb, imdbId, metacritic]): Film => ({
      id: own(chain, id), title: chain.filmTitle?.(title) ?? title, runtime, certificate, release, synopsis, trailer, imdb, imdbId, metacritic,
      distributor: chain.distributor(distributor),
      genres: (JSON.parse(genres) as string[]).map((name) => name.trim()),
      people: JSON.parse(people),
    }))) {
      const key = film.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') || film.id;
      editions.set(key, [...(editions.get(key) ?? []), film]);
    }
  }
  const merged = new Map<string, string>();
  const films = [...editions.values()].map((group) => {
    const main = group.reduce((best, film) => ((showings.get(film.id) ?? 0) > (showings.get(best.id) ?? 0) ? film : best));
    for (const film of group) {
      merged.set(film.id, main.id);
      // Whatever the chosen listing lacks, another may have: ratings, a synopsis, the cast.
      main.imdb ??= film.imdb;
      main.imdbId ??= film.imdbId;
      main.metacritic ??= film.metacritic;
      main.runtime ??= film.runtime;
      main.release ??= film.release;
      main.trailer ??= film.trailer;
      main.certificate ||= film.certificate;
      main.synopsis ||= film.synopsis;
      main.distributor ||= film.distributor;
      if (!main.genres.length) main.genres = film.genres;
      if (!main.people.length) main.people = film.people;
    }
    // A YouTube trailer plays in the page; another chain's video file only links out.
    const playable = group.find((film) => film.trailer && /youtu\.?be/.test(film.trailer));
    if (playable) main.trailer = playable.trailer;
    return main;
  });
  const film = (chain: Chain, id: string) => merged.get(own(chain, id)) ?? own(chain, id);

  const chains: Data['chains'] = [];
  const cinemas: Data['cinemas'] = [];
  const availability: Data['availability'] = [];
  const screens: Data['screens'] = [];
  const tags: Record<string, TagKind> = {};
  const bookingLinks: Record<string, string | null> = {};
  const events = new Set<string>();
  const rows: [string, unknown[]][] = [];
  for (const { chain, sqlite } of sources) {
    const state = new Map(read(sqlite, 'SELECT key, value FROM state') as unknown as [string, string][]);
    // Old cached chain files remain readable until their next normal ingest.
    if (read(sqlite, "SELECT name FROM sqlite_master WHERE name = 'screening_links'").length) {
      for (const [cinema, id, url] of read(sqlite, 'SELECT cinema_id, screening_id, url FROM screening_links')) {
        if (!only || only.has(own(chain, cinema))) bookingLinks[JSON.stringify([own(chain, cinema), id])] = url;
      }
    }
    chains.push({
      id: chain.id,
      name: chain.name,
      booking: chain.booking,
      bookingByCinema: chain.bookingByCinema,
      ingested: read(sqlite, `SELECT max(finished_at) FROM runs WHERE source = '${chain.id}' AND status = 'ok'`)[0][0],
      fullUntil: chain.fullUntil(state),
    });
    for (const [id, name, stored, address] of read(sqlite, 'SELECT id, name, stored, address FROM cinemas')) {
      // Chains' addresses carry stray spaces ("38A Leicester Square ").
      const parsed = Object.fromEntries(Object.entries(JSON.parse(address) as Record<string, string>).map(([part, text]) => [part, String(text).trim()]));
      cinemas.push({
        id: own(chain, id), chain: chain.id, name: chain.cinemaName(name), short: chain.short(name),
        town: chain.town({ id, name, city: parsed.city ?? '', postcode: parsed.postcode }), stored: Boolean(stored), address: parsed,
      });
    }
    for (const [cinema, id] of read(sqlite, 'SELECT cinema_id, film_id FROM availability')) {
      if (!only || only.has(own(chain, cinema))) availability.push([own(chain, cinema), film(chain, id)]);
    }
    for (const [cinema, screen, capacity] of read(sqlite, 'SELECT cinema_id, screen_id, capacity FROM screens')) {
      screens.push([own(chain, cinema), screen, capacity]);
    }
    const titles = new Map(read(sqlite, 'SELECT id, title FROM films') as unknown as [string, string][]);
    for (const [cinema, id, filmId, date, startsAt, time, filmStartsAt, filmEndsAt, screen, screenId, experiences, seating, soldOut] of read(sqlite,
      `SELECT cinema_id, id, film_id, business_date, starts_at, time, film_starts_at, film_ends_at,
              screen, screen_id, experiences, seating, sold_out
       FROM screenings`,
    )) {
      const raw = JSON.parse(experiences) as string[];
      // From every cinema's showings, so that a film is an event whichever cinemas are exported.
      if (chain.isEvent({ title: titles.get(filmId) ?? '', tags: raw })) events.add(film(chain, filmId));
      if (only && !only.has(own(chain, cinema))) continue;
      const named = raw.flatMap((tag) => {
        const reading = chain.tag(tag);
        if (!reading) return [];
        // Two chains may file one name differently: the more telling kind wins over Events.
        if (!tags[reading.label] || tags[reading.label] === 'Events') tags[reading.label] = reading.kind;
        return [reading.label];
      });
      const seats = [...new Set((JSON.parse(seating) as string[]).map((seat) => chain.seat(seat)).filter((seat): seat is string => seat !== null))];
      rows.push([`${startsAt} ${own(chain, cinema)} ${id}`, [
        own(chain, cinema), id, film(chain, filmId), date, startsAt, time, filmStartsAt, filmEndsAt, screen, screenId,
        [...new Set(named)], seats, soldOut,
      ]]);
    }
  }
  // In the order the site lists them, which it relies on: by start, then cinema, then ID.
  rows.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const fetched = chains.map((chain) => chain.ingested).filter((when): when is string => Boolean(when)).sort();
  return {
    chains,
    // The oldest chain's freshness, and the soonest any chain's full schedule ends: true of all of them.
    ingested: fetched[0] ?? null,
    fullUntil: chains.map((chain) => chain.fullUntil).filter((day): day is string => Boolean(day)).sort()[0] ?? null,
    cinemas,
    films,
    availability,
    events: [...events],
    screens,
    tags,
    bookingLinks,
    rows: rows.map(([, row]) => row.map(number)),
    values,
  };
}
