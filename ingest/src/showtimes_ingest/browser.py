"""A chain's website in a real browser, as ODEON's adapter uses one: headless
WebKit opens the site, the site sets itself up for an anonymous visitor as it
always does (a guest token, a page token, cookies), and the ingest then asks
the site's own API from inside the page, or keeps what the page itself fetched.

The browser starts on first use, so a check that is not due never opens the
site. Requests are one at a time with a pause between, never retried.
SHOWTIMES_PROXY (socks5://…) sends the browser's traffic through a proxy, as
scripts/via-tailnet.sh sets it.
"""

import json
import os
import time
from urllib.parse import urlencode

FETCH = """async ([url, method, body]) => {
  const response = await fetch(url, {
    method, credentials: 'include', body: body ?? undefined,
    headers: body ? { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } : { Accept: 'application/json' },
  });
  return [response.status, await response.text()];
}"""
# A page that asks a visitor to prove they are a person: the adapter stops there.
CHALLENGE = (
    "verify you are human",
    "are you a robot",
    "captcha",
    "just a moment",
    "access denied",
)


class Browser:
    def __init__(self, site, start="/", settle=4000, pause=1.0, timeout=60_000):
        self.site, self.start, self.settle = site.rstrip("/"), start, settle
        self.transport = "browser"
        self.pause, self.timeout = pause, timeout
        self.requests, self.last = 0, 0.0
        self.playwright = self.browser = self.page = None
        self.seen, self.keeping, self.arrived = {}, (), {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def open(self, path=None, keep=()):
        """Open a page of the site (the start page by default) and keep the bodies
        of the responses whose address ends with one of `keep`."""
        try:
            from playwright.sync_api import Error, sync_playwright
        except ImportError:
            raise RuntimeError(
                "Browser is unavailable; rebuild the full ingest Docker container"
            ) from None
        if not self.browser:
            proxy = os.environ.get("SHOWTIMES_PROXY")
            self.playwright = sync_playwright().start()
            self.browser = self.playwright.webkit.launch(
                headless=True, proxy={"server": proxy} if proxy else None
            )
            self.page = self.browser.new_context().new_page()

            def capture(response):
                # Only noted here: a body is read once the page has settled.
                for ending in self.keeping:
                    if response.url.split("?")[0].endswith(ending):
                        self.arrived[ending] = response

            self.page.on("response", capture)
        self.keeping, self.arrived = keep, {}
        self.wait()
        self.requests += 1
        try:
            response = self.page.goto(
                self.site + (path or self.start),
                wait_until="domcontentloaded",
                timeout=self.timeout,
            )
        except Error as error:
            raise RuntimeError(f"{self.site}{path or self.start}: {error}") from None
        finally:
            self.last = time.monotonic()
        status = response.status if response else None
        self.page.wait_for_timeout(self.settle)  # the site's own start-up requests
        # What the page says to a person, not its code: forms often load reCAPTCHA.
        text = (self.page.title() + " " + self.page.inner_text("body")[:5000]).lower()
        if status in (401, 403, 429) or any(sign in text for sign in CHALLENGE):
            raise RuntimeError(
                f"{self.site} asked for proof of a person (HTTP {status}); not passed"
            )
        if status and status >= 400:
            raise RuntimeError(f"HTTP {status} from {self.site}{path or self.start}")
        for ending in keep:
            if ending not in self.arrived:
                # Still on its way: wait for it, as long as a page may take.
                try:
                    with self.page.expect_response(
                        lambda each: each.url.split("?")[0].endswith(ending),
                        timeout=self.timeout,
                    ) as late:
                        pass
                    self.arrived[ending] = late.value
                except Error:
                    raise RuntimeError(
                        f"{self.site}: the page did not fetch {ending}"
                    ) from None
            try:
                self.seen[ending] = self.arrived[ending].text()
            except Error as error:
                raise RuntimeError(f"{self.site}: {ending} not read: {error}") from None
        return status

    def wait(self):
        wait = self.last + self.pause - time.monotonic()
        if wait > 0:
            time.sleep(wait)

    def fetch(self, path, params=(), form=None, raw=False):
        """What the site's API returns for a request made from inside its own page."""
        if not self.page:
            self.open()
        query = urlencode(list(params), doseq=True)
        url = self.site + path + (f"?{query}" if query else "")
        self.wait()
        self.requests += 1
        try:
            status, body = self.page.evaluate(
                FETCH,
                [url, "POST" if form else "GET", urlencode(form) if form else None],
            )
        finally:
            self.last = time.monotonic()
        if status != 200:
            raise RuntimeError(f"HTTP {status} from {url}")
        if raw:
            return body
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise RuntimeError(f"Not JSON from {url}") from None

    def close(self):
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()
        self.browser = self.playwright = self.page = None
