from __future__ import annotations

import json
import re
import shutil
import sqlite3
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from html import unescape
from itertools import product
from pathlib import Path
from typing import Literal, cast
from unicodedata import normalize as unicode_normalize
from uuid import uuid4

import yaml
from pydantic import Field

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
    "recipe",
    "recipe_ru",
    "img",
}
_RUNTIME_SECTIONS = (
    ("production_form", "Лекарственная форма"),
    ("pharma_effect", "Фармакологическое действие"),
    ("recipe", "Пример рецепта — справочно, не назначение"),
    ("recipe_ru", "Расшифровка примера рецепта — справочно"),
    ("method_of_use_man", "Способ применения у взрослых"),
    ("method_of_use_child", "Способ применения у детей"),
    ("indications", "Показания"),
    ("contraindications", "Противопоказания"),
    ("side_effect", "Побочные действия"),
    ("pharmacodynamics", "Фармакодинамика"),
    ("pharmacokinetics", "Фармакокинетика"),
    ("special_instructions", "Особые указания"),
    ("overdose", "Передозировка"),
    ("interaction", "Взаимодействие с лекарственными средствами"),
    ("analogs", "Аналоги"),
)
_HTML_LINE_BREAK_TAG = re.compile(r"<(?:br\b[^>]*|/(?:div|p|ul|ol|li)\b[^>]*)>", re.IGNORECASE)
_HTML_TAG = re.compile(r"</?(?:br|div|p|ul|ol|li|span|strong|b|em|i)\b[^>]*>", re.IGNORECASE)


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


class AllmedMedicationWorkspace(CamelModel):
    input: str
    output: str
    input_sha256: str
    documents: int
    version_label: str
    mapping_counts: dict[str, int] = Field(default_factory=dict)
    safe_image_references: int = 0
    invalid_image_references: int = 0


class EsklpMnnIdentity(CamelModel):
    """The minimum ESKLP identity needed for a deterministic Allmed crosswalk."""

    document_id: str
    standardized_inn: str
    inn: list[str] = Field(default_factory=list)
    component_inns: list[str] = Field(default_factory=list)


AllmedMappingStatus = Literal["linked", "ambiguous", "unmatched"]
_ALLMED_ESKLP_MAPPING_METHOD = "normalized-ingredient-composition"


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


def _identity_text(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def _identity_key(value: object | None) -> str:
    text = _identity_text(value)
    if text is None:
        return ""
    normalized = unicode_normalize("NFKC", text).replace("ё", "е").casefold()
    return "".join(character for character in normalized if character.isalnum())


def _identity_values(value: object | None) -> list[str]:
    if isinstance(value, (list, tuple, set, frozenset)):
        raw_items = cast(Iterable[object], value)
        items: Iterable[object] = (
            sorted(raw_items, key=lambda item: _identity_key(item))
            if isinstance(value, (set, frozenset))
            else raw_items
        )
    else:
        items = [value]
    result: list[str] = []
    for item in items:
        text = _identity_text(item)
        if text is None:
            continue
        result.extend(part.strip() for part in re.split(r"\s*\+\s*", text) if part.strip())
    return result


def _unique_identity_values(values: Iterable[object]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _identity_text(value)
        key = _identity_key(text)
        if text is None or not key or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


_SALT_MARKERS = frozenset(
    {
        "ацетат",
        "бензоат",
        "бромид",
        "гемигидрат",
        "гидробромид",
        "гидрохлорид",
        "гидроксид",
        "гидросульфат",
        "гидротартрат",
        "гидрофосфат",
        "дигидрат",
        "натрия",
        "нитрат",
        "мезилат",
        "малеат",
        "моногидрат",
        "оксалат",
        "пропионат",
        "соль",
        "сульфат",
        "сукцинат",
        "тартрат",
        "тригидрат",
        "фосфат",
        "фумарат",
        "цитрат",
        "хлорид",
        "этилсукцинат",
    }
)


def _is_salt_marker(value: str) -> bool:
    key = _identity_key(value)
    return key in _SALT_MARKERS or key.removesuffix("а") in _SALT_MARKERS


def _ingredient_identity_keys(value: object | None) -> set[str]:
    """Return exact and conservative salt/base variants for one ingredient label."""
    text = _identity_text(value)
    if text is None:
        return set()
    direct_key = _identity_key(text)
    if not direct_key:
        return set()
    keys = {direct_key}
    words = [word for word in re.split(r"[^\wА-Яа-яЁё]+", text.casefold()) if word]
    marker_index = next(
        (index for index, word in enumerate(words) if _is_salt_marker(word)),
        None,
    )
    if marker_index is not None and marker_index > 0:
        base_words = words[:marker_index]
        base = " ".join(base_words)
        keys.add(_identity_key(base))
        last = base_words[-1]
        if len(last) > 4 and last.endswith(("а", "я")):
            keys.add(_identity_key(" ".join([*base_words[:-1], last[:-1]])))
        elif len(last) > 4 and last.endswith("ы"):
            keys.add(_identity_key(" ".join([*base_words[:-1], last[:-1] + "а"])))
    return {key for key in keys if key}


def _composition_key_variants(values: Iterable[object]) -> set[str]:
    variants = [_ingredient_identity_keys(value) for value in values]
    if not variants or any(not item for item in variants):
        return set()
    return {"|".join(sorted(combination)) for combination in product(*variants) if all(combination)}


def _relative_image_reference(value: str) -> str | None:
    normalized = value.strip().replace("\\", "/")
    if (
        not normalized
        or normalized.startswith("/")
        or re.match(r"^[A-Za-z]:", normalized)
        or "://" in normalized
    ):
        return None
    parts = normalized.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        return None
    return "/".join(parts)


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


def _validate_esklp_identities(
    identities: Iterable[EsklpMnnIdentity],
) -> list[EsklpMnnIdentity]:
    result: list[EsklpMnnIdentity] = []
    seen_document_ids: set[str] = set()
    for identity in identities:
        document_id = _identity_text(identity.document_id)
        standardized_inn = _identity_text(identity.standardized_inn)
        if document_id is None or standardized_inn is None:
            raise ValueError("ESKLP identity requires documentId and standardizedInn.")
        if document_id in seen_document_ids:
            raise ValueError(f"ESKLP identity contains duplicate targetDocumentId: {document_id}")
        seen_document_ids.add(document_id)
        result.append(
            identity.model_copy(
                update={
                    "document_id": document_id,
                    "standardized_inn": standardized_inn,
                }
            )
        )
    if not result:
        raise ValueError("ESKLP identity input contains no medication identities.")
    return result


def _load_esklp_pointer_identities(path: Path) -> list[EsklpMnnIdentity]:
    try:
        connection = sqlite3.connect(f"file:{path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        integrity = str(connection.execute("PRAGMA integrity_check").fetchone()[0])
    except sqlite3.DatabaseError as error:
        raise ValueError(f"ESKLP pointer input is not a valid SQLite database: {path}") from error
    try:
        if integrity != "ok":
            raise ValueError(f"ESKLP pointer input failed integrity check: {integrity}")
        tables = {
            str(row[0])
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        if "documents" not in tables:
            raise ValueError("ESKLP pointer input lacks the documents table.")
        columns = _columns(connection, "documents")
        required = {"id", "source_type", "metadata_json"}
        missing = sorted(required - columns)
        if missing:
            raise ValueError(f"ESKLP pointer input lacks documents columns: {missing}")
        identities: list[EsklpMnnIdentity] = []
        for row in connection.execute(
            "SELECT id, source_type, metadata_json FROM documents ORDER BY id"
        ):
            if row["source_type"] != "core_catalog_pointer":
                raise ValueError(
                    "ESKLP pointer input contains a document with source_type other than "
                    "core_catalog_pointer."
                )
            try:
                metadata = json.loads(str(row["metadata_json"]))
            except (TypeError, json.JSONDecodeError) as error:
                raise ValueError(
                    f"ESKLP pointer document {row['id']} has invalid metadata_json."
                ) from error
            if not isinstance(metadata, dict):
                raise ValueError(f"ESKLP pointer document {row['id']} metadata is not an object.")
            metadata = cast(dict[str, object], metadata)
            if metadata.get("catalogFamily") != "medication":
                raise ValueError(
                    f"ESKLP pointer document {row['id']} is not a medication catalog pointer."
                )
            target_document_id = metadata.get("targetDocumentId")
            standardized_inn = metadata.get("standardizedInn")
            if not isinstance(target_document_id, str) or not target_document_id.strip():
                raise ValueError(f"ESKLP pointer document {row['id']} lacks targetDocumentId.")
            if not isinstance(standardized_inn, str) or not standardized_inn.strip():
                raise ValueError(f"ESKLP pointer document {row['id']} lacks standardizedInn.")
            identities.append(
                EsklpMnnIdentity(
                    document_id=target_document_id,
                    standardized_inn=standardized_inn,
                )
            )
        return _validate_esklp_identities(identities)
    finally:
        connection.close()


def _load_esklp_json_identities(path: Path) -> list[EsklpMnnIdentity]:
    try:
        payload: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"ESKLP identity input is not valid JSON: {path}") from error
    if not path.is_file():
        raise ValueError(f"ESKLP ledger is not a file: {path}")
    raw_records: object = (
        cast(dict[str, object], payload).get("records") if isinstance(payload, dict) else payload
    )
    if not isinstance(raw_records, list):
        raise ValueError("ESKLP identity input must contain a records list.")
    identities: list[EsklpMnnIdentity] = []
    for raw_record in cast(list[object], raw_records):
        if not isinstance(raw_record, dict):
            raise ValueError("ESKLP identity input contains a non-object record.")
        record = cast(dict[str, object], raw_record)
        record_kind = record.get("recordKind")
        if record_kind not in (None, "esklp-mnn"):
            continue
        identities.append(
            EsklpMnnIdentity.model_validate(
                {
                    "documentId": record.get("documentId", record.get("recordId")),
                    "standardizedInn": record.get("standardizedInn"),
                    "inn": record.get("inn", []),
                    "componentInns": record.get("componentInns", []),
                }
            )
        )
    return _validate_esklp_identities(identities)


def load_esklp_mnn_identities(path: Path) -> list[EsklpMnnIdentity]:
    """Load ESKLP identity fields from a JSON ledger or validated pointer SQLite."""
    if not path.is_file():
        raise ValueError(f"ESKLP identity input is not a file: {path}")
    if path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
        return _load_esklp_pointer_identities(path)
    return _load_esklp_json_identities(path)


def _identity_composition_keys(identity: EsklpMnnIdentity) -> set[str]:
    components = _identity_values(identity.component_inns)
    if not components:
        components = _identity_values(identity.standardized_inn)
    keys = _composition_key_variants(components)
    if len(components) == 1:
        keys.update(_composition_key_variants([identity.standardized_inn]))
        keys.update(key for value in identity.inn for key in _composition_key_variants([value]))
    return keys


def _coerce_esklp_identity(
    raw_identity: EsklpMnnIdentity | Mapping[str, object],
) -> EsklpMnnIdentity:
    if isinstance(raw_identity, EsklpMnnIdentity):
        return raw_identity
    return EsklpMnnIdentity.model_validate(
        {
            "documentId": raw_identity.get(
                "documentId",
                raw_identity.get("document_id", raw_identity.get("recordId")),
            ),
            "standardizedInn": raw_identity.get(
                "standardizedInn", raw_identity.get("standardized_inn")
            ),
            "inn": raw_identity.get("inn", []),
            "componentInns": raw_identity.get(
                "componentInns", raw_identity.get("component_inns", [])
            ),
        }
    )


def build_esklp_mnn_crosswalk(
    identities: Iterable[EsklpMnnIdentity | Mapping[str, object]],
) -> dict[str, tuple[str, ...]]:
    """Build a conservative composition-key → ESKLP target crosswalk."""
    candidates: dict[str, set[str]] = defaultdict(set)
    normalized_identities = _validate_esklp_identities(
        _coerce_esklp_identity(raw_identity) for raw_identity in identities
    )
    for identity in normalized_identities:
        target_id = identity.document_id
        for key in _identity_composition_keys(identity):
            candidates[key].add(target_id)
    return {key: tuple(sorted(targets)) for key, targets in sorted(candidates.items())}


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


def _ingredient_relation_records_from_raw_rows(
    raw_rows: Sequence[dict[str, object]],
) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    current: dict[str, object] | None = None
    for row in raw_rows:
        if row["table"] == "ingredients_relation":
            if current is not None:
                result.append(current)
            current = {"relation": row, "ingredient": None}
        elif current is not None:
            current["ingredient"] = row
    if current is not None:
        result.append(current)
    return result


def _load_ingredient_relations(
    connection: sqlite3.Connection,
) -> dict[int, list[dict[str, object]]]:
    """Read all ingredient joins once; preparation otherwise becomes N+1 queries."""
    relation_columns = sorted(_columns(connection, "ingredients_relation"))
    ingredient_columns = sorted(_columns(connection, "ingredients"))
    select_columns = [
        "relation.drug_id AS __drug_id",
        "relation.rowid AS relation__rowid",
        *(f"relation.{column} AS relation__{column}" for column in relation_columns),
        *(f"ingredient.{column} AS ingredient__{column}" for column in ingredient_columns),
    ]
    rows = connection.execute(
        f"""SELECT {", ".join(select_columns)}
        FROM ingredients_relation relation
        LEFT JOIN ingredients ingredient ON ingredient.id = relation.ingredient_id
        ORDER BY relation.drug_id, relation.rowid"""
    ).fetchall()
    raw_by_drug: dict[int, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        raw_drug_id = row["__drug_id"]
        if raw_drug_id is None:
            continue
        relation_fields = {column: row[f"relation__{column}"] for column in relation_columns}
        related_id = row["ingredient__id"]
        raw_rows: list[dict[str, object]] = [
            {
                "table": "ingredients_relation",
                "rowIdentity": {"rowid": int(row["relation__rowid"])},
                "fields": relation_fields,
            }
        ]
        if related_id is not None:
            raw_rows.append(
                {
                    "table": "ingredients",
                    "rowIdentity": {"id": related_id},
                    "fields": {
                        column: row[f"ingredient__{column}"] for column in ingredient_columns
                    },
                }
            )
        raw_by_drug[int(raw_drug_id)].extend(raw_rows)
    return {
        drug_id: _ingredient_relation_records_from_raw_rows(raw_rows)
        for drug_id, raw_rows in raw_by_drug.items()
    }


def _ingredient_names(records: Sequence[dict[str, object]]) -> list[str]:
    names: list[str] = []
    for record in records:
        ingredient = record.get("ingredient")
        if not isinstance(ingredient, Mapping):
            continue
        fields_value = cast(Mapping[str, object], ingredient).get("fields")
        fields = (
            cast(Mapping[str, object], fields_value) if isinstance(fields_value, Mapping) else None
        )
        if not isinstance(fields, Mapping):
            continue
        for column in ("name_ru", "name", "inn", "title", "name_lat"):
            name = _identity_text(fields.get(column))
            if name:
                names.append(name)
                break
    return _unique_identity_values(names)


def _ingredient_ids(records: Sequence[dict[str, object]]) -> list[object]:
    result: list[object] = []
    seen: set[str] = set()
    for record in records:
        relation = record.get("relation")
        if not isinstance(relation, Mapping):
            continue
        fields_value = cast(Mapping[str, object], relation).get("fields")
        fields = (
            cast(Mapping[str, object], fields_value) if isinstance(fields_value, Mapping) else None
        )
        if not isinstance(fields, Mapping):
            continue
        ingredient_id: object | None = fields.get("ingredient_id")
        if ingredient_id is None:
            continue
        key = str(ingredient_id)
        if key in seen:
            continue
        seen.add(key)
        result.append(ingredient_id)
    return result


def _resolve_allmed_mapping(
    ingredient_names: Sequence[str],
    crosswalk: Mapping[str, tuple[str, ...]],
) -> tuple[AllmedMappingStatus, tuple[str, ...]]:
    candidates = tuple(
        sorted(
            {
                target
                for key in _composition_key_variants(ingredient_names)
                for target in crosswalk.get(key, ())
            }
        )
    )
    if len(candidates) == 1:
        return "linked", candidates
    if len(candidates) > 1:
        return "ambiguous", candidates
    return "unmatched", ()


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
                        "prescriptionExamples": [
                            _field_ref(column)
                            for column in ("recipe", "recipe_ru")
                            if column in drug_columns
                        ],
                        "images": [_field_ref("img")] if "img" in drug_columns else [],
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


def _source_marker(table: str, drug_id: int, column: str) -> str:
    return (
        "<!-- localmed:source "
        + json.dumps(
            {"table": table, "drugId": drug_id, "column": column},
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + " -->"
    )


def _field_text(row: sqlite3.Row, column: str) -> str:
    try:
        value = row[column]
    except IndexError:
        value = None
    return value if isinstance(value, str) else ""


def _clean_allmed_text(value: str) -> str:
    if "<" not in value and "&" not in value:
        return value
    with_line_breaks = _HTML_LINE_BREAK_TAG.sub("\n", value)
    without_tags = _HTML_TAG.sub("", with_line_breaks)
    decoded = unescape(without_tags)
    normalized = "\n".join(line.strip() for line in decoded.splitlines()).strip()
    return re.sub(r"\n{3,}", "\n\n", normalized)


def prepare_allmed_medications(
    input_path: Path,
    output: Path,
    *,
    esklp_identities: Iterable[EsklpMnnIdentity | Mapping[str, object]] | None = None,
) -> AllmedMedicationWorkspace:
    """Make a lexical LocalMed medications workspace from one local Allmed snapshot."""
    if not input_path.is_file():
        raise ValueError(f"Allmed input is not a file: {input_path}")
    try:
        connection = sqlite3.connect(f"file:{input_path.resolve()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        drug_columns = _validate_schema(connection, input_path)
    except sqlite3.DatabaseError as error:
        raise ValueError(f"Allmed input is not a valid SQLite database: {input_path}") from error

    if "name_ru" not in drug_columns:
        connection.close()
        raise ValueError("Allmed input lacks drugs.name_ru.")

    input_sha256 = sha256_file(input_path)
    version_label = f"allmed-{input_sha256.removeprefix('sha256:')[:12]}"
    normalized_identities = (
        _validate_esklp_identities(
            _coerce_esklp_identity(identity) for identity in esklp_identities
        )
        if esklp_identities is not None
        else None
    )
    crosswalk = (
        build_esklp_mnn_crosswalk(normalized_identities)
        if normalized_identities is not None
        else {}
    )
    temporary = output.with_name(f".{output.name}.stage-{uuid4().hex}")
    backup = output.with_name(f".{output.name}.backup-{uuid4().hex}")
    try:
        temporary.mkdir(parents=True, exist_ok=False)
        manifest = {
            "id": "minimed.medications.ru",
            "version": version_label,
            "schemaVersion": 2,
            "title": "Лекарственные препараты (Allmed snapshot)",
            "builtAt": "2026-07-30T00:00:00Z",
        }
        (temporary / "manifest.yaml").write_text(
            yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (temporary / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
        ingredient_relations_by_drug = _load_ingredient_relations(connection)
        count = 0
        mapping_counts = {status: 0 for status in ("linked", "ambiguous", "unmatched")}
        safe_image_references = 0
        invalid_image_references = 0
        for drug in connection.execute("SELECT * FROM drugs ORDER BY id"):
            drug_id = int(drug["id"])
            title = _field_text(drug, "name_ru").strip() or f"Allmed #{drug_id}"
            name_lat = _field_text(drug, "name_lat").strip()
            ingredient_relations = ingredient_relations_by_drug.get(drug_id, [])
            ingredient_names = _ingredient_names(ingredient_relations)
            image_reference = _relative_image_reference(_field_text(drug, "img"))
            metadata = {
                "contentMode": "allmed-snapshot",
                "allmedId": drug_id,
                "snapshotSha256": input_sha256,
                "sourceLabel": "Allmed snapshot",
                "sourceNotice": (
                    "Локальный справочный снимок; не официальная инструкция ГРЛС. "
                    "Примеры рецептов не являются назначением и не подтверждают рецептурный статус."
                ),
                "nameLat": name_lat or None,
                "productionForm": _clean_allmed_text(_field_text(drug, "production_form")) or None,
                "shortDescription": _clean_allmed_text(_field_text(drug, "pharma_effect")) or None,
                "ingredientIds": _ingredient_ids(ingredient_relations),
                "ingredientRelations": ingredient_relations,
                "ingredientNames": ingredient_names,
                "img": image_reference,
            }
            if ingredient_names:
                metadata["normalizedIngredientComposition"] = sorted(
                    {
                        key
                        for name in ingredient_names
                        for key in _ingredient_identity_keys(name)
                        if key
                    }
                )
            raw_image_reference = _field_text(drug, "img")
            if raw_image_reference:
                if image_reference:
                    safe_image_references += 1
                else:
                    invalid_image_references += 1
            if normalized_identities is not None:
                mapping_status, mapping_candidates = _resolve_allmed_mapping(
                    ingredient_names,
                    crosswalk,
                )
                mapping_counts[mapping_status] += 1
                metadata["mappingStatus"] = mapping_status
                if mapping_status == "ambiguous":
                    metadata["mappingCandidates"] = list(mapping_candidates)
                elif mapping_status == "linked":
                    metadata["linkedMnnDocumentId"] = mapping_candidates[0]
                    metadata["mappingMethod"] = _ALLMED_ESKLP_MAPPING_METHOD
            front_matter = {
                "id": f"drug.allmed.{drug_id}",
                "title": title,
                "short_title": name_lat or None,
                "version_label": version_label,
                "source_type": "allmed_reference",
                "status": _field_text(drug, "status").strip() or "reference",
                "source_file": input_path.name,
                "source_checksum": input_sha256,
                "metadata": {key: value for key, value in metadata.items() if value is not None},
            }
            lines = [
                "---",
                yaml.safe_dump(front_matter, allow_unicode=True, sort_keys=False).rstrip(),
                "---",
                "",
            ]
            lines.extend(
                ["# Карточка препарата", "", _source_marker("drugs", drug_id, "name_ru"), title, ""]
            )
            if name_lat:
                lines.extend([_source_marker("drugs", drug_id, "name_lat"), name_lat, ""])
            if ingredient_names:
                lines.extend(
                    [
                        "# Состав",
                        "",
                        _source_marker("ingredients_relation", drug_id, "ingredient_id"),
                        ", ".join(ingredient_names),
                        "",
                    ]
                )
            for column, section_title in _RUNTIME_SECTIONS:
                value = _clean_allmed_text(_field_text(drug, column))
                if value.strip():
                    lines.extend(
                        [
                            f"# {section_title}",
                            "",
                            _source_marker("drugs", drug_id, column),
                            value,
                            "",
                        ]
                    )
            (temporary / f"drug.allmed.{drug_id}.md").write_text(
                "\n".join(lines).rstrip() + "\n", encoding="utf-8"
            )
            count += 1
        if output.exists():
            output.replace(backup)
        temporary.replace(output)
        shutil.rmtree(backup, ignore_errors=True)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        if backup.exists() and not output.exists():
            backup.replace(output)
        raise
    finally:
        connection.close()
    return AllmedMedicationWorkspace(
        input=str(input_path),
        output=str(output),
        input_sha256=input_sha256,
        documents=count,
        version_label=version_label,
        mapping_counts=mapping_counts,
        safe_image_references=safe_image_references,
        invalid_image_references=invalid_image_references,
    )
