"""Olympic Studios' Cinema Cloud pages, including Battersea's two venues.

Three public what's-on pages publish the complete schedules. The Power Station
page also lists the Arches: these remain separate cinemas, even for the same film.
No requests to the ticketing system or its seat-selection endpoints are needed.
"""

import json
import re
from datetime import datetime

from showtimes_ingest import refresh
from showtimes_ingest.chains.pages import parse
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ

NAME = "olympic"
SITES = (
    ("powerstation", "https://www.thecinemainthepowerstation.com"),
    ("barnes", "https://www.olympiccinema.com"),
    ("selfridges", "https://www.thecinemaatselfridges.com"),
)
BOOKING = re.compile(
    r"https://web[123]\.empire\.mycloudcinema\.com/\#/book/\d+(?:/[a-z0-9-]+)?"
)

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def key(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def cinema_row(id, address, geo):
    return {
        "id": id,
        "name": address["name"],
        "stored": True,
        "address": {
            "line1": address.get("streetAddress") or "",
            "city": address.get("addressLocality") or "",
            "postcode": address.get("postalCode") or "",
        },
        "latitude": float(geo["latitude"]) if geo.get("latitude") else None,
        "longitude": float(geo["longitude"]) if geo.get("longitude") else None,
    }


def page(client, id, site):
    root = parse(client.text(site + "/whats-on"))
    theaters = []
    for script in root.find("script"):
        if script.attrs.get("type") == "application/ld+json":
            data = json.loads(script.content())
            if data.get("@type") == "MovieTheater":
                theaters.append(cinema_row(id, data["address"], data.get("geo") or {}))
                if data.get("alternateAddress"):
                    theaters.append(cinema_row("arches", data["alternateAddress"], {}))
    if not theaters:
        raise RuntimeError(f"Olympic: no cinema information on {site}")
    return root, theaters


def listing_day(text, today):
    # The printed headings omit their year. January after a November/December
    # programme is next year; never roll a showing from yesterday forward a year.
    for year in (today.year - 1, today.year, today.year + 1):
        try:
            day = datetime.strptime(f"{text} {year}", "%A %B %d %Y").date()
        except ValueError:
            continue
        if day.strftime("%A") == text.split()[0]:
            return day
    raise RuntimeError(f"Olympic: unrecognised programme date {text}")


def listing(root, cinemas, primary, today):
    names = {key(row["name"]): row["id"] for row in cinemas}
    films, shows = {}, {}
    sections = list(root.find("section", "date-section"))
    if not sections:
        raise RuntimeError("Olympic: no dated programme on the what's-on page")
    for section in sections:
        heading = next(section.find("h3", "date-day"), None)
        if heading is None:
            raise RuntimeError("Olympic: missing programme date")
        day = listing_day(heading.text, today)
        if day < today:
            continue
        for group in section.find(cls="col-md-12"):
            heading = next(group.find("h5"), None)
            if heading is None:
                continue
            link = next(heading.find("a"), None)
            if link is None or not link.attrs.get("href", "").startswith("/film/"):
                raise RuntimeError("Olympic: missing film link")
            film = link.attrs["href"].removeprefix("/film/")
            certificate = next(
                (
                    image.attrs["alt"].removeprefix("BBFC Cert ")
                    for image in group.find("img")
                    if image.attrs.get("alt", "").startswith("BBFC Cert ")
                ),
                "",
            )
            films[film] = {
                "id": film,
                "title": link.text,
                "certificate": certificate,
                "runtime": None,
                "release_date": None,
                "genres": [],
                "people": [],
                "distributor": "",
                "synopsis": "",
                "trailer_url": None,
            }
            cinema = primary
            for node in group.find():
                if node.tag == "h6":
                    cinema = names.get(key(node.text))
                    if cinema is None:
                        raise RuntimeError(f"Olympic: unknown venue {node.text}")
                if node.tag != "a":
                    continue
                url = node.attrs.get("data-booking-url") or node.attrs.get("href", "")
                if not BOOKING.fullmatch(url):
                    continue
                time = next(node.find("span", "btn-times-fs"), None)
                if time is None:
                    raise RuntimeError("Olympic: booking link without a time")
                starts = datetime.combine(
                    day, datetime.strptime(time.text, "%H:%M").time(), TZ
                )
                tags = [
                    image.attrs["alt"]
                    for image in node.find("img")
                    if image.attrs.get("alt")
                ]
                # Keep the suffix from the real link. Ticketing hosts differ by
                # venue; the site's adapter maps each cinema to its own host.
                id = url.split("#/book/", 1)[1]
                if "/subtitled" in id:
                    tags.append("Subtitled")
                shows[(cinema, id)] = {
                    "cinema_id": cinema,
                    "id": id,
                    "film_id": film,
                    "business_date": str(day),
                    "starts_at": utc(starts),
                    "time": time.text,
                    "film_starts_at": None,
                    "film_ends_at": None,
                    # These pages publish the venue, not the auditorium.
                    "screen": "Screen",
                    "screen_id": "?",
                    "experiences": tags,
                    "seating": [],
                    "sold_out": None,
                }
    return films, shows


def collect(client, today, known=None):
    cinemas, films, shows = {}, {}, {}
    for id, site in SITES:
        root, theaters = page(client, id, site)
        movies, screenings = listing(root, theaters, id, today)
        if not screenings:
            raise RuntimeError(f"Olympic: no bookable showings on {site}")
        cinemas.update((row["id"], row) for row in theaters)
        films.update(movies)
        shows.update(screenings)
    return {
        "cinemas": list(cinemas.values()),
        "films": list(films.values()),
        "screenings": list(shows.values()),
        "availability": {
            (row["cinema_id"], row["film_id"]): ["NowShowing"] for row in shows.values()
        },
    }


def ingest(path=None, today=None, client=None):
    return refresh.ingest(path, NAME, collect, client or Client(SITES[0][1]), today)


def check(path=None, moment=None, client=None):
    return refresh.check(path, NAME, collect, client or Client(SITES[0][1]), moment)


def settled_reason(path=None, today=None):
    return refresh.settled_reason(path, NAME, today)
