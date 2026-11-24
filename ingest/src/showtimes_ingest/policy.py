"""Refresh windows: when each chain is next due, independent of the dates a cinema
happens to advertise.

Each chain is collected once a week, keeping traffic minimal: on the first check
after its window opens, once its Friday-to-Thursday week is published and before
that Friday. Later checks in the same week contact nobody.
"""

from datetime import datetime, time, timedelta

from showtimes_ingest.week import TZ, now

# Python weekday: Monday=0, Tuesday=1, Wednesday=2. Each window follows the chain's
# verified publishing time: Everyman by Tuesday 10:00; Cineworld and Showcase by
# Monday 21:00. The rest run rolling programmes with no fixed publishing time.
WEEKLY = {
    "everyman": (2, time(6)),
    "cineworld": (1, time(6)),
    "showcase": (1, time(6)),
}
DEFAULT = (1, time(6))
# ODEON publishes on Tuesday, but some weeks only by Wednesday evening: a Tuesday run
# whose showings stop short of the week's Thursday is tried once more from here.
FALLBACK = {"odeon": (2, time(21))}
GRACE = timedelta(hours=2)


def windows(name, moment=None):
    """The start of the chain's current weekly window, and of the next one."""
    moment = (moment or now()).astimezone(TZ)
    weekday, clock = WEEKLY.get(name, DEFAULT)
    points = [
        datetime.combine(day, clock, TZ)
        for offset in range(-14, 15)
        if (day := moment.date() + timedelta(days=offset)).weekday() == weekday
    ]
    return max(p for p in points if p <= moment), min(p for p in points if p > moment)


def as_moment(value=None):
    if value is None:
        return now()
    if isinstance(value, datetime):
        return value.astimezone(TZ)
    return datetime.combine(value, time(12), TZ)


def fallback(name, boundary):
    """When a short run in the window opened at boundary is tried once more, if ever."""
    if name not in FALLBACK:
        return None
    weekday, clock = FALLBACK[name]
    day = boundary.date() + timedelta(days=(weekday - boundary.weekday()) % 7)
    return datetime.combine(day, clock, TZ)
