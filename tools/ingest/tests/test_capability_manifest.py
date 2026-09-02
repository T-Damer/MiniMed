from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest

from localmed_ingest.capability_manifest import (
    CLINICALLY_SUPPORTED,
    NOT_SUPPORTED,
    build_capability_manifest,
    write_capability_manifest,
)

FIXED_TIME = "2026-08-31T00:00:00Z"
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_ROOT = REPOSITORY_ROOT / "schema" / "sql"
SCRIPT = REPOSITORY_ROOT / "tools" / "ingest" / "scripts" / "build_capability_manifest.py"


def _object(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast(dict[str, object], value)


def _list_of_objects(value: object) -> list[dict[str, object]]:
    assert isinstance(value, list)
    return [cast(dict[str, object], item) for item in value]


def _insert_entity(
    connection: sqlite3.Connection,
    entity_id: str,
    canonical_name: str,
    *,
    external_ids: dict[str, str] | None = None,
    metadata: dict[str, object] | None = None,
    searchable: bool = True,
    profile_strength: str | None = None,
) -> None:
    connection.execute(
        "INSERT INTO knowledge_entities VALUES (?, ?, ?, ?, ?, ?)",
        (
            entity_id,
            "medication" if entity_id.startswith("drug.") else "condition",
            canonical_name,
            canonical_name.casefold(),
            json.dumps(external_ids or {}, ensure_ascii=False),
            json.dumps(metadata or {}, ensure_ascii=False),
        ),
    )
    connection.execute(
        "INSERT INTO knowledge_names VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            f"name.{entity_id}",
            entity_id,
            canonical_name,
            canonical_name.casefold(),
            "ru",
            "canonical",
            1.0,
        ),
    )
    if profile_strength is not None:
        connection.execute(
            """INSERT INTO medication_profiles(
              entity_id, concept_level, inn, atc_code, dosage_form, route, strength,
              registration_number, registration_status, pediatric_status, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entity_id,
                "clinical-drug",
                canonical_name,
                None,
                "суспензия",
                "oral",
                profile_strength,
                "ЛП-TEST",
                "registered",
                "pediatric-form",
                "{}",
            ),
        )
    if searchable:
        connection.execute(
            "INSERT INTO knowledge_fts(entity_id, canonical_name, aliases, facts, relations) "
            "VALUES (?, ?, ?, ?, ?)",
            (entity_id, canonical_name, canonical_name, "", ""),
        )


def _insert_fact(
    connection: sqlite3.Connection,
    fact_id: str,
    entity_id: str,
    fact_type: str,
    review_status: str,
    *,
    structured: dict[str, object] | None = None,
    population: dict[str, object] | None = None,
    evidence: bool = True,
    quote: str,
) -> None:
    connection.execute(
        """INSERT INTO knowledge_facts(
          id, entity_id, fact_type, original_text, structured_json, population_json,
          approval_status, authority_tier, review_status, jurisdiction, confidence,
          valid_from, valid_to, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            fact_id,
            entity_id,
            fact_type,
            quote,
            json.dumps(structured or {}, ensure_ascii=False),
            json.dumps(population or {}, ensure_ascii=False),
            "approved",
            "synthetic-fixture",
            review_status,
            "RU",
            1.0,
            None,
            None,
            "{}",
        ),
    )
    if evidence:
        _insert_evidence(connection, fact_id=fact_id, quote=quote)


def _insert_evidence(
    connection: sqlite3.Connection,
    *,
    fact_id: str | None = None,
    relation_id: str | None = None,
    quote: str,
) -> None:
    owner = fact_id or relation_id
    assert owner is not None
    connection.execute(
        """INSERT INTO knowledge_evidence(
          id, fact_id, relation_id, document_id, document_version_id, section_id,
          chunk_id, evidence_quote, source_locator_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            f"evidence.{owner}",
            fact_id,
            relation_id,
            "doc.fixture",
            "doc.fixture@1",
            "section.fixture",
            "chunk.fixture",
            quote,
            json.dumps({"page": 1, "source": "fixture"}),
        ),
    )


def _create_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        for schema in sorted(SCHEMA_ROOT.glob("*.sql")):
            connection.executescript(schema.read_text(encoding="utf-8"))
        connection.execute(
            "INSERT INTO content_packs VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "pack.fixture",
                "2026.08",
                2,
                "Fixture pack",
                "sha256:pack-fixture",
                FIXED_TIME,
                1,
            ),
        )
        metadata = {
            "provenance": {
                "sourceId": "fixture-source",
                "publisher": "Fixture publisher",
                "officialLocator": "https://example.test/source",
            }
        }
        connection.execute(
            "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "doc.fixture",
                "pack.fixture",
                "Fixture source",
                None,
                "synthetic-fixture",
                "active",
                json.dumps(["pediatrics"], ensure_ascii=False),
                json.dumps(metadata, ensure_ascii=False),
                "doc.fixture@1",
            ),
        )
        connection.execute(
            "INSERT INTO document_versions VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "doc.fixture@1",
                "doc.fixture",
                "2026.08",
                None,
                None,
                "sha256:source-fixture",
                FIXED_TIME,
            ),
        )
        connection.execute(
            "INSERT INTO sections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "section.fixture",
                "doc.fixture@1",
                None,
                "Fixture evidence",
                "fixture evidence",
                "reference",
                1,
                0,
                None,
                None,
                "doc.fixture@1/fixture",
                '["Fixture evidence"]',
            ),
        )
        evidence_text = (
            "Reviewed indication quote. "
            "Reviewed relation quote. "
            "Dose without population quote. "
            "Dose with population quote. "
            "Proposed quote. "
            "No evidence quote. "
            "Unknown quote. "
            "Mention quote."
        )
        connection.execute(
            "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "chunk.fixture",
                "doc.fixture@1",
                "section.fixture",
                0,
                evidence_text,
                evidence_text.casefold(),
                None,
                None,
                None,
                None,
                None,
                None,
                "doc.fixture@1/fixture#chunk",
                "{}",
            ),
        )
        connection.execute(
            """INSERT INTO chunks_fts(
              chunk_id, document_id, document_version_id, section_id, anchor,
              title, section_path, normalized_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "chunk.fixture",
                "doc.fixture",
                "doc.fixture@1",
                "section.fixture",
                "doc.fixture@1/fixture#chunk",
                "Fixture evidence",
                "Fixture evidence",
                evidence_text.casefold(),
            ),
        )

        _insert_entity(
            connection,
            "esklp.identity",
            "Парацетамол 120 мг/5 мл",
            external_ids={"esklp": "SMNN-001", "ruRegistration": "ЛП-TEST"},
            metadata={"source": "ESKLP", "record": "identity-only"},
            profile_strength="120 мг/5 мл",
        )
        _insert_entity(
            connection,
            "drug.reviewed",
            "Препарат с показанием",
            external_ids={"internal": "reviewed"},
        )
        _insert_entity(connection, "drug.dose-bad", "Доза без популяции")
        _insert_entity(connection, "drug.dose-good", "Доза с популяцией")
        _insert_entity(connection, "drug.proposed", "Предложенный факт")
        _insert_entity(connection, "drug.no-evidence", "Факт без доказательства")
        _insert_entity(connection, "drug.unknown", "Неизвестный факт")
        _insert_entity(connection, "drug.mention", "Только упоминание")
        _insert_entity(connection, "drug.relation", "Препарат из связи")
        _insert_entity(connection, "condition.relation", "Состояние из связи")
        _insert_entity(connection, "condition.duplicate-a", "Одинаковое название")
        _insert_entity(connection, "condition.duplicate-b", "Одинаковое название")
        _insert_entity(
            connection,
            "condition.mkb",
            "Состояние MKB",
            external_ids={"mkb": "MKB-001", "icd10": "I10"},
            metadata={"source": "MKB"},
        )

        _insert_fact(
            connection,
            "fact.reviewed",
            "drug.reviewed",
            "indication",
            "reviewed",
            quote="Reviewed indication quote.",
        )
        _insert_fact(
            connection,
            "fact.dose-bad",
            "drug.dose-bad",
            "dosage",
            "reviewed",
            structured={"dose": "10 mg/kg"},
            quote="Dose without population quote.",
        )
        _insert_fact(
            connection,
            "fact.dose-good",
            "drug.dose-good",
            "dosage",
            "reviewed",
            structured={"dose": "10 mg/kg"},
            population={"ageGroup": "children", "weight": "required"},
            quote="Dose with population quote.",
        )
        _insert_fact(
            connection,
            "fact.proposed",
            "drug.proposed",
            "indication",
            "proposed",
            quote="Proposed quote.",
        )
        _insert_fact(
            connection,
            "fact.no-evidence",
            "drug.no-evidence",
            "indication",
            "reviewed",
            evidence=False,
            quote="No evidence quote.",
        )
        _insert_fact(
            connection,
            "fact.unknown",
            "drug.unknown",
            "unknown-fact-type",
            "reviewed",
            quote="Unknown quote.",
        )
        _insert_fact(
            connection,
            "fact.mention",
            "drug.mention",
            "treatment-mention",
            "reviewed",
            quote="Mention quote.",
        )
        connection.execute(
            """INSERT INTO knowledge_relations(
              id, subject_entity_id, predicate, object_entity_id, relation_status,
              authority_tier, review_status, jurisdiction, final_weight,
              weight_components_json, valid_from, valid_to, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "relation.reviewed-treatment",
                "drug.relation",
                "recommended-treatment-for",
                "condition.relation",
                "recommended",
                "synthetic-fixture",
                "reviewed",
                "RU",
                1.0,
                "{}",
                None,
                None,
                "{}",
            ),
        )
        _insert_evidence(
            connection,
            relation_id="relation.reviewed-treatment",
            quote="Reviewed relation quote.",
        )
        connection.execute(
            """INSERT INTO knowledge_document_links(
              id, entity_id, document_id, document_version_id, section_id, chunk_id,
              link_type, weight, review_status, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "link.identity",
                "esklp.identity",
                "doc.fixture",
                "doc.fixture@1",
                "section.fixture",
                "chunk.fixture",
                "registration-record",
                1.0,
                "reviewed",
                "{}",
            ),
        )
        connection.commit()
    finally:
        connection.close()


def test_manifest_preserves_identity_metadata_and_promotes_only_evidenced_workflows(
    tmp_path: Path,
) -> None:
    database = tmp_path / "fixture.db"
    _create_database(database)
    manifest = build_capability_manifest([database], generated_at=FIXED_TIME)
    entities = {str(entity["id"]): entity for entity in _list_of_objects(manifest["entities"])}

    esklp = entities["esklp.identity"]
    assert esklp["searchable"] is True
    assert esklp["externalIds"] == {"esklp": "SMNN-001", "ruRegistration": "ЛП-TEST"}
    assert esklp["metadata"] == {"source": "ESKLP", "record": "identity-only"}
    esklp_capabilities = _object(esklp["clinicalCapabilities"])
    assert all(value == NOT_SUPPORTED for value in esklp_capabilities.values())

    reviewed = _object(entities["drug.reviewed"]["clinicalCapabilities"])
    assert reviewed["treatment"] == CLINICALLY_SUPPORTED
    assert reviewed["dose"] == NOT_SUPPORTED
    assert reviewed["diagnosis"] == NOT_SUPPORTED
    assert reviewed["investigation"] == NOT_SUPPORTED
    assert reviewed["terminology"] == NOT_SUPPORTED

    relation = _object(entities["drug.relation"]["clinicalCapabilities"])
    relation_condition = _object(entities["condition.relation"]["clinicalCapabilities"])
    assert relation["treatment"] == CLINICALLY_SUPPORTED
    assert relation_condition["treatment"] == CLINICALLY_SUPPORTED
    assert all(
        relation[workflow] == NOT_SUPPORTED
        for workflow in ("terminology", "diagnosis", "investigation", "dose")
    )

    assert _object(entities["drug.dose-bad"]["clinicalCapabilities"])["dose"] == NOT_SUPPORTED
    assert (
        _object(entities["drug.dose-good"]["clinicalCapabilities"])["dose"] == CLINICALLY_SUPPORTED
    )
    assert _object(entities["drug.proposed"]["clinicalCapabilities"])["treatment"] == NOT_SUPPORTED
    assert (
        _object(entities["drug.no-evidence"]["clinicalCapabilities"])["treatment"] == NOT_SUPPORTED
    )
    assert _object(entities["drug.unknown"]["clinicalCapabilities"])["treatment"] == NOT_SUPPORTED
    assert _object(entities["drug.mention"]["clinicalCapabilities"])["treatment"] == NOT_SUPPORTED

    mkb = entities["condition.mkb"]
    assert mkb["externalIds"] == {"mkb": "MKB-001", "icd10": "I10"}
    collisions = _object(manifest["diagnostics"])["duplicateDisplayNameCollisions"]
    assert collisions == [
        {
            "name": "Одинаковое название",
            "entityIds": [
                f"{database.resolve()}::condition.duplicate-a",
                f"{database.resolve()}::condition.duplicate-b",
            ],
            "count": 2,
        }
    ]

    unsupported = _object(manifest["diagnostics"])["unsupportedAssertionTypes"]
    assert _object(unsupported)["factTypes"] == {
        "treatment-mention": 1,
        "unknown-fact-type": 1,
    }
    status_counts = _object(manifest["diagnostics"])["statusCounts"]
    assert _object(status_counts)["proposed"] == 1
    assert _object(status_counts)["reviewed"] == 7
    assert _object(status_counts)["reviewedWithoutEvidence"] == 1
    assert _object(status_counts)["doseWithoutApplicability"] == 1
    assert _object(manifest["diagnostics"])["referenceDocumentLinks"] == 1


def test_manifest_documents_are_current_source_records_and_database_is_unchanged(
    tmp_path: Path,
) -> None:
    database = tmp_path / "fixture.db"
    _create_database(database)
    before_bytes = database.read_bytes()
    before_mtime = database.stat().st_mtime_ns

    first = build_capability_manifest([database], generated_at=FIXED_TIME)
    second = build_capability_manifest([database], generated_at=FIXED_TIME)

    assert first == second
    assert database.read_bytes() == before_bytes
    assert database.stat().st_mtime_ns == before_mtime
    documents = _list_of_objects(first["documents"])
    assert len(documents) == 1
    document = documents[0]
    assert document["capabilityLevel"] == "searchable"
    assert document["sourceType"] == "synthetic-fixture"
    assert document["status"] == "active"
    assert document["sourceMetadata"] == {
        "provenance": {
            "sourceId": "fixture-source",
            "publisher": "Fixture publisher",
            "officialLocator": "https://example.test/source",
        }
    }
    assert _object(document["provenance"])["sourceId"] == "fixture-source"
    assert _object(document["contentPack"])["id"] == "pack.fixture"
    assert _object(document["contentPack"])["checksum"] == "sha256:pack-fixture"
    assert _object(document["documentVersion"])["id"] == "doc.fixture@1"
    assert _object(document["documentVersion"])["sourceChecksum"] == "sha256:source-fixture"


def test_corrupt_and_unsupported_databases_are_diagnostics_only(tmp_path: Path) -> None:
    valid = tmp_path / "valid.db"
    _create_database(valid)
    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"not a sqlite database")
    unsupported = tmp_path / "unsupported.db"
    connection = sqlite3.connect(unsupported)
    try:
        connection.execute("CREATE TABLE unrelated (id TEXT)")
        connection.commit()
    finally:
        connection.close()

    manifest = build_capability_manifest([corrupt, valid, unsupported], generated_at=FIXED_TIME)
    databases = {str(item["path"]): item for item in _list_of_objects(manifest["databases"])}
    assert databases[str(corrupt.resolve())]["status"] == "unsupported"
    assert databases[str(unsupported.resolve())]["status"] == "unsupported"
    assert any(item["id"] == "doc.fixture" for item in _list_of_objects(manifest["documents"]))
    items = _list_of_objects(_object(manifest["diagnostics"])["items"])
    codes = {str(item["code"]) for item in items}
    assert "not-sqlite-header" in codes
    assert "unsupported-schema" in codes


def test_output_is_atomic_and_db_extension_is_rejected(tmp_path: Path) -> None:
    database = tmp_path / "fixture.db"
    _create_database(database)
    output = tmp_path / "manifest.json"
    manifest = build_capability_manifest([database], generated_at=FIXED_TIME)
    write_capability_manifest(output, manifest)
    assert json.loads(output.read_text(encoding="utf-8")) == manifest
    with pytest.raises(ValueError, match=r"\.db extension"):
        write_capability_manifest(tmp_path / "manifest.db", manifest)


def test_cli_requires_explicit_database_and_output_and_writes_compact_summary(
    tmp_path: Path,
) -> None:
    database = tmp_path / "fixture.db"
    _create_database(database)
    output = tmp_path / "manifest.json"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--database",
            str(database),
            "--output",
            str(output),
            "--generated-at",
            FIXED_TIME,
        ],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    summary = _object(json.loads(result.stdout))["summary"]
    assert _object(summary)["databaseCount"] == 1
    assert json.loads(output.read_text(encoding="utf-8"))["generatedAt"] == FIXED_TIME

    rejected = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--database",
            str(database),
            "--output",
            str(tmp_path / "rejected.db"),
        ],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert rejected.returncode == 2
    assert not (tmp_path / "rejected.db").exists()

    missing_database = subprocess.run(
        [sys.executable, str(SCRIPT), "--output", str(tmp_path / "missing.json")],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert missing_database.returncode != 0


def test_manifest_does_not_change_database_mtime_when_called_repeatedly(tmp_path: Path) -> None:
    database = tmp_path / "fixture.db"
    _create_database(database)
    before = os.stat(database)
    build_capability_manifest([database], generated_at=FIXED_TIME)
    after = os.stat(database)
    assert after.st_mtime_ns == before.st_mtime_ns
    assert after.st_size == before.st_size
