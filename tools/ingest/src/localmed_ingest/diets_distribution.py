"""Package the official therapeutic-nutrition pack as one optional, exact, gzip-transported module.

No discovery-core pointer targets these documents, so there is no core membership check; the
pack's exact document membership is verified and listed in the catalog entry.
"""

from __future__ import annotations

from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

from .diets_official import DOCUMENT_PREFIX, RIGHTS_STATUS, SOURCE_TYPE
from .module_distribution import (
    ModuleDescriptor,
    json_object,
    package_module,
    read_pack_membership,
    required_text,
)

MODULE_ID = "minimed.reference.diets.ru"
COLLECTION = "diets"
TITLE = "Лечебное питание"
SOURCE_HOSTS = frozenset(
    {
        "www.consultant.ru",
        "minzdrav.gov.ru",
        "publication.pravo.gov.ru",
    }
)
DESCRIPTION = (
    "Лечебное питание по приказам Минздрава России №330 (Инструкция, ред. от 19.02.2024), №395н "
    "(нормы лечебного питания) и №1008н: шесть вариантов стандартной диеты (ОВД, ЩД, ВБД, НБД, "
    "НКД, ВКД) с показаниями, характеристикой, химическим составом и набором продуктов, диеты "
    "для детей старше 1 года, беременных и кормящих женщин, таблицы наборов продуктов и замен, "
    "соответствие номерных столов вариантам. Тексты официальных документов."
)


def package_diets_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
) -> dict[str, object]:
    variants: list[str] = []

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        url = required_text(metadata.get("officialSourceUrl"), f"{document_id} officialSourceUrl")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc not in SOURCE_HOSTS:
            raise ValueError(f"{document_id}: source URL {url} is outside {sorted(SOURCE_HOSTS)}")
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        if metadata.get("rightsStatus") != RIGHTS_STATUS:
            raise ValueError(f"{document_id}: rights status is not {RIGHTS_STATUS}")
        if metadata.get("localOnly"):
            raise ValueError(f"{document_id}: a local-only document cannot ship in a public module")
        sources = metadata.get("sourceDocuments")
        if not isinstance(sources, list) or not sources:
            raise ValueError(f"{document_id}: no sourceDocuments")
        for item in cast("list[object]", sources):
            entry = json_object(item, f"{document_id} sourceDocument")
            required_text(entry.get("number"), f"{document_id} sourceDocument number")
            required_text(entry.get("extractedSha256"), f"{document_id} extractedSha256")
        variants.append(required_text(metadata.get("dietVariant"), f"{document_id} dietVariant"))

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"reference-diets-{version}",
            file_stem="minimed.reference.diets",
            title=TITLE,
            tags=("diets", "nutrition", "reference", "official"),
            structured_tables=True,
            collection=COLLECTION,
            list_documents=True,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=DESCRIPTION,
        report_extra={"sourceType": SOURCE_TYPE, "dietVariants": sorted(variants)},
    )
