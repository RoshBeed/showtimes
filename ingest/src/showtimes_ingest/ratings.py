"""IMDb and Metacritic scores, looked up once per film across every chain.

Publish runs this after Claude has cleaned the titles: each film is known by its clean
title and the year the title gives, so a film shown by five chains, or listed once per
format, is looked up once. OMDb identifies it (and gives its Metacritic score); IMDb's own
ratings file, read again at each run, gives the fresher IMDb score. <folder>/ratings.json on
the data release keeps both halves: "films", what OMDb said of each film (so OMDb is asked only
about films it has not seen, and again about one it did not find after four weeks), and
"titles", each raw title as the chains list it with its film's scores, which the export reads
just as it reads titles.json, with no key of its own to keep in step.

    showtimes-ratings <folder> [overrides.json]
"""

import json
import os
import sqlite3
import sys
import tempfile
import unicodedata
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

from showtimes_ingest.chains import CHAINS
from showtimes_ingest.log import log
from showtimes_ingest.scores import IMDbRatings, OMDb, search_title

RETRY_MISSING = timedelta(weeks=4)


def title_key(title):
    """A film's clean title with case, accents, punctuation and spacing set aside."""
    text = unicodedata.normalize("NFD", title.lower())
    return "".join(
        c for c in text if c.isalnum() and not unicodedata.category(c).startswith("M")
    )


def film_key(title, year):
    """One film for OMDb: its clean title, and the year the title gives (remakes apart)."""
    return f"{title_key(title)}|{year or ''}"


def films(folder, titles):
    """{key: (title to search, release date)} for every film a chain's file lists now, and
    {raw title: key} for every title naming one."""
    found, named = {}, {}
    for path in sorted(Path(folder).glob("*.sqlite")):
        chain = CHAINS.get(path.stem)
        if chain is None:
            continue
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as db:
            rows = db.execute(
                "SELECT title, release_date FROM films"
                " WHERE id IN (SELECT film_id FROM availability)"
            ).fetchall()
        for raw, release in rows:
            cleaned = titles.get(raw)
            title = cleaned["title"] if cleaned else chain.search_title(raw)
            key = film_key(title, cleaned and cleaned.get("year"))
            if not title_key(title):
                continue
            named[raw] = key
            if key not in found:
                year = cleaned and cleaned.get("year")
                found[key] = (title, f"{year}-01-01" if year else release)
    return found, named


def rate(folder, key, overrides=None, today=None, omdb=None, imdb=None):
    """Updates <folder>/ratings.json; returns a summary."""
    folder, today = Path(folder), today or date.today()
    titles = (
        json.loads((folder / "titles.json").read_text())
        if (folder / "titles.json").exists()
        else {}
    )
    if overrides and Path(overrides).exists():
        titles.update(json.loads(Path(overrides).read_text()))
    path = folder / "ratings.json"
    known = json.loads(path.read_text()).get("films", {}) if path.exists() else {}
    listed, named = films(folder, titles)
    omdb = omdb or OMDb(key)
    asked = failed = 0
    for film, (title, release) in sorted(listed.items()):
        entry = known.get(film)
        if entry and (
            entry["imdb_id"]
            or today - date.fromisoformat(entry["checked"]) < RETRY_MISSING
        ):
            continue
        try:
            scores = omdb.lookup(search_title(title), release)
        except RuntimeError as error:
            if omdb.stopped:  # a bad key or the day's quota: keep what was found
                log.warning("OMDb stopped after %d lookups: %s", asked, error)
                break
            failed += 1
            continue
        asked += 1
        known[film] = {
            "title": title,
            "imdb_id": scores and scores["imdb_id"],
            "imdb": scores and scores["imdb"],
            "metacritic": scores and scores["metacritic"],
            "checked": today.isoformat(),
        }
    # IMDb's own file is fresher than OMDb's copy of the IMDb score.
    ids = {
        known[film]["imdb_id"]
        for film in listed
        if film in known and known[film]["imdb_id"]
    }
    with tempfile.TemporaryDirectory() as directory:
        fresh = (
            imdb or IMDbRatings(Path(directory) / "imdb-ratings.tsv.gz")
        ).ratings_for(ids)
    for entry in known.values():
        if fresh.get(entry["imdb_id"]) is not None:
            entry["imdb"] = fresh[entry["imdb_id"]]
    scored = {
        raw: {field: known[film][field] for field in ("imdb_id", "imdb", "metacritic")}
        for raw, film in named.items()
        if known.get(film, {}).get("imdb_id")
    }
    text = json.dumps(
        {"films": known, "titles": scored}, ensure_ascii=False, indent=1, sort_keys=True
    )
    changed = not path.exists() or path.read_text() != text
    path.write_text(text)
    summary = {
        "films": len(listed),
        "asked": asked,
        "failed": failed,
        "rated": sum(1 for film in listed if known.get(film, {}).get("imdb_id")),
        "stopped": omdb.stopped or None,
    }
    log.info("ratings: %s", summary)
    return summary, changed


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print(__doc__.strip().splitlines()[-1].strip(), file=sys.stderr)
        return 2
    key = os.environ.get("OMDB_API_KEY", "").strip()
    if not key:
        print("No OMDB_API_KEY: ratings stay as they are.")
        print("changed=false")
        return 0
    summary, changed = rate(args[0], key, args[1] if len(args) > 1 else None)
    print(json.dumps(summary))
    print(f"changed={'true' if changed else 'false'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
