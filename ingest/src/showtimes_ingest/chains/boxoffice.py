"""Chains whose websites run on Webedia's "boxoffice" platform (Everyman,
Showcase). Each site serves the same public API its own pages call:

    /page-data/index/page-data.json   the home page's Gatsby data, which names
    /page-data/sq/d/<hash>.json       the static queries; one lists the cinemas
    /api/gatsby-source-boxofficeapi/schedule?theaters=…&from=…&to=…
                                      showtimes, a few cinemas per request
    /api/gatsby-source-boxofficeapi/movies?ids=…
                                      the films' details, a batch per request

Tags are the platform's own codes ("Format.Projection.Laser",
"Showtime.Accessibility.Subtitled"); the site's chain modules name them.
"""

import json
import re
from datetime import datetime, timedelta

from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ

API = "/api/gatsby-source-boxofficeapi"
# The static query that lists the cinemas has had this hash on every site seen;
# the others are tried only when it has moved.
CINEMAS_QUERY = "2506275789"
# How far ahead showings are asked for, and how many cinemas and films a request covers.
AHEAD = timedelta(days=90)
CINEMAS_PER_REQUEST = 4
FILMS_PER_REQUEST = 20


def compact(value):
    # The API reads its JSON parameters only without spaces, as browsers send them.
    return json.dumps(value, separators=(",", ":"))


def cinema_list(data):
    """The list of cinemas in a static query's result, or None."""
    if isinstance(data, list):
        if data and isinstance(data[0], dict) and "practicalInfo" in data[0]:
            return data
        found = (cinema_list(item) for item in data)
    elif isinstance(data, dict):
        found = (cinema_list(item) for item in data.values())
    else:
        return None
    return next((item for item in found if item), None)


def theaters(client):
    """Every cinema the site lists, from its Gatsby static data."""
    hashes = client.get("/page-data/index/page-data.json").get("staticQueryHashes", [])
    for query in sorted(hashes, key=lambda each: each != CINEMAS_QUERY):
        found = cinema_list(client.get(f"/page-data/sq/d/{query}.json"))
        if found:
            return found
    raise RuntimeError("No list of cinemas in the site's data")


def schedule(client, cinemas, start, end):
    params = [
        ("theaters", compact({"id": cinema["id"], "timeZone": cinema["timeZone"]}))
        for cinema in cinemas
    ]
    params += [
        ("from", start.strftime("%Y-%m-%dT%H:%M:%S")),
        ("to", end.strftime("%Y-%m-%dT%H:%M:%S")),
    ]
    return client.get(f"{API}/schedule", params)


def movies(client, ids):
    params = [("basic", "false"), ("castingLimit", "10")] + [
        ("ids", each) for each in ids
    ]
    return client.get(f"{API}/movies", params)


def cinema_row(cinema):
    info = cinema.get("practicalInfo") or {}
    place = info.get("location") or {}
    where = info.get("coordinates") or {}
    return {
        "id": cinema["id"],
        "name": cinema["name"],
        "stored": not info.get("closed"),
        "address": {
            "line1": place.get("address") or "",
            "city": place.get("city") or "",
            "postcode": " ".join((place.get("zip") or "").split()),
        },
        "latitude": where.get("latitude"),
        "longitude": where.get("longitude"),
    }


def film_row(movie):
    release = (movie.get("releases") or [{}])[0]
    distributors = release.get("distributors") or []
    genres = movie.get("genres") or []
    if isinstance(genres, str):
        genres = [genre.strip() for genre in genres.split(",") if genre.strip()]
    people = [
        {"name": name, "roles": ["Director"]} for name in movie.get("direction") or []
    ]
    people += [
        {"name": name, "roles": ["Actor"]} for name in movie.get("casting") or []
    ]
    trailer = movie.get("trailer") or {}
    runtime = movie.get("runtime")
    return {
        "id": str(movie["id"]),
        "title": movie.get("title") or str(movie["id"]),
        # The platform gives seconds.
        "runtime": round(runtime / 60) if runtime else None,
        "certificate": movie.get("certificate") or "",
        "release_date": (movie.get("release") or "")[:10] or None,
        "genres": genres,
        "people": people,
        "distributor": distributors[0]["name"]
        if distributors
        else (movie.get("studio") or {}).get("name") or "",
        "synopsis": movie.get("synopsis") or "",
        "trailer_url": trailer.get("HD") or trailer.get("SD"),
    }


def booking_id(show):
    """The showing's ID in the chain's own booking page, the last part of its link."""
    for ticketing in (show.get("data") or {}).get("ticketing") or []:
        if ticketing.get("provider") == "default" and ticketing.get("urls"):
            return ticketing["urls"][0].rstrip("/").rsplit("/", 1)[-1]
    return show["id"]


def screen_name(name):
    return f"Screen {name}" if re.fullmatch(r"\d+", name or "") else name or "Screen"


def screening_rows(cinema, film_id, day, shows):
    rows = []
    for show in shows:
        starts = datetime.fromisoformat(show["startsAt"])
        if starts.tzinfo is None:
            starts = starts.replace(tzinfo=TZ)
        screen = str((show.get("screen") or {}).get("name") or "")
        tags = show.get("tags") or []
        rate = (show.get("occupancy") or {}).get("rate")
        rows.append(
            {
                "cinema_id": cinema,
                "id": booking_id(show),
                "film_id": film_id,
                "business_date": day,
                "starts_at": utc(starts),
                "time": starts.astimezone(TZ).strftime("%H:%M"),
                "film_starts_at": None,
                "film_ends_at": None,
                "screen": screen_name(screen),
                "screen_id": screen or "?",
                "experiences": tags,
                "seating": [
                    tag for tag in tags if tag.startswith("Auditorium.Comfort.")
                ],
                "sold_out": int(
                    "Internal.Data.SoldOut" in tags
                    or (rate is not None and rate >= 100)
                ),
            }
        )
    return rows


def collect(client, today, known=None):
    """Every cinema, and everything showing at the open ones from today for three months."""
    cinemas = [
        cinema
        for cinema in theaters(client)
        if cinema.get("id") and cinema.get("timeZone")
    ]
    rows = [cinema_row(cinema) for cinema in cinemas]
    open_cinemas = [cinema for cinema, row in zip(cinemas, rows) if row["stored"]]
    start = datetime.combine(today, datetime.min.time()).replace(hour=3)
    end = start + AHEAD
    screenings, availability = [], {}
    for at in range(0, len(open_cinemas), CINEMAS_PER_REQUEST):
        batch = open_cinemas[at : at + CINEMAS_PER_REQUEST]
        for cinema_id, listing in schedule(client, batch, start, end).items():
            for film_id, days in (listing.get("schedule") or {}).items():
                for day, shows in days.items():
                    screenings += screening_rows(
                        cinema_id, str(film_id), day[:10], shows
                    )
                availability[(cinema_id, str(film_id))] = ["NowShowing"]
    # One row per showing: a listing seen twice (the same booking link) keeps the first.
    unique = {}
    for row in screenings:
        unique.setdefault((row["cinema_id"], row["id"]), row)
    ids = sorted({film for _, film in availability})
    films = []
    for at in range(0, len(ids), FILMS_PER_REQUEST):
        films += [
            film_row(movie)
            for movie in movies(client, ids[at : at + FILMS_PER_REQUEST])
        ]
    known = {film["id"] for film in films}
    # A film the details request did not return still gets a row, so its showings stay.
    films += [
        {
            "id": each,
            "title": each,
            "runtime": None,
            "certificate": "",
            "release_date": None,
            "genres": [],
            "people": [],
            "distributor": "",
            "synopsis": "",
            "trailer_url": None,
        }
        for each in ids
        if each not in known
    ]
    return {
        "cinemas": rows,
        "films": films,
        "availability": availability,
        "screenings": list(unique.values()),
    }
