"""Reel's shared Jacro adapter, with its three Admit One venues configured."""

import re

from showtimes_ingest.chains.jacro import Jacro
from showtimes_ingest.scores import search_title as base_search_title

NAME = "reel"
SITE = "https://reelcinemas.co.uk"
LEGACY = {"hull", "morecambe", "quinton"}
_source = Jacro(NAME, SITE, legacy=LEGACY)
collect = _source.collect
ingest = _source.ingest
check = _source.check
settled_reason = _source.settled_reason
movie_page = _source.movie_page


def search_title(title):
    return base_search_title(re.sub(r" - Subtitled Screening$", "", title, flags=re.I))


__all__ = ["NAME", "check", "ingest", "settled_reason", "search_title"]
