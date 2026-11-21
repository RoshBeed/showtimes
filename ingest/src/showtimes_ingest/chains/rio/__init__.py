"""Rio Cinema, using its complete public Opus programme in one page."""

from showtimes_ingest import refresh
from showtimes_ingest.chains import opus
from showtimes_ingest.http import Client
from showtimes_ingest.scores import search_title

NAME = "rio"
SITE = "https://riocinema.org.uk"
CINEMA = {
    "id": "rio",
    "name": "Rio Cinema",
    "url": "/",
    "address": {
        "line1": "107 Kingsland High Street",
        "city": "London",
        "postcode": "E8 2PB",
    },
    "booking_prefix": "Booking?Booking=TSelectItems.waSelectItemsPrompt.TcsWebMenuItem_0.TcsWebTab_0.TcsPerformance_",
}

__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]


def collect(client, today, known=None):
    return opus.collect(client, today, CINEMA)


def ingest(path=None, today=None, client=None):
    return refresh.ingest(path, NAME, collect, client or Client(SITE), today)


def settled_reason(path=None, today=None):
    return refresh.settled_reason(path, NAME, today)


def check(path=None, moment=None, client=None):
    return refresh.check(path, NAME, collect, client or Client(SITE), moment)
