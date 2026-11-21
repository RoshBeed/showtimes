# UK cinema sources

Checked 19 November 2026. London is the coverage priority; chain adapters collect
all cinemas in their own directories nationwide. Screen numbers, coordinates and
sold-out status remain unknown where the source does not publish them.

## Working adapters

| Source | Coverage | Source and completeness |
| --- | --- | --- |
| [Cineworld](https://web.cineworld.co.uk/) | 87 cinemas returned by Vista | Public ticketing page's `__NEXT_DATA__.props.pageProps.environment.gasToken`, then `digital-api.cineworld.co.uk/ocapi/v1/` with `Connect-Region-Code: GB`. Every advertised business date, including distant events. |
| [Curzon](https://www.curzon.com/) | 15 cinemas returned by Vista | Public `window.initialData.api.authToken`, then `digital-api.curzon.com/ocapi/v1/`, without a region header. Same collector and response mapping as Cineworld; response mapping also shared with ODEON. |
| [The Light](https://stockport.thelight.co.uk/) | All 14 cinemas in `__sites` | Glitterfish fortnight mini-guide **plus** each `/cinema/comingsoon` page's `ScheduleBrowser` JSON: 29 requests. Advance bookings go beyond the mini-guide's fortnight. Duplicates use the original cinema and booking ID. |
| [Olympic Studios](https://www.olympiccinema.com/whats-on), [Power Station](https://www.thecinemainthepowerstation.com/whats-on), [Selfridges](https://www.thecinemaatselfridges.com/whats-on) | Barnes, Power Station, Arches and Selfridges | Three dated Cinema Cloud programme pages; Power Station's page contains two distinct venues. Addresses from public `MovieTheater` data; preserve ticketing host and booking suffix. |
| [Reel](https://reelcinemas.co.uk/) | All 16 cinemas | 13 Jacro venues: directory plus each film's complete dated programme, with real screen numbers and film metadata. Hull, Morecambe and Quinton: one Admit One `/whatson` page each, reading every hidden future-date panel. |
| [Prince Charles](https://princecharlescinema.com/whats-on/) | One cinema | Whole programme in one request, rather than the incomplete home-page film directory. Preserve advance dates, format labels and sold-out screenings without fabricating booking links. |
| [Rio](https://riocinema.org.uk/), [Lexi](https://thelexicinema.co.uk/), [Phoenix](https://www.phoenixcinema.co.uk/), [ActOne](https://actonecinema.co.uk/) | Four London independents | Shared Savoy Systems/Opus reader: each public page embeds its full `Events` JSON. Keep each venue's tag vocabulary and external ticket URLs. This is Opus, not Ticketsolve. |

These join ODEON, Vue, Everyman, Picturehouse and Showcase. Each chain retains its
own SQLite release asset, weekly state and export adapter. Collection completes
before the previous listings are replaced; partial failures keep the old data.
No new adapter requests live seat plans or individual booking pages.

Full live verification returned **70,081 Cineworld screenings** across all 87
cinemas and **2,615 Curzon screenings** across 14 of its 15 directory entries.
Curzon Chelsea had none. Every advertised date was queried, including empty
responses: Cineworld's returned screenings reached 17 January 2027, despite its
calendar advertising dates into June; Curzon returned screenings through 5 June.
This is a source response difference, not a cutoff in our collector. The combined
static export contained 230,798 screenings, 36,020 in Greater London, and built
successfully. Dataset sizes were approximately 4.7 MB and 0.95 MB compressed.

## Reference project and shared mechanisms

[At The Movies](https://github.com/andycroll/atthemovies) and its provider gems
identify working routes that the websites' main entrances obscure. These Python
adapters independently implement those public protocols inside Showtimes; they
do not bring in the Rails application, Ruby gems or a second storage model.
Relevant references are [cineworld_uk](https://github.com/andycroll/cineworld_uk),
[curzon_uk](https://github.com/andycroll/curzon_uk),
[princecharles_uk](https://github.com/andycroll/princecharles_uk),
[reel_uk](https://github.com/andycroll/reel_uk) and
[light_uk](https://github.com/andycroll/light_uk).

`guest.py` obtains anonymous sessions using curl-impersonate **2.2.3**, Chrome 150.
The Docker build installs the upstream binary for amd64/arm64, verifies its
pinned SHA-256 and retains the third-party licence notices. Tokens stay in memory,
refresh before expiry, and go to curl through stdin rather than process arguments.
A 401 drops the token and fails that run; there is no retry or challenge solver.
Only the intended public guest page is accepted, without following redirects.
ODEON's existing browser capture remains unchanged.

`chains/vista.py` batches at most **five cinema IDs**, the API's verified limit.
It reads the advertised calendar first, then requests only cinemas with screenings
on each date, with no arbitrary future cutoff. Plain pages use `http.Client`;
all clients pause between requests and keep the existing failure limit.

`chains/admitone.py` reads the whole programme behind a page's date tabs. It
resets film/category state at each new film and deduplicates repeated mobile and
desktop booking links. `chains/pages.py` reads HTML and embedded JSON without
executing JavaScript. Cinema-scoped IDs prevent local programme IDs colliding.

The export's `bookingByCinema` handles groups with different ticketing hosts.
Optional `screening_links` records exceptions, including an explicit null link
for a sold-out performance; old release assets without this table still work.

## Remaining London gaps

See the [London audit](london-coverage.md) for individual venues. BFI Southbank's
AudienceView first page exposes 100 screenings and reports four pages, but its
pagination route returns a challenge; BFI IMAX's separate entrance is also
challenged. A partial first page is not a complete BFI feed. The reference project
does not provide a BFI adapter either.

The main Cineworld Webedia schedule and some ordinary Curzon requests return
403. These are **not blockers** now that the verified Vista guest routes above
work. Do not replace them with the failed Webedia route or describe them as
unsupported in a future handoff.

Older Opus sites (Garden Cinema, ArtHouse and Ciné Lumière) do not expose the
modern `Events` JSON. Shared vendor branding alone does not make the Rio parser
compatible. Spektrix is visible at Barbican, ICA, Kiln, Rich Mix and Riverside;
verify their public API and cinema-only event filtering before adding them.

## Next UK operators

The reference supplies concrete leads rather than an assumption that all have
one interchangeable feed:

| Operator | Next integration route |
| --- | --- |
| Arc, Movie House | Admit One full `/whatson` programmes, reusable with venue configuration after checking each site's markup and dates. Include Northern Ireland. |
| Scott | Public per-cinema JSON schedule; verify all six current venues. |
| Merlin | Complete per-cinema home-page programmes; separate films from live stage shows. |
| WTW | Full programme per cinema; four venues in the reference. |
| Omniplex | Public calendar plus per-date pages; about 50 requests per cinema in the reference. No verified bulk shortcut. Add the entire UK chain, including Northern Ireland, when implemented. |
| Parkway, Savoy, Hollywood, West Coast | Verify current directories, platforms and complete programme coverage before scheduling them. |
| Spektrix independents | Reference covers Broadway, HOME, Hyde Park Picture House, Showroom and Tyneside. A shared public API adapter could also serve compatible London venues. |

Check current venues against the [CEA directory](https://www.ceacard.co.uk/index.php/cinema-chains)
and operators' own pages. Historical exhibitor lists include closures and aliases.
