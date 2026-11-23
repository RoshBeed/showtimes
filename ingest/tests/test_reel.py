import tempfile
import unittest
from datetime import date
from pathlib import Path

from showtimes_ingest.chains import jacro, reel
from showtimes_ingest.chains.pages import parse
from showtimes_ingest.http import NotFound
from showtimes_ingest.store import connect

TODAY = date(2026, 11, 19)
DIRECTORY = """<select id="cinemaSelect">
  <option value="">Choose a location</option>
  <option value="https://reelcinemas.co.uk/chorley/">Chorley</option>
  <option value="https://future.reelcinemas.co.uk/future">A future site</option>
</select>"""
FILMS = """<div class="nowshowingslider_20261126">
  <a href="https://reelcinemas.co.uk/chorley/film/123/a-film/">A Film</a>
  <a href="https://reelcinemas.co.uk/chorley/film/123/a-film/">A Film again</a>
</div>"""
MOVIE = """<h1>A Film &amp; Sequel</h1><div class="plot"><p>The plot.</p>
 <ul class="movie-info"><li><i>Running time</i> 99 mins</li>
 <li><i>Rating</i> 15</li><li><i>Released</i> 2026-11-20</li>
 <li><i>Directed by</i> A Director</li><li><i>Genre</i> Drama</li></ul></div>
 <div class="date-row"><span>Friday, 20th November</span>
 <div class="singlefilmperfs"><div class="perfmods">
   <a class="show_time_in" href="https://reelcinemas.co.uk/chorley/booknow/777/">20:30</a>
   <div class="show_time_label">Lounge</div></div>
   <div class="popup-details">
     <p><span>Screen:</span><span>Screen 2</span></p>
     <p><span>2D / 3D:</span><span>3D</span></p>
     <p><span>Subtitled:</span><span>Yes</span></p>
     <a href="https://reelcinemas.co.uk/chorley/booknow/777">BOOK NOW</a>
   </div></div></div>"""


class ReelSite:
    def __init__(self):
        self.requests = 0

    def text(self, path):
        self.requests += 1
        return {
            "/": DIRECTORY,
            "https://reelcinemas.co.uk/chorley/": FILMS,
            "https://reelcinemas.co.uk/chorley/film/123/a-film/": MOVIE,
        }[path]


class ReelTest(unittest.TestCase):
    def test_reel_imports_published_records_and_marks_unrecognised_sites_not_stored(
        self,
    ):
        client = ReelSite()
        data = reel.collect(client, TODAY)
        self.assertEqual(client.requests, 3)  # repeated film links fetched once
        self.assertEqual([row["stored"] for row in data["cinemas"]], [True, False])
        film = data["films"][0]
        self.assertEqual(
            (film["id"], film["title"], film["runtime"]),
            ("chorley/123", "A Film & Sequel", 99),
        )
        self.assertEqual(film["synopsis"], "The plot.")
        self.assertEqual(
            film["people"], [{"name": "A Director", "roles": ["Director"]}]
        )
        self.assertEqual(
            len(data["screenings"]), 1
        )  # popup's Book link isn't another showing
        show = data["screenings"][0]
        self.assertEqual(
            (show["id"], show["screen"], show["starts_at"]),
            ("777", "Screen 2", "2026-11-20T20:30:00Z"),
        )
        self.assertEqual(show["experiences"], ["Lounge", "3D", "Subtitled"])
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "reel.sqlite")
            reel.ingest(path, TODAY, ReelSite())
            with connect(path) as db:
                self.assertEqual(
                    db.execute("SELECT cinema_id, id FROM screenings").fetchall(),
                    [("chorley", "777")],
                )

    def test_dates_use_the_printed_weekday_to_distinguish_next_years_advance_bookings(
        self,
    ):
        self.assertEqual(
            jacro.listing_day("Sunday, 30th May", TODAY), date(2027, 5, 30)
        )
        self.assertEqual(
            jacro.listing_day("Friday, 1st January", TODAY), date(2027, 1, 1)
        )
        root = parse(MOVIE.replace("Friday, 20th November", "Wednesday, 1st July"))
        _, shows = reel.movie_page(
            root,
            "chorley",
            "https://reelcinemas.co.uk/chorley/film/123/a-film/",
            date(2026, 7, 1),
        )
        self.assertEqual(shows[0]["starts_at"], "2026-07-01T19:30:00Z")

    def test_a_film_page_that_is_gone_is_skipped_like_a_withdrawn_film(self):
        gone = "https://reelcinemas.co.uk/chorley/film/456/gone/"

        class GoneFilm(ReelSite):
            def text(self, path):
                if path == gone:
                    self.requests += 1
                    raise NotFound(f"HTTP 404 from {path}")
                if path == "https://reelcinemas.co.uk/chorley/":
                    self.requests += 1
                    return FILMS.replace("</div>", f'<a href="{gone}">Gone</a></div>')
                return super().text(path)

        data = reel.collect(GoneFilm(), TODAY)
        self.assertEqual([film["id"] for film in data["films"]], ["chorley/123"])
        self.assertEqual(len(data["screenings"]), 1)

    def test_a_film_the_cinema_no_longer_shows_is_skipped(self):
        root = parse(
            "<header><h2>Film not available here</h2></header>"
            "<p>Sorry, Reel Chorley is not showing A Film.</p>"
        )
        url = "https://reelcinemas.co.uk/chorley/film/123/a-film/"
        self.assertIsNone(reel.movie_page(root, "chorley", url, TODAY))

    def test_missing_film_and_unexpected_ticket_links_fail_instead_of_dropping_showings(
        self,
    ):
        url = "https://reelcinemas.co.uk/chorley/film/123/a-film/"
        self.assertRaises(
            RuntimeError, reel.movie_page, parse("Changed page"), "chorley", url, TODAY
        )
        root = parse(
            MOVIE.replace("/chorley/booknow/777/", "/wrong-cinema/booknow/777/")
        )
        self.assertRaisesRegex(
            RuntimeError,
            "unexpected booking",
            reel.movie_page,
            root,
            "chorley",
            url,
            TODAY,
        )
