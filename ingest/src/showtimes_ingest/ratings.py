"""IMDb and Metacritic scores for the films in a chain's file, once after each
of its ingests. The same for every chain: OMDb finds the film, IMDb's own
ratings file gives the fresher score."""

import os
import tempfile
from pathlib import Path

from showtimes_ingest.log import log
from showtimes_ingest.scores import IMDbRatings, OMDb
from showtimes_ingest.store import (
    MAX_FAILURES,
    connect,
    failures_since,
    finish_run,
    last_success,
    start_run,
)


def ingest_ratings(chain, path=None, key=None):
    """IMDb and Metacritic scores for the films a chain lists."""
    key = key or os.environ.get("OMDB_API_KEY", "").strip()
    if not key:
        raise RuntimeError("Set OMDB_API_KEY for the ratings ingest")
    run_id = start_run(path, "ratings")
    omdb = OMDb(key)
    try:
        with connect(path) as db:
            films = db.execute(
                "SELECT id, title, release_date FROM films"
                " WHERE id IN (SELECT film_id FROM availability)"
            ).fetchall()
        found, failed = {}, 0
        for film_id, title, release in films:
            try:
                scores = omdb.lookup(chain.search_title(title), release)
            except RuntimeError:
                if omdb.stopped:  # bad key or quota: every further film would fail
                    raise
                failed += 1  # one film's lookup; already logged by OMDb.fetch
                continue
            if scores:
                found[film_id] = scores
        # IMDb's own file is fresher than OMDb's copy of the IMDb score.
        with tempfile.TemporaryDirectory() as directory:
            imdb = IMDbRatings(Path(directory) / "imdb-ratings.tsv.gz").ratings_for(
                {scores["imdb_id"] for scores in found.values()}
            )
        rows = []
        for film_id, scores in found.items():
            score = imdb.get(scores["imdb_id"]) or scores["imdb"]
            rows.append((film_id, "imdb", score, scores["imdb_id"]))
            rows.append((film_id, "metacritic", scores["metacritic"], None))
        with connect(path) as db:
            db.executemany(
                "INSERT INTO ratings VALUES (?, ?, ?, ?)"
                " ON CONFLICT (film_id, source) DO UPDATE"
                " SET score = excluded.score, external_id = excluded.external_id",
                rows,
            )
    except Exception as error:
        finish_run(path, run_id, "failed", omdb.requests, str(error)[:500])
        log.error("ratings ingest %d failed: %s", run_id, error)
        raise
    finish_run(path, run_id, "ok", omdb.requests)
    summary = {
        "run": run_id,
        "requests": omdb.requests,
        "films": len(films),
        "rated": len(found),
        "lookups_failed": failed,
    }
    log.info("ratings ingest %d finished: %s", run_id, summary)
    return summary


def check_ratings(chain, path=None):
    """Rate the films once after each of the chain's ingests."""
    if not os.environ.get("OMDB_API_KEY", "").strip():
        return "disabled"  # ratings are optional; listings work without them
    listings = last_success(path, chain.NAME)
    if not listings:
        return "waiting"
    rated = last_success(path, "ratings")
    if rated and rated >= listings:
        return "done"
    if failures_since(path, "ratings", listings) >= MAX_FAILURES:
        log.warning("ratings paused after %d failures; run it manually", MAX_FAILURES)
        return "paused"
    ingest_ratings(chain, path)
    return "ingested"
