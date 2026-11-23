// The kinds of column a visitor can show, and the parts of a showtime row.
import { type Field, type Order } from './choices';
import { clock, DATE, day } from './format';
import * as q from './queries';
import { db, scope, view } from './state';
import { certificateAge, formats } from './tags';

// ---- The kinds of column ----------------------------------------------------

interface Kind {
  title: string;
  /** What it lets a visitor choose by, for the columns panel. */
  about: string;
  /** How a choice reads, and a note beside its count. */
  label(value: string): [name: string, note: string];
  /** What the notes are, for the heading over them. */
  notes?: string | (() => string);
  /** The column's own order. */
  natural(values: string[], counts: Map<string, number>): string[];
}
const alphabetical = (kind: () => Kind) => (values: string[]) =>
  [...values].sort((a, b) => kind().label(a)[0].toLowerCase().localeCompare(kind().label(b)[0].toLowerCase()));
const busiest = (values: string[], counts: Map<string, number>) => [...values].sort((a, b) => counts.get(b)! - counts.get(a)!);
const plain = (value: string): [string, string] => [value, ''];
const tag = (value: string): [string, string] => [value, ''];
const cinemaNames = () => new Map(db.cinemas.map((cinema) => [cinema.id, cinema.short]));
/** With more than one chain, a cinema's chain, for a note beside its name: two chains may each have a West End.
 * Once a chain is picked, every cinema left is that chain's, so the note would only repeat it. */
const chainOf = (cinemaId: string) => {
  if (db.chains.size < 2 || view.picks.chain?.length === 1) return '';
  const chain = cinemaChains.get(cinemaId);
  return chain ? db.chains.get(chain)?.name ?? chain : '';
};
let cinemaChains = new Map<string, string>();
export let names = new Map<string, string>();
/** Each cinema's short name and chain, from the listings drawn. */
export function learnCinemas() {
  names = cinemaNames();
  cinemaChains = new Map(db.cinemas.map((cinema) => [cinema.id, cinema.chain]));
}

export const KINDS: Record<q.Facet, Kind> = {
  day: {
    title: 'Day', about: 'today, this weekend or any date',
    label: (value) => (value === 'weekend' ? ['This weekend', ''] : [value === scope().today ? 'Today' : day(value), '']),
    natural: (values) => {
      const dates = values.filter((value) => value !== 'weekend').sort();
      if (values.includes('weekend')) dates.splice(dates[0] === scope().today ? 1 : 0, 0, 'weekend');
      return dates;
    },
  },
  film: {
    title: 'Film', about: 'every film, with its IMDb rating', notes: 'IMDb',
    label: (value) => {
      const film = q.film(db, value);
      return [film?.title ?? value, film?.imdb ? `★${film.imdb.toFixed(1)}` : ''];
    },
    natural: alphabetical(() => KINDS.film),
  },
  cinema: { title: 'Cinema', about: 'each cinema', notes: () => (db.chains.size > 1 && view.picks.chain?.length !== 1 ? 'chain' : ''), label: (value) => [names.get(value) ?? value, chainOf(value)], natural: alphabetical(() => KINDS.cinema) },
  location: { title: 'Location', about: 'towns and cities, and Greater London', label: plain, natural: alphabetical(() => KINDS.location) },
  picture: { title: 'Picture', about: 'IMAX, Dolby, 3D, Laser and the like', label: tag, natural: busiest },
  language: { title: 'Language', about: 'subtitles, captions and the language spoken', label: tag, natural: busiest },
  access: { title: 'Accessibility', about: 'audio description, wheelchair access and more', label: tag, natural: busiest },
  event: { title: 'Events', about: 'Kids, Newbies, Silver and other specials', label: tag, natural: busiest },
  seat: { title: 'Seating', about: 'recliners, Luxe, VIP beds and the like', label: plain, natural: busiest },
  screen: {
    title: 'Screen', about: 'each screen, biggest first',
    label: (key) => {
      const screen = q.screenOf(db, key);
      if (!screen) return [key, ''];
      // The screen first, so that a narrow column cuts the cinema's name, not the screen's.
      return [`${screen.screen.replace(/^Screen /, '#')} ${screen.cinema}`, screen.capacity ? `${screen.capacity} seats` : ''];
    },
    natural: (values) => [...values].sort((a, b) => (q.screenOf(db, b)?.capacity ?? -1) - (q.screenOf(db, a)?.capacity ?? -1)),
  },
  cert: {
    title: 'Certificate', about: 'U, PG, 12A, 15, 18',
    label: plain, natural: (values) => [...values].sort((a, b) => (certificateAge(a) ?? 99) - (certificateAge(b) ?? 99) || a.localeCompare(b)),
  },
  genre: { title: 'Genre', about: 'drama, comedy, animation…', label: plain, natural: alphabetical(() => KINDS.genre) },
  person: { title: 'People', about: 'directors and cast', label: plain, natural: busiest },
  distributor: { title: 'Distributor', about: 'the studio that releases the film', label: plain, natural: alphabetical(() => KINDS.distributor) },
  release: {
    title: 'Release', about: 'out now, or opening soon',
    label: (value) => [value === 'soon' ? 'Opening soon' : 'Out now', ''],
    natural: (values) => ['out', 'soon'].filter((value) => values.includes(value)),
  },
  chain: {
    title: 'Chain', about: 'which cinema chain',
    label: (value) => [db.chains.get(value)?.name ?? value, ''],
    natural: alphabetical(() => KINDS.chain),
  },
};
/** The parts of a showtime row: a heading, what it reads for a showtime, how wide it may grow, and the order it sorts by. */
interface Part { head: string; text(row: q.Showing): string; track: string; sort?: string; }
export const PARTS: Record<'day' | 'time' | 'film' | Field, Part> = {
  day: { head: 'Day', text: (row) => DATE.format(new Date(row.startsAt)), track: 'max-content', sort: 'date' },
  time: { head: 'Time', text: (row) => row.time, track: 'max-content', sort: 'time' },
  ends: { head: 'Ends', text: (row) => clock(row.endsAt), track: 'max-content' },
  film: { head: 'Film', text: (row) => row.title, track: 'minmax(auto, 1fr)', sort: 'film' },
  picture: { head: 'Picture', text: (row) => formats(row.experiences, ['Picture']), track: 'minmax(auto, 7ch)' },
  language: { head: 'Language', text: (row) => formats(row.experiences, ['Language']), track: 'minmax(auto, 8ch)' },
  access: { head: 'Access', text: (row) => formats(row.experiences, ['Accessibility']), track: 'minmax(auto, 8ch)' },
  cert: { head: 'Cert', text: (row) => q.film(db, row.filmId)?.certificate || '', track: 'max-content' },
  chain: { head: 'Chain', text: (row) => db.chains.get(row.chain)?.name ?? row.chain, track: 'max-content', sort: 'chain' },
  cinema: { head: 'Cinema', text: (row) => row.short, track: 'minmax(auto, 11ch)', sort: 'cinema' },
  screen: { head: 'Screen', text: (row) => row.screen.replace(/^Screen /, '#'), track: 'minmax(auto, 5ch)', sort: 'screen' },
  seats: { head: 'Seats', text: (row) => (row.capacity ? String(row.capacity) : ''), track: 'max-content', sort: 'seats' },
};
/** When the showtimes are too wide for their column, these are left out first. */
export const LEAST_NEEDED: Field[] = ['language', 'access', 'cert', 'ends', 'picture', 'screen', 'chain', 'cinema'];
export const FIELD_ABOUT: Record<Field, string> = {
  ends: 'when the film ends', picture: 'IMAX, 3D and the like', language: 'subtitles, dubbing and audio', access: 'audio description, relaxed and the like',
  cert: 'the age certificate', chain: 'which cinema chain', cinema: 'which cinema', screen: 'which screen', seats: 'how many seats the screen has',
};

export const ORDERS: Record<Order, string> = { name: 'A–Z', count: 'most', rating: '★' };
export function ordered(facet: q.Facet, values: string[], counts: Map<string, number>, order: Order): string[] {
  if (order === 'count') return busiest(values, counts);
  if (order === 'rating') return [...values].sort((a, b) => (q.film(db, b)?.imdb ?? -1) - (q.film(db, a)?.imdb ?? -1));
  return KINDS[facet].natural(values, counts);
}
export const ordersOf = (facet: q.Facet): Order[] => (facet === 'film' ? ['name', 'count', 'rating'] : ['name', 'count']);
