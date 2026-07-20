from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Literal

import yaml
from pydantic import Field, model_validator

from .models import CamelModel
from .source_sync import SourceSyncReport, sync_source_manifest

AcquisitionMode = Literal["https", "local-export", "manual", "vendor-export"]
CollectionStatus = Literal[
    "synced",
    "manual-required",
    "disabled",
    "blocked-by-rights",
]


class SourceRights(CamelModel):
    owner: str
    license_id: str
    allows_offline_storage: bool = False
    allows_derivative_processing: bool = False
    allows_redistribution: bool = False
    attribution: str | None = None
    expires_at: str | None = None
    notes: str | None = None


class DrugSourceSpec(CamelModel):
    id: str
    title: str
    acquisition: AcquisitionMode
    location: str | None = None
    target: str | None = None
    content_type: Literal["auto", "pdf", "text", "markdown"] = "auto"
    sha256: str | None = None
    max_bytes: int = Field(default=100 * 1024 * 1024, gt=0)
    enabled: bool = False
    jurisdiction: str = "RU"
    categories: list[str] = Field(default_factory=list)
    update_cadence: str | None = None
    rights: SourceRights
    metadata: dict[str, object] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_acquisition(self) -> DrugSourceSpec:
        if (
            self.enabled
            and self.acquisition in {"https", "local-export"}
            and (not self.location or not self.target)
        ):
            raise ValueError(f"Enabled source {self.id} requires both location and target.")
        if (
            self.acquisition == "https"
            and self.location
            and not self.location.startswith("https://")
        ):
            raise ValueError(f"HTTPS source {self.id} must use an https:// location.")
        return self


class DrugSourceCatalog(CamelModel):
    schema_version: int = Field(default=1, ge=1)
    sources: list[DrugSourceSpec] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_sources(self) -> DrugSourceCatalog:
        identifiers = [source.id for source in self.sources]
        if len(identifiers) != len(set(identifiers)):
            raise ValueError("Drug source catalog contains duplicate source ids.")
        targets = [source.target for source in self.sources if source.target]
        if len(targets) != len(set(targets)):
            raise ValueError("Drug source catalog contains duplicate target paths.")
        return self


class CollectedDrugSource(CamelModel):
    id: str
    title: str
    status: CollectionStatus
    jurisdiction: str
    categories: list[str]
    target: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    sync_status: str | None = None
    allows_ai_processing: bool
    allows_redistribution: bool
    action: str | None = None
    warning: str | None = None


class DrugCollectionReport(CamelModel):
    schema_version: int = 1
    synced: int
    manual_required: int
    disabled: int
    blocked_by_rights: int
    sources: list[CollectedDrugSource]


def load_drug_source_catalog(path: Path) -> DrugSourceCatalog:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Drug source catalog must be a YAML mapping.")
    return DrugSourceCatalog.model_validate(payload)


def _sync_manifest_payload(sources: list[DrugSourceSpec]) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    for source in sources:
        if source.location is None or source.target is None:
            raise ValueError(f"Syncable source {source.id} requires location and target.")
        rows.append(
            {
                "id": source.id,
                "location": source.location,
                "target": source.target,
                "content_type": source.content_type,
                "sha256": source.sha256,
                "max_bytes": source.max_bytes,
            }
        )
    return {"version": 1, "sources": rows}


def collect_drug_sources(
    catalog_path: Path,
    output_root: Path,
    cache_root: Path,
    *,
    input_root: Path | None = None,
    force_refresh: bool = False,
    offline: bool = False,
    timeout_seconds: float = 60.0,
    report_path: Path | None = None,
) -> DrugCollectionReport:
    catalog = load_drug_source_catalog(catalog_path)
    syncable: list[DrugSourceSpec] = []
    results: dict[str, CollectedDrugSource] = {}

    for source in catalog.sources:
        if not source.enabled:
            results[source.id] = CollectedDrugSource(
                id=source.id,
                title=source.title,
                status="disabled",
                jurisdiction=source.jurisdiction,
                categories=source.categories,
                target=source.target,
                allows_ai_processing=source.rights.allows_derivative_processing,
                allows_redistribution=source.rights.allows_redistribution,
                action="Enable only after location and licence terms have been verified.",
            )
            continue
        if not source.rights.allows_offline_storage:
            results[source.id] = CollectedDrugSource(
                id=source.id,
                title=source.title,
                status="blocked-by-rights",
                jurisdiction=source.jurisdiction,
                categories=source.categories,
                target=source.target,
                allows_ai_processing=source.rights.allows_derivative_processing,
                allows_redistribution=source.rights.allows_redistribution,
                action="Obtain terms that explicitly permit offline storage before collection.",
            )
            continue
        if source.acquisition in {"manual", "vendor-export"}:
            results[source.id] = CollectedDrugSource(
                id=source.id,
                title=source.title,
                status="manual-required",
                jurisdiction=source.jurisdiction,
                categories=source.categories,
                target=source.target,
                allows_ai_processing=source.rights.allows_derivative_processing,
                allows_redistribution=source.rights.allows_redistribution,
                action=(
                    "Place the licensed export below input-root and switch acquisition to "
                    "local-export; do not scrape the public UI."
                ),
            )
            continue
        syncable.append(source)

    sync_report: SourceSyncReport | None = None
    if syncable:
        with tempfile.TemporaryDirectory(prefix="minimed-drug-sources-") as temporary:
            manifest_path = Path(temporary) / "sync.yaml"
            manifest_path.write_text(
                yaml.safe_dump(
                    _sync_manifest_payload(syncable),
                    allow_unicode=True,
                    sort_keys=False,
                ),
                encoding="utf-8",
            )
            sync_report = sync_source_manifest(
                manifest_path,
                output_root,
                cache_root,
                input_root=input_root or catalog_path.parent,
                force_refresh=force_refresh,
                offline=offline,
                timeout_seconds=timeout_seconds,
            )
        synced_by_id = {source.id: source for source in sync_report.sources}
        for source in syncable:
            synced = synced_by_id[source.id]
            results[source.id] = CollectedDrugSource(
                id=source.id,
                title=source.title,
                status="synced",
                jurisdiction=source.jurisdiction,
                categories=source.categories,
                target=source.target,
                sha256=synced.sha256,
                bytes=synced.bytes,
                sync_status=synced.status,
                allows_ai_processing=source.rights.allows_derivative_processing,
                allows_redistribution=source.rights.allows_redistribution,
                warning=synced.warning,
            )

    ordered = [results[source.id] for source in catalog.sources]
    report = DrugCollectionReport(
        synced=sum(item.status == "synced" for item in ordered),
        manual_required=sum(item.status == "manual-required" for item in ordered),
        disabled=sum(item.status == "disabled" for item in ordered),
        blocked_by_rights=sum(item.status == "blocked-by-rights" for item in ordered),
        sources=ordered,
    )

    output_root.mkdir(parents=True, exist_ok=True)
    provenance = {
        "catalog": str(catalog_path),
        "sources": [
            {
                "id": source.id,
                "title": source.title,
                "acquisition": source.acquisition,
                "jurisdiction": source.jurisdiction,
                "categories": source.categories,
                "target": source.target,
                "rights": source.rights.model_dump(by_alias=True, mode="json"),
                "result": results[source.id].model_dump(by_alias=True, mode="json"),
                "metadata": source.metadata,
            }
            for source in catalog.sources
        ],
        "syncReport": sync_report.model_dump(mode="json") if sync_report else None,
    }
    (output_root / "source-provenance.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(
                report.model_dump(by_alias=True, mode="json"),
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    return report
