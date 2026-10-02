from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

import localmed_ingest.grls_daily as daily
from localmed_ingest.grls_collect import CollectOptions
from localmed_ingest.grls_daily import DailyOptions, run_daily_loop


class Clock:
    def __init__(self) -> None:
        self.moment = datetime(2026, 10, 3, 5, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self.moment

    def sleep(self, seconds: float) -> None:
        self.moment += timedelta(seconds=seconds)


def summary(
    processed: int, *, blocked: bool = False, planned: int | None = None
) -> dict[str, object]:
    return {
        "status": "stopped" if blocked else "finished",
        "stopReason": "CAPTCHA at X" if blocked else None,
        "blocked": blocked,
        "interrupted": False,
        "processed": processed,
        "planned": processed if planned is None else planned,
        "counters": {"success": processed},
        "log": "run.log",
    }


def test_loop_waits_probes_and_only_batches_after_a_clean_probe(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = Clock()
    calls: list[tuple[str, int, datetime]] = []
    answers = iter(
        [
            summary(1),  # probe passes
            summary(50),  # batch of 50
            summary(0, blocked=True, planned=1),  # next day's probe hits a CAPTCHA
            summary(0, planned=0),  # day after: queue empty
        ]
    )

    def fake_run(*args: object, **kwargs: object) -> dict[str, object]:
        options = args[4]
        assert isinstance(options, CollectOptions)
        calls.append(("run", options.limit or 0, clock.now()))
        assert kwargs["guard_blocked_marker"] is False
        return next(answers)

    monkeypatch.setattr(daily, "run_collection", fake_run)
    result = run_daily_loop(
        tmp_path / "plan.json",
        tmp_path / "raw",
        tmp_path / "state.jsonl",
        tmp_path / "log",
        DailyOptions(first_attempt_at=clock.now() + timedelta(hours=1)),
        now=clock.now,
        sleep=clock.sleep,
    )
    assert result["status"] == "finished"
    assert [(limit) for _, limit, _ in calls] == [1, 50, 1, 1]
    # nothing runs before the first attempt time; later windows are 24 h apart
    assert calls[0][2] == datetime(2026, 10, 3, 6, 0, tzinfo=UTC)
    assert calls[2][2] - calls[0][2] == timedelta(hours=24)
    assert calls[3][2] - calls[2][2] == timedelta(hours=24)
    progress = json.loads((tmp_path / "log" / "progress.json").read_text())
    assert progress["status"] == "finished"
    assert progress["totals"]["captchas"] == 1 and progress["totals"]["success"] == 51


def test_stop_file_ends_the_wait_cleanly(tmp_path: Path) -> None:
    clock = Clock()
    log_dir = tmp_path / "log"
    log_dir.mkdir()
    (log_dir / "STOP").write_text("")
    result = run_daily_loop(
        tmp_path / "plan.json",
        tmp_path / "raw",
        tmp_path / "state.jsonl",
        log_dir,
        DailyOptions(first_attempt_at=clock.now() + timedelta(days=1)),
        now=clock.now,
        sleep=clock.sleep,
    )
    assert result["status"] == "stopped"
    progress = json.loads((log_dir / "progress.json").read_text())
    assert progress["status"] == "stopped" and progress["stopReason"] == "STOP file present"
