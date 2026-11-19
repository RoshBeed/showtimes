"""IMDb and Metacritic scores.

OMDb (omdbapi.com) identifies each film and supplies its Metacritic score where
it has one. (Rotten Tomatoes has no open data source and OMDb rarely has it.)
IMDb scores come from IMDb's own daily ratings file, because OMDb's copy lags
far behind for new releases. The OMDb key is only ever placed in the request
URL, never stored, logged or put in errors.
"""

import csv
import gzip
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from showtimes_ingest.log import log

OMDB_URL = "https://www.omdbapi.com/"
# Errors that will repeat for every film: stop asking for this session.
FATAL = {"Invalid API key!", "No API key provided.", "Request limit reached!"}
# IMDb's non-commercial datasets: https://developer.imdb.com/non-commercial-datasets/
IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
WEEK = 7 * 24 * 60 * 60


def search_title(title):
    """A cinema's title as a film database knows it, without the marks and
    bracketed notes cinemas add: "Ramayana (Hindi)" -> "Ramayana",
    "THE SNOWMAN™" -> "THE SNOWMAN". A chain strips its own additions first.
    """
    title = re.sub(r"[™®©]", "", title)
    return re.sub(r"(\s*\([^)]*\))+\s*$", "", title).strip()


def normalise(title):
    """Case, accents and punctuation removed, for comparing titles."""
    text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def same_film(wanted, found):
    """OMDb's title search is loose ("Rocky" can return "I Play Rocky"): accept
    the same title, or the same title followed by a subtitle after a colon."""
    return normalise(found) == normalise(wanted) or (
        ":" in found and normalise(found.split(":")[0]) == normalise(wanted)
    )


def scores(data):
    """{"imdb": 7.4, "metacritic": 81, "imdb_id": "tt…"} from an OMDb response."""
    imdb, meta = data.get("imdbRating"), data.get("Metascore")
    return {
        "imdb": float(imdb) if imdb and imdb != "N/A" else None,
        "metacritic": int(meta) if meta and meta.isdigit() else None,
        "imdb_id": data.get("imdbID"),
    }


class IMDbRatings:
    """IMDb's official ratings file, re-downloaded at most once a week.

    The file lists ~1.7 million titles; holding it all would cost ~250 MB. It is
    streamed instead, keeping only the IDs asked for, and answers are remembered
    for the rest of the run.
    """

    def __init__(self, path):
        self.path, self.known, self.checked = path, {}, False

    def ratings_for(self, imdb_ids):
        """{imdb_id: rating or None} for the given IDs, in one pass of the file."""
        wanted = {i for i in imdb_ids if i and i not in self.known}
        if wanted:
            found = self.scan(wanted)
            self.known.update({i: found.get(i) for i in wanted})
        return {i: self.known[i] for i in imdb_ids if i}

    def scan(self, wanted):
        if not self.checked:  # at most one freshness check (and download) per run
            self.checked = True
            if not self.path.exists() or time.time() - self.path.stat().st_mtime > WEEK:
                self.download()
        if not self.path.exists():
            return {}
        found, remaining = {}, set(wanted)
        with gzip.open(self.path, "rt", newline="") as data:
            rows = csv.reader(data, delimiter="\t")
            next(rows, None)  # header: tconst, averageRating, numVotes
            for row in rows:
                if row[0] in remaining:
                    found[row[0]] = float(row[1])
                    remaining.discard(row[0])
                    if not remaining:
                        break
        return found

    def download(self):
        partial = self.path.with_suffix(".part")
        try:
            urllib.request.urlretrieve(IMDB_RATINGS_URL, partial)
            partial.replace(self.path)
            log.info("downloaded IMDb ratings (%d bytes)", self.path.stat().st_size)
        except (urllib.error.URLError, OSError) as error:
            # An older copy is still better than none; without one, fall back
            # to OMDb's own (often missing) IMDb scores.
            log.warning("IMDb ratings download failed: %s", error)
            partial.unlink(missing_ok=True)


class OMDb:
    def __init__(self, key):
        self.key, self.stopped, self.requests = key, None, 0

    def lookup(self, title, release_date=None):
        """Scores for a film, or None if OMDb has no match.

        Tries the release year first (the cinema's UK date), then any year, which
        catches re-releases such as anniversary screenings.
        """
        name = search_title(title)  # after the chain's own clean-up
        years = [release_date[:4]] if release_date else []
        for year in [*years, None]:
            params = [("t", name)] + ([("y", year)] if year else [])
            self.requests += 1
            data = self.fetch(params)
            if data.get("Response") == "True" and same_film(
                name, data.get("Title", "")
            ):
                return scores(data)
        return None

    def fetch(self, params):
        if self.stopped:
            raise RuntimeError(f"OMDb disabled for this session: {self.stopped}")
        query = urllib.parse.urlencode(
            [*params, ("type", "movie"), ("apikey", self.key)]
        )
        label = " ".join(value for _, value in params)
        try:
            with urllib.request.urlopen(f"{OMDB_URL}?{query}", timeout=15) as reply:
                data = json.load(reply)
        except urllib.error.HTTPError as error:  # str() holds no URL
            data = self.error_body(error)
        except (urllib.error.URLError, OSError, ValueError) as error:
            reason = getattr(error, "reason", type(error).__name__)
            log.warning("OMDb lookup %s failed: %s", label, reason)
            raise RuntimeError(f"OMDb lookup failed: {reason}") from None
        if data.get("Error") in FATAL:
            self.stopped = data["Error"]
            log.warning("OMDb stopped: %s", self.stopped)
            raise RuntimeError(f"OMDb: {self.stopped}")
        log.info("OMDb lookup %s: %s", label, data.get("Response"))
        return data

    def error_body(self, error):
        """OMDb answers bad keys with HTTP 401 and a JSON error body."""
        try:
            return json.loads(error.read() or b"{}")
        except ValueError:
            raise RuntimeError(f"OMDb returned HTTP {error.code}") from None
