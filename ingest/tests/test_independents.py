"""Published feeds and pages, with no traffic to a cinema during tests."""

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from showtimes_ingest.chains import light, olympic
from showtimes_ingest.http import Client
from showtimes_ingest.store import connect

TODAY = date(2026, 11, 19)


class LightSite:
    def __init__(self):
        self.requests, self.paths = 0, []
        self.sites = [
            {"id": 8, "title": "Stockport", "url": light.SITE},
            {
                "id": 10,
                "title": "Addlestone",
                "url": "https://addlestone.thelight.co.uk",
            },
        ]
        show = {
            "BOID": "123",
            "Sort": "2030",
            "Display": "20.30",
            "Native": True,
            "FormatDisplay": "3D",
            "CssClass": "availRed",
            "Collections": [{"ID": 1, "Title": "Audio Description"}],
        }
        self.movies = [
            {
                "ID": 42,
                "Title": "A Film & Its Sequel",
                "Runtime": "2h 3m",
                "Cert": "12A",
                "ProgrammeType": 1,
                "Dates": [
                    {"Key": "20260701", "Sessions": [show]},
                    {
                        "Key": "20261119",
                        "Sessions": [
                            show,
                            show,  # the same booking link appears only once
                            {"Sort": "1200", "Native": True},  # no longer bookable
                        ],
                    },
                ],
            }
        ]

    def text(self, path):
        self.requests += 1
        self.paths.append(path)
        if path == "/":
            return "var __sites = " + json.dumps(self.sites) + ";"
        return (
            "'use strict';\nvar __gfminiguidedata = "
            + json.dumps({"Schedule": self.movies})
            + ';\nif(window.gfdx) window.gfdx("MINIGUIDEDATA");'
        )


def cinema_html(id):
    names = {
        "powerstation": "The Cinema in The Power Station",
        "barnes": "Olympic Studios",
        "selfridges": "The Cinema at Selfridges",
    }
    data = {
        "@type": "MovieTheater",
        "address": {
            "name": names[id],
            "streetAddress": "1 High Street",
            "addressLocality": "London",
            "postalCode": "SW11 8DD",
        },
        "geo": {"latitude": "51.48", "longitude": "-0.14"},
    }
    if id == "powerstation":
        data["alternateAddress"] = {
            "name": "The Cinema in the Arches",
            "postalCode": "SW11 8AB",
        }
    return '<script type="application/ld+json">' + json.dumps(data) + "</script>"


def programme(id, heading="Thursday November 19"):
    host = {"powerstation": 2, "barnes": 1, "selfridges": 3}[id]
    venue = "<h6>The Cinema in the Powerstation</h6>" if id == "powerstation" else ""
    booking = f"https://web{host}.empire.mycloudcinema.com/#/book/123/subtitled"
    return f"""<section class="date-section" data-cc-search-group>
      <h3 class="date-day">{heading}</h3><div class="row">
      <div class="col-md-12" data-cc-search="a film">
        <img alt="BBFC Cert 15"><h5><a href="/film/a-film">A Film &amp; Sequel</a></h5>
        <div>{venue}<div><a href="{booking}">
          <span class="btn-times-fs">20:30</span><img alt="Dolby Cinema">
        </a></div></div>
      </div></div></section>"""


class OlympicSite:
    def __init__(self):
        self.requests, self.fail = 0, None
        self.pages = {
            site + "/whats-on": cinema_html(id) + programme(id)
            for id, site in olympic.SITES
        }

    def text(self, path):
        self.requests += 1
        if path == self.fail:
            raise RuntimeError("HTTP 503")
        return self.pages[path]


class IndependentTest(unittest.TestCase):
    def test_light_reads_each_cinemas_full_feed_once_and_keeps_ids_separate(self):
        client = LightSite()
        data = light.collect(client, TODAY)
        self.assertEqual(client.requests, 5)
        self.assertEqual(len(data["screenings"]), 2)
        self.assertEqual(
            {row["cinema_id"] for row in data["screenings"]},
            {"stockport", "addlestone"},
        )
        self.assertEqual(data["films"][0]["runtime"], 123)
        show = data["screenings"][0]
        self.assertEqual(
            (show["id"], show["starts_at"], show["time"]),
            ("123", "2026-11-19T20:30:00Z", "20:30"),
        )
        self.assertEqual(show["experiences"], ["Audio Description", "3D"])
        self.assertEqual((show["screen_id"], show["sold_out"]), ("?", None))
        client.movies[0]["Dates"] = [
            {
                "Key": "20260701",
                "Sessions": [dict(client.movies[0]["Dates"][0]["Sessions"][0])],
            }
        ]
        summer = light.collect(client, date(2026, 7, 1))["screenings"][0]
        self.assertEqual(summer["starts_at"], "2026-07-01T19:30:00Z")

    def test_light_rejects_missing_feeds_and_unexpected_hosts(self):
        self.assertRaises(RuntimeError, light.embedded, "a challenge", "__sites")
        client = LightSite()
        client.sites[0]["url"] = "https://thelight.co.uk.example.org"
        self.assertRaises(RuntimeError, light.collect, client, TODAY)

    def test_light_keeps_advance_bookings_beyond_the_fortnight_guide(self):
        dates = [
            {
                "Key": "20270530",
                "Sessions": [{"BOID": "999", "Sort": "2030", "Native": True}],
            }
        ]
        html = (
            '<div class="prog" data-prog="42"><h2>A Future Film</h2><p class="runtime">2h 3m | 12A</p><script>new ScheduleBrowser({selector: "#prog-42", data:'
            + json.dumps(dates)
            + "});</script></div>"
        )
        movie = light.upcoming(html)[0]
        self.assertEqual((movie["Title"], movie["Dates"]), ("A Future Film", dates))
        client = LightSite()
        original = client.text
        client.text = lambda path: (
            html if path.endswith("/cinema/comingsoon") else original(path)
        )
        data = light.collect(client, TODAY)
        self.assertEqual(
            {s["business_date"] for s in data["screenings"]},
            {"2026-11-19", "2027-05-30"},
        )
        self.assertEqual(
            len(data["films"]), 2
        )  # Same film at two cinemas; metadata from the guide wins.
        self.assertEqual(data["films"][0]["title"], "A Film & Its Sequel")

    def test_olympic_keeps_four_venues_and_the_exact_booking_hosts(self):
        client = OlympicSite()
        data = olympic.collect(client, TODAY)
        self.assertEqual(client.requests, 3)
        self.assertEqual(
            {row["id"] for row in data["cinemas"]},
            {"powerstation", "arches", "barnes", "selfridges"},
        )
        self.assertEqual(len(data["screenings"]), 3)
        self.assertEqual(
            len({(row["cinema_id"], row["id"]) for row in data["screenings"]}), 3
        )
        show = data["screenings"][0]
        self.assertEqual(show["experiences"], ["Dolby Cinema", "Subtitled"])
        self.assertEqual(data["films"][0]["title"], "A Film & Sequel")
        self.assertEqual(show["starts_at"], "2026-11-19T20:30:00Z")

    def test_olympic_distinguishes_arches_and_handles_next_year(self):
        client = OlympicSite()
        url = olympic.SITES[0][1] + "/whats-on"
        client.pages[url] += (
            programme("powerstation", "Friday January 1")
            .replace("The Cinema in the Powerstation", "The Cinema in the Arches")
            .replace("/123/", "/456/")
        )
        shows = olympic.collect(client, TODAY)["screenings"]
        self.assertEqual(
            [
                (row["cinema_id"], row["business_date"])
                for row in shows
                if row["id"].startswith("456/")
            ],
            [("arches", "2027-01-01")],
        )
        client.pages[url] = client.pages[url].replace(
            "The Cinema in the Powerstation</h6>", "Unknown Cinema</h6>"
        )
        self.assertRaisesRegex(
            RuntimeError, "unknown venue", olympic.collect, client, TODAY
        )

    def test_partial_fetch_never_replaces_the_previous_database(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "olympic.sqlite")
            client = OlympicSite()
            olympic.ingest(path, TODAY, client)
            client.fail = olympic.SITES[-1][1] + "/whats-on"
            with self.assertLogs("showtimes", "ERROR"), self.assertRaises(RuntimeError):
                olympic.ingest(path, TODAY, client)
            with connect(path) as db:
                self.assertEqual(
                    db.execute("SELECT count(*) FROM screenings").fetchone()[0], 3
                )
                self.assertEqual(
                    db.execute(
                        "SELECT status FROM runs ORDER BY id DESC LIMIT 1"
                    ).fetchone()[0],
                    "failed",
                )

    def test_plain_client_can_read_a_chains_other_cinema_hosts(self):
        client = Client(light.SITE)
        self.assertEqual(
            client.url("https://redhill.thelight.co.uk" + light.FEED),
            "https://redhill.thelight.co.uk" + light.FEED,
        )
        self.assertEqual(client.url("/api", [("q", "a b")]), light.SITE + "/api?q=a+b")
