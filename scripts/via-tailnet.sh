#!/usr/bin/env bash
# Run a command with its browser's traffic sent through an exit node on the owner's
# tailnet: ODEON refuses cloud providers' addresses, GitHub's runners included, and
# the other chains read through a browser go the same way. ODEON's capture reads
# ODEON_PROXY; showtimes_ingest.browser reads SHOWTIMES_PROXY.
# Without TAILSCALE_EXIT_NODE the command runs as is.
#
# Needs: TAILSCALE_EXIT_NODE (the device's name) and TAILSCALE_AUTHKEY (a reusable,
# ephemeral auth key tagged tag:ingest and pre-signed for Tailnet Lock). Each run
# joins as its own short-lived device, ingest-<chain>, so chains run side by side.
set -euo pipefail

if [[ -z "${TAILSCALE_EXIT_NODE:-}" ]]; then
  exec "$@"
fi
# No apostrophe in the message: bash reads one inside ${...:?...} as an opening quote.
: "${TAILSCALE_AUTHKEY:?set the tailnet auth key of the runners}"

version=1.104.4
work=$(mktemp -d)
curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${version}_amd64.tgz" |
  tar -xz -C "$work" --strip-components=1
socket=$work/tailscaled.sock
"$work/tailscaled" --tun=userspace-networking --statedir="$work/state" --socket="$socket" \
  --socks5-server=127.0.0.1:1055 >"$work/tailscaled.log" 2>&1 &
# The key goes in on stdin, never in arguments or logs. The exit node is chosen
# after connecting; its name cannot be resolved before.
joined=0
"$work/tailscale" --socket="$socket" up --timeout=60s --auth-key=file:/dev/stdin \
  --hostname="ingest-${CHAIN:-run}" --advertise-tags=tag:ingest <<<"$TAILSCALE_AUTHKEY" \
  2>"$work/up.log" || joined=$?
cat "$work/up.log" >&2
# Tailnet Lock lets an unsigned device join but gives it no connectivity; up still succeeds.
if grep -q "locked out" "$work/up.log"; then
  echo "TAILSCALE_AUTHKEY is not signed for Tailnet Lock: store what 'tailscale lock sign <key>' prints" >&2
  exit 1
fi
if [ "$joined" != 0 ] || ! "$work/tailscale" --socket="$socket" set --exit-node="$TAILSCALE_EXIT_NODE"; then
  echo "Could not join the tailnet or use exit node $TAILSCALE_EXIT_NODE" >&2
  tail -20 "$work/tailscaled.log" >&2
  exit 1
fi

status=0
# SOCKS, not an HTTP proxy: through an HTTP proxy the browser falls back to
# HTTP/1.1, which it never uses on a direct connection.
ODEON_PROXY=socks5://127.0.0.1:1055 SHOWTIMES_PROXY=socks5://127.0.0.1:1055 "$@" || status=$?
# Logging out removes the ephemeral device from the tailnet at once.
"$work/tailscale" --socket="$socket" logout || true
exit "$status"
