"""Shared collection lifecycle: refresh windows, atomic writes and run health."""

import json
from datetime import datetime

from showtimes_ingest.log import log
from showtimes_ingest.policy import GRACE, as_moment, windows
from showtimes_ingest.store import (
    MAX_FAILURES,
    connect,
    failures_since,
    finish_run,
    last_success,
    start_run,
    utc,
    write,
)
from showtimes_ingest.week import now


def ingest(path, name, collect, client, today=None, after_store=None):
    run_id = start_run(path, name)
    log.info("%s ingest %d started", name, run_id)
    today = today or now().date()
    extra = {}
    try:
        with connect(path) as db:
            columns = ("id", "name", "stored", "address", "latitude", "longitude")
            known = {
                row[0]: dict(zip(columns, row), address=json.loads(row[3]))
                for row in db.execute(f"SELECT {', '.join(columns)} FROM cinemas")
            }
        data = collect(client, today, known)
        if not data["screenings"]:
            raise RuntimeError(f"{name}: empty programme; preserving previous listings")
        with connect(path) as db:
            write(db, data)
            # Presence of an advance booking never proves a complete release week.
            db.execute("DELETE FROM state WHERE key = 'release_week'")
            for key, value in (
                ("transport", getattr(client, "transport", "http")),
                ("fallback_reason", getattr(client, "fallback_reason", None)),
            ):
                if value is None:
                    db.execute("DELETE FROM state WHERE key = ?", (key,))
                else:
                    db.execute(
                        "INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, value),
                    )
        if after_store:
            extra = after_store(path, client, data)
    except Exception as error:
        finish_run(path, run_id, "failed", client.requests, str(error)[:500])
        log.error("%s ingest %d failed: %s", name, run_id, error)
        raise
    finish_run(path, run_id, "ok", client.requests)
    summary = {
        "run": run_id,
        "requests": client.requests,
        "cinemas": len(data["cinemas"]),
        "films": len(data["films"]),
        "screenings": len(data["screenings"]),
        **extra,
    }
    log.info("%s ingest %d finished: %s", name, run_id, summary)
    return summary


def settled_reason(path, name, moment=None):
    boundary, _ = windows(name, as_moment(moment))
    # Failure limits belong to this refresh window, not an entire week.
    if failures_since(path, name, utc(boundary)) >= MAX_FAILURES:
        return "paused"
    success = last_success(path, name)
    with connect(path) as db:
        latest = db.execute(
            "SELECT status FROM runs WHERE source=? ORDER BY id DESC LIMIT 1", (name,)
        ).fetchone()
    if latest and latest[0] in ("failed", "running"):
        return None
    if success and datetime.fromisoformat(success) >= boundary:
        return "done"
    return None


def check(path, name, collect, client, moment=None, after_store=None):
    reason = settled_reason(path, name, moment)
    if reason == "paused":
        raise RuntimeError(
            f"{name}: paused after {MAX_FAILURES} failures in this refresh window"
        )
    if reason:
        return reason
    ingest(path, name, collect, client, as_moment(moment).date(), after_store)
    return "ingested"


def status(path, name, moment=None):
    moment = as_moment(moment)
    boundary, following = windows(name, moment)
    with connect(path) as db:
        success = last_success(path, name)
        attempt = db.execute(
            "SELECT status, COALESCE(finished_at,started_at), error FROM runs WHERE source = ? ORDER BY id DESC LIMIT 1",
            (name,),
        ).fetchone()
        state = dict(
            db.execute(
                "SELECT key,value FROM state WHERE key IN ('transport','fallback_reason')"
            )
        )
        counts = {
            table: db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("cinemas", "films", "screenings")
        }
    settled = settled_reason(path, name, moment)
    if settled == "paused":
        health = "paused"
    elif attempt and attempt[0] == "failed":
        health = "failed"
    elif attempt and attempt[0] == "running":
        health = (
            "running"
            if moment < datetime.fromisoformat(attempt[1]) + GRACE
            else "stale"
        )
    elif not success:
        health = "unavailable"
    elif datetime.fromisoformat(success) < boundary and moment >= boundary + GRACE:
        health = "stale"
    elif datetime.fromisoformat(success) < boundary:
        health = "due"
    else:
        health = "healthy"
    return {
        "provider": name,
        "status": health,
        "last_success": success,
        "last_attempt": attempt[1] if attempt else None,
        "error": attempt[2] if attempt else None,
        "refresh_window": boundary.isoformat(),
        "next_refresh": following.isoformat(),
        **state,
        **counts,
    }
