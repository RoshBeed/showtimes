"""Fetch one week's listings from ODEON and shape them for the site."""

import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from showtimes_ingest.store import utc

TZ = ZoneInfo("Europe/London")


def configured_sites():
    """An explicit limit on which cinemas are stored, or None for every cinema."""
    configured = os.environ.get("ODEON_CINEMAS", "")
    return set(configured.replace(",", " ").split()) or None


def release_week(today):
    """ODEON publishes Friday–Thursday listings on Tuesdays: (Tuesday, Thursday)."""
    tuesday = today - timedelta(days=(today.weekday() - 1) % 7)
    return tuesday, tuesday + timedelta(days=9)


def text(value):
    if isinstance(value, dict):
        return value.get("text", "")
    return str(value or "")


def related(data):
    """{kind: {id: item}} for the reference lists a response carries."""
    return {
        kind: {str(item["id"]): item for item in items}
        for kind, items in data.get("relatedData", {}).items()
        if isinstance(items, list)
        and all(isinstance(item, dict) and "id" in item for item in items)
    }


def moment(value):
    return utc(datetime.fromisoformat(value)) if value else None


def film_row(film, maps):
    def entity(kind, key):
        return maps.get(kind, {}).get(str(key), {})

    people = []
    for person in film.get("castAndCrew", []):
        name = entity("castAndCrew", person["castAndCrewMemberId"]).get("name", {})
        people.append(
            {
                "name": " ".join(
                    str(name.get(part) or "").strip()
                    for part in ("givenName", "middleName", "familyName")
                    if name.get(part)
                ),
                "roles": person.get("roles", []),
            }
        )
    return {
        "id": film["id"],
        "title": text(film.get("title")) or film["id"],
        "runtime": film.get("runtimeInMinutes"),
        "certificate": text(
            entity("censorRatings", film.get("censorRatingId")).get("classification")
        ),
        "release_date": (film.get("releaseDate") or "")[:10] or None,
        "genres": [
            text(entity("genres", key).get("name")) or str(key)
            for key in film.get("genreIds", [])
        ],
        "people": people,
        "distributor": film.get("distributorName") or "",
        "synopsis": text(film.get("synopsis") or film.get("shortSynopsis")),
        "trailer_url": film.get("trailerUrl"),
    }


def screening_rows(data, stored):
    """One row per showtime at a stored cinema, and the films they show."""
    maps = related(data)

    def name(kind, key):
        return text(maps.get(kind, {}).get(str(key), {}).get("name")) or str(key)

    films = {key: film_row(film, maps) for key, film in maps.get("films", {}).items()}
    rows = []
    for show in data.get("showtimes", []):
        if show["siteId"] not in stored:
            continue
        schedule = show["schedule"]
        starts = datetime.fromisoformat(schedule["startsAt"])
        if starts.tzinfo is None:
            starts = starts.replace(tzinfo=TZ)
        rows.append(
            {
                "cinema_id": show["siteId"],
                "id": show["id"],
                "film_id": show["filmId"],
                "business_date": schedule["businessDate"][:10],
                "starts_at": utc(starts),
                "time": starts.astimezone(TZ).strftime("%H:%M"),
                "film_starts_at": moment(schedule.get("filmStartsAt")),
                "film_ends_at": moment(schedule.get("filmEndsAt")),
                "screen": name("screens", show["screenId"]),
                "screen_id": show["screenId"],
                "layout_id": show.get("seatLayoutId"),
                "experiences": [
                    name("attributes", key) for key in show.get("attributeIds", [])
                ],
                "seating": [
                    name("areaCategories", area["areaCategoryId"])
                    for area in show.get("areaCategories", [])
                ],
                "sold_out": show.get("isSoldOut"),
            }
        )
    return rows, films


def collect(api, today):
    """Everything one ingest stores, fetched before anything is written.

    A failure part-way leaves the database exactly as the last ingest left it.
    """
    sites = api.get("sites")["sites"]
    scope = configured_sites()
    unknown = (scope or set()) - {site["id"] for site in sites}
    if unknown:
        raise RuntimeError(
            "ODEON has no cinema with ID %s; check ODEON_CINEMAS"
            % ", ".join(sorted(unknown))
        )
    stored = {site["id"] for site in sites if scope is None or site["id"] in scope}
    params = [("siteIds", site) for site in sorted(stored)]
    catalogue = api.get("films")
    maps = related(catalogue)
    films = {film["id"]: film_row(film, maps) for film in catalogue.get("films", [])}
    availability = {}
    for site in sorted(stored):
        data = api.get(f"sites/{site}/films/availability")
        for item in data.get("filmAvailabilities", []):
            availability[(site, item["filmId"])] = item.get("categories", [])
    published = api.get("film-screening-dates", params).get("filmScreeningDates", [])
    days = sorted({entry["businessDate"][:10] for entry in published})
    screenings = []
    for day in days:
        if day >= str(today):
            rows, shown = screening_rows(
                api.get(f"showtimes/by-business-date/{day}", params), stored
            )
            screenings.extend(rows)
            # The catalogue's entry wins; a showtime's film fills any gap.
            films = shown | films
    return {
        "cinemas": [
            {
                "id": site["id"],
                "name": text(site["name"]),
                "stored": site["id"] in stored,
                "address": site.get("contactDetails", {}).get("address", {}),
                "latitude": site.get("location", {}).get("latitude"),
                "longitude": site.get("location", {}).get("longitude"),
            }
            for site in sites
        ],
        "stored_cinemas": stored,
        "films": list(films.values()),
        "availability": availability,
        "screenings": screenings,
    }


def now():
    return datetime.now(timezone.utc).astimezone(TZ)
