import { DEFAULT_FIELDS, FIELDS, type Order } from './choices';
import { KINDS, ordersOf } from './columns';
import { button, h } from './dom';
import { drawer, fillPanel, openPanel, panel, setLondon, startOver } from './drawer';
import { addColumn, addToCalendar, closeColumn, rebuild } from './finder';
import { noteNow, undoOrRedo } from './history';
import { goTo, inHand, search } from './keys';
import * as q from './queries';
import { extras, londonOnly, toggle, view } from './state';
import { about } from './version';

// ---- Keys: the finder is driven as vim is -----------------------------------------
// Each column is a window and each choice or showtime a line. Normal mode moves and
// acts; the command line at the foot takes ex commands (:set, :sort, :vs, :q…) and
// searches (/ and ?). Nothing else is bound, so a vim user's habits carry over.

/** Normal mode, for :help. */
const NORMAL: [string, string][] = [
  ['h l  ← →', 'The column to the left or right; also w b, Backspace'],
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
  ['Space', 'Mark or unmark the line and move down, as in ranger or lf; on All, clear the marks. Then j k move without choosing'],
  ['V', 'Visual line: j k G gg mark every line from where V was pressed, added to any marks; Esc or Enter keeps them'],
  ['m{a-z}', 'Mark this view; then ‘{a-z} or `{a-z} comes back to it'],
  ['gx', 'Open the showing on its cinema\u2019s site to book it'],
  ['K', 'Play the film’s trailer'],
  ['Ctrl-g', 'Where you are'],
  ['Esc', 'Cancel a count or a half-typed command; with nothing to cancel, open the settings'],
];
/** Ex commands, for :help. */
const EX: [string, string][] = [
  [':vs {column}', 'Split: add a column (day, film, cinema, location, picture, language, access, events, seating, screen, cert, genre, people, distributor, release, chain)'],
  [':q  :close', 'Close the column'],
  [':only', 'Close every other column'],
  [':sort  :sort n  :sort rating', 'Order a column A–Z, by showings, or (films) by rating'],
  [':sort {by}  :sort! {by}', 'Order the showtimes by date, time, film, cinema, screen or seats; ! reverses'],
  [':filter {text}', 'Keep only the lines with that text; :filter alone shows them all again'],
  [':set  Esc', 'Settings'],
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
  ['q  Esc  :q', 'Close the settings'],
];
export const help = h('dialog', { class: 'panel keylist', 'aria-label': 'Help' }) as HTMLDialogElement;
help.addEventListener('click', (event) => { if (event.target === help) help.close(); });
help.addEventListener('close', seat);
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
export const command = h('input', { 'aria-label': 'Command', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' }) as HTMLInputElement;
const prompt = h('span', { class: 'prompt' });
const showcmd = h('span', { class: 'showcmd' });
const wildmenu = h('div', { class: 'wildmenu' });
const cmdline = h('div', { class: 'cmdline', role: 'status' }, wildmenu, prompt, command, message, showcmd);
document.body.append(cmdline);
/** Keep the command line in whichever dialog is open, as one shuts out the page behind it. */
export function seat() {
  const host = panel.open ? panel : help.open ? help : document.body;
  if (cmdline.parentElement !== host) host.append(cmdline);
}
let saying = 0;
/** A message on the command line, as vim gives; an error is marked as one. */
export function say(text: string, error = false) {
  seat();
  clearTimeout(saying);
  message.textContent = text;
  message.classList.toggle('error', error);
  cmdline.classList.toggle('on', Boolean(text) || cmdline.classList.contains('typing') || Boolean(showcmd.textContent));
  if (text) saying = window.setTimeout(() => say(''), 4000);
}
export function show(keys: string) {
  showcmd.textContent = keys;
  cmdline.classList.toggle('on', Boolean(keys) || cmdline.classList.contains('typing') || Boolean(message.textContent));
}

/** Shared by the finder's keys and the drawer's: a count and the first key of a pair (gg, zz, dd,
 *  <<, ma…) typed so far, and the last search, for n and N. */
export const held = { typed: '', pending: '', lastSearch: undefined as { pattern: string; back: boolean } | undefined };

// ---- The command line ----

/** What / and ? search, and n N repeat in: the finder's column in hand, or the settings drawer. */
export interface Buffer { here(): number; goTo(index: number): void; search(text: string, back: boolean, from: number, quiet?: boolean): boolean }
const finder: Buffer = { here: () => inHand().here, goTo, search };
const buffer = (): Buffer => (panel.open ? drawer : finder);

/** Where a search started, to go back to when it is given up. */
let searchFrom = 0;
const history_: Record<string, string[]> = { ':': [], '/': [] };
let recall = 0;
export function openCommand(kind: ':' | '/' | '?', text = '') {
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
      const pattern = text || held.lastSearch?.pattern || '';
      held.lastSearch = { pattern, back: kind === '?' };
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
      return addColumn(column, view.focus + 1);
    }
    case 'quit': case 'close':
      if (!facet) return say('The showtimes cannot be closed', true);
      return closeColumn(view.focus);
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
      held.lastSearch = undefined;
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
