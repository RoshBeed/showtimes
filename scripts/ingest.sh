#!/usr/bin/env bash
# Run the ingest in its container. Build once with:
# docker build -f ingest/Dockerfile -t showtimes-ingest .
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data
chain=${1:?usage: ingest.sh <chain> <command>}
exec docker run --rm --network host \
  -v "$PWD/data:/data" -e SHOWTIMES_DATABASE="/data/$chain.sqlite" \
  -e ODEON_CINEMAS -e ODEON_PROXY -e SHOWTIMES_PROXY \
  -e SHOWTIMES_VISTA_TRANSPORT \
  "${SHOWTIMES_INGEST_IMAGE:-showtimes-ingest}" "$@"
