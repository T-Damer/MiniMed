from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from uuid import uuid4

from .edition_manifest import sha256_file
from .models import CamelModel

_REQUIRED_TABLES = {
    "drugs": {"id"},
    "ingredients": {"id"},
    "categories": {"id"},
    "ingredients_relation": {"drug_id", "ingredient_id"},
    "categories_relation": {"id", "drug_id", "category_id"},
}
_CANDIDATE_COLUMNS = {
    "name_ru",
    "name_lat",
    "analogs",
    "production_form",
    "pharma_effect",
}


class AllmedReferenceExport(CamelModel):
    input: str
    output: str
    input_sha256: str
    sqlite_schema_version: int
    sqlite_user_version: int
    drug_candidates: int
    ingredient_relation_rows: int
    category_relation_rows: int
    missing_columns: list[str]
    empty_value_counts: dict[str, int]


def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _as_row(row: sqlite3.Row, table: str, identity: dict[str, object]) -> dict[str, object]:
    columns = tuple(row.keys())
    return {
        "table": table,
        "rowIdentity": identity,
        "fields": {key: row[key] for key in columns},
    }


def _field_ref(column: str) -> dict[str, object]:
    return {"sourceRow": 0, "column": column}


def _validate_schema(connection: sqlite3.Connection, input_path: Path) -> set[str]:
    tables = {
        str(row[0])
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    missing_tables = sorted(set(_REQUIRED_TABLES) - tables)
    if missing_tables:
        raise ValueError(f"Allmed reference input lacks tables: {missing_tables}")
    drug_columns = _columns(connection, "drugs")
    for table, required in _REQUIRED_TABLES.items():
        missing = sorted(required - _columns(connection, table))
        if missing:
            raise ValueError(
                f"Allmed reference input {input_path} lacks {table} columns: {missing}"
            )
    return drug_columns


def _relation_rows(
    connection: sqlite3.Connection,
    drug_id: int,
    relation_table: str,
    related_table: str,
    related_id_column: str,
) -> list[dict[str, object]]:
    relation_columns = sorted(_columns(connection, relation_table))
    related_columns = sorted(_columns(connection, related_table))
    select_columns = [
        *(f"relation.{column} AS relation__{column}" for column in relation_columns),
        *(f"related.{column} AS related__{column}" for column in related_columns),
    ]
    rows = connection.execute(
        f"""SELECT relation.rowid AS relation__rowid, {", ".join(select_columns)}
        FROM {relation_table} relation
        LEFT JOIN {related_table} related ON related.id = relation.{related_id_column}
        WHERE relation.drug_id = ?
        ORDER BY relation.rowid""",
        (drug_id,),
    ).fetchall()
    result: list[dict[str, object]] = []
    for row in rows:
        relation_fields = {column: row[f"relation__{column}"] for column in relation_columns}
        related_id = row["related__id"]
        raw_rows: list[dict[str, object]] = [
            {
                "table": relation_table,
                "rowIdentity": {"rowid": int(row["relation__rowid"])},
                "fields": relation_fields,
            }
        ]
        if related_id is not None:
            raw_rows.append(
                {
                    "table": related_table,
                    "rowIdentity": {"id": related_id},
                    "fields": {column: row[f"related__{column}"] for column in related_columns},
                }
            )
        result.extend(raw_rows)
    return result


def export_allmed_reference(input_path: Path, output: Path) -> AllmedReferenceExport:
    """Export raw Allmed rows as review-only candidates, without clinical transformation."""
    if not input_path.is_file():
        raise ValueError(f"Allmed reference input is not a file: {input_path}")
    if input_path.resolve() == output.resolve():
        raise ValueError("Allmed reference output must not overwrite the input SQLite database.")
    try:
        connection = sqlite3.connect(f"file:{input_path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA schema_version").fetchone()
    except sqlite3.DatabaseError as error:
        raise ValueError(
            f"Allmed reference input is not a valid SQLite database: {input_path}"
        ) from error

    try:
        input_sha256 = sha256_file(input_path)
        sqlite_schema_version = int(connection.execute("PRAGMA schema_version").fetchone()[0])
        sqlite_user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        drug_columns = _validate_schema(connection, input_path)
        missing_columns = sorted(_CANDIDATE_COLUMNS - drug_columns)
        tracked_columns = sorted(_CANDIDATE_COLUMNS & drug_columns)
        empty_value_counts = {
            column: int(
                connection.execute(
                    f"SELECT count(*) FROM drugs WHERE {column} IS NULL OR {column} = ''"
                ).fetchone()[0]
            )
            for column in tracked_columns
        }
        ingredient_relations = int(
            connection.execute("SELECT count(*) FROM ingredients_relation").fetchone()[0]
        )
        category_relations = int(
            connection.execute("SELECT count(*) FROM categories_relation").fetchone()[0]
        )
        temporary = output.with_name(f".{output.name}.stage-{uuid4().hex}")
        output.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        try:
            with temporary.open("w", encoding="utf-8") as destination:
                for drug in connection.execute("SELECT * FROM drugs ORDER BY id"):
                    drug_id = int(drug["id"])
                    raw_rows = [_as_row(drug, "drugs", {"id": drug_id})]
                    raw_rows.extend(
                        _relation_rows(
                            connection,
                            drug_id,
                            "ingredients_relation",
                            "ingredients",
                            "ingredient_id",
                        )
                    )
                    raw_rows.extend(
                        _relation_rows(
                            connection,
                            drug_id,
                            "categories_relation",
                            "categories",
                            "category_id",
                        )
                    )
                    groups = {
                        "names": [
                            _field_ref(column)
                            for column in ("name_ru", "name_lat")
                            if column in drug_columns
                        ],
                        "analogProducts": [_field_ref("analogs")]
                        if "analogs" in drug_columns
                        else [],
                        "forms": [_field_ref("production_form")]
                        if "production_form" in drug_columns
                        else [],
                        "shortText": [_field_ref("pharma_effect")]
                        if "pharma_effect" in drug_columns
                        else [],
                    }
                    candidate = {
                        "artifactType": "allmed-reference-candidate",
                        "reviewStatus": "reference-only",
                        "inputSnapshot": {
                            "sha256": input_sha256,
                            "sqliteSchemaVersion": sqlite_schema_version,
                            "sqliteUserVersion": sqlite_user_version,
                        },
                        "source": {"table": "drugs", "rowIdentity": {"id": drug_id}},
                        "rawRows": raw_rows,
                        "fieldGroups": groups,
                        "relationOrdering": {
                            "ingredients_relation": "rowid ASC within drugs.id",
                            "categories_relation": "rowid ASC within drugs.id",
                        },
                    }
                    destination.write(
                        json.dumps(candidate, ensure_ascii=False, separators=(",", ":")) + "\n"
                    )
                    count += 1
            temporary.replace(output)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    finally:
        connection.close()
    return AllmedReferenceExport(
        input=str(input_path),
        output=str(output),
        input_sha256=input_sha256,
        sqlite_schema_version=sqlite_schema_version,
        sqlite_user_version=sqlite_user_version,
        drug_candidates=count,
        ingredient_relation_rows=ingredient_relations,
        category_relation_rows=category_relations,
        missing_columns=missing_columns,
        empty_value_counts=empty_value_counts,
    )
