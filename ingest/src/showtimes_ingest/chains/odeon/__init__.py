"""ODEON, the first chain: its API, its Tuesday release week, and its own
additions to film titles."""

import re

from showtimes_ingest.chains.odeon.run import NAME, check, ingest, settled_reason
from showtimes_ingest.scores import search_title as plain_title

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def search_title(title):
    """A title as a film database knows it: "ODEON Pride Nights - A Wolf Among
    the Swans" -> "A Wolf Among the Swans", then the usual clean-up."""
    return plain_title(re.sub(r"^ODEON\b[^-–]*[-–]\s*", "", title))
