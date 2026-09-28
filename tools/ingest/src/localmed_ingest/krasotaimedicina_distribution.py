"""Package the Krasota i Meditsina disease snapshot as one exact, gzip-transported module.

The discovery core's pointers name the unpublished `minimed.mkb.ru`; since app 0.6.44 a pointer
falls back to any released module whose verified index lists the exact target document, so this
pack keeps its own id and every pointer is checked against its exact membership, never titles.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import urlsplit

from .module_distribution import (
    ModuleDescriptor,
    package_module,
    plural_ru,
    read_pack_membership,
    require_publication_decision,
    required_text,
)

MODULE_ID = "minimed.reference.krasotaimedicina.ru"
DOCUMENT_PREFIX = "krasotaimedicina.disease."
SOURCE_HOST = "www.krasotaimedicina.ru"


def package_krasotaimedicina_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
    core_database: Path | None = None,
) -> dict[str, object]:
    entity_types: dict[str, int] = {}
    fetched: list[str] = []

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        url = required_text(metadata.get("officialSourceUrl"), f"{document_id} officialSourceUrl")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != SOURCE_HOST:
            raise ValueError(f"{document_id}: source URL is outside {SOURCE_HOST}")
        expected_id = DOCUMENT_PREFIX + hashlib.sha256(url.encode()).hexdigest()[:16]
        if document_id != expected_id:
            raise ValueError(f"{document_id}: identity does not match its source URL")
        if metadata.get("sourceChecksum", source_checksum) != source_checksum:
            raise ValueError(f"{document_id}: document and version checksums differ")
        fetched.append(required_text(metadata.get("fetchedAt"), f"{document_id} fetchedAt"))
        required_text(metadata.get("rawPath"), f"{document_id} rawPath")
        required_text(metadata.get("rightsStatus"), f"{document_id} rightsStatus")
        require_publication_decision(document_id, metadata)
        entity_type = required_text(metadata.get("entityType"), f"{document_id} entityType")
        entity_types[entity_type] = entity_types.get(entity_type, 0) + 1

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    last_fetched = max(fetched)
    description = (
        f"{plural_ru(len(membership.documents), 'статья', 'статьи', 'статей')} справочника "
        f"«Красота и медицина» (krasotaimedicina.ru): "
        f"{plural_ru(entity_types.get('disease', 0), 'заболевание', 'заболевания', 'заболеваний')}"
        f" и {plural_ru(entity_types.get('syndrome', 0), 'синдром', 'синдрома', 'синдромов')}. "
        f"Снимок сайта по {last_fetched[:10]}, только текст, со ссылкой на исходную страницу. "
        "Справочные статьи сайта, не клинические рекомендации; клинически не проверены."
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"reference-krasotaimedicina-{version}",
            file_stem="minimed.reference.krasotaimedicina",
            title="Справочник заболеваний «Красота и медицина»",
            tags=("diseases", "krasotaimedicina", "requires-review", "experimental"),
            collection="conditions",
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=description,
        core_database=core_database,
        pointer_prefixes=(DOCUMENT_PREFIX,),
        report_extra={
            "entityTypes": dict(sorted(entity_types.items())),
            "lastFetchedAt": last_fetched,
        },
    )
