from __future__ import annotations

import json
from pathlib import Path

from localmed_ingest.builder import build_content_pack
from localmed_ingest.catalog_module_builder import build_catalog_metadata_modules


def write_ledger(path: Path, records: list[dict[str, object]], modules: list[dict[str, object]]) -> None:
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "records": records,
                "modules": modules,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def build_first_workspace(output_root: Path, database: Path) -> None:
    module_dirs = sorted(path for path in output_root.iterdir() if path.is_dir())
    assert module_dirs
    _pack, report = build_content_pack(module_dirs[0], database)
    assert report.documents > 0
    assert report.sqlite_integrity == "ok"
    assert report.foreign_key_violations == 0


def test_builds_loadable_clinical_metadata_module(tmp_path: Path) -> None:
    ledger = tmp_path / "clinical.json"
    write_ledger(
        ledger,
        [
            {
                "recordId": "kr.rf.714_2",
                "officialId": "714_2",
                "title": "Внебольничная пневмония у детей",
                "versionLabel": "714_2-2025",
                "status": "active",
                "applicationStatus": "Действует",
                "ageCategories": ["Дети"],
                "icd10Codes": ["J18"],
                "developer": "Союз педиатров России",
                "officialUrl": "https://cr.minzdrav.gov.ru/preview-cr/714_2",
                "sourceUrl": "https://example.test/714_2.html",
                "coverageState": "metadata-only",
                "rights": "unknown",
                "moduleIds": ["minimed.clinical.respiratory.ru"],
                "primaryModuleId": "minimed.clinical.respiratory.ru",
                "specialties": ["pediatrics", "pulmonology"],
                "notes": ["Полный текст ещё не опубликован в модуле."],
                "rawMetadata": {},
            }
        ],
        [
            {
                "moduleId": "minimed.clinical.respiratory.ru",
                "title": "Пульмонология",
                "recordIds": ["kr.rf.714_2"],
                "coverageCounts": {"metadata-only": 1},
            }
        ],
    )
    output = tmp_path / "clinical-modules"

    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="clinical",
        version="2026.07.1",
        built_at="2026-07-23T00:00:00Z",
    )

    assert report.total_documents == 1
    markdown = next((output / report.modules[0].directory).glob("*.md")).read_text(
        encoding="utf-8"
    )
    assert "Полный текст не считается установленным" in markdown
    assert "clinical_recommendation_catalog_record" in markdown
    build_first_workspace(output, tmp_path / "clinical.db")


def test_builds_medication_metadata_without_trusting_doses(tmp_path: Path) -> None:
    ledger = tmp_path / "medications.json"
    write_ledger(
        ledger,
        [
            {
                "recordId": "drug.ru.ЛП-000001",
                "registrationNumber": "ЛП-000001",
                "tradeName": "Амоксициллин тест",
                "inn": ["амоксициллин"],
                "atcCodes": ["J01CA04"],
                "dosageForm": "таблетки",
                "strengths": ["500 мг"],
                "routes": ["перорально"],
                "manufacturer": "Тест Фарма",
                "holder": "Тест Фарма",
                "status": "active",
                "sourceEdition": "2026-01-01",
                "officialUrl": "https://example.test/registry/1",
                "sourceUrl": "https://example.test/instruction/1",
                "coverageState": "metadata-only",
                "rights": "unknown",
                "moduleIds": ["minimed.medications.antiinfectives.ru"],
                "primaryModuleId": "minimed.medications.antiinfectives.ru",
                "notes": [],
                "rawMetadata": {},
            }
        ],
        [
            {
                "moduleId": "minimed.medications.antiinfectives.ru",
                "title": "Противоинфекционные препараты",
                "recordIds": ["drug.ru.ЛП-000001"],
                "coverageCounts": {"metadata-only": 1},
            }
        ],
    )
    output = tmp_path / "medication-modules"

    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="medication",
        version="2026.07.1",
        built_at="2026-07-23T00:00:00Z",
    )

    markdown = next((output / report.modules[0].directory).glob("*.md")).read_text(
        encoding="utf-8"
    )
    assert "не подтверждает дозы" in markdown
    assert "trustedDoseData: false" in markdown
    build_first_workspace(output, tmp_path / "medications.db")


def test_builds_legal_metadata_with_applicability_warning(tmp_path: Path) -> None:
    ledger = tmp_path / "laws.json"
    write_ledger(
        ledger,
        [
            {
                "recordId": "law.ru.0001202601010001",
                "documentId": "doc-1",
                "eoNumber": "0001202601010001",
                "title": "Приказ об организации оказания медицинской помощи детям",
                "number": "1н",
                "documentDate": "2025-12-31",
                "publishDate": "2026-01-01",
                "signatoryAuthorities": [
                    "Министерство здравоохранения Российской Федерации"
                ],
                "documentType": "Приказ",
                "apiUrl": "https://publication.pravo.gov.ru/api/Document?eoNumber=0001202601010001",
                "status": "published",
                "coverageState": "metadata-only",
                "rights": "metadata-only",
                "moduleIds": ["minimed.regulatory.healthcare-organization.ru"],
                "primaryModuleId": "minimed.regulatory.healthcare-organization.ru",
                "matchedQueryIds": ["medical-care"],
                "notes": [],
                "rawMetadata": {},
            }
        ],
        [
            {
                "moduleId": "minimed.regulatory.healthcare-organization.ru",
                "title": "Организация медицинской помощи",
                "recordIds": ["law.ru.0001202601010001"],
                "coverageCounts": {"metadata-only": 1},
            }
        ],
    )
    output = tmp_path / "law-modules"

    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="legal",
        version="2026.07.1",
        built_at="2026-07-23T00:00:00Z",
    )

    markdown = next((output / report.modules[0].directory).glob("*.md")).read_text(
        encoding="utf-8"
    )
    assert "не доказывает текущую применимость" in markdown
    assert "official_legal_publication_record" in markdown
    build_first_workspace(output, tmp_path / "laws.db")
