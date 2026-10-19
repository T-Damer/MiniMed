"""Package the herbal book («Травник») as two optional modules.

* ``minimed.reference.herbal`` — the chapters (ГРЛС text, EMA facts with quotes, plate records and
  thumbnails) as one gzip-transported SQLite pack; its exact document membership is listed in the
  catalog entry;
* ``minimed.reference.herbal.plates`` — the botanical plates: a tiny index pack (one credits page)
  and one STORED ZIP of JPEG plates (``source-assets``), so «Скачать всё» can leave the images out.

No discovery-core pointer targets these documents, so there is no core membership check.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
import tempfile
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit
from zipfile import ZIP_STORED, ZipFile, ZipInfo

import yaml

from .builder import build_content_pack
from .herbal_plants import PLATE_BOOKS, PLATE_LICENCES, load_plants
from .herbal_prepare import DOCUMENT_PREFIX, RIGHTS_STATUS, SOURCE_TYPE, plate_jpeg
from .module_distribution import (
    RELEASE_BASE_URL,
    ModuleDescriptor,
    json_object,
    package_module,
    read_pack_membership,
    require_publication_decision,
    required_text,
    sha256_file,
    source_set_digest,
)

MODULE_ID = "minimed.reference.herbal"
PLATES_MODULE_ID = "minimed.reference.herbal.plates"
COLLECTION = "herbal"
TITLE = "Травник"
PLATES_TITLE = "Травник: иллюстрации"
PLATES_DOCUMENT_ID = "herbal.plates"
PLATES_MANIFEST = "manifest.json"
GRLS_HOSTS = frozenset({"grls.rosminzdrav.ru", "pharmacopoeia.regmed.ru"})
DESCRIPTION = (
    "Лекарственные растения: как заварить и принимать, кому нельзя, действие и состав, побочное "
    "действие, безопасность. Тексты инструкций ГРЛС на лекарственное растительное сырьё, "
    "ограничения и дозы монографий EMA/HMPC и ВОЗ, безопасность по NCCIH, LactMed, LiverTox и "
    "ТР ТС 021/2011 (русские поля с английской цитатой источника), правила ГФ XV для настоев и "
    "отваров. Для самообразования; не заменяет врача."
)
PLATES_DESCRIPTION = (
    "Ботанические таблицы к «Травнику» из изданий XIX — начала XX века (Köhler, Thomé, Sturm, "
    "Lindman), общественное достояние; рисунок женьшеня предоставил владелец приложения."
)


def package_herbal_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
) -> dict[str, object]:
    plants: list[str] = []

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        if metadata.get("rightsStatus") != RIGHTS_STATUS:
            raise ValueError(f"{document_id}: rights status is not {RIGHTS_STATUS}")
        require_publication_decision(document_id, metadata)
        herbal = json_object(metadata.get("herbal"), f"{document_id} herbal")
        if "guide" in herbal:
            url = required_text(metadata.get("officialSourceUrl"), f"{document_id} source URL")
            if urlsplit(url).netloc not in GRLS_HOSTS:
                raise ValueError(f"{document_id}: source URL {url} is not official")
            return
        plants.append(required_text(herbal.get("plantId"), f"{document_id} plantId"))
        plate = herbal.get("plate")
        if (
            plate is not None
            and json_object(plate, f"{document_id} plate").get("licence") not in PLATE_LICENCES
        ):
            raise ValueError(f"{document_id}: plate is neither public domain nor owner-supplied")
        grls = herbal.get("grls")
        ema = json_object(herbal.get("ema"), f"{document_id} ema")
        if grls is None and not ema.get("extracted"):
            raise ValueError(f"{document_id}: neither a ГРЛС instruction nor EMA facts")
        if grls is not None:
            url = required_text(
                json_object(grls, f"{document_id} grls").get("officialSourceUrl"),
                f"{document_id} ГРЛС URL",
            )
            if urlsplit(url).netloc not in GRLS_HOSTS:
                raise ValueError(f"{document_id}: ГРЛС URL {url} is not official")

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"reference-herbal-{version}",
            file_stem=MODULE_ID,
            title=TITLE,
            tags=("herbal", "phytotherapy", "reference"),
            release_state="published",
            collection=COLLECTION,
            list_documents=True,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=DESCRIPTION,
        report_extra={"sourceType": SOURCE_TYPE, "plants": sorted(plants)},
    )


def _zip_info(name: str) -> ZipInfo:
    info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_STORED
    info.create_system = 3
    info.external_attr = 0o644 << 16
    return info


def _credits_markdown(
    version: str, manifest_sha256: str, images: dict[str, dict[str, object]]
) -> str:
    front = {
        "id": PLATES_DOCUMENT_ID,
        "title": PLATES_TITLE,
        "short_title": "Иллюстрации",
        "version_label": version,
        "source_type": "herbal_plates",
        "status": "active",
        "source_file": "https://commons.wikimedia.org/",
        "source_checksum": manifest_sha256,
        "metadata": {
            "contentMode": "herbal-plates",
            "sourceManifest": PLATES_MANIFEST,
            "sourceManifestSha256": manifest_sha256,
            "imageCount": len(images),
            "rightsStatus": "public-domain",
            "publicationState": "experimental-preview",
            "requiresReview": True,
        },
    }
    lines = [
        f"- {item['plantRu']}: {item['artist'] or item['book']}, {item['date'] or ''} — "
        f"{item['licence']} ({item['commonsPage']})"
        for item in images.values()
    ]
    body = "\n".join(lines)
    dumped = yaml.safe_dump(front, allow_unicode=True, sort_keys=False, width=1_000_000)
    marker = '<!-- localmed:source {"contentMode":"editorial-note"} -->'
    return f"---\n{dumped}---\n\n# {PLATES_TITLE}\n\n{marker}\n\n{body}\n"


def package_herbal_plates(
    plants_path: Path,
    raw_root: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
) -> dict[str, object]:
    """Write the plates ZIP, its index pack and the catalog entry of the plates module."""
    plants = load_plants(plants_path)
    raw_manifest = cast(
        "dict[str, object]", json.loads((raw_root / "MANIFEST.json").read_text(encoding="utf-8"))
    )
    plates = cast("dict[str, dict[str, object]]", raw_manifest["plates"])
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{PLATES_MODULE_ID}.{version}"
    images: dict[str, dict[str, object]] = {}
    encoded: dict[str, bytes] = {}
    for plant in plants:
        if plant.plate is None:
            continue
        record = plates[plant.id]
        if record.get("licence") not in PLATE_LICENCES:
            raise ValueError(f"{plant.id}: plate licence is {record.get('licence')}")
        data = plate_jpeg(raw_root / str(record["path"]))
        name = f"plates/{plant.id}.jpg"
        encoded[name] = data
        images[name] = {
            "plantId": plant.id,
            "plantRu": plant.ru,
            "contentType": "image/jpeg",
            "sha256": "sha256:" + hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "book": PLATE_BOOKS[plant.plate.book],
            "artist": record.get("artist"),
            "date": record.get("date"),
            "licence": record.get("licence"),
            "commonsPage": record.get("commonsPage"),
            "sourceSha1": record.get("originalSha1"),
        }
    manifest_bytes = (
        json.dumps(
            {
                "schemaVersion": 1,
                "moduleId": PLATES_MODULE_ID,
                "version": version,
                "images": images,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")
    manifest_sha256 = "sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
    archive = output_dir / f"{stem}.source-assets.zip"
    with ZipFile(archive, "w", compression=ZIP_STORED) as zip_file:
        zip_file.writestr(_zip_info(PLATES_MANIFEST), manifest_bytes)
        for name, data in encoded.items():
            zip_file.writestr(_zip_info(name), data)
    with tempfile.TemporaryDirectory(prefix=".herbal-plates.", dir=output_dir) as temporary:
        workspace = Path(temporary) / "workspace"
        workspace.mkdir()
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(
                {
                    "id": "minimed.herbal.plates",
                    "version": version,
                    "schemaVersion": 2,
                    "title": PLATES_TITLE,
                    "builtAt": str(raw_manifest.get("updatedAt")),
                    "publicationState": "local-dev",
                },
                allow_unicode=True,
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        (workspace / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
        (workspace / f"{PLATES_DOCUMENT_ID}.md").write_text(
            _credits_markdown(version, manifest_sha256, images), encoding="utf-8"
        )
        database = Path(temporary) / "plates.db"
        build_content_pack(workspace, database, include_embeddings=False, compact_search_text=True)
        index = output_dir / f"{stem}.db.gz"
        with (
            database.open("rb") as source,
            gzip.GzipFile(filename="", mode="wb", fileobj=index.open("wb"), mtime=0) as target,
        ):
            shutil.copyfileobj(source, target)
        decoded_sha256 = sha256_file(database)
        decoded_size = database.stat().st_size
    document: dict[str, object] = {
        "documentId": PLATES_DOCUMENT_ID,
        "documentVersionId": f"{PLATES_DOCUMENT_ID}@{version}",
        "sourceChecksum": manifest_sha256,
        "status": "active",
    }
    digest = source_set_digest([document])
    index_id = f"{PLATES_MODULE_ID}-index-{version}"
    assets_id = f"{PLATES_MODULE_ID}-source-assets-{version}"
    release_tag = f"reference-herbal-{version}"
    archive_size = archive.stat().st_size
    index_size = index.stat().st_size
    entry: dict[str, object] = {
        "id": PLATES_MODULE_ID,
        "version": version,
        "kind": "reference",
        "collection": COLLECTION,
        "title": PLATES_TITLE,
        "description": PLATES_DESCRIPTION,
        "required": False,
        "releaseState": "published",
        "specialties": [],
        "populations": [],
        "tags": ["herbal", "herbal-plates", "images"],
        "compatibility": {
            "minAppVersion": min_app_version,
            "maxAppVersion": None,
            "schemaVersion": 2,
            "coreCatalogVersion": "1",
        },
        "sourceSetDigest": digest,
        # The plates only illustrate the chapters; installing them alone is harmless.
        "dependencies": [],
        "sizes": {
            "downloadBytes": index_size + archive_size,
            "installedBytes": decoded_size + archive_size,
            "sourceAssetsDownloadBytes": archive_size,
            "precision": "exact",
        },
        "capabilities": {
            "search": False,
            "fullText": False,
            "structuredTables": False,
            "images": True,
            "originalPdf": False,
            "structuredKnowledge": False,
            "calculations": False,
        },
        "artifacts": [
            {
                "id": index_id,
                "kind": "index",
                "required": True,
                "url": f"{RELEASE_BASE_URL}/{release_tag}/{index.name}",
                "sha256": sha256_file(index),
                "sizeBytes": index_size,
                "compression": "gzip",
                "decodedSha256": decoded_sha256,
                "decodedSizeBytes": decoded_size,
                "sourceSetDigest": digest,
            },
            {
                "id": assets_id,
                "kind": "source-assets",
                "required": True,
                "url": f"{RELEASE_BASE_URL}/{release_tag}/{archive.name}",
                "sha256": sha256_file(archive),
                "sizeBytes": archive_size,
                "compression": "zip",
                "sourceSetDigest": digest,
            },
        ],
        "documents": [
            {
                **document,
                "title": PLATES_TITLE,
                "indexArtifactId": index_id,
                "sourceAssetArtifactId": assets_id,
            }
        ],
        "previewDocumentCount": 1,
    }
    entry_path = output_dir / f"{stem}.catalog-entry.json"
    entry_path.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return {
        "moduleId": PLATES_MODULE_ID,
        "version": version,
        "plates": len(images),
        "archive": str(archive),
        "archiveBytes": archive_size,
        "index": str(index),
        "indexBytes": index_size,
        "catalogEntry": str(entry_path),
    }
