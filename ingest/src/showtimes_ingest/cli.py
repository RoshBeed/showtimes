"""Command line for the ingest: showtimes-ingest <chain> <command>. The chain's
file is the one in $SHOWTIMES_DATABASE."""

import argparse
import json
import sys

from showtimes_ingest import ratings, refresh
from showtimes_ingest.chains import CHAINS
from showtimes_ingest.log import log, log_to_stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("chain", choices=sorted(CHAINS), help="the cinema chain")
    parser.add_argument(
        "command",
        choices=["check", "run", "due", "ratings", "status"],
        help="check: ingest if the chain's latest listings are not stored. run: ingest now."
        " due: exit 0 if a check would contact the chain, 3 if not."
        " ratings: rate the films once after each ingest.",
    )
    args = parser.parse_args(argv)
    chain = CHAINS[args.chain]
    log_to_stdout()
    try:
        if args.command == "run":
            print(json.dumps(chain.ingest()))
        elif args.command == "check":
            print(json.dumps({"result": chain.check()}))
        elif args.command == "ratings":
            print(json.dumps({"result": ratings.check_ratings(chain)}))
        elif args.command == "status":
            print(json.dumps(refresh.status(None, chain.NAME)))
        else:
            settled = chain.settled_reason()
            print(json.dumps({"due": settled is None, "reason": settled}))
            if settled == "paused":
                sys.exit(1)
            sys.exit(3 if settled else 0)
    except RuntimeError as error:
        log.error("%s %s failed: %s", args.chain, args.command, error)
        sys.exit(1)
