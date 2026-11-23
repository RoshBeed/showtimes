// The site is one finder: columns of choices side by side, each counting what the
// others leave, then the showtimes that match, then the highlighted one's details.
// The visitor picks which columns to show and in what order, and all of it is in
// the page's address, so a bookmark is a saved view. Driven by keys, clicks or taps.
//
// The modules, each a part of the page: state.ts (what is held), finder.ts (the columns, the
// showtimes and the details), drawer.ts (the settings), cmdline.ts (the command line, ex
// commands and :help), keys.ts (normal mode), history.ts (the address, undo and redo),
// columns.ts (the kinds of column), dom.ts and format.ts (small helpers).
import './cmdline';
import './drawer';
import './keys';
import { render, start } from './finder';
import { drawn, narrow, page } from './state';

window.addEventListener('hashchange', () => { if (location.hash !== drawn) render(); });
narrow.addEventListener('change', () => { if (page) render(); });
start();
