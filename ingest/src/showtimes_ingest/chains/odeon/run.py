"""ODEON's weekly ingest: fetch everything, then replace the listings in one go."""

import re
from collections import defaultdict

from showtimes_ingest.chains.odeon.api import API
from showtimes_ingest.chains.odeon.collect import (
    collect,
    configured_sites,
    now,
    release_week,
)
from showtimes_ingest.log import log
from showtimes_ingest.store import (
    MAX_FAILURES,
    connect,
    failures_since,
    finish_run,
    get_state,
    last_success,
    start_run,
    stored_cinemas,
    write,
)

NAME = "odeon"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


def scope_changed(path):
    """Whether the stored cinema coverage differs from the configured scope."""
    with connect(path) as db:
        cinemas = dict(db.execute("SELECT id, stored FROM cinemas").fetchall())
    if not cinemas:
        return False  # The normal first-run check fills an empty database.
    stored = {cinema for cinema, kept in cinemas.items() if kept}
    return stored != (configured_sites() or set(cinemas))


def layout_capacity(layout):
    """Seats in a seat layout (every listed seat, in every area)."""
    return sum(
        len(row.get("seats", []))
        for area in layout["seatLayout"].get("areas", [])
        for row in area.get("rows", [])
    )


def store_screen_sizes(path, api, screenings):
    """One layout request for each screen whose size is not stored yet.

    A layout that cannot be fetched is reported, not fatal: the schedule is
    already stored and the next ingest asks again.
    """
    layouts = defaultdict(set)
    for row in screenings:
        if row["layout_id"]:
            layouts[(row["cinema_id"], row["screen_id"])].add(row["layout_id"])
    with connect(path) as db:
        known = set(db.execute("SELECT cinema_id, screen_id FROM screens"))
    stored, failed = 0, 0
    for screen in sorted(set(layouts) - known):
        layout = min(layouts[screen])
        try:
            if not IDENTIFIER.fullmatch(layout):
                raise RuntimeError("Invalid seat-layout identifier")
            capacity = layout_capacity(api.get(f"seat-layouts/{layout}"))
        except (RuntimeError, KeyError) as error:
            failed += 1
            log.warning("seat layout %s not stored: %s", layout, error)
            continue
        with connect(path) as db:
            db.execute(
                "INSERT INTO screens VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                (*screen, capacity),
            )
        stored += 1
    return stored, failed


def ingest(path=None, today=None, api=None):
    api = api or API()
    run_id = start_run(path, NAME)
    log.info("ingest %d started", run_id)
    today = today or now().date()
    tuesday, last_day = release_week(today)
    try:
        data = collect(api, today)
        with connect(path) as db:
            write(db, data)
            # Keep release status consistent with the newly stored coverage.
            if any(row["business_date"] == str(last_day) for row in data["screenings"]):
                db.execute(
                    "INSERT INTO state VALUES ('release_week', ?)"
                    " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                    (str(tuesday),),
                )
            else:
                db.execute(
                    "DELETE FROM state WHERE key = 'release_week' AND value = ?",
                    (str(tuesday),),
                )
        stored, failed = store_screen_sizes(path, api, data["screenings"])
    except Exception as error:
        finish_run(path, run_id, "failed", api.requests, str(error)[:500])
        log.error("ingest %d failed: %s", run_id, error)
        raise
    finish_run(path, run_id, "ok", api.requests)
    summary = {
        "run": run_id,
        "requests": api.requests,
        "cinemas": len(data["cinemas"]),
        "films": len(data["films"]),
        "screenings": len(data["screenings"]),
        "screens_sized": stored,
        "screens_failed": failed,
    }
    log.info("ingest %d finished: %s", run_id, summary)
    return summary


def settled_reason(path=None, today=None):
    """Why a check would not contact ODEON right now, or None when it would."""
    tuesday, _ = release_week(today or now().date())
    if get_state(path, "release_week") == str(tuesday) and not scope_changed(path):
        return "done"
    if failures_since(path, NAME, str(tuesday)) >= MAX_FAILURES:
        log.warning("ingest paused after %d failures; run it manually", MAX_FAILURES)
        return "paused"
    return None


def check(path=None, moment=None, api=None):
    """One scheduled check: ingest once per ODEON release week.

    ODEON publishes Friday–Thursday listings on Tuesdays. Until this week's are
    stored, each check costs one request (is the last Thursday published yet?);
    afterwards it costs none until the next Tuesday. An empty database is filled
    straight away with whatever is published.
    """
    today = (moment or now()).date()
    tuesday, last_day = release_week(today)
    settled = settled_reason(path, today)
    if settled:
        return settled
    api = api or API()
    # Backfill a changed scope even when the next release has not appeared yet.
    if scope_changed(path):
        ingest(path, today, api)
        return "ingested"
    # ODEON refuses a showtimes request that names no cinema, so with no
    # configured scope ask about the stored ones. With none stored either, the
    # database is empty: fill it with whatever is published.
    sites = configured_sites() or stored_cinemas(path)
    if not sites:
        ingest(path, today, api)
        return "ingested"
    params = [("siteIds", site) for site in sorted(sites)]
    try:
        probe = api.get(f"showtimes/by-business-date/{last_day}", params)
    except RuntimeError as error:
        finish_run(
            path, start_run(path, NAME), "failed", api.requests, str(error)[:500]
        )
        log.error("release check failed: %s", error)
        raise
    if not probe.get("showtimes") and last_success(path, NAME):
        log.info("week of %s not published yet (nothing on %s)", tuesday, last_day)
        return "waiting"
    ingest(path, today, api)
    return "ingested"
