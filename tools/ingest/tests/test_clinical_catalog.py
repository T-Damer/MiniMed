from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from localmed_ingest.clinical_catalog import (
    build_clinical_coverage_ledger,
    load_taxonomy,
    write_clinical_coverage_ledger,
)


def write_yaml(path: Path, payload: object) -> None:
    path.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def taxonomy_payload() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "modules": [
            {
                "id": "minimed.clinical.respiratory.ru",
                "title": "Пульмонология",
                "priority": 100,
                "titleKeywords": ["пневмони", "бронхит"],
                "icd10Prefixes": ["J"],
                "specialties": ["pulmonology"],
            },
            {
                "id": "minimed.clinical.endocrinology.ru",
                "title": "Эндокринология",
                "priority": 90,
                "titleKeywords": ["диабет"],
                "icd10Prefixes": ["E"],
                "specialties": ["endocrinology"],
            },
            {
                "id": "minimed.clinical.pediatrics.ru",
                "title": "Педиатрия",
                "priority": 20,
                "ageKeywords": ["дети"],
                "specialties": ["pediatrics"],
            },
            {
                "id": "minimed.clinical.other.ru",
                "title": "Другие",
                "fallback": True,
                "specialties": ["general-medicine"],
            },
        ],
    }


def test_builds_coverage_ledger_from_russian_json_and_overrides(tmp_path: Path) -> None:
    source = tmp_path / "catalog.json"
    source.write_text(
        json.dumps(
            {
                "items": [
                    {
                        "ID": "714_2",
                        "Наименование": "Внебольничная пневмония у детей",
                        "МКБ-10": "J18",
                        "Возрастная категория": "Дети",
                        "Статус применения КР": "Действует",
                        "Редакция": "2025",
                    },
                    {
                        "ID": "998",
                        "Наименование": "Сахарный диабет 1 типа",
                        "МКБ-10": "E10",
                        "Статус применения КР": "Действует",
                    },
                    {
                        "ID": "old-1",
                        "Наименование": "Историческая рекомендация",
                        "Статус применения КР": "Архивная",
                    },
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    taxonomy = tmp_path / "taxonomy.yaml"
    write_yaml(taxonomy, taxonomy_payload())
    overrides = tmp_path / "overrides.yaml"
    write_yaml(
        overrides,
        {
            "schemaVersion": 1,
            "records": {
                "714_2": {
                    "coverageState": "published",
                    "rights": "redistributable",
                    "sourceUrl": "https://example.test/pneumonia.html",
                    "moduleIds": [
                        "minimed.clinical.respiratory.ru",
                        "minimed.clinical.pediatrics.ru",
                    ],
                }
            },
        },
    )

    ledger = build_clinical_coverage_ledger(
        source,
        taxonomy,
        overrides_path=overrides,
        generated_at="2026-07-23T00:00:00Z",
    )

    assert ledger.summary.total_records == 3
    assert ledger.summary.coverage_counts == {"published": 1, "metadata-only": 1, "historical": 1}
    pneumonia = next(record for record in ledger.records if record.official_id == "714_2")
    assert pneumonia.primary_module_id == "minimed.clinical.respiratory.ru"
    assert pneumonia.module_ids == [
        "minimed.clinical.respiratory.ru",
        "minimed.clinical.pediatrics.ru",
    ]
    assert pneumonia.rights == "redistributable"
    assert pneumonia.source_url == "https://example.test/pneumonia.html"
    diabetes = next(record for record in ledger.records if record.official_id == "998")
    assert diabetes.primary_module_id == "minimed.clinical.endocrinology.ru"
    historical = next(record for record in ledger.records if record.official_id == "old-1")
    assert historical.coverage_state == "historical"

    output = tmp_path / "coverage.json"
    write_clinical_coverage_ledger(ledger, output)
    saved = json.loads(output.read_text(encoding="utf-8"))
    assert saved["summary"]["totalRecords"] == 3
    assert saved["generatedAt"] == "2026-07-23T00:00:00Z"


def test_reads_semicolon_csv_and_warns_about_incomplete_rows(tmp_path: Path) -> None:
    source = tmp_path / "catalog.csv"
    source.write_text(
        "ИД;Название;МКБ10;Статус\n"
        "381_3;Бронхит у детей;J40;Действует\n"
        ";Строка без идентификатора;R69;Действует\n",
        encoding="utf-8",
    )
    taxonomy = tmp_path / "taxonomy.yaml"
    write_yaml(taxonomy, taxonomy_payload())

    ledger = build_clinical_coverage_ledger(source, taxonomy)

    assert ledger.summary.total_records == 1
    assert ledger.records[0].primary_module_id == "minimed.clinical.respiratory.ru"
    assert ledger.warnings == [
        "row 2: Every clinical catalog row requires an official id and title."
    ]


def test_rejects_conflicting_duplicate_official_ids(tmp_path: Path) -> None:
    source = tmp_path / "catalog.json"
    source.write_text(
        json.dumps(
            [
                {"id": "1", "name": "Первая редакция", "version": "2025"},
                {"id": "1", "name": "Другая рекомендация", "version": "2026"},
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    taxonomy = tmp_path / "taxonomy.yaml"
    write_yaml(taxonomy, taxonomy_payload())

    with pytest.raises(ValueError, match="Conflicting duplicate clinical recommendation id"):
        build_clinical_coverage_ledger(source, taxonomy)


def test_repository_taxonomy_is_valid_and_has_one_fallback() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    taxonomy = load_taxonomy(repository_root / "content" / "clinical-module-taxonomy.yaml")

    assert len(taxonomy.modules) >= 15
    assert sum(module.fallback for module in taxonomy.modules) == 1
    assert any(module.id == "minimed.clinical.psychiatry-addiction.ru" for module in taxonomy.modules)
