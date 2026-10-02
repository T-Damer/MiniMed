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


def edition_row(
    official_id: str, code: int, version: int, name: str = "Бронхит"
) -> dict[str, object]:
    return {
        "id": official_id,
        "name": name,
        "version": official_id,
        "code": code,
        "versionNumber": version,
        "applicationStatus": "Применяется",
        "mkb10": ["J40"],
    }


def test_replaced_editions_stay_in_the_ledger_linked_to_their_successor(tmp_path: Path) -> None:
    previous = tmp_path / "previous.json"
    current = tmp_path / "current.json"
    previous.write_text(
        json.dumps([edition_row("381_3", 381, 3), edition_row("10_1", 10, 1, "Диабет")]),
        encoding="utf-8",
    )
    current.write_text(
        json.dumps(
            [
                edition_row("381_4", 381, 4),
                edition_row("10_1", 10, 1, "Диабет"),
                edition_row("900_1", 900, 1, "Новая"),
            ]
        ),
        encoding="utf-8",
    )
    taxonomy = tmp_path / "taxonomy.yaml"
    write_yaml(taxonomy, taxonomy_payload())

    ledger = build_clinical_coverage_ledger(
        current, taxonomy, generated_at="2026-10-02T00:00:00Z", previous_source=previous
    )

    by_id = {record.official_id: record for record in ledger.records}
    assert sorted(by_id) == ["10_1", "381_3", "381_4", "900_1"]
    assert by_id["381_3"].status == "superseded"
    assert by_id["381_3"].coverage_state == "superseded"
    assert by_id["381_3"].superseded_by == "kr.rf.381_4"
    assert by_id["381_4"].supersedes == ["kr.rf.381_3"]
    assert by_id["381_4"].status == "active"
    assert ledger.summary.status_counts == {"active": 3, "superseded": 1}
    output = tmp_path / "ledger.json"
    write_clinical_coverage_ledger(ledger, output)
    saved = {r["officialId"]: r for r in json.loads(output.read_text(encoding="utf-8"))["records"]}
    assert saved["381_3"]["supersededBy"] == "kr.rf.381_4"
    assert saved["381_4"]["supersedes"] == ["kr.rf.381_3"]
    # Unlinked records serialize exactly as before the edition fields existed.
    assert "supersededBy" not in saved["10_1"]
    assert "supersedes" not in saved["10_1"]


def test_an_edition_that_left_the_registry_without_a_successor_fails(tmp_path: Path) -> None:
    previous = tmp_path / "previous.json"
    current = tmp_path / "current.json"
    previous.write_text(json.dumps([edition_row("381_3", 381, 3)]), encoding="utf-8")
    current.write_text(json.dumps([edition_row("900_1", 900, 1, "Другая")]), encoding="utf-8")
    taxonomy = tmp_path / "taxonomy.yaml"
    write_yaml(taxonomy, taxonomy_payload())

    with pytest.raises(ValueError, match="left the registry without a successor"):
        build_clinical_coverage_ledger(current, taxonomy, previous_source=previous)


def test_repository_taxonomy_is_valid_and_has_one_fallback() -> None:
    repository_root = Path(__file__).resolve().parents[3]
    taxonomy = load_taxonomy(repository_root / "content" / "clinical-module-taxonomy.yaml")

    assert len(taxonomy.modules) >= 15
    assert sum(module.fallback for module in taxonomy.modules) == 1
    assert any(
        module.id == "minimed.clinical.psychiatry-addiction.ru" for module in taxonomy.modules
    )
