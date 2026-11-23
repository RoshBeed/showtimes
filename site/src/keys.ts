import { onlyPick, PAGE, pick, picked } from './choices';
import { held, help, openCommand, say, show } from './cmdline';
import { KINDS } from './columns';
import { panel, where } from './drawer';
import { hideFilm, lastColumn, rebuild } from './finder';
import { noteNow, restore, undoOrRedo } from './history';
import * as q from './queries';
import { app, cursors, db, londonOnly, page, ticks, view } from './state';

/** Marks: m{a-z} keeps the view, '{a-z} comes back to it. Kept for this visit only. */
const marks = new Map<string, string>();
/** Visual line mode (V) in a column of choices: the line it began on and the line in hand.
 *  Every line between them is chosen; a showing must offer any of them. */
let visual: { focus: number; anchor: number; cursor: number; marked: string[] } | undefined;
/** The keys that move the line in hand, and so stretch a visual selection; any other key ends it. */
const STRETCH = new Set(['j', 'k', 'ArrowDown', 'ArrowUp', 'G', 'g', 'H', 'M', 'L', 'Ctrl-d', 'Ctrl-u', 'Ctrl-f', 'Ctrl-b', 'PageDown', 'PageUp']);
function endVisual() {
  if (!visual) return;
  visual = undefined;
  say('');
}

/** The column in hand, and the lines in it. */
export function inHand() {
  const at = page!;
  const facet = view.columns[view.focus] as q.Facet | undefined;
  const showtimes = view.focus === view.columns.length;
  const pane = app.querySelector<HTMLElement>('.column.focused');
  const length = facet ? at.options[view.focus].length : showtimes ? at.total : 0;
  const here = facet
    ? visual?.focus === view.focus ? visual.cursor : cursors.get(facet) ?? Math.max(0, at.options[view.focus].indexOf(picked(view, facet)[0]))
    : view.row;
  return { at, facet, showtimes, pane, length, here };
}
/** Go to a line of the column in hand: a choice, or a showtime (drawing more of them if need be). */
export function goTo(index: number) {
  const { at, facet, showtimes, length } = inHand();
  if (!length) return;
  index = Math.max(0, Math.min(length - 1, index));
  if (facet) {
    const lines = at.options[view.focus];
    if (visual?.focus === view.focus) {
      // Every line from where V was pressed to this one, with what was marked before; All adds nothing.
      visual.cursor = index;
      cursors.set(facet, index);
      const values = lines.slice(Math.min(visual.anchor, index), Math.max(visual.anchor, index) + 1);
      pick(view, facet, [...visual.marked, ...values.filter((value): value is string => value !== undefined)]);
      say('-- VISUAL LINE --');
    } else if (cursors.has(facet)) {
      // Lines are marked here: the cursor moves, and the marks stay.
      cursors.set(facet, index);
      return at.mark();
    } else {
      const value = lines[index];
      pick(view, facet, value === undefined ? [] : [value]);
    }
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
export function patternOf(text: string): RegExp {
  const flags = /[A-Z]/.test(text) ? '' : 'i';
  try { return new RegExp(text, flags); } catch { return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags); }
}
/** The next line matching, from a line, forward or back, wrapping round as vim does. */
export function search(text: string, back: boolean, from = inHand().here, quiet = false): boolean {
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
  if (visual && (visual.focus !== view.focus || !(STRETCH.has(key) || pair === 'g'))) {
    // Esc, Enter or V again keep what is chosen; any other key ends the selection, then acts.
    const keep = key === 'Escape' || key === 'Enter' || key === 'V';
    endVisual();
    if (keep) return event.preventDefault();
  }
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
        const id = (facet === 'film' ? onlyPick(view, 'film') : undefined) ?? shown?.filmId; // the chosen film, or the highlighted showtime's
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
    held.typed = counted ? String(n) : '';
    held.pending = key;
    return show(held.typed + key);
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
    V: () => {
      if (!facet) return say('V marks lines in a column of choices', true);
      visual = { focus: view.focus, anchor: here, cursor: here, marked: cursors.has(facet) ? picked(view, facet) : [] };
      goTo(here);
    },
    // As in ranger and lf: Space marks or unmarks the line in hand and moves down; on All it clears the marks.
    ' ': () => {
      if (!facet) return column(view.focus + n);
      const lines = at.options[view.focus];
      let marked = cursors.has(facet) ? picked(view, facet) : [];
      let line = here;
      for (let times = 0; times < n && line < lines.length; times += 1, line += 1) {
        const value = lines[line];
        if (value === undefined) { marked = []; continue; }
        marked = marked.includes(value) ? marked.filter((each) => each !== value) : [...marked, value];
      }
      pick(view, facet, marked);
      if (marked.length) cursors.set(facet, Math.min(line, lines.length - 1));
      else cursors.delete(facet);
      view.row = 0;
      at.more = 0;
      at.draw();
    },
    j: () => goTo(here + n), ArrowDown: () => goTo(here + n),
    k: () => goTo(here - n), ArrowUp: () => goTo(here - n),
    h: () => column(view.focus - n), ArrowLeft: () => column(view.focus - n), b: () => column(view.focus - n), Backspace: () => column(view.focus - n), '-': () => column(view.focus - n),
    l: () => column(view.focus + n), ArrowRight: () => column(view.focus + n), w: () => column(view.focus + n), Enter: () => column(view.focus + n),
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
    n: () => { if (held.lastSearch) for (let times = 0; times < n; times += 1) search(held.lastSearch.pattern, held.lastSearch.back); else say('E35: No previous regular expression', true); },
    N: () => { if (held.lastSearch) for (let times = 0; times < n; times += 1) search(held.lastSearch.pattern, !held.lastSearch.back); else say('E35: No previous regular expression', true); },
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
