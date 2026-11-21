// Listings for the browser tests: a small database built from the ingest's own
// schema and exported the way the site's build does it. Days are counted from
// today, so the showings are always still to come.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { everyman } from '../src/chains/boxoffice.ts';
import { odeon } from '../src/chains/odeon.ts';
import { exportListings, type Source } from '../src/export.ts';

const store = readFileSync(new URL('../../ingest/src/showtimes_ingest/store.py', import.meta.url), 'utf8');
const SCHEMA = /SCHEMA = """([\s\S]*?)"""/.exec(store)![1];

export const day = (ahead: number) => new Date(Date.now() + ahead * 86400000).toISOString().slice(0, 10);

/** ODEON's listings, and with `alsoEveryman` a second chain beside them. */
export function listings(alsoEveryman = false): { all: string; london: string } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  sqlite.exec(`
    INSERT INTO cinemas VALUES ('155', 'London West End', 1, '{"city":"London","line1":"Leicester Square"}', 51.5, -0.1),
                               ('090', 'Holloway', 1, '{"city":"London"}', 51.6, -0.1),
                               ('001', 'Aberdeen', 1, '{"city":"Aberdeen"}', NULL, NULL);
    INSERT INTO films VALUES ('F1', 'Dune', 155, '12A', '2026-01-01', '["Sci-Fi"]', '[{"name":"Denis Villeneuve","roles":["Director"]}]', 'Warner', 'Sand.', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'),
                             ('F1-IE', 'DUNE', 155, '12', '2026-01-01', '[]', '[]', 'Warner IR', '', NULL),
                             ('F2', 'Paddington', 100, 'PG', '2026-01-01', '["Family"]', '[]', 'Studio', 'A bear.', NULL),
                             ('F3', 'Opera Live', 180, '', '2026-01-01', '[]', '[]', 'Stage', '', NULL);
    INSERT INTO screens VALUES ('155', '155-1', 300), ('090', '090-1', 120);
    INSERT INTO ratings VALUES ('F1', 'imdb', 8.4, 'tt1');
    INSERT INTO runs (source, started_at, finished_at, status) VALUES ('odeon', 'a', '${new Date().toISOString().slice(0, 19)}Z', 'ok');
  `);
  const add = sqlite.prepare('INSERT INTO screenings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
  const showing = (cinema: string, id: string, film: string, ahead: number, start: string, end: string, tags: string[] = []) =>
    add.run(cinema, id, film, day(ahead), `${day(ahead)}T${start}:00Z`, start, `${day(ahead)}T${start}:00Z`, `${day(ahead)}T${end}:00Z`,
      'Screen 1', `${cinema}-1`, JSON.stringify(tags), '["Recliner"]');
  showing('155', 'A', 'F1', 1, '18:00', '20:35', ['IMAX']);
  showing('155', 'B', 'F2', 1, '20:50', '22:30'); // fifteen minutes after A ends
  showing('090', 'C', 'F1', 2, '19:00', '21:35');
  showing('001', 'D', 'F1-IE', 2, '19:00', '21:35');
  showing('155', 'E', 'F3', 3, '19:00', '22:00', ['Event Cinema']);
  // Enough of one film to need more than one batch of rows.
  for (let n = 0; n < 250; n += 1) showing('090', `P${n}`, 'F2', 3 + Math.floor(n / 10), `${String(10 + (n % 10)).padStart(2, '0')}:00`, `${String(11 + (n % 10)).padStart(2, '0')}:40`);
  const sources: Source[] = [{ chain: odeon, sqlite }];
  if (alsoEveryman) {
    // Everyman: one London cinema and one elsewhere, Dune (one film with ODEON's) and a film of its own.
    const second = new DatabaseSync(':memory:');
    second.exec(SCHEMA);
    second.exec(`
      INSERT INTO cinemas VALUES ('X1', 'Hampstead', 1, '{"line1":"5 Holly Bush Vale","city":"London","postcode":"NW3 6TX"}', 51.55, -0.18),
                                 ('X2', 'Bath', 1, '{"city":"Bath","postcode":"BA1 1SS"}', 51.38, -2.36);
      INSERT INTO films VALUES ('6272', 'Dune', 155, '12A', '2026-01-01', '[]', '[]', 'Warner', '', NULL),
                               ('77', 'Wicker', 105, '15', '2026-01-01', '[]', '[]', 'Black Bear', '', NULL);
      INSERT INTO runs (source, started_at, finished_at, status) VALUES ('everyman', 'a', '${new Date().toISOString().slice(0, 19)}Z', 'ok');
    `);
    const show = second.prepare('INSERT INTO screenings VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0)');
    show.run('X1', 'uuid-1', '6272', day(1), `${day(1)}T17:00:00Z`, '17:00', 'Screen 1', '1', '["Format.Projection.Laser","Format.Projection.Digital"]', '[]');
    show.run('X2', 'uuid-2', '77', day(1), `${day(1)}T19:30:00Z`, '19:30', 'Screen 2', '2', '["Showtime.Accessibility.Subtitled"]', '[]');
    sources.push({ chain: everyman, sqlite: second });
  }
  const all = exportListings(sources);
  const london = all.cinemas.filter((cinema) => cinema.town === 'Greater London').map((cinema) => cinema.id);
  return { all: JSON.stringify(all), london: JSON.stringify(exportListings(sources, new Set(london))) };
}
