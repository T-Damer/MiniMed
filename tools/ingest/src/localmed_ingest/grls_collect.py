"""Polite, resumable collector for public GRLS instruction PDFs.

Owner decision (2026-10-02): GRLS grants no database access, this is a personal single-user build,
and the public instruction documents are collected anyway, slowly. The collector therefore:

* sends a truthful ``User-Agent`` naming the project;
* keeps at most two requests in flight and randomizes the delay before every request;
* honours HTTP 429/503 (``Retry-After``) with exponential backoff and stops when the site keeps
  refusing, instead of pressing on;
* never solves or bypasses a CAPTCHA: a CAPTCHA marker stops the run;
* appends every outcome to the existing resumable state ledger and never overwrites a raw file.

It reuses the GRLS form/detail/instruction parsing of :mod:`official_grls_registry`.
"""

from __future__ import annotations

import hashlib
import http.client
import http.cookiejar
import json
import random
import re
import signal
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast

from .official_grls_registry import (
    GRLS_PAGE,
    GRLS_USER_AGENT,
    append_instruction_state,
    hidden_form_fields,
    instruction_images,
    read_instruction_plan,
    routing_guid,
    safe_instruction_target,
    utc_now,
    validate_grls_url,
)

COLLECTOR_ID = "grls-collect-1"
MAX_PDF_BYTES = 64 * 1024 * 1024
MAX_PAGE_BYTES = 8 * 1024 * 1024
MAX_WORKERS = 2
STOP_FILE_NAME = "STOP"
BLOCKED_FILE_NAME = "BLOCKED-by-site"

FailureClass = Literal[
    "transient",
    "search-miss",
    "no-pdf",
    "not-pdf",
    "forbidden",
    "http-error",
    "invalid-response",
    "substance-registry",
]

_CAPTCHA_MARKER = re.compile(r"captcha|капч|recaptcha", re.IGNORECASE)
_SUBSTANCE_PREFIX = "ФС-"


class GrlsBackoff(Exception):
    """HTTP 429/503: the server asked to slow down."""

    def __init__(self, status: int, retry_after_seconds: float | None) -> None:
        super().__init__(f"HTTP {status}")
        self.status = status
        self.retry_after_seconds = retry_after_seconds


class GrlsTransient(Exception):
    """Network-level failure or a 5xx answer; says nothing about the registration."""


class GrlsCaptcha(Exception):
    """The site answered with a CAPTCHA page; the run must stop."""

    def __init__(self, message: str, body: str = "") -> None:
        super().__init__(message)
        self.body = body


class GrlsForbidden(Exception):
    """HTTP 403."""


class GrlsPermanent(Exception):
    """The site answered normally but has no instruction for this registration."""

    def __init__(
        self,
        failure_class: FailureClass,
        message: str,
        context: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.failure_class: FailureClass = failure_class
        self.context: dict[str, object] = context or {}


@dataclass(frozen=True)
class CollectOptions:
    min_request_delay: float = 0.8
    max_request_delay: float = 2.0
    min_item_pause: float = 1.5
    max_item_pause: float = 4.0
    timeout_seconds: float = 45.0
    workers: int = 1
    backoff_base_seconds: float = 60.0
    backoff_cap_seconds: float = 900.0
    stop_after_consecutive_refusals: int = 5
    max_item_transient_retries: int = 2
    max_attempts: int = 3
    limit: int | None = None
    max_run_seconds: float | None = None
    registrations: tuple[str, ...] = ()
    include_substances: bool = False
    include_exhausted: bool = False
    catalog_path: Path | None = None
    user_agent: str = GRLS_USER_AGENT


@dataclass(frozen=True)
class CollectItem:
    registration_number: str
    target: str
    trade_name: str | None
    priority: int
    essential: bool = False
    mnn_registrations: int = 0


@dataclass
class _Shared:
    lock: threading.Lock = field(default_factory=threading.Lock)
    stop: threading.Event = field(default_factory=threading.Event)
    stop_reason: str | None = None
    pause_until: float = 0.0
    consecutive_refusals: int = 0
    counters: Counter[str] = field(default_factory=lambda: Counter[str]())
    started: float = field(default_factory=time.monotonic)


def _is_substance(registration_number: str) -> bool:
    return registration_number.startswith(_SUBSTANCE_PREFIX)


def classify_state_record(record: dict[str, object] | None) -> str:
    """Return ``new``, ``success``, ``transient``, ``permanent`` or ``deferred``."""
    if record is None:
        return "new"
    state = record.get("state")
    if state == "success":
        return "success"
    if state == "deferred":
        return "deferred"
    if state != "failed":
        return "new"
    error = str(record.get("error") or "")
    declared = record.get("failureClass")
    if declared == "transient":
        return "transient"
    if declared is not None:
        return "permanent"
    if any(
        marker in error
        for marker in (
            "Connection refused",
            "handshake operation timed out",
            "timed out",
            "nodename nor servname",
            "Too Many Requests",
            "Service Unavailable",
            "Temporary failure",
            "Connection reset",
            "Remote end closed",
        )
    ):
        return "transient"
    return "permanent"


def load_merged_state(state_path: Path) -> dict[str, dict[str, object]]:
    """Latest record per registration across every catalog checksum; success always wins."""
    merged: dict[str, dict[str, object]] = {}
    if not state_path.exists():
        return merged
    with state_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            decoded: object = json.loads(line)
            if not isinstance(decoded, dict):
                raise ValueError(f"GRLS state line {line_number} must be an object.")
            record = cast(dict[str, object], decoded)
            registration_number = record.get("registrationNumber")
            if not isinstance(registration_number, str):
                raise ValueError(f"GRLS state line {line_number} has no registration number.")
            previous = merged.get(registration_number)
            if (
                previous is not None
                and previous.get("state") == "success"
                and record.get("state") != "success"
            ):
                continue
            merged[registration_number] = record
    return merged


def build_priority_index(catalog_path: Path) -> tuple[dict[str, bool], dict[str, int]]:
    """Essential-drug flag (ЖНВЛП) per registration and active registrations per INN."""
    decoded: object = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    catalog = cast(dict[str, object], decoded) if isinstance(decoded, dict) else {}
    if not isinstance(catalog.get("records"), list):
        raise ValueError("GRLS catalog must contain a records list.")
    essential: dict[str, bool] = {}
    inn_by_registration: dict[str, str] = {}
    inn_counts: Counter[str] = Counter()
    for raw in cast(list[object], catalog["records"]):
        if not isinstance(raw, dict):
            continue
        record = cast(dict[str, object], raw)
        number = record.get("registrationNumber")
        if not isinstance(number, str):
            continue
        essential[number] = record.get("essentialDrug") == "Да"
        status = str(record.get("status") or "").casefold().replace("ё", "е")
        inn = " ".join(str(record.get("inn") or "").casefold().split())
        if inn and inn != "~":
            inn_by_registration[number] = inn
            if "действ" in status or "еаэс" in status:
                inn_counts[inn] += 1
    mnn_registrations = {number: inn_counts[inn] for number, inn in inn_by_registration.items()}
    return essential, mnn_registrations


def select_items(
    plan_path: Path,
    state_path: Path,
    output_root: Path,
    options: CollectOptions,
) -> list[CollectItem]:
    """Order work by value, then by how likely a retry is to succeed.

    Likely-to-succeed work (transient failures and never-attempted registrations) goes before
    registrations the site did not find; inside each group essential drugs (ЖНВЛП) come first, then
    active ingredients with the most registrations, then the registration number. Without a
    catalog the order is transient, new, not-found.
    """
    plan = read_instruction_plan(plan_path)
    state = load_merged_state(state_path)
    requested = set(options.registrations)
    essential_flags: dict[str, bool] = {}
    mnn_counts: dict[str, int] = {}
    if options.catalog_path is not None:
        essential_flags, mnn_counts = build_priority_index(options.catalog_path)
    selected: list[CollectItem] = []
    for raw in cast(list[object], plan["items"]):
        if not isinstance(raw, dict):
            raise ValueError("GRLS instruction plan item must be an object.")
        item = cast(dict[str, object], raw)
        registration_number = item.get("registrationNumber")
        target = item.get("target")
        if not isinstance(registration_number, str) or not isinstance(target, str):
            raise ValueError("GRLS plan item requires registrationNumber and target.")
        if requested and registration_number not in requested:
            continue
        record = state.get(registration_number)
        status = classify_state_record(record)
        if status == "success" and record is not None:
            existing = safe_instruction_target(output_root, str(record.get("target") or target))
            if existing.is_file():
                continue
            status = "new"
        if status == "deferred":
            continue
        if not options.include_substances and _is_substance(registration_number):
            continue
        if status == "permanent":
            attempts = record.get("attempts") if record else 0
            exhausted = isinstance(attempts, int) and attempts >= options.max_attempts
            if exhausted and not options.include_exhausted:
                continue
            priority = 2
        elif status == "transient":
            priority = 0
        else:
            priority = 1
        trade_name = item.get("tradeName")
        requested_numbers = item.get("requestedRegistrationNumbers")
        covered = (
            [value for value in cast(list[object], requested_numbers) if isinstance(value, str)]
            if isinstance(requested_numbers, list)
            else []
        ) or [registration_number]
        selected.append(
            CollectItem(
                registration_number,
                target,
                trade_name if isinstance(trade_name, str) else None,
                priority,
                essential=any(essential_flags.get(number, False) for number in covered),
                mnn_registrations=max(mnn_counts.get(number, 0) for number in covered),
            )
        )
    if options.catalog_path is None:
        selected.sort(key=lambda entry: (entry.priority, entry.registration_number))
    else:
        selected.sort(
            key=lambda entry: (
                entry.priority == 2,
                not entry.essential,
                -entry.mnn_registrations,
                entry.priority,
                entry.registration_number,
            )
        )
    return selected


class _PoliteClient:
    """One cookie session; paces every request with a randomized delay."""

    def __init__(self, options: CollectOptions, shared: _Shared, rng: random.Random) -> None:
        self._options = options
        self._shared = shared
        self._rng = rng
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        self._last_request_end = 0.0

    def pause_between_items(self) -> None:
        self._sleep(self._rng.uniform(self._options.min_item_pause, self._options.max_item_pause))

    def _sleep(self, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while not self._shared.stop.is_set():
            now = time.monotonic()
            deadline = max(deadline, self._shared.pause_until)
            remaining = deadline - now
            if remaining <= 0:
                return
            time.sleep(min(remaining, 1.0))

    def request(
        self,
        url: str,
        *,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        maximum: int = MAX_PAGE_BYTES,
        want_headers: bool = False,
    ) -> tuple[bytes, dict[str, str]]:
        validate_grls_url(url)
        self._sleep(
            self._rng.uniform(self._options.min_request_delay, self._options.max_request_delay)
        )
        if self._shared.stop.is_set():
            raise GrlsTransient("run stopped")
        request = urllib.request.Request(
            url,
            data=data,
            headers={"User-Agent": self._options.user_agent, **(headers or {})},
            method="POST" if data is not None else "GET",
        )
        try:
            with self._opener.open(request, timeout=self._options.timeout_seconds) as response:
                final_url = response.geturl()
                validate_grls_url(final_url)
                body = response.read(maximum + 1)
                response_headers = (
                    {key.lower(): value for key, value in response.headers.items()}
                    if want_headers
                    else {}
                )
        except urllib.error.HTTPError as error:
            if error.code in (429, 503):
                raise GrlsBackoff(
                    error.code, _retry_after(error.headers.get("Retry-After"))
                ) from error
            if error.code == 403:
                raise GrlsForbidden("HTTP 403 Forbidden") from error
            if error.code >= 500 or error.code == 408:
                raise GrlsTransient(f"HTTP {error.code}") from error
            raise GrlsPermanent("http-error", f"HTTP {error.code}") from error
        except (
            urllib.error.URLError,
            TimeoutError,
            ssl.SSLError,
            ConnectionError,
            http.client.HTTPException,
            OSError,
        ) as error:
            raise GrlsTransient(f"{type(error).__name__}: {error}") from error
        finally:
            self._last_request_end = time.monotonic()
        if len(body) > maximum:
            raise GrlsPermanent("invalid-response", f"response exceeds {maximum} bytes")
        if not body:
            raise GrlsTransient("empty response")
        return body, response_headers

    def page(
        self, url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None
    ) -> str:
        body, _ = self.request(url, data=data, headers=headers)
        text = body.decode("utf-8-sig", errors="replace")
        if _CAPTCHA_MARKER.search(text):
            raise GrlsCaptcha("CAPTCHA marker in GRLS response", text)
        return text


def _retry_after(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


@dataclass(frozen=True)
class FetchedInstruction:
    url: str
    label: str
    pdf: bytes
    last_modified: str | None
    etag: str | None
    id_reg: str | None = None
    routing_guid: str | None = None
    images: tuple[tuple[str, str], ...] = ()


def fetch_instruction(client: _PoliteClient, registration_number: str) -> FetchedInstruction:
    form_page = client.page(GRLS_PAGE)
    fields = hidden_form_fields(form_page)
    fields.update(
        {
            "ctl00$plate$isFS": "0",
            "ctl00$plate$txtRegNm": registration_number,
            "ctl00$plate$txtRecordOnPageCount": "10",
            "ctl00$plate$bSeek": "Найти",
        }
    )
    result_page = client.page(
        GRLS_PAGE,
        data=urllib.parse.urlencode(fields).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": GRLS_PAGE},
    )
    try:
        guid = routing_guid(result_page, registration_number)
    except ValueError as error:
        raise GrlsPermanent("search-miss", str(error)) from error
    context: dict[str, object] = {"routingGuid": guid}
    detail_url = urllib.parse.urljoin(
        GRLS_PAGE, f"Grls_View_v2.aspx?routingGuid={urllib.parse.quote(guid)}"
    )
    detail_page = client.page(detail_url)
    id_match = re.search(r'id=["\']ctl00_plate_hfIdReg["\'][^>]*value=["\'](\d+)["\']', detail_page)
    if id_match is None:
        raise GrlsPermanent(
            "invalid-response",
            f"detail page has no idReg for {registration_number}",
            context,
        )
    context["idReg"] = id_match.group(1)
    endpoint = urllib.parse.urljoin(GRLS_PAGE, "GRLS_View_V2.aspx/AddInstrImg")
    response_body, _ = client.request(
        endpoint,
        data=json.dumps(
            {"regNumber": registration_number, "idReg": id_match.group(1)}, ensure_ascii=False
        ).encode(),
        headers={"Content-Type": "application/json; charset=utf-8", "Referer": detail_url},
    )
    try:
        images = instruction_images(response_body)
    except ValueError as error:
        message = str(error)
        failure: FailureClass = "no-pdf" if "no instruction PDF" in message else "invalid-response"
        raise GrlsPermanent(failure, message, context) from error
    url, label = max(images, key=lambda image: image[0])
    pdf, headers = client.request(url, maximum=MAX_PDF_BYTES, want_headers=True)
    if not pdf.startswith(b"%PDF-"):
        decoded = pdf[:200_000].decode("utf-8-sig", errors="replace")
        if _CAPTCHA_MARKER.search(decoded):
            raise GrlsCaptcha("CAPTCHA marker in GRLS PDF response", decoded)
        raise GrlsPermanent(
            "not-pdf", f"instruction for {registration_number} is not a PDF", context
        )
    return FetchedInstruction(
        url,
        label,
        pdf,
        headers.get("last-modified"),
        headers.get("etag"),
        id_reg=id_match.group(1),
        routing_guid=guid,
        images=tuple(images),
    )


def store_pdf(output_root: Path, target_relative: str, pdf: bytes) -> str:
    """Write the PDF without ever replacing an earlier raw file; return the relative target."""
    digest = hashlib.sha256(pdf).hexdigest()
    target = safe_instruction_target(output_root, target_relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() == digest:
            return target_relative
        relative = Path(target_relative)
        target_relative = str(relative.with_name(f"{relative.stem}.{digest[:12]}{relative.suffix}"))
        target = safe_instruction_target(output_root, target_relative)
        if target.exists():
            return target_relative
    temporary = target.with_name(f".{target.name}.tmp")
    temporary.write_bytes(pdf)
    temporary.replace(target)
    return target_relative


def _record(
    item: CollectItem,
    plan: dict[str, object],
    attempts: int,
    **overrides: object,
) -> dict[str, object]:
    base: dict[str, object] = {
        "schemaVersion": 1,
        "recordedAt": utc_now(),
        "registrationNumber": item.registration_number,
        "catalogEdition": plan["catalogEdition"],
        "catalogChecksum": plan["catalogChecksum"],
        "attempts": attempts,
        "target": item.target,
        "instructionUrl": None,
        "instructionLabel": None,
        "resolvedRegistrationNumber": None,
        "pdfSha256": None,
        "pdfBytes": None,
        "error": None,
        "collector": COLLECTOR_ID,
    }
    base.update(overrides)
    return base


def run_collection(
    plan_path: Path,
    output_root: Path,
    state_path: Path,
    log_dir: Path,
    options: CollectOptions,
    *,
    log: Callable[[str], None] | None = None,
    progress_name: str = "progress.json",
    on_progress: Callable[[dict[str, object]], None] | None = None,
    guard_blocked_marker: bool = True,
) -> dict[str, object]:
    if options.workers < 1 or options.workers > MAX_WORKERS:
        raise ValueError(f"workers must be between 1 and {MAX_WORKERS}.")
    plan = read_instruction_plan(plan_path)
    state = load_merged_state(state_path)
    items = select_items(plan_path, state_path, output_root, options)
    if options.limit is not None:
        items = items[: options.limit]
    log_dir.mkdir(parents=True, exist_ok=True)
    blocked_file = log_dir / BLOCKED_FILE_NAME
    if guard_blocked_marker and blocked_file.exists():
        raise RuntimeError(
            f"{blocked_file} exists: a previous run was stopped because the site started "
            "blocking (CAPTCHA or repeated refusals). Read it and delete it only after the "
            "owner decides to resume."
        )
    stop_file = log_dir / STOP_FILE_NAME
    progress_path = log_dir / progress_name
    run_log = log_dir / f"run-{utc_now().replace(':', '')}.log"
    shared = _Shared()
    queue: Iterator[CollectItem] = iter(items)
    total = len(items)

    def emit(message: str) -> None:
        line = f"{utc_now()} {message}"
        with shared.lock, run_log.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        if log is not None:
            log(line)

    def write_progress(status: str) -> None:
        elapsed = time.monotonic() - shared.started
        done = sum(shared.counters[key] for key in ("success", "permanent", "transient-recorded"))
        payload: dict[str, object] = {
            "status": status,
            "updatedAt": utc_now(),
            "planned": total,
            "processed": done,
            "elapsedSeconds": round(elapsed),
            "ratePerHour": round(done / elapsed * 3600, 1) if elapsed > 0 else 0,
            "etaHours": round((total - done) / (done / elapsed) / 3600, 1) if done else None,
            "counters": dict(sorted(shared.counters.items())),
            "stopReason": shared.stop_reason,
            "userAgent": options.user_agent,
        }
        temporary = progress_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
        temporary.replace(progress_path)
        if on_progress is not None:
            on_progress(payload)

    def request_stop(reason: str) -> None:
        with shared.lock:
            if shared.stop_reason is None:
                shared.stop_reason = reason
        shared.stop.set()
        emit(f"STOP {reason}")

    def on_signal(signum: int, _frame: object) -> None:
        request_stop(f"signal {signum}")

    previous_handlers = (
        {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
        if threading.current_thread() is threading.main_thread()
        else {}
    )

    def next_item() -> CollectItem | None:
        with shared.lock:
            if shared.stop.is_set():
                return None
            if stop_file.exists():
                shared.stop_reason = "STOP file present"
                shared.stop.set()
                return None
            if (
                options.max_run_seconds is not None
                and time.monotonic() - shared.started > options.max_run_seconds
            ):
                shared.stop_reason = "max run seconds reached"
                shared.stop.set()
                return None
            return next(queue, None)

    def register_refusal(kind: str) -> float:
        with shared.lock:
            shared.consecutive_refusals += 1
            count = shared.consecutive_refusals
            shared.counters[f"refusal-{kind}"] += 1
        delay = min(options.backoff_cap_seconds, options.backoff_base_seconds * 2 ** (count - 1))
        return delay

    def clear_refusals() -> None:
        with shared.lock:
            shared.consecutive_refusals = 0

    def append(record: dict[str, object]) -> None:
        with shared.lock:
            append_instruction_state(state_path, record)

    def worker(index: int) -> None:
        rng = random.Random(f"{time.time_ns()}-{index}")
        client = _PoliteClient(options, shared, rng)
        while (item := next_item()) is not None:
            previous = state.get(item.registration_number)
            previous_attempts = previous.get("attempts", 0) if previous else 0
            attempts = previous_attempts if isinstance(previous_attempts, int) else 0
            transient_tries = 0
            while not shared.stop.is_set():
                try:
                    fetched = fetch_instruction(client, item.registration_number)
                    target = store_pdf(output_root, item.target, fetched.pdf)
                    sha = f"sha256:{hashlib.sha256(fetched.pdf).hexdigest()}"
                    append(
                        _record(
                            item,
                            plan,
                            attempts + 1,
                            state="success",
                            target=target,
                            instructionUrl=fetched.url,
                            instructionLabel=fetched.label,
                            resolvedRegistrationNumber=item.registration_number,
                            pdfSha256=sha,
                            pdfBytes=len(fetched.pdf),
                            httpLastModified=fetched.last_modified,
                            httpEtag=fetched.etag,
                            idReg=fetched.id_reg,
                            routingGuid=fetched.routing_guid,
                            instructionUrls=[
                                {"url": url, "label": label} for url, label in fetched.images
                            ],
                        )
                    )
                    clear_refusals()
                    with shared.lock:
                        shared.counters["success"] += 1
                    emit(f"OK {item.registration_number} {len(fetched.pdf)} {sha[:19]}")
                    break
                except GrlsCaptcha as error:
                    # Never solve or work around it: keep the page for the report and stop.
                    evidence = log_dir / f"captcha-{utc_now().replace(':', '')}.html"
                    evidence.write_text(error.body, encoding="utf-8")
                    request_stop(
                        f"CAPTCHA at {item.registration_number}: {error} (page saved to {evidence})"
                    )
                    break
                except GrlsBackoff as error:
                    delay = register_refusal(f"http-{error.status}")
                    if error.retry_after_seconds is not None:
                        delay = max(delay, min(error.retry_after_seconds, 3600.0))
                    emit(f"BACKOFF {error.status} {item.registration_number} sleep={delay:.0f}s")
                    with shared.lock:
                        shared.pause_until = max(shared.pause_until, time.monotonic() + delay)
                    if shared.consecutive_refusals >= options.stop_after_consecutive_refusals:
                        request_stop(
                            f"{shared.consecutive_refusals} consecutive refusals "
                            f"(HTTP {error.status}); the site is slowing us down or blocking"
                        )
                        break
                except GrlsForbidden as error:
                    register_refusal("http-403")
                    emit(f"FORBIDDEN {item.registration_number} {error}")
                    if shared.consecutive_refusals >= options.stop_after_consecutive_refusals:
                        request_stop("consecutive HTTP 403 responses; the site is blocking")
                        break
                    append(
                        _record(
                            item,
                            plan,
                            attempts + 1,
                            state="failed",
                            failureClass="forbidden",
                            error=str(error),
                        )
                    )
                    with shared.lock:
                        shared.counters["permanent"] += 1
                    break
                except GrlsTransient as error:
                    delay = register_refusal("transient")
                    transient_tries += 1
                    emit(
                        f"TRANSIENT {item.registration_number} try={transient_tries} "
                        f"streak={shared.consecutive_refusals} {error}"
                    )
                    if shared.consecutive_refusals >= options.stop_after_consecutive_refusals:
                        request_stop(
                            f"{shared.consecutive_refusals} consecutive network failures "
                            f"({error}); the site is unreachable or blocking"
                        )
                        break
                    with shared.lock:
                        shared.pause_until = max(shared.pause_until, time.monotonic() + delay)
                    if transient_tries > options.max_item_transient_retries:
                        append(
                            _record(
                                item,
                                plan,
                                attempts,
                                state="failed",
                                failureClass="transient",
                                error=str(error),
                            )
                        )
                        with shared.lock:
                            shared.counters["transient-recorded"] += 1
                        break
                except GrlsPermanent as error:
                    clear_refusals()
                    append(
                        _record(
                            item,
                            plan,
                            attempts + 1,
                            state="failed",
                            failureClass=error.failure_class,
                            error=str(error),
                            **error.context,
                        )
                    )
                    with shared.lock:
                        shared.counters["permanent"] += 1
                        shared.counters[f"permanent-{error.failure_class}"] += 1
                    emit(f"MISS {item.registration_number} {error.failure_class} {error}")
                    break
            processed = sum(
                shared.counters[key] for key in ("success", "permanent", "transient-recorded")
            )
            if processed:
                write_progress("running")
            client.pause_between_items()

    emit(
        f"START plan={plan_path.name} items={total} workers={options.workers} "
        f"delay={options.min_request_delay}-{options.max_request_delay}s "
        f"item_pause={options.min_item_pause}-{options.max_item_pause}s ua={options.user_agent!r}"
    )
    write_progress("running")
    threads = [
        threading.Thread(target=worker, args=(index,), name=f"grls-{index}", daemon=True)
        for index in range(options.workers)
    ]
    try:
        for thread in threads:
            thread.start()
            time.sleep(random.uniform(2.0, 5.0))
        for thread in threads:
            thread.join()
    finally:
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
    status = "stopped" if shared.stop_reason else "finished"
    if (
        guard_blocked_marker
        and shared.stop_reason
        and ("CAPTCHA" in shared.stop_reason or "consecutive" in shared.stop_reason)
    ):
        blocked_file.write_text(
            f"{utc_now()} {shared.stop_reason}\n"
            "Collection stopped because the site started blocking. Do not resume without the "
            "owner's decision; delete this file to allow another run.\n",
            encoding="utf-8",
        )
    write_progress(status)
    emit(f"END {status} {dict(sorted(shared.counters.items()))}")
    interrupted = bool(
        shared.stop_reason
        and (shared.stop_reason.startswith("signal") or "STOP file" in shared.stop_reason)
    )
    blocked = bool(
        shared.stop_reason
        and ("CAPTCHA" in shared.stop_reason or "consecutive" in shared.stop_reason)
    )
    return {
        "status": status,
        "stopReason": shared.stop_reason,
        "blocked": blocked,
        "interrupted": interrupted,
        "processed": sum(
            shared.counters[key] for key in ("success", "permanent", "transient-recorded")
        ),
        "planned": total,
        "counters": dict(sorted(shared.counters.items())),
        "log": str(run_log),
        "progress": str(progress_path),
    }


def export_url_ledger(state_path: Path, output: Path) -> dict[str, object]:
    """One row per collected registration with every identifier needed to re-fetch it.

    ``idReg``/``routingGuid`` exist only for records written since the collector started to log
    them; older successes keep the exact PDF URL, checksum and fetch time from the state ledger.
    A later update or re-download of a known URL needs only the static file request.
    """
    latest: dict[str, dict[str, object]] = {}
    ids: dict[str, dict[str, object]] = {}
    with state_path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = cast(dict[str, object], json.loads(line))
            number = cast(str, record["registrationNumber"])
            for key in ("idReg", "routingGuid"):
                if record.get(key):
                    ids.setdefault(number, {})[key] = record[key]
            if record.get("state") == "success":
                latest[number] = record
    rows = 0
    with output.open("w", encoding="utf-8") as handle:
        for number in sorted(latest):
            record = latest[number]
            urls = record.get("instructionUrls")
            row: dict[str, object] = {
                "registrationNumber": number,
                "idReg": ids.get(number, {}).get("idReg"),
                "routingGuid": ids.get(number, {}).get("routingGuid"),
                "instructionUrl": record.get("instructionUrl"),
                "instructionUrls": urls
                if isinstance(urls, list)
                else [
                    {"url": record.get("instructionUrl"), "label": record.get("instructionLabel")}
                ],
                "pdfSha256": record.get("pdfSha256"),
                "pdfBytes": record.get("pdfBytes"),
                "target": record.get("target"),
                "fetchedAt": record.get("recordedAt"),
                "httpLastModified": record.get("httpLastModified"),
                "httpEtag": record.get("httpEtag"),
            }
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            rows += 1
    with_ids = sum(1 for number in latest if "idReg" in ids.get(number, {}))
    return {"output": str(output), "registrations": rows, "withIdReg": with_ids}
