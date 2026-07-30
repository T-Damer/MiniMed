from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from localmed_ingest.builder import build_content_pack, load_content_pack
from localmed_ingest.edition_manifest import (
    EditionManifest,
    build_edition_manifest,
    validate_edition_manifest,
)
from localmed_ingest.models import SourceRegistry
from localmed_ingest.source_registry import prepare_registry


def published_registry(rights_status: str) -> dict[str, object]:
    return {
        "pack": {
            "id": "localmed.test.edition",
            "version": "1",
            "schemaVersion": 2,
            "title": "Edition test",
            "builtAt": "2026-07-29T00:00:00Z",
            "publicationState": "published",
        },
        "sources": [
            {
                "id": "label.test",
                "path": "label.txt",
                "title": "Тестовая инструкция",
                "versionLabel": "1",
                "sourceType": "official_drug_instruction",
                "status": "active",
                "provenance": {
                    "sourceId": "official-label.test",
                    "publisher": "Тестовый регулятор",
                    "officialLocator": "https://example.test/label",
                    "jurisdiction": "RU",
                    "rightsStatus": rights_status,
                    "rights": {
                        "owner": "Тестовый регулятор",
                        "licenseId": "test-license",
                        "allowsOfflineStorage": True,
                        "allowsDerivativeProcessing": False,
                        "allowsRedistribution": True,
                    },
                },
            }
        ],
    }


@pytest.mark.parametrize("rights_status", ["unknown", "revoked"])
def test_published_registry_rejects_unknown_or_revoked_rights(rights_status: str) -> None:
    with pytest.raises(ValueError, match="rights are"):
        SourceRegistry.model_validate(published_registry(rights_status))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sourceId", ""),
        ("publisher", " "),
        ("officialLocator", ""),
        ("jurisdiction", " "),
        ("owner", ""),
        ("licenseId", " "),
    ],
)
def test_published_registry_rejects_blank_provenance_identifiers(
    field: str,
    value: str,
) -> None:
    payload = published_registry("verified")
    sources = payload["sources"]
    assert isinstance(sources, list)
    source = sources[0]
    assert isinstance(source, dict)
    provenance = source["provenance"]
    assert isinstance(provenance, dict)
    target = provenance["rights"] if field in {"owner", "licenseId"} else provenance
    assert isinstance(target, dict)
    target[field] = value

    with pytest.raises(ValueError, match="must not be blank"):
        SourceRegistry.model_validate(payload)


def test_published_manifest_rejects_a_mismatched_source_checksum(tmp_path: Path) -> None:
    source_root = tmp_path / "raw"
    source_root.mkdir()
    (source_root / "label.txt").write_text(
        "# Противопоказания\n\nГиперчувствительность.\n",
        encoding="utf-8",
    )
    registry_path = tmp_path / "registry.yaml"
    registry_path.write_text(
        yaml.safe_dump(published_registry("verified"), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    prepared = tmp_path / "prepared"
    prepare_registry(registry_path, source_root, prepared)
    database = tmp_path / "core.db"
    pack, _ = build_content_pack(prepared, database)
    manifest = build_edition_manifest(pack, database)
    manifest.sources[0].source_checksum = "sha256:" + "0" * 64

    with pytest.raises(ValueError, match="source set"):
        validate_edition_manifest(manifest, pack, database, require_published=True)


def test_published_build_rejects_missing_provenance(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "manifest.yaml").write_text(
        """id: localmed.test.published
version: '1'
schemaVersion: 2
title: Published test
builtAt: '2026-07-29T00:00:00Z'
publicationState: published
""",
        encoding="utf-8",
    )
    (workspace / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
    (workspace / "label.md").write_text(
        """---
id: label.test
title: Тестовая инструкция
version_label: '1'
source_type: official_drug_instruction
status: active
source_checksum: sha256:test
---

# Противопоказания

Гиперчувствительность.
""",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="no typed provenance"):
        build_content_pack(workspace, tmp_path / "core.db")


def test_local_development_pack_cannot_validate_as_published(tmp_path: Path) -> None:
    workspace = Path(__file__).resolve().parents[3] / "content/fixtures"
    database = tmp_path / "core.db"
    manifest_path = tmp_path / "edition-manifest.json"
    build_content_pack(workspace, database, edition_manifest_output=manifest_path)
    pack = load_content_pack(workspace)
    manifest = EditionManifest.model_validate(json.loads(manifest_path.read_text(encoding="utf-8")))

    assert manifest.publishability == "local-dev"
    with pytest.raises(ValueError, match="cannot activate as published"):
        validate_edition_manifest(manifest, pack, database, require_published=True)
