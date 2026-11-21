"""The SQLite file the site downloads and queries in the browser.

It is also the ingest's only state between runs: which release week is
stored, the run history, and each screen's size (fetched once per screen).
Lists are stored as JSON text. Times are UTC so that text order is time order.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS cinemas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    -- Whether its screenings are stored (a chain may fetch only some cinemas).
    stored INTEGER NOT NULL,
    address TEXT NOT NULL,
    latitude REAL,
    longitude REAL
);
CREATE TABLE IF NOT EXISTS films (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    runtime INTEGER,
    certificate TEXT NOT NULL,
    release_date TEXT,
    genres TEXT NOT NULL,
    people TEXT NOT NULL,
    distributor TEXT NOT NULL,
    synopsis TEXT NOT NULL,
    trailer_url TEXT
);
-- Now showing / coming soon / advance booking, per cinema and film.
CREATE TABLE IF NOT EXISTS availability (
    cinema_id TEXT NOT NULL,
    film_id TEXT NOT NULL,
    categories TEXT NOT NULL,
    PRIMARY KEY (cinema_id, film_id)
);
CREATE TABLE IF NOT EXISTS screenings (
    cinema_id TEXT NOT NULL,
    id TEXT NOT NULL,
    film_id TEXT NOT NULL,
    business_date TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    -- The advertised start in London time, HH:MM, as the site shows it.
    time TEXT NOT NULL,
    film_starts_at TEXT,
    film_ends_at TEXT,
    screen TEXT NOT NULL,
    screen_id TEXT NOT NULL,
    experiences TEXT NOT NULL,
    seating TEXT NOT NULL,
    sold_out INTEGER,
    PRIMARY KEY (cinema_id, id)
);
CREATE INDEX IF NOT EXISTS screenings_by_date ON screenings (business_date, cinema_id);
CREATE INDEX IF NOT EXISTS screenings_by_film ON screenings (film_id);
-- Only overrides: external ticket sellers, or an explicitly unavailable link.
-- Older release assets need no rewrite; the site also reads files without this table.
CREATE TABLE IF NOT EXISTS screening_links (
    cinema_id TEXT NOT NULL,
    screening_id TEXT NOT NULL,
    url TEXT,
    PRIMARY KEY (cinema_id, screening_id)
);
-- Seats per screen. Fetched once; a screen's size does not change.
CREATE TABLE IF NOT EXISTS screens (
    cinema_id TEXT NOT NULL,
    screen_id TEXT NOT NULL,
    capacity INTEGER NOT NULL,
    PRIMARY KEY (cinema_id, screen_id)
);
CREATE TABLE IF NOT EXISTS ratings (
    film_id TEXT NOT NULL,
    source TEXT NOT NULL,
    score REAL,
    external_id TEXT,
    PRIMARY KEY (film_id, source)
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    requests INTEGER,
    error TEXT
);
CREATE TABLE IF NOT EXISTS state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


# After this many failed runs in a release week, a check waits for a manual run.
MAX_FAILURES = 3


def utc(moment=None):
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@contextmanager
def connect(path=None):
    """One transaction on the database: committed on success, then closed."""
    path = path or os.environ.get("SHOWTIMES_DATABASE")
    if not path:
        raise RuntimeError(
            "Set SHOWTIMES_DATABASE to the path of the chain's SQLite file"
        )
    try:
        db = sqlite3.connect(path)
        db.executescript(SCHEMA)
    except sqlite3.OperationalError as error:
        raise RuntimeError(f"Cannot open the database {path}: {error}") from None
    try:
        yield db
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def start_run(path, source):
    with connect(path) as db:
        return db.execute(
            "INSERT INTO runs (source, started_at) VALUES (?, ?)", (source, utc())
        ).lastrowid


def finish_run(path, run_id, status, requests, error=None):
    with connect(path) as db:
        db.execute(
            "UPDATE runs SET finished_at = ?, status = ?, requests = ?, error = ?"
            " WHERE id = ?",
            (utc(), status, requests, error, run_id),
        )


def failures_since(path, source, since):
    """Failed runs of a source since a moment: the brake on automatic attempts."""
    with connect(path) as db:
        return db.execute(
            "SELECT count(*) FROM runs"
            " WHERE source = ? AND status = 'failed' AND started_at >= ?",
            (source, since),
        ).fetchone()[0]


def last_success(path, source):
    with connect(path) as db:
        return db.execute(
            "SELECT max(finished_at) FROM runs WHERE source = ? AND status = 'ok'",
            (source,),
        ).fetchone()[0]


def get_state(path, key):
    with connect(path) as db:
        row = db.execute("SELECT value FROM state WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def stored_cinemas(path):
    with connect(path) as db:
        return {row[0] for row in db.execute("SELECT id FROM cinemas WHERE stored")}


def write(db, data):
    """Replace the listings. Runs inside the caller's transaction."""
    for table in ("screening_links", "screenings", "availability", "films", "cinemas"):
        db.execute(f"DELETE FROM {table}")
    db.executemany(
        "INSERT INTO cinemas VALUES (:id, :name, :stored, :address, :latitude,"
        " :longitude)",
        [dict(row, address=json.dumps(row["address"])) for row in data["cinemas"]],
    )
    db.executemany(
        "INSERT INTO films VALUES (:id, :title, :runtime, :certificate,"
        " :release_date, :genres, :people, :distributor, :synopsis, :trailer_url)",
        [
            dict(
                row,
                genres=json.dumps(row["genres"], ensure_ascii=False),
                people=json.dumps(row["people"], ensure_ascii=False),
            )
            for row in data["films"]
        ],
    )
    db.executemany(
        "INSERT INTO availability VALUES (?, ?, ?)",
        [
            (cinema, film, json.dumps(categories))
            for (cinema, film), categories in data["availability"].items()
        ],
    )
    db.executemany(
        "INSERT INTO screenings VALUES (:cinema_id, :id, :film_id, :business_date,"
        " :starts_at, :time, :film_starts_at, :film_ends_at, :screen, :screen_id,"
        " :experiences, :seating, :sold_out)",
        [
            {
                **{k: v for k, v in row.items() if k != "layout_id"},
                "experiences": json.dumps(row["experiences"], ensure_ascii=False),
                "seating": json.dumps(row["seating"], ensure_ascii=False),
            }
            for row in data["screenings"]
        ],
    )
    db.executemany(
        "INSERT INTO screening_links VALUES (?, ?, ?)",
        [
            (row["cinema_id"], row["id"], row["booking_url"])
            for row in data["screenings"]
            if "booking_url" in row
        ],
    )
