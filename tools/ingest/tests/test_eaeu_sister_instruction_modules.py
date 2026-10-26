"""Pure parts of the EAEU sister-register instruction module builder: selection per registration and
kind, registry entries with country and register, the OCR re-check and front-matter staging."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from localmed_ingest.eaeu_sister_instruction_modules import (
    MODULE_ID,
    SOURCE_CLASS,
    augmented_markdown,
    plan_documents,
    recheck_reason,
    registry_source,
    split_front_matter,
    write_registries,
)

SHA = {name: name * 64 for name in "abcdef"}


def row(
    sha: str,
    *,
    number: str = "ЛП-№(002280)-(РГ-RU)",
    country: str = "BY",
    kind: str = "leaflet",
    check: str = "trade-name",
    accepted: bool = True,
    covered: list[str] | None = None,
) -> dict[str, Any]:
    url = (
        f"https://www.rceth.by/NDfiles/pdfeaec/002280/{'LV' if kind == 'leaflet' else 'OHLP'}.pdf"
        if country == "BY"
        else "https://register.ndda.kz/register/api/v1/PharmaRegister/getRegisterInstructionFile"
        f"?registerId=99000232&lang=ru&{kind}"
    )
    return {
        "accepted": accepted,
        "country": country,
        "coveredRegistrationNumbers": covered or [number],
        "documentKind": kind,
        "dossier": "002280",
        "essentialDrug": True,
        "fetchedAt": "2026-10-13T20:13:47Z",
        "httpLastModified": "Fri, 17 Apr 2026 06:32:18 GMT",
        "inn": "Фамотидин",
        "matchMethod": "shared-dossier-number",
        "registrationNumber": number,
        "sha256": sha,
        "sisterCertificate": f"ЛП-№002280-ГП-{country}",
        "sisterTradeName": "Квамател®",
        "sourceClass": SOURCE_CLASS,
        "textCheck": check,
        "tradeName": "Квамател",
        "url": url,
    }


def store(raw: Path, rows: list[dict[str, Any]], suffix: str = "pdf") -> None:
    for item in rows:
        path = raw / "files" / item["country"] / f"{item['sha256']}.{suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"%PDF-1.4 fixture")


def test_belarus_is_chosen_per_registration_and_kind_and_rejected_rows_never_count(
    tmp_path: Path,
) -> None:
    rows = [
        row(SHA["a"], country="BY", kind="leaflet"),
        row(SHA["b"], country="KZ", kind="leaflet"),
        row(SHA["c"], country="KZ", kind="ohlp"),  # the only ОХЛП: Kazakhstan's is used
        row(SHA["d"], number="ЛП-№(000092)-(РГ-RU)", accepted=False),
    ]
    store(tmp_path, rows)
    plan = plan_documents(rows, tmp_path)
    assert [(d.sha256, d.country, d.kind) for d in plan.documents] == [
        (SHA["a"], "BY", "leaflet"),
        (SHA["c"], "KZ", "ohlp"),
    ]
    assert plan.rejected_rows == 1
    assert plan.not_chosen == (
        {
            "registrationNumber": "ЛП-№(002280)-(РГ-RU)",
            "documentKind": "leaflet",
            "country": "KZ",
            "sha256": SHA["b"],
            "reason": "the BY file of the same kind was chosen",
        },
    )


def test_one_file_serves_every_registration_it_was_chosen_for(tmp_path: Path) -> None:
    rows = [
        row(SHA["a"], number="ЛП-№(002280)-(РГ-RU)"),
        row(SHA["a"], number="ЛП-№(002281)-(РГ-RU)", covered=["ЛП-008000"]),
    ]
    store(tmp_path, rows)
    (document,) = plan_documents(rows, tmp_path).documents
    assert document.registration_numbers == (
        "ЛП-008000",
        "ЛП-№(002280)-(РГ-RU)",
        "ЛП-№(002281)-(РГ-RU)",
    )
    assert document.document_id == f"drug.rf.eaeu.{'a' * 20}.instruction"


def test_registry_entry_names_country_register_kind_and_provenance(tmp_path: Path) -> None:
    rows = [row(SHA["a"], kind="ohlp")]
    store(tmp_path, rows)
    (document,) = plan_documents(rows, tmp_path).documents
    entry = registry_source(document)
    assert entry["title"] == "Квамател: общая характеристика лекарственного препарата (ОХЛП)"
    assert entry["sourceType"] == "official_drug_instruction" and entry["format"] == "pdf"
    assert entry["path"] == f"files/BY/{SHA['a']}.pdf"
    metadata = entry["metadata"]
    assert metadata["sourceClass"] == SOURCE_CLASS
    assert metadata["country"] == "BY" and metadata["countryName"] == "Республика Беларусь"
    assert metadata["register"].endswith("Республики Беларусь")
    assert metadata["documentKind"] == "ohlp"
    assert metadata["officialSourceUrl"] == "https://www.rceth.by/NDfiles/pdfeaec/002280/OHLP.pdf"
    assert metadata["pdfSha256"] == f"sha256:{SHA['a']}"
    assert metadata["fetchedAt"] == "2026-10-13T20:13:47Z"
    assert metadata["sisterCertificate"] == "ЛП-№002280-ГП-BY"
    assert metadata["matchMethod"] == "shared-dossier-number"


def test_docx_is_written_as_text_source(tmp_path: Path) -> None:
    import io
    import zipfile

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            "<w:body><w:p><w:r><w:t>Квамател листок-вкладыш</w:t></w:r></w:p></w:body>"
            "</w:document>",
        )
    rows = [row(SHA["a"], country="KZ")]
    path = tmp_path / "raw" / "files" / "KZ" / f"{SHA['a']}.docx"
    path.parent.mkdir(parents=True)
    path.write_bytes(buffer.getvalue())
    plan = plan_documents(rows, tmp_path / "raw")
    counts = write_registries(plan, tmp_path / "ws", tmp_path / "raw")
    assert counts["pdf"] == 0 and counts["text"] == 1
    assert "Квамател" in (tmp_path / "ws" / "docx-text" / f"{SHA['a']}.txt").read_text("utf-8")
    registry = yaml.safe_load((tmp_path / "ws" / "registry-text.yaml").read_text("utf-8"))
    assert registry["pack"]["id"] == MODULE_ID
    assert registry["sources"][0]["format"] == "text"


def test_scans_are_rechecked_on_the_ocr_text(tmp_path: Path) -> None:
    rows = [row(SHA["a"], check="no-text-layer")]
    store(tmp_path, rows)
    (document,) = plan_documents(rows, tmp_path).documents
    filler = " текст" * 60
    assert recheck_reason(document, "КВАМАТЕЛ таблетки" + filler) is None
    assert recheck_reason(document, "Фамотидин 20 мг" + filler) is None
    reason = recheck_reason(document, "Парацетамол таблетки" + filler)
    assert reason is not None and "mismatch" in reason
    checked = [row(SHA["b"])]
    store(tmp_path, checked)
    (plain,) = plan_documents(checked, tmp_path).documents
    assert recheck_reason(plain, "") is None  # a text-layer file was checked by the manifest


def test_staging_adds_extraction_facts_and_keeps_the_body(tmp_path: Path) -> None:
    rows = [row(SHA["a"])]
    store(tmp_path, rows)
    (document,) = plan_documents(rows, tmp_path).documents
    body = "\n# Показания\n\nЯзва желудка.\n"
    prepared = (
        "---\n"
        + yaml.safe_dump(
            {
                "id": document.document_id,
                "metadata": {
                    "sourceClass": SOURCE_CLASS,
                    "extraction": {
                        "textExtractionMode": "ocr",
                        "ocrEngine": "macos-vision",
                        "ocrMeanConfidence": 0.97,
                        "pageCount": 4,
                        "qualityScore": 0.9,
                    },
                },
            },
            allow_unicode=True,
        )
        + "---"
        + body
    )
    front, staged_body = split_front_matter(augmented_markdown(prepared, document))
    assert staged_body == split_front_matter(prepared)[1] == body.lstrip("\n")
    metadata = front["metadata"]
    assert metadata["ocr"] is True and metadata["ocrEngine"] == "macos-vision"
    assert metadata["pdfPageCount"] == 4 and metadata["sourceClass"] == SOURCE_CLASS
