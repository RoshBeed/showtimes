import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

from showtimes_ingest.chains import actone, princecharles, rio
from showtimes_ingest.chains.jacro import listing_day
from showtimes_ingest.store import connect
from showtimes_ingest.week import TZ

TODAY = date(2026, 11, 19)
NOW = datetime(2026, 11, 19, 12, tzinfo=TZ)
PAGE = """<div class="jacro-event movie-tabs row"><a class="liveeventtitle" href="https://princecharlescinema.com/film/42/a-film">A Film</a>
<div class="running-time"><span>1987</span><span>92mins</span><span>(15)</span></div>
<span>Directed by A Director</span><p>A synopsis.</p>
<ul class="performance-list-items"><div class="heading">Friday 20th November</div>
<li class="35mm"><a class="film_book_button" href="https://princecharlescinema.com/prince-charles-cinema/booknow/123"><span class="time">9:00 pm</span></a><span class="tag">35mm</span></li>
<li><a class="film_book_button soldout"><span class="time">7:30 pm</span></a></li></ul></div>"""


class PCC:
    def __init__(self):
        self.requests = 0

    def text(self, path):
        self.requests += 1
        assert path == "/whats-on/"
        return PAGE + PAGE  # the site's mobile/desktop duplication


def performance(id, url):
    return {
        "ID": id,
        "URL": url,
        "StartDate": "2026-11-20",
        "StartTime": "2030",
        "AuditoriumName": "Screen 1",
        "AuditoriumID": 1,
        "QA": "Y",
        "HoH": "Y",
        "IsSoldOut": "N",
        "IsOpenForSale": True,
    }


class Opus:
    def __init__(self):
        self.requests = 0
        self.shows = [
            performance(1, rio.CINEMA["booking_prefix"] + "1.TcsSection_5"),
            performance(2, "https://tickets.example/event/2"),
        ]

    def text(self, path):
        self.requests += 1
        return (
            "var Events = "
            + json.dumps(
                {
                    "Events": [
                        {
                            "ID": 42,
                            "Title": "Film &amp; Sequel",
                            "Rating": '<img alt="BBFC Rating: (15)">',
                            "RunningTime": 90,
                            "Director": "A Director",
                            "Tags": [{"Format": "35mm"}],
                            "Performances": self.shows,
                        }
                    ]
                }
            )
            + ";"
        )


class RepertoryTest(unittest.TestCase):
    def test_yearless_headings_keep_yesterdays_december_in_the_previous_year(self):
        self.assertEqual(
            listing_day("Thursday 31st December", date(2027, 1, 1)), date(2026, 12, 31)
        )
        self.assertEqual(listing_day("Friday 1st January", TODAY), date(2027, 1, 1))

    def test_prince_charles_retains_sold_out_showings_in_one_programme_request(self):
        client = PCC()
        data = princecharles.collect(client, TODAY)
        self.assertEqual(client.requests, 1)
        self.assertEqual(len(data["films"]), 1)
        self.assertEqual(len(data["screenings"]), 2)
        show, sold = data["screenings"]
        self.assertEqual(
            (show["time"], show["starts_at"]), ("21:00", "2026-11-20T21:00:00Z")
        )
        self.assertEqual(sold["sold_out"], 1)
        self.assertIsNone(sold["booking_url"])
        self.assertEqual(data["films"][0]["runtime"], 92)
        self.assertEqual(show["experiences"], ["35mm"])

    def test_repertory_check_is_weekly_even_without_next_thursday_showings(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "pcc.sqlite")
            self.assertEqual(princecharles.check(path, NOW, PCC()), "ingested")
            with connect(path) as db:
                db.execute(
                    "UPDATE runs SET finished_at = ? WHERE status = 'ok'",
                    (NOW.isoformat(),),
                )
            client = PCC()
            self.assertEqual(princecharles.check(path, NOW, client), "done")
            self.assertEqual(client.requests, 0)
            self.assertIsNone(princecharles.settled_reason(path, date(2026, 11, 25)))

    def test_opus_publishes_a_complete_feed_in_one_request_including_external_tickets(
        self,
    ):
        client = Opus()
        data = rio.collect(client, TODAY)
        self.assertEqual(client.requests, 1)
        self.assertEqual(data["films"][0]["title"], "Film & Sequel")
        self.assertEqual(data["screenings"][0]["experiences"], ["QA", "HoH", "35mm"])
        self.assertEqual(data["screenings"][0]["id"], "1.TcsSection_5")
        self.assertEqual(
            data["screenings"][1]["booking_url"], "https://tickets.example/event/2"
        )
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "rio.sqlite")
            rio.ingest(path, TODAY, Opus())
            with connect(path) as db:
                self.assertEqual(
                    db.execute("SELECT * FROM screening_links").fetchall(),
                    [("rio", "2", "https://tickets.example/event/2")],
                )

    def test_opus_venues_share_collection_without_sharing_their_identity(self):
        data = actone.collect(Opus(), TODAY)
        self.assertEqual(data["cinemas"][0]["id"], "actone")
        self.assertEqual({row["cinema_id"] for row in data["screenings"]}, {"actone"})
        client = Opus()
        client.shows[0]["URL"] = "javascript:alert(1)"
        self.assertRaises(RuntimeError, rio.collect, client, TODAY)
