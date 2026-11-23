import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { everyman } from './chains/boxoffice';
import { odeon } from './chains/odeon';
import { olympic } from './chains/olympic';
import { reel } from './chains/reel';
import * as q from './queries';
import { exportListings } from './export';

const store = readFileSync(new URL('../../ingest/src/showtimes_ingest/store.py', import.meta.url), 'utf8');
const SCHEMA = /SCHEMA = """([\s\S]*?)"""/.exec(store)![1];

function chain(cinema: string, film: [string, string, string | null, string], shows: number) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.prepare("INSERT INTO cinemas VALUES (?, 'Somewhere', 1, '{\"city\":\"Bath\",\"postcode\":\"BA1 1SS\"}', NULL, NULL)").run(cinema);
  sqlite.prepare("INSERT INTO films VALUES (?, ?, NULL, '', NULL, '[]', '[]', '', ?, ?)").run(film[0], film[1], film[3], film[2]);
  const add = sqlite.prepare("INSERT INTO screenings VALUES (?, ?, ?, '2026-11-20', ?, '18:00', NULL, NULL, 'Screen 1', '1', '[]', '[]', 0)");
  for (let n = 0; n < shows; n += 1) add.run(cinema, `s${n}`, film[0], `2026-11-20T18:0${n}:00Z`);
  return sqlite;
}

test("a film two chains list is one film, with the busier listing's own details and the other's to fill the gaps", () => {
  const data = exportListings([
    { chain: odeon, sqlite: chain('155', ['HO1', 'Dune', 'https://www.youtube.com/watch?v=aaaaaaaaaaa', 'Sand.'], 1) },
    { chain: everyman, sqlite: chain('X1', ['6272', 'DUNE', 'https://m.example/dune.mp4', ''], 3) },
  ]);
  expect(data.films).toHaveLength(1);
  const [film] = data.films;
  expect(film.id).toBe('everyman-6272'); // more showings
  expect(film.synopsis).toBe('Sand.'); // borrowed
  expect(film.trailer).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa'); // the one that plays in the page
  const filmIds = new Set(data.rows.map((row) => data.values[row[2]]));
  expect([...filmIds]).toEqual(['everyman-6272']); // both chains' showings point at it
  expect(data.chains.map((each) => each.id)).toEqual(['odeon', 'everyman']);
});

test("a film's scores come from ratings.json, under the title as its chain lists it", () => {
  const ratings = { titles: { 'DUNE (IMAX)': { imdb_id: 'tt1', imdb: 8.4, metacritic: 74 }, 'Black Christmas (1974)': { imdb_id: 'tt2', imdb: 7.1, metacritic: null } } };
  const titles = {
    'DUNE (IMAX)': { title: 'Dune', year: null, tags: [] },
    'Black Christmas (1974)': { title: 'Black Christmas', year: 1974, tags: [] },
  };
  const data = exportListings([
    { chain: odeon, sqlite: chain('155', ['HO1', 'DUNE (IMAX)', null, ''], 1) },
    { chain: everyman, sqlite: chain('X1', ['BC', 'Black Christmas (1974)', null, ''], 1) },
  ], undefined, titles, ratings);
  const by = Object.fromEntries(data.films.map((film) => [film.title, film]));
  expect([by.Dune.imdb, by.Dune.imdbId, by.Dune.metacritic]).toEqual([8.4, 'tt1', 74]);
  expect([by['Black Christmas'].imdb, by['Black Christmas'].imdbId]).toEqual([7.1, 'tt2']);
});

test('the export preserves different ticketing hosts for cinemas in one group', () => {
  const data = exportListings([{ chain: olympic, sqlite: chain('barnes', ['a-film', 'A Film', null, ''], 1) }]);
  expect(q.booking(q.open(data), { cinemaId: 'olympic-barnes', id: '123/subtitled' })).toBe('https://web1.empire.mycloudcinema.com/#/book/123/subtitled');
});

test('published external and unavailable booking links survive export; older files remain readable', () => {
  const sqlite = chain('barnes', ['a-film', 'A Film', null, ''], 2);
  sqlite.exec("INSERT INTO screening_links VALUES ('barnes', 's0', 'https://tickets.example/s0'), ('barnes', 's1', NULL)");
  const listings = q.open(exportListings([{ chain: olympic, sqlite }]));
  expect(q.booking(listings, { cinemaId: 'olympic-barnes', id: 's0' })).toBe('https://tickets.example/s0');
  expect(q.booking(listings, { cinemaId: 'olympic-barnes', id: 's1' })).toBeNull();
  sqlite.exec('DROP TABLE screening_links');
  const older = q.open(exportListings([{ chain: olympic, sqlite }]));
  expect(q.booking(older, { cinemaId: 'olympic-barnes', id: 's0' })).toBe('https://web1.empire.mycloudcinema.com/#/book/s0');
});

test('a title cleaned of its screening label is the same film, the label a tag on its showings', () => {
  const sqlite = chain('hull', ['a', 'A Film - Subtitled Screening', null, ''], 1);
  sqlite.exec("INSERT INTO films SELECT 'b', 'A Film', runtime, certificate, release_date, genres, people, distributor, synopsis, trailer_url FROM films WHERE id = 'a'");
  sqlite.exec("INSERT INTO screenings SELECT cinema_id, 'other', 'b', business_date, starts_at, time, film_starts_at, film_ends_at, screen, screen_id, experiences, seating, sold_out FROM screenings LIMIT 1");
  const data = exportListings([{ chain: reel, sqlite }], undefined, {
    'A Film - Subtitled Screening': { title: 'A Film', year: null, tags: [{ label: 'English subtitles', kind: 'Language' }] },
  });
  expect(data.films.map((film) => film.title)).toEqual(['A Film']);
  expect(data.rows).toHaveLength(2);
  expect(data.tags['English subtitles']).toBe('Language');
  expect(q.booking(q.open(data), { cinemaId: 'reel-hull', id: '123/a-film' })).toBe('https://hull.reelcinemas.co.uk/hull/booking/123/a-film');
});

test('titles Claude cleaned to one name are one film, tagged with what they said; remakes stay apart', () => {
  const titles = {
    '(4DX) The Polar Express': { title: 'The Polar Express', year: null, tags: [{ label: '4DX', kind: 'Picture' as const }] },
    'The Polar Express (2004)': { title: 'The Polar Express', year: 2004, tags: [] },
    'Black Christmas (1974)': { title: 'Black Christmas', year: 1974, tags: [] },
    'Black Christmas (2006)': { title: 'Black Christmas', year: 2006, tags: [] },
  };
  const data = exportListings([
    { chain: odeon, sqlite: chain('155', ['HO1', '(4DX) The Polar Express', null, ''], 2) },
    { chain: everyman, sqlite: chain('X1', ['6272', 'The Polar Express (2004)', null, ''], 1) },
    { chain: reel, sqlite: chain('hull', ['b', 'Black Christmas (1974)', null, ''], 1) },
    { chain: olympic, sqlite: chain('barnes', ['c', 'Black Christmas (2006)', null, ''], 1) },
    { chain: odeon, sqlite: chain('156', ['HO2', 'A Title Nobody Cleaned', null, ''], 1) },
  ], undefined, titles);
  expect(data.films.map((film) => film.title).sort()).toEqual(['A Title Nobody Cleaned', 'Black Christmas (1974)', 'Black Christmas (2006)', 'The Polar Express']);
  const polar = data.rows.filter((row) => data.values[row[2]] === 'odeon-HO1');
  expect(polar).toHaveLength(3); // the 4DX and the plain listing's showings, as one film
  expect(polar.map((row) => data.values[row[10]])).toContainEqual(['4DX']);
  expect(data.tags['4DX']).toBe('Picture');
});
