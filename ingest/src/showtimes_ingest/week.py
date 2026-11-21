"""The listings week UK cinemas keep: Friday to Thursday, published in the days
before. Every chain is checked on the Tuesday-based week ODEON publishes on."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/London")


def now():
    return datetime.now(timezone.utc).astimezone(TZ)


def release_week(today):
    """The week a listing check belongs to: (its Tuesday, the Thursday after next).

    Chains publish the Friday-to-Thursday week on or before its Tuesday; that
    week ends on the Thursday nine days after the Tuesday.
    """
    tuesday = today - timedelta(days=(today.weekday() - 1) % 7)
    return tuesday, tuesday + timedelta(days=9)
