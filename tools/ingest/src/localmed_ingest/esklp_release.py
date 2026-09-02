from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import cast
from urllib.parse import quote, urlsplit

from .builder import read_yaml_mapping
from .edition_manifest import EditionManifest, sha256_file
from .models import BuildReport, PackManifest

EXPECTED_ESKLP_MODULE_IDS = (
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

_SHA256_PATTERN = re.compile(r"^sha256:[a-f0-9]{64}$")
_SCHEMA_VERSION = 2
_MIN_APP_VERSION = "0.6.0"
_CORE_CATALOG_VERSION = "1"


@dataclass(frozen=True)
class EsklpReleaseResult:
    output: Path
    module_ids: tuple[str, ...]
    size_bytes: int


@dataclass(frozen=True)
class _ValidatedModule:
    module_id: str
    version: str
    title: str
    database: Path
    database_sha256: str
    database_size: int
    source_set_digest: str
    document_count: int


def _require_directory(path: Path, label: str) -> Path:
    resolved = path.resolve()
    if not resolved.is_dir():
        raise ValueError(f"{label} directory does not exist: {resolved}")
    return resolved


def _is_staging_name(name: str) -> bool:
    lowered = name.casefold()
    return (
        lowered.endswith((".stage", ".staging", ".partial"))
        or ".stage-" in lowered
        or ".staging-" in lowered
    )


def _reject_staging(root: Path) -> None:
    staged = sorted(
        str(path.relative_to(root)) for path in root.rglob("*") if _is_staging_name(path.name)
    )
    if staged:
        raise ValueError(f"Staging artifacts are not allowed in {root}: {staged[:5]}")


def _require_exact_entries(root: Path, expected_names: set[str], label: str) -> None:
    actual_names = {path.name for path in root.iterdir()}
    missing = sorted(expected_names - actual_names)
    extra = sorted(actual_names - expected_names)
    if missing or extra:
        raise ValueError(f"{label} set mismatch: missing={missing}, extra={extra}.")


def _require_manifest_entries(root: Path, expected_ids: set[str]) -> None:
    directories = {path.name for path in root.iterdir() if path.is_dir()}
    unexpected_files = sorted(
        path.name
        for path in root.iterdir()
        if not path.is_dir() and path.name != "module-build-report.json"
    )
    missing = sorted(expected_ids - directories)
    extra = sorted(directories - expected_ids)
    if missing or extra or unexpected_files:
        raise ValueError(
            "Manifest module set mismatch: "
            f"missing={missing}, extra={extra}, unexpectedFiles={unexpected_files}."
        )


def _validate_release_url(release_base_url: str, release_tag: str) -> str:
    normalized_base_url = release_base_url.rstrip("/")
    parsed = urlsplit(normalized_base_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(
            "Release base URL must be an absolute HTTP(S) URL without query or fragment."
        )
    if not release_tag or release_tag.strip() != release_tag:
        raise ValueError(
            "Release tag must be non-empty and must not contain surrounding whitespace."
        )
    return normalized_base_url


def _source_set_payload(manifest: EditionManifest) -> list[dict[str, str]]:
    payload = [
        {
            "documentId": source.document_id,
            "documentVersionId": source.document_version_id,
            "sourceChecksum": source.source_checksum,
        }
        for source in sorted(
            manifest.sources,
            key=lambda item: (item.document_id, item.document_version_id),
        )
    ]
    identities = {(item["documentId"], item["documentVersionId"]) for item in payload}
    if len(identities) != len(payload):
        raise ValueError(f"Edition {manifest.edition_id} contains duplicate source identities.")
    for item in payload:
        if not _SHA256_PATTERN.fullmatch(item["sourceChecksum"]):
            raise ValueError(f"Edition {manifest.edition_id} contains an invalid source checksum.")
    return payload


def _source_set_digest(payload: list[dict[str, str]]) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _read_database_identity(database: Path) -> tuple[str, str, str, int, list[dict[str, str]]]:
    uri = f"{database.resolve().as_uri()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        connection.execute("PRAGMA query_only = ON")
        integrity = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
        if integrity != ["ok"]:
            raise ValueError(f"SQLite integrity check failed for {database}: {integrity[:5]}")
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_key_violations:
            raise ValueError(f"SQLite foreign-key check failed for {database}.")
        raw_packs = cast(
            list[tuple[object, object, object]],
            connection.execute("SELECT id, version, title FROM content_packs").fetchall(),
        )
        if len(raw_packs) != 1:
            raise ValueError(f"Database must contain exactly one content pack: {database}")
        pack = tuple(str(value) for value in raw_packs[0])
        schema_row = connection.execute(
            "SELECT value FROM app_metadata WHERE key = 'schema_version'"
        ).fetchone()
        if schema_row is None or str(schema_row[0]) != str(_SCHEMA_VERSION):
            raise ValueError(f"Database has an incompatible schema version: {database}")
        raw_sources = cast(
            list[tuple[object, object, object]],
            connection.execute(
                """SELECT d.id, dv.id, dv.source_checksum
                FROM documents d
                JOIN document_versions dv ON dv.id = d.current_version_id
                ORDER BY d.id, dv.id"""
            ).fetchall(),
        )
    except sqlite3.DatabaseError as error:
        raise ValueError(f"Unable to validate SQLite database {database}: {error}") from error
    finally:
        connection.close()
    sources = [
        {
            "documentId": str(document_id),
            "documentVersionId": str(version_id),
            "sourceChecksum": str(checksum),
        }
        for document_id, version_id, checksum in raw_sources
    ]
    return pack[0], pack[1], pack[2], len(sources), sources


def _validate_module(
    module_id: str,
    database: Path,
    manifest_path: Path,
    edition_manifest_path: Path,
    build_report_path: Path,
) -> _ValidatedModule:
    manifest = PackManifest.model_validate(read_yaml_mapping(manifest_path))
    edition = EditionManifest.model_validate_json(edition_manifest_path.read_text(encoding="utf-8"))
    report = BuildReport.model_validate_json(build_report_path.read_text(encoding="utf-8"))
    if manifest.id != module_id or edition.edition_id != module_id:
        raise ValueError(f"Module identity mismatch for {module_id}.")
    if manifest.version != edition.edition_version:
        raise ValueError(f"Module version mismatch for {module_id}.")
    if manifest.schema_version != _SCHEMA_VERSION or edition.schema_version != 1:
        raise ValueError(f"Module schema mismatch for {module_id}.")
    if edition.publishability not in {"local-dev", "published"}:
        raise ValueError(f"Unsupported edition publishability for {module_id}.")
    database_sha256 = sha256_file(database)
    if not _SHA256_PATTERN.fullmatch(database_sha256):
        raise ValueError(f"Invalid database checksum for {module_id}.")
    if edition.database_sha256 != database_sha256 or report.output_checksum != database_sha256:
        raise ValueError(f"Database checksum mismatch for {module_id}.")
    if report.sqlite_integrity != "ok" or report.foreign_key_violations != 0 or report.errors:
        raise ValueError(f"Build report is not release-ready for {module_id}.")
    counts = (
        report.documents,
        report.sections,
        report.chunks,
        report.aliases,
        report.embedding_profiles,
        report.embeddings,
    )
    if any(count < 0 for count in counts):
        raise ValueError(f"Build report contains a negative count for {module_id}.")

    pack_id, pack_version, pack_title, document_count, database_sources = _read_database_identity(
        database
    )
    if (pack_id, pack_version, pack_title) != (manifest.id, manifest.version, manifest.title):
        raise ValueError(f"Database content-pack identity mismatch for {module_id}.")
    source_payload = _source_set_payload(edition)
    if database_sources != source_payload:
        raise ValueError(f"Edition source set does not match the database for {module_id}.")
    if report.documents != document_count or report.documents != len(source_payload):
        raise ValueError(f"Document count mismatch for {module_id}.")
    database_size = database.stat().st_size
    if database_size <= 0:
        raise ValueError(f"Database is empty for {module_id}.")
    return _ValidatedModule(
        module_id=module_id,
        version=manifest.version,
        title=manifest.title,
        database=database,
        database_sha256=database_sha256,
        database_size=database_size,
        source_set_digest=_source_set_digest(source_payload),
        document_count=document_count,
    )


def _catalog_entry(
    module: _ValidatedModule,
    *,
    release_tag: str,
    release_base_url: str,
) -> dict[str, object]:
    artifact_id = f"{module.module_id}-index-{module.version}"
    artifact_url = "/".join(
        [
            release_base_url,
            quote(release_tag, safe=""),
            quote(module.database.name, safe=".-_"),
        ]
    )
    artifact = {
        "id": artifact_id,
        "kind": "index",
        "required": True,
        "url": artifact_url,
        "sha256": module.database_sha256,
        "sizeBytes": module.database_size,
        "compression": "none",
        "sourceSetDigest": module.source_set_digest,
    }
    return {
        "id": module.module_id,
        "version": module.version,
        "kind": "medication",
        "collection": "esklp",
        "title": module.title,
        "description": f"ЕСКЛП: {module.title}. Регистрационные данные о лекарственных препаратах.",
        "required": False,
        "releaseState": "preview",
        "specialties": [],
        "populations": [],
        "tags": ["esklp", "official-registry"],
        "compatibility": {
            "minAppVersion": _MIN_APP_VERSION,
            "maxAppVersion": None,
            "schemaVersion": _SCHEMA_VERSION,
            "coreCatalogVersion": _CORE_CATALOG_VERSION,
        },
        "sourceSetDigest": module.source_set_digest,
        "dependencies": [
            {
                "moduleId": "minimed.core.ru",
                "versionRange": "^1.0.0",
                "required": True,
            }
        ],
        "sizes": {
            "downloadBytes": module.database_size,
            "installedBytes": module.database_size,
            "sourceAssetsDownloadBytes": None,
            "precision": "exact",
        },
        "capabilities": {
            "search": True,
            "fullText": True,
            "structuredTables": False,
            "images": False,
            "originalPdf": False,
            "structuredKnowledge": True,
            "calculations": False,
        },
        "artifacts": [artifact],
        "documents": [],
        "previewDocumentCount": module.document_count,
    }


def prepare_esklp_release(
    *,
    db_dir: Path,
    manifests_dir: Path,
    reports_dir: Path,
    release_tag: str,
    release_base_url: str,
    output: Path,
) -> EsklpReleaseResult:
    resolved_db_dir = _require_directory(db_dir, "Database")
    resolved_manifests_dir = _require_directory(manifests_dir, "Manifest")
    resolved_reports_dir = _require_directory(reports_dir, "Report")
    for root in (resolved_db_dir, resolved_manifests_dir, resolved_reports_dir):
        _reject_staging(root)
    expected_ids: set[str] = set(EXPECTED_ESKLP_MODULE_IDS)
    _require_exact_entries(
        resolved_db_dir,
        {f"{module_id}.db" for module_id in expected_ids},
        "Database",
    )
    _require_manifest_entries(resolved_manifests_dir, expected_ids)
    _require_exact_entries(
        resolved_reports_dir,
        {
            filename
            for module_id in expected_ids
            for filename in (
                f"{module_id}-edition-manifest.json",
                f"{module_id}-build-report.json",
            )
        },
        "Report",
    )
    release_url = _validate_release_url(release_base_url, release_tag)
    resolved_output = output.resolve()
    for source_root in (resolved_db_dir, resolved_manifests_dir, resolved_reports_dir):
        if resolved_output.is_relative_to(source_root):
            raise ValueError("Release output must be outside all source directories.")
    if resolved_output.exists():
        raise FileExistsError(f"Release output already exists: {resolved_output}")

    modules = [
        _validate_module(
            module_id,
            resolved_db_dir / f"{module_id}.db",
            resolved_manifests_dir / module_id / "manifest.yaml",
            resolved_reports_dir / f"{module_id}-edition-manifest.json",
            resolved_reports_dir / f"{module_id}-build-report.json",
        )
        for module_id in EXPECTED_ESKLP_MODULE_IDS
    ]
    payload = {
        "schemaVersion": 1,
        "releaseTag": release_tag,
        "modules": [
            _catalog_entry(module, release_tag=release_tag, release_base_url=release_url)
            for module in modules
        ],
    }
    encoded = (json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(
        "utf-8"
    )
    resolved_output.parent.mkdir(parents=True, exist_ok=True)
    with resolved_output.open("xb") as target:
        target.write(encoded)
    return EsklpReleaseResult(
        output=resolved_output,
        module_ids=EXPECTED_ESKLP_MODULE_IDS,
        size_bytes=len(encoded),
    )
