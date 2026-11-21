"""Picturehouse configuration for the shared Vista backend adapter."""

from showtimes_ingest.chains.vista import Vista
from showtimes_ingest.scores import search_title
from showtimes_ingest.tokens import Source

NAME = "picturehouse"
SITE = "https://www.picturehouses.com"
SOURCE = Source(
    NAME,
    "https://digital-api.picturehouses.com/ocapi/v1/",
    "https://web.picturehouses.com/",
    "next",
)
_source = Vista(SOURCE, local_showtime_ids=True)

collect = _source.collect
ingest = _source.ingest
check = _source.check
settled_reason = _source.settled_reason

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]
