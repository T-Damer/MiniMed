from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from localmed_ingest.core_identity_index import build_core_identity_index
from localmed_ingest.edition_manifest import sha256_file
from localmed_ingest.sqlite_builder import schema_sql


def test_exact_index_preserves_ambiguity_and_verified_targets_without_fts(tmp_path: Path) -> None:
    core, definitions, documents, catalog = (
        tmp_path / name for name in ("core.db", "definitions.db", "reference.db", "catalog.json")
    )
    with closing(sqlite3.connect(core)) as db:
        db.executescript(schema_sql())
        db.execute("INSERT INTO content_packs VALUES ('core','1',2,'Core','checksum','date',1)")
        db.commit()
    with closing(sqlite3.connect(definitions)) as db:
        db.executescript(schema_sql())
        db.execute(
            "INSERT INTO app_metadata VALUES ('definition_reference', ?)",
            (json.dumps({"editionId": "edition"}),),
        )
        for entity, title, coverage in (
            ("a", "Норадреналин", "definition"),
            ("b", "Натрий", "needs-definition"),
        ):
            metadata = {"definitionReference": 1, "editionId": "edition", "coverage": coverage}
            db.execute(
                "INSERT INTO knowledge_entities VALUES (?, 'abbreviation', ?, ?, '{}', ?)",
                (entity, title, title.lower(), json.dumps(metadata)),
            )
            db.execute(
                "INSERT INTO knowledge_names VALUES (?, ?, 'НА', 'на', 'ru', 'primary', 1)",
                (entity + ".name", entity),
            )
        db.commit()
    with closing(sqlite3.connect(documents)) as db:
        db.executescript("""
            CREATE TABLE documents(id,title,short_title,source_type,metadata_json,
                current_version_id);
            CREATE TABLE document_versions(id,document_id,source_checksum);
            CREATE TABLE chunks(document_version_id,original_text,anchor,order_index,id);
        """)
        for identity in ("good", "wrong-version", "wrong-checksum", "missing", "empty"):
            db.execute(
                "INSERT INTO documents VALUES (?, ?, '№7', 'regulatory', '{}', ?)",
                (identity, f"Документ {identity}", identity + "@1"),
            )
            db.execute(
                "INSERT INTO document_versions VALUES (?, ?, ?)",
                (identity + "@1", identity, "sha256:" + "a" * 64),
            )
            db.execute(
                "INSERT INTO chunks VALUES (?, ?, 'source-anchor', 0, ?)",
                (identity + "@1", "" if identity == "empty" else "Source text", identity),
            )
        db.commit()
    digest = "sha256:" + "b" * 64
    artifact = {
        "id": "index",
        "kind": "index",
        "required": True,
        "url": "https://example.test/index",
        "sha256": sha256_file(definitions),
        "compression": "none",
        "sourceSetDigest": digest,
    }
    modules: list[dict[str, object]] = [
        {
            "id": "definitions",
            "version": "1",
            "releaseState": "preview",
            "sourceSetDigest": digest,
            "artifacts": [artifact],
            "definitionReference": {"editionId": "edition", "entries": 2},
        },
        {
            "id": "reference",
            "version": "1",
            "releaseState": "published",
            "sourceSetDigest": digest,
            "artifacts": [{**artifact, "sha256": sha256_file(documents)}],
            "documentTable": {
                "indexArtifactId": "index",
                "rows": [
                    ["good", "@1", "a" * 64, "Good"],
                    ["wrong-version", "@2", "a" * 64, "Wrong version"],
                    ["wrong-checksum", "@1", "c" * 64, "Wrong checksum"],
                    ["empty", "@1", "a" * 64, "Empty"],
                ],
            },
        },
    ]
    catalog.write_text(json.dumps({"modules": modules}))
    report = build_core_identity_index(core, catalog, definitions, [documents])
    assert report["targets"] == 3 and report["skippedDocuments"] == 4
    with closing(sqlite3.connect(core)) as db:
        assert db.execute("SELECT count(*) FROM documents").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM chunks").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM chunks_fts").fetchone()[0] == 0
        assert db.execute(
            "SELECT target_id FROM core_identities WHERE normalized_name='на' ORDER BY target_id"
        ).fetchall() == [("a",), ("b",)]
        assert (
            db.execute("SELECT coverage FROM core_identity_targets WHERE target_id='b'").fetchone()[
                0
            ]
            == "needs-definition"
        )
        target = json.loads(
            db.execute(
                "SELECT target_json FROM core_identity_targets WHERE target_id='good'"
            ).fetchone()[0]
        )
        assert target["anchor"] == "source-anchor" and target["documentVersionId"] == "good@1"
        snapshot = db.execute("SELECT * FROM core_identity_targets ORDER BY target_id").fetchall()
    build_core_identity_index(core, catalog, definitions, [documents])
    with closing(sqlite3.connect(core)) as db:
        assert (
            db.execute("SELECT * FROM core_identity_targets ORDER BY target_id").fetchall()
            == snapshot
        )
    modules[0]["version"] = "changed"
    altered_artifact = dict(artifact)
    altered_artifact["sha256"] = "sha256:" + "d" * 64
    modules[0]["artifacts"] = [altered_artifact]
    catalog.write_text(json.dumps({"modules": modules}))
    with pytest.raises(ValueError, match="checksum"):
        build_core_identity_index(core, catalog, definitions, [documents])
    with closing(sqlite3.connect(core)) as db:
        assert (
            db.execute("SELECT * FROM core_identity_targets ORDER BY target_id").fetchall()
            == snapshot
        )
