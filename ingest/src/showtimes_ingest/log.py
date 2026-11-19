"""Diagnostics for the ingest."""

import logging
import sys

log = logging.getLogger("showtimes")
log.propagate = False
log.addHandler(logging.NullHandler())


def log_to_stream(stream):
    """Send diagnostics to a stream."""
    if any(type(handler) is logging.StreamHandler for handler in log.handlers):
        return
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)


def log_to_stdout():
    log_to_stream(sys.stdout)
