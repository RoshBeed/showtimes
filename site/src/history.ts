// The view kept in the address, and undo and redo through earlier addresses.
import { readChoice, writeView } from './choices';
import { say } from './cmdline';
import { render } from './finder';
import { extras, hidden, setDrawn, ticks, view } from './state';

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
  if (hash !== location.hash) history.replaceState(null, '', location.pathname + location.search + hash);
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
