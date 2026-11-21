#!/usr/bin/env sh
# Pinned upstream Linux binary. Run during the ingest image build, never on macOS.
set -eu
version=2.2.3
case "$(uname -m)" in
  x86_64) arch=x86_64; digest=ca7c8aae49e33260d3a2400db16c7737aaf04692d606a843502056b42990f989 ;;
  aarch64) arch=aarch64; digest=5e71795b971f32be8f3d7785895f4dceb232f04414f5a067db266432a5b08657 ;;
  *) echo 'Unsupported curl-impersonate architecture' >&2; exit 1 ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
url="https://github.com/lexiforest/curl-impersonate/releases/download/v$version/curl-impersonate-v$version.$arch-linux-gnu.tar.gz"
curl -fsSL "$url" -o "$work/archive.tar.gz"
echo "$digest  $work/archive.tar.gz" | sha256sum -c -
mkdir -p /opt/curl-impersonate
# Keep the upstream executable, wrappers and third-party licence notices together.
tar -xzf "$work/archive.tar.gz" -C /opt/curl-impersonate
printf '%s\n%s\n' "$url" "$digest" > /opt/curl-impersonate/SOURCE
/opt/curl-impersonate/curl-impersonate --version
