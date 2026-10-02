from __future__ import annotations

import json
from pathlib import Path

import pytest

import localmed_ingest.grls_collect as collect
from localmed_ingest.grls_collect import (
    BLOCKED_FILE_NAME,
    CollectOptions,
    FetchedInstruction,
    GrlsBackoff,
    GrlsCaptcha,
    classify_state_record,
    export_url_ledger,
    load_merged_state,
    run_collection,
    select_items,
    store_pdf,
)
from localmed_ingest.pdf_import import OcrSignal, RawBlock, ocr_signal_from_blocks

CHECKSUM = "sha256:plan"


def write_plan(path: Path, numbers: list[str]) -> None:
    items = [
        {
            "registrationNumber": number,
            "tradeName": f"Trade {number}",
            "target": f"pdf/{index}.pdf",
            "status": "eligible",
            "requestedRegistrationNumbers": [number],
        }
        for index, number in enumerate(numbers)
    ]
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "catalogEdition": "02.10.2026",
                "catalogChecksum": CHECKSUM,
                "items": items,
                "deferredItems": [],
            }
        ),
        encoding="utf-8",
    )


def write_state(path: Path, records: list[dict[str, object]]) -> None:
    path.write_text(
        "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records),
        encoding="utf-8",
    )


def failed(number: str, error: str, attempts: int = 3, **extra: object) -> dict[str, object]:
    return {
        "registrationNumber": number,
        "catalogChecksum": "sha256:old",
        "state": "failed",
        "error": error,
        "attempts": attempts,
        "recordedAt": "2026-09-27T13:00:00Z",
        **extra,
    }


def test_classify_state_record_separates_transient_from_permanent() -> None:
    assert classify_state_record(None) == "new"
    assert classify_state_record(failed("A", "<urlopen error [Errno 61] Connection refused>")) == (
        "transient"
    )
    assert classify_state_record(failed("A", "HTTP Error 429: Too Many Requests")) == "transient"
    assert classify_state_record(failed("A", "GRLS search did not return registration A.")) == (
        "permanent"
    )
    assert classify_state_record(failed("A", "anything", failureClass="transient")) == "transient"
    assert classify_state_record(failed("A", "anything", failureClass="search-miss")) == "permanent"
    assert classify_state_record({"state": "success"}) == "success"


def test_merged_state_keeps_success_across_checksums(tmp_path: Path) -> None:
    state = tmp_path / "state.jsonl"
    write_state(
        state,
        [
            {"registrationNumber": "A", "catalogChecksum": "x", "state": "success", "target": "t"},
            failed("A", "late failure"),
            failed("B", "first"),
            failed("B", "second"),
        ],
    )
    merged = load_merged_state(state)
    assert merged["A"]["state"] == "success"
    assert merged["B"]["error"] == "second"


def test_select_items_orders_transient_first_and_skips_closed_work(tmp_path: Path) -> None:
    plan = tmp_path / "plan.json"
    state = tmp_path / "state.jsonl"
    raw = tmp_path / "raw"
    (raw / "pdf").mkdir(parents=True)
    (raw / "pdf" / "2.pdf").write_bytes(b"%PDF-1")
    write_plan(plan, ["NEW", "TRANSIENT", "DONE", "ФС-000001", "EXHAUSTED", "MISS"])
    write_state(
        state,
        [
            failed("TRANSIENT", "<urlopen error timed out>"),
            {
                "registrationNumber": "DONE",
                "catalogChecksum": "x",
                "state": "success",
                "target": "pdf/2.pdf",
            },
            failed("ФС-000001", "<urlopen error timed out>"),
            failed("EXHAUSTED", "GRLS search did not return registration EXHAUSTED.", attempts=3),
            failed("MISS", "GRLS search did not return registration MISS.", attempts=1),
        ],
    )
    selected = select_items(plan, state, raw, CollectOptions())
    assert [item.registration_number for item in selected] == ["TRANSIENT", "NEW", "MISS"]
    with_substances = select_items(plan, state, raw, CollectOptions(include_substances=True))
    assert "ФС-000001" in [item.registration_number for item in with_substances]


def test_store_pdf_never_overwrites_an_earlier_raw_file(tmp_path: Path) -> None:
    first = store_pdf(tmp_path, "pdf/a.pdf", b"%PDF-1 first")
    assert first == "pdf/a.pdf"
    assert store_pdf(tmp_path, "pdf/a.pdf", b"%PDF-1 first") == "pdf/a.pdf"
    second = store_pdf(tmp_path, "pdf/a.pdf", b"%PDF-1 second")
    assert second != "pdf/a.pdf"
    assert (tmp_path / "pdf/a.pdf").read_bytes() == b"%PDF-1 first"
    assert (tmp_path / second).read_bytes() == b"%PDF-1 second"


def quiet_options(**overrides: object) -> CollectOptions:
    values: dict[str, object] = {
        "min_request_delay": 0.0,
        "max_request_delay": 0.0,
        "min_item_pause": 0.0,
        "max_item_pause": 0.0,
        "backoff_base_seconds": 0.0,
        "stop_after_consecutive_refusals": 3,
    }
    values.update(overrides)
    return CollectOptions(**values)  # type: ignore[arg-type]


def test_run_collection_records_success_and_resumes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan, state = tmp_path / "plan.json", tmp_path / "state.jsonl"
    write_plan(plan, ["A", "B"])
    calls: list[str] = []

    def fake_fetch(_client: object, number: str) -> FetchedInstruction:
        calls.append(number)
        return FetchedInstruction(
            f"https://grls.rosminzdrav.ru/{number}.pdf",
            "label",
            b"%PDF-1 " + number.encode(),
            None,
            None,
        )

    monkeypatch.setattr(collect, "fetch_instruction", fake_fetch)
    summary = run_collection(plan, tmp_path / "raw", state, tmp_path / "log", quiet_options())
    assert summary["status"] == "finished"
    merged = load_merged_state(state)
    assert {key: value["state"] for key, value in merged.items()} == {
        "A": "success",
        "B": "success",
    }
    assert merged["A"]["pdfSha256"] and merged["A"]["collector"] == "grls-collect-1"
    run_collection(plan, tmp_path / "raw", state, tmp_path / "log", quiet_options())
    assert calls == ["A", "B"]


def test_captcha_stops_the_run_and_blocks_a_restart(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan, state = tmp_path / "plan.json", tmp_path / "state.jsonl"
    write_plan(plan, ["A", "B"])

    def fake_fetch(_client: object, _number: str) -> FetchedInstruction:
        raise GrlsCaptcha("captcha", "<html>captcha</html>")

    monkeypatch.setattr(collect, "fetch_instruction", fake_fetch)
    log_dir = tmp_path / "log"
    summary = run_collection(plan, tmp_path / "raw", state, log_dir, quiet_options())
    assert summary["status"] == "stopped"
    assert (log_dir / BLOCKED_FILE_NAME).is_file()
    assert list(log_dir.glob("captcha-*.html"))
    assert not state.exists() or not load_merged_state(state)
    with pytest.raises(RuntimeError, match="stopped because the site started blocking"):
        run_collection(plan, tmp_path / "raw", state, log_dir, quiet_options())


def test_repeated_throttling_stops_instead_of_pressing_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan, state = tmp_path / "plan.json", tmp_path / "state.jsonl"
    write_plan(plan, ["A", "B", "C"])
    attempts: list[str] = []

    def fake_fetch(_client: object, number: str) -> FetchedInstruction:
        attempts.append(number)
        raise GrlsBackoff(429, None)

    monkeypatch.setattr(collect, "fetch_instruction", fake_fetch)
    summary = run_collection(plan, tmp_path / "raw", state, tmp_path / "log", quiet_options())
    assert summary["status"] == "stopped"
    assert len(attempts) == 3
    assert "consecutive refusals" in str(summary["stopReason"])


def test_ocr_signal_weights_confidence_by_characters() -> None:
    def block(page: int, text: str, confidence: float | None) -> RawBlock:
        return RawBlock(page, 100, 100, 0, (0, 0, 1, 1), text, None, None, False, 1, 0, confidence)

    blocks = [
        block(1, "x" * 90, 0.9),
        block(1, "y" * 10, 0.3),
        block(2, "native text", None),
    ]
    signal = ocr_signal_from_blocks(blocks, "macos-vision", {1})
    assert signal == OcrSignal("macos-vision", [1], 0.84, 0.1)
    assert ocr_signal_from_blocks(blocks, "pymupdf-ocr", {2}).mean_confidence is None


def test_priority_order_puts_essential_drugs_and_big_inns_first(tmp_path: Path) -> None:
    plan, state = tmp_path / "plan.json", tmp_path / "state.jsonl"
    write_plan(plan, ["RARE", "BIG", "ESSENTIAL", "MISS"])
    write_state(state, [failed("MISS", "GRLS search did not return registration MISS.", 1)])
    records: list[dict[str, object]] = [
        {"registrationNumber": "RARE", "inn": "редкин", "status": "Действующий"},
        {"registrationNumber": "BIG", "inn": "ибупрофен", "status": "Действующий"},
        {"registrationNumber": "BIG2", "inn": "ибупрофен", "status": "Действующий"},
        {
            "registrationNumber": "ESSENTIAL",
            "inn": "редкин",
            "status": "Действующий",
            "essentialDrug": "Да",
        },
        {
            "registrationNumber": "MISS",
            "inn": "ибупрофен",
            "status": "Действующий",
            "essentialDrug": "Да",
        },
    ]
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps({"records": records}), encoding="utf-8")
    selected = select_items(plan, state, tmp_path / "raw", CollectOptions(catalog_path=catalog))
    assert [item.registration_number for item in selected] == ["ESSENTIAL", "BIG", "RARE", "MISS"]


def test_success_records_id_reg_and_url_ledger(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan, state = tmp_path / "plan.json", tmp_path / "state.jsonl"
    write_plan(plan, ["A"])

    def fake_fetch(_client: object, _number: str) -> FetchedInstruction:
        url = "https://grls.rosminzdrav.ru/InstrImg/2026/10/02/1/x.pdf"
        return FetchedInstruction(
            url, "label", b"%PDF-1 a", "Mon", "etag", "123", "guid-1", ((url, "label"),)
        )

    monkeypatch.setattr(collect, "fetch_instruction", fake_fetch)
    run_collection(plan, tmp_path / "raw", state, tmp_path / "log", quiet_options())
    record = load_merged_state(state)["A"]
    assert record["idReg"] == "123" and record["routingGuid"] == "guid-1"
    summary = export_url_ledger(state, tmp_path / "urls.jsonl")
    assert summary["withIdReg"] == 1
    row = json.loads((tmp_path / "urls.jsonl").read_text().splitlines()[0])
    assert row["instructionUrls"][0]["url"].endswith("x.pdf") and row["idReg"] == "123"
