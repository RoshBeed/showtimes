#!/usr/bin/env bash
# Run a command with its browser's traffic sent through an exit node on the owner's
# tailnet: ODEON refuses cloud providers' addresses, GitHub's runners included, and
# the other chains read through a browser go the same way. ODEON's capture reads
# ODEON_PROXY; showtimes_ingest.browser reads SHOWTIMES_PROXY.
# Without TAILSCALE_EXIT_NODE the command runs as is.
#
# Needs: TAILSCALE_EXIT_NODE (the device's name) and TAILSCALE_STATE (the
# runner's permanent tailnet identity, base64 of a tailscaled state file).
set -euo pipefail

if [[ -z "${TAILSCALE_EXIT_NODE:-}" ]]; then
  exec "$@"
fi
# No apostrophe in the message: bash reads one inside ${...:?...} as an opening quote.
: "${TAILSCALE_STATE:?set the tailnet identity of the runner}"

version=1.104.4
work=$(mktemp -d)
curl -fsSL "https://pkgs.tailscale.com/stable/tailscale_${version}_amd64.tgz" |
  tar -xz -C "$work" --strip-components=1
socket=$work/tailscaled.sock
# One identity, already signed for Tailnet Lock, reused by every run.
base64 -d <<<"$TAILSCALE_STATE" >"$work/tailscaled.state"
"$work/tailscaled" --tun=userspace-networking --state="$work/tailscaled.state" \
  --statedir="$work/state" --socket="$socket" --socks5-server=127.0.0.1:1055 \
  >"$work/tailscaled.log" 2>&1 &
# The exit node is chosen after connecting; its name cannot be resolved before.
if ! "$work/tailscale" --socket="$socket" up --timeout=60s --hostname=odeon-ingest \
  --advertise-tags=tag:odeon-ingest ||
  ! "$work/tailscale" --socket="$socket" set --exit-node="$TAILSCALE_EXIT_NODE"; then
  echo "Could not join the tailnet or use exit node $TAILSCALE_EXIT_NODE" >&2
  tail -20 "$work/tailscaled.log" >&2
  exit 1
fi

# The identity is kept for the next run: stop, never log out.
status=0
# SOCKS, not an HTTP proxy: through an HTTP proxy the browser falls back to
# HTTP/1.1, which it never uses on a direct connection.
ODEON_PROXY=socks5://127.0.0.1:1055 SHOWTIMES_PROXY=socks5://127.0.0.1:1055 "$@" || status=$?
"$work/tailscale" --socket="$socket" down || true
exit "$status"
