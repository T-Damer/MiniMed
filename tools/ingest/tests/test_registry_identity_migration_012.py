from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.builder import build_content_pack
from localmed_ingest.edition_manifest import sha256_file
from localmed_ingest.registry_copy_migration_007 import NEW_LABEL, OLD_LABEL, migrate_registry_copy
from localmed_ingest.registry_identity_migration_012 import (
    ISSUED_IDENTITIES,
    migrate_registry_identities,
)
from localmed_ingest.sqlite_composer import compose_sqlite_packs

ROOT = Path(__file__).resolve().parents[3]
PREPARED = ROOT / "content" / "pilot-rf"


def build_candidate(tmp_path: Path) -> Path:
    candidate = tmp_path / "pilot.db"
    build_content_pack(PREPARED, candidate, include_embeddings=False)
    return candidate


def test_source_build_migration_compose_preserve_the_eight_issued_identities(
    tmp_path: Path,
) -> None:
    candidate = build_candidate(tmp_path)
    with sqlite3.connect(candidate) as connection:
        issued_map = {
            str(chunk_id): ISSUED_IDENTITIES[str(document_id)]
            for document_id, chunk_id in connection.execute(
                "SELECT v.document_id,c.id FROM chunks c JOIN document_versions v "
                "ON v.id=c.document_version_id WHERE instr(c.original_text,?)>0",
                (NEW_LABEL,),
            )
        }
    original = tmp_path / "original"
    shutil.copytree(PREPARED, original)
    for path in original.iterdir():
        if path.suffix in {".md", ".json"}:
            text = path.read_text(encoding="utf-8").replace(NEW_LABEL, OLD_LABEL)
            if path.suffix == ".json":
                for current_id, issued_id in issued_map.items():
                    text = text.replace(current_id, issued_id)
            path.write_text(text, encoding="utf-8")
    historical = tmp_path / "historical.db"
    build_content_pack(original, historical, include_embeddings=False)
    clarified = tmp_path / "clarified.db"
    migrate_registry_copy(historical, clarified, PREPARED, built_at="2026-09-06T00:00:00Z")
    with sqlite3.connect(candidate) as connection:
        before_text = connection.execute(
            "SELECT document_version_id,section_id,order_index,original_text FROM chunks "
            "ORDER BY document_version_id,section_id,order_index"
        ).fetchall()
        before_checksums = connection.execute(
            "SELECT id,source_checksum FROM document_versions ORDER BY id"
        ).fetchall()
        # Real FK and a nested locator reference must follow the issued identity.
        current = connection.execute(
            "SELECT c.id,c.anchor,v.document_id FROM chunks c "
            "JOIN document_versions v ON v.id=c.document_version_id "
            "JOIN knowledge_evidence e ON e.chunk_id=c.id "
            "WHERE instr(c.original_text,?)>0 LIMIT 1",
            (NEW_LABEL,),
        ).fetchone()
        evidence = connection.execute(
            "SELECT id FROM knowledge_evidence WHERE chunk_id=? LIMIT 1", (current[0],)
        ).fetchone()
        assert evidence
        connection.execute(
            "UPDATE knowledge_evidence SET source_locator_json=? WHERE id=?",
            (
                json.dumps({"chunkId": current[0], "nested": {"sourceAnchor": current[1]}}),
                evidence[0],
            ),
        )
    report = migrate_registry_identities(candidate, PREPARED)
    assert report["identitiesRestored"] == 8
    assert report["identitiesAlreadyRestored"] == 0
    first_checksum = sha256_file(candidate)
    repeated = migrate_registry_identities(candidate, PREPARED)
    assert repeated["identitiesRestored"] == 0
    assert repeated["identitiesAlreadyRestored"] == 8
    assert sha256_file(candidate) == first_checksum
    output = tmp_path / "composed.db"
    compose_sqlite_packs(
        [candidate],
        output,
        tmp_path / "composed.manifest.json",
        edition_id="test.registry-identities",
        edition_version="1",
        title="Registry identities",
        built_at="2026-09-30T00:00:00Z",
        compact=True,
    )
    with sqlite3.connect(clarified) as historical_connection, sqlite3.connect(output) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert (
            connection.execute("SELECT id,anchor FROM chunks ORDER BY id").fetchall()
            == historical_connection.execute("SELECT id,anchor FROM chunks ORDER BY id").fetchall()
        )
        assert (
            before_text
            == connection.execute(
                "SELECT document_version_id,section_id,order_index,original_text FROM chunks "
                "ORDER BY document_version_id,section_id,order_index"
            ).fetchall()
        )
        assert (
            before_checksums
            == connection.execute(
                "SELECT id,source_checksum FROM document_versions ORDER BY id"
            ).fetchall()
        )
        locator = json.loads(
            connection.execute(
                "SELECT source_locator_json FROM knowledge_evidence WHERE id=?", (evidence[0],)
            ).fetchone()[0]
        )
        assert locator["chunkId"] == ISSUED_IDENTITIES[current[2]]
        assert locator["nested"]["sourceAnchor"].endswith(
            "#chunk-" + ISSUED_IDENTITIES[current[2]][6:14]
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH 'грлс'"
            ).fetchone()[0]
            >= 8
        )
        assert (
            connection.execute(
                "SELECT count(*) FROM chunks_fts f LEFT JOIN chunks c ON c.id=f.chunk_id "
                "WHERE c.id IS NULL"
            ).fetchone()[0]
            == 0
        )


@pytest.mark.parametrize(
    "field", ["checksum", "version", "original_text", "spans", "local_order", "count", "collision"]
)
def test_rejects_mismatches_atomically(tmp_path: Path, field: str) -> None:
    candidate = build_candidate(tmp_path)
    with sqlite3.connect(candidate) as connection:
        chunk_id, metadata_json, version_id = connection.execute(
            "SELECT id,metadata_json,document_version_id FROM chunks "
            "WHERE instr(original_text,?)>0 LIMIT 1",
            (NEW_LABEL,),
        ).fetchone()
        if field == "checksum":
            connection.execute(
                "UPDATE document_versions SET source_checksum=? WHERE id=?",
                ("sha256:" + "0" * 64, version_id),
            )
        elif field == "version":
            connection.execute(
                "UPDATE document_versions SET version_label='wrong' WHERE id=?", (version_id,)
            )
        elif field == "original_text":
            connection.execute(
                "UPDATE chunks SET original_text=original_text || ' changed' WHERE id=?",
                (chunk_id,),
            )
        elif field in {"spans", "local_order"}:
            metadata = json.loads(metadata_json)
            metadata["sourceSpans" if field == "spans" else "localOrder"] = (
                [] if field == "spans" else 99
            )
            connection.execute(
                "UPDATE chunks SET metadata_json=? WHERE id=?", (json.dumps(metadata), chunk_id)
            )
        elif field == "count":
            connection.execute("DELETE FROM chunks WHERE id=?", (chunk_id,))
        else:
            other = connection.execute(
                "SELECT id FROM chunks WHERE instr(original_text,?)=0 LIMIT 1", (NEW_LABEL,)
            ).fetchone()[0]
            connection.execute(
                "UPDATE chunks SET id=? WHERE id=?", (next(iter(ISSUED_IDENTITIES.values())), other)
            )
    before = sha256_file(candidate)
    with pytest.raises(ValueError):
        migrate_registry_identities(candidate, PREPARED)
    assert sha256_file(candidate) == before
    assert not candidate.with_suffix(".db.migration012.partial").exists()
