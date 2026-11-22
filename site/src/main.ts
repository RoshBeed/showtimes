// The site is one finder: columns of choices side by side, each counting what the
// others leave, then the showtimes that match, then the highlighted one's details.
// The visitor picks which columns to show and in what order, and all of it is in
// the page's address, so a bookmark is a saved view. Driven by keys, clicks or taps.
import { ics } from './calendar';
import { DEFAULT_COLUMNS, DEFAULT_FIELDS, expandArea, FIELDS, learnLondon, LONDON, needsEveryCinema, PAGE, readChoice, readView, writeChoices, writeView, type Field, type Order, type View } from './choices';
import { openListings } from './db';
import * as q from './queries';
import { certificateAge, formats } from './tags';
import { REPO, VERSION, versionHref, versionLabel } from './version';


let db: q.Listings;
/** Whether `db` holds every cinema's showings, or only Greater London's. */
let whole = false;
let everything: Promise<void> | undefined;
const app = document.getElementById('app')!;
const narrow = matchMedia('(max-width: 640px)');

// ---- What is shown at all, kept in the query string ------------------------

const ticks = readChoice(location.search, 'cinemas');
const hidden = readChoice(location.search, 'hidden');
/** What the visitor has asked to see that is otherwise left out: `events`. */
const extras = readChoice(location.search, 'show');
function address() {
  const search = writeChoices({ cinemas: ticks, hidden, show: extras });
  if (search !== location.search) history.replaceState(null, '', location.pathname + search + location.hash);
}
function toggle(set: Set<string>, ids: string[], on?: boolean) {
  for (const id of ids) {
    if (on ?? !set.has(id)) set.add(id);
    else set.delete(id);
  }
  address();
}
/** Whether the ticked cinemas are Greater London's, no more and no fewer. */
const londonOnly = () => ticks.size === LONDON.size && [...LONDON].every((id) => ticks.has(id));

function scope(): q.Scope {
  return {
    cinemas: [...ticks],
    hidden: [...hidden],
    noEvents: !extras.has('events'),
    now: new Date().toISOString().slice(0, 19) + 'Z',
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()),
  };
}

// ---- Dates and small helpers ----------------------------------------------

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Europe/London' });
const DAY_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
/** `Mon 16 Nov` for a stored time or a plain date. */
function day(value: string | null): string {
  if (!value) return '–';
  return DAY.format(new Date(value.length === 10 ? value + 'T12:00:00Z' : value)).replace(',', '');
}
const fullDate = (value: string | null) => (value ? DAY_YEAR.format(new Date(value + 'T12:00:00Z')) : '–');
const clock = (value: string | null) => (value ? TIME.format(new Date(value)) : '');

function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
function button(label: string, act: () => void, props: Record<string, string> = {}): HTMLButtonElement {
  const element = h('button', { type: 'button', ...props }, label) as HTMLButtonElement;
  element.onclick = act;
  return element;
}
function checkbox(label: string | Node, checked: boolean, change: (on: boolean) => void, mixed = false): HTMLElement {
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
  box.checked = checked;
  box.indeterminate = mixed;
  box.onchange = () => change(box.checked);
  return h('label', { class: 'check' }, box, label);
}
/** The title goes back to the default view, keeping the cinemas and films chosen in the settings. */
function home(): HTMLElement {
  const element = h('a', { href: location.pathname + location.search }, 'showtimes');
  element.onclick = (event) => {
    event.preventDefault();
    if (location.hash) history.pushState(null, '', location.pathname + location.search);
    render();
  };
  return element;
}
/** The link to book a showing on its chain's site, named after the site: `Book on odeon.co.uk`. */
function bookingLink(show: { cinemaId: string; id: string }): Node[] {
  const url = q.booking(db, show);
  if (!url) return [];
  // The site, not its booking subdomain: purchase.everymancinema.com is everymancinema.com.
  const host = new URL(url).hostname.split('.');
  return [link(`Book on ${host.slice(-(host.at(-2) === 'co' ? 3 : 2)).join('.')}`, url)];
}
const link = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
const count = (n: number, noun: string) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
const facts = (pairs: [string, Node | string][]) =>
  h('dl', {}, ...pairs.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)]));
const bar = (title: string, ...beside: Node[]) => h('div', { class: 'bar' }, h('h2', { title }, title), ...beside);

function addToCalendar(cinema: string, id: string) {
  const show = q.showing(db, cinema, id);
  if (!show) return;
  const address = URL.createObjectURL(new Blob([ics(show)], { type: 'text/calendar' }));
  const anchor = h('a', { href: address, download: `${show.title.replace(/[^\w]+/g, '-')}.ics` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(address), 1000);
}

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
  if (db.chains.size < 2 || view.picks.chain) return '';
  const chain = cinemaChains.get(cinemaId);
  return chain ? db.chains.get(chain)?.name ?? chain : '';
};
let cinemaChains = new Map<string, string>();
let names = new Map<string, string>();

const KINDS: Record<q.Facet, Kind> = {
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
  cinema: { title: 'Cinema', about: 'each cinema', notes: () => (db.chains.size > 1 && !view.picks.chain ? 'chain' : ''), label: (value) => [names.get(value) ?? value, chainOf(value)], natural: alphabetical(() => KINDS.cinema) },
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
const PARTS: Record<'day' | 'time' | 'film' | Field, Part> = {
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
const LEAST_NEEDED: Field[] = ['language', 'access', 'cert', 'ends', 'picture', 'screen', 'chain', 'cinema'];
const FIELD_ABOUT: Record<Field, string> = {
  ends: 'when the film ends', picture: 'IMAX, 3D and the like', language: 'subtitles, dubbing and audio', access: 'audio description, relaxed and the like',
  cert: 'the age certificate', chain: 'which cinema chain', cinema: 'which cinema', screen: 'which screen', seats: 'how many seats the screen has',
};

const ORDERS: Record<Order, string> = { name: 'A–Z', count: 'most', rating: '★' };
function ordered(facet: q.Facet, values: string[], counts: Map<string, number>, order: Order): string[] {
  if (order === 'count') return busiest(values, counts);
  if (order === 'rating') return [...values].sort((a, b) => (q.film(db, b)?.imdb ?? -1) - (q.film(db, a)?.imdb ?? -1));
  return KINDS[facet].natural(values, counts);
}
const ordersOf = (facet: q.Facet): Order[] => (facet === 'film' ? ['name', 'count', 'rating'] : ['name', 'count']);

// ---- The finder ---------------------------------------------------------------

let view: View;
/** The page as drawn: what the keys act on. */
let page: {
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
/** The address last drawn; a change from elsewhere (going back, an edited address) draws again. */
let drawn = '';
let fitting: ResizeObserver | undefined;
/** Earlier states of the address, for u to go back to and Ctrl-r to come forward to again. */
interface State { key: string; href: string }
const undos: State[] = [];
const redos: State[] = [];
let recorded: State | undefined;
let noting = 0;
/** Put the view in the address after a short pause: browsers limit how often an address may change. */
function note() {
  clearTimeout(noting);
  noting = window.setTimeout(noteNow, 300);
}
function noteNow() {
  clearTimeout(noting);
  const hash = writeView(view);
  if (hash !== location.hash) history.replaceState(null, '', location.pathname + location.search + hash);
  drawn = location.hash;
  // A change to what is chosen or shown can be undone; moving the highlight alone cannot.
  const key = location.search + writeView({ ...view, focus: 0, row: 0 });
  if (recorded && key !== recorded.key) {
    undos.push(recorded);
    redos.length = 0;
  }
  recorded = { key, href: location.search + location.hash };
}
/** Change the columns themselves, then draw the finder again. */
function rebuild() {
  noteNow();
  render();
}

const lastColumn = () => view.columns.length + (narrow.matches ? 1 : 0); // a phone shows the details as a column of their own

function render() {
  address();
  drawn = location.hash;
  if (!whole && needsEveryCinema(ticks)) {
    app.querySelector('.status')?.replaceChildren('loading every cinema…');
    everything ??= load(true);
    return;
  }
  if (!db) return; // still downloading; load() draws the page when it arrives
  names = cinemaNames();
  cinemaChains = new Map(db.cinemas.map((cinema) => [cinema.id, cinema.chain]));
  view = readView(location.hash);
  view.focus = Math.min(view.focus, lastColumn());
  recorded ??= { key: location.search + writeView({ ...view, focus: 0, row: 0 }), href: location.search + location.hash }; // where undo stops
  const columns = view.columns;
  const results = columns.length;
  const details = results + 1;
  const filters = page?.filters.length === columns.length + 1 ? page.filters : columns.map(() => '').concat(view.text);
  filters[results] = view.text;

  const searches = [...columns, 'showtimes'].map((_, index) => {
    const input = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search this column' }) as HTMLInputElement;
    input.value = filters[index];
    input.oninput = () => {
      filters[index] = input.value;
      view.focus = index;
      if (index === results) { view.text = input.value; view.row = 0; state.more = 0; }
      draw();
    };
    return input;
  });
  /** A column's search box, and the button that opens it. */
  const finding = (index: number) => [searches[index], button('⌕', () => { view.focus = index; mark(); searches[index].focus(); }, { class: 'find', 'aria-label': 'Search this column' })];
  const sorters = columns.map((facet) => button(ORDERS[view.orders[facet] ?? 'name'], () => cycle(facet), { title: 'Order this column', class: 'order' }));
  /** A heading over a sortable part of the showtimes: the first click orders by it, the next reverses. */
  const sortBy = (sort: string) => {
    if (view.sort === sort) view.descending = !view.descending;
    else { view.sort = sort; view.descending = false; }
    view.row = 0;
    state.more = 0;
    draw();
  };

  const lists = columns.map(() => h('ul', { class: 'facet' }));
  const shows = h('ul', { class: 'cards' });
  const total = h('span', { class: 'dim count' });
  const detail = h('div', { class: 'column details' });
  const panes = [
    ...columns.map((facet, index) => h('div', { class: `column ${facet}` }, bar(KINDS[facet].title, ...finding(index), sorters[index]), lists[index])),
    h('div', { class: 'column showtimes' }, bar('Showtimes', ...finding(results), total), shows),
    detail,
  ];
  panes[results].addEventListener('scroll', () => {
    const column = panes[results];
    if (state.rows.length < state.total && column.scrollTop + column.clientHeight > column.scrollHeight - 600) { state.more += 1; draw(); }
  }, { passive: true });
  // On a phone one column shows at a time; these steps name each, with what is chosen in it.
  const steps = h('nav', { class: 'steps' });

  document.title = 'showtimes';
  app.className = 'finder-page';
  app.replaceChildren(
    h('header', {},
      h('h1', {}, home()),
      button('Settings', openPanel, { class: 'open-panel', 'aria-keyshortcuts': 'o' })),
    steps,
    h('div', { class: 'columns finder' }, ...panes),
    footer(['hjkl move', '/ search', 'u undo', ':vs add a column', ':set settings', ':help all keys']),
  );

  const state = {
    options: [] as (string | undefined)[][],
    rows: [] as q.Showing[],
    parts: [] as (keyof typeof PARTS)[],
    total: 0,
    more: Math.floor(view.row / PAGE),
    filters,
    draw,
    mark,
    focusSearch: () => searches[Math.min(view.focus, results)].focus(),
  };
  page = state;

  function cycle(facet: q.Facet) {
    const orders = ordersOf(facet);
    const next = orders[(orders.indexOf(view.orders[facet] ?? 'name') + 1) % orders.length];
    if (next === 'name') delete view.orders[facet];
    else view.orders[facet] = next;
    sorters[columns.indexOf(facet)].textContent = ORDERS[next];
    draw();
  }

  function draw() {
    const found = q.find(db, scope(), columns, view.picks, view.text);
    state.options = columns.map((facet, index) => {
      const counted = found.counts[index];
      const order = view.orders[facet] ?? 'name';
      let values = ordered(facet, [...counted.keys()], counted, order);
      const picked = view.picks[facet];
      if (picked && !values.includes(picked)) values.unshift(picked); // a choice the others have emptied stays in view
      const needle = filters[index].toLowerCase();
      if (needle) values = values.filter((value) => value === picked || KINDS[facet].label(value)[0].toLowerCase().includes(needle));
      // Days past the published week are set apart, once, instead of each saying so.
      const advance = facet === 'day' && order === 'name' && db.fullUntil ? values.find((value) => value !== 'weekend' && value > db.fullUntil!) : undefined;
      const all = [undefined, ...values];
      const heads = h('li', { class: 'heads', 'aria-hidden': 'true' }, h('span', {}), h('span', {}, typeof KINDS[facet].notes === 'function' ? (KINDS[facet].notes as () => string)() : KINDS[facet].notes ?? ''), h('span', {}, 'showings'));
      lists[index].replaceChildren(heads, ...all.flatMap((value) => {
        const [name, note] = value === undefined ? ['All', ''] : KINDS[facet].label(value);
        const item = h('li', { class: [value === picked ? 'selected' : '', value === undefined ? 'pinned' : ''].join(' '), title: name },
          h('strong', {}, name),
          h('span', { class: 'dim' }, note),
          h('span', { class: 'dim count' }, value === undefined ? '' : (counted.get(value) ?? 0).toLocaleString('en-GB')));
        item.onclick = () => {
          view.focus = index;
          choose(facet, value);
          if (narrow.matches) { view.focus = index + 1; mark(); } // on a phone any choice, All too, moves on
        };
        return value !== undefined && value === advance ? [h('li', { class: 'note' }, 'advance bookings only'), item] : [item];
      }));
      return all;
    });

    const arranged = q.arrange(found.shows, view.sort, view.descending, (state.more + 1) * PAGE);
    state.rows = arranged.rows;
    state.total = arranged.total;
    view.row = Math.min(view.row, Math.max(state.rows.length - 1, 0));
    total.textContent = state.total.toLocaleString('en-GB');
    // In date order the showtimes are headed day by day, unless one day is chosen.
    const oneDay = Boolean(view.picks.day && view.picks.day !== 'weekend');
    const headed = view.sort === 'date' && !view.descending && !oneDay;
    // Each showtime is a row of parts under headings. A part that is the same in every row is left out:
    // the day under day headings, the film or cinema when one is chosen.
    const parts = [
      ...(headed || oneDay ? [] : ['day' as const]),
      'time' as const,
      ...(view.picks.film ? [] : ['film' as const]),
      ...view.fields.filter((field) => !(field === 'cinema' && view.picks.cinema)),
    ];
    // The film sits after the time and its end, before the rest.
    const film = parts.indexOf('film');
    if (film >= 0 && parts.includes('ends')) parts.splice(parts.indexOf('ends') + 1, 0, ...parts.splice(film, 1));
    const heads = h('li', { class: 'heads' }, ...parts.map((part) => {
      const { head, sort } = PARTS[part];
      if (!sort) return h('span', { class: part }, head);
      const on = view.sort === sort;
      return button(on ? `${head} ${view.descending ? '▼' : '▲'}` : head, () => sortBy(sort), {
        class: `${part}${on ? ' on' : ''}`, 'aria-label': `Order by ${head.toLowerCase()}${on ? ', reversed' : ''}`,
      });
    }));
    shows.replaceChildren(
      heads,
      ...state.rows.flatMap((row, index) => {
        const ends = clock(row.endsAt);
        const item = h('li', { class: ['show', index === view.row ? 'selected' : '', row.soldOut ? 'sold' : ''].join(' ') },
          ...parts.map((part) => {
            const text = PARTS[part].text(row);
            return part === 'film' || (part === 'time' && view.picks.film)
              ? h('strong', { class: part }, text, ...(row.soldOut && part !== 'time' ? [h('span', { class: 'dim' }, ' sold out')] : []))
              : h('span', { class: part === 'time' ? 'time' : `${part} dim`, title: text }, text);
          }));
        item.title = `${row.title} · ${day(row.startsAt)} ${row.time}${ends ? '–' + ends : ''} · ${row.cinema} · ${row.screen}${row.capacity ? ` · ${row.capacity} seats` : ''}`;
        item.onclick = () => { view.focus = narrow.matches ? details : results; view.row = index; mark(); };
        const heading = headed && row.date !== state.rows[index - 1]?.date
          ? [h('li', { class: 'day' }, day(row.date) + (db.fullUntil && row.date > db.fullUntil ? ' · advance bookings only so far' : ''))]
          : [];
        return [...heading, item];
      }),
      ...(state.total ? [] : [h('li', { class: 'day' }, ticks.size ? 'Nothing matches every column at your cinemas.' : 'Nothing matches every column.')]),
    );
    state.parts = parts;
    fit();
    mark();
  }

  /** Leave out the least needed details until the showtimes fit their column, as on a phone. */
  function fit() {
    const kept = [...state.parts];
    const keep = () => {
      // Without the film, which stretches, an empty last column takes up the rest of the width.
      shows.style.gridTemplateColumns = [...kept.map((part) => PARTS[part].track), ...(kept.includes('film') ? [] : ['minmax(0, 1fr)'])].join(' ');
      for (const field of LEAST_NEEDED) shows.classList.toggle(`without-${field}`, !kept.includes(field));
    };
    keep();
    if (!shows.clientWidth) return; // not on screen; fitted when it is
    for (const field of LEAST_NEEDED) {
      if (shows.scrollWidth <= shows.clientWidth) break;
      if (kept.includes(field)) { kept.splice(kept.indexOf(field), 1); keep(); }
    }
  }
  fitting?.disconnect();
  fitting = new ResizeObserver(fit);
  fitting.observe(panes[results]);

  /** Mark the focused column and the highlighted showtime, and show its details. */
  function mark() {
    panes.forEach((pane, index) => pane.classList.toggle('focused', index === view.focus));
    shows.querySelector('.selected')?.classList.remove('selected');
    shows.querySelectorAll('li.show')[view.row]?.classList.add('selected');
    for (const pane of panes) pane.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    steps.replaceChildren(...[...columns, 'showtimes', 'details'].map((name, index) => {
      const facet = columns[index];
      const picked = facet && view.picks[facet];
      const label = facet ? `${KINDS[facet].title}: ${picked ? KINDS[facet].label(picked)[0] : 'All'}` : index === results ? `Showtimes ${state.total}` : 'Details';
      const step = button(label, () => { view.focus = index; mark(); }, { class: index === view.focus ? 'here' : '' });
      if (name === 'details' && !state.rows.length) step.disabled = true;
      return step;
    }));
    steps.querySelector('.here')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const shown = state.rows[view.row];
    const film = shown ? q.film(db, shown.filmId) : view.picks.film ? q.film(db, view.picks.film) : null;
    detail.replaceChildren(
      ...(shown ? showingDetails(shown) : film ? [bar(film.title)] : [bar('Details'), quickStart()]),
      ...(film ? filmDetails(film) : []),
    );
    note();
  }

  function choose(facet: q.Facet, value: string | undefined) {
    if (value === undefined) delete view.picks[facet];
    else view.picks[facet] = value;
    view.row = 0;
    state.more = 0;
    draw();
  }

  /** A double bill: choose its film (and keep the cinema and day), and highlight it. */
  function follow(next: q.Neighbour) {
    if (columns.includes('film')) view.picks.film = next.filmId;
    if (view.picks.day && view.picks.day !== next.date) view.picks.day = next.date;
    view.row = 0;
    state.more = 0;
    draw();
    const index = state.rows.findIndex((row) => row.cinemaId === next.cinemaId && row.id === next.id);
    if (index >= 0) { view.row = index; view.focus = narrow.matches ? details : results; mark(); }
  }

  /** The highlighted showtime: when, where, booking, and what else could make a double bill. */
  function showingDetails(row: q.Showing): Node[] {
    const show = q.showing(db, row.cinemaId, row.id);
    if (!show) return [];
    const where = [show.address.line1, show.address.line2, show.address.city].filter(Boolean).join(', ');
    const seats = show.seating;
    const optional = (name: string, value: string): [string, string][] => (value ? [[name, value]] : []);
    const near = q.around(db, { ...scope(), cinemas: [] }, show.cinemaId, show.id);
    const bill = (rows: q.Neighbour[], heading: string) => rows.length ? [
      h('li', { class: 'day' }, heading),
      ...rows.map((next) => {
        const item = h('li', {},
          h('strong', {}, `${next.time}–${clock(next.endsAt)}  ${next.title}`),
          h('span', { class: 'dim' }, `${next.gap} min gap · ${next.screen.replace(/^Screen /, '#')}${next.capacity ? ` · ${next.capacity} seats` : ''}`));
        item.onclick = () => follow(next);
        return item;
      }),
    ] : [];
    return [
      bar(`${show.title} · ${show.time}`),
      h('div', { class: 'intro' },
        facts([
          ['When', `${day(show.startsAt)} at ${show.time}${show.soldOut ? ' · sold out' : ''}`],
          ...optional('Film runs', show.filmStartsAt ? `${clock(show.filmStartsAt)}${show.filmEndsAt ? '–' + clock(show.filmEndsAt) : ''}` : ''),
          ['Cinema', show.cinema],
          ...optional('Address', where),
          ['Screen', `${show.screen}${show.capacity ? ` · ${show.capacity} seats` : ''}`],
          ...optional('Picture', formats(show.experiences, ['Picture'])),
          ...optional('Language', formats(show.experiences, ['Language'])),
          ...optional('Event', formats(show.experiences, ['Events'])),
          ...optional('Seating', seats.join(', ')),
          ...optional('Access', formats(show.experiences, ['Accessibility'])),
        ]),
        h('p', { class: 'actions' }, ...bookingLink(show), button('Add to calendar', () => addToCalendar(show.cinemaId, show.id)))),
      ...(near.after.length || near.before.length
        ? [h('ul', { class: 'cards bills' }, ...bill(near.after, 'Straight after this'), ...bill(near.before, 'Just before this'))]
        : []),
    ];
  }

  draw();
  for (const pane of panes) pane.querySelector('.selected')?.scrollIntoView({ block: 'center' });
}

/** What a film is: its facts, synopsis and trailer, and a way to hide it. */
function filmDetails(film: q.Film): Node[] {
  const named = (role: string) => film.people.filter((person) => person.roles.includes(role)).map((person) => person.name);
  const cast = named('Actor');
  const pairs: [string, Node | string][] = [
    ['Certificate', film.certificate || 'TBC'],
    ['Runtime', film.runtime ? `${film.runtime} minutes` : '–'],
    ['Released', fullDate(film.release)],
    ['Genres', film.genres.join(', ') || '–'],
  ];
  if (film.imdb !== null) pairs.push(['IMDb', film.imdbId ? link(`${film.imdb.toFixed(1)} / 10`, `https://www.imdb.com/title/${film.imdbId}/`) : `${film.imdb.toFixed(1)} / 10`]);
  if (film.metacritic !== null) pairs.push(['Metacritic', `${film.metacritic} / 100`]);
  if (named('Director').length) pairs.push(['Director', named('Director').join(', ')]);
  if (cast.length) pairs.push(['Cast', cast.slice(0, 6).join(', ') + (cast.length > 6 ? ` and ${cast.length - 6} more` : '')]);
  if (film.distributor) pairs.push(['Distributor', film.distributor]);
  return [h('div', { class: 'intro film' },
    h('h3', {}, film.title),
    facts(pairs),
    h('p', { class: 'dim' }, film.synopsis),
    ...(film.trailer ? [trailer(film.trailer)] : []),
    h('p', { class: 'actions' }, button(hidden.has(film.id) ? 'Show this film again' : 'Hide this film', () => hideFilm(film.id))),
  )];
}

/** The trailer, in place: a still that becomes the player when pressed. */
function trailer(address: string): Node {
  const id = /[?&]v=([\w-]{11})/.exec(address)?.[1];
  if (!id) return h('p', { class: 'actions' }, link('Watch the trailer', address));
  const frame = h('div', { class: 'trailer' });
  const still = button('', () => frame.replaceChildren(h('iframe', {
    src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`,
    title: 'Trailer',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowfullscreen: '',
  })), { 'aria-label': 'Play the trailer' });
  still.append(h('img', { src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, alt: '', loading: 'lazy' }), h('span', {}, '▶ Trailer'));
  frame.append(still);
  return frame;
}

function quickStart(): Node {
  return h('div', { class: 'intro' },
    h('p', {}, `What's on at ${db.chains.size ? [...db.chains.values()].map((chain) => chain.name).join(', ') : 'the cinema'}, on which screen, and how big that screen is.`),
    facts([
      ['Choose', 'a day, a film, a cinema… in any column; each counts what the others leave. All at the top takes a choice back.'],
      ['Columns', 'Settings adds, removes and orders them; so do :vs day, :q, << and >>.'],
      ['Keys', 'it is driven as vim is: hjkl, / and n, :set, :sort, u and the rest. :help lists them all.'],
      ['Bookmark', 'the columns, your choices and your cinemas are all in the page address. Bookmark it and it opens the same way anywhere.'],
    ]));
}

function hideFilm(id: string) {
  toggle(hidden, [id]);
  if (view.picks.film === id) delete view.picks.film;
  page?.draw();
}
/** London only on or off; switched over when not said which. */
function setLondon(on = !londonOnly()) {
  choosing = false;
  ticks.clear();
  toggle(ticks, on ? [...LONDON] : [], true);
  rebuild();
  if (panel.open) fillPanel();
}

/** The line at the foot of the page: the keys, and how fresh the listings are. */
function footer(hints: string[]): HTMLElement {
  const stamp = db.ingested;
  const old = stamp !== null && Date.now() - Date.parse(stamp) > 8 * 86400000;
  return h('footer', {},
    h('span', { class: 'keys' }, ...hints.flatMap((hint) => {
      const [keys, ...words] = hint.split(' ');
      return [h('kbd', {}, keys), ` ${words.join(' ')}   `];
    })),
    h('span', { class: 'status' },
      `listings from ${stamp ? day(stamp) : 'no ingest yet'}`,
      ...(db.fullUntil ? [` · full to ${day(db.fullUntil)}`] : []),
      ...(old ? [h('span', { class: 'stale' }, ' · more than a week old')] : []),
      ' · ', about()));
}

/** Which version of the site this is, linked to its commit, and the repository on GitHub. */
function about(): HTMLElement {
  return h('span', { class: 'about' },
    h('a', { class: 'version', href: versionHref(), title: VERSION.built ? `built ${VERSION.built}` : '' }, `version ${versionLabel()}`),
    ' · ', h('a', { class: 'github', href: REPO }, 'GitHub'));
}

// ---- Settings: a drawer at the side, so the finder shows each change as it is made ----

const panel = h('dialog', { class: 'panel', 'aria-label': 'Settings' }) as HTMLDialogElement;
document.body.append(panel);
panel.addEventListener('click', (event) => { if (event.target === panel) panel.close(); }); // a click outside it
/** Whether the visitor asked to pick cinemas one by one, before ticking any. */
let choosing = false;
/** What is typed into the cinema search, kept while the drawer is redrawn. */
let cinemaSearch = '';

/** Where the finder looks, in a few words, for the drawer. */
function where(): string {
  if (!ticks.size) return 'Every cinema';
  if (londonOnly()) return 'London only';
  return ticks.size === 1 ? names.get([...ticks][0]) ?? '1 cinema' : count(ticks.size, 'cinema');
}

function openPanel() {
  noteNow();
  choosing = false;
  fillPanel();
  panel.showModal();
}

/** Apply a change, draw the finder behind, and redraw the drawer where it was, with the same control in hand. */
function changed(apply: () => void) {
  apply();
  rebuild();
  fillPanel();
}

/** Every cinema, the default columns, nothing hidden. */
function startOver() {
  choosing = false;
  for (const chosen of [ticks, hidden, extras]) chosen.clear();
  address();
  Object.assign(view, { columns: [...DEFAULT_COLUMNS], picks: {}, orders: {}, fields: [...DEFAULT_FIELDS], focus: 0, row: 0, sort: 'date', descending: false, text: '' });
}

function fillPanel() {
  const scrolled = panel.scrollTop;
  const held = (document.activeElement as HTMLElement | null)?.dataset.key;
  const heldLine = panel.open ? drawerHere() : -1;
  /** Name a control, so that it has the focus again after the drawer is redrawn. A tick box is named on its box. */
  const keyed = <T extends HTMLElement>(element: T, key: string): T => {
    (element.querySelector('input') ?? element).dataset.key = key;
    return element;
  };
  const shown = view.columns;

  // Where: every cinema, Greater London, or cinemas chosen one by one.
  const mode = !ticks.size && !choosing ? 'all' : londonOnly() && !choosing ? 'london' : 'some';
  const option = (value: string, label: string, note: string, choose: () => void) => {
    const input = keyed(h('input', { type: 'radio', name: 'where', value }) as HTMLInputElement, `where-${value}`);
    input.checked = mode === value;
    input.onchange = () => changed(choose);
    return h('label', { class: `option${mode === value ? ' on' : ''}` }, input, h('strong', {}, label), h('span', { class: 'dim' }, note));
  };
  const places = new Map<string, { id: string; name: string; short: string }[]>();
  for (const cinema of db.cinemas.filter((item) => item.stored)) {
    const town = cinema.town;
    places.set(town, [...(places.get(town) ?? []), cinema]);
  }
  const cinemaList = h('ul', { class: 'choices cinemas' });
  const drawCinemas = () => {
    const needle = cinemaSearch.toLowerCase();
    cinemaList.replaceChildren(...[...places].sort(([a], [b]) => a.localeCompare(b)).flatMap(([town, cinemas]) => {
      const match = (name: string) => !needle || name.toLowerCase().includes(needle) || town.toLowerCase().includes(needle);
      const listed = cinemas.filter((cinema) => match(cinema.name)).sort((a, b) => a.name.localeCompare(b.name));
      if (!listed.length) return [];
      const ids = cinemas.map((cinema) => cinema.id);
      const ticked = ids.filter((id) => ticks.has(id)).length;
      const single = cinemas.length === 1 && cinemas[0].short === town;
      const box = (label: string, on: boolean, list: string[], mixed = false, key = list.join()) =>
        keyed(checkbox(label, on, (now) => changed(() => toggle(ticks, list, now)), mixed), `cinema-${key}`);
      return [h('li', {},
        box(` ${town}`, ticked === ids.length, ids, ticked > 0 && ticked < ids.length, town),
        ...(single ? [] : [h('ul', {}, ...listed.map((cinema) => h('li', {}, box(` ${db.chains.size > 1 ? cinema.name : cinema.short}`, ticks.has(cinema.id), [cinema.id]))))]))];
    }));
  };
  drawCinemas();
  const search = keyed(h('input', { type: 'search', placeholder: 'Search cinemas or towns', 'aria-label': 'Search cinemas' }) as HTMLInputElement, 'cinema-search');
  search.value = cinemaSearch;
  search.oninput = () => { cinemaSearch = search.value; drawCinemas(); }; // the list alone, so the box keeps its place
  const chips = [...ticks].map((id) => names.get(id) ?? id).sort().map((name) => {
    const id = [...ticks].find((tick) => (names.get(tick) ?? tick) === name)!;
    return keyed(button(`${name} ×`, () => changed(() => toggle(ticks, [id], false)), { class: 'chip', 'aria-label': `Untick ${name}` }), `chip-${id}`);
  });

  // Columns: those shown, in order, then the rest to add.
  const move = (facet: q.Facet, step: number) => changed(() => {
    const at = shown.indexOf(facet);
    const to = at + step;
    if (to >= 0 && to < shown.length) [shown[at], shown[to]] = [shown[to], shown[at]];
  });
  const shownRows = shown.map((facet, index) => h('li', {},
    h('span', { class: 'place dim' }, String(index + 1)),
    h('span', { class: 'name' }, h('strong', {}, KINDS[facet].title), h('span', { class: 'dim' }, KINDS[facet].about)),
    keyed(button('←', () => move(facet, -1), { 'aria-label': `Move ${KINDS[facet].title} left`, ...(index ? {} : { disabled: '' }) }), `left-${facet}`),
    keyed(button('→', () => move(facet, 1), { 'aria-label': `Move ${KINDS[facet].title} right`, ...(index < shown.length - 1 ? {} : { disabled: '' }) }), `right-${facet}`),
    keyed(button('×', () => changed(() => { shown.splice(shown.indexOf(facet), 1); delete view.picks[facet]; delete view.orders[facet]; view.focus = 0; }),
      { 'aria-label': `Remove ${KINDS[facet].title}` }), `remove-${facet}`)));
  const addable = q.FACETS.filter((facet) => !shown.includes(facet)).map((facet) =>
    keyed(button(`+ ${KINDS[facet].title}`, () => changed(() => { shown.push(facet); }), { class: 'chip', title: KINDS[facet].about, 'aria-label': `Add ${KINDS[facet].title}` }), `add-${facet}`));

  const fields = FIELDS.map((field) => h('li', {}, keyed(checkbox(
    h('span', {}, h('strong', {}, ` ${PARTS[field].head}`), h('span', { class: 'dim' }, ` ${FIELD_ABOUT[field]}`)),
    view.fields.includes(field),
    (on) => changed(() => { view.fields = FIELDS.filter((each) => (each === field ? on : view.fields.includes(each))); })), `field-${field}`)));

  const copied = h('span', { class: 'dim' });
  panel.replaceChildren(
    h('div', { class: 'panel-head' }, h('h2', {}, 'Settings'), keyed(button('Done', () => panel.close()), 'done')),

    h('section', {},
      h('h3', {}, 'Cinemas'),
      h('div', { class: 'options' },
        option('all', 'Every cinema', `all ${db.cinemas.filter((cinema) => cinema.stored).length} cinemas`, () => { choosing = false; ticks.clear(); address(); }),
        option('london', 'London only', `the ${LONDON.size} in Greater London · :set london`, () => { choosing = false; ticks.clear(); toggle(ticks, [...LONDON], true); }),
        option('some', 'Choose cinemas', mode === 'some' && ticks.size ? where() : 'the ones you go to', () => { choosing = true; })),
      ...(mode === 'some' ? [
        ...(chips.length ? [h('p', { class: 'chips' }, ...chips)] : [h('p', { class: 'dim' }, 'Tick the cinemas you go to; until you do, every cinema is shown.')]),
        search,
        cinemaList,
      ] : [])),

    h('section', {},
      h('h3', {}, 'Columns'),
      h('p', { class: 'dim' }, 'Left to right, before the showtimes. In the finder, :vs {column} adds one, << and >> move the one you are in, and :q closes it.'),
      shown.length ? h('ol', { class: 'choices shown' }, ...shownRows) : h('p', { class: 'dim' }, 'None: just the showtimes.'),
      ...(addable.length ? [h('p', { class: 'chips' }, h('span', { class: 'dim' }, 'Add a column: '), ...addable)] : [])),

    h('section', {},
      h('h3', {}, 'Showtimes'),
      h('p', { class: 'dim' }, 'Each showtime has its time and film, and these if ticked. A cinema or film chosen in its column is left out, as it is the same in every row, and on a narrow screen the least needed go first. Click a heading, or :sort, to order by it.'),
      h('ul', { class: 'choices' }, ...fields),
      h('p', { class: 'actions' }, keyed(button('Default details', () => changed(() => { view.fields = [...DEFAULT_FIELDS]; }),
        view.fields.join() === DEFAULT_FIELDS.join() ? { disabled: '' } : {}), 'fields-reset'))),

    h('section', {},
      h('h3', {}, 'Left out'),
      h('ul', { class: 'choices' },
        h('li', {}, keyed(checkbox(h('span', {}, h('strong', {}, ' Show event cinema'), h('span', { class: 'dim' }, ' concerts, theatre, opera and other special events')),
          extras.has('events'), () => changed(() => toggle(extras, ['events']))), 'events'))),
      hidden.size
        ? h('ul', { class: 'choices' }, ...q.titles(db, [...hidden]).map((film) => h('li', {},
            h('span', { class: 'name' }, `Hidden: ${film.title}`),
            keyed(button('Show again', () => changed(() => hideFilm(film.id))), `unhide-${film.id}`))))
        : h('p', { class: 'dim' }, 'No hidden films. Press dd on a film or showtime to hide that film everywhere, and u to undo it.')),

    h('section', {},
      h('h3', {}, 'Keep this view'),
      h('p', { class: 'dim' }, 'All of this is in the page address, and nothing is saved in the browser. Bookmark the page to keep it, or share the link.'),
      h('p', { class: 'actions' },
        keyed(button('Copy link', () => {
          noteNow();
          navigator.clipboard.writeText(location.href).then(() => copied.replaceChildren('Copied.'), () => copied.replaceChildren('Could not copy; use the address bar.'));
        }), 'copy'),
        keyed(button('Start over', () => changed(startOver), { title: 'Every cinema, the default columns, nothing hidden' }), 'reset'),
        copied)),
  );
  panel.scrollTop = scrolled;
  const again = held ? panel.querySelector<HTMLElement>(`[data-key="${CSS.escape(held)}"]`) : null;
  again?.focus();
  // When that control is gone or can no longer be pressed (dd, or << at the left end), the cursor stays on its line.
  if (heldLine >= 0 && !panel.contains(document.activeElement)) drawerGoTo(heldLine);
  seat(); // the command line, which the redraw took out
}

// ---- Keys: the finder is driven as vim is -----------------------------------------
// Each column is a window and each choice or showtime a line. Normal mode moves and
// acts; the command line at the foot takes ex commands (:set, :sort, :vs, :q…) and
// searches (/ and ?). Nothing else is bound, so a vim user's habits carry over.

/** Normal mode, for :help. */
const NORMAL: [string, string][] = [
  ['h l  ← →', 'The column to the left or right; also w b, Backspace Space'],
  ['j k  ↓ ↑', 'Down or up a line: choose in a column, or move through the showtimes'],
  ['Enter  -', 'Into the next column, or back out of it, as in netrw'],
  ['0 ^  $', 'The first column, or the showtimes'],
  ['gg  G', 'The first or last line; with a count, that line (12G)'],
  ['Ctrl-d  Ctrl-u', 'Half a screen down or up'],
  ['Ctrl-f  Ctrl-b', 'A screen down or up'],
  ['Ctrl-e  Ctrl-y', 'Scroll a line down or up'],
  ['H  M  L', 'The top, middle or bottom line on screen'],
  ['zz  zt  zb', 'Scroll the line to the middle, top or bottom'],
  ['{  }', 'The previous or next day of showtimes'],
  ['/  ?', 'Search forward or back in the column (smartcase, regular expressions)'],
  ['n  N', 'The next or previous match'],
  ['<<  >>', 'Move the column left or right'],
  ['dd', 'Hide the film everywhere'],
  ['yy', 'Yank (copy) the link to this view'],
  ['u  Ctrl-r', 'Undo or redo'],
  ['m{a-z}', 'Mark this view; then ‘{a-z} or `{a-z} comes back to it'],
  ['gx', 'Open the showing on its cinema\u2019s site to book it'],
  ['K', 'Play the film’s trailer'],
  ['Ctrl-g', 'Where you are'],
  ['Esc', 'Cancel a count or a half-typed command'],
];
/** Ex commands, for :help. */
const EX: [string, string][] = [
  [':vs {column}', 'Split: add a column (day, film, cinema, location, picture, language, access, events, seating, screen, cert, genre, people, distributor, release, chain)'],
  [':q  :close', 'Close the column'],
  [':only', 'Close every other column'],
  [':sort  :sort n  :sort rating', 'Order a column A–Z, by showings, or (films) by rating'],
  [':sort {by}  :sort! {by}', 'Order the showtimes by date, time, film, cinema, screen or seats; ! reverses'],
  [':filter {text}', 'Keep only the lines with that text; :filter alone shows them all again'],
  [':set', 'Settings'],
  [':set london  nolondon  london!', 'London only on, off, or switched'],
  [':set events  noevents', 'Event cinema shown or left out'],
  [':set fields=…  fields+=ends  fields-=picture  fields&', 'What each showtime shows (ends, picture, language, access, cert, cinema, screen, seats); & is the default'],
  [':{number}', 'That line'],
  [':w', 'Copy the link to this view'],
  [':e!', 'Start over: every cinema, the default columns, nothing hidden'],
  [':cal', 'Add the showing to your calendar'],
  [':help  F1', 'This list'],
];
/** The settings drawer's keys, for :help: it reads as a buffer, a line to each choice. */
const DRAWER: [string, string][] = [
  ['j k  ↓ ↑', 'The next or previous line'],
  ['h l  ← →', 'Along a line, such as a column\u2019s \u2190 \u2192 \u00d7'],
  ['gg  G  Ctrl-d  Ctrl-u', 'The top, the bottom, half a screen'],
  ['Space  Enter', 'Tick, choose or press what is on the line'],
  ['/  ?  n  N', 'Search the lines: /aber then Space ticks Aberdeen'],
  ['i', 'Type in the cinema search; Esc leaves it'],
  ['dd  <<  >>', 'Remove a column, or move it left or right'],
  ['u  Ctrl-r', 'Undo or redo'],
  ['q  Esc  :q', 'Close the drawer'],
];
const help = h('dialog', { class: 'panel keylist', 'aria-label': 'Help' }) as HTMLDialogElement;
help.addEventListener('click', (event) => { if (event.target === help) help.close(); });
help.addEventListener('keydown', (event) => {
  if (event.target === command || event.metaKey || event.altKey) return;
  const line = 24;
  const moves: Record<string, () => void> = {
    j: () => help.scrollBy(0, line), ArrowDown: () => help.scrollBy(0, line),
    k: () => help.scrollBy(0, -line), ArrowUp: () => help.scrollBy(0, -line),
    d: () => help.scrollBy(0, help.clientHeight / 2), u: () => help.scrollBy(0, -help.clientHeight / 2),
    f: () => help.scrollBy(0, help.clientHeight), b: () => help.scrollBy(0, -help.clientHeight),
    G: () => help.scrollTo(0, help.scrollHeight), g: () => help.scrollTo(0, 0),
    q: () => help.close(),
    ':': () => openCommand(':'),
  };
  const key = event.ctrlKey ? ('dufb'.includes(event.key) ? event.key : '') : 'dufb'.includes(event.key) ? '' : event.key;
  const act = moves[key];
  if (act) { event.preventDefault(); act(); }
});
const list = (rows: [string, string][]) => h('dl', {}, ...rows.flatMap(([keys, does]) => [h('dt', {}, h('kbd', {}, keys)), h('dd', {}, does)]));
help.append(
  h('div', { class: 'panel-head' }, h('h2', {}, 'Help'), button('Done', () => help.close())),
  h('p', { class: 'dim' }, 'The finder is driven as vim is: each column a window, each choice or showtime a line. Counts work (5j, 3l, 12G). j k, Ctrl-d Ctrl-u and gg G scroll this; q, Esc or :q close it.'),
  h('h3', {}, 'Normal mode'), list(NORMAL),
  h('h3', {}, 'Commands'), list(EX),
  h('h3', {}, 'Settings'), list(DRAWER),
  h('p', { class: 'dim' }, about()),
);
document.body.append(help);

// The command line at the foot: messages on the left, the keys typed so far on the right.
const message = h('span', { class: 'message' });
const command = h('input', { 'aria-label': 'Command', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }) as HTMLInputElement;
const prompt = h('span', { class: 'prompt' });
const showcmd = h('span', { class: 'showcmd' });
const wildmenu = h('div', { class: 'wildmenu' });
const cmdline = h('div', { class: 'cmdline', role: 'status' }, wildmenu, prompt, command, message, showcmd);
document.body.append(cmdline);
/** Keep the command line in whichever dialog is open, as one shuts out the page behind it. */
function seat() {
  const host = panel.open ? panel : help.open ? help : document.body;
  if (cmdline.parentElement !== host) host.append(cmdline);
}
for (const dialog of [panel, help]) dialog.addEventListener('close', seat);
let saying = 0;
/** A message on the command line, as vim gives; an error is marked as one. */
function say(text: string, error = false) {
  seat();
  clearTimeout(saying);
  message.textContent = text;
  message.classList.toggle('error', error);
  cmdline.classList.toggle('on', Boolean(text) || cmdline.classList.contains('typing') || Boolean(showcmd.textContent));
  if (text) saying = window.setTimeout(() => say(''), 4000);
}
function show(keys: string) {
  showcmd.textContent = keys;
  cmdline.classList.toggle('on', Boolean(keys) || cmdline.classList.contains('typing') || Boolean(message.textContent));
}

/** A count and the first key of a pair (gg, zz, dd, <<, ma…), typed so far. */
let typed = '';
let pending = '';
/** The last search, for n and N. */
let lastSearch: { pattern: string; back: boolean } | undefined;
/** Marks: m{a-z} keeps the view, '{a-z} comes back to it. Kept for this visit only. */
const marks = new Map<string, string>();

/** Put the page at an earlier address and draw it. */
function restore(href: string) {
  history.replaceState(null, '', location.pathname + href);
  for (const [set, name] of [[ticks, 'cinemas'], [hidden, 'hidden'], [extras, 'show']] as const) {
    set.clear();
    for (const id of readChoice(location.search, name)) set.add(id);
  }
  render();
}
function undoOrRedo(back: boolean, times = 1) {
  noteNow(); // a change made in the last moment, not yet in the address, is the one to undo
  const from = back ? undos : redos;
  let moved = 0;
  while (moved < times && from.length && recorded) {
    (back ? redos : undos).push(recorded);
    recorded = from.pop()!;
    moved += 1;
  }
  if (!moved) return say(back ? 'Already at oldest change' : 'Already at newest change');
  restore(recorded!.href);
  say(`${moved} ${moved === 1 ? 'change' : 'changes'}; ${back ? 'before' : 'after'} #${undos.length + (back ? 1 : 0)}`);
}

/** The column in hand, and the lines in it. */
function inHand() {
  const at = page!;
  const facet = view.columns[view.focus] as q.Facet | undefined;
  const showtimes = view.focus === view.columns.length;
  const pane = app.querySelector<HTMLElement>('.column.focused');
  const length = facet ? at.options[view.focus].length : showtimes ? at.total : 0;
  const here = facet ? Math.max(0, at.options[view.focus].indexOf(view.picks[facet])) : view.row;
  return { at, facet, showtimes, pane, length, here };
}
/** Go to a line of the column in hand: a choice, or a showtime (drawing more of them if need be). */
function goTo(index: number) {
  const { at, facet, showtimes, length } = inHand();
  if (!length) return;
  index = Math.max(0, Math.min(length - 1, index));
  if (facet) {
    const value = at.options[view.focus][index];
    if (value === undefined) delete view.picks[facet];
    else view.picks[facet] = value;
    view.row = 0;
    at.more = 0;
    at.draw();
  } else if (showtimes) {
    view.row = index;
    if (index >= at.rows.length) { at.more = Math.floor(index / PAGE); at.draw(); }
    else at.mark();
  }
}
/** The text of a line, as searches see it. */
function lineText(index: number): string {
  const { at, facet } = inHand();
  if (facet) {
    const value = at.options[view.focus][index];
    return value === undefined ? 'All' : KINDS[facet].label(value).join(' ');
  }
  const row = at.rows[index];
  return row ? `${row.time} ${row.title} ${row.cinema} ${row.screen}` : '';
}
/** A search pattern as vim reads it with smartcase: any capital letter makes it match case. */
function patternOf(text: string): RegExp {
  const flags = /[A-Z]/.test(text) ? '' : 'i';
  try { return new RegExp(text, flags); } catch { return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); }
}
/** The next line matching, from a line, forward or back, wrapping round as vim does. */
function search(text: string, back: boolean, from = inHand().here, quiet = false): boolean {
  const { at, facet } = inHand();
  const lines = facet ? at.options[view.focus].length : at.rows.length;
  if (!text || !lines) return false;
  const pattern = patternOf(text);
  for (let step = 1; step <= lines; step += 1) {
    const raw = from + (back ? -step : step);
    const index = ((raw % lines) + lines) % lines;
    if (pattern.test(lineText(index))) {
      goTo(index);
      if (!quiet) say(raw >= lines ? 'search hit BOTTOM, continuing at TOP' : raw < 0 ? 'search hit TOP, continuing at BOTTOM' : (back ? '?' : '/') + text);
      return true;
    }
  }
  if (!quiet) say(`E486: Pattern not found: ${text}`, true);
  return false;
}

// ---- The command line ----

/** What / and ? search, and n N repeat in: the finder's column in hand, or the settings drawer. */
interface Buffer { here(): number; goTo(index: number): void; search(text: string, back: boolean, from: number, quiet?: boolean): boolean }
const finder: Buffer = { here: () => inHand().here, goTo, search };
const buffer = (): Buffer => (panel.open ? drawer : finder);

/** Where a search started, to go back to when it is given up. */
let searchFrom = 0;
const history_: Record<string, string[]> = { ':': [], '/': [] };
let recall = 0;
function openCommand(kind: ':' | '/' | '?', text = '') {
  seat();
  clearTimeout(saying);
  message.textContent = '';
  prompt.textContent = kind;
  command.value = text;
  searchFrom = buffer().here();
  recall = history_[kind === ':' ? ':' : '/'].length;
  cmdline.classList.add('on', 'typing');
  command.focus();
}
function closeCommand() {
  closeWild();
  cmdline.classList.remove('typing');
  command.blur();
  show(showcmd.textContent ?? '');
}

/** Tab's choices, shown above the command line as vim's wildmenu: Tab and Shift-Tab go through them. */
let wild: { head: string; matches: string[]; index: number } | undefined;
function closeWild() {
  wild = undefined;
  cmdline.classList.remove('wild');
}
function drawWild() {
  if (!wild) return;
  wildmenu.replaceChildren(...wild.matches.map((match, index) => h('span', { class: index === wild!.index ? 'on' : '' }, match)));
  cmdline.classList.add('wild');
  wildmenu.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function tab(back: boolean) {
  if (wild) {
    wild.index = (wild.index + (back ? -1 : 1) + wild.matches.length) % wild.matches.length;
  } else {
    const { head, matches } = completions(command.value);
    if (!matches.length) return;
    wild = { head, matches, index: back ? matches.length - 1 : 0 };
  }
  command.value = wild.head + wild.matches[wild.index];
  if (wild.matches.length === 1) closeWild();
  else drawWild();
}

command.addEventListener('input', () => {
  closeWild();
  const kind = prompt.textContent;
  if (kind === ':') return;
  // As you type, as with incsearch; back where it started while nothing matches.
  const where = buffer();
  if (!where.search(command.value, kind === '?', searchFrom, true) && where.here() !== searchFrom) where.goTo(searchFrom);
});
command.addEventListener('keydown', (event) => {
  const kind = prompt.textContent as ':' | '/' | '?';
  const past = history_[kind === ':' ? ':' : '/'];
  event.stopPropagation();
  if (event.key === 'Tab' && kind === ':') {
    event.preventDefault();
    return tab(event.shiftKey);
  }
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
  closeWild();
  const where = buffer();
  if (event.key === 'Escape' || (event.key === 'Backspace' && !command.value) || (event.ctrlKey && event.key === 'c')) {
    event.preventDefault();
    if (kind !== ':') where.goTo(searchFrom);
    closeCommand();
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const text = command.value;
    closeCommand();
    if (text) past.push(text);
    if (kind === ':') ex(text.trim());
    else {
      const pattern = text || lastSearch?.pattern || '';
      lastSearch = { pattern, back: kind === '?' };
      if (!where.search(pattern, kind === '?', searchFrom) && where.here() !== searchFrom) where.goTo(searchFrom);
    }
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    recall = Math.max(0, Math.min(past.length, recall + (event.key === 'ArrowUp' ? -1 : 1)));
    command.value = past[recall] ?? '';
  }
});
command.addEventListener('blur', () => { if (cmdline.classList.contains('typing')) closeCommand(); });

// ---- Ex commands ----

/** Columns by the names a command may use for them. */
const COLUMN_NAMES: Record<string, q.Facet> = {
  ...Object.fromEntries(q.FACETS.map((facet) => [facet, facet])),
  ...Object.fromEntries(q.FACETS.map((facet) => [KINDS[facet].title.toLowerCase(), facet])),
  accessibility: 'access', event: 'event', events: 'event', seats: 'seat', certificate: 'cert', people: 'person', chains: 'chain',
};
/** Each command, with the shortest it may be cut to, as in vim's :h[elp]. */
const COMMANDS: [string, number][] = [
  ['vsplit', 2], ['quit', 1], ['close', 3], ['only', 2], ['sort', 3], ['filter', 4], ['set', 2], ['options', 3],
  ['write', 1], ['edit', 1], ['help', 1], ['calendar', 3], ['undo', 1], ['redo', 3], ['nohlsearch', 3],
];
const commandOf = (word: string) => COMMANDS.find(([name, least]) => word.length >= least && name.startsWith(word))?.[0];
const OPTIONS = ['london', 'events', 'fields'];

/** Tab's choices for the word being typed: a command, a column, an order, an option or its value. */
function completions(text: string): { head: string; matches: string[] } {
  const words = text.split(' ');
  let word = words.pop()!;
  let head = words.length ? words.join(' ') + ' ' : '';
  const name = words.length ? commandOf(words[0].replace(/!$/, '')) : undefined;
  const { facet } = inHand();
  let choices: string[] = [];
  if (!words.length) choices = COMMANDS.map(([command]) => command);
  else if (name === 'vsplit') choices = q.FACETS.filter((each) => !view.columns.includes(each)).map((each) => KINDS[each].title.toLowerCase());
  else if (name === 'sort') choices = facet ? (facet === 'film' ? ['n', 'rating'] : ['n']) : q.SORTS;
  else if (name === 'set') {
    const value = /^(fields(?:\+|-|\^)?=(?:[a-z]+,)*)([a-z]*)$/.exec(word);
    if (value) {
      head += value[1];
      const listed = value[1].split('=')[1].split(',').filter(Boolean);
      const adding = !value[1].startsWith('fields-=');
      choices = FIELDS.filter((field) => !listed.includes(field) && (value[1].startsWith('fields=') || adding !== view.fields.includes(field)));
      word = value[2];
    } else choices = ['london', 'nolondon', 'london!', 'events', 'noevents', 'events!', 'fields+=', 'fields-=', 'fields=', 'fields&', 'fields?'];
  }
  return { head, matches: choices.filter((choice) => choice.startsWith(word)) };
}

function ex(text: string) {
  if (!text) return;
  const open = panel.open ? panel : help.open ? help : undefined;
  if (open && /^(q|qu|qui|quit|clo|clos|close)!?$/.test(text)) return open.close();
  if (open === help) help.close(); // a command acts on the finder
  run(text);
  if (panel.open) fillPanel();
}
function run(text: string) {
  if (/^\d+$/.test(text)) return goTo(Number(text) - 1);
  const parsed = /^([a-zA-Z]+)(!?)\s*(.*)$/.exec(text);
  const name = parsed && commandOf(parsed[1]);
  if (!parsed || !name) return say(`E492: Not an editor command: ${text}`, true);
  const [, , bang, argument] = parsed;
  const { at, facet, showtimes } = inHand();
  switch (name) {
    case 'vsplit': {
      const column = COLUMN_NAMES[argument.toLowerCase()];
      if (!argument) return say('E471: Argument required: which column? Tab lists them', true);
      if (!column) return say(`No such column: ${argument}`, true);
      if (view.columns.includes(column)) { view.focus = view.columns.indexOf(column); return at.mark(); }
      view.columns.splice(Math.min(view.focus + 1, view.columns.length), 0, column);
      view.focus = view.columns.indexOf(column);
      return rebuild();
    }
    case 'quit': case 'close':
      if (!facet) return say('The showtimes cannot be closed', true);
      view.columns.splice(view.focus, 1);
      delete view.picks[facet];
      delete view.orders[facet];
      view.focus = Math.min(view.focus, view.columns.length);
      return rebuild();
    case 'only':
      if (!facet) return say('The showtimes cannot be closed', true);
      for (const other of view.columns) if (other !== facet) { delete view.picks[other]; delete view.orders[other]; }
      view.columns = [facet];
      view.focus = 0;
      return rebuild();
    case 'sort': {
      const by = argument.toLowerCase();
      if (facet) {
        const order: Order | undefined = !by ? 'name' : by === 'n' ? 'count' : by === 'rating' || by === 'r' ? 'rating' : undefined;
        if (!order || !ordersOf(facet).includes(order)) return say(`E474: Invalid argument: ${argument}`, true);
        if (order === 'name') delete view.orders[facet];
        else view.orders[facet] = order;
        return rebuild();
      }
      if (!showtimes) return;
      const sort = !by ? 'date' : by === 'n' ? 'seats' : by;
      if (!q.SORTS.includes(sort)) return say(`E474: Invalid argument: ${argument} (${q.SORTS.join(' ')})`, true);
      view.sort = sort;
      view.descending = Boolean(bang);
      view.row = 0;
      return rebuild();
    }
    case 'filter':
      if (showtimes) { view.text = argument; view.row = 0; at.more = 0; }
      else at.filters[view.focus] = argument;
      return rebuild();
    case 'nohlsearch':
      lastSearch = undefined;
      return;
    case 'set':
      if (!argument) return openPanel();
      return argument.split(/\s+/).forEach(setOption);
    case 'options': return openPanel();
    case 'write':
      noteNow();
      return void navigator.clipboard.writeText(location.href).then(() => say(`"${location.href}" written to the clipboard`), () => say('Cannot copy; use the address bar', true));
    case 'edit':
      if (!bang) return say('E37: No write since last change (add ! to start over)', true);
      startOver();
      return rebuild();
    case 'help': return help.showModal();
    case 'calendar': {
      const shown = at.rows[view.row];
      return shown ? addToCalendar(shown.cinemaId, shown.id) : say('No showing highlighted', true);
    }
    case 'undo': return undoOrRedo(true);
    case 'redo': return undoOrRedo(false);
  }
}

/** One :set argument: london, nolondon, london!, fields+=ends, fields&, fields? … */
function setOption(argument: string) {
  const parsed = /^(no|inv)?([a-z]+)(!|&|\?|[+-^]?=)?(.*)$/.exec(argument);
  if (!parsed || !OPTIONS.includes(parsed[2])) return say(`E518: Unknown option: ${argument}`, true);
  const [, prefix, name, how = '', value] = parsed;
  if (name === 'fields') {
    const asked = value.split(',').filter(Boolean);
    const wrong = asked.find((field) => !(FIELDS as readonly string[]).includes(field));
    if (wrong) return say(`E474: Invalid argument: ${wrong} (${FIELDS.join(',')})`, true);
    if (how === '?' || (!how && !prefix)) return say(`  fields=${view.fields.join(',')}`);
    const now = new Set<string>(how === '&' ? DEFAULT_FIELDS : how === '=' ? asked : view.fields);
    if (how === '+=' || how === '^=') asked.forEach((field) => now.add(field));
    if (how === '-=') asked.forEach((field) => now.delete(field));
    view.fields = FIELDS.filter((field) => now.has(field));
    return rebuild();
  }
  const current = name === 'london' ? londonOnly() : extras.has('events');
  if (how === '?') return say(`  ${current ? '' : 'no'}${name}`);
  const on = how === '!' || prefix === 'inv' ? !current : how === '&' ? false : prefix !== 'no';
  if (name === 'london') return setLondon(on);
  toggle(extras, ['events'], on);
  rebuild();
}

// ---- Normal mode ----

document.addEventListener('keydown', (event) => {
  if (event.key === 'F1') { event.preventDefault(); return void help.showModal(); }
  // Ctrl with these letters is vim's; every other shortcut is left to the browser.
  const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && 'dufbeygr'.includes(event.key) && event.key.length === 1;
  if (((event.metaKey || event.ctrlKey || event.altKey) && !ctrl) || panel.open || help.open || !page) return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement && target.type === 'search') {
    if (['Escape', 'Enter'].includes(event.key)) { target.blur(); event.preventDefault(); }
    return;
  }
  if (target instanceof HTMLInputElement) target.blur(); // a tick box keeps no hold on the keys
  if (target instanceof HTMLSelectElement || (target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' '))) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
  const key = (ctrl ? 'Ctrl-' : '') + event.key;

  // A count, as in 5j; 0 alone is the first column.
  if (/^[1-9]$/.test(key) || (key === '0' && typed)) {
    event.preventDefault();
    typed += key;
    return show(typed + pending);
  }
  const n = Number(typed || 1);
  const counted = Boolean(typed);
  const pair = pending;
  typed = '';
  pending = '';
  show('');
  if (key === 'Escape') return; // cancels the count or the half-typed command

  const { at, facet, pane, length, here } = inHand();
  const shown = at.rows[view.row];
  /** The lines of the column in hand as drawn, and which of them are wholly on screen. */
  const lines = () => [...(pane?.querySelectorAll<HTMLElement>(facet ? '.facet li:not(.note):not(.heads)' : '.cards li.show') ?? [])];
  const lineHeight = () => lines()[0]?.offsetHeight || 24;
  const screenful = () => Math.max(1, Math.floor(((pane?.clientHeight ?? 600) - 66) / lineHeight()));
  const onScreen = () => {
    if (!pane) return [];
    const box = pane.getBoundingClientRect();
    return lines().flatMap((line, index) => {
      const { top, bottom } = line.getBoundingClientRect();
      return top >= box.top + 65 && bottom <= box.bottom + 1 ? [index] : [];
    });
  };
  const column = (to: number) => { view.focus = Math.max(0, Math.min(lastColumn(), to)); at.mark(); };
  const shift = (by: number) => {
    const to = Math.max(0, Math.min(view.columns.length - 1, view.focus + by));
    if (!facet || to === view.focus) return;
    view.columns.splice(view.focus, 1);
    view.columns.splice(to, 0, facet);
    view.focus = to;
    rebuild();
  };
  const scrollTo = (block: ScrollLogicalPosition) => pane?.querySelector('.selected')?.scrollIntoView({ block });

  // The second key of a pair.
  if (pair) {
    event.preventDefault();
    if (pair === 'm') {
      if (!/^[a-z]$/.test(key)) return;
      noteNow();
      marks.set(key, location.search + location.hash);
      return;
    }
    if (pair === "'" || pair === '`') {
      const href = marks.get(key);
      return href ? restore(href) : say('E20: Mark not set', true);
    }
    const pairs: Record<string, () => void> = {
      gg: () => goTo(counted ? n - 1 : 0),
      gx: () => { const url = shown && q.booking(db, shown); if (url) window.open(url, '_blank', 'noopener'); else say('No showing highlighted', true); },
      zz: () => scrollTo('center'), 'z.': () => scrollTo('center'),
      zt: () => scrollTo('start'), zEnter: () => scrollTo('start'),
      zb: () => scrollTo('end'), 'z-': () => scrollTo('end'),
      dd: () => {
        const id = (facet === 'film' ? view.picks.film : undefined) ?? shown?.filmId; // the chosen film, or the highlighted showtime's
        if (!id) return say('No film here', true);
        hideFilm(id);
        say(`"${q.film(db, id)?.title ?? id}" hidden; u brings it back`);
      },
      yy: () => {
        noteNow();
        navigator.clipboard.writeText(location.href).then(() => say('Link to this view yanked'), () => say('Cannot copy; use the address bar', true));
      },
      '<<': () => shift(-n),
      '>>': () => shift(n),
    };
    pairs[pair + key]?.();
    return;
  }
  if ('gzdym\'`<>'.includes(key) && key.length === 1) {
    event.preventDefault();
    typed = counted ? String(n) : '';
    pending = key;
    return show(typed + key);
  }

  const before = (index: number) => {
    // The first line of the day the line is on, or of the day before when it already is the first.
    const startOf = (line: number) => {
      while (line > 0 && at.rows[line - 1].date === at.rows[line].date) line -= 1;
      return line;
    };
    const start = startOf(index);
    return start === index && start > 0 ? startOf(start - 1) : start;
  };
  const keys: Record<string, () => void> = {
    j: () => goTo(here + n), ArrowDown: () => goTo(here + n),
    k: () => goTo(here - n), ArrowUp: () => goTo(here - n),
    h: () => column(view.focus - n), ArrowLeft: () => column(view.focus - n), b: () => column(view.focus - n), Backspace: () => column(view.focus - n), '-': () => column(view.focus - n),
    l: () => column(view.focus + n), ArrowRight: () => column(view.focus + n), w: () => column(view.focus + n), ' ': () => column(view.focus + n), Enter: () => column(view.focus + n),
    0: () => column(0), '^': () => column(0), Home: () => column(0),
    $: () => column(view.columns.length), End: () => column(view.columns.length),
    G: () => goTo(counted ? n - 1 : length - 1),
    'Ctrl-d': () => goTo(here + n * Math.ceil(screenful() / 2)), 'Ctrl-u': () => goTo(here - n * Math.ceil(screenful() / 2)),
    'Ctrl-f': () => goTo(here + n * screenful()), PageDown: () => goTo(here + n * screenful()),
    'Ctrl-b': () => goTo(here - n * screenful()), PageUp: () => goTo(here - n * screenful()),
    'Ctrl-e': () => pane?.scrollBy(0, n * lineHeight()), 'Ctrl-y': () => pane?.scrollBy(0, -n * lineHeight()),
    H: () => { const seen = onScreen(); if (seen.length) goTo(seen[Math.min(n - 1, seen.length - 1)]); },
    M: () => { const seen = onScreen(); if (seen.length) goTo(seen[Math.floor(seen.length / 2)]); },
    L: () => { const seen = onScreen(); if (seen.length) goTo(seen[Math.max(0, seen.length - n)]); },
    '}': () => {
      if (facet || !shown) return;
      let line = view.row;
      for (let times = 0; times < n; times += 1) {
        const next = at.rows.findIndex((row, index) => index > line && row.date !== at.rows[line].date);
        if (next < 0) break;
        line = next;
      }
      goTo(line);
    },
    '{': () => {
      if (facet || !shown) return;
      let line = view.row;
      for (let times = 0; times < n; times += 1) line = before(line);
      goTo(line);
    },
    '/': () => openCommand('/'),
    '?': () => openCommand('?'),
    ':': () => openCommand(':'),
    n: () => { if (lastSearch) for (let times = 0; times < n; times += 1) search(lastSearch.pattern, lastSearch.back); else say('E35: No previous regular expression', true); },
    N: () => { if (lastSearch) for (let times = 0; times < n; times += 1) search(lastSearch.pattern, !lastSearch.back); else say('E35: No previous regular expression', true); },
    u: () => undoOrRedo(true, n),
    'Ctrl-r': () => undoOrRedo(false, n),
    K: () => {
      const play = app.querySelector<HTMLElement>('.details .trailer button');
      if (!play) return say('No trailer for this film', true);
      play.parentElement!.scrollIntoView({ block: 'nearest' });
      play.click();
    },
    'Ctrl-g': () => {
      const name = facet ? KINDS[facet].title : 'Showtimes';
      say(`"${name}" line ${here + 1} of ${length} --${length ? Math.round(((here + 1) / length) * 100) : 0}%-- · ${londonOnly() ? 'London only' : ticks.size ? where() : 'every cinema'}`);
    },
  };
  const act = keys[key];
  if (!act) return;
  event.preventDefault();
  act();
});

// ---- The settings drawer, as a buffer: a line to each choice --------------------

/** The drawer's controls in order, and the line each is on (a row of a list, an option, a paragraph of buttons). */
function drawerControls(): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>('button, input')].filter((control) =>
    !(control as HTMLButtonElement).disabled && !control.closest('.cmdline') && (control as HTMLInputElement).type !== 'search' && control.getClientRects().length > 0);
}
const lineOf = (control: Element) => (control.closest('li, .option, p, .panel-head') ?? control) as HTMLElement;
function drawerLines(): HTMLElement[] {
  return [...new Set(drawerControls().map(lineOf))];
}
/** Mark a line as the one in hand, as vim's cursorline. */
function cursorline(line: Element | undefined) {
  panel.querySelector('.cursorline')?.classList.remove('cursorline');
  line?.classList.add('cursorline');
  line?.scrollIntoView({ block: 'nearest' });
}
/** Put the cursor on a line: its first control has the focus. While a search is typed, the line is only marked. */
function drawerGoTo(index: number, focus = true) {
  const lines = drawerLines();
  const line = lines[Math.max(0, Math.min(lines.length - 1, index))];
  if (!focus) return cursorline(line);
  const first = drawerControls().find((control) => lineOf(control) === line);
  first?.focus();
  first?.scrollIntoView({ block: 'nearest' });
}
const drawerHere = () => {
  const active = document.activeElement;
  return active && panel.contains(active) ? drawerLines().indexOf(lineOf(active)) : -1;
};
const drawer: Buffer = {
  here: () => Math.max(0, drawerHere()),
  goTo: drawerGoTo,
  search(text, back, from, quiet = false) {
    const lines = drawerLines();
    if (!text || !lines.length) return false;
    const pattern = patternOf(text);
    for (let step = 1; step <= lines.length; step += 1) {
      const index = (((from + (back ? -step : step)) % lines.length) + lines.length) % lines.length;
      if (pattern.test(lines[index].textContent ?? '')) {
        drawerGoTo(index, !quiet);
        if (!quiet) say((back ? '?' : '/') + text);
        return true;
      }
    }
    if (quiet) cursorline(lines[from]);
    else say(`E486: Pattern not found: ${text}`, true);
    return false;
  },
};

panel.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (target === command) return;
  // Insert mode: typing in the cinema search until Esc or Enter, which go back to the lines.
  if (target instanceof HTMLInputElement && target.type === 'search') {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      target.blur();
      drawerControls().find((control) => target.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING)?.focus();
    }
    return;
  }
  const ctrl = event.ctrlKey && !event.metaKey && !event.altKey && 'dur'.includes(event.key) && event.key.length === 1;
  if (((event.metaKey || event.ctrlKey || event.altKey) && !ctrl) || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) return;
  const key = (ctrl ? 'Ctrl-' : '') + event.key;
  if (/^[1-9]$/.test(key) || (key === '0' && typed)) {
    event.preventDefault();
    typed += key;
    return show(typed + pending);
  }
  const n = Number(typed || 1);
  const counted = Boolean(typed);
  const pair = pending;
  typed = '';
  pending = '';
  show('');
  if (key === 'Escape' && pair) return event.preventDefault(); // cancels the half-typed command, not the drawer

  const here = drawerHere();
  const line = here >= 0 ? drawerLines()[here] : undefined;
  /** Press the button on this line that the label names, as a column's ← → ×. */
  const press = (label: RegExp) => {
    const found = line && [...line.querySelectorAll<HTMLButtonElement>('button')].find((each) => label.test(each.getAttribute('aria-label') ?? ''));
    if (found && !found.disabled) found.click();
    else say('Nothing to do on this line', true);
  };
  if (pair) {
    event.preventDefault();
    const pairs: Record<string, () => void> = {
      gg: () => drawerGoTo(counted ? n - 1 : 0),
      dd: () => press(/^Remove /),
      '<<': () => { for (let times = 0; times < n; times += 1) press(/^Move .* left$/); },
      '>>': () => { for (let times = 0; times < n; times += 1) press(/^Move .* right$/); },
    };
    pairs[pair + key]?.();
    return;
  }
  if ('gd<>'.includes(key) && key.length === 1) {
    event.preventDefault();
    typed = counted ? String(n) : '';
    pending = key;
    return show(typed + key);
  }
  const along = (by: number) => {
    const active = document.activeElement as HTMLElement | null;
    if (!line || !active) return drawerGoTo(0);
    const onLine = drawerControls().filter((control) => lineOf(control) === line);
    onLine[Math.max(0, Math.min(onLine.length - 1, onLine.indexOf(active) + by))]?.focus();
  };
  const page = Math.max(1, Math.floor(panel.clientHeight / 2 / 32));
  const keys: Record<string, () => void> = {
    j: () => drawerGoTo(here + n), ArrowDown: () => drawerGoTo(here + n),
    k: () => drawerGoTo(Math.max(0, here - n)), ArrowUp: () => drawerGoTo(Math.max(0, here - n)),
    h: () => along(-n), ArrowLeft: () => along(-n),
    l: () => along(n), ArrowRight: () => along(n),
    G: () => drawerGoTo(counted ? n - 1 : drawerLines().length - 1),
    'Ctrl-d': () => drawerGoTo(here + n * page), 'Ctrl-u': () => drawerGoTo(Math.max(0, here - n * page)),
    Enter: () => (document.activeElement as HTMLElement | null)?.click(),
    i: () => {
      const box = panel.querySelector<HTMLInputElement>('input[type=search]');
      if (box) box.focus();
      else say('Choose cinemas first: the search is there', true);
    },
    '/': () => openCommand('/'),
    '?': () => openCommand('?'),
    ':': () => openCommand(':'),
    n: () => { if (lastSearch) drawer.search(lastSearch.pattern, lastSearch.back, drawer.here()); },
    N: () => { if (lastSearch) drawer.search(lastSearch.pattern, !lastSearch.back, drawer.here()); },
    u: () => { undoOrRedo(true, n); fillPanel(); },
    'Ctrl-r': () => { undoOrRedo(false, n); fillPanel(); },
    q: () => panel.close(),
  };
  const act = keys[key];
  if (!act) return;
  event.preventDefault();
  act();
});
panel.addEventListener('focusin', (event) => {
  const target = event.target as HTMLElement;
  if (target !== command) cursorline(lineOf(target));
});

window.addEventListener('hashchange', () => { if (location.hash !== drawn) render(); });
narrow.addEventListener('change', () => { if (page) render(); });

function load(all: boolean): Promise<void> {
  return openListings(all ? './data/listings.json.gz' : './data/london.json.gz').then(
    (listings) => {
      db = listings;
      whole = all;
      // The Chain column is as wide as its longest name whatever is picked, so it does not shrink when other chains drop out.
      document.documentElement.style.setProperty('--chain-name', `${Math.max(0, ...[...db.chains.values()].map((chain) => chain.name.length))}ch`);
      // Which cinemas are Greater London's, as the listings say, and ?cinemas=london read as them.
      learnLondon(db.cinemas.filter((cinema) => cinema.town === 'Greater London').map((cinema) => cinema.id));
      expandArea(ticks);
      render();
    },
    (error) => { app.replaceChildren(h('p', { class: 'error' }, String(error.message ?? error))); },
  );
}
if (needsEveryCinema(ticks)) everything = load(true);
else load(false);
