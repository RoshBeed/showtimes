"""The Light's fortnight guide plus every advertised advance booking."""

import json
import re
from datetime import datetime
from urllib.parse import urlsplit

from showtimes_ingest import refresh
from showtimes_ingest.chains.pages import embedded, parse
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ

NAME = "light"
SITE = "https://stockport.thelight.co.uk"
FEED = "/resource/services/miniguide/data.ashx"

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def cinemas(client):
    sites = embedded(client.text("/"), "__sites")
    if not sites:
        raise RuntimeError("The Light: empty cinema directory")
    for site in sites:
        url = urlsplit(site["url"])
        if url.scheme != "https" or not (url.hostname or "").endswith(
            ".thelight.co.uk"
        ):
            raise RuntimeError("The Light: unexpected cinema URL")
    return sites


def guide(client, site):
    data = embedded(client.text(site["url"] + FEED), "__gfminiguidedata")
    if not isinstance(data.get("Schedule"), list):
        raise RuntimeError("The Light: missing schedule")
    return data["Schedule"]


def runtime(text):
    hours = re.search(r"(\d+)h", text)
    minutes = re.search(r"(\d+)m", text)
    total = (int(hours[1]) * 60 if hours else 0) + (int(minutes[1]) if minutes else 0)
    return total or None


def upcoming(html):
    movies = []
    for block in parse(html).find("div", "prog"):
        id = block.attrs.get("data-prog")
        if not id:
            continue
        title = next(block.find("h2"), None)
        script = next(
            (
                s.content()
                for s in block.find("script")
                if "ScheduleBrowser(" in s.content()
            ),
            None,
        )
        # A coming-soon teaser need not have any advertised sessions yet.
        if script is None:
            continue
        data = re.search(r"\bdata\s*:\s*", script)
        if data is None or title is None:
            raise RuntimeError("The Light: malformed advance-booking programme")
        dates = json.JSONDecoder().raw_decode(script[data.end() :])[0]
        info = next(block.find("p", "runtime"), None)
        summary = next(block.find("p", "summary"), None)
        parts = info.text.split("|") if info else []
        movies.append(
            {
                "ID": id,
                "Title": title.text,
                "Dates": dates,
                "Runtime": parts[0].strip() if parts else "",
                "Cert": parts[-1].strip() if len(parts) > 1 else "",
                "Summary": summary.text if summary else "",
            }
        )
    return movies


def collect(client, today, known=None):
    rows, films, shows, availability = [], {}, {}, {}
    for site in cinemas(client):
        # The hostname is also what the booking link needs; not a guessed town slug.
        cinema = urlsplit(site["url"]).hostname.split(".")[0]
        rows.append(
            {
                "id": cinema,
                "name": site["title"],
                "stored": True,
                "address": {"line1": "", "city": site["title"], "postcode": ""},
                "latitude": None,
                "longitude": None,
            }
        )
        movies = guide(client, site) + upcoming(
            client.text(site["url"] + "/cinema/comingsoon")
        )
        for movie in movies:
            # Programme IDs belong to the individual cinema. The export merges
            # matching titles across cinemas, without risking an ID collision.
            film = f"{cinema}/{movie['ID']}"
            films.setdefault(
                film,
                {
                    "id": film,
                    "title": movie["Title"],
                    "runtime": runtime(movie.get("Runtime") or ""),
                    "certificate": movie.get("Cert") or "",
                    "release_date": None,
                    "genres": [],
                    "people": [],
                    "distributor": "",
                    "synopsis": movie.get("Summary") or "",
                    "trailer_url": None,
                },
            )
            for day in movie.get("Dates") or []:
                date = datetime.strptime(day["Key"], "%Y%m%d").date()
                if date < today:
                    continue
                for show in day["Sessions"]:
                    # Past sessions no longer carry a BOID. External ticketing is
                    # not a Light booking link, so it must not be reconstructed.
                    if not show.get("BOID") or not show.get("Native"):
                        continue
                    starts = datetime.strptime(
                        day["Key"] + show["Sort"], "%Y%m%d%H%M"
                    ).replace(tzinfo=TZ)
                    tags = [item["Title"] for item in show.get("Collections") or []]
                    if show.get("FormatDisplay"):
                        tags.append(show["FormatDisplay"])
                    if (
                        movie.get("ProgrammeType") is not None
                        and movie["ProgrammeType"] != 1
                    ):
                        tags.append("Event Cinema")
                    row = {
                        "cinema_id": cinema,
                        "id": str(show["BOID"]),
                        "film_id": film,
                        "business_date": str(date),
                        "starts_at": utc(starts),
                        "time": starts.strftime("%H:%M"),
                        "film_starts_at": None,
                        "film_ends_at": None,
                        # The mini-guide does not publish auditorium numbers.
                        "screen": "Screen",
                        "screen_id": "?",
                        "experiences": tags,
                        "seating": [],
                        # Availability colours are not a reliable sold-out flag.
                        "sold_out": None,
                    }
                    shows.setdefault((cinema, row["id"]), row)
                    availability[(cinema, film)] = ["NowShowing"]
    if not shows:
        raise RuntimeError("The Light: no bookable showings in the feeds")
    return {
        "cinemas": rows,
        "films": list(films.values()),
        "screenings": list(shows.values()),
        "availability": availability,
    }


def ingest(path=None, today=None, client=None):
    return refresh.ingest(path, NAME, collect, client or Client(SITE), today)


def check(path=None, moment=None, client=None):
    return refresh.check(path, NAME, collect, client or Client(SITE), moment)


def settled_reason(path=None, today=None):
    return refresh.settled_reason(path, NAME, today)
