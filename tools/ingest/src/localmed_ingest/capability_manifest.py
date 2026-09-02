"""Build a read-only capability manifest from current SQLite content packs."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import quote

REPORT_SCHEMA_VERSION = 1
SEARCHABLE = "searchable"
METADATA_ONLY = "metadata-only"
CLINICALLY_SUPPORTED = "clinically-supported"
NOT_SUPPORTED = "not-supported"
WORKFLOWS = ("terminology", "diagnosis", "treatment", "investigation", "dose")

# These are the vocabulary values already present in the repository's authoring prompt,
# source importers, or pilot knowledge JSON.  The empty sets are deliberate: the current
# SQLite corpus has no stable reviewed diagnosis/investigation assertion vocabulary to enable.
FACT_TYPE_ALLOWLIST: dict[str, frozenset[str]] = {
    "terminology": frozenset({"registration-identity", "registration-status"}),
    "diagnosis": frozenset(),
    "treatment": frozenset({"indication", "non-drug-care"}),
    "investigation": frozenset(),
    "dose": frozenset({"dosage", "pediatric-use", "administration"}),
}
PREDICATE_ALLOWLIST: dict[str, frozenset[str]] = {
    "terminology": frozenset(
        {
            "active-ingredient-of",
            "classified-as",
            "registered-as",
            "subclass-of",
            "has-presentation",
            "covers-presentation",
        }
    ),
    "diagnosis": frozenset(),
    "treatment": frozenset(
        {
            "recommended-for",
            "recommended-treatment-for",
            "has-recommended-treatment",
            "off-label-for",
            "alternative-for",
        }
    ),
    "investigation": frozenset(),
    "dose": frozenset(),
}
REFERENCE_FACT_TYPES = frozenset({"treatment-mention"})
REFERENCE_PREDICATES = frozenset({"mentioned-for", "listed-on-rls-mkb-page"})
_ALL_FACT_TYPES = frozenset().union(*FACT_TYPE_ALLOWLIST.values())
_ALL_PREDICATES = frozenset().union(*PREDICATE_ALLOWLIST.values())
_REQUIRED_CORE_TABLES = frozenset(
    {"content_packs", "documents", "document_versions", "sections", "chunks", "chunks_fts"}
)
_KNOWLEDGE_TABLES = frozenset(
    {
        "knowledge_entities",
        "knowledge_names",
        "medication_profiles",
        "knowledge_facts",
        "knowledge_relations",
        "knowledge_evidence",
        "knowledge_document_links",
        "knowledge_fts",
    }
)


@dataclass
class _DiagnosticState:
    items: list[dict[str, object]] = field(default_factory=list)
    unsupported_fact_types: Counter[str] = field(default_factory=Counter)
    unsupported_predicates: Counter[str] = field(default_factory=Counter)
    status_counts: Counter[str] = field(default_factory=Counter)
    reference_fact_types: Counter[str] = field(default_factory=Counter)
    reference_predicates: Counter[str] = field(default_factory=Counter)
    reference_document_links: int = 0

    def add(self, database: str, code: str, **values: object) -> dict[str, object]:
        item: dict[str, object] = {"code": code, "database": database, **values}
        self.items.append(item)
        return item


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _json_safe(value: object) -> object:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, bytes):
        return {"type": "blob", "sizeBytes": len(value)}
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return str(value)


def _parse_json(
    raw: object,
    *,
    database: str,
    state: _DiagnosticState,
    context: str,
) -> object:
    if not isinstance(raw, str):
        return _json_safe(raw)
    try:
        return _json_safe(json.loads(raw))
    except json.JSONDecodeError:
        state.add(database, "invalid-json", context=context)
        return raw


def _mapping(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    return {str(key): item for key, item in value.items()}


def _text(value: object) -> str:
    return "" if value is None else str(value)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            digest.update(block)
    return f"sha256:{digest.hexdigest()}"


def _readonly_connection(path: Path) -> sqlite3.Connection:
    uri = f"file:{quote(str(path), safe='/:')}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.execute("PRAGMA query_only = ON")
    return connection


def _table_names(connection: sqlite3.Connection) -> set[str]:
    return {
        _text(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name"
        )
    }


def _int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if not isinstance(value, str):
        return 0
    try:
        return int(value)
    except ValueError:
        return 0


def _pack_rows(
    connection: sqlite3.Connection,
    *,
    database: str,
    state: _DiagnosticState,
) -> tuple[list[dict[str, object]], dict[str, dict[str, object]]]:
    packs: list[dict[str, object]] = []
    by_id: dict[str, dict[str, object]] = {}
    rows = connection.execute(
        """SELECT id, version, schema_version, title, checksum, installed_at, enabled
        FROM content_packs ORDER BY id, version"""
    )
    for row in rows:
        pack_id = _text(row[0])
        pack: dict[str, object] = {
            "id": pack_id,
            "version": _text(row[1]),
            "schemaVersion": _int(row[2]),
            "title": _text(row[3]),
            "checksum": _text(row[4]),
            "installedAt": _text(row[5]),
            "enabled": bool(_int(row[6])),
        }
        packs.append(pack)
        if pack_id in by_id:
            state.add(database, "duplicate-content-pack-id", packId=pack_id)
        by_id[pack_id] = pack
    return packs, by_id


def _current_documents(
    connection: sqlite3.Connection,
    *,
    database: str,
    database_digest: str,
    state: _DiagnosticState,
) -> tuple[list[dict[str, object]], dict[str, str], dict[str, tuple[str, str, str, str]]]:
    documents: list[dict[str, object]] = []
    current_versions: dict[str, str] = {}
    chunks: dict[str, tuple[str, str, str, str]] = {}
    rows = connection.execute(
        """SELECT
          d.id, d.content_pack_id, d.title, d.short_title, d.source_type, d.status,
          d.specialty_json, d.metadata_json, d.current_version_id,
          cp.id, cp.version, cp.schema_version, cp.title, cp.checksum,
          cp.installed_at, cp.enabled,
          dv.id, dv.version_label, dv.effective_from, dv.effective_to,
          dv.source_checksum, dv.extracted_at,
          COALESCE(chunk_counts.count, 0), COALESCE(fts_counts.count, 0)
        FROM documents d
        LEFT JOIN content_packs cp ON cp.id = d.content_pack_id
        LEFT JOIN document_versions dv
          ON dv.id = d.current_version_id AND dv.document_id = d.id
        LEFT JOIN (
          SELECT document_version_id, count(*) AS count
          FROM chunks GROUP BY document_version_id
        ) chunk_counts ON chunk_counts.document_version_id = dv.id
        LEFT JOIN (
          SELECT document_version_id, count(*) AS count
          FROM chunks_fts GROUP BY document_version_id
        ) fts_counts ON fts_counts.document_version_id = dv.id
        ORDER BY d.id"""
    )
    for row in rows:
        document_id = _text(row[0])
        pack_id = _text(row[1])
        version_id = _text(row[16])
        if not pack_id or row[9] is None or not version_id or row[16] is None:
            state.add(
                database,
                "current-document-missing-pack-or-version",
                documentId=document_id,
            )
            continue
        specialty = _parse_json(
            row[6], database=database, state=state, context=f"documents[{document_id}].specialty"
        )
        metadata = _parse_json(
            row[7], database=database, state=state, context=f"documents[{document_id}].metadata"
        )
        provenance = None
        metadata_object = _mapping(metadata)
        if metadata_object is not None:
            provenance = metadata_object.get("provenance")
        pack_enabled = bool(_int(row[15]))
        chunk_count = _int(row[22])
        fts_count = _int(row[23])
        document: dict[str, object] = {
            "database": database,
            "databaseDigest": database_digest,
            "id": document_id,
            "title": _text(row[2]),
            "shortTitle": row[3],
            "sourceType": _text(row[4]),
            "status": _text(row[5]),
            "specialties": specialty,
            "sourceMetadata": metadata,
            "provenance": _json_safe(provenance),
            "contentPack": {
                "id": pack_id,
                "version": _text(row[10]),
                "schemaVersion": _int(row[11]),
                "title": _text(row[12]),
                "checksum": _text(row[13]),
                "installedAt": _text(row[14]),
                "enabled": pack_enabled,
            },
            "documentVersion": {
                "id": version_id,
                "versionLabel": _text(row[17]),
                "effectiveFrom": row[18],
                "effectiveTo": row[19],
                "sourceChecksum": _text(row[20]),
                "extractedAt": _text(row[21]),
            },
            "capabilityLevel": (
                SEARCHABLE if pack_enabled and chunk_count > 0 and fts_count > 0 else METADATA_ONLY
            ),
        }
        documents.append(document)
        current_versions[document_id] = version_id

    chunk_rows = connection.execute(
        """SELECT c.id, c.document_version_id, c.section_id, c.original_text, d.id
        FROM chunks c
        JOIN document_versions dv ON dv.id = c.document_version_id
        JOIN documents d ON d.id = dv.document_id
        ORDER BY c.id"""
    )
    for row in chunk_rows:
        chunks[_text(row[0])] = (_text(row[1]), _text(row[2]), _text(row[4]), _text(row[3]))
    return documents, current_versions, chunks


def _valid_evidence_ids(
    connection: sqlite3.Connection,
    *,
    database: str,
    state: _DiagnosticState,
    current_versions: Mapping[str, str],
    chunks: Mapping[str, tuple[str, str, str, str]],
) -> set[str]:
    valid: set[str] = set()
    rows = connection.execute(
        """SELECT id, fact_id, relation_id, document_id, document_version_id,
          section_id, chunk_id, evidence_quote, source_locator_json
        FROM knowledge_evidence ORDER BY id"""
    )
    for row in rows:
        owner_id = _text(row[1]) or _text(row[2])
        quote_text = _text(row[7]).strip()
        locator = _parse_json(
            row[8], database=database, state=state, context=f"knowledge_evidence[{_text(row[0])}]"
        )
        locator_object = _mapping(locator)
        document_id = _text(row[3])
        version_id = _text(row[4])
        chunk = chunks.get(_text(row[6]))
        is_current = current_versions.get(document_id) == version_id
        is_exact = (
            chunk is not None
            and chunk[0] == version_id
            and chunk[1] == _text(row[5])
            and quote_text in chunk[3]
        )
        if owner_id and quote_text and locator_object and is_current and is_exact:
            valid.add(owner_id)
            continue
        state.add(
            database,
            "invalid-knowledge-evidence",
            evidenceId=_text(row[0]),
            ownerId=owner_id,
        )
    return valid


def _has_population_applicability(value: object) -> bool:
    population = _mapping(value)
    if not population:
        return False
    applicable_keys = {
        "age",
        "ageGroup",
        "ageRange",
        "doseForm",
        "gestationalAge",
        "indication",
        "organFunction",
        "route",
        "sex",
        "weight",
        "weightRange",
        "applicability",
    }
    return any(
        key in applicable_keys and item not in (None, "", [], {})
        for key, item in population.items()
    )


def _promote(
    workflow: str,
    *,
    assertion_id: str,
    review_status: str,
    state: _DiagnosticState,
    valid_evidence: set[str],
    entity_ids: Iterable[str],
    dose_ready: bool = True,
    supported: dict[str, set[str]],
) -> None:
    if review_status != "reviewed" or assertion_id not in valid_evidence:
        return
    if workflow == "dose" and not dose_ready:
        state.status_counts["doseWithoutApplicability"] += 1
        return
    for entity_id in entity_ids:
        supported.setdefault(entity_id, set()).add(workflow)


def _record_assertion_status(
    *,
    assertion_id: str,
    review_status: str,
    state: _DiagnosticState,
    valid_evidence: set[str],
) -> None:
    state.status_counts[review_status] += 1
    if review_status == "reviewed" and assertion_id not in valid_evidence:
        state.status_counts["reviewedWithoutEvidence"] += 1


def _record_fact_or_relation_diagnostics(
    *,
    state: _DiagnosticState,
    fact_type: str | None = None,
    predicate: str | None = None,
) -> None:
    if fact_type is not None:
        if fact_type not in _ALL_FACT_TYPES:
            state.unsupported_fact_types[fact_type] += 1
        if fact_type in REFERENCE_FACT_TYPES:
            state.reference_fact_types[fact_type] += 1
    if predicate is not None:
        if predicate not in _ALL_PREDICATES:
            state.unsupported_predicates[predicate] += 1
        if predicate in REFERENCE_PREDICATES:
            state.reference_predicates[predicate] += 1


def _clinical_capabilities(
    connection: sqlite3.Connection,
    *,
    database: str,
    state: _DiagnosticState,
    current_versions: Mapping[str, str],
    chunks: Mapping[str, tuple[str, str, str, str]],
    entity_ids: set[str],
) -> dict[str, set[str]]:
    valid_evidence = _valid_evidence_ids(
        connection,
        database=database,
        state=state,
        current_versions=current_versions,
        chunks=chunks,
    )
    supported: dict[str, set[str]] = {entity_id: set() for entity_id in entity_ids}
    fact_rows = connection.execute(
        """SELECT id, entity_id, fact_type, structured_json, population_json, review_status
        FROM knowledge_facts ORDER BY id"""
    )
    for row in fact_rows:
        assertion_id = _text(row[0])
        entity_id = _text(row[1])
        fact_type = _text(row[2])
        structured = _parse_json(
            row[3],
            database=database,
            state=state,
            context=f"knowledge_facts[{assertion_id}].structured",
        )
        population = _parse_json(
            row[4],
            database=database,
            state=state,
            context=f"knowledge_facts[{assertion_id}].population",
        )
        review_status = _text(row[5])
        _record_fact_or_relation_diagnostics(state=state, fact_type=fact_type)
        _record_assertion_status(
            assertion_id=assertion_id,
            review_status=review_status,
            state=state,
            valid_evidence=valid_evidence,
        )
        if fact_type in REFERENCE_FACT_TYPES:
            state.status_counts["referenceMentions"] += 1
        for workflow in WORKFLOWS:
            if fact_type not in FACT_TYPE_ALLOWLIST[workflow]:
                continue
            dose_ready = bool(_mapping(structured)) and _has_population_applicability(population)
            _promote(
                workflow,
                assertion_id=assertion_id,
                review_status=review_status,
                state=state,
                valid_evidence=valid_evidence,
                entity_ids=(entity_id,),
                dose_ready=dose_ready,
                supported=supported,
            )

    relation_rows = connection.execute(
        """SELECT id, subject_entity_id, predicate, object_entity_id, review_status
        FROM knowledge_relations ORDER BY id"""
    )
    for row in relation_rows:
        assertion_id = _text(row[0])
        subject_id = _text(row[1])
        predicate = _text(row[2])
        object_id = _text(row[3])
        review_status = _text(row[4])
        _record_fact_or_relation_diagnostics(state=state, predicate=predicate)
        _record_assertion_status(
            assertion_id=assertion_id,
            review_status=review_status,
            state=state,
            valid_evidence=valid_evidence,
        )
        if predicate in REFERENCE_PREDICATES:
            state.status_counts["referenceMentions"] += 1
        for workflow in WORKFLOWS:
            if predicate not in PREDICATE_ALLOWLIST[workflow]:
                continue
            _promote(
                workflow,
                assertion_id=assertion_id,
                review_status=review_status,
                state=state,
                valid_evidence=valid_evidence,
                entity_ids=(subject_id, object_id),
                supported=supported,
            )

    link_count = _int(
        connection.execute("SELECT count(*) FROM knowledge_document_links").fetchone()[0]
    )
    state.reference_document_links += link_count
    state.status_counts["referenceDocumentLinks"] += link_count
    return supported


def _entities(
    connection: sqlite3.Connection,
    *,
    database: str,
    database_digest: str,
    state: _DiagnosticState,
    current_versions: Mapping[str, str],
    chunks: Mapping[str, tuple[str, str, str, str]],
) -> list[dict[str, object]]:
    entity_rows = connection.execute(
        """SELECT id, entity_type, canonical_name, external_ids_json, metadata_json
        FROM knowledge_entities ORDER BY id"""
    ).fetchall()
    entity_ids = {_text(row[0]) for row in entity_rows}
    supported = _clinical_capabilities(
        connection,
        database=database,
        state=state,
        current_versions=current_versions,
        chunks=chunks,
        entity_ids=entity_ids,
    )
    name_counts = {
        _text(row[0]): _int(row[1])
        for row in connection.execute(
            "SELECT entity_id, count(*) FROM knowledge_names GROUP BY entity_id ORDER BY entity_id"
        )
    }
    searchable_ids = {
        _text(row[0])
        for row in connection.execute(
            "SELECT DISTINCT entity_id FROM knowledge_fts ORDER BY entity_id"
        )
    }
    result: list[dict[str, object]] = []
    for row in entity_rows:
        entity_id = _text(row[0])
        external_ids = _parse_json(
            row[3],
            database=database,
            state=state,
            context=f"knowledge_entities[{entity_id}].externalIds",
        )
        metadata = _parse_json(
            row[4],
            database=database,
            state=state,
            context=f"knowledge_entities[{entity_id}].metadata",
        )
        names_count = name_counts.get(entity_id, 0)
        searchable = entity_id in searchable_ids
        result.append(
            {
                "database": database,
                "databaseDigest": database_digest,
                "id": entity_id,
                "entityType": _text(row[1]),
                "canonicalName": _text(row[2]),
                "externalIds": external_ids,
                "metadata": metadata,
                "namesCount": names_count,
                "searchable": searchable,
                "clinicalCapabilities": {
                    workflow: (
                        CLINICALLY_SUPPORTED
                        if workflow in supported.get(entity_id, set())
                        else NOT_SUPPORTED
                    )
                    for workflow in WORKFLOWS
                },
            }
        )
    return result


def _database_manifest(
    path: Path,
    *,
    state: _DiagnosticState,
) -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]]]:
    database = str(path)
    db_diagnostics: list[dict[str, object]] = []
    artifact: dict[str, object] = {
        "path": database,
        "sha256": None,
        "status": "error",
        "contentPacks": [],
        "diagnostics": db_diagnostics,
    }
    documents: list[dict[str, object]] = []
    entities: list[dict[str, object]] = []

    def fail(code: str, **values: object) -> None:
        item = state.add(database, code, **values)
        db_diagnostics.append(item)

    if not path.is_file():
        fail("database-not-file")
        return artifact, documents, entities
    try:
        digest = _sha256_file(path)
        artifact["sha256"] = digest
        with path.open("rb") as source:
            if source.read(16) != b"SQLite format 3\x00":
                artifact["status"] = "unsupported"
                fail("not-sqlite-header")
                return artifact, documents, entities
    except OSError as error:
        fail("database-read-failed", errorType=type(error).__name__)
        return artifact, documents, entities

    connection: sqlite3.Connection | None = None
    try:
        connection = _readonly_connection(path)
        quick_row = connection.execute("PRAGMA quick_check").fetchone()
        quick_check = _text(quick_row[0]) if quick_row is not None else "no-result"
        artifact["quickCheck"] = quick_check
        if quick_check != "ok":
            artifact["status"] = "invalid"
            fail("quick-check-failed", result=quick_check)
            return artifact, documents, entities
        tables = _table_names(connection)
        missing = sorted(_REQUIRED_CORE_TABLES - tables)
        if missing:
            artifact["status"] = "unsupported"
            fail("unsupported-schema", missingTables=missing)
            return artifact, documents, entities
        packs, _ = _pack_rows(connection, database=database, state=state)
        artifact["contentPacks"] = packs
        documents, current_versions, chunks = _current_documents(
            connection,
            database=database,
            database_digest=digest,
            state=state,
        )
        if _KNOWLEDGE_TABLES.issubset(tables):
            entities = _entities(
                connection,
                database=database,
                database_digest=digest,
                state=state,
                current_versions=current_versions,
                chunks=chunks,
            )
        else:
            missing_knowledge = sorted(_KNOWLEDGE_TABLES - tables)
            fail("knowledge-schema-unavailable", missingTables=missing_knowledge)
        artifact["status"] = "ok"
    except (OSError, sqlite3.DatabaseError) as error:
        artifact["status"] = "invalid"
        fail("sqlite-open-or-query-failed", errorType=type(error).__name__)
    finally:
        if connection is not None:
            connection.close()
    return artifact, documents, entities


def _sorted_counts(counter: Mapping[str, int]) -> dict[str, int]:
    return {key: int(counter[key]) for key in sorted(counter)}


def _supports_workflow(entity: Mapping[str, object], workflow: str) -> bool:
    capabilities = entity.get("clinicalCapabilities")
    return isinstance(capabilities, dict) and capabilities.get(workflow) == CLINICALLY_SUPPORTED


def _diagnostics_payload(
    state: _DiagnosticState,
    collisions: list[dict[str, object]],
) -> dict[str, object]:
    items = sorted(
        state.items,
        key=lambda item: (
            _text(item.get("database")),
            _text(item.get("code")),
            json.dumps(item, ensure_ascii=False, sort_keys=True),
        ),
    )
    return {
        "items": items,
        "unsupportedAssertionTypes": {
            "factTypes": _sorted_counts(state.unsupported_fact_types),
            "predicates": _sorted_counts(state.unsupported_predicates),
        },
        "statusCounts": _sorted_counts(state.status_counts),
        "referenceMentions": {
            "factTypes": _sorted_counts(state.reference_fact_types),
            "predicates": _sorted_counts(state.reference_predicates),
        },
        "referenceDocumentLinks": state.reference_document_links,
        "duplicateDisplayNameCollisions": collisions,
    }


def build_capability_manifest(
    databases: Sequence[Path],
    *,
    generated_at: str | None = None,
) -> dict[str, object]:
    """Inspect one or more explicit SQLite databases without modifying them."""
    if not databases:
        raise ValueError("At least one database is required.")
    paths = sorted({Path(database).expanduser().resolve(strict=False) for database in databases})
    state = _DiagnosticState()
    artifacts: list[dict[str, object]] = []
    documents: list[dict[str, object]] = []
    entities: list[dict[str, object]] = []
    for path in paths:
        artifact, database_documents, database_entities = _database_manifest(path, state=state)
        artifacts.append(artifact)
        documents.extend(database_documents)
        entities.extend(database_entities)

    documents.sort(key=lambda item: (_text(item.get("database")), _text(item.get("id"))))
    entities.sort(key=lambda item: (_text(item.get("database")), _text(item.get("id"))))
    names: defaultdict[str, list[str]] = defaultdict(list)
    for entity in entities:
        name = _text(entity.get("canonicalName"))
        names[name].append(_text(entity.get("database")) + "::" + _text(entity.get("id")))
    collisions = [
        {"name": name, "entityIds": sorted(ids), "count": len(ids)}
        for name, ids in sorted(names.items())
        if len(ids) > 1
    ]
    state.items.extend(
        {
            "code": "duplicate-display-name",
            "name": collision["name"],
            "entityIds": collision["entityIds"],
            "count": collision["count"],
        }
        for collision in collisions
    )

    capability_counts = {
        workflow: sum(_supports_workflow(entity, workflow) for entity in entities)
        for workflow in WORKFLOWS
    }
    diagnostics = _diagnostics_payload(state, collisions)
    diagnostic_items = diagnostics["items"]
    diagnostic_count = len(diagnostic_items) if isinstance(diagnostic_items, list) else 0
    summary: dict[str, object] = {
        "databaseCount": len(artifacts),
        "documentCount": len(documents),
        "searchableDocumentCount": sum(
            document.get("capabilityLevel") == SEARCHABLE for document in documents
        ),
        "entityCount": len(entities),
        "searchableEntityCount": sum(bool(entity.get("searchable")) for entity in entities),
        "clinicallySupportedEntityCountByWorkflow": capability_counts,
        "diagnosticCount": diagnostic_count,
        "duplicateDisplayNameCollisionCount": len(collisions),
    }
    return {
        "schemaVersion": REPORT_SCHEMA_VERSION,
        "generatedAt": generated_at or _utc_now(),
        "databases": artifacts,
        "documents": documents,
        "entities": entities,
        "summary": summary,
        "diagnostics": diagnostics,
    }


def write_capability_manifest(path: Path, manifest: Mapping[str, object]) -> None:
    """Atomically write a manifest, rejecting a database-looking destination."""
    output = Path(path)
    if output.suffix.lower() == ".db":
        raise ValueError("Capability manifest output must not use the .db extension.")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(manifest, temporary, ensure_ascii=False, indent=2, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, output)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


__all__ = [
    "CLINICALLY_SUPPORTED",
    "FACT_TYPE_ALLOWLIST",
    "METADATA_ONLY",
    "NOT_SUPPORTED",
    "PREDICATE_ALLOWLIST",
    "SEARCHABLE",
    "WORKFLOWS",
    "build_capability_manifest",
    "write_capability_manifest",
]
