# Agent notes

- A cinema listings finder with 15 provider modules, including ODEON, Vue, Everyman,
  Picturehouse, Showcase, Cineworld, Curzon and London independents. Two parts: `ingest/` (Python, uv)
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
  `refresh.py` and has its own workflow (`ingest-<chain>.yml` on `ingest-provider.yml`); they
  run side by side, the tailnet ones each as an ephemeral device `ingest-<chain>`.
- Collection is weekly, not daily (the user's decision on 2026-11-20): each chain is due once per
  window in `policy.py` (ODEON Wednesday 21:00, Everyman Wednesday 06:00, the rest Tuesday 06:00,
  London time), and its workflow's cron runs at that window and twice more an hour later. Keep the
  crons and `policy.py` in step. An ingest publishes only its file on the data release; Publish
  (`deploy.yml`) builds every file into the site on its own schedule after each window (Tuesday and
  Wednesday 09:41, Thursday 02:41 UTC; keep it after the ingest crons), on a push to `main`, or by
  hand, which is how a manual ingest reaches the site.
- Keep every chain's traffic minimal: one ingest per published week, no retry loops, and never
  fetch per-screening live data. Tests use a fake of each chain. ODEON's traffic goes through
  the owner's tailnet (`scripts/via-tailnet.sh`) with the auth key `TAILSCALE_AUTHKEY`, tagged
  `tag:ingest` (generic, not ODEON's: the user's decision on 2026-11-22); that tag's rights
  are set in the tailnet's policy, so leave them as they are.
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
  are the `:help` list; keep it in step with the keys. The settings drawer is a buffer too.
- This repository is public. Never commit credentials; the tailnet auth key and the OMDb key are
  GitHub Actions secrets.
- `site/e2e/` holds Playwright tests that drive the built site by keys, clicks and scrolling
  against a small set of listings (`npm run e2e`; `PW_CHANNEL=chrome` uses an installed Chrome).
  Add one for any change to how the site is navigated.
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
  CI and Ingest use these same containers. Vista accepts at most five cinema IDs
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
  `site/src/chains/<chain>.ts` implementing `Chain`, added to `CHAINS` in `index.ts`. (3) An
  `ingest-<chain>.yml` on `ingest-provider.yml` at its weekly window (`browser`, `via-tailnet` as
  needed), the chain in `ingest.yml`'s dispatcher. Check first that
  the chain's terms allow it.
- Runs by hand: `ingest-<chain>.yml` or the dispatcher `ingest.yml` (`provider=all`), with
  `command=check` (ingests only if the week is not stored; contacts nobody otherwise) or `run`
  (ingests now: only when needed, as it adds to the chain's traffic). A failure is recorded in the
  chain's file and retried at the next check, at most three times a week. The site needs the
  listings to show anything: `scripts/listings.sh download` (uses `gh`; in the cloud environment,
  where `gh` is search-only, `curl -L` each asset from
  `https://github.com/RoshBeed/showtimes/releases/download/data/`).
- Repository settings: secrets `TAILSCALE_AUTHKEY` and `OMDB_API_KEY` (optional, IMDb and
  Metacritic scores); variables `TAILSCALE_EXIT_NODE`, `ODEON_CINEMAS` (optional, comma-separated
  site IDs; empty is every cinema), and `ODEON_INGEST`, `CHAINS_INGEST` (every other chain) or
  `<CHAIN>_INGEST` set to `false` to pause schedules.
