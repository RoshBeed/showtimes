"""Anonymous Vista sessions obtained from the public ticketing pages.

Curl-impersonate is primary, with one switch to a real browser for token or
transport failures. Acquisition is delegated to tokens.py. Tokens remain in
memory/stdin and never logs. Neither transport follows redirects or disables
certificate checks; rate limits and server outages end the run.
"""

import json
import os
import re
import subprocess
import time
from contextlib import nullcontext
from urllib.parse import urlencode

from showtimes_ingest.http import USER_AGENT
from showtimes_ingest.log import log
from showtimes_ingest.tokens import CurlTokenProvider, SessionError


def session(source, client=None):
    return nullcontext(client) if client is not None else Client(source)


class Client:
    def __init__(
        self, source, pause=1, executable=None, mode=None, browser_factory=None
    ):
        self.source, self.pause = source, pause
        self.executable = executable or os.environ.get(
            "SHOWTIMES_CURL_BIN", "/opt/curl-impersonate/curl-impersonate"
        )
        self.requests, self.last = 0, 0.0
        self.token, self.expiry = None, 0
        self.mode = mode or os.environ.get("SHOWTIMES_VISTA_TRANSPORT", "auto")
        if self.mode not in ("auto", "curl", "browser"):
            raise RuntimeError(
                "SHOWTIMES_VISTA_TRANSPORT must be auto, curl or browser"
            )
        self.transport, self.fallback_reason = "curl", None
        self.browser, self.browser_factory = None, browser_factory

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        if self.browser:
            self.browser.close()
            self.browser = None
        self.transport, self.token, self.expiry = "curl", None, 0

    def use_browser(self, reason=None):
        from showtimes_ingest.vista_browser import BrowserTransport

        self.transport, self.fallback_reason = "browser", reason
        self.token, self.expiry = None, 0
        self.browser = (self.browser_factory or BrowserTransport)(self.source)
        log.warning(
            "%s: using real-browser transport%s",
            self.source.name,
            " after " + reason if reason else "",
        )

    def request(self, url, headers=None):
        wait = self.last + self.pause - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        args = [
            self.executable,
            "--disable",
            "--impersonate",
            "chrome150",
            "--compressed",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "10",
            "--max-time",
            "45",
            "--config",
            "-",
            "--write-out",
            "\n%{http_code}",
        ]
        proxy = os.environ.get("SHOWTIMES_PROXY") or os.environ.get("ODEON_PROXY")
        if proxy:
            proxy = re.sub(r"^socks5://", "socks5h://", proxy)
            args += ["--proxy", proxy]
        args.append(url)
        # Config input avoids exposing the credential in command arguments.
        config = "".join(
            f'header = "{name}: {value}"\n' for name, value in (headers or {}).items()
        )
        self.requests += 1
        try:
            result = subprocess.run(
                args, input=config, capture_output=True, text=True, timeout=50
            )
        except FileNotFoundError:
            raise SessionError(
                "curl-impersonate is missing; run the ingest container"
            ) from None
        except subprocess.TimeoutExpired:
            raise SessionError(
                f"{self.source.name}: guest/API request timed out"
            ) from None
        finally:
            self.last = time.monotonic()
        if result.returncode:
            raise SessionError(
                f"{self.source.name}: HTTP transport exited {result.returncode}"
            )
        body, separator, status = result.stdout.rpartition("\n")
        if not separator or not status.isdigit():
            raise RuntimeError(f"{self.source.name}: invalid HTTP response")
        return body, int(status)

    def capture(self):
        if self.transport == "browser":
            wait = self.last + self.pause - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.requests += 1
            try:
                self.token, self.expiry = self.browser.capture()
            finally:
                self.last = time.monotonic()
        else:
            self.token, self.expiry = CurlTokenProvider(
                self.source, self.request
            ).capture()
        log.info(
            "%s: public guest session ready through %s",
            self.source.name,
            self.transport,
        )

    def get(self, route, params=()):
        if self.mode == "browser" and self.browser is None:
            self.use_browser()
        try:
            return self.fetch(route, params)
        except SessionError as error:
            if self.mode != "auto" or self.transport == "browser":
                raise
            self.use_browser(str(error))
            return self.fetch(route, params)

    def fetch(self, route, params):
        if self.token is None or self.expiry <= time.time() + 60:
            self.capture()
        headers = {
            "Authorization": "Bearer " + self.token,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if self.source.region:
            headers["Connect-Region-Code"] = self.source.region
        query = urlencode(list(params))
        url = (
            self.source.api.rstrip("/")
            + "/"
            + route.lstrip("/")
            + ("?" + query if query else "")
        )
        if self.transport == "browser":
            wait = self.last + self.pause - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.requests += 1
            try:
                body, status = self.browser.request(url, headers)
            finally:
                self.last = time.monotonic()
        else:
            body, status = self.request(url, headers)
        if status in (401, 403):
            self.token, self.expiry = None, 0
            raise SessionError(f"{self.source.name}: {route} returned HTTP {status}")
        if status == 204:
            return {}
        if status != 200:
            raise RuntimeError(f"{self.source.name}: {route} returned HTTP {status}")
        try:
            return json.loads(body)
        except ValueError:
            raise SessionError(
                f"{self.source.name}: {route} did not return JSON"
            ) from None
