from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import cast

import yaml

from localmed_ingest.clinical_catalog import (
    build_clinical_coverage_ledger,
    write_clinical_coverage_ledger,
)
from localmed_ingest.clinical_source_plan import (
    build_clinical_source_plan,
    package_clinical_snapshot,
)
from localmed_ingest.source_registry import load_source_registry
from localmed_ingest.source_sync import load_sync_manifest


def test_builds_versioned_mirror_plan_and_individual_registries(tmp_path: Path) -> None:
    source = tmp_path / "catalog.json"
    source.write_text(
        json.dumps(
            [
                {
                    "id": "714_2",
                    "name": "Внебольничная пневмония у детей",
                    "version": "714_2-2025",
                    "mkb10": ["J18"],
                    "ageCategory": "Дети",
                    "applicationStatus": "Применяется",
                    "officialUrl": "https://cr.minzdrav.gov.ru/preview-cr/714_2",
                },
                {
                    "id": "53_2",
                    "name": "Аневризмы брюшной аорты",
                    "version": "53_2-2025",
                    "mkb10": ["I71.4"],
                    "ageCategory": "Взрослые",
                    "applicationStatus": "Применяется",
                    "officialUrl": "https://cr.minzdrav.gov.ru/preview-cr/53_2",
                },
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    repository_root = Path(__file__).resolve().parents[3]
    ledger = build_clinical_coverage_ledger(
        source,
        repository_root / "content" / "clinical-module-taxonomy.yaml",
        generated_at="2026-07-24T00:00:00Z",
    )
    ledger_path = tmp_path / "ledger.json"
    write_clinical_coverage_ledger(ledger, ledger_path)

    output = tmp_path / "plan"
    report = build_clinical_source_plan(
        ledger_path,
        output,
        version="0.5.0-test.1",
        generated_at="2026-07-24T01:00:00Z",
    )

    assert report["recommendations"] == 2
    sync_manifest = load_sync_manifest(output / "sources.yaml")
    assert {source.target for source in sync_manifest.sources} == {"714_2.pdf", "53_2.pdf"}
    pneumonia = next(source for source in sync_manifest.sources if source.target == "714_2.pdf")
    assert pneumonia.location.endswith("GetClinrecPdf&id=714_2")

    registry = load_source_registry(output / "registries" / "714_2.yaml")
    assert registry.pack.id == "minimed.clinical.recommendation.714_2"
    assert registry.sources[0].id == "kr.rf.714_2"
    assert registry.sources[0].metadata["sourceCatalogChecksum"] == ledger.source_checksum

    discovery = yaml.safe_load((output / "discovery.json").read_text(encoding="utf-8"))
    recommendation = next(
        item for item in discovery["recommendations"] if item["officialId"] == "714_2"
    )
    assert recommendation["primaryCategoryId"] == "minimed.clinical.respiratory-allergy.ru"
    assert recommendation["downloadModuleId"] == "minimed.clinical.recommendation.714_2"
    assert recommendation["rights"] == "unknown"

    source_root = tmp_path / "sources"
    build_root = tmp_path / "build"
    source_root.mkdir()
    (build_root / "databases").mkdir(parents=True)
    artifacts = []
    for item in discovery["recommendations"]:
        official_id = item["officialId"]
        database = build_root / "databases" / f"{official_id}.db"
        database.write_bytes(f"database:{official_id}".encode())
        (source_root / f"{official_id}.pdf").write_bytes(f"%PDF:{official_id}".encode())
        artifacts.append(
            {
                "officialId": official_id,
                "moduleId": item["downloadModuleId"],
                "categoryIds": item["categoryIds"],
                "database": str(database),
                "bytes": database.stat().st_size,
                "sha256": f"sha256:{hashlib.sha256(database.read_bytes()).hexdigest()}",
                "documentId": item["recordId"],
                "documentVersionId": f"{item['recordId']}@test",
                "sourceChecksum": f"sha256:{'0' * 64}",
                "warnings": [],
            }
        )
    (build_root / "artifacts.json").write_text(
        json.dumps({"artifacts": artifacts}, ensure_ascii=False),
        encoding="utf-8",
    )
    snapshot = tmp_path / "snapshot"
    snapshot_report = package_clinical_snapshot(
        output,
        build_root,
        source_root,
        snapshot,
        snapshot_id="clinical-test-1",
        release_base_url="https://example.test/releases/download/clinical-test-1",
    )
    fragment = json.loads((snapshot / "catalog-fragment.json").read_text(encoding="utf-8"))

    assert snapshot_report["recommendations"] == 2
    assert snapshot_report["assets"] == 2 + cast(int, snapshot_report["sourceArchives"]) + 2
    assert len(fragment["modules"]) == 2
    assert all(
        module["artifacts"][0]["url"].startswith(
            "https://example.test/releases/download/clinical-test-1/"
        )
        for module in fragment["modules"]
    )
