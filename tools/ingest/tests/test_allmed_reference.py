from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import cast

import pytest
import yaml

from localmed_ingest.allmed_reference import (
    export_allmed_reference,
    load_esklp_mnn_identities,
    prepare_allmed_medications,
)
from localmed_ingest.builder import build_content_pack
from localmed_ingest.edition_manifest import sha256_file


def write_allmed_fixture(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE drugs (
                id INTEGER PRIMARY KEY, name_ru TEXT, name_lat TEXT, analogs TEXT,
                production_form TEXT, pharma_effect TEXT, method_of_use_man TEXT,
                recipe TEXT, recipe_ru TEXT, img TEXT, untouched_field TEXT
            );
            CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name_ru TEXT, description TEXT);
            CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
            CREATE TABLE ingredients_relation (drug_id INTEGER, ingredient_id INTEGER);
            CREATE TABLE categories_relation (
                id INTEGER PRIMARY KEY, drug_id INTEGER, category_id INTEGER
            );
            INSERT INTO drugs VALUES (1, 'Тестовый препарат', 'Test drug', 'Тест-альфа',
                'таблетки', 'Краткое действие',
                '<div>400 мг<br /><br /></div><div>после еды</div>',
                '<div>Rp.: Tab. Test 0,4</div>', '<div>Принимать после еды</div>',
                'img/preparations/1.png',
                'сохраняется как есть');
            INSERT INTO ingredients VALUES (4, 'Тестовое вещество', 'Исходное описание');
            INSERT INTO categories VALUES (9, 'Тестовая категория', 'Исходная категория');
            INSERT INTO ingredients_relation VALUES (1, 4);
            INSERT INTO categories_relation VALUES (2, 1, 9);
            PRAGMA user_version = 19;
            """
        )
        connection.commit()
    finally:
        connection.close()


def write_crosswalk_fixture(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE drugs (
                id INTEGER PRIMARY KEY, name_ru TEXT, name_lat TEXT, analogs TEXT,
                production_form TEXT, pharma_effect TEXT, method_of_use_man TEXT,
                recipe TEXT, recipe_ru TEXT, img TEXT
            );
            CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name_ru TEXT, description TEXT);
            CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
            CREATE TABLE ingredients_relation (drug_id INTEGER, ingredient_id INTEGER);
            CREATE TABLE categories_relation (
                id INTEGER PRIMARY KEY, drug_id INTEGER, category_id INTEGER
            );
            INSERT INTO drugs (id, name_ru, production_form, img) VALUES
                (1, 'Нурофен', 'суспензия', 'img/nurofen.png'),
                (2, 'Нурофен Плюс', 'таблетки', 'img/nurofen-plus.png'),
                (3, 'Неизвестный препарат', 'капсулы', NULL),
                (4, 'Нурофен только по названию', 'таблетки', NULL);
            INSERT INTO ingredients VALUES
                (4, 'Ибупрофен', 'Ибупрофен'),
                (5, 'Кодеина фосфата гемигидрат', 'Codeini phosphatis hemihydras'),
                (6, 'Неизвестное вещество', 'Неизвестное вещество');
            INSERT INTO ingredients_relation VALUES
                (1, 4), (2, 4), (2, 5), (3, 6);
            PRAGMA user_version = 20;
            """
        )
        connection.commit()
    finally:
        connection.close()


def test_exports_source_preserving_review_only_candidates(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    output = tmp_path / "allmed-reference.jsonl"
    write_allmed_fixture(source)

    report = export_allmed_reference(source, output)

    assert report.drug_candidates == 1
    assert report.ingredient_relation_rows == 1
    assert report.category_relation_rows == 1
    assert report.input_sha256 == sha256_file(source)
    assert report.sqlite_user_version == 19
    assert report.empty_value_counts["pharma_effect"] == 0
    candidate = json.loads(output.read_text(encoding="utf-8"))
    assert candidate["reviewStatus"] == "reference-only"
    assert candidate["source"] == {"table": "drugs", "rowIdentity": {"id": 1}}
    assert candidate["inputSnapshot"] == {
        "sha256": report.input_sha256,
        "sqliteSchemaVersion": report.sqlite_schema_version,
        "sqliteUserVersion": 19,
    }
    assert candidate["rawRows"][0]["fields"]["untouched_field"] == "сохраняется как есть"
    assert candidate["fieldGroups"]["analogProducts"] == [{"sourceRow": 0, "column": "analogs"}]
    assert candidate["fieldGroups"]["prescriptionExamples"] == [
        {"sourceRow": 0, "column": "recipe"},
        {"sourceRow": 0, "column": "recipe_ru"},
    ]
    assert candidate["fieldGroups"]["images"] == [{"sourceRow": 0, "column": "img"}]
    assert "aliasesOrTradeNames" not in candidate["fieldGroups"]
    assert candidate["relationOrdering"] == {
        "ingredients_relation": "rowid ASC within drugs.id",
        "categories_relation": "rowid ASC within drugs.id",
    }
    relation_rows = [row for row in candidate["rawRows"] if row["table"].endswith("_relation")]
    assert relation_rows == [
        {
            "table": "ingredients_relation",
            "rowIdentity": {"rowid": 1},
            "fields": {"drug_id": 1, "ingredient_id": 4},
        },
        {
            "table": "categories_relation",
            "rowIdentity": {"rowid": 2},
            "fields": {"category_id": 9, "drug_id": 1, "id": 2},
        },
    ]
    assert {row["table"] for row in candidate["rawRows"]} == {
        "drugs",
        "ingredients_relation",
        "ingredients",
        "categories_relation",
        "categories",
    }


def test_rejects_non_sqlite_input(tmp_path: Path) -> None:
    source = tmp_path / "not-a-database.db"
    source.write_text("not sqlite", encoding="utf-8")

    with pytest.raises(ValueError, match="not a valid SQLite database"):
        export_allmed_reference(source, tmp_path / "allmed-reference.jsonl")


def test_rejects_output_that_would_overwrite_input(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    write_allmed_fixture(source)
    before = source.read_bytes()

    with pytest.raises(ValueError, match="must not overwrite"):
        export_allmed_reference(source, source)

    assert source.read_bytes() == before


def test_reports_missing_optional_candidate_columns(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    write_allmed_fixture(source)
    connection = sqlite3.connect(source)
    try:
        connection.execute("ALTER TABLE drugs DROP COLUMN analogs")
        connection.commit()
    finally:
        connection.close()

    report = export_allmed_reference(source, tmp_path / "allmed-reference.jsonl")

    assert report.missing_columns == ["analogs"]


def test_prepares_allmed_snapshot_as_lexical_medications_pack(tmp_path: Path) -> None:
    source = tmp_path / "allmed.db"
    write_allmed_fixture(source)
    workspace = tmp_path / "medications"

    report = prepare_allmed_medications(source, workspace)
    _, build_report = build_content_pack(
        workspace,
        tmp_path / "medications.db",
        include_embeddings=False,
    )

    assert report.documents == 1
    assert build_report.documents == 1
    document = (workspace / "drug.allmed.1.md").read_text(encoding="utf-8")
    assert "source_type: allmed_reference" in document
    assert '"table":"drugs","drugId":1,"column":"indications"' not in document
    assert '"table":"drugs","drugId":1,"column":"production_form"' in document
    assert '"table":"drugs","drugId":1,"column":"recipe"' in document
    assert '"table":"drugs","drugId":1,"column":"recipe_ru"' in document
    assert "Пример рецепта — справочно, не назначение" in document
    assert "shortDescription: Краткое действие" in document
    assert "img: img/preparations/1.png" in document
    assert '"table":"ingredients_relation","drugId":1,"column":"ingredient_id"' in document
    assert "Тестовое вещество" in document
    assert "<div>" not in document
    assert "<br" not in document
    assert "400 мг\n\nпосле еды" in document


def test_prepares_ingredient_crosswalk_conservatively_and_keeps_images(tmp_path: Path) -> None:
    source = tmp_path / "allmed-crosswalk.db"
    write_crosswalk_fixture(source)
    workspace = tmp_path / "medications-crosswalk"
    identities = [
        {
            "recordId": "esklp.mnn.ibuprofen-200",
            "standardizedInn": "Ибупрофен",
        },
        {
            "recordId": "esklp.mnn.ibuprofen-suspension",
            "standardizedInn": "Ибупрофен",
        },
        {
            "recordId": "esklp.mnn.ibuprofen-codeine",
            "standardizedInn": "Ибупрофен+Кодеин",
            "componentInns": ["Ибупрофен", "Кодеин"],
        },
    ]

    prepare_allmed_medications(source, workspace, esklp_identities=identities)

    def metadata_for(drug_id: int) -> dict[str, object]:
        text = (workspace / f"drug.allmed.{drug_id}.md").read_text(encoding="utf-8")
        end = text.find("\n---\n", 4)
        payload = yaml.safe_load(text[4:end])
        assert isinstance(payload, dict)
        metadata = cast(dict[str, object], payload)["metadata"]
        assert isinstance(metadata, dict)
        return cast(dict[str, object], metadata)

    ambiguous = metadata_for(1)
    assert ambiguous["mappingStatus"] == "ambiguous"
    assert set(cast(list[str], ambiguous["mappingCandidates"])) == {
        "esklp.mnn.ibuprofen-200",
        "esklp.mnn.ibuprofen-suspension",
    }
    assert "linkedMnnDocumentId" not in ambiguous
    assert ambiguous["img"] == "img/nurofen.png"
    assert ambiguous["ingredientIds"] == [4]
    assert ambiguous["ingredientNames"] == ["Ибупрофен"]

    linked = metadata_for(2)
    assert linked["linkedMnnDocumentId"] == "esklp.mnn.ibuprofen-codeine"
    assert linked["mappingMethod"] == "normalized-ingredient-composition"
    assert linked["ingredientIds"] == [4, 5]
    assert linked["img"] == "img/nurofen-plus.png"
    relations = linked["ingredientRelations"]
    assert isinstance(relations, list)
    assert relations[0]["ingredient"]["fields"]["name_ru"] == "Ибупрофен"

    unmatched = metadata_for(3)
    assert unmatched["mappingStatus"] == "unmatched"
    assert "linkedMnnDocumentId" not in unmatched

    name_only = metadata_for(4)
    assert name_only["mappingStatus"] == "unmatched"
    assert "linkedMnnDocumentId" not in name_only


def write_esklp_pointer_fixture(path: Path, *, duplicate: bool = False) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            CREATE TABLE documents (
                id TEXT PRIMARY KEY, source_type TEXT NOT NULL, metadata_json TEXT NOT NULL
            );
            """
        )
        rows = [
            (
                "pointer-1",
                "core_catalog_pointer",
                json.dumps(
                    {
                        "catalogFamily": "medication",
                        "targetDocumentId": "esklp.mnn.ibuprofen",
                        "standardizedInn": "ИБУПРОФЕН",
                    },
                    ensure_ascii=False,
                ),
            )
        ]
        if duplicate:
            rows.append(
                (
                    "pointer-2",
                    "core_catalog_pointer",
                    json.dumps(
                        {
                            "catalogFamily": "medication",
                            "targetDocumentId": "esklp.mnn.ibuprofen",
                            "standardizedInn": "ИБУПРОФЕН",
                        },
                        ensure_ascii=False,
                    ),
                )
            )
        connection.executemany("INSERT INTO documents VALUES (?, ?, ?)", rows)
        connection.commit()
    finally:
        connection.close()


def test_loads_and_validates_esklp_pointer_sqlite(tmp_path: Path) -> None:
    pointer = tmp_path / "pointers.db"
    write_esklp_pointer_fixture(pointer)

    identities = load_esklp_mnn_identities(pointer)

    assert [(item.document_id, item.standardized_inn) for item in identities] == [
        ("esklp.mnn.ibuprofen", "ИБУПРОФЕН")
    ]


def test_rejects_duplicate_esklp_pointer_targets(tmp_path: Path) -> None:
    pointer = tmp_path / "duplicate-pointers.db"
    write_esklp_pointer_fixture(pointer, duplicate=True)

    with pytest.raises(ValueError, match="duplicate targetDocumentId"):
        load_esklp_mnn_identities(pointer)
