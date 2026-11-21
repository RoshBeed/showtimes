"""Public guest sessions, bounded OCAPI batches, and complete future dates."""

import base64
import json
import subprocess
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from showtimes_ingest.chains import cineworld, curzon, vista
from showtimes_ingest.guest import Client
from showtimes_ingest.store import connect
from showtimes_ingest.tokens import extract_token

TODAY = date(2026, 11, 19)


def jwt(expiry):
    payload = (
        base64.urlsafe_b64encode(json.dumps({"exp": expiry}).encode())
        .decode()
        .rstrip("=")
    )
    return "header." + payload + ".signature"


def page(source, token):
    if source.token_data == "next":
        return (
            '<script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": {"environment": {"gasToken": token}}}})
            + "</script>"
        )
    return (
        "window.initialData = "
        + json.dumps({"api": {"authToken": token}})
        + "; otherJavascript();"
    )


class GuestTest(unittest.TestCase):
    def test_both_public_page_formats_and_expiry(self):
        expiry = int(time.time()) + 3600
        for source in (cineworld.SOURCE, curzon.SOURCE):
            token = jwt(expiry)
            self.assertEqual(
                extract_token(page(source, token), source), (token, expiry)
            )
            for html in ("challenge", page(source, jwt(1)), page(source, 'bad"token')):
                with self.assertRaisesRegex(RuntimeError, "guest session"):
                    extract_token(html, source)

    def test_credentials_are_stdin_only_and_rejected_tokens_are_dropped_without_retry(
        self,
    ):
        client = Client(
            cineworld.SOURCE, pause=0, executable="/test/curl-impersonate", mode="curl"
        )
        token = jwt(int(time.time()) + 3600)
        replies = [
            subprocess.CompletedProcess(
                [], 0, page(cineworld.SOURCE, token) + "\n404", ""
            ),
            subprocess.CompletedProcess([], 0, "{}\n200", ""),
            subprocess.CompletedProcess([], 0, "denied\n401", ""),
        ]
        with patch("subprocess.run", side_effect=replies) as run:
            self.assertEqual(client.get("sites"), {})
            args, kwargs = run.call_args
            self.assertNotIn(token, str(args))
            self.assertIn("Bearer " + token, kwargs["input"])
            self.assertIn("Connect-Region-Code: GB", kwargs["input"])
            self.assertIn("chrome150", args[0])
            self.assertNotIn("--insecure", args[0])
            self.assertNotIn("--location", args[0])
            self.assertRaisesRegex(RuntimeError, "HTTP 401", client.get, "sites")
            self.assertIsNone(client.token)
            self.assertEqual(run.call_count, 3)

    def test_refreshes_an_expiring_session_and_curzon_omits_region(self):
        client = Client(curzon.SOURCE, pause=0)
        client.token, client.expiry = jwt(int(time.time()) + 30), time.time() + 30
        token = jwt(int(time.time()) + 3600)
        with patch.object(
            client,
            "request",
            side_effect=[(page(curzon.SOURCE, token), 200), ('{"sites":[]}', 200)],
        ) as request:
            client.get("sites")
            self.assertEqual(client.token, token)
            self.assertNotIn("Connect-Region-Code", request.call_args.args[1])


class API:
    def __init__(self):
        self.requests, self.calls = 0, []
        self.fail = False

    def get(self, route, params=()):
        self.requests += 1
        self.calls.append((route, params))
        ids = [value for key, value in params if key == "siteIds"]
        if route == "sites":
            return {
                "sites": [
                    {
                        "id": str(i).zfill(3),
                        "name": {"text": "London " + str(i)},
                        "contactDetails": {
                            "addressV2": {
                                "line1": {"text": "2 Street,"},
                                "line2": {"text": "London,"},
                                "line3": {"text": "E18PS"},
                            }
                        },
                    }
                    for i in range(6)
                ]
            }
        if len(ids) > 5:
            raise AssertionError("more than five cinemas in one request")
        if route == "film-screening-dates":
            return {
                "filmScreeningDates": [
                    {
                        "businessDate": day,
                        "filmScreenings": [
                            {
                                "filmId": "F1",
                                "sites": [{"siteId": site} for site in ids],
                            }
                        ],
                    }
                    for day in ("2026-11-18", "2026-11-19", "2027-06-20")
                ]
            }
        if self.fail:
            raise RuntimeError("source unavailable")
        day = route.rsplit("/", 1)[-1]
        return {
            "showtimes": [
                {
                    "id": site + "/" + day,
                    "siteId": site,
                    "filmId": "F1",
                    "screenId": "S1",
                    "schedule": {
                        "startsAt": day + "T20:30:00+01:00",
                        "businessDate": day,
                    },
                }
                for site in ids
            ],
            "relatedData": {
                "films": [{"id": "F1", "title": {"text": "A Film"}}],
                "screens": [{"id": "S1", "name": {"text": "Screen 1"}}],
            },
        }


class VistaTest(unittest.TestCase):
    def test_collects_all_cinemas_and_every_advertised_date_in_batches_of_five(self):
        client = API()
        data = vista.collect(client, TODAY)
        self.assertEqual(len(data["cinemas"]), 6)
        self.assertEqual(len(data["screenings"]), 12)
        self.assertEqual(
            client.requests, 7
        )  # directory, two calendars, four showtime batches
        self.assertEqual(
            data["cinemas"][0]["address"],
            {"line1": "2 Street", "city": "London", "postcode": "E1 8PS"},
        )
        self.assertEqual(
            {s["business_date"] for s in data["screenings"]},
            {"2026-11-19", "2027-06-20"},
        )
        self.assertEqual(data["screenings"][-1]["screen"], "Screen 1")

    def test_partial_fetch_keeps_previous_database_for_both_providers(self):
        for provider in (cineworld, curzon):
            with tempfile.TemporaryDirectory() as folder:
                path = str(Path(folder) / "listings.sqlite")
                provider.ingest(path, TODAY, API())
                client = API()
                client.fail = True
                with (
                    self.assertLogs("showtimes", "ERROR"),
                    self.assertRaises(RuntimeError),
                ):
                    provider.ingest(path, TODAY, client)
                with connect(path) as db:
                    self.assertEqual(
                        db.execute("SELECT count(*) FROM screenings").fetchone()[0], 12
                    )

    def test_address_v2_city_and_postcode_can_be_on_different_lines(self):
        site = {
            "id": "012",
            "name": {"text": "Swindon"},
            "contactDetails": {
                "addressV2": {
                    "line1": {"text": "Shaw Ridge"},
                    "line2": {"text": "Whitehill Way"},
                    "line3": {"text": "Swindon"},
                    "line4": {"text": "SN57DN"},
                }
            },
        }
        self.assertEqual(
            vista.cinema_row(site)["address"],
            {
                "line1": "Shaw Ridge, Whitehill Way",
                "city": "Swindon",
                "postcode": "SN5 7DN",
            },
        )
