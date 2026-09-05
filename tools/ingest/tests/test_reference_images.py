from __future__ import annotations

import hashlib
import json
from pathlib import Path

from localmed_ingest.reference_images import build_reference_image_pack


def test_builds_document_keyed_static_assets(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    (raw / "records").mkdir(parents=True)
    (raw / "assets").mkdir()
    payload = b"reference image"
    asset = raw / "assets" / ("a" * 64 + ".jpg")
    asset.write_bytes(payload)
    source_url = "https://www.krasotaimedicina.ru/upload/iblock/a/a.jpg"
    (raw / "records" / "page.json").write_text(
        json.dumps(
            {
                "entityType": "disease",
                "url": "https://www.krasotaimedicina.ru/diseases/example",
                "title": "Пример",
                "images": [
                    {
                        "alt": "Схема",
                        "bytes": len(payload),
                        "path": f"assets/{asset.name}",
                        "sha256": hashlib.sha256(payload).hexdigest(),
                        "sourceUrl": source_url,
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    report = build_reference_image_pack(raw, tmp_path / "reference-images")
    output = tmp_path / "reference-images"
    manifest = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
    document_id = "krasotaimedicina.disease."
    document_id += hashlib.sha256(b"https://www.krasotaimedicina.ru/diseases/example").hexdigest()[
        :16
    ]
    image = manifest["images"][document_id][0]
    assert image["sourceUrl"] == source_url
    assert image["path"] == f"assets/{hashlib.sha256(payload).hexdigest()}.jpg"
    assert (output / image["path"]).read_bytes() == payload
    assert image["sha256"] == f"sha256:{hashlib.sha256(payload).hexdigest()}"
    assert report["documentCount"] == 1
    assert report["imageCount"] == 1
    assert report["assetCount"] == 1
    assert "zip" not in report


def test_rejects_an_asset_path_outside_the_crawl_assets_root(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    (raw / "records").mkdir(parents=True)
    (raw / "assets").mkdir()
    (raw / "records" / "page.json").write_text(
        json.dumps(
            {
                "entityType": "disease",
                "url": "https://www.krasotaimedicina.ru/diseases/example",
                "images": [
                    {
                        "bytes": 1,
                        "path": "../secret.jpg",
                        "sha256": "0" * 64,
                        "sourceUrl": "https://www.krasotaimedicina.ru/upload/a.jpg",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    try:
        build_reference_image_pack(raw, tmp_path / "reference-images")
    except ValueError as error:
        assert "escapes assets" in str(error)
    else:
        raise AssertionError("Expected an escaping source asset path to be rejected")
