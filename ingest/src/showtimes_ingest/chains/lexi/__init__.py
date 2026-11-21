"""The Lexi Cinema: its full public Opus programme, with no booking-system requests."""

from showtimes_ingest.chains.opus import Cinema

SITE = "https://thelexicinema.co.uk"
_source = Cinema(
    "lexi",
    SITE,
    {
        "id": "lexi",
        "name": "The Lexi Cinema",
        "url": "/TheLexiCinema.dll/Home",
        "address": {
            "line1": "194b Chamberlayne Road",
            "city": "London",
            "postcode": "NW10 3JU",
        },
        "booking_prefix": "Booking?Booking=TSelectItems.waSelectItemsPrompt.TcsWebMenuItem_0.TcsWebTab_0.TcsPerformance_",
    },
)
NAME = _source.NAME
collect = _source.collect
ingest = _source.ingest
check = _source.check
settled_reason = _source.settled_reason
search_title = _source.search_title
