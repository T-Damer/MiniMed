from __future__ import annotations

import os
import time
import urllib.error
from collections.abc import Callable

TRANSIENT_HTTP_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return float(raw)


def is_transient_http_error(error: BaseException) -> bool:
    return isinstance(error, urllib.error.HTTPError) and error.code in TRANSIENT_HTTP_STATUS_CODES


def retry_on_transient_http[T](
    operation: Callable[[], T],
    *,
    operation_name: str = "HTTP request",
    max_attempts: int | None = None,
    initial_delay_seconds: float | None = None,
    max_delay_seconds: float | None = None,
    backoff_factor: float | None = None,
) -> T:
    attempts = (
        max_attempts if max_attempts is not None else _env_int("MINIMED_HTTP_RETRY_MAX_ATTEMPTS", 8)
    )
    delay_seconds = (
        initial_delay_seconds
        if initial_delay_seconds is not None
        else _env_float("MINIMED_HTTP_RETRY_INITIAL_DELAY_SECONDS", 30.0)
    )
    delay_cap_seconds = (
        max_delay_seconds
        if max_delay_seconds is not None
        else _env_float("MINIMED_HTTP_RETRY_MAX_DELAY_SECONDS", 600.0)
    )
    backoff = (
        backoff_factor
        if backoff_factor is not None
        else _env_float("MINIMED_HTTP_RETRY_BACKOFF_FACTOR", 2.0)
    )
    if attempts < 1:
        raise ValueError("max_attempts must be at least 1.")
    if delay_seconds < 0 or delay_cap_seconds < 0 or backoff < 1:
        raise ValueError("Retry delays and backoff must be non-negative with backoff >= 1.")

    last_error: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except BaseException as error:
            if not is_transient_http_error(error) or attempt >= attempts:
                raise
            last_error = error
            wait_seconds = min(delay_cap_seconds, delay_seconds)
            print(
                f"{operation_name} failed with transient error ({error}); "
                f"retrying in {wait_seconds:.0f}s ({attempt}/{attempts}).",
                flush=True,
            )
            time.sleep(wait_seconds)
            delay_seconds = min(delay_cap_seconds, delay_seconds * backoff)

    assert last_error is not None
    raise last_error
