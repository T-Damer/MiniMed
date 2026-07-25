from __future__ import annotations

import urllib.error
from email.message import Message

import pytest

from localmed_ingest.http_retry import is_transient_http_error, retry_on_transient_http

_EMPTY_HEADERS = Message()


def test_is_transient_http_error_recognizes_retryable_status_codes() -> None:
    transient = urllib.error.HTTPError(
        "https://example.test",
        503,
        "Service Unavailable",
        hdrs=_EMPTY_HEADERS,
        fp=None,
    )
    assert is_transient_http_error(transient)
    assert not is_transient_http_error(
        urllib.error.HTTPError(
            "https://example.test", 404, "Not Found", hdrs=_EMPTY_HEADERS, fp=None
        )
    )


def test_retry_on_transient_http_eventually_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = 0
    sleeps: list[float] = []

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("localmed_ingest.http_retry.time.sleep", fake_sleep)

    def flaky() -> str:
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise urllib.error.HTTPError(
                "https://example.test",
                503,
                "Service Unavailable",
                hdrs=_EMPTY_HEADERS,
                fp=None,
            )
        return "ok"

    assert (
        retry_on_transient_http(
            flaky,
            max_attempts=5,
            initial_delay_seconds=10,
            max_delay_seconds=60,
            backoff_factor=2,
        )
        == "ok"
    )
    assert attempts == 3
    assert sleeps == [10.0, 20.0]


def test_retry_on_transient_http_does_not_retry_permanent_errors() -> None:
    attempts = 0

    def flaky() -> str:
        nonlocal attempts
        attempts += 1
        raise urllib.error.HTTPError(
            "https://example.test", 404, "Not Found", hdrs=_EMPTY_HEADERS, fp=None
        )

    with pytest.raises(urllib.error.HTTPError):
        retry_on_transient_http(flaky, max_attempts=5, initial_delay_seconds=0)

    assert attempts == 1
