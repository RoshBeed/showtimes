"""Vue, read as ODEON is: its website in a real browser (showtimes_ingest.browser),
which sets itself up with Vue's guest token, then the API its pages call, asked
from inside the page:

    /api/microservice/showings/cinemas            every cinema, by letter
    /api/microservice/showings/cinemas/<id>/films  a cinema's films, each with
                                                   every showing it has listed
    /api/microservice/showings/showingDates?cinemaId=<id>
                                                   the days a cinema has showings
    /cinema/<name>/whats-on                        a cinema's page, whose data
                                                   holds its address; read once

About a hundred requests a week: one per cinema for its showings.
"""

import json
import re
from contextlib import nullcontext
from datetime import datetime, timedelta

from showtimes_ingest import refresh
from showtimes_ingest.browser import Browser
from showtimes_ingest.log import log
from showtimes_ingest.scores import search_title
from showtimes_ingest.store import utc
from showtimes_ingest.week import TZ

NAME = "vue"
SITE = "https://www.myvue.com"
API = "/api/microservice/showings"
# A UK postcode or an Irish Eircode, at the end of an address line.
POSTCODE = re.compile(
    r"([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}|[A-Z]\d[\dW] ?[A-Z\d]{4})(?:,? *UK)?$",
    re.IGNORECASE,
)
COORDINATES = re.compile(r"^-?\d+\.\d+, *-?\d+\.\d+$")
NO_ADDRESS = {"line1": "", "city": "", "postcode": ""}

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def cinemas(client):
    """Every cinema Vue lists: [{cinemaId, cinemaName, whatsOnUrl}]."""
    groups = client.fetch(f"{API}/cinemas").get("result", [])
    return [cinema for group in groups for cinema in group.get("cinemas", [])]


def page_value(page, name):
    """A field's value in the data a Vue page carries ("cinemaAddress": {"value": "…"})."""
    match = re.search(rf'"{name}":\{{"value":("(?:[^"\\]|\\.)*")\}}', page)
    return json.loads(match.group(1)) if match else ""


def parse_address(text):
    """Vue's address text as the shared schema keeps it: the street, the town and
    the postcode. Its lines vary: "…\nLondon\nWC2H 7AL", "…, Barrow-in-Furness\n
    LA14 2NA, UK", "…, Colchester\nEssex CO4 5UP", Irish Eircodes, and once the
    map position in place of the postcode."""
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not COORDINATES.match(line.strip())
    ]
    postcode, at = "", len(lines)
    for index in range(len(lines) - 1, -1, -1):
        found = POSTCODE.search(lines[index])
        if found:
            postcode, at = found.group(1).upper(), index
            break
    before = lines[:at]
    # The town is the last part before the postcode: a line of its own, or the end of the street's.
    written = before[-1].rsplit(",", 1)[-1].strip() if before else ""
    town = re.sub(r" \d+$", "", written)  # Dublin 22 is Dublin
    street = ", ".join(before)
    if written and street.endswith(written):
        street = street[: -len(written)].rstrip(", ")
    return {"line1": street, "city": town, "postcode": postcode}


def address(client, cinema):
    """A cinema's address and position, from its what's-on page."""
    path = re.sub(r"^https?://[^/]+", "", cinema.get("whatsOnUrl") or "")
    if not path.startswith("/cinema/"):
        return NO_ADDRESS, None, None
    page = client.fetch(path, raw=True)
    latitude = longitude = None
    where = page_value(page, "cinemaLocationCoordinates").split(",")
    if len(where) == 2:
        try:
            latitude, longitude = float(where[0]), float(where[1])
        except ValueError:
            pass
    return parse_address(page_value(page, "cinemaAddress")), latitude, longitude


def cinema_row(client, cinema, known):
    """A cinema, with the address already stored or, for a new one, read now."""
    stored = known.get(cinema["cinemaId"])
    place = (stored or {}).get("address") or {}
    if place.get("postcode") or (
        place.get("city") and stored.get("latitude") is not None
    ):
        found = stored["address"], stored["latitude"], stored["longitude"]
    else:
        try:
            found = address(client, cinema)
        except RuntimeError as error:
            # Without an address the cinema is still listed; the next ingest asks again.
            log.warning("vue: no address for %s: %s", cinema.get("cinemaName"), error)
            found = NO_ADDRESS, None, None
    place, latitude, longitude = found
    return {
        "id": cinema["cinemaId"],
        "name": cinema.get("cinemaName") or cinema["cinemaId"],
        "stored": True,
        "address": place,
        "latitude": latitude,
        "longitude": longitude,
    }


def local(value):
    moment = datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=TZ)


def names(text, role):
    return [
        {"name": name.strip(), "roles": [role]}
        for name in (text or "").split(",")
        if name.strip()
    ]


def film_row(film):
    trailers = [each for each in film.get("trailers") or [] if isinstance(each, dict)]
    return {
        "id": film["filmId"],
        "title": film.get("filmTitle") or film["filmId"],
        "runtime": None if film.get("isDurationUnknown") else film.get("runningTime"),
        "certificate": ((film.get("certificate") or {}).get("name") or "").upper(),
        "release_date": (film.get("releaseDate") or "")[:10] or None,
        "genres": film.get("genres") or [],
        "people": names(film.get("director"), "Director")
        + names(film.get("cast"), "Actor"),
        "distributor": film.get("distributor") or "",
        "synopsis": film.get("synopsisShort") or "",
        "trailer_url": next(
            (each["url"] for each in trailers if each.get("url")), None
        ),
    }


def screening_row(cinema, film, day, session):
    starts = local(session["startTime"])
    ends = local(session["endTime"]) if session.get("endTime") else None
    minutes = None if film.get("isDurationUnknown") else session.get("duration")
    attributes = session.get("attributes") or []
    return {
        "cinema_id": cinema,
        # Film and session, as Vue's booking page takes them: …/summary/<cinema>/<film>/<session>.
        "id": f"{film['filmId']}/{session['sessionId']}",
        "film_id": film["filmId"],
        "business_date": day[:10],
        "starts_at": utc(starts),
        "time": starts.astimezone(TZ).strftime("%H:%M"),
        "film_starts_at": utc(ends - timedelta(minutes=minutes))
        if ends and minutes
        else None,
        "film_ends_at": utc(ends) if ends and minutes else None,
        "screen": session.get("screenName") or "Screen",
        "screen_id": session.get("screenName") or "?",
        # The type keeps what kind each is: "Language: Hindi", "Session_Special: Laser".
        "experiences": [
            f"{each.get('attributeType')}: {each['name']}"
            for each in attributes
            if each.get("name")
        ],
        "seating": [],
        "sold_out": int(bool(session.get("isSoldOut"))),
    }


def collect(client, today, known=None):
    """Every cinema, and every showing each has listed from today."""
    known = known or {}
    listed = cinemas(client)
    rows = [cinema_row(client, cinema, known) for cinema in listed]
    films, screenings, availability = {}, [], {}
    params = [
        ("minEmbargoLevel", "3"),
        ("includesSession", "true"),
        ("includeSessionAttributes", "true"),
    ]
    for cinema in listed:
        cinema_id = cinema["cinemaId"]
        for film in (
            client.fetch(f"{API}/cinemas/{cinema_id}/films", params).get("result") or []
        ):
            films.setdefault(film["filmId"], film_row(film))
            availability[(cinema_id, film["filmId"])] = ["NowShowing"]
            for group in film.get("showingGroups") or []:
                if group["date"][:10] < str(today):
                    continue
                for session in group.get("sessions") or []:
                    screenings.append(
                        screening_row(cinema_id, film, group["date"], session)
                    )
    return {
        "cinemas": rows,
        "films": list(films.values()),
        "availability": availability,
        "screenings": screenings,
    }


def session(client):
    return nullcontext(client) if client else Browser(SITE)


def ingest(path=None, today=None, client=None):
    with session(client) as browser:
        return refresh.ingest(path, NAME, collect, browser, today)


def check(path=None, moment=None, client=None):
    with session(client) as browser:
        return refresh.check(path, NAME, collect, browser, moment)


def settled_reason(path=None, today=None):
    return refresh.settled_reason(path, NAME, today)
