"""Token acquisition and transport failover never involve backend adapters."""

import time
import unittest
from unittest.mock import patch

from test_vista import jwt, page

from showtimes_ingest.chains import cineworld, curzon, odeon, picturehouse
from showtimes_ingest.chains.vista import Vista
from showtimes_ingest.guest import Client
from showtimes_ingest.tokens import SessionError
from showtimes_ingest.vista_browser import FETCH


class Browser:
    def __init__(self, source):
        self.source, self.closed = source, False
        self.captures, self.calls, self.status = 0, [], 200

    def capture(self):
        self.captures += 1
        return jwt(int(time.time()) + 3600), time.time() + 3600

    def request(self, url, headers):
        self.calls.append((url, headers))
        return '{"sites": []}', self.status

    def close(self):
        self.closed = True


class FallbackTest(unittest.TestCase):
    def client(self, source=cineworld.SOURCE, mode="auto"):
        browser = Browser(source)
        client = Client(source, pause=0, mode=mode, browser_factory=lambda _: browser)
        self.addCleanup(client.close)
        return client, browser

    def test_all_four_chains_use_one_adapter_and_one_authentication_client(self):
        for provider in (odeon, picturehouse, cineworld, curzon):
            self.assertIsInstance(provider._source, Vista)
            self.assertIs(provider.collect.__func__, Vista.collect)
        self.assertIsNone(
            odeon.SOURCE.region
        )  # Preserve ODEON's UK and Ireland directory.

    def test_primary_success_never_starts_a_browser(self):
        client, browser = self.client()
        token = jwt(int(time.time()) + 3600)
        with patch.object(
            client,
            "request",
            side_effect=[(page(client.source, token), 200), ('{"sites":[]}', 200)],
        ):
            self.assertEqual(client.get("sites"), {"sites": []})
        self.assertEqual(browser.captures, 0)
        self.assertEqual(client.transport, "curl")

    def test_token_failure_switches_once_and_keeps_browser_for_the_rest_of_the_run(
        self,
    ):
        client, browser = self.client()
        with patch.object(
            client, "request", return_value=("no public token", 200)
        ) as curl:
            self.assertEqual(client.get("sites"), {"sites": []})
            client.get("sites")
        self.assertEqual(curl.call_count, 1)
        self.assertEqual(browser.captures, 1)
        self.assertEqual(len(browser.calls), 2)
        self.assertEqual(client.transport, "browser")
        self.assertIn("guest session", client.fallback_reason)

    def test_valid_token_but_rejected_curl_api_also_switches_the_request_transport(
        self,
    ):
        for status in (401, 403):
            client, browser = self.client()
            token = jwt(int(time.time()) + 3600)
            with patch.object(
                client,
                "request",
                side_effect=[(page(client.source, token), 200), ("refused", status)],
            ) as curl:
                client.get("sites")
            self.assertEqual(curl.call_count, 2)
            self.assertEqual(browser.captures, 1)
            self.assertEqual(len(browser.calls), 1)
            self.assertIn("HTTP " + str(status), client.fallback_reason)

    def test_bad_requests_rate_limits_and_outages_are_not_retried_in_a_browser(self):
        for status in (400, 404, 429, 500, 503):
            client, browser = self.client()
            client.token, client.expiry = (
                jwt(int(time.time()) + 3600),
                time.time() + 3600,
            )
            with patch.object(
                client, "request", return_value=("error", status)
            ) as curl:
                self.assertRaisesRegex(
                    RuntimeError, "HTTP " + str(status), client.get, "sites"
                )
            self.assertEqual(curl.call_count, 1)
            self.assertEqual(browser.captures, 0)

    def test_browser_rejection_is_terminal_and_context_cleanup_closes_it(self):
        client, browser = self.client()
        browser.status = 403
        with (
            self.assertRaisesRegex(SessionError, "HTTP 403"),
            client,
            patch.object(
                client, "request", side_effect=SessionError("network failure")
            ),
        ):
            client.get("sites")
        self.assertEqual(browser.captures, 1)
        self.assertEqual(len(browser.calls), 1)
        self.assertTrue(browser.closed)
        self.assertIsNone(client.token)

    def test_an_expiring_browser_token_is_renewed_by_the_same_token_provider(self):
        client, browser = self.client(mode="browser")
        client.get("sites")
        client.expiry = time.time() + 10
        client.get("sites")
        self.assertEqual(browser.captures, 2)
        self.assertEqual(client.transport, "browser")

    def test_forced_primary_mode_does_not_fallback_and_forced_browser_skips_curl(self):
        client, browser = self.client(mode="curl")
        with patch.object(client, "request", side_effect=SessionError("no token")):
            self.assertRaises(SessionError, client.get, "sites")
        self.assertEqual(browser.captures, 0)
        client, browser = self.client(mode="browser")
        with patch.object(
            client, "request", side_effect=AssertionError("curl must not run")
        ):
            client.get("sites")
        self.assertEqual(browser.captures, 1)

    def test_browser_transport_refuses_redirects(self):
        self.assertIn("redirect: 'error'", FETCH)
