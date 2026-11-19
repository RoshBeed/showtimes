"""ODEON's public API, with the token its own website uses.

The token is captured by loading odeon.co.uk in headless WebKit, held in memory
for the run, and captured again at most once if ODEON rejects it.
"""

import json
import os
import re
import subprocess
import time
from urllib.parse import urlencode, urlsplit

from showtimes_ingest.log import log

BASE = "https://vwc.odeon.co.uk/WSVistaWebClient/ocapi/v1/"
API_HOST = "vwc.odeon.co.uk"
API_PATH = "/WSVistaWebClient/ocapi/"


def request_token(request):
    url = urlsplit(request.url)
    if url.hostname != API_HOST or not url.path.startswith(API_PATH):
        return None
    authorization = request.headers.get("authorization", "")
    match = re.fullmatch(r"Bearer\s+(\S+)", authorization, re.IGNORECASE)
    return match.group(1) if match else None


def capture_token(timeout=60_000):
    try:
        from playwright.sync_api import Error, sync_playwright
    except ImportError:
        raise RuntimeError(
            "Install dependencies: uv sync; uv run playwright install webkit"
        ) from None

    status = None
    try:
        with sync_playwright() as playwright:
            proxy = os.environ.get("ODEON_PROXY")
            browser = playwright.webkit.launch(
                headless=True, proxy={"server": proxy} if proxy else None
            )
            try:
                context = browser.new_context()
                page = context.new_page()
                with context.expect_event(
                    "request", predicate=request_token, timeout=timeout
                ) as captured:
                    # Listen before navigation so early API calls are captured.
                    try:
                        response = page.goto(
                            "https://www.odeon.co.uk/",
                            wait_until="domcontentloaded",
                            timeout=timeout,
                        )
                        status = response.status if response else None
                    except Error:
                        # A navigation error need not invalidate observed API traffic.
                        pass
                return request_token(captured.value)
            finally:
                browser.close()
    except Error:
        if status == 403:
            # Seen from cloud providers: ODEON's front door blocks their addresses.
            raise RuntimeError(
                "ODEON refused this network (HTTP 403 on its home page), so no"
                " token could be captured."
            ) from None
        raise RuntimeError(
            "Background token capture failed. Check connectivity and run "
            "uv run playwright install webkit."
        ) from None


def validate_token(token):
    if not token or any(character in token for character in '\r\n"\\'):
        raise RuntimeError("Invalid ODEON token")
    return token


class API:
    """One run's requests. There are no retries beyond a single token renewal."""

    def __init__(self):
        self.token = None
        self.renewed = False
        self.requests = 0

    def capture(self):
        log.info("token capture started")
        started = time.monotonic()
        try:
            self.token = validate_token(capture_token())
        except RuntimeError as error:
            log.error("token capture failed: %s", error)
            raise
        log.info("token capture succeeded in %.1fs", time.monotonic() - started)

    def request(self, route, params):
        """Keep the credential out of process arguments by passing it over stdin."""
        if self.token is None:
            self.capture()
        self.requests += 1
        url = BASE + route
        if params:
            url += "?" + urlencode(params)
        started = time.monotonic()
        proxy = os.environ.get("ODEON_PROXY")
        if proxy and proxy.startswith("socks5://"):
            # Let the proxy look the name up: an address curl resolved itself
            # may be one the far end cannot route (IPv6 through an IPv4 exit).
            proxy = "socks5h://" + proxy.removeprefix("socks5://")
        result = subprocess.run(
            [
                "curl",
                "--silent",
                "--show-error",
                "--max-time",
                "45",
                "--config",
                "-",
                "--write-out",
                "\n%{http_code}",
                *(["--proxy", proxy] if proxy else []),
                url,
            ],
            input=f'header = "Authorization: Bearer {self.token}"\n',
            text=True,
            capture_output=True,
        )
        elapsed = time.monotonic() - started
        if result.returncode:
            log.error(
                "GET %s failed: curl exit %s %s",
                route,
                result.returncode,
                result.stderr.strip()[:300],
            )
            raise RuntimeError(
                f"Network request failed (curl exit {result.returncode})"
            )
        body, status = result.stdout.rsplit("\n", 1)
        level = log.info if status in ("200", "204") else log.warning
        level(
            "GET %s sites=%d status=%s bytes=%d %.2fs",
            route,
            sum(k == "siteIds" for k, _ in params),
            status,
            len(body),
            elapsed,
        )
        return body, status

    def get(self, route, params=()):
        body, status = self.request(route, params)
        if status in ("401", "403") and not self.renewed:
            self.renewed = True
            self.capture()
            body, status = self.request(route, params)
        if status in ("401", "403"):
            raise RuntimeError(
                f"API returned HTTP {status} after token recapture; stopping"
                " without further retries"
            )
        if status == "204":
            return {}
        if status != "200":
            raise RuntimeError(f"API returned HTTP {status} for {route}")
        try:
            return json.loads(body)
        except ValueError:
            raise RuntimeError("API returned a non-JSON response") from None
