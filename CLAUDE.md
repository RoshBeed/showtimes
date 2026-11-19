# Agent notes

- A cinema listings finder for any chain; ODEON is the first. Two parts: `ingest/` (Python, uv)
  fetches each chain into its own SQLite file (`data/<chain>.sqlite`); `site/` (Vite, TypeScript,
  no UI framework) is a static page that holds the listings in memory. Its build
  (`npm run listings`) exports every chain's file into JSON documents (every cinema, and Greater
  London alone, which is loaded while only its cinemas are ticked) plus `areas.json`, built into
  the page; the browser runs no SQL and no WebAssembly.
- Each chain is two adapters. `ingest/src/showtimes_ingest/chains/<chain>/` fetches it (the
  interface is in `chains/__init__.py`); `site/src/chains/<chain>.ts` reads its stored record
  into the shared vocabulary at export (`Chain` in `chains/chain.ts`): cinema names and towns, tag
  names and kinds, seats, distributors, special events, booking link, published-until date.
  Everything chain-specific lives in those two places; the core, the export and the site name no
  chain. The stored file stays the chain's raw record; its reading changes at build time.
- IDs the site sees are namespaced by chain: `odeon-155`, `odeon-HO00012345`. A showing's own ID
  stays the chain's (it goes into the booking link). Films listed more than once (ODEON's UK and
  Irish editions, or by two chains) are merged when their titles match apart from case and
  punctuation, into the listing with the most showings.
- The schema lives in `ingest/src/showtimes_ingest/store.py`. The site's tests read it from
  there, so change the schema and `site/src/export.ts` together. `site/src/queries.ts` answers
  every question with a loop over the showings; keep key presses free of anything slower.
- Special events (a chain's say: ODEON's `Event Cinema` tag and screen hire) are left out unless
  the address has `?show=events`.
- Each chain's file is both what the site shows and its ingest's only state between runs
  (release week, run history, screen sizes). It is published as `<chain>.sqlite.gz` on the
  `data` release, never committed.
- Keep every chain's traffic minimal: one ingest per published week, no retry loops, and never
  fetch per-screening live data. Tests use a fake of each chain. ODEON's traffic goes through
  the owner's tailnet (`scripts/via-tailnet.sh`); its tailnet hostname and tag are set in the
  tailnet's policy, so leave them as they are.
- There is no server and no secret in the site. The site is one finder (`site/src/main.ts`):
  columns of choices, then the showtimes, then the details. Every page the site once had is a
  column a visitor can add (`FACETS` in `queries.ts`; `q.find` counts each column with the
  others' choices applied). What is shown at all is in the query string
  (`?cinemas=london&hidden=…&show=events`; Greater London ticked whole is written `london`),
  and the view in the hash (`#cols=day,film,screen&film=…&order=film:rating&col=2&row=5`),
  so a bookmark is a saved view; the default view has no hash at all. `fields=` picks what each
  showtime row shows (`FIELDS` in `choices.ts`), and rows too wide for their column leave out the
  least needed first. Nothing is stored in the browser. The default view is Cinema then
  Film, over every cinema. On a phone one column shows at a time.
- The keys are vim's and nothing else: normal mode, ex commands (`:set`, `:sort`, `:vs`, `:q`,
  `:filter`) and `/` `?` searches on the command line. `NORMAL`, `EX` and `DRAWER` in `main.ts`
  are the `:help` list and the README tables; keep them in step. The settings drawer is a buffer too.
- This repository is public. Never commit credentials; the tailnet identity and the OMDb key are
  GitHub Actions secrets.
- `site/e2e/` holds Playwright tests that drive the built site by keys, clicks and scrolling
  against a small set of listings (`npm run e2e`; `PW_CHANNEL=chrome` uses an installed Chrome).
  Add one for any change to how the site is navigated.
- Ship through a pull request and CI. The Deploy workflow publishes `main` to GitHub Pages.
