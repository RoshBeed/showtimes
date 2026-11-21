"""Odeon configuration for the shared Vista backend adapter."""

import re

from showtimes_ingest.chains.vista import Vista
from showtimes_ingest.scores import search_title as plain_title
from showtimes_ingest.tokens import Source

NAME = "odeon"
SOURCE = Source(
    NAME,
    "https://vwc.odeon.co.uk/WSVistaWebClient/ocapi/v1/",
    "https://www.odeon.co.uk/my-account/",
    "initial",
    browser_page="https://www.odeon.co.uk/",
)
_source = Vista(
    SOURCE,
    scope_env="ODEON_CINEMAS",
    catalogue=True,
    screen_sizes=True,
    batch_size=None,
)

collect = _source.collect
ingest = _source.ingest
check = _source.check
settled_reason = _source.settled_reason


def search_title(title):
    return plain_title(re.sub(r"^ODEON\b[^-–]*[-–]\s*", "", title))


__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]
