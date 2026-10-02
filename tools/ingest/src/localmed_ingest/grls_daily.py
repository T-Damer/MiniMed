"""Daily-batch wrapper around the polite GRLS collector.

GRLS limits its interactive pages (``.aspx``) to roughly 40-50 registrations per window and then
shows an image CAPTCHA. The owner decision (2026-10-02) is to collect over time without ever
solving or bypassing it: run the collector until the first CAPTCHA (or a batch cap), stop, wait
24 hours, probe with ONE registration, and only continue when the probe passes; otherwise wait
another 24 hours. This is a plain detached process (nohup + caffeinate); it uses no scheduler.

``progress.json`` in the log directory always describes the loop: ``status`` is ``running``,
``waiting``, ``stopped`` or ``finished`` together with the next attempt time and each window's
result. A ``STOP`` file in the log directory (or SIGTERM/SIGINT) ends the loop cleanly.
"""

from __future__ import annotations

import json
import signal
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal, cast

from .grls_collect import STOP_FILE_NAME, CollectOptions, run_collection
from .official_grls_registry import utc_now

WINDOW_PROGRESS_NAME = "window-progress.json"
LoopStatus = Literal["running", "waiting", "stopped", "finished"]


@dataclass(frozen=True)
class DailyOptions:
    batch_cap: int = 50
    wait_seconds: float = 24 * 3600.0
    first_attempt_at: datetime | None = None
    max_windows: int | None = None
    collect: CollectOptions = field(default_factory=CollectOptions)


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_daily_loop(
    plan_path: Path,
    output_root: Path,
    state_path: Path,
    log_dir: Path,
    options: DailyOptions,
    *,
    log: Callable[[str], None] | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, object]:
    log_dir.mkdir(parents=True, exist_ok=True)
    progress_path = log_dir / "progress.json"
    loop_log = log_dir / "daily-loop.log"
    stop_file = log_dir / STOP_FILE_NAME
    stop = threading.Event()
    windows: list[dict[str, object]] = []
    totals = {"success": 0, "permanent": 0, "transientRecorded": 0, "windows": 0, "captchas": 0}
    state: dict[str, object] = {
        "status": "waiting",
        "next_attempt_at": None,
        "current": None,
        "stop_reason": None,
    }

    def emit(message: str) -> None:
        line = f"{utc_now()} {message}"
        with loop_log.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        if log is not None:
            log(line)

    write_lock = threading.Lock()

    def write_progress(status: LoopStatus, *, current: dict[str, object] | None = None) -> None:
        with write_lock:
            _write_progress(status, current)

    def _write_progress(status: LoopStatus, current: dict[str, object] | None) -> None:
        state["status"] = status
        state["current"] = current
        payload: dict[str, object] = {
            "mode": "daily-batch",
            "status": status,
            "updatedAt": utc_now(),
            "nextAttemptAt": state["next_attempt_at"],
            "stopReason": state["stop_reason"],
            "batchCap": options.batch_cap,
            "waitHours": options.wait_seconds / 3600,
            "totals": totals,
            "currentWindow": current,
            "recentWindows": windows[-10:],
            "userAgent": options.collect.user_agent,
            "stopHint": f"touch {stop_file} (clean stop) or kill -TERM <pid>",
        }
        temporary = progress_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", "utf-8")
        temporary.replace(progress_path)

    def on_signal(signum: int, _frame: object) -> None:
        state["stop_reason"] = f"signal {signum}"
        stop.set()

    previous = (
        {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
        if threading.current_thread() is threading.main_thread()
        else {}
    )

    def stopping() -> bool:
        if stop_file.exists() and state["stop_reason"] is None:
            state["stop_reason"] = "STOP file present"
            stop.set()
        return stop.is_set()

    def wait_until(moment: datetime) -> bool:
        """Sleep in short slices; return False when a stop was requested."""
        state["next_attempt_at"] = _iso(moment)
        write_progress("waiting")
        emit(f"WAIT until {_iso(moment)}")
        while now() < moment:
            if stopping():
                return False
            sleep(min(30.0, max(0.0, (moment - now()).total_seconds())))
        return not stopping()

    def window(kind: str, limit: int) -> dict[str, object]:
        started = utc_now()
        current: dict[str, object] = {"kind": kind, "startedAt": started, "limit": limit}
        write_progress("running", current=current)
        emit(f"WINDOW {kind} limit={limit}")

        def on_progress(payload: dict[str, object]) -> None:
            write_progress("running", current={**current, "progress": payload})

        summary = run_collection(
            plan_path,
            output_root,
            state_path,
            log_dir,
            replace(options.collect, limit=limit),
            log=log,
            progress_name=WINDOW_PROGRESS_NAME,
            on_progress=on_progress,
            guard_blocked_marker=False,
        )
        counters = cast(dict[str, int], summary["counters"])
        result: dict[str, object] = {
            "kind": kind,
            "startedAt": started,
            "endedAt": utc_now(),
            "planned": summary["planned"],
            "processed": summary["processed"],
            "success": counters.get("success", 0),
            "permanent": counters.get("permanent", 0),
            "transientRecorded": counters.get("transient-recorded", 0),
            "blocked": summary["blocked"],
            "interrupted": summary["interrupted"],
            "stopReason": summary["stopReason"],
            "log": summary["log"],
        }
        windows.append(result)
        totals["windows"] += 1
        totals["success"] += counters.get("success", 0)
        totals["permanent"] += counters.get("permanent", 0)
        totals["transientRecorded"] += counters.get("transient-recorded", 0)
        if summary["blocked"] and "CAPTCHA" in str(summary["stopReason"]):
            totals["captchas"] += 1
        emit(f"WINDOW-END {kind} {json.dumps(result, ensure_ascii=False)}")
        return result

    try:
        if stopping():
            state["stop_reason"] = state["stop_reason"] or "STOP file present"
            write_progress("stopped")
            return {"status": "stopped", "stopReason": state["stop_reason"], "windows": windows}
        start = options.first_attempt_at or now()
        emit(f"LOOP start first_attempt={_iso(start)} batch_cap={options.batch_cap}")
        if not wait_until(start):
            write_progress("stopped")
            return {"status": "stopped", "stopReason": state["stop_reason"], "windows": windows}
        while True:
            probe = window("probe", 1)
            if probe["interrupted"]:
                state["stop_reason"] = probe["stopReason"]
                break
            if probe["planned"] == 0:
                state["stop_reason"] = "queue empty"
                write_progress("finished")
                emit("LOOP finished: queue empty")
                return {"status": "finished", "windows": windows}
            if not probe["blocked"]:
                batch = window("batch", options.batch_cap)
                if batch["interrupted"]:
                    state["stop_reason"] = batch["stopReason"]
                    break
            if options.max_windows is not None and totals["windows"] >= options.max_windows:
                state["stop_reason"] = "max windows reached"
                break
            if not wait_until(now() + timedelta(seconds=options.wait_seconds)):
                break
        write_progress("stopped")
        emit(f"LOOP stopped: {state['stop_reason']}")
        return {"status": "stopped", "stopReason": state["stop_reason"], "windows": windows}
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
