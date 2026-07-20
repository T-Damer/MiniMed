from __future__ import annotations

import json
from pathlib import Path

import yaml

from localmed_ingest.drug_sources import collect_drug_sources


def test_drug_collection_is_rights_aware_and_uses_existing_sync_layer(
    tmp_path: Path,
) -> None:
    input_root = tmp_path / "input"
    input_root.mkdir()
    (input_root / "licensed.txt").write_text("licensed export", encoding="utf-8")
    catalog = tmp_path / "catalog.yaml"
    catalog.write_text(
        yaml.safe_dump(
            {
                "schemaVersion": 1,
                "sources": [
                    {
                        "id": "licensed.local",
                        "title": "Licensed local export",
                        "acquisition": "local-export",
                        "location": "licensed.txt",
                        "target": "licensed/source.txt",
                        "contentType": "text",
                        "enabled": True,
                        "categories": ["drug-labels"],
                        "rights": {
                            "owner": "Vendor",
                            "licenseId": "contract-1",
                            "allowsOfflineStorage": True,
                            "allowsDerivativeProcessing": True,
                            "allowsRedistribution": False,
                        },
                    },
                    {
                        "id": "vendor.manual",
                        "title": "Vendor export pending",
                        "acquisition": "vendor-export",
                        "enabled": True,
                        "rights": {
                            "owner": "Vendor",
                            "licenseId": "pending",
                            "allowsOfflineStorage": True,
                            "allowsDerivativeProcessing": False,
                            "allowsRedistribution": False,
                        },
                    },
                    {
                        "id": "blocked.ui",
                        "title": "Public UI without offline rights",
                        "acquisition": "manual",
                        "enabled": True,
                        "rights": {
                            "owner": "Publisher",
                            "licenseId": "website-terms",
                            "allowsOfflineStorage": False,
                            "allowsDerivativeProcessing": False,
                            "allowsRedistribution": False,
                        },
                    },
                    {
                        "id": "future.disabled",
                        "title": "Future source",
                        "acquisition": "manual",
                        "enabled": False,
                        "rights": {
                            "owner": "Unknown",
                            "licenseId": "not-reviewed",
                            "allowsOfflineStorage": False,
                            "allowsDerivativeProcessing": False,
                            "allowsRedistribution": False,
                        },
                    },
                ],
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    output_root = tmp_path / "collected"
    report = collect_drug_sources(
        catalog,
        output_root,
        tmp_path / "cache",
        input_root=input_root,
    )
    assert report.synced == 1
    assert report.manual_required == 1
    assert report.blocked_by_rights == 1
    assert report.disabled == 1
    assert (output_root / "licensed/source.txt").read_text(encoding="utf-8") == "licensed export"
    provenance = json.loads((output_root / "source-provenance.json").read_text(encoding="utf-8"))
    assert provenance["sources"][0]["rights"]["allowsDerivativeProcessing"] is True
    blocked = next(item for item in report.sources if item.id == "blocked.ui")
    assert blocked.status == "blocked-by-rights"
