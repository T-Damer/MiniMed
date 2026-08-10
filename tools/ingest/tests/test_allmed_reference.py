from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.allmed_reference import export_allmed_reference, prepare_allmed_medications
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
                untouched_field TEXT
            );
            CREATE TABLE ingredients (id INTEGER PRIMARY KEY, name_ru TEXT, description TEXT);
            CREATE TABLE categories (id INTEGER PRIMARY KEY, name TEXT, description TEXT);
            CREATE TABLE ingredients_relation (drug_id INTEGER, ingredient_id INTEGER);
            CREATE TABLE categories_relation (
                id INTEGER PRIMARY KEY, drug_id INTEGER, category_id INTEGER
            );
            INSERT INTO drugs VALUES (1, 'Тестовый препарат', 'Test drug', 'Тест-альфа',
                'таблетки', '', '<div>400 мг<br /><br /></div><div>после еды</div>',
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
    assert report.empty_value_counts["pharma_effect"] == 1
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
    assert "<div>" not in document
    assert "<br" not in document
    assert "400 мг\n\nпосле еды" in document
