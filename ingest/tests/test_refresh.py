"""Clock-based refreshes, source failures and visible health across providers."""

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from test_vista import API

from showtimes_ingest import refresh, store
from showtimes_ingest.chains import vista
from showtimes_ingest.policy import windows
from showtimes_ingest.week import TZ

NOW = datetime(2026, 11, 19, 12, tzinfo=TZ)


class RefreshTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "source.sqlite")
        self.moment = NOW
        original = store.utc
        frozen = patch.object(
            store,
            "utc",
            side_effect=lambda moment=None: original(moment or self.moment),
        )
        frozen.start()
        self.addCleanup(frozen.stop)

    def check(self, client=None, name="cineworld", moment=None):
        self.moment = moment or self.moment
        return refresh.check(
            self.path, name, vista.collect, client or API(), self.moment
        )

    def test_once_a_week_then_nothing_until_the_next_window(self):
        # Thursday: Cineworld's window opened on Tuesday at 06:00.
        self.assertEqual(self.check(), "ingested")
        client = API()
        self.assertEqual(self.check(client), "done")
        self.assertEqual(client.requests, 0)  # later checks that week contact nobody
        self.assertEqual(
            self.check(moment=datetime(2026, 11, 23, 20, tzinfo=TZ)), "done"
        )
        self.assertEqual(
            self.check(moment=datetime(2026, 11, 24, 6, 30, tzinfo=TZ)), "ingested"
        )

    def test_each_window_follows_the_chains_publishing_time(self):
        def opens(name, moment):
            return windows(name, moment)[0]

        wednesday = datetime(2026, 11, 25, 22, tzinfo=TZ)
        # ODEON is sometimes not out until Wednesday evening.
        self.assertEqual(
            opens("odeon", wednesday), datetime(2026, 11, 25, 21, tzinfo=TZ)
        )
        self.assertEqual(
            opens("odeon", datetime(2026, 11, 25, 20, tzinfo=TZ)),
            datetime(2026, 11, 18, 21, tzinfo=TZ),
        )
        self.assertEqual(
            opens("everyman", wednesday), datetime(2026, 11, 25, 6, tzinfo=TZ)
        )
        for name in ("cineworld", "showcase", "rio"):
            self.assertEqual(
                opens(name, wednesday), datetime(2026, 11, 24, 6, tzinfo=TZ)
            )

    def test_failures_preserve_data_and_do_not_turn_green_after_a_recent_success(self):
        self.check()
        before = refresh.status(self.path, "cineworld", NOW)
        bad = API()
        bad.fail = True
        with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
            refresh.ingest(
                self.path, "cineworld", vista.collect, bad, self.moment.date()
            )
        health = refresh.status(self.path, "cineworld", NOW)
        self.assertEqual(health["status"], "failed")
        self.assertEqual(health["screenings"], before["screenings"])
        self.assertEqual(health["last_success"], before["last_success"])
        self.assertIsNone(refresh.settled_reason(self.path, "cineworld", NOW))

    def test_paused_is_a_failure_and_the_next_refresh_window_can_recover(self):
        bad = API()
        bad.fail = True
        for _ in range(3):
            with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
                self.check(bad)
        self.assertEqual(
            refresh.status(self.path, "cineworld", NOW)["status"], "paused"
        )
        requests = bad.requests
        with self.assertRaisesRegex(RuntimeError, "paused"):
            self.check(bad)
        self.assertEqual(bad.requests, requests)
        # Paused for the rest of the week; next week's window tries again.
        self.assertEqual(
            self.check(moment=datetime(2026, 11, 24, 7, tzinfo=TZ)), "ingested"
        )

    def test_one_provider_failure_does_not_pause_another(self):
        bad = API()
        bad.fail = True
        for _ in range(3):
            with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
                self.check(bad)
        self.assertEqual(self.check(name="curzon"), "ingested")

    def test_health_reports_due_and_then_stale_even_without_a_new_failed_run(self):
        self.check()
        self.assertEqual(
            refresh.status(self.path, "cineworld", NOW)["status"], "healthy"
        )
        self.assertEqual(
            refresh.status(
                self.path, "cineworld", datetime(2026, 11, 24, 6, 30, tzinfo=TZ)
            )["status"],
            "due",
        )
        self.assertEqual(
            refresh.status(
                self.path, "cineworld", datetime(2026, 11, 24, 9, tzinfo=TZ)
            )["status"],
            "stale",
        )

    def test_empty_source_and_empty_programme_are_not_healthy(self):
        self.assertEqual(
            refresh.status(self.path, "cineworld", NOW)["status"], "unavailable"
        )
        with (
            self.assertLogs("showtimes", "ERROR"),
            self.assertRaisesRegex(RuntimeError, "empty programme"),
        ):
            refresh.ingest(
                self.path, "cineworld", lambda *_: {"screenings": []}, API(), NOW.date()
            )
        self.assertEqual(
            refresh.status(self.path, "cineworld", NOW)["status"], "failed"
        )

    def test_success_clears_the_unverified_release_week_marker(self):
        with store.connect(self.path) as db:
            db.execute("INSERT INTO state VALUES ('release_week','2026-11-17')")
        self.check()
        self.assertIsNone(store.get_state(self.path, "release_week"))

    def test_used_transport_and_fallback_are_visible_in_health(self):
        client = API()
        client.transport = "browser"
        client.fallback_reason = "HTTP 403 from primary"
        self.check(client)
        health = refresh.status(self.path, "cineworld", NOW)
        self.assertEqual(health["transport"], "browser")
        self.assertEqual(health["fallback_reason"], "HTTP 403 from primary")

    def test_london_time_windows_follow_summer_and_winter_offsets(self):
        _, spring = windows("rio", datetime(2027, 3, 27, 22, tzinfo=TZ))
        _, autumn = windows("rio", datetime(2027, 10, 30, 22, tzinfo=TZ))
        self.assertEqual(spring.astimezone(timezone.utc).hour, 5)
        self.assertEqual(autumn.astimezone(timezone.utc).hour, 6)
