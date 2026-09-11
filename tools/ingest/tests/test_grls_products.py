from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import yaml

from localmed_ingest.grls_products import build_grls_product_workspace, parse_grls_presentations
from localmed_ingest.knowledge import load_workspace_documents


def _write_esklp_pack(path: Path) -> None:
    record = {
        "documentId": "esklp.mnn.ibuprofen",
        "contentMode": "esklp-mnn",
        "standardizedInn": "ИБУПРОФЕН",
        "smnnNodes": [
            {
                "smnnCode": "SMNN-SUSPENSION",
                "standardizedInn": "ИБУПРОФЕН",
                "dosageForm": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
                "strength": "100 мг/5 мл",
                "tradeNames": [
                    {
                        "tradeName": "Нурофен",
                        "registrationNumber": "ЛП-NUROFEN",
                        "dosageForm": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
                        "strength": "100 мг/5 мл",
                    }
                ],
                "klpPositions": [
                    {
                        "klpCode": "KLP-NUROFEN",
                        "tradeName": "Нурофен",
                        "registrationNumber": "ЛП-NUROFEN",
                        "dosageForm": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ",
                        "strength": "100 мг/5 мл",
                    }
                ],
            }
        ],
    }
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            "CREATE TABLE documents (id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL)"
        )
        connection.execute(
            "INSERT INTO documents(id, metadata_json) VALUES (?, ?)",
            (record["documentId"], json.dumps(record, ensure_ascii=False)),
        )
        connection.commit()
    finally:
        connection.close()


def test_grls_presentation_keeps_comma_separated_form_qualifiers() -> None:
    presentations = parse_grls_presentations(
        "таблетки, покрытые оболочкой, 200 мг, 12 шт. - блистеры - Без рецепта"
    )

    assert len(presentations) == 1
    assert presentations[0].dosage_form == "таблетки, покрытые оболочкой"
    assert presentations[0].strength == "200 мг"
    assert presentations[0].packages[0].prescription_status == "Без рецепта"


def _write_grls_inputs(root: Path) -> tuple[Path, Path, Path]:
    catalog = root / "catalog.json"
    catalog.write_text(
        json.dumps(
            {
                "sourceEdition": "test",
                "records": [
                    {
                        "registrationNumber": "ЛП-NUROFEN",
                        "tradeName": "Нурофен",
                        "inn": "ИБУПРОФЕН",
                        "status": "Действует",
                        "releaseForms": "СУСПЕНЗИЯ ДЛЯ ПРИЕМА ВНУТРЬ, 100 мг/5 мл, флакон 100 мл",
                    },
                    {
                        "registrationNumber": "ЛП-MISSING",
                        "tradeName": "Неизвестный препарат",
                        "inn": "НЕИЗВЕСТНЫЙ МНН",
                        "status": "Действует",
                        "releaseForms": "таблетки, 10 мг, пачка 10 шт.",
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    registry = root / "registry.yaml"
    registry.write_text(
        yaml.safe_dump(
            {
                "pack": {
                    "id": "test-grls",
                    "version": "1.0.0",
                    "schemaVersion": 2,
                    "title": "Test GRLS",
                    "builtAt": "2026-09-01T00:00:00Z",
                },
                "sources": [
                    {
                        "id": "drug.nurofen.instruction",
                        "path": "nurofen.pdf",
                        "title": "Нурофен",
                        "versionLabel": "grls-current",
                        "sourceType": "official_drug_instruction",
                        "status": "active",
                        "format": "pdf",
                        "metadata": {"registrationNumber": "ЛП-NUROFEN"},
                    },
                    {
                        "id": "drug.missing.instruction",
                        "path": "missing.pdf",
                        "title": "Неизвестный препарат",
                        "versionLabel": "grls-current",
                        "sourceType": "official_drug_instruction",
                        "status": "active",
                        "format": "pdf",
                        "metadata": {"registrationNumber": "ЛП-MISSING"},
                    },
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    workspace = root / "workspace"
    workspace.mkdir()
    (workspace / "manifest.yaml").write_text(
        "builtAt: '2026-09-01T00:00:00Z'\n",
        encoding="utf-8",
    )
    return catalog, registry, workspace


def _write_nurofen_instruction(workspace: Path) -> None:
    (workspace / "drug.nurofen.instruction.md").write_text(
        """---
id: drug.nurofen.instruction
title: Нурофен
version_label: grls-current
source_type: official_drug_instruction
status: active
source_checksum: sha256:nurofen
metadata:
  registrationNumber: ЛП-NUROFEN
  extraction:
    requiresReview: true
---

# Показания к применению

Симптоматическое лечение лихорадки.

# Противопоказания

Повышенная чувствительность к ибупрофену.

# Способ применения и дозы

Доза зависит от возраста и массы тела ребёнка. Разовая доза составляет 10-15 мг/кг
3-4 раза в сутки с интервалом не менее 4 ч.

# Фармакодинамика

Этот раздел не является карточным фактом.
""",
        encoding="utf-8",
    )


def test_grls_entities_keep_exact_esklp_identity_and_report_missing_links(
    tmp_path: Path,
) -> None:
    catalog, registry, workspace = _write_grls_inputs(tmp_path)
    esklp_pack = tmp_path / "esklp.db"
    _write_esklp_pack(esklp_pack)
    output = tmp_path / "knowledge.json"
    report = tmp_path / "report.json"

    summary = build_grls_product_workspace(
        catalog,
        registry,
        workspace,
        output,
        report_output=report,
        esklp_packs=[esklp_pack],
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    nurofen_registration = next(
        entity
        for entity in payload["entities"]
        if entity["id"].startswith("medication.registration.")
        and entity["medication"]["registrationNumber"] == "ЛП-NUROFEN"
    )
    assert nurofen_registration["externalIds"]["esklp-mnn-document-id"] == ("esklp.mnn.ibuprofen")
    assert nurofen_registration["metadata"]["esklpMnnDocumentId"] == "esklp.mnn.ibuprofen"
    assert nurofen_registration["medication"]["metadata"]["esklpSmnnCode"] == ("SMNN-SUSPENSION")
    assert nurofen_registration["medication"]["metadata"]["esklpKlpCode"] == "KLP-NUROFEN"

    registry_card = next(
        document
        for document in load_workspace_documents(workspace)
        if document.source_type == "official_registry_summary"
        and document.metadata.get("registrationNumber") == "ЛП-NUROFEN"
    )
    assert registry_card.metadata["instructionDocumentId"] == "drug.nurofen.instruction"
    assert registry_card.metadata["mnnDocumentId"] == "esklp.mnn.ibuprofen"
    assert registry_card.metadata["smnnCode"] == "SMNN-SUSPENSION"
    assert registry_card.metadata["smnnCodes"] == ["SMNN-SUSPENSION"]
    assert registry_card.metadata["klpCodes"] == ["KLP-NUROFEN"]

    presentation = next(
        entity
        for entity in payload["entities"]
        if entity["id"].startswith("medication.presentation.")
        and entity["medication"]["registrationNumber"] == "ЛП-NUROFEN"
    )
    assert presentation["metadata"]["esklpMnnDocumentId"] == "esklp.mnn.ibuprofen"
    assert presentation["metadata"]["esklpSmnnCode"] == "SMNN-SUSPENSION"
    assert presentation["metadata"]["esklpKlpCode"] == "KLP-NUROFEN"
    assert any(
        link["entityId"] == presentation["id"] and link["metadata"]["esklpKlpCode"] == "KLP-NUROFEN"
        for link in payload["documentLinks"]
    )

    report_payload = json.loads(report.read_text(encoding="utf-8"))
    assert report_payload["esklpCrosswalk"] == {
        "sourcePacks": [str(esklp_pack.resolve())],
        "indexedRegistrations": 1,
        "matchedRegistrations": 1,
        "ambiguousRegistrations": 0,
        "unmatchedRegistrations": 1,
    }
    missing_tasks = [
        task for task in payload["reviewTasks"] if task["taskType"] == "missing-esklp-crosswalk"
    ]
    assert len(missing_tasks) == 1
    assert missing_tasks[0]["metadata"]["registrationNumber"] == "ЛП-MISSING"
    review_task_count = summary["reviewTasks"]
    assert isinstance(review_task_count, int) and review_task_count >= 1


def test_grls_without_esklp_input_keeps_existing_report_shape(tmp_path: Path) -> None:
    catalog, registry, workspace = _write_grls_inputs(tmp_path)
    output = tmp_path / "knowledge.json"

    report = build_grls_product_workspace(catalog, registry, workspace, output)

    assert "esklpCrosswalk" not in report
    assert not any(
        task["taskType"] in {"missing-esklp-crosswalk", "ambiguous-esklp-crosswalk"}
        for task in json.loads(output.read_text(encoding="utf-8"))["reviewTasks"]
    )


def test_grls_projects_exact_instruction_sections_as_proposed_registration_facts(
    tmp_path: Path,
) -> None:
    catalog, registry, workspace = _write_grls_inputs(tmp_path)
    _write_nurofen_instruction(workspace)
    output = tmp_path / "knowledge.json"

    report = build_grls_product_workspace(catalog, registry, workspace, output)

    payload = json.loads(output.read_text(encoding="utf-8"))
    registration = next(
        entity
        for entity in payload["entities"]
        if entity["id"].startswith("medication.registration.")
        and entity["medication"]["registrationNumber"] == "ЛП-NUROFEN"
    )
    facts = [fact for fact in payload["facts"] if fact["entityId"] == registration["id"]]
    assert {fact["factType"] for fact in facts} == {
        "administration",
        "contraindication",
        "dosage",
        "indication",
    }
    assert all(fact["authorityTier"] == "official-label" for fact in facts)
    assert all(fact["reviewStatus"] == "proposed" for fact in facts)
    assert all(fact["metadata"]["sourceExtractionRequiresReview"] is True for fact in facts)
    indication = next(fact for fact in facts if fact["factType"] == "indication")
    assert indication["text"] == "Симптоматическое лечение лихорадки."
    assert indication["evidence"][0]["quote"] == indication["text"]
    assert indication["evidence"][0]["documentId"] == "drug.nurofen.instruction"
    dosage = next(fact for fact in facts if fact["factType"] == "dosage")
    assert dosage["structured"] == {
        "doseExpressions": [
            {
                "minimum": 10,
                "maximum": 15,
                "unit": "мг",
                "per": "kg",
                "role": "single",
                "sourceText": "10-15 мг/кг",
            }
        ],
        "frequencyExpressions": [
            {
                "minimum": 3,
                "maximum": 4,
                "period": "day",
                "sourceText": "3-4 раза в сутки",
            }
        ],
        "intervalExpressions": [
            {
                "value": 4,
                "unit": "hour",
                "kind": "minimum",
                "sourceText": "интервалом не менее 4 ч",
            }
        ],
    }
    assert dosage["population"] == {"ageGroup": "children", "weight": "required"}
    assert dosage["approvalStatus"] == "registered"
    assert dosage["reviewStatus"] == "proposed"
    assert dosage["evidence"][0]["quote"] == dosage["text"]
    assert dosage["metadata"]["parentAdministrationFactId"].startswith("fact.grls.")
    assert report["facts"] == 4


def test_grls_group_case_variants_preserve_names_and_share_identity(tmp_path: Path) -> None:
    catalog, registry, workspace = _write_grls_inputs(tmp_path)
    payload = json.loads(catalog.read_text(encoding="utf-8"))
    for record, group in zip(payload["records"], ["Вакцины", "вакцины"], strict=True):
        record["pharmacotherapeuticGroup"] = group
    catalog.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    output = tmp_path / "knowledge.json"
    build_grls_product_workspace(catalog, registry, workspace, output)
    knowledge = json.loads(output.read_text(encoding="utf-8"))
    groups = [item for item in knowledge["entities"] if item["entityType"] == "medication-class"]
    assert len(groups) == 1
    assert {name["name"] for name in groups[0]["names"]} == {"Вакцины", "вакцины"}


def test_grls_brand_aggregates_distinct_registrations_without_merging_them(
    tmp_path: Path,
) -> None:
    catalog, registry, workspace = _write_grls_inputs(tmp_path)
    catalog_payload = json.loads(catalog.read_text(encoding="utf-8"))
    catalog_payload["records"][1]["tradeName"] = "Нурофен"
    catalog_payload["records"][1]["inn"] = "КОДЕИН"
    catalog.write_text(json.dumps(catalog_payload, ensure_ascii=False), encoding="utf-8")
    esklp_pack = tmp_path / "esklp.db"
    _write_esklp_pack(esklp_pack)
    output = tmp_path / "knowledge.json"

    build_grls_product_workspace(
        catalog,
        registry,
        workspace,
        output,
        esklp_packs=[esklp_pack],
    )

    payload = json.loads(output.read_text(encoding="utf-8"))
    brands = [
        entity
        for entity in payload["entities"]
        if entity["id"].startswith("medication.brand.") and entity["canonicalName"] == "Нурофен"
    ]
    registrations = [
        entity
        for entity in payload["entities"]
        if entity["id"].startswith("medication.registration.")
    ]
    assert len(brands) == 1
    assert brands[0]["medication"]["inn"] == "ИБУПРОФЕН; КОДЕИН"
    assert brands[0]["metadata"]["esklpMnnDocumentIds"] == ["esklp.mnn.ibuprofen"]
    assert len(registrations) == 2
