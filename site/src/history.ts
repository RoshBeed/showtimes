// The view kept in the address, and undo and redo through earlier addresses.
import { readChoice, writeView } from './choices';
import { say } from './cmdline';
import { render } from './finder';
import { extras, hidden, narrow, page, setDrawn, ticks, view } from './state';

/** Earlier states of the address, for u to go back to and Ctrl-r to come forward to again. */
interface State { key: string; href: string }
const undos: State[] = [];
const redos: State[] = [];
let recorded: State | undefined;
/** Where undo stops: the address the finder was first drawn at. */
export function startHistory() {
  recorded ??= { key: location.search + writeView({ ...view, focus: 0, row: 0 }), href: location.search + location.hash };
}
let noting = 0;
/** Put the view in the address after a short pause: browsers limit how often an address may change. */
export function note() {
  clearTimeout(noting);
  noting = window.setTimeout(noteNow, 300);
}
export function noteNow() {
  clearTimeout(noting);
  const hash = writeView(view);
  if (hash !== location.hash) history.replaceState(history.state, '', location.pathname + location.search + hash);
  setDrawn(location.hash);
  // A change to what is chosen or shown can be undone; moving the highlight alone cannot.
  const key = location.search + writeView({ ...view, focus: 0, row: 0 });
  if (recorded && key !== recorded.key) {
    undos.push(recorded);
    redos.length = 0;
  }
  recorded = { key, href: location.search + location.hash };
}

/** Put the page at an earlier address and draw it. */
export function restore(href: string) {
  history.replaceState(null, '', location.pathname + href);
  for (const [set, name] of [[ticks, 'cinemas'], [hidden, 'hidden'], [extras, 'show']] as const) {
    set.clear();
    for (const id of readChoice(location.search, name)) set.add(id);
  }
  render();
}
export function undoOrRedo(back: boolean, times = 1) {
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

// On a phone one column shows at a time, and its back gesture goes back a column, as ‹ does.
// While the phone is past the first column one spare history entry is kept, so that back
// lands on this page; from the first column back leaves the site as usual.
let guarded = false;
let dropping = false;
/** Keep the spare entry in step with the column shown: up past the first, gone on it. */
export function guardBack() {
  if (narrow.matches && view.focus > 0 && !guarded) {
    // The entry under the spare one is marked, so that back onto it is told from a new address.
    history.replaceState({ under: true }, '', location.href);
    history.pushState(null, '', location.href);
    guarded = true;
  } else if (view.focus === 0 && guarded && !dropping) {
    dropping = true;
    history.back();
  }
}
/** ‹: back a column, through the history while the spare entry is up. */
export function goBack() {
  if (guarded) history.back();
  else if (view.focus > 0) { view.focus -= 1; page?.mark(); }
}
/** Back, by ‹ or the phone's own: the column before, with every choice kept. */
export function backed(event: PopStateEvent) {
  guarded = false;
  // Any other move through the history, such as a new address typed, is the address's to draw.
  if (!(event.state as { under?: boolean } | null)?.under) { dropping = false; return; }
  history.replaceState(null, '', location.href);
  if (dropping) dropping = false;
  else view.focus = Math.max(0, view.focus - 1);
  // The entry gone back to may hold an older view; the address keeps this one.
  noteNow();
  page?.mark();
}
