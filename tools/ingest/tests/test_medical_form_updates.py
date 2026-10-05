from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any

import pytest

from localmed_ingest import medical_form_updates as updates
from localmed_ingest.medical_forms import FORM_BLUEPRINT_MODULES

REPO = Path(__file__).resolve().parents[3]
EO = "0001202505300033"
PDF = b"%PDF-1.4 fake official file"
PDF_SHA = hashlib.sha256(PDF).hexdigest()


def source_entry(**overrides: Any) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "eoNumber": EO,
        "orderNumber": "274н",
        "orderDate": "2025-05-13",
        "publishedAt": "2025-05-30",
        "title": "Об утверждении унифицированных форм",
        "pagesCount": 59,
        "bytes": len(PDF),
        "sha256": PDF_SHA,
        "watchTerms": ["унифицированных форм медицинской документации"],
        "watchRequire": ["амбулаторных условиях"],
        "acknowledgedOrders": [],
        "forms": [
            {
                "key": "070u",
                "formNumber": "070/у",
                "schemaFile": "ru-minzdrav-274n-070u.json",
            }
        ],
    }
    entry.update(overrides)
    return entry


def record(eo: str = EO, **extra: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "eoNumber": eo,
        "number": "274н",
        "documentDate": "2025-05-13T00:00:00",
        "publishDateShort": "2025-05-30T00:00:00",
        "pagesCount": 59,
        "pdfFileLength": len(PDF),
        "complexName": (
            "Приказ Министерства здравоохранения Российской Федерации от 13.05.2025 № 274н "
            '"Об утверждении"'
        ),
        "name": "Об утверждении",
    }
    base.update(extra)
    return base


class FakePortal:
    """Answers `/api/Documents` queries and PDF downloads from canned data."""

    def __init__(
        self,
        documents: dict[str, list[dict[str, Any]]],
        pdf: bytes = PDF,
        fail_on: str | None = None,
    ) -> None:
        self.documents = documents
        self.pdf = pdf
        self.fail_on = fail_on
        self.requests: list[str] = []

    def get_json(self, url: str) -> Any:
        self.requests.append(url)
        if self.fail_on and self.fail_on in url:
            raise updates.PortalError(f"network failure for {url}")
        from urllib.parse import parse_qs, urlparse

        query = parse_qs(urlparse(url).query)
        key = query.get("eoNumber", query.get("Name", [""]))[0]
        index = int(query["index"][0])
        items = self.documents.get(key, []) if index == 1 else []
        return {"items": items, "pagesTotalCount": 1, "currentPage": index}

    def get_bytes(self, url: str) -> bytes:
        self.requests.append(url)
        if self.fail_on and self.fail_on in url:
            raise updates.PortalError(f"network failure for {url}")
        return self.pdf

    def client(self) -> updates.PortalClient:
        return updates.PortalClient(get_json=self.get_json, get_bytes=self.get_bytes)


def test_references_order_requires_number_and_date_together() -> None:
    title = 'Приказ от 29.05.2024 № 9н "О внесении изменений в приказ от 13 мая 2025 г. № 274н"'
    assert updates.references_order(title, "274н", "2025-05-13")
    assert updates.references_order("… от 13.05.2025 № 274н …", "274н", "2025-05-13")
    # the same number of another order, or the same date with another number, is not a match
    assert not updates.references_order("… от 30 марта 2021 г. № 274н …", "274н", "2025-05-13")
    assert not updates.references_order("… от 13 мая 2025 г. № 2740н …", "274н", "2025-05-13")


def test_unchanged_source_with_no_related_orders() -> None:
    portal = FakePortal({EO: [record()], "274н": [record()]})
    result = updates.check_source(portal.client(), source_entry(), download=True)
    assert result.status == "unchanged"
    assert result.file["sha256"] == PDF_SHA
    assert result.errors == []


def test_changed_file_is_detected_by_checksum_size_and_pages() -> None:
    portal = FakePortal(
        {EO: [record(pagesCount=61, pdfFileLength=99999)], "274н": []},
        pdf=PDF + b" corrected",
    )
    result = updates.check_source(portal.client(), source_entry(), download=True)
    assert result.status == "changed"
    assert set(result.file["differences"]) == {
        "pages 59 → 61",
        "bytes 27 → 99999",
        "sha256 differs",
    }


def test_amending_and_repealing_orders_are_new_until_acknowledged() -> None:
    amending = record(
        "0001202701010001",
        number="9н",
        documentDate="2026-12-01T00:00:00",
        publishDateShort="2027-01-01T00:00:00",
        name=(
            "О внесении изменений в приказ Министерства здравоохранения Российской Федерации "
            'от 13 мая 2025 г. № 274н "Об утверждении"'
        ),
        complexName=(
            "Приказ Министерства здравоохранения Российской Федерации от 01.12.2026 № 9н "
            '"О внесении изменений в приказ Министерства здравоохранения Российской Федерации '
            'от 13 мая 2025 г. № 274н"'
        ),
    )
    unrelated = record(
        "0001202201010001",
        name="Об утверждении Порядка оказания помощи (приказ от 21 апреля 2022 г. № 274н)",
        complexName='Приказ Минздрава от 21.04.2022 № 274н "Об утверждении Порядка"',
    )
    portal = FakePortal({EO: [record()], "274н": [record(), amending, unrelated]})
    result = updates.check_source(portal.client(), source_entry(), download=True)
    assert result.status == "new"
    assert [order["eoNumber"] for order in result.amending_orders] == ["0001202701010001"]
    acknowledged = source_entry(acknowledgedOrders=["0001202701010001"])
    assert updates.check_source(portal.client(), acknowledged, download=True).status == "unchanged"


def test_a_new_ambulatory_forms_order_is_listed_for_a_human_only() -> None:
    replacement = record(
        "0001202801010001",
        number="1н",
        publishDateShort="2028-01-02T00:00:00",
        complexName="Приказ Министерства здравоохранения Российской Федерации от 01.12.2027 № 1н "
        '"Об утверждении унифицированных форм медицинской документации, используемых в '
        'медицинских организациях, оказывающих медицинскую помощь в амбулаторных условиях"',
        name="Об утверждении унифицированных форм",
    )
    donor = record(
        "0001202801010002",
        publishDateShort="2028-01-02T00:00:00",
        complexName="Приказ Министерства здравоохранения Российской Федерации "
        '"Об утверждении унифицированных форм медицинской документации, связанных с донорством"',
    )
    portal = FakePortal(
        {
            EO: [record()],
            "274н": [record()],
            "унифицированных форм медицинской документации": [record(), replacement, donor],
        }
    )
    result = updates.check_source(portal.client(), source_entry(), download=True)
    assert [order["eoNumber"] for order in result.possible_replacements] == ["0001202801010001"]
    assert result.status == "unchanged"


def test_network_failures_are_reported_never_swallowed(tmp_path: Path) -> None:
    portal = FakePortal({EO: [record()], "274н": []}, fail_on="file/pdf")
    result = updates.check_source(portal.client(), source_entry(), download=True)
    assert result.status == "error"
    assert "network failure" in result.errors[0]

    registry = tmp_path / "registry.json"
    registry.write_text(
        json.dumps(
            {
                "sources": [
                    source_entry(
                        forms=[
                            {"key": key, "formNumber": key, "schemaFile": f"{key}.json"}
                            for key in FORM_BLUEPRINT_MODULES
                        ]
                    )
                ]
            }
        ),
        encoding="utf-8",
    )
    down = FakePortal({}, fail_on="publication.pravo.gov.ru")
    report = updates.run_check(
        registry, tmp_path / "report.json", rebuild=False, download=True, client=down.client()
    )
    assert report["summary"]["error"] == 1
    saved = json.loads((tmp_path / "report.json").read_text(encoding="utf-8"))
    assert saved["sources"][0]["errors"]
    assert "ERROR" in updates.format_report(report)


def test_registry_and_blueprints_must_agree(tmp_path: Path) -> None:
    registry = {"sources": [source_entry()]}
    with pytest.raises(updates.FormSourceError, match="not registered"):
        updates.validate_registry(registry)


def test_committed_registry_matches_the_committed_schemas() -> None:
    registry = json.loads(updates.DEFAULT_REGISTRY.read_text(encoding="utf-8"))
    updates.validate_registry(registry)
    for source in registry["sources"]:
        assert len(source["sha256"]) == 64
        for form in source["forms"]:
            schema = json.loads(
                (updates.DEFAULT_SCHEMAS / form["schemaFile"]).read_text(encoding="utf-8")
            )
            assert schema["id"] == form["schemaId"]
            assert schema["source"]["sha256"] == source["sha256"]
            assert schema["formNumber"] == form["formNumber"]


def write_empty_ocr(pdf: Path, out: Path) -> None:
    out.write_text(json.dumps({"pages": [{"page": 1, "lines": []}]}), encoding="utf-8")


def test_rebuild_that_no_longer_matches_asks_for_a_human_and_changes_nothing(
    tmp_path: Path,
) -> None:
    registry = tmp_path / "registry.json"
    shutil.copy(updates.DEFAULT_REGISTRY, registry)
    before = registry.read_text(encoding="utf-8")
    schemas = tmp_path / "schemas"
    shutil.copytree(updates.DEFAULT_SCHEMAS, schemas)
    snapshot = {path.name: path.read_text(encoding="utf-8") for path in schemas.iterdir()}
    source = json.loads(before)["sources"][0]
    outcome = updates.rebuild_source(
        source,
        PDF,
        raw_dir=tmp_path / "raw",
        schemas_dir=schemas,
        staging_dir=tmp_path / "staging",
        registry_path=registry,
        ocr=write_empty_ocr,
    )
    assert outcome["outcome"] == "failed"
    assert outcome["humanReviewRequired"] is True
    assert "HUMAN REVIEW REQUIRED" in outcome["message"]
    assert all(not form["matched"] for form in outcome["forms"])
    assert registry.read_text(encoding="utf-8") == before
    assert {path.name: path.read_text(encoding="utf-8") for path in schemas.iterdir()} == snapshot
    assert not (tmp_path / "raw").exists()


def test_ocr_failure_is_reported_in_the_rebuild(tmp_path: Path) -> None:
    def broken(pdf: Path, out: Path) -> None:
        raise RuntimeError("swift is not installed")

    outcome = updates.rebuild_source(
        json.loads(updates.DEFAULT_REGISTRY.read_text(encoding="utf-8"))["sources"][0],
        PDF,
        raw_dir=tmp_path / "raw",
        schemas_dir=updates.DEFAULT_SCHEMAS,
        staging_dir=tmp_path / "staging",
        registry_path=tmp_path / "registry.json",
        ocr=broken,
    )
    assert outcome["outcome"] == "failed"
    assert "swift is not installed" in outcome["error"]


RAW_OCR = updates.DEFAULT_RAW / f"{EO}.ocr.json"


def copy_ocr(pdf: Path, out: Path) -> None:
    shutil.copy(RAW_OCR, out)


@pytest.mark.skipif(not RAW_OCR.exists(), reason="official OCR text is private raw data")
def test_rebuild_of_an_identical_edition_updates_registry_and_schemas(tmp_path: Path) -> None:
    registry = tmp_path / "registry.json"
    shutil.copy(updates.DEFAULT_REGISTRY, registry)
    schemas = tmp_path / "schemas"
    shutil.copytree(updates.DEFAULT_SCHEMAS, schemas)
    source = json.loads(registry.read_text(encoding="utf-8"))["sources"][0]
    official = (updates.DEFAULT_RAW / f"{EO}.pdf").read_bytes()
    outcome = updates.rebuild_source(
        source,
        official,
        raw_dir=tmp_path / "raw",
        schemas_dir=schemas,
        staging_dir=tmp_path / "staging",
        registry_path=registry,
        ocr=copy_ocr,
    )
    assert outcome["outcome"] == "updated", outcome
    assert outcome["humanReviewRequired"] is False
    assert all(form["matched"] and form["changedParagraphs"] == [] for form in outcome["forms"])
    assert (tmp_path / "raw" / f"{EO}.pdf").exists()
