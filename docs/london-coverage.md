# Greater London cinema coverage

Audit of the development data, 19 November 2026: **93 Greater London venues**, up
from 55 before this change. Publishing goes through a pull request, CI and the
deployment from `main`; these numbers describe the validated development data.

The combined export contains **36,020 London screenings across 92 venues**.
Curzon Chelsea is the remaining directory entry: its API currently returns no
screenings. It is retained without inventing a programme or claiming it is open.

| Covered operator | London venues |
| --- | ---: |
| ODEON | 19 |
| Everyman | 16 |
| Vue | 15 |
| Picturehouse | 11 |
| Cineworld | 12 |
| Curzon | 11 |
| Olympic Studios group | 4 |
| Prince Charles Cinema | 1 |
| Rio | 1 |
| Lexi | 1 |
| Phoenix, East Finchley | 1 |
| ActOne, Acton | 1 |
| **Total** | **93** |

Olympic's four are **Barnes, the Power Station, the Arches and Selfridges**.
Power Station and Arches are separate venues. Prince Charles's advance bookings
are included, and its duplicate mobile/desktop markup is counted once.

Six Picturehouses were already cached but absent from the London filter:
Central, Crouch End, Ealing, Finsbury Park, Ritzy and West Norwood. Their addresses
say London but omit a postcode; the grouping now recognises that information.
The region is Greater London, rather than every cinema in the commuter belt:
Reel Borehamwood stays outside. Chain adapters collect nationwide.

Cineworld's 12 are Bexleyheath, Enfield, Feltham, Hounslow, Ilford, Leicester
Square, South Ruislip, O2 Greenwich, Wandsworth, Wembley, West India Quay and Wood
Green. Curzon's 11 are Aldgate, Bloomsbury, Camden, Chelsea, Hoxton, Kingston,
Mayfair, Richmond, Soho, Victoria and Wimbledon. These are the current Vista
directory entries; both providers use verified guest-token routes found through
the reference project, not their blocked ordinary site requests.

## Confirmed gaps

| Missing provider/venue | Source finding and next step |
| --- | --- |
| [BFI Southbank](https://whatson.bfi.org.uk/Online/) | First 100 AudienceView results readable; four pages reported, subsequent pages challenged. Complete pagination required. |
| [BFI IMAX](https://whatson.bfi.org.uk/imax/Online/) | Separate entrance challenged. Separate venue from Southbank. |
| [Omniplex Sutton](https://www.omniplexcinemas.co.uk/cinema/showtimes/sutton) | Public per-date listings verified. Find a complete feed and add the full UK chain, including Northern Ireland. |
| [Genesis](https://genesiscinema.co.uk/) | Public Admit One programme. Compare its full date panels and external booking links with the shared Admit One reader. |
| [ArtHouse Crouch End](https://www.arthousecrouchend.co.uk/booking-now/) | Public programme and older Opus booking site verified. The modern `Events` JSON used by Rio/Lexi is absent. |
| [Garden Cinema](https://www.thegardencinema.co.uk/) | Older Opus family, published through WordPress; validate its complete dates and screen-level links. |
| [Ciné Lumière](https://www.institut-francais.org.uk/cinema/) | Older Opus layout. Both screens belong to one venue. |
| [Electric Cinema](https://www.electriccinema.co.uk/) | Public site readable. Add **Portobello and White City** together. |
| [Barbican](https://www.barbican.org.uk/whats-on/cinema) | Public programme; Spektrix integration visible. Include all cinema screens. |
| [ICA](https://www.ica.art/films) | Public programme; Spektrix integration visible. |
| [The Castle, Hackney](https://thecastlecinema.com/) | Public site readable; validate programme and date completeness. |
| [Regent Street Cinema](https://www.regentstreetcinema.com/) | Inspect the readable site's programme requests. |
| [Chiswick Cinema](https://www.chiswickcinema.co.uk/) | Inspect programme requests and the operator's wider venue list. |
| [David Lean Cinema](https://www.davidleancinema.org.uk/) | Public site; Ticketsolve integration visible. |
| [Rich Mix](https://richmix.org.uk/cinema/) | Public programme; Spektrix integration visible. |
| [Kiln](https://kilntheatre.com/) | Spektrix integration visible; locate current cinema events rather than an old event URL. |
| [Riverside Studios](https://riversidestudios.co.uk/) | Spektrix integration visible; find the current programme route. The old `/cinema/` route returns 404. |
| [Peckhamplex](https://www.peckhamplex.london/) | Public site readable; validate all dates and booking IDs. |
| [Forest Cinema, Walthamstow](https://www.forestcinema.co.uk/) | Official programme verified; investigate the operator's full UK venue list. |
| [The Nickel, Clerkenwell](https://thenickel.co.uk/) | Official dated programme verified. Preserve separate bar and film start times. |
| [Close-Up](https://www.closeupfilmcentre.com/) | Plain entrance returned 403; needs an accessible permitted programme. |
| [JW3](https://www.jw3.org.uk/whats-on) | Plain programme returned 403; needs browser/source verification. |

[Bertha DocHouse](https://dochouse.org/) has a readable programme but operates
within **Curzon Bloomsbury**. Avoid counting the same performance through both feeds.

Further checks: The Arzner, Ealing Project, Sidcup Storyteller, Lumiere Romford,
Cinema Museum, BFI Stephen Street, BLOC at Queen Mary, Good Shepherd Studios,
the Horse Hospital and community/seasonal screenings. Verify current operation,
public ticket availability, operator and aliases before counting them.

[Film London's exhibitor list](https://filmlondon.org.uk/resource/how-to-support-film-hub-london-member-cinemas)
is useful for discovery but includes historic and closed/rebranded sites. Check
each venue's current programme. This is a list of concrete coverage gaps, not
an assertion that every London cinema is now covered.
