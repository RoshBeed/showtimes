import { DEFAULT_COLUMNS, DEFAULT_FIELDS, FIELDS, LONDON } from './choices';
import { type Buffer, command, held, openCommand, say, seat, show } from './cmdline';
import { FIELD_ABOUT, KINDS, names, PARTS } from './columns';
import { button, checkbox, count, h } from './dom';
import { hideFilm, rebuild } from './finder';
import { noteNow, undoOrRedo } from './history';
import { patternOf } from './keys';
import * as q from './queries';
import { address, db, extras, hidden, londonOnly, ticks, toggle, view } from './state';

// ---- Settings: a drawer at the side, so the finder shows each change as it is made ----

export const panel = h('dialog', { class: 'panel', 'aria-label': 'Settings' }) as HTMLDialogElement;
document.body.append(panel);
panel.addEventListener('click', (event) => { if (event.target === panel) panel.close(); }); // a click outside it
panel.addEventListener('close', seat); // the command line goes back to the page
/** Whether the visitor asked to pick cinemas one by one, before ticking any. */
let choosing = false;
/** What is typed into the cinema search, kept while the drawer is redrawn. */
let cinemaSearch = '';

/** London only on or off; switched over when not said which. */
export function setLondon(on = !londonOnly()) {
  choosing = false;
  ticks.clear();
  toggle(ticks, on ? [...LONDON] : [], true);
  rebuild();
  if (panel.open) fillPanel();
}


/** Where the finder looks, in a few words, for the drawer. */
export function where(): string {
  if (!ticks.size) return 'Every cinema';
  if (londonOnly()) return 'London only';
  return ticks.size === 1 ? names.get([...ticks][0]) ?? '1 cinema' : count(ticks.size, 'cinema');
}

export function openPanel() {
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
export function startOver() {
  choosing = false;
  for (const chosen of [ticks, hidden, extras]) chosen.clear();
  address();
  Object.assign(view, { columns: [...DEFAULT_COLUMNS], picks: {}, orders: {}, fields: [...DEFAULT_FIELDS], focus: 0, row: 0, sort: 'date', descending: false, text: '' });
}

export function fillPanel() {
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
export const drawer: Buffer = {
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
  if (/^[1-9]$/.test(key) || (key === '0' && held.typed)) {
    event.preventDefault();
    held.typed += key;
    return show(held.typed + held.pending);
  }
  const n = Number(held.typed || 1);
  const counted = Boolean(held.typed);
  const pair = held.pending;
  held.typed = '';
  held.pending = '';
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
    held.typed = counted ? String(n) : '';
    held.pending = key;
    return show(held.typed + key);
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
    n: () => { if (held.lastSearch) drawer.search(held.lastSearch.pattern, held.lastSearch.back, drawer.here()); },
    N: () => { if (held.lastSearch) drawer.search(held.lastSearch.pattern, !held.lastSearch.back, drawer.here()); },
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
