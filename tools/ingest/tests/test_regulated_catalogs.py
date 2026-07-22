from __future__ import annotations

import json
import urllib.parse
from pathlib import Path

import yaml

from localmed_ingest.legal_catalog import collect_legal_catalog
from localmed_ingest.medication_catalog import build_medication_coverage_ledger


def write_yaml(path: Path, payload: object) -> None:
    path.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def test_medication_ledger_preserves_registration_identity_and_atc_modules(
    tmp_path: Path,
) -> None:
    source = tmp_path / "medications.json"
    source.write_text(
        json.dumps(
            [
                {
                    "Регистрационный номер": "ЛП-000001",
                    "Торговое наименование": "Амоксициллин тест",
                    "МНН": "амоксициллин",
                    "АТХ": "J01CA04",
                    "Лекарственная форма": "таблетки",
                    "Дозировка": "500 мг",
                    "Путь введения": "перорально",
                    "Производитель": "Тест Фарма",
                    "Статус": "Действует",
                },
                {
                    "Регистрационный номер": "ЛП-000002",
                    "Торговое наименование": "Сертралин тест",
                    "МНН": "сертралин",
                    "АТХ": "N06AB06",
                    "Лекарственная форма": "таблетки",
                    "Дозировка": "50 мг; 100 мг",
                    "Статус": "Действует",
                },
                {
                    "Регистрационный номер": "ЛП-OLD",
                    "Торговое наименование": "Исторический препарат",
                    "Статус": "Аннулировано",
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    repository_root = Path(__file__).resolve().parents[3]
    taxonomy = repository_root / "content" / "medication-module-taxonomy.yaml"

    ledger = build_medication_coverage_ledger(
        source,
        taxonomy,
        generated_at="2026-07-23T00:00:00Z",
    )

    assert ledger.summary.total_records == 3
    antibiotic = next(record for record in ledger.records if record.registration_number == "ЛП-000001")
    assert antibiotic.primary_module_id == "minimed.medications.antiinfectives.ru"
    assert antibiotic.inn == ["амоксициллин"]
    assert antibiotic.strengths == ["500 мг"]
    antidepressant = next(
        record for record in ledger.records if record.registration_number == "ЛП-000002"
    )
    assert antidepressant.primary_module_id == "minimed.medications.nervous-system.ru"
    assert antidepressant.strengths == ["50 мг", "100 мг"]
    historical = next(record for record in ledger.records if record.registration_number == "ЛП-OLD")
    assert historical.coverage_state == "historical"
    assert historical.primary_module_id == "minimed.medications.unclassified.ru"


def test_official_legal_collector_paginates_deduplicates_and_categorizes(
    tmp_path: Path,
) -> None:
    config = tmp_path / "queries.yaml"
    write_yaml(
        config,
        {
            "schemaVersion": 1,
            "baseUrl": "https://publication.pravo.gov.ru",
            "pageSize": 200,
            "queries": [
                {
                    "id": "medical-care",
                    "title": "Медицинская помощь",
                    "documentText": "медицинской помощи",
                    "maxPages": 2,
                },
                {
                    "id": "medicines",
                    "title": "Лекарственные средства",
                    "documentText": "лекарственных средств",
                    "maxPages": 1,
                },
            ],
        },
    )
    repository_root = Path(__file__).resolve().parents[3]
    taxonomy = repository_root / "content" / "legal-module-taxonomy.yaml"

    items = {
        ("medical-care", 1): [
            {
                "id": "doc-1",
                "eoNumber": "0001202601010001",
                "title": "Приказ об организации оказания медицинской помощи детям",
                "name": "Об организации оказания медицинской помощи детям",
                "publishDateShort": "2026-01-01T00:00:00",
                "number": "1н",
                "documentTypeId": "type-order",
                "signatoryAuthorityId": "minzdrav",
                "pagesCount": 5,
                "pdfFileLength": 120000,
            }
        ],
        ("medical-care", 2): [
            {
                "id": "doc-2",
                "eoNumber": "0001202601020002",
                "title": "Приказ об утверждении формы медицинской документации",
                "name": "Об утверждении формы медицинской документации",
                "publishDateShort": "2026-01-02T00:00:00",
                "number": "2н",
                "documentTypeId": "type-order",
                "signatoryAuthorityId": "minzdrav",
            }
        ],
        ("medicines", 1): [
            {
                "id": "doc-1",
                "eoNumber": "0001202601010001",
                "title": "Приказ об организации оказания медицинской помощи детям",
                "name": "Об организации оказания медицинской помощи детям",
                "publishDateShort": "2026-01-01T00:00:00",
                "number": "1н",
                "documentTypeId": "type-order",
                "signatoryAuthorityId": "minzdrav",
            },
            {
                "id": "doc-3",
                "eoNumber": "0001202601030003",
                "title": "Приказ о правилах отпуска лекарственных препаратов",
                "name": "О правилах отпуска лекарственных препаратов",
                "publishDateShort": "2026-01-03T00:00:00",
                "number": "3н",
                "documentTypeId": "type-order",
                "signatoryAuthorityId": "minzdrav",
            },
        ],
    }

    def transport(url: str, _timeout: float) -> object:
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/api/Document":
            return {
                "documentType": {"id": "type-order", "name": "Приказ"},
                "signatoryAuthorities": [
                    {
                        "id": "minzdrav",
                        "name": "Министерство здравоохранения Российской Федерации",
                        "isMain": True,
                    }
                ],
            }
        document_text = query.get("DocumentText", [""])[0]
        query_id = "medicines" if "лекарствен" in document_text else "medical-care"
        page = int(query.get("Index", ["1"])[0])
        rows = items[(query_id, page)]
        pages = 2 if query_id == "medical-care" else 1
        return {
            "items": rows,
            "itemsTotalCount": sum(len(value) for key, value in items.items() if key[0] == query_id),
            "itemsPerPage": 200,
            "currentPage": page,
            "pagesTotalCount": pages,
        }

    output = tmp_path / "laws.json"
    raw_output = tmp_path / "raw-pages.json"
    ledger = collect_legal_catalog(
        config,
        taxonomy,
        output,
        raw_output=raw_output,
        transport=transport,
        generated_at="2026-07-23T00:00:00Z",
    )

    assert ledger.summary.total_records == 3
    care = next(record for record in ledger.records if record.eo_number == "0001202601010001")
    assert set(care.matched_query_ids) == {"medical-care", "medicines"}
    assert care.primary_module_id == "minimed.regulatory.healthcare-organization.ru"
    records = next(record for record in ledger.records if record.eo_number == "0001202601020002")
    assert records.primary_module_id == "minimed.regulatory.records-consent-privacy.ru"
    medicines = next(record for record in ledger.records if record.eo_number == "0001202601030003")
    assert medicines.primary_module_id == "minimed.regulatory.medicines-pharmacy.ru"
    assert medicines.document_type == "Приказ"
    assert medicines.signatory_authorities == [
        "Министерство здравоохранения Российской Федерации"
    ]
    assert output.is_file()
    assert raw_output.is_file()
