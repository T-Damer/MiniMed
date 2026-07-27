from __future__ import annotations

import hashlib
import json
import re
import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import yaml

from .builder import build_content_pack
from .clinical_catalog import ClinicalCoverageLedger
from .models import RegistryPack, RegistrySource, SourceRegistry
from .source_registry import NoSearchableTextError, prepare_registry
from .source_sync import SourceSyncManifest, SyncSource

OFFICIAL_CLINICAL_JSON_API = (
    "https://apicr.minzdrav.gov.ru/api.ashx?op=GetClinrec2&id={official_id}&ssid=undefined"
)
_OFFICIAL_ID = re.compile(r"^\d+_\d+$")
_SNAPSHOT_ID = re.compile(r"^[a-z0-9][a-z0-9.-]+$")
_MAX_CLINICAL_JSON_BYTES = 128 * 1024 * 1024


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _checksum(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def _load_ledger(path: Path) -> ClinicalCoverageLedger:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    return ClinicalCoverageLedger.model_validate(payload)


def _write_yaml(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def build_clinical_source_plan(
    ledger_path: Path,
    output_root: Path,
    *,
    version: str,
    generated_at: str | None = None,
    force: bool = False,
) -> dict[str, object]:
    ledger = _load_ledger(ledger_path)
    target = output_root.resolve()
    if target.exists() and not force:
        raise FileExistsError(f"Clinical source plan already exists: {target}")
    temporary = target.with_name(f".{target.name}.tmp-{uuid.uuid4().hex}")
    temporary.mkdir(parents=True)
    created_at = generated_at or _utc_now()
    try:
        sync_sources: list[SyncSource] = []
        discovery_records: list[dict[str, object]] = []
        for record in ledger.records:
            if not _OFFICIAL_ID.fullmatch(record.official_id):
                raise ValueError(f"Unsupported official clinical ID: {record.official_id}")
            json_url = OFFICIAL_CLINICAL_JSON_API.format(official_id=record.official_id)
            filename = f"{record.official_id}.json"
            record_payload = record.model_dump(by_alias=True, mode="json")
            record_checksum = _checksum(record_payload)
            module_id = f"minimed.clinical.recommendation.{record.official_id}"
            sync_sources.append(
                SyncSource(
                    id=f"clinical-{record.official_id}",
                    location=json_url,
                    target=filename,
                    content_type="text",
                    max_bytes=_MAX_CLINICAL_JSON_BYTES,
                )
            )
            registry = SourceRegistry(
                pack=RegistryPack(
                    id=module_id,
                    version=version,
                    schema_version=2,
                    title=record.title,
                    built_at=created_at,
                ),
                sources=[
                    RegistrySource(
                        id=record.record_id,
                        path=filename,
                        title=record.title,
                        short_title=record.title,
                        version_label=record.version_label,
                        source_type="clinical_recommendation",
                        status=record.status,
                        specialties=record.specialties,
                        age_groups=record.age_categories,
                        format="clinical_json",
                        metadata={
                            "officialId": record.official_id,
                            "officialSourceUrl": record.official_url,
                            "sourceJsonUrl": json_url,
                            "sourceCatalogChecksum": ledger.source_checksum,
                            "catalogRecordChecksum": record_checksum,
                            "primaryModuleId": record.primary_module_id,
                            "moduleIds": record.module_ids,
                            "retrievedBy": "automated-source-sync",
                        },
                    )
                ],
            )
            _write_yaml(
                temporary / "registries" / f"{record.official_id}.yaml",
                registry.model_dump(by_alias=True, mode="json"),
            )
            discovery_records.append(
                {
                    "recordId": record.record_id,
                    "officialId": record.official_id,
                    "title": record.title,
                    "versionLabel": record.version_label,
                    "status": record.status,
                    "applicationStatus": record.application_status,
                    "coverageState": record.coverage_state,
                    "rights": record.rights,
                    "ageCategories": record.age_categories,
                    "icd10Codes": record.icd10_codes,
                    "specialties": record.specialties,
                    "primaryCategoryId": record.primary_module_id,
                    "categoryIds": record.module_ids,
                    "officialUrl": record.official_url,
                    "sourceJsonUrl": json_url,
                    "catalogRecordChecksum": record_checksum,
                    "downloadModuleId": module_id,
                }
            )

        sync_manifest = SourceSyncManifest(version=1, sources=sync_sources)
        _write_yaml(temporary / "sources.yaml", sync_manifest.model_dump(mode="json"))
        categories = [
            {
                "id": module.module_id,
                "title": module.title,
                "recommendationCount": len(module.record_ids),
                "specialties": module.specialties,
            }
            for module in ledger.modules
        ]
        discovery = {
            "schemaVersion": 1,
            "version": version,
            "generatedAt": created_at,
            "sourceCatalogChecksum": ledger.source_checksum,
            "taxonomyChecksum": ledger.taxonomy_checksum,
            "recommendationCount": len(discovery_records),
            "categoryCount": len(categories),
            "categories": categories,
            "recommendations": discovery_records,
        }
        _write_json(temporary / "discovery.json", discovery)
        report = {
            "outputRoot": str(target),
            "version": version,
            "recommendations": len(discovery_records),
            "categories": len(categories),
            "sourceCatalogChecksum": ledger.source_checksum,
            "taxonomyChecksum": ledger.taxonomy_checksum,
            "discoveryChecksum": _checksum(discovery),
            "generatedAt": created_at,
        }
        _write_json(temporary / "report.json", report)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            shutil.rmtree(target)
        temporary.replace(target)
        return report
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def _render_block_image_count(block: object) -> int:
    if not isinstance(block, dict):
        return 0
    if block.get("kind") == "image":
        return 1
    if block.get("kind") != "table" or not isinstance(block.get("rows"), list):
        return 0
    return sum(
        len(images)
        for row in cast(list[object], block["rows"])
        if isinstance(row, dict) and isinstance(row.get("cells"), list)
        for cell in cast(list[object], row["cells"])
        if isinstance(cell, dict) and isinstance(images := cell.get("images"), list)
    )


def build_individual_clinical_documents(
    plan_root: Path,
    source_root: Path,
    output_root: Path,
    *,
    official_ids: list[str] | None = None,
    category_id: str | None = None,
    all_documents: bool = False,
    allow_partial: bool = False,
    force: bool = False,
) -> dict[str, object]:
    discovery_payload: object = json.loads(
        (plan_root / "discovery.json").read_text(encoding="utf-8")
    )
    if not isinstance(discovery_payload, dict) or not isinstance(
        discovery_payload.get("recommendations"), list
    ):
        raise ValueError("Clinical discovery index has no recommendations array.")
    recommendations = [
        cast(dict[str, object], item)
        for item in discovery_payload["recommendations"]
        if isinstance(item, dict)
    ]
    requested = set(official_ids or [])
    if not (requested or category_id or all_documents):
        raise ValueError("Select --official-id, --category-id, or --all.")
    known_ids = {cast(str, item["officialId"]) for item in recommendations}
    unknown = sorted(requested - known_ids)
    if unknown:
        raise ValueError(f"Unknown official clinical IDs: {', '.join(unknown)}")
    selected = [
        item
        for item in recommendations
        if all_documents
        or item["officialId"] in requested
        or (category_id is not None and category_id in cast(list[str], item.get("categoryIds", [])))
    ]
    if not selected:
        raise ValueError(f"No recommendations matched category {category_id}.")

    artifacts: list[dict[str, object]] = []
    failures: list[dict[str, str]] = []
    for item in selected:
        official_id = cast(str, item["officialId"])
        registry_path = plan_root / "registries" / f"{official_id}.yaml"
        workspace = output_root / "workspaces" / official_id
        database = output_root / "databases" / f"{official_id}.db"
        report_path = output_root / "reports" / f"{official_id}.json"
        if database.exists() and not force:
            raise FileExistsError(f"Clinical document database already exists: {database}")
        try:
            prepare_registry(registry_path, source_root, workspace, force=force)
            pack, report = build_content_pack(workspace, database, report_path=report_path)
        except NoSearchableTextError as error:
            database.unlink(missing_ok=True)
            report_path.unlink(missing_ok=True)
            if not allow_partial:
                raise
            failures.append(
                {
                    "officialId": official_id,
                    "errorType": type(error).__name__,
                    "error": str(error),
                }
            )
            continue
        if len(pack.documents) != 1:
            raise ValueError(f"{official_id}: individual module must contain exactly one document.")
        document = pack.documents[0]
        render_blocks = [
            chunk.metadata.get("renderBlock")
            for section in document.sections
            for chunk in section.chunks
        ]
        artifacts.append(
            {
                "officialId": official_id,
                "moduleId": item["downloadModuleId"],
                "categoryIds": item["categoryIds"],
                "database": str(database),
                "bytes": database.stat().st_size,
                "sha256": report.output_checksum,
                "documentId": document.id,
                "documentVersionId": document.version.id,
                "sourceChecksum": document.version.source_checksum,
                "structuredTables": sum(
                    isinstance(block, dict) and block.get("kind") == "table"
                    for block in render_blocks
                ),
                "images": sum(_render_block_image_count(block) for block in render_blocks),
                "warnings": report.warnings,
            }
        )
    result = {
        "schemaVersion": 1,
        "planVersion": discovery_payload.get("version"),
        "builtAt": _utc_now(),
        "selected": len(selected),
        "documents": len(artifacts),
        "failures": failures,
        "artifacts": artifacts,
    }
    _write_json(output_root / "artifacts.json", result)
    if not artifacts:
        raise ValueError("No searchable clinical documents were built.")
    return result


def package_clinical_snapshot(
    plan_root: Path,
    build_root: Path,
    output_root: Path,
    *,
    snapshot_id: str,
    release_base_url: str,
    allow_partial: bool = False,
    force: bool = False,
) -> dict[str, object]:
    if not _SNAPSHOT_ID.fullmatch(snapshot_id):
        raise ValueError("Snapshot ID may contain lowercase letters, digits, dots and hyphens.")
    discovery: object = json.loads((plan_root / "discovery.json").read_text(encoding="utf-8"))
    build: object = json.loads((build_root / "artifacts.json").read_text(encoding="utf-8"))
    if not isinstance(discovery, dict) or not isinstance(discovery.get("recommendations"), list):
        raise ValueError("Clinical discovery index is invalid.")
    if not isinstance(build, dict) or not isinstance(build.get("artifacts"), list):
        raise ValueError("Clinical build artifact index is invalid.")
    recommendations = {
        cast(str, item["officialId"]): cast(dict[str, object], item)
        for item in discovery["recommendations"]
        if isinstance(item, dict) and isinstance(item.get("officialId"), str)
    }
    built = {
        cast(str, item["officialId"]): cast(dict[str, object], item)
        for item in build["artifacts"]
        if isinstance(item, dict) and isinstance(item.get("officialId"), str)
    }
    failures = {
        cast(str, item["officialId"]): cast(dict[str, object], item)
        for item in cast(list[object], build.get("failures", []))
        if isinstance(item, dict) and isinstance(item.get("officialId"), str)
    }
    missing = sorted(recommendations.keys() - built.keys())
    extra = sorted(built.keys() - recommendations.keys())
    if extra or (missing and not allow_partial):
        raise ValueError(
            "Snapshot requires one database per recommendation; "
            f"missing={missing[:10]}, extra={extra[:10]}."
        )
    if set(missing) != failures.keys():
        raise ValueError("Every unavailable recommendation must have an explicit build failure.")
    if not built:
        raise ValueError("Snapshot requires at least one built recommendation database.")
    target = output_root.resolve()
    if target.exists() and not force:
        raise FileExistsError(f"Clinical snapshot output already exists: {target}")
    temporary = target.with_name(f".{target.name}.tmp-{uuid.uuid4().hex}")
    temporary.mkdir(parents=True)
    published_at = _utc_now()
    release_url = release_base_url.rstrip("/")
    module_version = f"0.6.0-json.{_checksum(snapshot_id).removeprefix('sha256:')[:12]}"
    try:
        modules: list[dict[str, object]] = []
        snapshot_records: list[dict[str, object]] = []
        for official_id, artifact in built.items():
            recommendation = recommendations[official_id]
            source_database = Path(cast(str, artifact["database"]))
            if not source_database.is_file():
                raise FileNotFoundError(f"Built database is missing: {source_database}")
            database_name = f"clinical-{official_id}-{snapshot_id}.db"
            database_target = temporary / database_name
            shutil.copyfile(source_database, database_target)
            database_sha256 = _checksum_file(database_target)
            if database_sha256 != artifact["sha256"]:
                raise ValueError(f"{official_id}: database checksum changed before packaging.")
            source_set_payload = [
                {
                    "documentId": artifact["documentId"],
                    "documentVersionId": artifact["documentVersionId"],
                    "sourceChecksum": artifact["sourceChecksum"],
                    "status": "active",
                }
            ]
            source_set_digest = _checksum(source_set_payload)
            artifact_id = f"{artifact['moduleId']}-index-{module_version}"
            database_artifact = {
                "id": artifact_id,
                "kind": "index",
                "required": True,
                "url": f"{release_url}/{database_name}",
                "sha256": database_sha256,
                "sizeBytes": database_target.stat().st_size,
                "compression": "none",
                "sourceSetDigest": source_set_digest,
            }
            document = {
                "documentId": artifact["documentId"],
                "documentVersionId": artifact["documentVersionId"],
                "sourceChecksum": artifact["sourceChecksum"],
                "status": "active",
                "indexArtifactId": artifact_id,
                "sourceAssetArtifactId": None,
            }
            icd_codes = cast(list[str], recommendation.get("icd10Codes", []))
            age_categories = cast(list[str], recommendation.get("ageCategories", []))
            category_id = cast(str, recommendation["primaryCategoryId"])
            category_ids = cast(list[str], recommendation.get("categoryIds", []))
            modules.append(
                {
                    "id": artifact["moduleId"],
                    "version": module_version,
                    "kind": "clinical",
                    "collection": category_id,
                    "title": recommendation["title"],
                    "description": (
                        f"КР {official_id}. МКБ-10: {', '.join(icd_codes) or 'не указаны'}. "
                        f"Возраст: {', '.join(age_categories) or 'не указан'}."
                    ),
                    "required": False,
                    "releaseState": "published",
                    "specialties": recommendation["specialties"],
                    "populations": age_categories,
                    "tags": [
                        "individual-recommendation",
                        official_id,
                        *icd_codes,
                        *category_ids,
                    ],
                    "compatibility": {
                        "minAppVersion": "0.6.0",
                        "maxAppVersion": None,
                        "schemaVersion": 2,
                        "coreCatalogVersion": "1",
                    },
                    "sourceSetDigest": source_set_digest,
                    "dependencies": [
                        {
                            "moduleId": "minimed.core.ru",
                            "versionRange": "^1.0.0",
                            "required": True,
                        }
                    ],
                    "sizes": {
                        "downloadBytes": database_target.stat().st_size,
                        "installedBytes": database_target.stat().st_size,
                        "sourceAssetsDownloadBytes": None,
                        "precision": "exact",
                    },
                    "capabilities": {
                        "search": True,
                        "fullText": True,
                        "structuredTables": cast(int, artifact.get("structuredTables", 0)) > 0,
                        "images": cast(int, artifact.get("images", 0)) > 0,
                        "originalPdf": False,
                        "structuredKnowledge": False,
                        "calculations": False,
                    },
                    "artifacts": [database_artifact],
                    "documents": [document],
                    "previewDocumentCount": 1,
                }
            )
            snapshot_records.append(
                {
                    **recommendation,
                    "moduleVersion": module_version,
                    "databaseArtifact": database_artifact,
                    "document": document,
                }
            )

        categories = cast(list[dict[str, object]], discovery.get("categories", []))
        manifest = {
            "schemaVersion": 1,
            "snapshotId": snapshot_id,
            "publishedAt": published_at,
            "sourceCatalogChecksum": discovery["sourceCatalogChecksum"],
            "taxonomyChecksum": discovery["taxonomyChecksum"],
            "discoveryChecksum": _checksum(discovery),
            "recommendations": snapshot_records,
            "unavailableRecommendations": [
                {**recommendations[official_id], "buildFailure": failures[official_id]}
                for official_id in missing
            ],
            "categories": categories,
            "sourceArchives": [],
        }
        fragment = {
            "schemaVersion": 1,
            "snapshotId": snapshot_id,
            "publishedAt": published_at,
            "categories": categories,
            "modules": modules,
        }
        _write_json(temporary / "snapshot-manifest.json", manifest)
        _write_json(temporary / "catalog-fragment.json", fragment)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            shutil.rmtree(target)
        temporary.replace(target)
        return {
            "outputRoot": str(target),
            "snapshotId": snapshot_id,
            "recommendations": len(modules),
            "unavailableRecommendations": len(missing),
            "sourceArchives": 0,
            "assets": len(modules) + 2,
            "manifestChecksum": _checksum(manifest),
        }
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def _checksum_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"
