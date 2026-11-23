#!/usr/bin/env bash
# One provider's ingest: check whether it is due, ingest, and rate the films. Says
# changed=true or changed=false (to GITHUB_OUTPUT in a workflow); Publish puts a changed
# file on the data release. With VIA set (scripts/via-tailnet.sh), the fetch alone goes through
# it, and only when the chain is due.
#   [VIA=…] ingest-chain.sh <chain> check|run
# Needs: data/<chain>.sqlite downloaded first (scripts/listings.sh download),
# and the ingest Docker image; OMDB_API_KEY for ratings is optional.
set -euo pipefail
cd "$(dirname "$0")/.."
chain=${1:?usage: $0 <chain> check|run}
command=${2:-check}
export SHOWTIMES_DATABASE="$PWD/data/$chain.sqlite"
before=$(sha256sum "$SHOWTIMES_DATABASE" 2>/dev/null || true)
status=0
# One attempt: a failure is recorded in the chain's file and the next hourly
# check tries again, up to three times a week.
due=0
if [ "$command" != run ]; then
  bash scripts/ingest.sh "$chain" due || due=$?
fi
if [ "$command" = run ] || [ "$due" = 0 ]; then
  ${VIA:+"$VIA"} bash scripts/ingest.sh "$chain" "$command" || status=$?
elif [ "$due" != 3 ]; then
  status=$due
fi
# Ratings are optional (OMDb's free key allows 1,000 lookups a day): a failure is a warning,
# recorded in the file, never the chain's failure. The next run fills in what is missing.
bash scripts/ingest.sh "$chain" ratings || echo "::warning::$chain: ratings not updated (see the log)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '### %s ingestion\n\n```json\n' "$chain"
    bash scripts/ingest.sh "$chain" status
    printf '\n```\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
# Also after a failure, so that the failed run is on record next time.
changed=false
if [ -f "$SHOWTIMES_DATABASE" ] && [ "$(sha256sum "$SHOWTIMES_DATABASE")" != "$before" ]; then
  changed=true
fi
echo "changed=$changed" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
exit "$status"
