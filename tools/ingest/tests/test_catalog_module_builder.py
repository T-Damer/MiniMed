from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from localmed_ingest.builder import build_content_pack
from localmed_ingest.catalog_module_builder import (
    build_catalog_metadata_modules,
    build_core_catalog_pointers,
    project_esklp_mnn_to_core_topic_stub,
)


def write_ledger(
    path: Path, records: list[dict[str, object]], modules: list[dict[str, object]]
) -> None:
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedAt": "2026-07-23T00:00:00Z",
                "sourceChecksum": "sha256:" + "0" * 64,
                "summary": {"totalRecords": len(records)},
                "records": records,
                "modules": [
                    {
                        **module,
                        "priority": 100,
                        "specialties": ["fixture"],
                    }
                    for module in modules
                ],
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
    markdown = next((output / report.modules[0].directory).glob("*.md")).read_text(encoding="utf-8")
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

    markdown = next((output / report.modules[0].directory).glob("*.md")).read_text(encoding="utf-8")
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
                "signatoryAuthorities": ["Министерство здравоохранения Российской Федерации"],
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

    markdown = next((output / report.modules[0].directory).glob("*.md")).read_text(encoding="utf-8")
    assert "не доказывает текущую применимость" in markdown
    assert "official_legal_publication_record" in markdown
    build_first_workspace(output, tmp_path / "laws.db")


def test_secondary_categories_do_not_duplicate_documents(tmp_path: Path) -> None:
    ledger = tmp_path / "secondary.json"
    record_id = "kr.rf.secondary"
    primary = "minimed.clinical.respiratory.ru"
    secondary = "minimed.clinical.pediatrics.ru"
    write_ledger(
        ledger,
        [
            {
                "recordId": record_id,
                "officialId": "secondary",
                "title": "Тестовая рекомендация",
                "versionLabel": "2026",
                "status": "active",
                "coverageState": "metadata-only",
                "rights": "unknown",
                "moduleIds": [primary, secondary],
                "primaryModuleId": primary,
                "specialties": ["pediatrics", "pulmonology"],
            }
        ],
        [
            {
                "moduleId": primary,
                "title": "Пульмонология",
                "recordIds": [record_id],
                "coverageCounts": {"metadata-only": 1},
            },
            {
                "moduleId": secondary,
                "title": "Общая педиатрия",
                "recordIds": [record_id],
                "coverageCounts": {"metadata-only": 1},
            },
        ],
    )
    output = tmp_path / "secondary-modules"

    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="clinical",
        version="2026.07.1",
        built_at="2026-07-23T00:00:00Z",
    )

    assert report.total_documents == 1
    assert [module.module_id for module in report.modules] == [primary]
    assert report.modules[0].document_ids == [record_id]
    assert not (output / secondary).exists()
    assert any(secondary in warning for warning in report.warnings)


def test_builds_esklp_mnn_document_and_indexes_child_search_terms(tmp_path: Path) -> None:
    ledger = tmp_path / "esklp.json"
    record_id = "esklp.mnn.miramistin"
    module_id = "minimed.medications.esklp.ru"
    standardized_inn = "Мирамистин"
    trade_name = "Мирамистин Форте"
    second_trade_name = "Мирамистин Аква"
    dosage_form = "мазь"
    second_dosage_form = "раствор"
    strength = "0,01%"
    second_strength = "0,005%"
    klp_code = "КЛП-000001"
    smnn_nodes = [
        {
            "smnnCode": "СМНН-000001",
            "tradeNames": [
                {
                    "tradeName": trade_name,
                    "registrationNumber": "ЛП-000002",
                    "dosageForm": dosage_form,
                    "strength": strength,
                    "unit": "г",
                    "normalizedInns": [standardized_inn],
                    "normalizedFormsStrengths": [f"{dosage_form} {strength}"],
                }
            ],
            "klpPositions": [
                {
                    "klpCode": klp_code,
                    "tradeName": trade_name,
                    "registrationNumber": "ЛП-000002",
                    "dosageForm": dosage_form,
                    "strength": strength,
                    "unit": "г",
                    "unitCount": 15,
                    "primaryPackage": "туба",
                    "secondaryPackage": "пачка картонная",
                    "packageContents": "15 г",
                    "holder": "ООО «Тест Фарма»",
                    "manufacturer": "ООО «Тест Производитель»",
                    "essentialDrug": False,
                    "validityPeriod": "2026-08-28/2027-08-27",
                    "price": "123.45",
                    "diagnostics": {"sourceRow": 42},
                }
            ],
        },
        {
            "smnnCode": "СМНН-000002",
            "tradeNames": [
                {
                    "tradeName": second_trade_name,
                    "registrationNumber": "ЛП-000003",
                    "dosageForm": second_dosage_form,
                    "strength": second_strength,
                    "unit": "мл",
                    "normalizedInns": [standardized_inn],
                    "normalizedFormsStrengths": [f"{second_dosage_form} {second_strength}"],
                }
            ],
            "klpPositions": [
                {
                    "klpCode": "КЛП-000002",
                    "tradeName": second_trade_name,
                    "registrationNumber": "ЛП-000003",
                    "dosageForm": second_dosage_form,
                    "strength": second_strength,
                    "unit": "мл",
                    "unitCount": 20,
                    "primaryPackage": "флакон",
                    "secondaryPackage": "пачка картонная",
                    "packageContents": "20 мл",
                    "holder": "ООО «Тест Фарма 2»",
                    "manufacturer": "ООО «Тест Производитель 2»",
                    "essentialDrug": True,
                    "validityPeriod": "2026-08-28/2027-08-27",
                    "price": "234.56",
                    "diagnostics": {"sourceRow": 43},
                }
            ],
        },
    ]
    write_ledger(
        ledger,
        [
            {
                "recordKind": "esklp-mnn",
                "recordId": record_id,
                "standardizedInn": standardized_inn,
                "inn": [standardized_inn],
                "componentInns": [],
                "atcCodes": ["D08AJ01"],
                "dosageForms": [dosage_form, second_dosage_form],
                "strengths": [strength, second_strength],
                "smnnNodes": smnn_nodes,
                "sourceEdition": "2026-08-28",
                "sourceUrl": "https://example.test/esklp/export",
                "officialUrl": "https://esklp.example.test/mnn/miramistin",
                "sourceArchive": "esklp_20260828_excel_00001.zip",
                "status": "active",
                "coverageState": "metadata-only",
                "rights": "unknown",
                "moduleIds": [module_id],
                "primaryModuleId": module_id,
            }
        ],
        [
            {
                "moduleId": module_id,
                "title": "ЕСКЛП",
                "recordIds": [record_id],
                "coverageCounts": {"metadata-only": 1},
            }
        ],
    )
    output = tmp_path / "esklp-modules"
    database = tmp_path / "esklp.db"

    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="medication",
        version="2026.08.1",
        built_at="2026-08-30T00:00:00Z",
    )

    module_dir = output / report.modules[0].directory
    markdown = next(module_dir.glob("*.md")).read_text(encoding="utf-8")
    assert f"title: {standardized_inn}" in markdown
    assert "official_registry_summary" in markdown
    assert "contentMode: esklp-mnn" in markdown
    assert "Торговые наименования" in markdown
    assert "Доступны только регистрационные сведения ЕСКЛП" in markdown
    assert "Источник: ЕСКЛП" in markdown
    assert "Исходный архив:" not in markdown
    assert "Состояние покрытия MiniMed" not in markdown
    assert "trustedDoseData=false" not in markdown
    trade_lines = [line for line in markdown.splitlines() if line.startswith("- ТН:")]
    assert len(trade_lines) == 2
    assert any(
        f"ТН: {trade_name}." in line
        and f"Лекарственная форма: {dosage_form}." in line
        and f"Дозировка/концентрация: {strength}. Единица: г." in line
        for line in trade_lines
    )
    assert any(
        f"ТН: {second_trade_name}." in line
        and f"Лекарственная форма: {second_dosage_form}." in line
        and f"Дозировка/концентрация: {second_strength}. Единица: мл." in line
        for line in trade_lines
    )
    assert not any(
        f"ТН: {trade_name}." in line and second_dosage_form in line for line in trade_lines
    )
    assert not any(
        f"ТН: {second_trade_name}." in line and dosage_form in line for line in trade_lines
    )
    klp_lines = [line for line in markdown.splitlines() if line.startswith("- КЛП:")]
    assert len(klp_lines) == 2
    assert "Дозировка/концентрация: 0,01%. Единица: г." in klp_lines[0]
    assert "Дозировка/концентрация: 0,005%. Единица: мл." in klp_lines[1]
    assert "Жизненно необходимый препарат: Нет." in klp_lines[0]
    assert "Жизненно необходимый препарат: Да." in klp_lines[1]
    assert not any("0,01% г" in line or "0,005% мл" in line for line in (*trade_lines, *klp_lines))

    build_content_pack(module_dir, database)
    with sqlite3.connect(database) as connection:
        document = connection.execute(
            "SELECT title, source_type, metadata_json FROM documents WHERE id = ?",
            (record_id,),
        ).fetchone()
        assert document is not None
        assert document[0] == standardized_inn
        assert document[1] == "official_registry_summary"
        metadata = json.loads(document[2])
        assert metadata["contentMode"] == "esklp-mnn"
        assert metadata["trustedDoseData"] is False
        assert metadata["sourceArchive"] == "esklp_20260828_excel_00001.zip"
        assert metadata["smnnNodes"] == smnn_nodes

        aliases = {
            row[0]: row[1]
            for row in connection.execute(
                "SELECT alias, canonical_term FROM aliases WHERE canonical_term = ?",
                (standardized_inn,),
            )
        }
        assert {
            standardized_inn,
            trade_name,
            second_trade_name,
            f"{standardized_inn} {dosage_form}",
            f"{standardized_inn} {second_dosage_form}",
            f"{trade_name} {dosage_form}",
            f"{second_trade_name} {second_dosage_form}",
        }.issubset(aliases)

        def document_ids_for(query: str) -> set[str]:
            return {
                row[0]
                for row in connection.execute(
                    "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
                    (query,),
                )
            }

        for query in (
            standardized_inn,
            trade_name,
            dosage_form,
            f"{standardized_inn} {dosage_form}",
        ):
            assert document_ids_for(query) == {record_id}


def test_builds_long_esklp_mnn_ids_with_bounded_unique_filenames(tmp_path: Path) -> None:
    module_id = "minimed.medications.esklp.ru"
    long_component = "а" * 140
    record_ids = [
        f"esklp.mnn.{long_component}-one",
        f"esklp.mnn.{long_component}-two",
    ]
    ledger = tmp_path / "esklp-long-ids.json"
    write_ledger(
        ledger,
        [
            {
                "recordKind": "esklp-mnn",
                "recordId": record_id,
                "standardizedInn": f"Тестовый МНН {index}",
                "inn": [f"Тестовый МНН {index}"],
                "componentInns": [],
                "atcCodes": [],
                "dosageForms": ["таблетки"],
                "strengths": ["1 мг"],
                "smnnNodes": [],
                "sourceEdition": "2026-08-28",
                "sourceUrl": "https://example.test/esklp/export",
                "officialUrl": "https://example.test/esklp/mnn",
                "sourceArchive": "esklp_20260828_excel_00001.zip",
                "status": "active",
                "coverageState": "metadata-only",
                "rights": "unknown",
                "moduleIds": [module_id],
                "primaryModuleId": module_id,
            }
            for index, record_id in enumerate(record_ids, start=1)
        ],
        [
            {
                "moduleId": module_id,
                "title": "ЕСКЛП",
                "recordIds": record_ids,
                "coverageCounts": {"metadata-only": 2},
            }
        ],
    )
    output = tmp_path / "esklp-long-id-modules"

    report = build_catalog_metadata_modules(
        ledger,
        output,
        family="medication",
        version="2026.08.1",
        built_at="2026-08-30T00:00:00Z",
    )

    module_dir = output / report.modules[0].directory
    markdown_paths = sorted(module_dir.glob("*.md"))
    assert report.modules[0].document_ids == record_ids
    assert len(markdown_paths) == len(record_ids)
    assert len({path.name for path in markdown_paths}) == len(record_ids)
    assert all(len(path.name.encode("utf-8")) <= 255 for path in markdown_paths)
    markdown_texts = [path.read_text(encoding="utf-8") for path in markdown_paths]
    assert {
        record_id
        for record_id in record_ids
        if any(record_id in markdown for markdown in markdown_texts)
    } == set(record_ids)

    database = tmp_path / "esklp-long-ids.db"
    build_content_pack(module_dir, database)
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT id FROM documents ORDER BY id").fetchall() == [
            (record_id,) for record_id in record_ids
        ]


def test_builds_compact_core_medication_pointers_for_nurofen_records(tmp_path: Path) -> None:
    ledger = tmp_path / "esklp-pointers.json"
    medication_module = "minimed.medications.esklp.ru"
    records: list[dict[str, object]] = [
        {
            "recordKind": "esklp-mnn",
            "recordId": "esklp.mnn.ibuprofen",
            "standardizedInn": "Ибупрофен",
            "inn": ["Ибупрофен"],
            "componentInns": [],
            "dosageForms": ["таблетки", "суспензия для приема внутрь", "мазь"],
            "strengths": ["200 мг", "100 мг/5 мл", "5%"],
            "smnnNodes": [
                {
                    "smnnCode": "СМНН-ИБУПРОФЕН-200",
                    "dosageForm": "таблетки",
                    "strength": "200 мг",
                    "tradeNames": [
                        {
                            "tradeName": "Нурофен",
                            "registrationNumber": "ЛП-000200",
                            "dosageForm": "таблетки",
                            "strength": "200 мг",
                            "normalizedFormsStrengths": ["таблетки 200 мг"],
                        }
                    ],
                    "klpPositions": [
                        {
                            "klpCode": "КЛП-ИБУПРОФЕН-200",
                            "tradeName": "Нурофен",
                            "registrationNumber": "ЛП-000200",
                            "dosageForm": "таблетки",
                            "strength": "200 мг",
                            "manufacturer": "Тест",
                        }
                    ],
                },
                {
                    "smnnCode": "СМНН-ИБУПРОФЕН-100",
                    "dosageForm": "суспензия для приема внутрь",
                    "strength": "100 мг/5 мл",
                    "tradeNames": [
                        {
                            "tradeName": "Нурофен для детей",
                            "registrationNumber": "ЛП-000100",
                            "dosageForm": "суспензия для приема внутрь",
                            "strength": "100 мг/5 мл",
                            "normalizedFormsStrengths": ["суспензия для приема внутрь 100 мг/5 мл"],
                        }
                    ],
                    "klpPositions": [
                        {
                            "klpCode": "КЛП-ИБУПРОФЕН-100",
                            "tradeName": "Нурофен для детей",
                            "registrationNumber": "ЛП-000100",
                            "dosageForm": "суспензия для приема внутрь",
                            "strength": "100 мг/5 мл",
                            "manufacturer": "Тест",
                        }
                    ],
                },
                {
                    "smnnCode": "СМНН-ИБУПРОФЕН-МАЗЬ",
                    "dosageForm": "мазь",
                    "strength": "5%",
                    "tradeNames": [
                        {
                            "tradeName": "Долгит",
                            "registrationNumber": "ЛП-000300",
                            "dosageForm": "мазь",
                            "strength": "5%",
                            "normalizedFormsStrengths": ["мазь 5%"],
                        }
                    ],
                    "klpPositions": [
                        {
                            "klpCode": "КЛП-ИБУПРОФЕН-МАЗЬ",
                            "tradeName": "Долгит",
                            "registrationNumber": "ЛП-000300",
                            "dosageForm": "мазь",
                            "strength": "5%",
                            "manufacturer": "Тест",
                        }
                    ],
                },
            ],
            "sourceEdition": "2026-08-28",
            "sourceUrl": "https://example.test/esklp",
            "officialUrl": "https://example.test/esklp",
            "status": "active",
            "moduleIds": [medication_module],
            "primaryModuleId": medication_module,
        },
        {
            "recordKind": "esklp-mnn",
            "recordId": "esklp.mnn.ibuprofen-codeine",
            "standardizedInn": "Ибупрофен+Кодеин",
            "inn": ["Ибупрофен+Кодеин"],
            "componentInns": ["Ибупрофен", "Кодеин"],
            "dosageForms": ["таблетки"],
            "strengths": ["200 мг+12,8 мг"],
            "smnnNodes": [
                {
                    "smnnCode": "СМНН-ИБУПРОФЕН-КОДЕИН",
                    "dosageForm": "таблетки",
                    "strength": "200 мг+12,8 мг",
                    "tradeNames": [
                        {
                            "tradeName": "Нурофен Плюс",
                            "registrationNumber": "ЛП-000101",
                            "dosageForm": "таблетки",
                            "strength": "200 мг+12,8 мг",
                            "normalizedFormsStrengths": ["таблетки 200 мг+12,8 мг"],
                        }
                    ],
                    "klpPositions": [
                        {
                            "klpCode": "КЛП-ИБУПРОФЕН-КОДЕИН",
                            "tradeName": "Нурофен Плюс",
                            "registrationNumber": "ЛП-000101",
                            "dosageForm": "таблетки",
                            "strength": "200 мг+12,8 мг",
                            "manufacturer": "Тест",
                        }
                    ],
                }
            ],
            "sourceEdition": "2026-08-28",
            "sourceUrl": "https://example.test/esklp",
            "officialUrl": "https://example.test/esklp",
            "status": "active",
            "moduleIds": [medication_module],
            "primaryModuleId": medication_module,
        },
    ]
    write_ledger(
        ledger,
        records,
        [
            {
                "moduleId": medication_module,
                "title": "ЕСКЛП",
                "recordIds": [record["recordId"] for record in records],
                "coverageCounts": {"metadata-only": len(records)},
            }
        ],
    )
    output = tmp_path / "core-pointers"

    stub = project_esklp_mnn_to_core_topic_stub(records[0])
    assert stub.entity_type == "medication"
    assert stub.module_ids == [medication_module]
    assert stub.relations[0].target_id == records[0]["recordId"]
    assert stub.aliases == [
        "Ибупрофен",
        "Нурофен",
        "Нурофен для детей",
        "Долгит",
    ]

    report = build_core_catalog_pointers(
        ledger,
        output,
        version="2026.08.1",
        built_at="2026-08-30T00:00:00Z",
    )
    assert report.total_documents == 2
    assert report.modules[0].module_id == "minimed.core.ru"
    assert report.modules[0].record_count == 2
    module_dir = output / report.modules[0].directory
    markdown_paths = sorted(module_dir.glob("*.md"))
    assert len(markdown_paths) == 2
    pointer_text = next(
        path.read_text(encoding="utf-8")
        for path in markdown_paths
        if "Нурофен для детей" in path.read_text(encoding="utf-8")
    )
    assert "source_type: core_catalog_pointer" in pointer_text
    assert "contentMode: module-pointer" in pointer_text
    assert "targetDocumentId: esklp.mnn.ibuprofen" in pointer_text
    assert "primaryModuleId: minimed.medications.esklp.ru" in pointer_text
    assert "smnnCodes:" not in pointer_text
    assert "tradeRecords:" not in pointer_text
    assert "registrationNumbers:" not in pointer_text
    assert "dosageForms:" not in pointer_text
    assert "strengths:" not in pointer_text
    assert "## СМНН-ИБУПРОФЕН-200 — таблетки — 200 мг" in pointer_text
    assert "## СМНН-ИБУПРОФЕН-100 — суспензия для приема внутрь — 100 мг/5 мл" in pointer_text
    assert "## СМНН-ИБУПРОФЕН-МАЗЬ — мазь — 5%" in pointer_text
    assert "- ТН: Нурофен; форма/дозировка: таблетки 200 мг" in pointer_text
    assert (
        "- ТН: Нурофен для детей; форма/дозировка: "
        "суспензия для приема внутрь 100 мг/5 мл" in pointer_text
    )
    assert "ЛП-000200" not in pointer_text
    assert "ЛП-000100" not in pointer_text
    assert "registrationNumber" not in pointer_text
    assert "normalizedFormsStrengths" not in pointer_text
    assert "Нурофен Плюс" not in pointer_text
    assert "Полные данные находятся в скачиваемом модуле" in pointer_text
    assert "КЛП-" not in pointer_text
    assert "klpPositions:" not in pointer_text
    assert "smnnNodes:" not in pointer_text
    assert all(
        pointer_id != record["recordId"]
        for pointer_id in report.modules[0].document_ids
        for record in records
    )

    database = tmp_path / "core-pointers.db"
    build_content_pack(module_dir, database, include_embeddings=False)
    with sqlite3.connect(database) as connection:
        rows = connection.execute(
            "SELECT id, source_type, metadata_json FROM documents ORDER BY id"
        ).fetchall()
        assert len(rows) == 2
        pointer_by_target: dict[str, str] = {}
        for pointer_id, source_type, metadata_json in rows:
            metadata = json.loads(metadata_json)
            pointer_by_target[metadata["targetDocumentId"]] = pointer_id
            assert pointer_id.startswith("core.catalog.pointer.medication.")
            assert source_type == "core_catalog_pointer"
            assert metadata["contentMode"] == "module-pointer"
            assert metadata["catalogFamily"] == "medication"
            assert metadata["entityType"] == "medication"
            assert metadata["primaryModuleId"] == medication_module
            assert metadata["moduleIds"] == [medication_module]
            assert {
                "contentMode",
                "catalogFamily",
                "entityType",
                "targetDocumentId",
                "primaryModuleId",
                "moduleIds",
                "standardizedInn",
            } <= set(metadata)
            assert {
                "tradeNames",
                "smnnCodes",
                "tradeRecords",
                "registrationNumbers",
                "normalizedFormsStrengths",
            }.isdisjoint(metadata)

        assert len(pointer_text.encode("utf-8")) < 8_000
        assert connection.execute("SELECT count(*) FROM aliases").fetchone()[0] == 8
        alias_values = {
            row[0] for row in connection.execute("SELECT alias FROM aliases").fetchall()
        }
        assert "Нурофен" in alias_values
        assert "Нурофен таблетки" not in alias_values
        assert "ЛП-000200" not in alias_values

        ibuprofen_pointer = pointer_by_target["esklp.mnn.ibuprofen"]
        combination_pointer = pointer_by_target["esklp.mnn.ibuprofen-codeine"]
        assert connection.execute(
            "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
            ("нурофен суспензия",),
        ).fetchall() == [(ibuprofen_pointer,)]
        assert connection.execute(
            "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
            ("нурофен 100 мг 5 мл",),
        ).fetchall() == [(ibuprofen_pointer,)]
        assert (
            connection.execute(
                "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
                ("нурофен мазь",),
            ).fetchall()
            == []
        )
        assert connection.execute(
            "SELECT DISTINCT document_id FROM chunks_fts WHERE chunks_fts MATCH ?",
            ("нурофен плюс",),
        ).fetchall() == [(combination_pointer,)]

        section_rows = connection.execute(
            """SELECT s.title, group_concat(c.original_text, '\n')
               FROM sections s
               JOIN chunks c ON c.section_id = s.id
               JOIN document_versions dv ON dv.id = s.document_version_id
               WHERE dv.document_id = ?
               GROUP BY s.id, s.title
               ORDER BY s.order_index""",
            (ibuprofen_pointer,),
        ).fetchall()
        sections = {title: text for title, text in section_rows}
        assert len([title for title in sections if title.startswith("СМНН-")]) == 3
        assert "Нурофен" in sections["СМНН-ИБУПРОФЕН-200 — таблетки — 200 мг"]
        assert "мазь" not in sections["СМНН-ИБУПРОФЕН-200 — таблетки — 200 мг"]
        assert "Долгит" in sections["СМНН-ИБУПРОФЕН-МАЗЬ — мазь — 5%"]
        assert "Нурофен" not in sections["СМНН-ИБУПРОФЕН-МАЗЬ — мазь — 5%"]


def test_builds_compact_clinical_core_pointer(tmp_path: Path) -> None:
    ledger = tmp_path / "clinical-pointers.json"
    target_id = "kr.rf.714_2"
    module_id = "minimed.clinical.respiratory.ru"
    write_ledger(
        ledger,
        [
            {
                "recordId": target_id,
                "title": "Внебольничная пневмония у детей",
                "officialId": "714_2",
                "entityType": "disease",
                "aliases": ["ВП у детей"],
                "keywords": ["детская пневмония"],
                "icd10Codes": ["J18"],
                "specialties": ["pediatrics", "pulmonology"],
                "ageCategories": ["Дети"],
                "clinicalMedicationLinks": [
                    {
                        "relationId": "relation.amoxicillin-pneumonia",
                        "mnnDocumentId": "esklp.mnn.amoxicillin",
                        "inn": "АМОКСИЦИЛЛИН",
                        "targetDocumentId": target_id,
                        "predicate": "recommended-for",
                        "relationStatus": "guideline",
                        "reviewStatus": "proposed",
                        "ageGroups": ["Дети"],
                        "evidenceQuote": "Рекомендовано назначить амоксициллин.",
                        "sourceAnchor": "treatment#chunk-treatment",
                        "sourceSectionId": "section.treatment",
                        "sourceChunkId": "chunk.treatment",
                    }
                ],
                "versionLabel": "714_2-2025",
                "status": "active",
                "sourceUrl": "https://example.test/714_2",
                "moduleIds": [module_id],
                "primaryModuleId": module_id,
                "fullText": "Клиническое утверждение не должно попадать в core pointer.",
            }
        ],
        [
            {
                "moduleId": module_id,
                "title": "Пульмонология",
                "recordIds": [target_id],
                "coverageCounts": {"published": 1},
            }
        ],
    )
    output = tmp_path / "clinical-core-pointers"

    report = build_core_catalog_pointers(
        ledger,
        output,
        family="clinical",
        version="2026.09.1",
        built_at="2026-09-01T00:00:00Z",
    )

    assert report.family == "clinical"
    assert report.total_documents == 1
    module_dir = output / report.modules[0].directory
    pointer_text = next(module_dir.glob("*.md")).read_text(encoding="utf-8")
    assert "source_type: core_catalog_pointer" in pointer_text
    assert "contentMode: module-pointer" in pointer_text
    assert "catalogFamily: clinical" in pointer_text
    assert "entityType: disease" in pointer_text
    assert f"targetDocumentId: {target_id}" in pointer_text
    assert f"primaryModuleId: {module_id}" in pointer_text
    assert "714_2" in pointer_text
    assert "J18" in pointer_text
    assert "pediatrics" in pointer_text
    assert "Дети" in pointer_text
    assert "ВП у детей" in pointer_text
    assert "детская пневмония" in pointer_text
    assert "АМОКСИЦИЛЛИН" in pointer_text
    assert "clinicalMedicationLinks:" in pointer_text
    assert "Клиническое утверждение" not in pointer_text
    assert report.modules[0].document_ids[0] != target_id


def test_builds_compact_legal_core_pointer(tmp_path: Path) -> None:
    ledger = tmp_path / "legal-pointers.json"
    target_id = "law.ru.192n"
    module_id = "minimed.regulatory.pediatrics.ru"
    write_ledger(
        ledger,
        [
            {
                "recordId": target_id,
                "title": "Порядок оказания медицинской помощи детям",
                "number": "192н",
                "documentType": "Приказ",
                "signatoryAuthorities": ["Минздрав России"],
                "matchedQueryIds": ["pediatric-care", "medical-care"],
                "publishDate": "2025-12-31",
                "status": "published",
                "apiUrl": "https://example.test/law/192n",
                "moduleIds": [module_id],
                "primaryModuleId": module_id,
                "fullText": "Нормативное содержание не должно попадать в core pointer.",
            }
        ],
        [
            {
                "moduleId": module_id,
                "title": "Педиатрические нормативные акты",
                "recordIds": [target_id],
                "coverageCounts": {"published": 1},
            }
        ],
    )
    output = tmp_path / "legal-core-pointers"

    report = build_core_catalog_pointers(
        ledger,
        output,
        family="legal",
        version="2026.09.1",
        built_at="2026-09-01T00:00:00Z",
    )

    assert report.family == "legal"
    module_dir = output / report.modules[0].directory
    pointer_text = next(module_dir.glob("*.md")).read_text(encoding="utf-8")
    assert "source_type: core_catalog_pointer" in pointer_text
    assert "contentMode: module-pointer" in pointer_text
    assert "catalogFamily: legal" in pointer_text
    assert "entityType: regulation" in pointer_text
    assert f"targetDocumentId: {target_id}" in pointer_text
    assert "192н" in pointer_text
    assert "Приказ" in pointer_text
    assert "Минздрав России" in pointer_text
    assert "pediatric-care" in pointer_text
    assert "medical-care" in pointer_text
    assert "Нормативное содержание" not in pointer_text
    assert report.modules[0].document_ids[0] != target_id


def test_builds_compact_general_medication_core_pointer(tmp_path: Path) -> None:
    ledger = tmp_path / "medication-pointers.json"
    target_id = "drug.ru.lp-000001"
    module_id = "minimed.medications.general.ru"
    write_ledger(
        ledger,
        [
            {
                "recordId": target_id,
                "tradeName": "Сальбутамол-Аэронатив",
                "inn": ["Сальбутамол"],
                "dosageForms": [
                    "аэрозоль для ингаляций дозированный",
                    "раствор для ингаляций",
                ],
                "strengths": ["100 мкг/доза", "1 мг/мл"],
                "routes": ["ингаляционно"],
                "registrationNumber": "ЛП-000001",
                "sourceEdition": "2026-09-01",
                "status": "active",
                "sourceUrl": "https://example.test/drug/lp-000001",
                "moduleIds": [module_id],
                "primaryModuleId": module_id,
                "instructionText": "Показания и режим дозирования не копируются в core pointer.",
            }
        ],
        [
            {
                "moduleId": module_id,
                "title": "Лекарственные препараты",
                "recordIds": [target_id],
                "coverageCounts": {"published": 1},
            }
        ],
    )
    output = tmp_path / "medication-core-pointers"

    report = build_core_catalog_pointers(
        ledger,
        output,
        family="medication",
        version="2026.09.1",
        built_at="2026-09-01T00:00:00Z",
    )

    assert report.family == "medication"
    module_dir = output / report.modules[0].directory
    pointer_text = next(module_dir.glob("*.md")).read_text(encoding="utf-8")
    assert "source_type: core_catalog_pointer" in pointer_text
    assert "contentMode: module-pointer" in pointer_text
    assert "catalogFamily: medication" in pointer_text
    assert "entityType: medication" in pointer_text
    assert f"targetDocumentId: {target_id}" in pointer_text
    assert "Сальбутамол-Аэронатив" in pointer_text
    assert "Сальбутамол" in pointer_text
    assert "аэрозоль для ингаляций дозированный" in pointer_text
    assert "100 мкг/доза" in pointer_text
    assert "ингаляционно" in pointer_text
    assert "ЛП-000001" in pointer_text
    assert "Показания и режим дозирования" not in pointer_text
    assert "tradeRecords:" not in pointer_text
    assert report.modules[0].document_ids[0] != target_id
    aliases_text = (module_dir / "aliases.yaml").read_text(encoding="utf-8")
    assert "Сальбутамол-Аэронатив аэрозоль для ингаляций дозированный" in aliases_text
    assert "Сальбутамол-Аэронатив 100 мкг/доза" in aliases_text
    assert "Сальбутамол-Аэронатив аэрозоль для ингаляций дозированный 1 мг/мл" not in aliases_text
