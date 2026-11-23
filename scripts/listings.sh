#!/usr/bin/env bash
# The published listings: a SQLite file for each cinema chain, <chain>.sqlite.gz,
# assets of this repository's `data` release. The Ingest workflow uploads them;
# site builds download them.
#   listings.sh download [chain] fetch every file, or just the named provider; every file
#                               includes titles.json (Claude's clean titles) and ratings.json
#   listings.sh upload <chain>  publish data/<chain>.sqlite
#   listings.sh upload-json <name>  publish data/<name>.json (titles, ratings)
# Needs gh, signed in (or GH_TOKEN), and to run inside the repository.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-}" in
download)
  mkdir -p data
  files=$(gh release view data --json assets --jq '.assets[].name | select(endswith(".sqlite.gz"))' 2>/dev/null || true)
  if [ -n "${2:-}" ]; then
    files=$(printf '%s\n' "$files" | awk -v wanted="$2.sqlite.gz" '$0 == wanted')
  else
    for name in titles.json ratings.json; do
      if gh release view data --json assets --jq '.assets[].name' 2>/dev/null | grep -qx "$name"; then
        gh release download data --pattern "$name" --dir data --clobber
        echo "Fetched data/$name."
      fi
    done
  fi
  if [ -z "$files" ]; then
    echo "No listings are published yet."
    exit 0
  fi
  for name in $files; do
    gh release download data --pattern "$name" --dir data --clobber
    gunzip --force "data/$name"
    echo "Fetched data/${name%.gz}."
  done
  ;;
upload)
  chain=${2:?usage: $0 upload <chain>}
  file="data/$chain.sqlite"
  gzip --keep --force "$file"
  if ! gh release view data >/dev/null 2>&1; then
    gh release create data --title "Listings" --latest=false \
      --notes "Each cinema chain's stored listings, <chain>.sqlite.gz, replaced by the Ingest workflow. Not a software release." || gh release view data >/dev/null
  fi
  gh release upload data "$file.gz" --clobber
  rm "$file.gz"
  echo "Published $file."
  ;;
upload-json)
  name=${2:?usage: $0 upload-json <name>}
  gh release upload data "data/$name.json" --clobber
  echo "Published data/$name.json."
  ;;
*)
  echo "usage: $0 download [chain] | upload <chain> | upload-json <name>" >&2
  exit 2
  ;;
esac
