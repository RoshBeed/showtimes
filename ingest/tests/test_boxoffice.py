"""The Webedia boxoffice chains (Everyman, Showcase) against a fake site and a
temporary database. Nothing here reaches a cinema's website."""

import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from showtimes_ingest import refresh, store
from showtimes_ingest.chains import boxoffice, everyman
from showtimes_ingest.store import MAX_FAILURES, get_state
from showtimes_ingest.week import TZ

TODAY = date(2026, 11, 11)  # a Wednesday; its week runs to Thursday the 19th
NOW = datetime(2026, 11, 11, 9, tzinfo=TZ)


def theater(id, name, zip, city, closed=False):
    return {
        "id": id,
        "name": name,
        "timeZone": "Europe/London",
        "practicalInfo": {
            "closed": closed,
            "coordinates": {"latitude": 51.5, "longitude": -0.1},
            "location": {"address": "1 High Street ", "city": city, "zip": zip},
        },
    }


def showing(uuid, starts, tags=(), screen="2", rate=10):
    return {
        "id": f"x-{starts}",
        "startsAt": starts,
        "tags": list(tags),
        "screen": {"name": screen},
        "occupancy": {"rate": rate},
        "data": {
            "ticketing": [
                {
                    "provider": "default",
                    "urls": [f"https://tickets.example/launch/ticketing/{uuid}"],
                },
                {"provider": "relay", "urls": ["https://relay.example/x"]},
            ]
        },
    }


class FakeSite:
    """A boxoffice site as routes; counts what a real run would request."""

    def __init__(self, last_day="2026-11-19", fail=None):
        self.requests, self.last_day, self.fail = 0, last_day, fail
        self.cinemas = [
            theater("X1", "Barnet", "EN5 1AB", "Barnet"),
            theater("X2", "Bath", "BA1 1SS", "Bath"),
            theater("X3", "Closed", "BS1 1AA", "Bristol", closed=True),
        ]

    def get(self, path, params=()):
        self.requests += 1
        if self.fail and self.fail in path:
            raise RuntimeError(f"HTTP 500 from {path}")
        if path == "/page-data/index/page-data.json":
            return {"staticQueryHashes": ["111", boxoffice.CINEMAS_QUERY]}
        if path == f"/page-data/sq/d/{boxoffice.CINEMAS_QUERY}.json":
            return {"data": {"allTheater": {"nodes": self.cinemas}}}
        if path == "/page-data/sq/d/111.json":
            return {"data": {"other": []}}
        if path.endswith("/schedule"):
            asked = dict(params)
            ids = [value for key, value in params if key == "theaters"]
            out = {}
            for each in ids:
                cinema = each.split('"id":"')[1].split('"')[0]
                schedule = {
                    "6272": {
                        "2026-11-12": [
                            showing(
                                f"{cinema}-a",
                                "2026-11-12T18:00:00",
                                [
                                    "Format.Projection.Laser",
                                    "Internal.Data.AlmostSoldOut",
                                ],
                            )
                        ],
                        self.last_day: [
                            showing(
                                f"{cinema}-b",
                                f"{self.last_day}T20:30:00",
                                ["Auditorium.Comfort.Recliners"],
                                screen="Lounge",
                                rate=100,
                            )
                        ],
                    },
                    "999": {
                        "2026-11-13": [showing(f"{cinema}-c", "2026-11-13T12:00:00")]
                    },
                }
                start = asked["from"][:10]
                out[cinema] = {
                    "schedule": {
                        film: {
                            day: shows for day, shows in days.items() if day >= start
                        }
                        for film, days in schedule.items()
                    }
                }
            return out
        if path.endswith("/movies"):
            return [
                {
                    "id": "6272",
                    "title": "Die Hard",
                    "runtime": 7920,
                    "genres": "Action, Thriller",
                    "direction": ["John McTiernan"],
                    "casting": ["Bruce Willis"],
                    "certificate": "15",
                    "release": "1988-07-15T00:00:00.000Z",
                    "releases": [{"distributors": [{"name": "Park Circus"}]}],
                    "synopsis": "Christmas.",
                    "trailer": {
                        "SD": "https://m.example/sd.mp4",
                        "HD": "https://m.example/hd.mov",
                    },
                }
            ]
        raise AssertionError(f"unexpected request {path}")


class BoxOfficeTest(unittest.TestCase):
    def setUp(self):
        original = store.utc
        frozen = patch.object(
            store, "utc", side_effect=lambda moment=None: original(moment or NOW)
        )
        frozen.start()
        self.addCleanup(frozen.stop)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "everyman.sqlite")

    def test_collect_reads_cinemas_showings_and_films_in_the_shared_schema(self):
        site = FakeSite()
        data = boxoffice.collect(site, TODAY)
        cinemas = {row["id"]: row for row in data["cinemas"]}
        self.assertEqual(
            cinemas["X1"]["address"],
            {"line1": "1 High Street ", "city": "Barnet", "postcode": "EN5 1AB"},
        )
        self.assertFalse(cinemas["X3"]["stored"])  # closed: listed, but not asked about
        shows = {row["id"]: row for row in data["screenings"]}
        self.assertEqual(set(shows), {"X1-a", "X1-b", "X1-c", "X2-a", "X2-b", "X2-c"})
        late = shows["X1-b"]
        self.assertEqual(
            (late["business_date"], late["time"], late["screen"], late["screen_id"]),
            ("2026-11-19", "20:30", "Lounge", "Lounge"),
        )
        self.assertEqual(
            (late["seating"], late["sold_out"]), (["Auditorium.Comfort.Recliners"], 1)
        )
        self.assertEqual(
            (shows["X1-a"]["screen"], shows["X1-a"]["sold_out"]), ("Screen 2", 0)
        )
        films = {row["id"]: row for row in data["films"]}
        self.assertEqual(films["6272"]["runtime"], 132)  # the platform counts seconds
        self.assertEqual(films["6272"]["genres"], ["Action", "Thriller"])
        self.assertEqual(
            films["6272"]["people"][:2],
            [
                {"name": "John McTiernan", "roles": ["Director"]},
                {"name": "Bruce Willis", "roles": ["Actor"]},
            ],
        )
        self.assertEqual(
            (films["6272"]["distributor"], films["6272"]["trailer_url"]),
            ("Park Circus", "https://m.example/hd.mov"),
        )
        self.assertEqual(
            films["999"]["title"], "999"
        )  # details missing: the showings stay
        # Index page, the cinemas' query (tried first), one schedule batch, one films batch.
        self.assertEqual(site.requests, 4)

    def test_refreshes_once_a_week_at_its_window(self):
        self.assertEqual(
            refresh.check(self.path, everyman.NAME, boxoffice.collect, FakeSite(), NOW),
            "ingested",
        )
        self.assertIsNone(get_state(self.path, "release_week"))
        same = FakeSite()
        self.assertEqual(
            refresh.check(self.path, everyman.NAME, boxoffice.collect, same, NOW),
            "done",
        )
        self.assertEqual(same.requests, 0)
        # Everyman's window opens on Wednesdays at 06:00: nothing on Thursday,
        # then the next Wednesday.
        thursday = datetime(2026, 11, 12, 9, tzinfo=TZ)
        self.assertEqual(
            refresh.check(
                self.path, everyman.NAME, boxoffice.collect, FakeSite(), thursday
            ),
            "done",
        )
        next_week = datetime(2026, 11, 18, 6, 30, tzinfo=TZ)
        self.assertEqual(
            refresh.check(
                self.path, everyman.NAME, boxoffice.collect, FakeSite(), next_week
            ),
            "ingested",
        )

    def test_failure_limit_is_visible_as_a_failed_check(self):
        with self.assertLogs("showtimes", "ERROR"):
            for _ in range(MAX_FAILURES):
                with self.assertRaises(RuntimeError):
                    refresh.check(
                        self.path,
                        everyman.NAME,
                        boxoffice.collect,
                        FakeSite(fail="schedule"),
                        NOW,
                    )
        self.assertEqual(everyman.settled_reason(self.path, NOW), "paused")
        with self.assertRaisesRegex(RuntimeError, "paused"):
            refresh.check(self.path, everyman.NAME, boxoffice.collect, FakeSite(), NOW)
