# Agent notes

- A cinema listings finder with 15 provider modules, including ODEON, Vue, Everyman,
  Picturehouse, Showcase, Cineworld, Curzon and London independents. Two parts: `ingest/` (Python, uv)
  fetches each chain into its own SQLite file (`data/<chain>.sqlite`); `site/` (Vite, TypeScript,
  no UI framework) is a static page that holds the listings in memory. Its build
  (`npm run listings`) exports every chain's file into JSON documents (every cinema, and Greater
  London alone, which is loaded while only its cinemas are ticked) plus `areas.json`, built into
  the page; the browser runs no SQL and no WebAssembly. The documents' names carry a hash of their
  contents (`listings-<hash>.json.gz`, listed in `data/manifest.json` and built into the page as
  `__DATA__`), so a page always fetches the listings it was built with, whatever Pages' 10-minute
  cache holds. When the full document passes about 8 MB compressed (4.6 MB on 2026-11-23), split
  it by region as `london` is split.
- Each chain is two adapters. `ingest/src/showtimes_ingest/chains/<chain>/` fetches it (the
  interface is in `chains/__init__.py`); `site/src/chains/<chain>.ts` reads its stored record
  into the shared vocabulary at export (`Chain` in `chains/chain.ts`): cinema names and towns, tag
  names and kinds, seats, distributors, special events, booking link, published-until date.
  Everything chain-specific lives in those two places; the core, the export and the site name no
  chain. The stored file stays the chain's raw record; its reading changes at build time.
- IDs the site sees are namespaced by chain: `odeon-155`, `odeon-HO00012345`. A showing's own ID
  stays the chain's (it goes into the booking link). Films listed more than once (ODEON's UK and
  Irish editions, or by two chains) are merged when their titles match apart from case and
  punctuation, into the listing with the most showings. Titles are cleaned first by Claude, not by
  hand-written rules (the user's decision, 2026-11-21): `showtimes-titles`
  (`ingest/src/showtimes_ingest/titles.py`, Claude Opus 5.5) runs in its own job of each Publish run (`deploy.yml`, before the site is built), asks only about
  titles it has not seen, and keeps its decisions in `titles.json` on the data release. Each
  decision is the film's own name, the year the title gives (remakes stay apart), and tags for what
  the rest said (format, language, festival or series, screening type, add-ons). The export reads
  them; `site/src/titles.overrides.json` corrects a wrong decision. Each Publish summary lists what
  Claude decided. Deleting an entry from `titles.json` makes Claude decide it again. It signs in
  through Workload Identity Federation from the Publish job's GitHub OIDC token (no API key; the
  rule, organization, service account and workspace IDs are in `deploy.yml`).
- IMDb and Metacritic scores are looked up once per film across every chain, after the titles are
  cleaned (`showtimes-ratings`, `ingest/src/showtimes_ingest/ratings.py`, in Publish's titles job):
  one OMDb lookup per clean title and year, kept in `ratings.json` on the data release so OMDb is
  asked only about films it has not seen (the free key allows 1,000 a day); IMDb's own file
  refreshes the IMDb score each run. Its `titles` section gives each raw title as a chain lists
  it the scores of its film, and the export reads that, as it reads `titles.json`.
- The schema lives in `ingest/src/showtimes_ingest/store.py`. The site's tests read it from
  there, so change the schema and `site/src/export.ts` together. `site/src/queries.ts` answers
  every question with a loop over the showings; keep key presses free of anything slower.
- Special events (a chain's say: ODEON's `Event Cinema` tag and screen hire) are left out unless
  the address has `?show=events`.
- Each chain's file is both what the site shows and its ingest's only state between runs
  (release week, run history, screen sizes). It is published as `<chain>.sqlite.gz` on the
  `data` release, never committed.
- Read a chain only as its own website does: plain requests that say who is asking
  (`http.USER_AGENT`), or the site in a real browser (`browser.Browser`, ODEON's method: the site
  sets itself up for a visitor, the ingest asks its API from inside the page). Never pass a
  challenge or CAPTCHA: the browser stops at one. Cineworld and Curzon have working
  public guest pages read through the pinned curl-impersonate in Docker (`guest.py`),
  then the shared Vista collector (`chains/vista.py`); do not return to their blocked
  Webedia/ordinary-HTTP routes. ODEON is on the same Vista collector: curl-impersonate first,
  one fallback to a real browser (`vista_browser.py`), the user's choice on 2026-11-20.
  Everyman and Showcase share one adapter for Webedia's boxoffice platform
  (`chains/boxoffice.py`, `site/src/chains/boxoffice.ts`). Every chain shares the lifecycle in
  `refresh.py`. One workflow, Listings (`listings.yml`), runs the week: `plan` asks `policy.py`
  which chains are due (`scripts/due.sh`), `ingest` runs each due chain side by side
  (`ingest-provider.yml`, flags from `.github/chains.json`; the tailnet ones each as an ephemeral
  device `ingest-<chain>`) and hands its changed file on as an artifact, then `publish` calls
  `deploy.yml`, the data release's only writer, which publishes those files, cleans new titles
  and builds the site.
- Collection is weekly, not daily (the user's decision on 2026-11-20): each chain is due once per
  window in `policy.py` (Everyman Wednesday 06:00, the rest Tuesday 06:00, London time; ODEON,
  which some weeks publishes only by Wednesday evening, is tried once more at Wednesday 21:00 when
  its Tuesday run stopped short of the week's Thursday: `FALLBACK`), and Listings' crons (in UTC: GitHub's scheduler did not fire crons given a time zone) run at
  each window and twice more an hour later (a chain
  already stored is left out without contacting it). Keep the crons and `policy.py` in step.
  Publish also runs alone on a push to `main` or by hand, building the release's files as they are.
- Keep every chain's traffic minimal: one ingest per published week, no retry loops, and never
  fetch per-screening live data. Tests use a fake of each chain. ODEON's traffic goes through
  the owner's tailnet (`scripts/via-tailnet.sh`) with the auth key `TAILSCALE_AUTHKEY`, tagged
  `tag:ingest` (generic, not ODEON's: the user's decision on 2026-11-22); that tag's rights
  are set in the tailnet's policy, so leave them as they are. Two parts of the ingest get past
  the chains' own defences, as the owner's conscious choice (2026-11-23): ODEON, Vue,
  Picturehouse and Curzon refuse cloud addresses and are reached through the owner's home exit
  node, and Cineworld and Curzon are read with curl-impersonate, which presents Chrome's TLS
  fingerprint. The other rules still hold: never pass a challenge or CAPTCHA, and one ingest a week.
- There is no server and no secret in the site. The site is one finder (`site/src/main.ts` wires
  its modules: `state.ts` what is held, read live elsewhere and replaced only through its setters;
  `finder.ts` the columns, showtimes and details; `drawer.ts` the settings; `cmdline.ts` the
  command line, ex commands and `:help`; `keys.ts` normal mode; `history.ts` the address, undo and
  redo; `columns.ts` the kinds of column; `dom.ts` and `format.ts` helpers. The modules import
  each other in a cycle, so their top-level code uses only other modules' function declarations):
  columns of choices, then the showtimes, then the details. Every page the site once had is a
  column a visitor can add (`FACETS` in `queries.ts`; `q.find` counts each column with the
  others' choices applied). What is shown at all is in the query string
  (`?cinemas=london&hidden=…&show=events`; Greater London ticked whole is written `london`),
  and the view in the hash (`#cols=day,film,screen&film=…&film=…&order=film:rating&col=2&row=5`;
  a column with several choices repeats its name, and a showing matches any of them: Shift-click
  a range, Ctrl/Cmd-click one more, or the keys of ranger and lf: Space marks the line and moves
  down, `V` marks a range, and a column with marks has a free cursor (`cursors` in `state.ts`), so
  j and k move without choosing until Space on All clears them. A column's heading or empty space,
  clicked, goes to it and changes nothing. By mouse, a column of choices is moved by dragging its
  heading onto another, closed with the × on its heading, and added with the + on the showtimes'
  heading; these, `:vs`, `:q` and `<<` `>>` share `addColumn`, `closeColumn` and `moveColumn`
  in `finder.ts`),
  so a bookmark is a saved view; the default view has no hash at all. `fields=` picks what each
  showtime row shows (`FIELDS` in `choices.ts`), and rows too wide for their column leave out the
  least needed first. There is no header or footer: Esc (with nothing half-typed) or the button
  at the right of the details' heading (top right of the page) opens the settings, a window floating over the columns,
  which also says how fresh the listings are and which version is running. Nothing is stored in the browser. The default view is Cinema then
  Film, over every cinema. On a phone one column shows at a time; ‹ at the top left, or the
  phone's own back, goes back a column (one spare history entry, `guardBack` in `history.ts`).
- The keys are vim's and nothing else: normal mode, ex commands (`:set`, `:sort`, `:vs`, `:q`,
  `:filter`) and `/` `?` searches on the command line. `NORMAL`, `EX` and `DRAWER` in `cmdline.ts`
  are the `:help` list; keep it in step with the keys. The settings drawer is a buffer too.
- This repository is public. Never commit credentials; the tailnet auth key and the OMDb key are
  GitHub Actions secrets.
- `site/e2e/` holds Playwright tests that drive the built site by keys, clicks and scrolling
  against a small set of listings (`npm run e2e`; `PW_CHANNEL=chrome` uses an installed Chrome).
  Add one for any change to how the site is navigated. CI runs them in Playwright's own image
  (`mcr.microsoft.com/playwright:v<version>-noble` in `ci.yml`); keep its version the same as
  `@playwright/test` in `site/package.json` when either changes.
- Ship through a pull request and CI. The Publish workflow (`deploy.yml`, "Publish site and listings") publishes `main` and the latest listings to GitHub Pages
  (showtimes.ramuk.net). `main` is the only long-lived branch: every change reaches it by a
  pull request from its own short-lived branch cut from `main`; never push straight to it.
  There is no dev deployment: work in progress is tried in the cloud environment, whose
  running services the owner reaches over their tailnet.
- Work runs in git worktrees: each separate task gets its own worktree on its own branch
  cut from `main` (a worker agent started with worktree isolation, or the session entering
  a worktree), never in the main checkout, so tasks run side by side without touching each
  other's files. The coordinating session reviews each branch, merges it and removes the
  worktree. Claude merges its own pull requests with a squash once CI is green and there
  is no conflict (the owner merges nothing).
  History before 2026-11-23 was squashed into eight commits (the owner's choice); the
  pull requests' own pages keep the detail. From then on each pull request is one commit.
  Dependabot (`.github/dependabot.yml`) opens one grouped pull request a week per ecosystem
  (actions, the site's npm, the ingest's uv, its Docker base); review its changes and merge it the
  same way once CI is green.
- Light (`chains/light/`) reads its public fortnight guide **and coming-soon JSON**; Olympic
  (`chains/olympic/`) reads three Cinema Cloud HTML pages for four venues; Reel
  (`chains/reel/`) reads public Jacro film pages. Hull, Morecambe and Quinton use
  the shared Admit One whole-programme reader (`chains/admitone.py`), so all 16
  Reel cinemas are stored. Prince Charles uses one `/whats-on/` page, not the
  incomplete homepage film directory. Rio, Lexi, Phoenix and ActOne share Opus
  `Events` JSON. Older Opus sites do not expose this same data. `chains/pages.py` is the small
  HTML reader. The export's optional `bookingByCinema` map supports groups with
  different ticketing hosts; `screening_links` handles external or unavailable links.
  Old data files without that optional table still export. The ordinary booking template handles other
  chains. Programme IDs for Light and Reel are scoped per cinema before title merging.
- `docs/cinema-sources.md` records the source survey, including smaller chains and
  independents, with credit to andycroll/atthemovies and its provider gems for source routes.
  BFI Southbank gives only its first 100 results; pagination and IMAX are blocked.
  Do not register BFI as a complete working feed based on those partial results.
- All work happens in Claude Code's cloud environment `showtimes`; there is no local
  development environment, and nothing is installed or run on the owner's Mac. Its
  setup script installs the site's packages and Playwright browser and `uv sync`s the
  ingest, so `npm test`, `npm run build`, `npm run e2e` and the ingest's ruff and
  `PYTHONPATH=src uv run python -m unittest discover -s tests` run directly. Containers
  there reach the network only through the session proxy, so build `ingest/Dockerfile`
  with `showtimes-docker-build` (same arguments as `docker build`), not `docker build`.
  Publish through the existing CI/CD path.
- Each session there joins the owner's tailnet as `showtimes-cloud` (`scripts/cloud-tailnet.sh`,
  run by the SessionStart hook in `.claude/settings.json`), so the owner opens a dev server at
  `http://<its tailnet IP>:<port>/`; serve on 127.0.0.1. It needs `TS_AUTHKEY` (a pre-signed,
  reusable, ephemeral key tagged `tag:showtimes-cloud`, set by the owner in the environment's
  settings) and does nothing without it. Never print the key or pass it as an argument.
- Build `ingest/Dockerfile` from the repo root: `checks` runs lint/tests; `api`
  contains the pinned curl binary without WebKit; default `runtime` includes WebKit.
  `bash scripts/ingest.sh <provider> run` writes the mounted data file without publishing.
  CI, Ingest and Publish use these same containers, built by `.github/actions/ingest-image`
  with the GitHub Actions layer cache, so apt, curl-impersonate and WebKit download only when
  the Dockerfile or what it copies changes. Vista accepts at most five cinema IDs
  per request; collect only the cinemas advertised for each business date, with
  no arbitrary future cutoff. Guest tokens stay in memory/stdin, never logs or files.
- The README is for visitors only: what the site does and how to use it, with one listings badge
  at the top. No development detail (that belongs here) and no keys (`:help` has them). Keep it
  short. The badge is a shields.io endpoint, `data/badge.json` on the live site, written by the
  export from the listings themselves (`site/src/badge.ts`): green with when the chains were updated, or the
  chains whose latest run failed and those not updated for over nine days. Workflow badges would show runs, not what the site shows.
- Adding a chain: (1) a package `ingest/src/showtimes_ingest/chains/<chain>/` writing the
  `store.py` schema and offering what `chains/__init__.py` lists (`NAME`, `check`, `ingest`,
  `settled_reason`, `search_title`), added to `CHAINS` with tests against a fake; a chain on a
  platform another uses needs only its name and website (`chains/everyman/`). (2) A
  `site/src/chains/<chain>.ts` implementing `Chain`, added to `CHAINS` in `index.ts`. (3) A row in
  `.github/chains.json` (`browser`, `tailnet` as needed), and its window in `policy.py` (with a
  Listings cron if the window is new). Check first that the chain's terms allow it.
- Runs by hand: Listings (`listings.yml`) with `chains=all` or chain names, and
  `command=check` (ingests only if the week is not stored; contacts nobody otherwise) or `run`
  (ingests now: only when needed, as it adds to the chain's traffic). A failure is recorded in the
  chain's file and retried at the next check, at most three times a week. The site needs the
  listings to show anything: `scripts/listings.sh download` (uses `gh`; in the cloud environment,
  where `gh` is search-only, `curl -L` each asset from
  `https://github.com/RoshBeed/showtimes/releases/download/data/`).
- Repository settings: secrets `TAILSCALE_AUTHKEY` and `OMDB_API_KEY` (optional, IMDb and
  Metacritic scores); variables `TAILSCALE_EXIT_NODE`, `ODEON_CINEMAS` (optional, comma-separated
  site IDs; empty is every cinema), and `ODEON_INGEST`, `CHAINS_INGEST` (every other chain) or
  `<CHAIN>_INGEST` set to `false` to pause a chain on schedule (read by `scripts/due.sh`; a run by
  hand ignores them).
