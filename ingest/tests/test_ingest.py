"""The ingest, with ODEON as its chain, against a fake ODEON and a temporary
database. Nothing here reaches ODEON, OMDb or IMDb."""

import os
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from showtimes_ingest import ratings
from showtimes_ingest.chains import CHAINS, odeon
from showtimes_ingest.chains.odeon import run
from showtimes_ingest.chains.odeon.collect import TZ, collect, release_week
from showtimes_ingest.scores import IMDbRatings, OMDb
from showtimes_ingest.store import MAX_FAILURES, connect, get_state

TODAY = date(2026, 11, 11)  # a Wednesday; its release week began Tuesday the 10th
NOW = datetime(2026, 11, 11, 9, tzinfo=TZ)
LAYOUT = {"seatLayout": {"areas": [{"rows": [{"seats": [{}, {}, {}]}]}]}}


def showtime(number, day, site="155"):
    return {
        "id": f"{site}-{number}",
        "siteId": site,
        "filmId": "F1",
        "screenId": f"{site}-S1",
        "seatLayoutId": "L1",
        "attributeIds": ["A1"],
        "areaCategories": [{"areaCategoryId": "C1"}],
        "isSoldOut": False,
        "schedule": {
            "businessDate": f"{day}T00:00:00",
            "startsAt": f"{day}T18:00:00+00:00",
            "filmStartsAt": f"{day}T18:25:00+00:00",
            "filmEndsAt": f"{day}T21:00:00+00:00",
        },
    }


class FakeAPI:
    """ODEON as a dictionary of routes; counts what a real run would request."""

    def __init__(self, days=("2026-11-12", "2026-11-13"), fail=None):
        self.requests, self.fail, self.asked = 0, fail, []
        self.routes = {
            "sites": {
                "sites": [
                    {
                        "id": "155",
                        "name": {"text": "West End"},
                        "contactDetails": {"address": {"city": "London"}},
                        "location": {"latitude": 51.5, "longitude": -0.1},
                    },
                    {"id": "001", "name": {"text": "Aberdeen"}},
                ]
            },
            "films": {
                "films": [
                    {
                        "id": "F1",
                        "title": {"text": "Dune"},
                        "releaseDate": "2026-11-06T00:00:00",
                        "runtimeInMinutes": 155,
                        "genreIds": ["G1"],
                        "censorRatingId": "R1",
                        "castAndCrew": [
                            {"castAndCrewMemberId": "P1", "roles": ["Director"]}
                        ],
                        "synopsis": {"text": "Sand."},
                    },
                    {"id": "F2", "title": {"text": "Later"}},
                ],
                "relatedData": {
                    "genres": [{"id": "G1", "name": {"text": "Sci-Fi"}}],
                    "censorRatings": [{"id": "R1", "classification": {"text": "12A"}}],
                    "castAndCrew": [
                        {
                            "id": "P1",
                            "name": {"givenName": "Denis", "familyName": "Villeneuve"},
                        }
                    ],
                },
            },
            "sites/155/films/availability": {
                "filmAvailabilities": [
                    {"filmId": "F1", "categories": ["NowShowing"]},
                    {"filmId": "F2", "categories": ["ComingSoon"]},
                ]
            },
            "film-screening-dates": {
                "filmScreeningDates": [
                    {"businessDate": f"{day}T00:00:00"}
                    for day in ("2026-11-10", *days)  # the 10th is already past
                ]
            },
            "seat-layouts/L1": LAYOUT,
        }
        for number, day in enumerate(days):
            self.routes[f"showtimes/by-business-date/{day}"] = {
                "showtimes": [showtime(number, day)],
                "relatedData": {
                    "films": [{"id": "F1", "title": {"text": "Dune"}}],
                    "screens": [{"id": "155-S1", "name": {"text": "Screen 1"}}],
                    "attributes": [{"id": "A1", "name": {"text": "IMAX"}}],
                    "areaCategories": [{"id": "C1", "name": {"text": "Recliner"}}],
                },
            }

    def get(self, route, params=()):
        self.requests += 1
        self.asked.append((route, list(params)))
        if route == self.fail:
            raise RuntimeError("API returned HTTP 500 for " + route)
        if route not in self.routes:
            if route.startswith("sites/") and route.endswith("/films/availability"):
                return {"filmAvailabilities": []}
            raise RuntimeError("unexpected route " + route)
        return self.routes[route]


class CollectTests(unittest.TestCase):
    def test_release_week_runs_tuesday_to_the_thursday_after_next(self):
        self.assertEqual(release_week(TODAY), (date(2026, 11, 10), date(2026, 11, 19)))

    def test_collects_future_screenings_with_names_resolved(self):
        data = collect(FakeAPI(), TODAY)
        self.assertEqual(data["stored_cinemas"], {"001", "155"})
        self.assertEqual(
            [row["business_date"] for row in data["screenings"]],
            ["2026-11-12", "2026-11-13"],
        )
        first = data["screenings"][0]
        self.assertEqual(
            (first["screen"], first["experiences"], first["seating"], first["time"]),
            ("Screen 1", ["IMAX"], ["Recliner"], "18:00"),
        )
        self.assertEqual(first["starts_at"], "2026-11-12T18:00:00Z")
        film = next(film for film in data["films"] if film["id"] == "F1")
        self.assertEqual(
            (film["certificate"], film["genres"], film["release_date"]),
            ("12A", ["Sci-Fi"], "2026-11-06"),
        )
        self.assertEqual(
            film["people"], [{"name": "Denis Villeneuve", "roles": ["Director"]}]
        )
        self.assertEqual(data["availability"][("155", "F2")], ["ComingSoon"])

    def test_summer_times_are_stored_in_utc_and_shown_in_london_time(self):
        api = FakeAPI(days=("2027-07-13",))
        show = api.routes["showtimes/by-business-date/2027-07-13"]["showtimes"][0]
        show["schedule"]["startsAt"] = "2027-07-14T00:30:00+01:00"
        row = collect(api, TODAY)["screenings"][0]
        self.assertEqual(
            (row["starts_at"], row["time"]), ("2027-07-13T23:30:00Z", "00:30")
        )

    def test_configured_cinemas_limit_what_is_stored(self):
        with patch.dict(os.environ, {"ODEON_CINEMAS": "001"}):
            data = collect(FakeAPI(), TODAY)
        self.assertEqual(data["screenings"], [])
        self.assertEqual(data["stored_cinemas"], {"001"})
        self.assertNotIn(("155", "F1"), data["availability"])

    def test_a_configured_cinema_odeon_does_not_have_stops_the_ingest(self):
        with patch.dict(os.environ, {"ODEON_CINEMAS": "001, 999"}):
            with self.assertRaisesRegex(RuntimeError, "999; check ODEON_CINEMAS"):
                collect(FakeAPI(), TODAY)


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "odeon.sqlite")

    def rows(self, query):
        with connect(self.path) as db:
            return db.execute(query).fetchall()

    def test_ingest_stores_everything_and_sizes_each_screen_once(self):
        summary = run.ingest(self.path, TODAY, FakeAPI())
        self.assertEqual((summary["screenings"], summary["screens_sized"]), (2, 1))
        self.assertEqual(self.rows("SELECT * FROM screens"), [("155", "155-S1", 3)])
        self.assertEqual(
            self.rows("SELECT id, stored FROM cinemas ORDER BY id"),
            [("001", 1), ("155", 1)],
        )
        self.assertEqual(self.rows("SELECT status FROM runs"), [("ok",)])
        # A second ingest asks for no layout again.
        again = FakeAPI()
        self.assertEqual(run.ingest(self.path, TODAY, again)["screens_sized"], 0)
        self.assertNotIn("seat-layouts/L1", [route for route, _ in again.asked])

    def test_next_ingest_replaces_screenings_so_cancelled_ones_disappear(self):
        run.ingest(self.path, TODAY, FakeAPI())
        run.ingest(self.path, TODAY, FakeAPI(days=("2026-11-13",)))
        self.assertEqual(
            self.rows("SELECT business_date FROM screenings"), [("2026-11-13",)]
        )

    def test_failed_ingest_keeps_the_previous_data_and_records_why(self):
        run.ingest(self.path, TODAY, FakeAPI())
        with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
            run.ingest(self.path, TODAY, FakeAPI(fail="films"))
        self.assertEqual(self.rows("SELECT count(*) FROM screenings"), [(2,)])
        failed = self.rows("SELECT error FROM runs WHERE status = 'failed'")
        self.assertIn("HTTP 500", failed[0][0])

    def test_check_ingests_once_per_release_week(self):
        api = FakeAPI(days=("2026-11-12", "2026-11-19"))  # the week's last Thursday
        self.assertEqual(run.check(self.path, NOW, api), "ingested")
        self.assertEqual(get_state(self.path, "release_week"), "2026-11-10")
        before = api.requests
        self.assertEqual(run.check(self.path, NOW, api), "done")
        self.assertEqual(api.requests, before)  # no request once the week is stored
        self.assertEqual(run.settled_reason(self.path, TODAY), "done")

    def test_check_fills_an_empty_database_then_asks_about_the_stored_cinemas(self):
        api = FakeAPI()
        api.routes["showtimes/by-business-date/2026-11-19"] = {"showtimes": []}
        self.assertEqual(run.check(self.path, NOW, api), "ingested")
        self.assertIsNone(get_state(self.path, "release_week"))
        del api.asked[:]
        self.assertEqual(run.check(self.path, NOW, api), "waiting")
        # The release check only, naming every stored cinema.
        self.assertEqual(
            api.asked,
            [
                (
                    "showtimes/by-business-date/2026-11-19",
                    [("siteIds", "001"), ("siteIds", "155")],
                )
            ],
        )

    def test_expanded_scope_backfills_without_waiting_for_the_next_release(self):
        with patch.dict(os.environ, {"ODEON_CINEMAS": "155"}):
            run.ingest(self.path, TODAY, FakeAPI(days=("2026-11-19",)))
            self.assertEqual(run.settled_reason(self.path, TODAY), "done")
        self.assertIsNone(run.settled_reason(self.path, TODAY))
        self.assertEqual(run.check(self.path, NOW, FakeAPI()), "ingested")
        self.assertIsNone(get_state(self.path, "release_week"))

    def test_check_pauses_after_repeated_failures(self):
        api = FakeAPI(fail="films")
        for _ in range(MAX_FAILURES):
            with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
                run.check(self.path, NOW, api)
        before = api.requests
        with self.assertLogs("showtimes", "WARNING"):
            self.assertEqual(run.check(self.path, NOW, api), "paused")
        self.assertEqual(api.requests, before)

    def omdb(self, params):
        return {
            "Response": "True",
            "Title": "Dune",
            "imdbRating": "8.0",
            "Metascore": "74",
            "imdbID": "tt1",
        }

    def test_ratings_run_once_after_each_ingest_preferring_imdbs_own_file(self):
        with patch.dict(os.environ, {"OMDB_API_KEY": "k"}):
            self.assertEqual(ratings.check_ratings(odeon, self.path), "waiting")
        run.ingest(self.path, TODAY, FakeAPI())
        with patch.dict(os.environ, {"OMDB_API_KEY": ""}):
            self.assertEqual(ratings.check_ratings(odeon, self.path), "disabled")
        with (
            patch.dict(os.environ, {"OMDB_API_KEY": "k"}),
            patch.object(OMDb, "fetch", self.omdb),
            patch.object(IMDbRatings, "ratings_for", return_value={"tt1": 8.4}),
        ):
            self.assertEqual(ratings.check_ratings(odeon, self.path), "ingested")
            self.assertEqual(ratings.check_ratings(odeon, self.path), "done")
        self.assertEqual(
            self.rows("SELECT * FROM ratings WHERE film_id = 'F1' ORDER BY source"),
            [("F1", "imdb", 8.4, "tt1"), ("F1", "metacritic", 74.0, None)],
        )

    def test_ratings_ingest_stops_on_a_rejected_key(self):
        run.ingest(self.path, TODAY, FakeAPI())

        def rejected(self, params):
            self.stopped = "Invalid API key!"
            raise RuntimeError("OMDb: Invalid API key!")

        with patch.object(OMDb, "fetch", rejected):
            with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
                ratings.ingest_ratings(odeon, self.path, key="bad")
        self.assertEqual(self.rows("SELECT count(*) FROM ratings"), [(0,)])


class ChainsTest(unittest.TestCase):
    def test_each_chain_offers_what_the_command_line_and_ratings_use(self):
        self.assertEqual(sorted(CHAINS), ["odeon"])
        for chain in CHAINS.values():
            for name in ("NAME", "check", "ingest", "settled_reason", "search_title"):
                self.assertTrue(hasattr(chain, name), f"{chain.NAME} lacks {name}")

    def test_odeon_strips_its_own_title_prefix_before_the_usual_clean_up(self):
        self.assertEqual(
            odeon.search_title("ODEON Pride Nights - A Wolf Among the Swans (Hindi)"),
            "A Wolf Among the Swans",
        )
        self.assertEqual(odeon.search_title("THE SNOWMAN™"), "THE SNOWMAN")


if __name__ == "__main__":
    unittest.main()
