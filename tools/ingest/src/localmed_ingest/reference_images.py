from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

REFERENCE_SOURCE_URL = "https://www.krasotaimedicina.ru"
REFERENCE_MODULE_ID = "minimed.mkb.ru"
_IMAGE_SUFFIXES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
}
ImageRecord = dict[str, str | int]


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _document_id(url: str) -> str:
    return f"krasotaimedicina.disease.{_sha256(url.encode())[:16]}"


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def _record(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected record object: {path}")
    return cast(dict[str, object], value)


def build_reference_image_pack(raw_root: Path, output: Path) -> dict[str, object]:
    records_root = raw_root / "records"
    assets_root = raw_root.resolve() / "assets"
    if not records_root.is_dir() or not assets_root.is_dir():
        raise ValueError(f"Expected crawl records and assets under {raw_root}")

    images_by_document: dict[str, list[ImageRecord]] = {}
    failures_by_document: dict[str, list[ImageRecord]] = {}
    files_by_asset_path: dict[str, Path] = {}
    for record_path in sorted(records_root.glob("*.json")):
        record = _record(record_path)
        if record.get("entityType") != "disease":
            continue
        url = record.get("url")
        if not isinstance(url, str) or not url.strip():
            raise ValueError(f"{record_path}: disease record has no URL")
        document_id = _document_id(url)
        raw_images = record.get("images", [])
        if not isinstance(raw_images, list):
            raise ValueError(f"{record_path}: images must be a list")
        for image_value in cast(list[object], raw_images):
            if not isinstance(image_value, dict):
                raise ValueError(f"{record_path}: image record must be an object")
            image = cast(dict[str, object], image_value)
            source_path = image.get("path")
            source_url = image.get("sourceUrl")
            expected_sha = image.get("sha256")
            expected_size = image.get("bytes")
            if source_path is None and isinstance(source_url, str) and image.get("error"):
                failures_by_document.setdefault(document_id, []).append(
                    {
                        "sourceUrl": source_url,
                        "error": str(image["error"]),
                    }
                )
                continue
            if (
                not isinstance(source_path, str)
                or not source_path
                or not isinstance(source_url, str)
                or not source_url
                or not isinstance(expected_sha, str)
                or not expected_sha
            ):
                raise ValueError(f"{record_path}: image metadata is incomplete")
            parsed_source_url = urlsplit(source_url)
            if (
                parsed_source_url.scheme != "https"
                or parsed_source_url.netloc != "www.krasotaimedicina.ru"
                or not parsed_source_url.path.startswith("/upload/")
                or parsed_source_url.query
                or parsed_source_url.fragment
            ):
                raise ValueError(f"{record_path}: image source URL is outside the source scope")
            if not isinstance(expected_size, int) or expected_size < 1:
                raise ValueError(f"{record_path}: image byte count is invalid")
            source = (raw_root / source_path).resolve()
            try:
                source.relative_to(assets_root)
            except ValueError as error:
                raise ValueError(
                    f"{record_path}: image path escapes assets: {source_path}"
                ) from error
            payload = source.read_bytes()
            actual_sha = _sha256(payload)
            if len(payload) != expected_size or actual_sha != expected_sha:
                raise ValueError(f"{record_path}: image checksum or size mismatch: {source_path}")
            suffix = source.suffix.casefold()
            content_type = _IMAGE_SUFFIXES.get(suffix)
            if content_type is None:
                raise ValueError(f"{record_path}: unsupported image suffix: {suffix}")
            asset_path = f"assets/{actual_sha}{suffix}"
            files_by_asset_path[asset_path] = source
            images_by_document.setdefault(document_id, []).append(
                {
                    "alt": str(image.get("alt") or record.get("title") or "Иллюстрация").strip(),
                    "contentType": content_type,
                    "path": asset_path,
                    "sha256": f"sha256:{actual_sha}",
                    "size": len(payload),
                    "sourceUrl": source_url,
                }
            )

    images = {
        document_id: sorted(
            entries, key=lambda entry: (str(entry["sourceUrl"]), str(entry["path"]))
        )
        for document_id, entries in sorted(images_by_document.items())
    }
    manifest: dict[str, object] = {
        "schemaVersion": 1,
        "sourceUrl": REFERENCE_SOURCE_URL,
        "sourceKind": "disease-reference",
        "documentCount": len(images),
        "imageCount": sum(len(entries) for entries in images.values()),
        "totalBytes": sum(int(entry["size"]) for entries in images.values() for entry in entries),
        "images": images,
        "failures": failures_by_document,
    }
    output.mkdir(parents=True, exist_ok=True)
    manifest_path = output / "manifest.json"
    _write_json(manifest_path, manifest)
    manifest_bytes = manifest_path.read_bytes()
    for asset_path, source in sorted(files_by_asset_path.items()):
        destination = output / asset_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.tmp-{os.getpid()}")
        shutil.copyfile(source, temporary)
        temporary.replace(destination)
    report: dict[str, object] = {
        "output": str(output),
        "moduleId": REFERENCE_MODULE_ID,
        "artifactKind": "static-reference-images",
        "manifest": str(manifest_path),
        "assets": str(output / "assets"),
        "documentCount": len(images),
        "imageCount": sum(len(entries) for entries in images.values()),
        "failureCount": sum(len(entries) for entries in failures_by_document.values()),
        "assetCount": len(files_by_asset_path),
        "assetBytes": sum(source.stat().st_size for source in files_by_asset_path.values()),
        "manifestSha256": f"sha256:{_sha256(manifest_bytes)}",
        "manifestSizeBytes": len(manifest_bytes),
    }
    _write_json(output / "build-report.json", report)
    return report


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Build the offline Krasotaimedicina image pack")
    parser.add_argument("raw_root", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    print(
        json.dumps(
            build_reference_image_pack(arguments.raw_root, arguments.output),
            ensure_ascii=False,
            indent=2,
        )
    )
