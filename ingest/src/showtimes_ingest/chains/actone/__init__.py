"""ActOne Cinema: its full public Opus programme, with no booking-system requests."""

from showtimes_ingest.chains.opus import Cinema

SITE = "https://actonecinema.co.uk"
_source = Cinema(
    "actone",
    SITE,
    {
        "id": "actone",
        "name": "ActOne Cinema",
        "url": "/ActOneCinema.dll/Home",
        "address": {
            "line1": "119-121 High Street",
            "city": "London",
            "postcode": "W3 6NA",
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
