from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from localmed_ingest.esklp_release import prepare_esklp_release
from localmed_ingest.regulated_catalog_cli import app

MODULE_IDS = (
    "minimed.medications.alimentary-metabolism.ru",
    "minimed.medications.antiinfectives.ru",
    "minimed.medications.antineoplastic-immunomodulating.ru",
    "minimed.medications.antiparasitic.ru",
    "minimed.medications.blood.ru",
    "minimed.medications.cardiovascular.ru",
    "minimed.medications.dermatological.ru",
    "minimed.medications.genitourinary-hormones.ru",
    "minimed.medications.musculoskeletal.ru",
    "minimed.medications.nervous-system.ru",
    "minimed.medications.respiratory.ru",
    "minimed.medications.sensory-organs.ru",
    "minimed.medications.systemic-hormones.ru",
    "minimed.medications.unclassified.ru",
    "minimed.medications.various.ru",
)
VERSION = "2026-08-28"


def sha256_file(path: Path) -> str:
    return f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"


def source_checksum(module_id: str) -> str:
    return f"sha256:{hashlib.sha256(module_id.encode()).hexdigest()}"


def write_release_fixture(root: Path) -> tuple[Path, Path, Path]:
    db_dir = root / "db"
    manifests_dir = root / "modules"
    reports_dir = root / "reports"
    db_dir.mkdir()
    manifests_dir.mkdir()
    reports_dir.mkdir()
    (manifests_dir / "module-build-report.json").write_text("{}\n", encoding="utf-8")
    for module_id in MODULE_IDS:
        title = module_id.removeprefix("minimed.medications.").removesuffix(".ru")
        document_id = f"esklp.mnn.{title}"
        document_version_id = f"{document_id}@{VERSION}"
        checksum = source_checksum(module_id)
        database = db_dir / f"{module_id}.db"
        connection = sqlite3.connect(database)
        try:
            connection.executescript(
                """
                CREATE TABLE content_packs(id TEXT, version TEXT, title TEXT);
                CREATE TABLE app_metadata(key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE documents(id TEXT PRIMARY KEY, current_version_id TEXT NOT NULL);
                CREATE TABLE document_versions(
                    id TEXT PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    source_checksum TEXT NOT NULL
                );
                """
            )
            connection.execute(
                "INSERT INTO content_packs(id, version, title) VALUES (?, ?, ?)",
                (module_id, VERSION, title),
            )
            connection.execute(
                "INSERT INTO app_metadata(key, value) VALUES ('schema_version', '2')"
            )
            connection.execute(
                "INSERT INTO documents(id, current_version_id) VALUES (?, ?)",
                (document_id, document_version_id),
            )
            connection.execute(
                """INSERT INTO document_versions(id, document_id, source_checksum)
                VALUES (?, ?, ?)""",
                (document_version_id, document_id, checksum),
            )
            connection.commit()
        finally:
            connection.close()
        database_checksum = sha256_file(database)

        module_dir = manifests_dir / module_id
        module_dir.mkdir()
        (module_dir / "manifest.yaml").write_text(
            "\n".join(
                [
                    f"id: {module_id}",
                    f"version: '{VERSION}'",
                    "schemaVersion: 2",
                    f"title: {title}",
                    "builtAt: '2026-08-30T00:00:00Z'",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        (reports_dir / f"{module_id}-edition-manifest.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "editionId": module_id,
                    "editionVersion": VERSION,
                    "databaseSha256": database_checksum,
                    "publishability": "local-dev",
                    "sources": [
                        {
                            "documentId": document_id,
                            "documentVersionId": document_version_id,
                            "sourceChecksum": checksum,
                            "provenance": None,
                        }
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        (reports_dir / f"{module_id}-build-report.json").write_text(
            json.dumps(
                {
                    "documents": 1,
                    "sections": 1,
                    "chunks": 1,
                    "aliases": 1,
                    "embeddingProfiles": 0,
                    "embeddings": 0,
                    "warnings": [],
                    "errors": [],
                    "outputChecksum": database_checksum,
                    "sqliteIntegrity": "ok",
                    "foreignKeyViolations": 0,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    return db_dir, manifests_dir, reports_dir


def test_prepares_deterministic_content_module_updates_for_exact_esklp_set(
    tmp_path: Path,
) -> None:
    db_dir, manifests_dir, reports_dir = write_release_fixture(tmp_path)
    output = tmp_path / "release" / "esklp-updates.json"

    result = prepare_esklp_release(
        db_dir=db_dir,
        manifests_dir=manifests_dir,
        reports_dir=reports_dir,
        release_tag="esklp-2026-08-28",
        release_base_url="https://github.example/minimed/releases/download",
        output=output,
    )

    assert result.module_ids == MODULE_IDS
    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["schemaVersion"] == 1
    assert payload["releaseTag"] == "esklp-2026-08-28"
    assert [module["id"] for module in payload["modules"]] == list(MODULE_IDS)
    first = payload["modules"][0]
    database = db_dir / f"{MODULE_IDS[0]}.db"
    source_payload = [
        {
            "documentId": "esklp.mnn.alimentary-metabolism",
            "documentVersionId": f"esklp.mnn.alimentary-metabolism@{VERSION}",
            "sourceChecksum": source_checksum(MODULE_IDS[0]),
        }
    ]
    expected_source_digest = (
        "sha256:"
        + hashlib.sha256(
            json.dumps(
                source_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest()
    )
    assert first["version"] == VERSION
    assert first["kind"] == "medication"
    assert first["releaseState"] == "preview"
    assert "official-registry" in first["tags"]
    assert "trustedDoseData" not in first
    assert first["documents"] == []
    assert first["previewDocumentCount"] == 1
    assert first["sourceSetDigest"] == expected_source_digest
    assert first["sourceSetDigest"] != sha256_file(database)
    assert first["artifacts"] == [
        {
            "id": f"{MODULE_IDS[0]}-index-{VERSION}",
            "kind": "index",
            "required": True,
            "url": (
                "https://github.example/minimed/releases/download/esklp-2026-08-28/"
                f"{MODULE_IDS[0]}.db"
            ),
            "sha256": sha256_file(database),
            "sizeBytes": database.stat().st_size,
            "compression": "none",
            "sourceSetDigest": expected_source_digest,
        }
    ]


def test_esklp_release_command_writes_the_validated_fragment(tmp_path: Path) -> None:
    db_dir, manifests_dir, reports_dir = write_release_fixture(tmp_path)
    output = tmp_path / "command-output.json"

    result = CliRunner().invoke(
        app,
        [
            "esklp-release",
            "--db-dir",
            str(db_dir),
            "--manifests-dir",
            str(manifests_dir),
            "--reports-dir",
            str(reports_dir),
            "--release-tag",
            "esklp-2026-08-28",
            "--release-base-url",
            "https://github.example/minimed/releases/download",
            "--output",
            str(output),
        ],
    )

    assert result.exit_code == 0, result.stdout
    summary = json.loads(result.stdout)
    assert summary["moduleCount"] == 15
    assert summary["moduleIds"] == list(MODULE_IDS)
    assert summary["output"] == str(output.resolve())
    assert output.is_file()


@pytest.mark.parametrize(
    ("case", "message"),
    [
        ("missing", "Database set mismatch"),
        ("extra", "Database set mismatch"),
        ("identity", "Module identity mismatch"),
        ("staging", "Staging artifacts"),
        ("build-report", "Build report is not release-ready"),
        ("checksum", "Database checksum mismatch"),
    ],
)
def test_rejects_incomplete_or_inconsistent_release_inputs(
    tmp_path: Path,
    case: str,
    message: str,
) -> None:
    db_dir, manifests_dir, reports_dir = write_release_fixture(tmp_path)
    first_module_id = MODULE_IDS[0]
    if case == "missing":
        (db_dir / f"{MODULE_IDS[-1]}.db").unlink()
    elif case == "extra":
        (db_dir / "unexpected.db").write_bytes(b"")
    elif case == "identity":
        manifest = manifests_dir / first_module_id / "manifest.yaml"
        manifest.write_text(
            manifest.read_text(encoding="utf-8").replace(
                f"id: {first_module_id}", "id: minimed.medications.wrong.ru"
            ),
            encoding="utf-8",
        )
    elif case == "staging":
        (reports_dir / ".esklp-release.json.stage").write_text("staging", encoding="utf-8")
    else:
        report_path = reports_dir / f"{first_module_id}-build-report.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        if case == "build-report":
            report["sqliteIntegrity"] = "failed"
        else:
            report["outputChecksum"] = f"sha256:{'0' * 64}"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        prepare_esklp_release(
            db_dir=db_dir,
            manifests_dir=manifests_dir,
            reports_dir=reports_dir,
            release_tag="esklp-2026-08-28",
            release_base_url="https://github.example/minimed/releases/download",
            output=tmp_path / "output.json",
        )
