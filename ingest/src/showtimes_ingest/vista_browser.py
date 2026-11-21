"""Browser HTTP transport; token acquisition is delegated to a token provider."""

import os
from contextlib import suppress

from showtimes_ingest.tokens import BrowserTokenProvider

FETCH = """async ([url, headers]) => {
  const response = await fetch(url, {headers, credentials: 'omit', redirect: 'error'});
  return [await response.text(), response.status];
}"""


class BrowserTransport:
    def __init__(self, source):
        self.source = source
        self.playwright = self.browser = self.page = None

    def start(self):
        from playwright.sync_api import sync_playwright

        self.playwright = sync_playwright().start()
        proxy = os.environ.get("SHOWTIMES_PROXY") or os.environ.get("ODEON_PROXY")
        self.browser = self.playwright.webkit.launch(
            headless=True, proxy={"server": proxy} if proxy else None
        )
        self.page = self.browser.new_context().new_page()

    def capture(self):
        return BrowserTokenProvider(self.source, self).capture()

    def request(self, url, headers):
        from playwright.sync_api import Error

        try:
            return tuple(
                self.page.evaluate(
                    FETCH,
                    [url, {k: v for k, v in headers.items() if k != "User-Agent"}],
                )
            )
        except Error:
            raise RuntimeError(
                f"{self.source.name}: real-browser API request failed"
            ) from None

    def close(self):
        with suppress(Exception):
            if self.browser:
                self.browser.close()
        with suppress(Exception):
            if self.playwright:
                self.playwright.stop()
        self.playwright = self.browser = self.page = None
