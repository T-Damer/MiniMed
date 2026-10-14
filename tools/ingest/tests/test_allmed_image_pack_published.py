"""Integrity of the published Allmed photo pack (the local release copy; skipped when absent).

The checksums come from the committed app catalog, the record of what the app downloads; the
build's `catalog-fragment.json` was only the intermediate merged into it (lost with output/ on
2026-10-14).
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path
from zipfile import ZipFile

import pytest

from localmed_ingest.allmed_images import shard_of

_REPOSITORY = Path(__file__).resolve().parents[3]
# A worktree lives under `<main>/.claude/worktrees/`; release copies stay in the main checkout.
_ROOT = _REPOSITORY if (_REPOSITORY / "output").exists() else _REPOSITORY.parents[2]
_PACK = _ROOT / "output" / "allmed-images-2026.10.13-c8e85a688094"
_CATALOG = _REPOSITORY / "apps" / "app" / "src" / "features" / "modules" / "catalog.preview.json"
_ALLMED = Path.home() / "Downloads" / "allmed_tinybase.db"
_PREFIX = "minimed.medications.packaging-images.ru"

pytestmark = pytest.mark.skipif(
    not _PACK.exists(), reason="The published Allmed photo pack copy is local-only."
)


def test_every_image_has_checksum_source_url_and_drug_link() -> None:
    catalog = json.loads(_CATALOG.read_text(encoding="utf-8"))
    module = next(m for m in catalog["modules"] if m["id"] == _PREFIX)
    artifacts = list(module["artifacts"])
    assert len(artifacts) == 17
    index = next(a for a in artifacts if "-index-" in a["id"])
    index_bytes = (_PACK / f"{_PREFIX}.db").read_bytes()
    assert index["sha256"] == f"sha256:{hashlib.sha256(index_bytes).hexdigest()}"
    shard_files = sorted(_PACK.glob(f"{_PREFIX}.source-assets-*.zip"))
    assert len(shard_files) == 16
    drug_ids: set[int] | None = None
    if _ALLMED.exists():
        with sqlite3.connect(f"file:{_ALLMED}?mode=ro", uri=True) as connection:
            drug_ids = {int(row[0]) for row in connection.execute("SELECT id FROM drugs")}
    images = 0
    for path in shard_files:
        shard = path.name.removeprefix(f"{_PREFIX}.source-assets-").removesuffix(".zip")
        artifact = next(a for a in artifacts if a["id"].endswith(f"-{shard}"))
        assert artifact["sha256"] == f"sha256:{hashlib.sha256(path.read_bytes()).hexdigest()}"
        with ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["fetchedAt"]
            assert sorted(archive.namelist()) == sorted(["manifest.json", *manifest["images"]])
            for reference, record in manifest["images"].items():
                assert shard_of(reference) == shard
                payload = archive.read(reference)
                assert record["size"] == len(payload)
                assert record["sha256"] == f"sha256:{hashlib.sha256(payload).hexdigest()}"
                assert record["sourceUrl"] == f"https://allmed.pro/{reference}"
                assert record["allmedIds"]
                if drug_ids is not None:
                    assert set(record["allmedIds"]) <= drug_ids
                images += 1
    assert images == 4214
