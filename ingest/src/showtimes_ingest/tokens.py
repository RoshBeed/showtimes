"""Guest token providers, independent of cinema adapters and API requests."""

import base64
import json
import re
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

from showtimes_ingest.browser import CHALLENGE


@dataclass(frozen=True)
class Source:
    name: str
    api: str
    page: str
    token_data: str
    region: str | None = None
    browser_page: str | None = None


class SessionError(RuntimeError):
    """A failed transport/session, eligible for the one browser fallback."""


def token_expiry(token, source):
    try:
        if not isinstance(token, str) or not re.fullmatch(
            r"[\w-]+\.[\w-]+\.[\w-]+", token, re.ASCII
        ):
            raise ValueError("invalid JWT")
        payload = token.split(".")[1]
        expiry = int(
            json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))[
                "exp"
            ]
        )
        if expiry <= time.time():
            raise ValueError("expired JWT")
        return expiry
    except (ValueError, KeyError, TypeError):
        raise SessionError(
            f"{source.name}: missing, invalid or expired guest session"
        ) from None


def extract_token(html, source):
    try:
        if source.token_data == "next":
            script = re.search(
                r'<script\b[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
                html,
                re.S,
            )
            token = json.loads(script[1])["props"]["pageProps"]["environment"][
                "gasToken"
            ]
        else:
            assignment = re.search(r"\bwindow\.initialData\s*=\s*", html)
            token = json.JSONDecoder().raw_decode(html[assignment.end() :])[0]["api"][
                "authToken"
            ]
        return token, token_expiry(token, source)
    except (ValueError, KeyError, TypeError, AttributeError):
        raise SessionError(
            f"{source.name}: missing, invalid or expired guest session"
        ) from None


class CurlTokenProvider:
    def __init__(self, source, request):
        self.source, self.request = source, request

    def capture(self):
        body, status = self.request(self.source.page)
        if status not in (200, 404):
            error = SessionError if status in (401, 403) else RuntimeError
            raise error(f"{self.source.name}: guest page returned HTTP {status}")
        return extract_token(body, self.source)


class BrowserTokenProvider:
    def __init__(self, source, transport):
        self.source, self.transport = source, transport

    def capture(self):
        from playwright.sync_api import Error

        transport = self.transport
        transport.close()
        observed = []
        expected = urlsplit(self.source.api)

        def observe(request):
            url = urlsplit(request.url)
            if (
                url.scheme == "https"
                and url.netloc == expected.netloc
                and url.path.startswith(expected.path)
            ):
                value = request.headers.get("authorization", "")
                if value.lower().startswith("bearer "):
                    observed.append(value[7:])

        try:
            transport.start()
            page = transport.page
            page.on("request", observe)
            response = page.goto(
                self.source.browser_page or self.source.page,
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            status = response.status if response else None
            text = (page.title() + " " + page.inner_text("body")[:5000]).lower()
            if status in (401, 403, 429) or any(sign in text for sign in CHALLENGE):
                raise RuntimeError(
                    f"{self.source.name}: browser guest page was refused (HTTP {status})"
                )
            try:
                return extract_token(page.content(), self.source)
            except SessionError:
                pass
            for _ in range(40):
                if observed:
                    return observed[-1], token_expiry(observed[-1], self.source)
                page.wait_for_timeout(250)
            raise RuntimeError(
                f"{self.source.name}: browser did not receive a public guest session"
            )
        except Error:
            transport.close()
            raise RuntimeError(
                f"{self.source.name}: real-browser guest capture failed; check the ingest container and network"
            ) from None
        except RuntimeError:
            transport.close()
            raise
