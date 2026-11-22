#!/usr/bin/env bash
# Joins a session of Claude Code's cloud environment `showtimes` to the owner's tailnet,
# so the owner can open services running in the session (the site's dev server, port 5173).
# The SessionStart hook in .claude/settings.json runs it at the start of each session.
# Anywhere else it does nothing: it needs tailscale, installed by the environment's setup
# script, and TS_AUTHKEY, an environment variable the owner sets in the environment's
# settings. That key is pre-signed for Tailnet Lock, reusable, ephemeral (the machine leaves
# the tailnet when the session ends) and tagged tag:showtimes-cloud, whose policy lets the
# owner's devices connect in and nothing out.
# Userspace networking: tailnet connections reach this machine's localhost; the session's
# own traffic is untouched. The key goes to tailscale on stdin, never in arguments or logs.
set -euo pipefail

[ -n "${TS_AUTHKEY:-}" ] || exit 0
command -v tailscaled >/dev/null || exit 0

state=/tmp/tailscale-showtimes
socket="$state/tailscaled.sock"
ts() { tailscale --socket="$socket" "$@"; }

if ts status >/dev/null 2>&1; then
  echo "Tailnet: already joined as $(ts ip -4)."
  exit 0
fi

mkdir -p "$state"
if [ ! -S "$socket" ]; then
  setsid nohup tailscaled --tun=userspace-networking --statedir="$state" --socket="$socket" \
    >"$state/tailscaled.log" 2>&1 </dev/null &
  for _ in $(seq 50); do [ -S "$socket" ] && break; sleep 0.1; done
fi

if ts up --hostname=showtimes-cloud --auth-key=file:/dev/stdin --timeout=30s \
  <<<"$TS_AUTHKEY" >"$state/up.log" 2>&1; then
  echo "Tailnet: joined as $(ts ip -4); the dev server is http://$(ts ip -4):5173/ once started."
else
  echo "Tailnet: could not join; see $state/up.log and $state/tailscaled.log."
fi
