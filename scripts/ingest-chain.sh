#!/usr/bin/env bash
# One provider's workflow: check whether it is due,
# ingest, rate the films, and publish its file if it changed. Prints changed=true
# when it did. With VIA set (scripts/via-tailnet.sh), the fetch alone goes through
# it, and only when the chain is due.
#   [VIA=…] ingest-chain.sh <chain> check|run
# Needs: data/<chain>.sqlite downloaded first (scripts/listings.sh download),
# the ingest Docker image, gh signed in, and OMDB_API_KEY for ratings (optional).
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
bash scripts/ingest.sh "$chain" ratings || status=$?
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    printf '### %s ingestion\n\n```json\n' "$chain"
    bash scripts/ingest.sh "$chain" status
    printf '\n```\n'
  } >> "$GITHUB_STEP_SUMMARY"
fi
# Also after a failure, so that the failed run is on record next time.
if [ -f "$SHOWTIMES_DATABASE" ] && [ "$(sha256sum "$SHOWTIMES_DATABASE")" != "$before" ]; then
  bash scripts/listings.sh upload "$chain"
  echo "changed=true"
else
  echo "Nothing new to publish for $chain."
fi
exit "$status"
