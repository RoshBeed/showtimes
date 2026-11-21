"""Savoy Systems/Opus public programme data, embedded as JSON in its own pages.

Cinema configuration supplies its public URL and booking prefix. Tags remain
the venue's raw codes: its site's adapter interprets them for people.
"""

import re
from datetime import datetime
from html import unescape
from urllib.parse import urlsplit

from showtimes_ingest import refresh
from showtimes_ingest.chains.pages import embedded, parse
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ


def collect(client, today, cinema):
    data = embedded(client.text(cinema["url"]), "Events")
    movies = data.get("Events")
    if not isinstance(movies, list) or not movies:
        raise RuntimeError("Opus: no published film programme")
    films, shows, availability = [], {}, {}
    for movie in movies:
        film = str(movie["ID"])
        rating = next(parse(movie.get("Rating") or "").find("img"), None)
        certificate = (
            re.search(r"\(([^)]+)\)", rating.attrs.get("alt", "")) if rating else None
        )
        people = [
            {"name": name.strip(), "roles": [role]}
            for field, role in (("Director", "Director"), ("Cast", "Actor"))
            for name in (movie.get(field) or "").split(",")
            if name.strip()
        ]
        films.append(
            {
                "id": film,
                "title": unescape(movie["Title"]),
                "runtime": movie.get("RunningTime") or None,
                "certificate": certificate[1] if certificate else "",
                "release_date": None,
                "genres": [
                    g.strip()
                    for g in (movie.get("Genre") or "").split(",")
                    if g.strip()
                ],
                "people": people,
                "distributor": "",
                "synopsis": unescape(movie.get("Synopsis") or ""),
                "trailer_url": None,
            }
        )
        for show in movie.get("Performances") or []:
            if show["StartDate"] < str(today):
                continue
            starts = datetime.strptime(
                show["StartDate"] + show["StartTime"], "%Y-%m-%d%H%M"
            ).replace(tzinfo=TZ)
            url = show["URL"]
            external = not url.startswith(cinema["booking_prefix"])
            if external and (
                urlsplit(url).scheme != "https" or not urlsplit(url).hostname
            ):
                raise RuntimeError("Opus: unexpected booking link")
            id = (
                str(show["ID"])
                if external
                else url.removeprefix(cinema["booking_prefix"])
            )
            if not external and not re.fullmatch(
                re.escape(str(show["ID"])) + r"(?:\.TcsSection_\d+)?", id
            ):
                raise RuntimeError("Opus: booking link does not match performance")
            tags = [
                key
                for key, value in show.items()
                if value == "Y" and key not in ("IsSoldOut", "IsSeatingAllocated")
            ]
            tags += [
                tag["Format"] for tag in movie.get("Tags") or [] if tag.get("Format")
            ]
            screen = show.get("AuditoriumName") or "Screen"
            shows[id] = {
                "cinema_id": cinema["id"],
                "id": id,
                "film_id": film,
                "business_date": show["StartDate"],
                "starts_at": utc(starts),
                "time": starts.strftime("%H:%M"),
                "film_starts_at": None,
                "film_ends_at": None,
                "screen": screen,
                "screen_id": str(show.get("AuditoriumID") or "?"),
                "experiences": tags,
                "seating": [],
                "sold_out": {"Y": 1, "N": 0}.get(show.get("IsSoldOut")),
                **({"booking_url": url} if external else {}),
            }
            availability[(cinema["id"], film)] = ["NowShowing"]
    if not shows:
        raise RuntimeError("Opus: no upcoming performances")
    return {
        "cinemas": [
            {
                "id": cinema["id"],
                "name": cinema["name"],
                "stored": True,
                "address": cinema["address"],
                "latitude": None,
                "longitude": None,
            }
        ],
        "films": films,
        "screenings": list(shows.values()),
        "availability": availability,
    }


class Cinema:
    """One independent cinema on Opus; configuration is its only variation."""

    search_title = staticmethod(search_title)

    def __init__(self, name, site, cinema):
        self.NAME, self.site, self.cinema = name, site, cinema

    def collect(self, client, today, known=None):
        return collect(client, today, self.cinema)

    def ingest(self, path=None, today=None, client=None):
        return refresh.ingest(
            path, self.NAME, self.collect, client or Client(self.site), today
        )

    def settled_reason(self, path=None, today=None):
        return refresh.settled_reason(path, self.NAME, today)

    def check(self, path=None, moment=None, client=None):
        return refresh.check(
            path, self.NAME, self.collect, client or Client(self.site), moment
        )
