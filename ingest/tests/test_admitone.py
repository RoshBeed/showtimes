import io
import unittest
from datetime import date
from email.message import Message
from unittest.mock import patch

from showtimes_ingest.chains import admitone, reel
from showtimes_ingest.http import Client

TODAY = date(2026, 11, 19)
FILM = '<div><div><h2><a href="/hull/event/42/new-slug">A Film - Subtitled Screening</a></h2><img src="/ratings/UK/15lrg.png"><p>Running time: 90 mins</p></div></div>'
MOVIE = (
    '<button class="tab" data-target="0">Tomorrow</button><button class="tab" data-target="1">Fri 1 Jan</button>'
    + '<div id="panel0">'
    + FILM
    + '<a class="perfButton" href="/hull/booking/123/a-film">20:30</a><p class="font-semibold">Movie Madness</p><a class="perfButton" href="/hull/booking/124/a-film">21:00</a></div><div id="panel1">'
    + FILM
    + '<a class="perfButton" href="/hull/booking/125/a-film">12:00</a></div>'
)


class Site:
    def __init__(self):
        self.requests, self.paths = 0, []

    def text(self, path):
        self.requests += 1
        self.paths.append(path)
        assert path.endswith("/hull/whatson")
        return MOVIE


class AdmitOneTest(unittest.TestCase):
    def test_reads_every_date_panel_and_deduplicates_bookings(self):
        movies, shows = admitone.programme(MOVIE, "hull", TODAY)
        movie = movies[0]
        self.assertEqual(
            (movie["id"], movie["runtime"], movie["certificate"]), ("hull/42", 90, "15")
        )
        self.assertEqual(
            [s["business_date"] for s in shows],
            ["2026-11-20", "2026-11-20", "2027-01-01"],
        )
        self.assertEqual(shows[1]["experiences"], ["Movie Madness", "Subtitled"])
        self.assertEqual(reel.search_title(movie["title"]), "A Film")
        # Mobile repeats the first normal showing after the category heading.
        repeated = MOVIE.replace(
            '</div><div id="panel1">',
            '<a class="perfButton" href="/hull/booking/123/a-film">20:30</a></div><div id="panel1">',
        )
        _, shows = admitone.programme(repeated, "hull", TODAY)
        self.assertEqual(shows[0]["experiences"], ["Subtitled"])

    def test_reel_combines_its_two_platforms_without_skipping_older_cinemas(self):
        client = Site()
        with patch.object(
            reel._source,
            "directory",
            return_value=[
                {
                    "id": "hull",
                    "name": "Hull",
                    "url": "https://hull.reelcinemas.co.uk/hull",
                    "stored": True,
                }
            ],
        ):
            data = reel.collect(client, TODAY)
        self.assertTrue(data["cinemas"][0]["stored"])
        self.assertEqual(len(data["screenings"]), 3)
        self.assertEqual(client.requests, 1)
        self.assertFalse(any("/booking/" in path for path in client.paths))

    def test_http_reads_the_declared_legacy_html_charset_as_a_browser_does(self):
        class Reply(io.BytesIO):
            headers = Message()

        Reply.headers["Content-Type"] = "text/html; charset=ISO-8859-1"
        with patch(
            "urllib.request.urlopen", return_value=Reply(b"Andr\xe9 Rieu\x92s film")
        ):
            self.assertEqual(
                Client("https://example.test", pause=0).text("/"), "André Rieu’s film"
            )
