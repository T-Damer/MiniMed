from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pymupdf
import pytest
import yaml

import localmed_ingest.official_grls_registry as grls
from localmed_ingest.official_grls_registry import (
    _hidden_fields,
    _instruction_url,
    build_grls_instruction_plan,
    build_grls_instruction_source_registry,
    parse_grls_archive,
    run_grls_instruction_batch,
)


def xlsx(status: str, rows: list[tuple[str, str]]) -> bytes:
    cells = [
        '<row r="1"/>',
        '<row r="2"/>',
        (
            '<row r="3"><c r="D3" t="inlineStr"><is><t>'
            "Государственный реестр по состоянию на 24.07.2026"
            "</t></is></c></row>"
        ),
        '<row r="4"/>',
        '<row r="5"/>',
        f'<row r="6"><c r="C6" t="inlineStr"><is><t>{status}</t></is></c></row>',
    ]
    for index, (registration_number, trade_name) in enumerate(rows, start=7):
        cells.append(
            f'<row r="{index}">'
            f'<c r="C{index}" t="inlineStr"><is><t>{registration_number}</t></is></c>'
            f'<c r="I{index}" t="inlineStr"><is><t>{trade_name}</t></is></c>'
            f'<c r="J{index}" t="inlineStr"><is><t>тестовое МНН</t></is></c>'
            f'<c r="K{index}" t="inlineStr"><is><t>'
            "таблетки, 500 мг - По рецепту;"
            "</t></is></c>"
            "</row>"
        )
    worksheet = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{''.join(cells)}</sheetData>"
        "</worksheet>"
    ).encode()
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    return output.getvalue()


def test_grls_archive_prefers_current_records_and_parses_instruction_metadata() -> None:
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr(
            "grls-Действует-на-подтверждении.xlsx",
            xlsx(
                "Действует, на подтверждении государственной регистрации",
                [("ЛП-1", "Текущий препарат")],
            ),
        )
        archive.writestr(
            "grls-Истёкший.xlsx",
            xlsx(
                "Истёкший",
                [("ЛП-1", "Старая редакция"), ("ЛП-2", "Исторический препарат")],
            ),
        )

    records, source_counts, edition = parse_grls_archive(output.getvalue())

    assert edition == "24.07.2026"
    assert source_counts == {
        "Действует, на подтверждении государственной регистрации": 1,
        "Истёкший": 2,
    }
    assert [(record["registrationNumber"], record["tradeName"]) for record in records] == [
        ("ЛП-1", "Текущий препарат"),
        ("ЛП-2", "Исторический препарат"),
    ]
    assert records[0]["dosageForm"] == "таблетки"
    assert records[0]["prescriptionStatus"] == "По рецепту"

    assert _hidden_fields('<input type="hidden" name="__VIEWSTATE" value="token" />') == {
        "__VIEWSTATE": "token"
    }
    url, label = _instruction_url(
        json.dumps(
            {
                "d": json.dumps(
                    {
                        "Sources": [
                            {
                                "Instructions": [
                                    {
                                        "Images": [
                                            {
                                                "Url": "\\InstrImg\\2026\\07\\24\\test.pdf",
                                                "Label": "Текущая инструкция",
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    },
                    ensure_ascii=False,
                )
            },
            ensure_ascii=False,
        ).encode()
    )
    assert url == "https://grls.rosminzdrav.ru/InstrImg/2026/07/24/test.pdf"
    assert label == "Текущая инструкция"


def _catalog(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "sourceEdition": "24.07.2026",
                "records": [
                    {
                        "registrationNumber": "2000/200/1",
                        "tradeName": "Legacy",
                        "status": "Действующий",
                    },
                    {
                        "registrationNumber": "ЛП-2",
                        "tradeName": "Active B",
                        "status": "Выдано по правилам ЕАЭС",
                        "inn": "Test INN",
                        "dosageForm": "tablets",
                        "holder": "Test holder",
                    },
                    {
                        "registrationNumber": "ЛП-current",
                        "tradeName": "Active B",
                        "status": "Действующий",
                        "inn": "Test INN",
                        "dosageForm": "tablets",
                        "holder": "Test holder",
                    },
                    {
                        "registrationNumber": "ЛП-1",
                        "tradeName": "Active A",
                        "status": "Действующий",
                    },
                    {
                        "registrationNumber": "ЛП-3",
                        "tradeName": "Active C",
                        "status": "Действующий",
                    },
                    {
                        "registrationNumber": "ЛП-old",
                        "tradeName": "Old",
                        "status": "Истёкший",
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_instruction_plan_keeps_only_active_records_with_catalog_identity(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog.json"
    plan_path = tmp_path / "plan.json"
    _catalog(catalog)

    summary = build_grls_instruction_plan(catalog, plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))

    assert summary["items"] == 3
    assert plan["catalogChecksum"].startswith("sha256:")
    assert [item["registrationNumber"] for item in plan["items"]] == [
        "ЛП-1",
        "ЛП-3",
        "ЛП-current",
    ]
    assert all(item["catalogEdition"] == "24.07.2026" for item in plan["items"])
    assert all(item["target"].startswith("pdf/") for item in plan["items"])
    assert plan["items"][-1]["requestedRegistrationNumbers"] == ["ЛП-2", "ЛП-current"]
    assert plan["totalDeferredItems"] == 1
    assert plan["deferredItems"] == [
        {
            "registrationNumber": "2000/200/1",
            "tradeName": "Legacy",
            "catalogEdition": "24.07.2026",
            "catalogChecksum": plan["catalogChecksum"],
            "target": plan["deferredItems"][0]["target"],
            "status": "deferred",
            "requestedRegistrationNumbers": ["2000/200/1"],
            "deferredReason": "legacy-registration-number-not-supported-by-interactive-search",
        }
    ]


def test_instruction_batch_is_append_safe_and_retries_only_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = tmp_path / "catalog.json"
    plan_path = tmp_path / "plan.json"
    state = tmp_path / "state.jsonl"
    output_root = tmp_path / "raw"
    _catalog(catalog)
    build_grls_instruction_plan(catalog, plan_path)
    calls: list[str] = []

    def fake_download(
        registration_number: str,
        *,
        timeout_seconds: float,
        opener: object,
    ) -> tuple[str, str, bytes]:
        del timeout_seconds, opener
        calls.append(registration_number)
        if registration_number == "ЛП-current" and calls.count(registration_number) == 1:
            raise ValueError("temporary GRLS failure")
        return (f"https://grls.rosminzdrav.ru/{registration_number}.pdf", "label", b"%PDF-test")

    monkeypatch.setattr(grls, "_download_grls_instruction", fake_download)

    first = run_grls_instruction_batch(plan_path, output_root, state, limit=3)
    second = run_grls_instruction_batch(plan_path, output_root, state, limit=3)
    rows = [json.loads(line) for line in state.read_text(encoding="utf-8").splitlines()]

    assert first == {
        "plan": str(plan_path),
        "state": str(state),
        "catalogEdition": "24.07.2026",
        "catalogChecksum": first["catalogChecksum"],
        "attempted": 3,
        "succeeded": 2,
        "failed": 1,
        "skipped": 0,
        "deferred": 0,
    }
    assert second["attempted"] == 1
    assert second["succeeded"] == 1
    assert second["failed"] == 0
    assert second["skipped"] == 2
    assert second["deferred"] == 0
    assert calls == ["ЛП-1", "ЛП-3", "ЛП-current", "ЛП-current"]
    assert [row["state"] for row in rows] == ["success", "success", "failed", "success"]
    assert rows[-1]["attempts"] == 2
    assert rows[-1]["pdfSha256"].startswith("sha256:")
    assert len(list(output_root.glob("pdf/*.pdf"))) == 3


def test_instruction_batch_defers_legacy_items_from_an_old_plan(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    catalog = tmp_path / "catalog.json"
    plan_path = tmp_path / "plan.json"
    state = tmp_path / "state.jsonl"
    _catalog(catalog)
    build_grls_instruction_plan(catalog, plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    legacy = plan["deferredItems"][0]
    plan["items"] = [legacy]
    plan_path.write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")

    def no_download(*args: object, **kwargs: object) -> tuple[str, str, bytes]:
        del args, kwargs
        raise AssertionError("legacy item must never be sent to GRLS search")

    monkeypatch.setattr(grls, "_download_grls_instruction", no_download)

    first = run_grls_instruction_batch(plan_path, tmp_path / "raw", state, limit=1)
    second = run_grls_instruction_batch(plan_path, tmp_path / "raw", state, limit=1)
    rows = [json.loads(line) for line in state.read_text(encoding="utf-8").splitlines()]

    assert first["attempted"] == 0
    assert first["deferred"] == 1
    assert second["deferred"] == 0
    assert second["skipped"] == 1
    assert rows[0]["state"] == "deferred"
    assert rows[0]["attempts"] == 0


def test_instruction_registry_uses_only_checksum_validated_current_pdfs(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog.json"
    plan_path = tmp_path / "plan.json"
    state = tmp_path / "state.jsonl"
    raw_root = tmp_path / "raw"
    output = tmp_path / "sources.yaml"
    _catalog(catalog)
    build_grls_instruction_plan(catalog, plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    item = plan["items"][-1]
    pdf = raw_root / item["target"]
    pdf.parent.mkdir(parents=True)
    document = pymupdf.open()
    document.new_page().insert_text((72, 72), "Тестовая инструкция")
    document.save(pdf)
    document.close()
    payload = pdf.read_bytes()
    state.write_text(
        json.dumps(
            {
                "registrationNumber": item["registrationNumber"],
                "catalogChecksum": plan["catalogChecksum"],
                "target": item["target"],
                "state": "success",
                "pdfSha256": grls._sha256(payload),
                "pdfBytes": len(payload),
                "instructionUrl": "https://grls.rosminzdrav.ru/test.pdf",
                "instructionLabel": "test",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    summary = build_grls_instruction_source_registry(plan_path, state, catalog, raw_root, output)
    registry = yaml.safe_load(output.read_text(encoding="utf-8"))

    assert summary["sources"] == 1
    assert summary["ocrCandidates"] == 0
    assert registry["sources"][0]["path"] == item["target"]
    assert registry["sources"][0]["metadata"]["requestedRegistrationNumbers"] == [
        "ЛП-2",
        "ЛП-current",
    ]


def test_instruction_registry_marks_scan_only_pdf_for_ocr(tmp_path: Path) -> None:
    catalog = tmp_path / "catalog.json"
    plan_path = tmp_path / "plan.json"
    state = tmp_path / "state.jsonl"
    raw_root = tmp_path / "raw"
    output = tmp_path / "sources.yaml"
    report = tmp_path / "report.json"
    _catalog(catalog)
    build_grls_instruction_plan(catalog, plan_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    item = plan["items"][-1]
    pdf = raw_root / item["target"]
    pdf.parent.mkdir(parents=True)
    document = pymupdf.open()
    document.new_page()
    document.save(pdf)
    document.close()
    payload = pdf.read_bytes()
    state.write_text(
        json.dumps(
            {
                "registrationNumber": item["registrationNumber"],
                "catalogChecksum": plan["catalogChecksum"],
                "target": item["target"],
                "state": "success",
                "pdfSha256": grls._sha256(payload),
                "pdfBytes": len(payload),
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    summary = build_grls_instruction_source_registry(
        plan_path, state, catalog, raw_root, output, report_output=report
    )

    assert summary["sources"] == 1
    assert json.loads(report.read_text(encoding="utf-8"))["ocrCandidates"] == 1
