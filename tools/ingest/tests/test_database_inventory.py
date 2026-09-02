from __future__ import annotations

import hashlib
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

from localmed_ingest.database_inventory import inventory_databases, write_inventory_report

FIXED_TIME = "2026-08-31T00:00:00Z"


def create_database(path: Path, *, with_metadata: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA user_version = 7")
        if with_metadata:
            connection.executescript(
                """
                CREATE TABLE app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE content_packs (
                    id TEXT PRIMARY KEY,
                    version TEXT NOT NULL,
                    schema_version INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    checksum TEXT NOT NULL,
                    installed_at TEXT NOT NULL,
                    enabled INTEGER NOT NULL
                );
                CREATE TABLE documents (
                    id TEXT PRIMARY KEY,
                    content_pack_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    current_version_id TEXT NOT NULL
                );
                CREATE TABLE document_versions (
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    version_label TEXT NOT NULL,
                    source_checksum TEXT NOT NULL
                );
                CREATE TABLE knowledge_entities (id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL);
                CREATE TABLE medication_profiles (entity_id TEXT PRIMARY KEY);
                CREATE TABLE medications (id TEXT PRIMARY KEY, name TEXT NOT NULL);
                """
            )
            connection.executemany(
                "INSERT INTO app_metadata(key, value) VALUES (?, ?)",
                [("schema_version", "2"), ("sourceSetDigest", "sha256:source-set")],
            )
            connection.execute(
                "INSERT INTO content_packs VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    "minimed.test",
                    "1.0.0",
                    2,
                    "Test pack",
                    "sha256:pack",
                    "2026-08-31T00:00:00Z",
                    1,
                ),
            )
            for index in range(2):
                document_id = f"document-{index}"
                version_id = f"version-{index}"
                connection.execute(
                    "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        document_id,
                        "minimed.test",
                        f"Document {index}",
                        "clinical_recommendation",
                        "published",
                        json.dumps(
                            {
                                "coverageState": "published",
                                "coverageLevel": "searchable",
                                "sourceFile": f"source-{index}.pdf",
                            }
                        ),
                        version_id,
                    ),
                )
                connection.execute(
                    "INSERT INTO document_versions VALUES (?, ?, ?, ?)",
                    (version_id, document_id, "2026", f"sha256:source-{index}"),
                )
            connection.executemany(
                "INSERT INTO knowledge_entities VALUES (?, ?)",
                [("entity-1", "One"), ("entity-2", "Two"), ("entity-3", "Three")],
            )
            connection.executemany(
                "INSERT INTO medication_profiles VALUES (?)",
                [("medication-1",), ("medication-2",)],
            )
            connection.executemany(
                "INSERT INTO medications VALUES (?, ?)",
                [("medication-1", "One"), ("medication-2", "Two"), ("medication-3", "Three")],
            )
        connection.commit()
    finally:
        connection.close()


def artifact_by_path(report: dict[str, object], path: str) -> dict[str, object]:
    artifacts = report["artifacts"]
    assert isinstance(artifacts, list)
    for artifact in artifacts:
        assert isinstance(artifact, dict)
        if artifact["relativePath"] == path:
            return artifact
    raise AssertionError(f"Missing artifact {path}")


def test_inventory_reports_checksum_metadata_and_counts(tmp_path: Path) -> None:
    database = tmp_path / "data" / "build" / "pack.db"
    create_database(database, with_metadata=True)

    report = inventory_databases(tmp_path, generated_at=FIXED_TIME)
    artifact = artifact_by_path(report, "data/build/pack.db")

    assert report["schemaVersion"] == 1
    assert report["generatedAt"] == FIXED_TIME
    assert report["root"] == str(tmp_path.resolve())
    assert artifact["sizeBytes"] == database.stat().st_size
    assert artifact["sha256"] == f"sha256:{hashlib.sha256(database.read_bytes()).hexdigest()}"
    assert artifact["sqliteHeader"] == "SQLite format 3"
    assert artifact["sqliteResult"] == "ok"
    assert isinstance(artifact["schemaVersion"], int)
    assert artifact["schemaVersion"] >= 1
    assert artifact["userVersion"] == 7
    assert artifact["quickCheck"] == "ok"
    assert artifact["role"] == "generated-build"
    assert artifact["counts"] == {
        "documents": 2,
        "knowledge_entities": 3,
        "medications": 3,
    }
    pack_metadata = artifact["packMetadata"]
    assert isinstance(pack_metadata, dict)
    assert pack_metadata["packs"][0]["id"] == "minimed.test"
    source_coverage = artifact["sourceCoverage"]
    assert isinstance(source_coverage, dict)
    assert source_coverage["documentCount"] == 2
    assert "documents" not in source_coverage
    assert source_coverage["byCoverageState"] == {"published": 2}
    versions = source_coverage["versions"]
    assert isinstance(versions, dict)
    assert versions["count"] == 2
    assert versions["sourceChecksumCount"] == 2
    assert "sourceChecksumDigest" in versions


def test_inventory_is_deterministic_with_fixed_time(tmp_path: Path) -> None:
    create_database(tmp_path / "z.db")
    create_database(tmp_path / "a.db")

    first = inventory_databases(tmp_path, generated_at=FIXED_TIME)
    second = inventory_databases(tmp_path, generated_at=FIXED_TIME)

    assert first == second
    artifacts = first["artifacts"]
    assert isinstance(artifacts, list)
    assert [artifact["relativePath"] for artifact in artifacts] == ["a.db", "z.db"]


def test_inventory_does_not_modify_database_bytes_or_mtime(tmp_path: Path) -> None:
    database = tmp_path / "readonly.db"
    create_database(database, with_metadata=True)
    before_bytes = database.read_bytes()
    before_mtime = database.stat().st_mtime_ns

    inventory_databases(tmp_path, generated_at=FIXED_TIME)

    assert database.read_bytes() == before_bytes
    assert database.stat().st_mtime_ns == before_mtime


def test_corrupt_or_non_sqlite_file_is_reported_without_aborting(tmp_path: Path) -> None:
    create_database(tmp_path / "valid.db")
    (tmp_path / "broken.db").write_bytes(b"not an SQLite database")

    report = inventory_databases(tmp_path, generated_at=FIXED_TIME)
    broken = artifact_by_path(report, "broken.db")

    assert broken["status"] == "invalid"
    assert broken["sqliteHeader"] == "not-sqlite"
    assert broken["sqliteResult"] == "not-sqlite"
    assert broken["quickCheck"] is None
    diagnostics = broken["diagnostics"]
    assert isinstance(diagnostics, list)
    assert isinstance(diagnostics[0], dict)
    assert diagnostics[0]["code"] == "not-sqlite-header"
    assert artifact_by_path(report, "valid.db")["status"] == "ok"


def test_role_classification_uses_repository_layout(tmp_path: Path) -> None:
    paths = {
        "data/build/generated.db": "generated-build",
        "apps/app/public/content/runtime.db": "packaged-runtime",
        "packages/test-fixtures/fixture.db": "test-fixture",
        "notes/local.db": "local-unknown",
    }
    for relative_path in paths:
        create_database(tmp_path / relative_path)

    report = inventory_databases(tmp_path, generated_at=FIXED_TIME)

    for relative_path, role in paths.items():
        assert artifact_by_path(report, relative_path)["role"] == role


def test_db_output_is_rejected_before_writing(tmp_path: Path) -> None:
    output = tmp_path / "inventory.db"

    try:
        write_inventory_report({"schemaVersion": 1}, output)
    except ValueError as error:
        assert ".db" in str(error)
    else:
        raise AssertionError("A .db output path must be rejected")

    assert not output.exists()


def test_external_symlinks_are_not_followed(tmp_path: Path) -> None:
    root = tmp_path / "root"
    outside = tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    create_database(root / "inside.db")
    external = outside / "secret.db"
    create_database(external, with_metadata=True)
    (root / "external.db").symlink_to(external)
    (root / "external-directory").symlink_to(outside, target_is_directory=True)

    before_bytes = external.read_bytes()
    before_mtime = external.stat().st_mtime_ns
    report = inventory_databases(root, generated_at=FIXED_TIME)

    skipped = artifact_by_path(report, "external.db")
    assert skipped["status"] == "skipped"
    assert skipped["sqliteResult"] == "symlink-outside-root"
    assert skipped["sha256"] is None
    artifacts = report["artifacts"]
    assert isinstance(artifacts, list)
    assert not any(artifact["relativePath"] == "secret.db" for artifact in artifacts)
    assert external.read_bytes() == before_bytes
    assert external.stat().st_mtime_ns == before_mtime


def test_cli_requires_explicit_root_and_output_and_writes_json(tmp_path: Path) -> None:
    database = tmp_path / "one.db"
    create_database(database)
    output = tmp_path / "inventory.json"
    script = Path(__file__).resolve().parents[1] / "scripts" / "inventory_databases.py"

    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--root",
            str(tmp_path),
            "--output",
            str(output),
            "--generated-at",
            FIXED_TIME,
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    saved_report = json.loads(output.read_text(encoding="utf-8"))
    assert saved_report["generatedAt"] == FIXED_TIME
    summary = json.loads(result.stdout)
    assert summary["output"] == str(output)
    assert summary["totals"]["artifacts"] == 1
    assert "artifacts" not in summary

    rejected_output = tmp_path / "rejected.db"
    rejected = subprocess.run(
        [sys.executable, str(script), "--root", str(tmp_path), "--output", str(rejected_output)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert rejected.returncode != 0
    assert not rejected_output.exists()

    missing_output = subprocess.run(
        [sys.executable, str(script), "--root", str(tmp_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert missing_output.returncode != 0
