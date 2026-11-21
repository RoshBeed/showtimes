"""Cineworld configuration for the shared Vista backend adapter."""

from showtimes_ingest.chains.vista import Vista
from showtimes_ingest.scores import search_title
from showtimes_ingest.tokens import Source

NAME = "cineworld"
SOURCE = Source(
    NAME,
    "https://digital-api.cineworld.co.uk/ocapi/v1/",
    "https://web.cineworld.co.uk/",
    "next",
    "GB",
)
_source = Vista(SOURCE)

collect = _source.collect
ingest = _source.ingest
check = _source.check
settled_reason = _source.settled_reason

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]
