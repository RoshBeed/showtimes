"""The shared Vista OCAPI response vocabulary and advertised-date collector."""

import re
from collections import defaultdict
from datetime import datetime
from itertools import batched

from showtimes_ingest import refresh
from showtimes_ingest.guest import session
from showtimes_ingest.log import log
from showtimes_ingest.store import connect, utc
from showtimes_ingest.week import TZ


def cinema_row(site):
    contact = site.get("contactDetails") or {}
    address = contact.get("addressV2") or contact.get("address") or {}
    if "city" not in address:
        lines = [text(address.get(f"line{i}")).strip().strip(",") for i in range(1, 5)]
        lines = [line for line in lines if line]
        postcode = next(
            (
                line
                for line in lines
                if re.fullmatch(r"[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}", line, re.I)
            ),
            "",
        )
        lines = [line for line in lines if line != postcode]
        compact = postcode.replace(" ", "").upper()
        address = {
            "line1": ", ".join(lines[:-1]),
            "city": lines[-1] if lines else "",
            "postcode": compact[:-3] + " " + compact[-3:] if compact else "",
        }
    return {
        "id": str(site["id"]),
        "name": text(site["name"]),
        "stored": True,
        "address": address,
        "latitude": (site.get("location") or {}).get("latitude"),
        "longitude": (site.get("location") or {}).get("longitude"),
    }


def advertised(client, sites, batch_size=5):
    """Respect the deployment's verified cinema-filter limit."""
    days = {}
    for batch in batched(sorted(sites), batch_size or len(sites) or 1):
        params = [("siteIds", site) for site in batch]
        for row in client.get("film-screening-dates", params).get(
            "filmScreeningDates", []
        ):
            cinemas = {
                str(site["siteId"])
                for film in row.get("filmScreenings", [])
                for site in film.get("sites", [])
            }
            days.setdefault(row["businessDate"][:10], set()).update(cinemas or batch)
    return days


def collect(client, today, known=None, scope=None, catalogue=False, batch_size=5):
    sites = client.get("sites").get("sites", [])
    if not sites:
        raise RuntimeError("Vista: empty cinema directory")
    all_sites = {str(site["id"]) for site in sites}
    unknown = (scope or set()) - all_sites
    if unknown:
        raise RuntimeError("Vista has no cinema with ID " + ", ".join(sorted(unknown)))
    stored = all_sites if scope is None else all_sites & scope
    days = advertised(client, stored, batch_size)
    films, shows = {}, {}
    availability = {}
    if catalogue:
        data = client.get("films")
        maps = related(data)
        films.update(
            (film["id"], film_row(film, maps)) for film in data.get("films", [])
        )
        for site in sorted(stored):
            for item in client.get(f"sites/{site}/films/availability").get(
                "filmAvailabilities", []
            ):
                availability[(site, item["filmId"])] = item.get("categories", [])
    for day in sorted(days):
        if day < str(today):
            continue
        for batch in batched(
            sorted(days[day] & stored), batch_size or len(stored) or 1
        ):
            params = [("siteIds", site) for site in batch]
            rows, movies = screening_rows(
                client.get(f"showtimes/by-business-date/{day}", params), stored
            )
            films = movies | films
            shows.update(((row["cinema_id"], row["id"]), row) for row in rows)
    if not shows and not catalogue:
        raise RuntimeError(
            "Vista: no published showings; keeping the previous programme"
        )
    return {
        "cinemas": [
            dict(cinema_row(site), stored=str(site["id"]) in stored) for site in sites
        ],
        "films": list(films.values()),
        "stored_cinemas": stored,
        "screenings": list(shows.values()),
        "availability": {
            (row["cinema_id"], row["film_id"]): ["NowShowing"] for row in shows.values()
        }
        | availability,
    }


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
                ]
                + (["3D"] if show.get("requires3dGlasses") else []),
                "seating": [
                    name("areaCategories", area["areaCategoryId"])
                    for area in show.get("areaCategories", [])
                ],
                "sold_out": show.get("isSoldOut"),
            }
        )
    return rows, films


IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


def layout_capacity(layout):
    """Seats in a seat layout (every listed seat, in every area)."""
    return sum(
        len(row.get("seats", []))
        for area in layout["seatLayout"].get("areas", [])
        for row in area.get("rows", [])
    )


def store_screen_sizes(path, api, screenings):
    """One layout request for each screen whose size is not stored yet.

    A layout that cannot be fetched is reported, not fatal: the schedule is
    already stored and the next ingest asks again.
    """
    layouts = defaultdict(set)
    for row in screenings:
        if row["layout_id"]:
            layouts[(row["cinema_id"], row["screen_id"])].add(row["layout_id"])
    with connect(path) as db:
        known = set(db.execute("SELECT cinema_id, screen_id FROM screens"))
    stored, failed = 0, 0
    for screen in sorted(set(layouts) - known):
        layout = min(layouts[screen])
        try:
            if not IDENTIFIER.fullmatch(layout):
                raise RuntimeError("Invalid seat-layout identifier")
            capacity = layout_capacity(api.get(f"seat-layouts/{layout}"))
        except (RuntimeError, KeyError) as error:
            failed += 1
            log.warning("seat layout %s not stored: %s", layout, error)
            continue
        with connect(path) as db:
            db.execute(
                "INSERT INTO screens VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                (*screen, capacity),
            )
        stored += 1
    return stored, failed


class Vista:
    """One backend adapter; chains supply configuration and optional capabilities."""

    def __init__(
        self,
        source,
        scope_env=None,
        catalogue=False,
        screen_sizes=False,
        local_showtime_ids=False,
        batch_size=5,
    ):
        self.source, self.NAME = source, source.name
        self.scope_env, self.catalogue = scope_env, catalogue
        self.screen_sizes, self.local_showtime_ids = screen_sizes, local_showtime_ids
        self.batch_size = batch_size

    def scope(self):
        import os

        configured = os.environ.get(self.scope_env, "") if self.scope_env else ""
        return set(configured.replace(",", " ").split()) or None

    def scope_changed(self, path):
        if not self.scope_env:
            return False
        with connect(path) as db:
            cinemas = dict(db.execute("SELECT id,stored FROM cinemas"))
        return bool(cinemas) and {id for id, stored in cinemas.items() if stored} != (
            self.scope() or set(cinemas)
        )

    def collect(self, client, today, known=None):
        data = collect(
            client,
            today,
            known,
            scope=self.scope(),
            catalogue=self.catalogue,
            batch_size=self.batch_size,
        )
        if self.local_showtime_ids:
            # Compatibility with this operator's older public website feed.
            for row in data["screenings"]:
                row["id"] = row["id"].removeprefix(row["cinema_id"] + "-")
        return data

    def sizes(self, path, client, data):
        stored, failed = store_screen_sizes(path, client, data["screenings"])
        return {"screens_sized": stored, "screens_failed": failed}

    def ingest(self, path=None, today=None, client=None):
        with session(self.source, client) as api:
            return refresh.ingest(
                path,
                self.NAME,
                self.collect,
                api,
                today,
                after_store=self.sizes if self.screen_sizes else None,
            )

    def settled_reason(self, path=None, today=None):
        reason = refresh.settled_reason(path, self.NAME, today)
        return None if reason != "paused" and self.scope_changed(path) else reason

    def check(self, path=None, moment=None, client=None):
        if self.settled_reason(path, moment) == "paused":
            raise RuntimeError(
                f"{self.NAME}: paused after repeated failures in this refresh window"
            )
        if self.scope_changed(path):
            self.ingest(path, refresh.as_moment(moment).date(), client)
            return "ingested"
        with session(self.source, client) as api:
            return refresh.check(
                path,
                self.NAME,
                self.collect,
                api,
                moment,
                after_store=self.sizes if self.screen_sizes else None,
            )
