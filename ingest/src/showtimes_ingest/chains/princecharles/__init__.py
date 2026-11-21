"""Prince Charles configuration for the shared Jacro full-programme adapter."""

from showtimes_ingest.chains.jacro import Jacro
from showtimes_ingest.scores import search_title

NAME = "princecharles"
SITE = "https://princecharlescinema.com"
CINEMA = "prince-charles-cinema"
_source = Jacro(
    NAME,
    SITE,
    programme_path="/whats-on/",
    cinemas=[
        {
            "id": CINEMA,
            "name": "Prince Charles Cinema",
            "stored": True,
            "address": {
                "line1": "7 Leicester Place",
                "city": "London",
                "postcode": "WC2H 7BY",
            },
        }
    ],
)
collect = _source.collect
ingest = _source.ingest
check = _source.check
settled_reason = _source.settled_reason
__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]
