// The site is one finder: columns of choices side by side, each counting what the
// others leave, then the showtimes that match, then the highlighted one's details.
// The visitor picks which columns to show and in what order, and all of it is in
// the page's address, so a bookmark is a saved view. Driven by keys, clicks or taps.
import { ics } from './calendar';
import { expandArea, learnLondon, needsEveryCinema, onlyPick, PAGE, pick, picked, readView } from './choices';
import { KINDS, learnCinemas, LEAST_NEEDED, ordered, ORDERS, ordersOf, PARTS } from './columns';
import { DATA, openListings } from './db';
import { bar, button, facts, h, link } from './dom';
import { openPanel } from './drawer';
import { clock, day, fullDate } from './format';
import { goBack, guardBack, note, noteNow, startHistory } from './history';
import * as q from './queries';
import { address, app, cursors, db, hidden, narrow, page, scope, setDb, setDrawn, setPage, setView, ticks, toggle, view } from './state';
import { formats } from './tags';

/** Whether `db` holds every cinema's showings, or only Greater London's. */
let whole = false;
let everything: Promise<void> | undefined;

/** The link to book a showing on its chain's site, named after the site: `Book on odeon.co.uk`. */
function bookingLink(show: { cinemaId: string; id: string }): Node[] {
  const url = q.booking(db, show);
  if (!url) return [];
  // The site, not its booking subdomain: purchase.everymancinema.com is everymancinema.com.
  const host = new URL(url).hostname.split('.');
  return [link(`Book on ${host.slice(-(host.at(-2) === 'co' ? 3 : 2)).join('.')}`, url)];
}

export function addToCalendar(cinema: string, id: string) {
  const show = q.showing(db, cinema, id);
  if (!show) return;
  const address = URL.createObjectURL(new Blob([ics(show)], { type: 'text/calendar' }));
  const anchor = h('a', { href: address, download: `${show.title.replace(/[^\w]+/g, '-')}.ics` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(address), 1000);
}

let fitting: ResizeObserver | undefined;
/** The line each column was last clicked on, where a Shift-click range starts. */
const anchors = new Map<q.Facet, string>();
/** Change the columns themselves, then draw the finder again. */
export function rebuild() {
  noteNow();
  render();
}

export const lastColumn = () => view.columns.length + (narrow.matches ? 1 : 0); // a phone shows the details as a column of their own

// The columns' own edits, made the same way by keys (<< >>), ex commands (:vs :q) and the mouse.
/** Add a column at a place among the others, and go to it. */
export function addColumn(facet: q.Facet, at: number) {
  view.columns.splice(Math.max(0, Math.min(at, view.columns.length)), 0, facet);
  view.focus = view.columns.indexOf(facet);
  rebuild();
}
/** Close a column, and forget what was chosen in it and its order. */
export function closeColumn(index: number) {
  const facet = view.columns[index];
  if (!facet) return;
  view.columns.splice(index, 1);
  delete view.picks[facet];
  delete view.orders[facet];
  if (view.focus > index) view.focus -= 1; // the column in hand stays in hand; closing it goes to the next
  view.focus = Math.max(0, Math.min(view.focus, view.columns.length));
  rebuild();
}
/** Move a column to another place among the columns, and go to it. */
export function moveColumn(from: number, to: number) {
  const facet = view.columns[from];
  to = Math.max(0, Math.min(view.columns.length - 1, to));
  if (!facet || to === from) return;
  view.columns.splice(from, 1);
  view.columns.splice(to, 0, facet);
  view.focus = to;
  rebuild();
}

/** A column of choices moves by dragging its heading onto another such column: the half the
 *  pointer is over says which side it goes. The showtimes and the details stay where they are.
 *  Followed by pointer events, not the browser's drag and drop, which Safari will not start on a
 *  heading. A press that moves less than a few pixels is a click, which goes to the column. */
function draggable(panes: HTMLElement[], index: number, count: number) {
  const pane = panes[index];
  const heading = pane.querySelector('.bar h2') as HTMLElement;
  const choices = panes.slice(0, count);
  let start: { x: number; y: number; id: number } | undefined;
  let dragging = false;
  let target: { at: number; before: boolean } | undefined;
  /** Where the pointer would drop the column, marked on the column it is over. */
  const aim = (x: number) => {
    for (const each of choices) each.classList.remove('drop-before', 'drop-after');
    const at = choices.findIndex((each) => { const box = each.getBoundingClientRect(); return x >= box.left && x < box.right; });
    if (at < 0) { target = undefined; return; }
    const box = choices[at].getBoundingClientRect();
    target = { at, before: x < box.left + box.width / 2 };
    choices[at].classList.add(target.before ? 'drop-before' : 'drop-after');
  };
  const move = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
      dragging = true;
      pane.classList.add('dragging');
      document.body.classList.add('dragging-columns');
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    aim(event.clientX);
  };
  const up = (event: PointerEvent) => {
    if (!start || event.pointerId !== start.id) return;
    const drop = dragging ? target : undefined;
    const dragged = dragging;
    finish();
    if (!dragged) return; // a click: the column's own click handler goes to it
    // The click that ends a drag is not a click on a column.
    // A click follows only when the press and release fell on one element, so it is caught for
    // this turn of the event loop alone, never left to swallow a later click.
    window.addEventListener('click', swallow, true);
    setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    if (!drop) return;
    const place = drop.before ? drop.at : drop.at + 1; // among the columns as they are now
    moveColumn(index, place > index ? place - 1 : place);
  };
  const swallow = (click: MouseEvent) => click.stopPropagation();
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !dragging) return;
    event.stopPropagation();
    event.preventDefault();
    finish();
  };
  function finish() {
    for (const each of choices) each.classList.remove('dragging', 'drop-before', 'drop-after');
    document.body.classList.remove('dragging-columns');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', finish);
    window.removeEventListener('keydown', key, true);
    start = undefined;
    target = undefined;
    dragging = false;
  }
  heading.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || narrow.matches) return;
    start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('keydown', key, true);
  });
}

/** The + on the showtimes' heading: a short list of the columns not shown, the chosen one added
 *  just before the showtimes. j and k or the arrows move, Enter chooses, Esc or a click away closes. */
function addMenu(opener: HTMLButtonElement, shut: q.Facet[]) {
  document.querySelector('.add-menu')?.remove();
  const items = shut.map((facet) => button(KINDS[facet].title, () => { close(); addColumn(facet, view.columns.length); }, { role: 'menuitem' }));
  const menu = h('div', { class: 'add-menu', role: 'menu', 'aria-label': 'Add a column' }, ...items);
  const away = (event: MouseEvent) => { if (!menu.contains(event.target as Node) && event.target !== opener) close(); };
  function close() {
    menu.remove();
    document.removeEventListener('mousedown', away, true);
  }
  menu.addEventListener('keydown', (event) => {
    event.stopPropagation(); // the menu's keys are its own, not normal mode's
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = ({ j: 1, ArrowDown: 1, k: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
    if (step) { event.preventDefault(); items[(at + step + items.length) % items.length].focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); close(); opener.focus(); }
  });
  const box = opener.getBoundingClientRect();
  menu.style.left = `${Math.round(box.left)}px`;
  menu.style.top = `${Math.round(box.bottom + 4)}px`;
  document.body.append(menu);
  document.addEventListener('mousedown', away, true);
  items[0]?.focus();
}

export function render() {
  address();
  setDrawn(location.hash);
  if (!whole && needsEveryCinema(ticks)) {
    app.querySelector('.status')?.replaceChildren('loading every cinema…');
    everything ??= load(true);
    return;
  }
  if (!db) return; // still downloading; load() draws the page when it arrives
  learnCinemas();
  setView(readView(location.hash));
  // A column whose marks are gone (undone, or the column closed) chooses as it moves again.
  for (const facet of [...cursors.keys()]) if (!view.columns.includes(facet) || !picked(view, facet).length) cursors.delete(facet);
  view.focus = Math.min(view.focus, lastColumn());
  startHistory(); // where undo stops
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
  const closer = (index: number) => button('×', () => closeColumn(index), { class: 'close', 'aria-label': `Close the ${KINDS[columns[index]].title} column`, title: 'Close this column' });
  const shut = q.FACETS.filter((facet) => !columns.includes(facet));
  const adder = shut.length ? [button('+', () => addMenu(adder[0] as HTMLButtonElement, shut), { class: 'add', 'aria-label': 'Add a column', title: 'Add a column' })] : [];
  const panes = [
    ...columns.map((facet, index) => h('div', { class: `column ${facet}` }, bar(KINDS[facet].title, ...finding(index), sorters[index], closer(index)), lists[index])),
    h('div', { class: 'column showtimes' }, bar('Showtimes', ...finding(results), total), shows),
    detail,
  ];
  panes[results].querySelector('.bar')?.prepend(...adder);
  columns.forEach((_, index) => draggable(panes, index, columns.length));
  // Clicking a column's heading or its empty space goes to it and shows its choices, changing nothing.
  panes.slice(0, results + 1).forEach((pane, index) => pane.addEventListener('click', (event) => {
    if ((event.target as Element).closest('li, button, input')) return;
    view.focus = index;
    mark();
    pane.querySelector('.selected, .cursor')?.scrollIntoView({ block: 'nearest' });
  }));
  panes[results].addEventListener('scroll', () => {
    const column = panes[results];
    if (state.rows.length < state.total && column.scrollTop + column.clientHeight > column.scrollHeight - 600) { state.more += 1; draw(); }
  }, { passive: true });
  // On a phone one column shows at a time; these steps name each, with what is chosen in it.
  const steps = h('nav', { class: 'steps' });
  const back = button('‹', goBack, { class: 'back', 'aria-label': 'Back' });

  document.title = 'showtimes';
  app.className = 'finder-page';
  document.querySelector('.add-menu')?.remove(); // a menu of the columns as they were
  // No header and no footer: the settings open with Esc, or with the button at the right of the
  // details' heading, at the top right; on a phone, with the button that ends the row at the top: ‹, the steps, then Settings.
  app.replaceChildren(
    h('div', { class: 'topbar' }, back, steps, settings()),
    h('div', { class: 'columns finder' }, ...panes),
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
  setPage(state);

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
      const chosen = picked(view, facet);
      values.unshift(...chosen.filter((value) => !values.includes(value))); // a choice the others have emptied stays in view
      const needle = filters[index].toLowerCase();
      if (needle) values = values.filter((value) => chosen.includes(value) || KINDS[facet].label(value)[0].toLowerCase().includes(needle));
      // Days past the published week are set apart, once, instead of each saying so.
      const advance = facet === 'day' && order === 'name' && db.fullUntil ? values.find((value) => value !== 'weekend' && value > db.fullUntil!) : undefined;
      const all = [undefined, ...values];
      const heads = h('li', { class: 'heads', 'aria-hidden': 'true' }, h('span', {}), h('span', {}, typeof KINDS[facet].notes === 'function' ? (KINDS[facet].notes as () => string)() : KINDS[facet].notes ?? ''), h('span', {}, 'showings'));
      lists[index].replaceChildren(heads, ...all.flatMap((value) => {
        const [name, note] = value === undefined ? ['All', ''] : KINDS[facet].label(value);
        const on = value === undefined ? !chosen.length : chosen.includes(value);
        const item = h('li', { class: [on ? 'selected' : '', value === undefined ? 'pinned' : ''].join(' '), title: name },
          h('strong', {}, name),
          h('span', { class: 'dim' }, note),
          h('span', { class: 'dim count' }, value === undefined ? '' : (counted.get(value) ?? 0).toLocaleString('en-GB')));
        // Shift-click would select the text; a range is meant instead.
        item.onmousedown = (event) => { if (event.shiftKey) event.preventDefault(); };
        item.onclick = (event) => {
          view.focus = index;
          if (value !== undefined && (event.shiftKey || event.ctrlKey || event.metaKey)) {
            // Shift: every line from the last one clicked to this one. Ctrl or Cmd: this one added or taken away.
            const from = anchors.get(facet);
            const lines = all.slice(1) as string[];
            cursors.set(facet, all.indexOf(value)); // lines are marked: j and k now move without choosing
            if (event.shiftKey) {
              const [a, b] = [lines.indexOf(from ?? value), lines.indexOf(value)].map((at) => (at < 0 ? lines.indexOf(value) : at));
              chooseMany(facet, lines.slice(Math.min(a, b), Math.max(a, b) + 1));
            } else {
              anchors.set(facet, value);
              const next = chosen.includes(value) ? chosen.filter((each) => each !== value) : [...chosen, value];
              if (!next.length) cursors.delete(facet);
              chooseMany(facet, next);
            }
            return;
          }
          if (value !== undefined) anchors.set(facet, value);
          cursors.delete(facet); // a plain click chooses one line, as moving does again
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
    const oneDay = Boolean(onlyPick(view, 'day') && onlyPick(view, 'day') !== 'weekend');
    const headed = view.sort === 'date' && !view.descending && !oneDay;
    // Each showtime is a row of parts under headings. A part that is the same in every row is left out:
    // the day under day headings, the film or cinema when one is chosen.
    const parts = [
      ...(headed || oneDay ? [] : ['day' as const]),
      'time' as const,
      ...(onlyPick(view, 'film') ? [] : ['film' as const]),
      ...view.fields.filter((field) => !(field === 'cinema' && onlyPick(view, 'cinema'))),
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
            return part === 'film' || (part === 'time' && onlyPick(view, 'film'))
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
    // Where lines are marked, the line in hand is outlined: the cursor j and k move.
    columns.forEach((facet, index) => {
      lists[index].querySelector('.cursor')?.classList.remove('cursor');
      const at = cursors.get(facet);
      if (at !== undefined) lists[index].querySelectorAll('li:not(.heads):not(.note)')[at]?.classList.add('cursor');
    });
    lists[view.focus]?.querySelector('.cursor')?.scrollIntoView({ block: 'nearest' });
    for (const pane of panes) pane.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
    steps.replaceChildren(...[...columns, 'showtimes', 'details'].map((name, index) => {
      const facet = columns[index];
      const chosen = facet ? picked(view, facet) : [];
      const label = facet ? `${KINDS[facet].title}: ${chosen.length ? KINDS[facet].label(chosen[0])[0] + (chosen.length > 1 ? ` +${chosen.length - 1}` : '') : 'All'}` : index === results ? `Showtimes ${state.total}` : 'Details';
      const step = button(label, () => { view.focus = index; mark(); }, { class: index === view.focus ? 'here' : '' });
      if (name === 'details' && !state.rows.length) step.disabled = true;
      return step;
    }));
    steps.querySelector('.here')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    back.disabled = view.focus === 0;
    guardBack();
    const shown = state.rows[view.row];
    const one = onlyPick(view, 'film');
    const film = shown ? q.film(db, shown.filmId) : one ? q.film(db, one) : null;
    detail.replaceChildren(
      ...(shown ? showingDetails(shown) : film ? [bar(film.title)] : [bar('Details'), quickStart()]),
      ...(film ? filmDetails(film) : []),
    );
    detail.querySelector('.bar')?.append(settings()); // top right of the page, on the line of the column titles
    note();
  }

  function choose(facet: q.Facet, value: string | undefined) {
    chooseMany(facet, value === undefined ? [] : [value]);
  }
  /** Several values chosen in a column, of which a showing must offer any; none is All. */
  function chooseMany(facet: q.Facet, values: string[]) {
    pick(view, facet, values);
    view.row = 0;
    state.more = 0;
    draw();
  }

  /** A double bill: choose its film (and keep the cinema and day), and highlight it. */
  function follow(next: q.Neighbour) {
    if (columns.includes('film')) pick(view, 'film', [next.filmId]);
    if (view.picks.day && !view.picks.day.includes(next.date)) pick(view, 'day', [next.date]);
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
      ['Choose', 'a day, a film, a cinema… in any column; each counts what the others leave. Shift-click picks a run of lines, Ctrl- or Cmd-click one more. All at the top takes them back.'],
      ['Columns', 'Settings (Esc) adds, removes and orders them; so do :vs day, :q, << and >>.'],
      ['Keys', 'it is driven as vim is: hjkl, / and n, :set, :sort, u and the rest. :help lists them all.'],
      ['Bookmark', 'the columns, your choices and your cinemas are all in the page address. Bookmark it and it opens the same way anywhere.'],
    ]));
}

export function hideFilm(id: string) {
  toggle(hidden, [id]);
  pick(view, 'film', picked(view, 'film').filter((film) => film !== id));
  page?.draw();
}

/** The button that opens the settings drawer, as `:set` does. */
function settings(): HTMLButtonElement {
  return button('Settings', openPanel, { class: 'open-panel', title: 'Settings (Esc)', 'aria-keyshortcuts': 'Escape' });
}

function load(all: boolean): Promise<void> {
  return openListings(`./data/${all ? DATA.listings : DATA.london}`).then(
    (listings) => {
      setDb(listings);
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
/** Download the listings this page needs first, and draw the finder when they arrive. */
export function start() {
  if (needsEveryCinema(ticks)) everything = load(true);
  else load(false);
}
