#!/usr/bin/env bash
# The chains the Listings workflow ingests this run, as a JSON matrix for GitHub Actions:
# every chain in .github/chains.json that is asked for (CHAINS: "all" or names) and, for a
# check, is due by policy.py (`ingest.sh <chain> due`: 0 due, 3 settled). A scheduled run
# leaves out chains paused by a repository variable (<CHAIN>_INGEST=false, and CHAINS_INGEST=false
# for every chain but ODEON). Needs every chain's file downloaded and the ingest image built.
#   CHAINS=all COMMAND=check EVENT=schedule VARS='{}' due.sh
set -euo pipefail
cd "$(dirname "$0")/.."
vars=${VARS:-"{}"}
export COMMAND=${COMMAND:-check}
chains=${CHAINS:-all}
[ "$chains" = all ] && chains=$(jq -r '.[].chain' .github/chains.json)
chains=$(tr ', ' '\n\n' <<<"$chains" | sed '/^$/d')
picked=()
for chain in $chains; do
  jq -e --arg c "$chain" 'any(.[]; .chain == $c)' .github/chains.json >/dev/null \
    || { echo "::error::$chain is not in .github/chains.json" >&2; exit 2; }
  if [ "${EVENT:-}" = schedule ]; then
    upper=$(tr '[:lower:]' '[:upper:]' <<<"$chain")
    if [ "$(jq -r --arg k "${upper}_INGEST" '.[$k] // ""' <<<"$vars")" = false ] \
      || { [ "$chain" != odeon ] && [ "$(jq -r '.CHAINS_INGEST // ""' <<<"$vars")" = false ]; }; then
      echo "$chain: paused" >&2
      continue
    fi
  fi
  if [ "$COMMAND" = check ]; then
    status=0
    bash scripts/ingest.sh "$chain" due >/dev/null || status=$?
    if [ "$status" = 3 ]; then echo "$chain: not due" >&2; continue; fi
  fi
  echo "$chain: ingest" >&2
  picked+=("$chain")
done
printf '%s\n' "${picked[@]}" | jq -R . | jq -sc --slurpfile table .github/chains.json \
  'map(select(length > 0)) as $names | [$table[0][] | select(.chain as $c | $names | index($c)) | . + {command: env.COMMAND}]'
