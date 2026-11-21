import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, test } from 'vitest';
import { odeon } from './chains/odeon';
import { exportListings } from './export';
import * as q from './queries';

// The tables are the ingest's own, so a schema change that breaks the export fails here.
// The chain is ODEON, whose IDs the site sees as `odeon-155`, `odeon-F1`.
const store = readFileSync(new URL('../../ingest/src/showtimes_ingest/store.py', import.meta.url), 'utf8');
const SCHEMA = /SCHEMA = """([\s\S]*?)"""/.exec(store)![1];

let sqlite: DatabaseSync;
let db: q.Listings;
// Wednesday 11 November 2026, 09:00 in London.
const scope: q.Scope = { cinemas: [], hidden: [], now: '2026-11-11T09:00:00Z', today: '2026-11-11' };

function screening(id: string, cinema: string, film: string, date: string, time: string, extra: Partial<Record<string, unknown>> = {}) {
  const row = { screen: 'Screen 1', screen_id: `${cinema}-1`, experiences: '[]', seating: '[]', sold_out: 0, ...extra };
  sqlite
    .prepare('INSERT INTO screenings VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)')
    .run(cinema, id, film, date, `${date}T${time}:00Z`, time, row.screen as string, row.screen_id as string, row.experiences as string, row.seating as string, row.sold_out as number);
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.exec(`
    INSERT INTO cinemas VALUES ('155', 'London West End', 1, '{"city":"London"}', 51.5, -0.1),
                               ('001', 'Aberdeen', 1, '{}', NULL, NULL);
    INSERT INTO films VALUES ('F1', 'Dune', 155, '12A', '2026-11-06', '["Sci-Fi"]',
                              '[{"name":"Denis Villeneuve","roles":["Director"]}]', 'Warner', 'Sand.', NULL),
                             ('F2', 'Paddington', 100, 'PG', '2026-10-01', '[]', '[]', '', '', NULL),
                             ('F3', 'Later', NULL, '', '2026-12-25', '[]', '[]', '', '', NULL);
    INSERT INTO availability VALUES ('155', 'F3', '["ComingSoon"]'), ('155', 'F1', '["NowShowing"]');
    INSERT INTO screens VALUES ('155', '155-1', 300);
    INSERT INTO ratings VALUES ('F1', 'imdb', 8.4, 'tt1'), ('F1', 'metacritic', 74, NULL);
    INSERT INTO runs (source, started_at, finished_at, status) VALUES ('odeon', 'a', '2026-11-10T05:00:00Z', 'ok');
    INSERT INTO state VALUES ('release_week', '2026-11-10');
  `);
  screening('155-0', '155', 'F1', '2026-11-11', '08:00'); // already started
  screening('155-1', '155', 'F1', '2026-11-11', '18:00', { experiences: '["IMAX"]', seating: '["Recliner Saver","Recliner","Premier"]' });
  screening('155-2', '155', 'F2', '2026-11-14', '12:00', { screen: 'The Lounge', screen_id: '155-L', sold_out: 1 });
  screening('001-1', '001', 'F1', '2026-11-20', '20:00', { screen: 'Screen 10', screen_id: '001-10' });
  db = q.open(exportListings([{ chain: odeon, sqlite }]));
});

// Counts per column, as plain objects, and the IDs of the showings that match every choice.
function found(facets: q.Facet[], picks: q.Picks = {}, within = scope, text = '') {
  const result = q.find(db, within, facets, picks, text);
  return { counts: Object.fromEntries(facets.map((facet, index) => [facet, Object.fromEntries(result.counts[index])])), ids: result.shows.map((show) => show.id) };
}

describe('queries', () => {
  test('the weekend is Friday to Sunday, or what is left of it', () => {
    expect(q.weekend('2026-11-11')).toEqual(['2026-11-13', '2026-11-15']);
    expect(q.weekend('2026-11-14')).toEqual(['2026-11-14', '2026-11-15']);
  });

  test('each column counts with the other columns chosen, and only what has not started', () => {
    expect(found(['day', 'film', 'cinema', 'picture'])).toEqual({
      counts: {
        day: { '2026-11-11': 1, '2026-11-14': 1, weekend: 1, '2026-11-20': 1 },
        film: { 'odeon-F1': 2, 'odeon-F2': 1 },
        cinema: { 'odeon-155': 2, 'odeon-001': 1 },
        picture: { IMAX: 1 },
      },
      ids: ['155-1', '155-2', '001-1'],
    });
    // Choosing a film narrows the days and cinemas, but not the list of films itself.
    expect(found(['day', 'film', 'cinema'], { film: 'odeon-F2' }).counts).toEqual({ day: { '2026-11-14': 1, weekend: 1 }, film: { 'odeon-F1': 2, 'odeon-F2': 1 }, cinema: { 'odeon-155': 1 } });
    expect(found(['film', 'picture', 'cinema'], { picture: 'IMAX', cinema: 'odeon-001' })).toEqual({ counts: { film: {}, picture: {}, cinema: { 'odeon-155': 1 } }, ids: [] });
    expect(found(['day'], { day: 'weekend' }).ids).toEqual(['155-2']);
  });

  test('the columns made from the film: certificate, genre, people, distributor and release', () => {
    expect(found(['cert', 'genre', 'person', 'distributor', 'release']).counts).toEqual({
      cert: { '12A': 2, PG: 1 },
      genre: { 'Sci-Fi': 2 },
      person: { 'Denis Villeneuve': 2 },
      distributor: { Warner: 2 },
      release: { out: 3 },
    });
    expect(found(['person'], { person: 'Denis Villeneuve' }).ids).toEqual(['155-1', '001-1']);
    expect(found(['release'], {}, { ...scope, today: '2026-11-01' }).counts.release).toEqual({ soon: 2, out: 1 });
  });

  test('screens, seats and locations: one value per seat type, without price tiers', () => {
    expect(found(['screen', 'seat', 'location']).counts).toEqual({
      screen: { 'odeon-155/155-1': 1, 'odeon-155/155-L': 1, 'odeon-001/001-10': 1 },
      seat: { Recliner: 1, Premier: 1 },
      location: { 'Greater London': 2, Aberdeen: 1 },
    });
    expect(q.screenOf(db, 'odeon-155/155-1')).toEqual({ cinema: 'West End', screen: 'Screen 1', capacity: 300 });
    expect(found(['seat'], { seat: 'Recliner Saver' }).ids).toEqual([]);
  });

  test('ticked cinemas and hidden films narrow every column', () => {
    expect(found(['film', 'cinema'], {}, { ...scope, cinemas: ['odeon-001'] })).toEqual({ counts: { film: { 'odeon-F1': 1 }, cinema: { 'odeon-001': 1 } }, ids: ['001-1'] });
    expect(found(['film'], {}, { ...scope, hidden: ['odeon-F1'] }).ids).toEqual(['155-2']);
    expect(q.titles(db, ['odeon-F2', 'odeon-F1'])).toEqual([{ id: 'odeon-F1', title: 'Dune' }, { id: 'odeon-F2', title: 'Paddington' }]);
  });

  test('showtimes are searched and ordered, and a search leaves the counts alone', () => {
    expect(found(['film'], {}, scope, 'imax')).toEqual({ counts: { film: { 'odeon-F1': 2, 'odeon-F2': 1 } }, ids: ['155-1'] });
    expect(found([], {}, scope, 'aberdeen').ids).toEqual(['001-1']);
    const ids = (sort: string, descending = false) => q.arrange(q.find(db, scope, [], {}).shows, sort, descending).rows.map((row) => row.id);
    // Screen 1, Screen 10, then the named screen.
    expect(ids('screen')).toEqual(['155-1', '001-1', '155-2']);
    expect(ids('screen', true)).toEqual(['155-2', '001-1', '155-1']);
    expect(ids('seats')[0]).toBe('155-1');
    expect(ids('film', true)[0]).toBe('155-2');
    const first = q.arrange(q.find(db, scope, [], {}).shows, 'date', false, 1);
    expect([first.total, first.rows.length]).toEqual([3, 1]);
    expect(first.rows[0]).toMatchObject({ id: '155-1', experiences: ['IMAX'], capacity: 300, cinema: 'ODEON London West End', short: 'West End', soldOut: false });
  });

  test('films carry their ratings and people', () => {
    const film = q.film(db, 'odeon-F1')!;
    expect([film.imdb, film.metacritic, film.genres, film.people[0].name, film.imdbId]).toEqual([8.4, 74, ['Sci-Fi'], 'Denis Villeneuve', 'tt1']);
    expect(q.film(db, 'nope')).toBeNull();
  });

  test('one showing carries what its details and a calendar entry need', () => {
    expect(q.showing(db, 'odeon-155', '155-1')).toMatchObject({
      title: 'Dune', cinema: 'ODEON London West End', runtime: 155, capacity: 300,
      seating: ['Recliner', 'Premier'], address: { city: 'London' }, filmEndsAt: null,
    });
    expect(q.showing(db, 'odeon-155', 'gone')).toBeNull();
  });

  test('editions of one film are merged, and event cinema can be left out', () => {
    sqlite.exec(`
      INSERT INTO films VALUES ('F1-IE', 'DUNE ', 150, '12', '2026-11-06', '[]', '[]', 'Warner IR', '', NULL),
                               ('F4', 'Live: Opera!', 180, '', '2026-11-01', '[]', '[]', '', '', NULL),
                               ('F4-IE', 'Live Opera', 180, '', '2026-11-01', '[]', '[]', '', '', NULL),
                               ('F5', 'Screen Hire - 4 Hours', 240, '', '2026-11-01', '["Musical "]', '[]', '', '', NULL);
      INSERT INTO ratings VALUES ('F4-IE', 'imdb', 7.1, 'tt4');
      INSERT INTO availability VALUES ('001', 'F1-IE', '["NowShowing"]');
    `);
    screening('001-2', '001', 'F1-IE', '2026-11-21', '20:00');
    screening('155-3', '155', 'F4', '2026-11-12', '19:00', { experiences: '["Event Cinema"]' });
    screening('155-4', '155', 'F4', '2026-11-13', '19:00', { experiences: '["Event Cinema"]' });
    screening('001-3', '001', 'F4-IE', '2026-11-12', '19:00'); // an event even where a showing lacks the tag
    screening('001-4', '001', 'F5', '2026-11-12', '09:00', { experiences: '["3D - Web "]' }); // private hire, and names that end in a space
    db = q.open(exportListings([{ chain: odeon, sqlite }]));
    expect(q.film(db, 'odeon-F5')!.genres).toEqual(['Musical']);
    expect(found(['picture'], { picture: '3D' }).ids).toEqual(['001-4']); // ODEON's "3D - Web ", as the chain names it
    const quiet = { ...scope, noEvents: true };
    expect(found(['film'], {}, quiet).counts.film).toEqual({ 'odeon-F1': 3, 'odeon-F2': 1 });
    expect(found(['film']).counts.film).toEqual({ 'odeon-F1': 3, 'odeon-F2': 1, 'odeon-F4': 3, 'odeon-F5': 1 });
    expect(q.film(db, 'odeon-F1-IE')).toBeNull();
    expect(q.film(db, 'odeon-F4')!.imdb).toBe(7.1);
    expect(q.film(db, 'odeon-F1')!.runtime).toBe(155); // the edition with more showings keeps its own
    // The film is an event at cinema 001 too, though only cinema 155's showings carry the tag.
    db = q.open(exportListings([{ chain: odeon, sqlite }], new Set(['odeon-001'])));
    expect(found(['film'], {}, quiet).counts.film).toEqual({ 'odeon-F1': 2 });
  });

  test('listings for some cinemas keep every cinema and film, but only their showings', () => {
    db = q.open(exportListings([{ chain: odeon, sqlite }], new Set(['odeon-001'])));
    expect(found([]).ids).toEqual(['001-1']);
    expect(db.cinemas.map((cinema) => cinema.name)).toEqual(['ODEON London West End', 'ODEON Aberdeen']);
    expect(q.film(db, 'odeon-F2')?.title).toBe('Paddington');
  });

  test('double bills are the films that end just before or start just after', () => {
    const timed = (id: string, film: string, start: string, end: string) => sqlite
      .prepare("INSERT INTO screenings VALUES ('155', ?, ?, '2026-11-12', ?, ?, ?, ?, 'Screen 1', '155-1', '[]', '[]', 0)")
      .run(id, film, `2026-11-12T${start}:00Z`, start, `2026-11-12T${start}:00Z`, `2026-11-12T${end}:00Z`);
    timed('A', 'F1', '18:00', '20:30');
    timed('B', 'F2', '20:50', '22:30'); // 20 minutes after A ends
    timed('C', 'F2', '21:30', '23:10'); // an hour after: too long a wait
    timed('D', 'F1', '20:40', '23:10'); // the same film
    timed('E', 'F2', '16:00', '17:40'); // ends 20 minutes before A starts
    db = q.open(exportListings([{ chain: odeon, sqlite }]));
    const near = q.around(db, scope, 'odeon-155', 'A');
    expect(near.after.map((row) => [row.id, row.gap])).toEqual([['B', 20]]);
    expect(near.before.map((row) => [row.id, row.gap])).toEqual([['E', 20]]);
    expect(q.around(db, { ...scope, hidden: ['odeon-F2'] }, 'odeon-155', 'A').after).toEqual([]);
  });

  test('the last successful ingest is reported', () => {
    expect(db.ingested).toBe('2026-11-10T05:00:00Z');
    // The week published on Tuesday 10 November runs to Thursday 19.
    expect(db.fullUntil).toBe('2026-11-19');
  });
});
