"""The cinema chains, by name. Each is a package that fetches its chain into its
own SQLite file, in the shared schema (store.SCHEMA), and offers:

    NAME                    its name, as in `showtimes-ingest <name> ...` and the runs table
    check(path)             the scheduled check: fetch if the chain has published
                            listings that are not stored yet; returns what it did
    ingest(path)            fetch now; returns a summary
    settled_reason(path)    why a check would not contact the chain now, or None
    search_title(title)     a title as a film database knows it, for the ratings

The site's export reads each file through the chain's other half,
site/src/chains/<name>.ts, which names its tags, towns and booking link.
"""

from showtimes_ingest.chains import odeon

CHAINS = {chain.NAME: chain for chain in (odeon,)}
