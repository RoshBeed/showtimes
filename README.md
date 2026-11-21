# showtimes

[![CI](https://github.com/RoshBeed/showtimes/actions/workflows/ci.yml/badge.svg)](https://github.com/RoshBeed/showtimes/actions/workflows/ci.yml)
[![Deploy](https://github.com/RoshBeed/showtimes/actions/workflows/deploy.yml/badge.svg)](https://github.com/RoshBeed/showtimes/actions/workflows/deploy.yml)
[![ODEON](https://github.com/RoshBeed/showtimes/actions/workflows/ingest-odeon.yml/badge.svg)](https://github.com/RoshBeed/showtimes/actions/workflows/ingest-odeon.yml)

**Live site: [showtimes.ramuk.net](https://showtimes.ramuk.net)** · Greater London only:
[showtimes.ramuk.net/?cinemas=london](https://showtimes.ramuk.net/?cinemas=london)

What's on at the cinema, on which screen, and how big that screen is. Pick a
cinema, a film, a day or a format in columns side by side; each column counts
what the others leave, and the matching showtimes and their details stay in
view. Nothing is booked here: each showing links to its cinema's own booking
page and can be added to your calendar.

The listings come from cinema chains, each through an adapter of its own:
ODEON, Vue, Everyman, Picturehouse, Showcase, Cineworld, Curzon, The Light, Reel,
Olympic Studios and London independents. [Adding a
chain](#adding-a-chain) is a module on each side.

![The site as its link opens it: the Chain, Cinema and Film columns, every showtime, and the first showtime's details with its double bills and the film's synopsis](docs/screenshots/desktop.png)

## Using the site

1. **Choose where.** Open **Settings** (top right, or `:set`) and pick *Every cinema*,
   *London only*, or *Choose cinemas* to tick the ones you go to.
2. **Choose your columns.** Settings lists the columns you show, left to right;
   move or remove each, and add others: Day (with Today and This weekend), Film,
   Cinema, Location, Picture, Language, Accessibility, Events, Seating, Screen
   (biggest first), Certificate, Genre, People, Distributor, Release (out now or
   opening soon) and Chain. The site opens on Chain, Cinema and Film. Until a chain
   is picked, the Cinema column says whose each cinema is.
3. **Narrow it down.** Pick something in any column. Every column shows how many
   showings each choice would leave, and **All** at the top of each takes a choice
   back. Search a column with `/`, narrow it with `:filter`, and order it A–Z, by
   number of showings or (films) by rating with `:sort`.
4. **Pick a showtime.** The showtimes are a table: click a heading to order by
   it, and click it again to reverse. Settings chooses what each row shows
   besides its time and film: end time, picture, language, access, certificate,
   cinema, screen and seats. A showtime's details show beside it: the screen and its seats, the
   film's own start and end, the picture format, seating and access, the films
   you could see straight before or after it (double bills), and the film's
   synopsis, ratings and trailer. **Book on …** opens the cinema's own booking page.
5. **Bookmark it.** The columns, your choices in them and your cinemas are all in
   the page address, and nothing is stored in the browser. A bookmark is a saved
   view, and a shared link opens the same way for anyone.

Concerts, theatre, opera and other special events are left out unless you switch
them on in Settings. On a computer the footer says how fresh the listings are and
how far every chain's full schedule runs; days after that hold advance bookings only.

![Settings, a drawer at the side opened with :set: every cinema, London only or chosen cinemas, with /london only on the command line putting the cursor on London only; the columns in order with buttons to move and remove them, and buttons to add others](docs/screenshots/desktop-settings.png)

### On a phone

One column shows at a time. The row of buttons along the top names each column
and what is chosen in it; tap one to go back to it. Choosing something moves on to
the next column, and tapping a showtime opens its details.

<p>
  <img src="docs/screenshots/phone-films.png" alt="On a phone: the Film column for ODEON West End" width="260">
  <img src="docs/screenshots/phone-showtimes.png" alt="On a phone: the showtimes of Dune: Part Three at West End, day by day" width="260">
  <img src="docs/screenshots/phone-details.png" alt="On a phone: one showing's details, with the booking link" width="260">
</p>

### Keys

The finder is driven as vim is: each column is a window and each choice or showtime
a line, so the habits carry over. Counts work (`5j`, `3l`, `12G`), commands go on the
command line at the foot, Tab completes them as vim's wildmenu does, and `:help` on
the site lists all of this.

![The command line: :vs and Tab list the columns that can be added, with location selected](docs/screenshots/desktop-command.png)

| Normal mode | Does |
| --- | --- |
| `h l ← →` | The column to the left or right; also w b, Backspace Space |
| `j k ↓ ↑` | Down or up a line: choose in a column, or move through the showtimes |
| `Enter -` | Into the next column, or back out of it, as in netrw |
| `0 ^ $` | The first column, or the showtimes |
| `gg G` | The first or last line; with a count, that line (12G) |
| `Ctrl-d Ctrl-u` | Half a screen down or up |
| `Ctrl-f Ctrl-b` | A screen down or up |
| `Ctrl-e Ctrl-y` | Scroll a line down or up |
| `H M L` | The top, middle or bottom line on screen |
| `zz zt zb` | Scroll the line to the middle, top or bottom |
| `{ }` | The previous or next day of showtimes |
| `/ ?` | Search forward or back in the column (smartcase, regular expressions) |
| `n N` | The next or previous match |
| `<< >>` | Move the column left or right |
| `dd` | Hide the film everywhere |
| `yy` | Yank (copy) the link to this view |
| `u Ctrl-r` | Undo or redo |
| `m{a-z}` | Mark this view; then ‘{a-z} or `{a-z} comes back to it |
| `gx` | Open the showing on its cinema’s site to book it |
| `K` | Play the film’s trailer |
| `Ctrl-g` | Where you are |
| `Esc` | Cancel a count or a half-typed command |

| Command | Does |
| --- | --- |
| `:vs {column}` | Split: add a column (day, film, cinema, location, picture, language, access, events, seating, screen, cert, genre, people, distributor, release, chain) |
| `:q :close` | Close the column |
| `:only` | Close every other column |
| `:sort :sort n :sort rating` | Order a column A–Z, by showings, or (films) by rating |
| `:sort {by} :sort! {by}` | Order the showtimes by date, time, film, cinema, screen or seats; ! reverses |
| `:filter {text}` | Keep only the lines with that text; :filter alone shows them all again |
| `:set` | Settings |
| `:set london nolondon london!` | London only on, off, or switched |
| `:set events noevents` | Event cinema shown or left out |
| `:set fields=… fields+=ends fields-=picture fields&` | What each showtime shows (ends, picture, language, access, cert, cinema, screen, seats); & is the default |
| `:{number}` | That line |
| `:w` | Copy the link to this view |
| `:e!` | Start over: every cinema, the default columns, nothing hidden |
| `:cal` | Add the showing to your calendar |
| `:help F1` | This list |

The settings drawer (`:set`) reads as a buffer too, a line to each choice:

| In settings | Does |
| --- | --- |
| `j k ↓ ↑` | The next or previous line |
| `h l ← →` | Along a line, such as a column’s ← → × |
| `gg G Ctrl-d Ctrl-u` | The top, the bottom, half a screen |
| `Space Enter` | Tick, choose or press what is on the line |
| `/ ? n N` | Search the lines: /aber then Space ticks Aberdeen |
| `i` | Type in the cinema search; Esc leaves it |
| `dd << >>` | Remove a column, or move it left or right |
| `u Ctrl-r` | Undo or redo |
| `q Esc :q` | Close the drawer |

Everything also works by clicking or tapping.

## How it works

There is no server. A GitHub Actions workflow fetches each chain's listings into
a SQLite file of its own, on that chain's schedule. The site is plain files on
GitHub Pages; the browser downloads the listings once (about 5 MB, 1 MB with
London only) and keeps them in memory, so every key press is answered at once.

### How it is put together

| Part | Where | What it does |
| --- | --- | --- |
| Ingest | `ingest/` (Python) | A core (the shared schema, the runs, IMDb and Metacritic ratings) and a package for each chain in `chains/` that fetches it into its own SQLite file |
| Export | `site/src/export.ts`, `site/src/chains/` | At build time, reads every chain's file through that chain's module, which names its tags, towns, seats and booking link in the shared vocabulary, and writes the JSON the page downloads |
| Titles | `ingest/src/showtimes_ingest/titles.py`, `site/src/titles.ts` | Claude reads every title the chains list and cleans each new one: the film's own name without what chains add (`(4DX)`, `(1995)`, `(Tamil)`, `Relaxed:`, `LDNDOCS 2026:`, `+ Q&A`), which becomes tags on those showings, so every chain's listing of a film is one film. Decisions are kept in `titles.json` on the `data` release, so each title is asked about once; each Deploy run's summary lists them, and `site/src/titles.overrides.json` corrects any. There is no API key: the Deploy job signs in to Claude with its GitHub identity through Workload Identity Federation (the IDs are in `deploy.yml`) |
| Site | `site/src/` (TypeScript, Vite) | The interface; it knows no chain's own strings |
| Listings | the `data` release of this repository | Each chain's `<chain>.sqlite.gz`; also its ingest's only memory between runs |
| Workflows | `.github/workflows/` | `Ingest` (each chain's schedule), `Deploy` (GitHub Pages), `CI` |

A chain's stored file stays its raw record, so how it reads can change at the
next build without fetching anything again.

### The chains

| Chain | How its listings are read | Cinemas | Seat counts |
| --- | --- | --- | --- |
| ODEON | Vista's API, with the guest token its website gives a browser | about 110, UK and Ireland | yes, from seat plans, fetched once per screen |
| Vue | its website in a real browser, then the API its pages call (`chains/vue/`) | about 90, UK and Ireland | no |
| Everyman | Webedia's boxoffice API, plain requests (`chains/boxoffice.py`) | about 50 | no |
| Picturehouse | its website in a real browser, keeping the listings the page itself fetches | 25 | no |
| Showcase | the same platform and adapter as Everyman | 16 | no |
| Cineworld | public ticketing-page guest token, then Vista's advertised dates and showtimes | 87 | no |
| Curzon | public page-data guest token, then the shared Vista adapter | 15 | no |
| The Light | Glitterfish fortnight guide plus all advertised coming-soon bookings | 14 | no |
| Olympic Studios | public Cinema Cloud programme pages | 4: Barnes, Power Station, Arches and Selfridges | no |
| Reel | Jacro film pages, plus full Admit One programmes for the three older sites | all 16 | no |
| Prince Charles Cinema | one complete programme page, including advance bookings and sold-out showings | 1 | no |
| Rio, Lexi, Phoenix and ActOne | shared Opus adapter; each venue's complete public programme in one page | 1 each | no |

Reading a chain "in a real browser" is ODEON's method, shared in
`showtimes_ingest/browser.py`: headless WebKit opens the chain's website, the site
sets itself up for a visitor as it always does, and the ingest asks the site's own
API from inside the page. If a site answers with a challenge (a check that the
visitor is a person) the ingest stops there and does not try to pass it.

Cineworld and Curzon use the public guest-session routes identified by
[At The Movies](https://github.com/andycroll/atthemovies), adapted to our existing
Python modules and storage. Their guest pages are read by curl-impersonate's
Chrome 150 profile, bundled and checksum-verified in the ingest container. No
browser or JavaScript is needed for them. Tokens stay in memory. The shared
Vista collector reads every advertised date in batches of at most five cinemas.

Each chain is collected once a week, keeping its traffic minimal: on the first
check after its weekly window opens (`ingest/src/showtimes_ingest/policy.py`), once
its Friday-to-Thursday week is published and before that Friday. ODEON's window
opens on Wednesdays at 21:00, Everyman's on Wednesdays at 06:00, every other
chain's on Tuesdays at 06:00 (London time). Each chain has its own workflow
(`ingest-<chain>.yml`, all built on `ingest-provider.yml`), scheduled at its window
and twice more an hour apart; once the week is stored a check contacts nobody, and
three failures pause the chain until the next week's window. A failed fetch keeps
the previous listings. When a file changes the workflow builds the new listings
into the site. Everyman and Showcase are asked for three months ahead, in about 20 and
12 requests a week, Vue in about a hundred (one per cinema; each cinema's
address is read once and kept), Picturehouse in a single page load.

ODEON now shares the Vista collector with Cineworld and Curzon: its guest token is
read by curl-impersonate first, with a real browser as the one fallback if that
fails. ODEON refuses requests from cloud providers' addresses, GitHub's runners
included, so its traffic goes through a Tailscale exit node on a home network
(`scripts/via-tailnet.sh`), as do Vue's, Picturehouse's, Cineworld's and Curzon's.
The tailnet identity is one device, so those workflows queue for it in turn.

BFI Southbank's first programme page opens in a browser, but subsequent pages and BFI IMAX return
challenges, so a complete BFI feed is not available yet. See the
[source survey](docs/cinema-sources.md) for tested routes and the next smaller
chains, and the [London coverage audit](docs/london-coverage.md) for venues still
missing. London is the coverage priority; chain adapters collect all their
supported cinemas nationwide.

### Adding a chain

1. **Ingest:** a package in `ingest/src/showtimes_ingest/chains/<chain>/` that
   writes the shared schema (`store.py`) and offers what `chains/__init__.py`
   lists: `NAME`, `check`, `ingest`, `settled_reason` and `search_title`. Add it
   to `CHAINS` there, with tests against a fake of the chain. A chain read with
   plain requests can use `http.Client`, one read through its website
   `browser.Browser`, and the shared lifecycle in `refresh.py` with its weekly
   window in `policy.py`; a chain on a platform another already uses needs only its name and
  website (`chains/everyman/`). Vista guest-token providers use `guest.Client`
  and the shared `chains/vista.py` collector.
2. **Export:** a module in `site/src/chains/<chain>.ts` implementing `Chain`
   (`chain.ts`): its name, booking link, cinema names and towns, how its tags,
   seats and distributors read, which showings are special events, and how far
   its schedule is published. Add it to `CHAINS` in `index.ts`.
3. **Workflow:** an `ingest-<chain>.yml` calling `ingest-provider.yml`, scheduled
   at the chain's weekly window, with `browser` and `via-tailnet` set if it needs
   them. Add the chain to the manual dispatcher in `ingest.yml`. Each publishes
   `data/<chain>.sqlite`, and every published file is built into the site.

Check first that the chain's terms allow it, read only what its own website
reads, say who is asking (`http.USER_AGENT`), and keep its traffic to what its
schedule needs: one ingest per published week, a pause between requests, no
retry loops.

### Repository settings

| Kind | Name | Purpose |
| --- | --- | --- |
| Secret | `TAILSCALE_STATE` | The runner's permanent identity on the tailnet (base64 of a tailscaled state file) |
| Secret | `OMDB_API_KEY` | Optional. Enables IMDb and Metacritic scores |
| Variable | `TAILSCALE_EXIT_NODE` | Name of the exit node device |
| Variable | `ODEON_CINEMAS` | Optional. ODEON site IDs to store, comma-separated; empty stores every cinema |
| Variable | `ODEON_INGEST` | Optional. `false` pauses ODEON's schedule |
| Variable | `CHAINS_INGEST` | Optional. `false` pauses every other chain's schedule |
| Variable | `<CHAIN>_INGEST` | Optional. `false` pauses one chain's schedule, as `VUE_INGEST` |

Start one chain's ingest by hand, or every chain's through the dispatcher:

```bash
gh workflow run ingest-odeon.yml -f command=check
```

```bash
gh workflow run ingest.yml -f provider=all -f command=check
```

`check` ingests only if the chain's week is not stored yet; `run` ingests now. A
failed ingest is recorded in the chain's file and tried again at the next check,
at most three times a week.

## Working on it

The site needs the chains' listings files to show anything:

```bash
scripts/listings.sh download
```

Run the application and its checks in Docker. From the repository root:

```bash
docker build --target checks -f ingest/Dockerfile -t showtimes-ingest-checks .
```

To run an ingest manually, build the container once, then choose a provider:

```bash
docker build -f ingest/Dockerfile -t showtimes-ingest .
bash scripts/ingest.sh cineworld run
bash scripts/ingest.sh curzon run
```

Files are written to `data/<provider>.sqlite`. This does not publish or deploy.
For providers that need no browser, the smaller image is sufficient:

```bash
docker build --target api -f ingest/Dockerfile -t showtimes-ingest-api .
SHOWTIMES_INGEST_IMAGE=showtimes-ingest-api bash scripts/ingest.sh princecharles run
```

The site's checks use Node 26 in Docker. The separate dependency volume keeps
the container's platform-specific packages inside Docker:

```bash
docker run --rm --entrypoint sh -v "$PWD:/work" -w /work/site \
  --mount type=volume,target=/work/site/node_modules,volume-nocopy \
  node:26-bookworm-slim -c 'npm ci && npm test && npm run build'
```

To view the site with the downloaded listings:

```bash
docker run --rm --entrypoint sh -p 5173:5173 -v "$PWD:/work" -w /work/site \
  --mount type=volume,target=/work/site/node_modules,volume-nocopy \
  node:26-bookworm-slim \
  -c 'npm ci && npm run listings && npm run dev -- --host 0.0.0.0'
```

Open `http://localhost:5173`. CI also runs the built site's browser tests.
Production ingestion and publishing run through GitHub Actions after a pull
request is merged to `main`.

The ingest tests use a fake of each chain and a temporary database. To keep the
chains' traffic minimal, do not run a real ingest more than its schedule does.
