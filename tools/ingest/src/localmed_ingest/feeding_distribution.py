"""Package the feeding-norms pack as one optional, exact, gzip-transported reference module.

No discovery-core pointer targets these documents, so there is no core membership check; the
pack's exact document membership is verified and listed in the catalog entry. The text comes from
books of the owner's private library (rights not cleared; personal use while the repository is
public, owner decision 2026-10-13), so every document must carry that status and a book checksum.
"""

from __future__ import annotations

from pathlib import Path
from typing import cast

from .feeding_norms import DOCUMENT_PREFIX, RIGHTS_STATUS, SOURCE_TYPE
from .module_distribution import (
    ModuleDescriptor,
    json_object,
    package_module,
    read_pack_membership,
    required_text,
)

MODULE_ID = "minimed.reference.feeding.ru"
COLLECTION = "feeding"
TITLE = "Нормы питания"
DESCRIPTION = (
    "Нормы питания и кормления по книгам: Программа оптимизации вскармливания детей первого года "
    "жизни (Союз педиатров России, 2019) и учебные пособия. Питание беременных и кормящих, "
    "грудное, смешанное и искусственное вскармливание, прикорм по месяцам, расчёт суточного и "
    "разового объёма (Финкельштейн, Филатов, Шкарин, объёмный и калорийный методы), режим "
    "кормления, потребности в энергии и нутриентах по возрастам, прибавки массы, витамин D, "
    "недоношенные, особые состояния. Каждая таблица и абзац с книгой и страницей, расхождения "
    "источников отмечены."
)


def package_feeding_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
) -> dict[str, object]:
    books: set[str] = set()

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        if metadata.get("rightsStatus") != RIGHTS_STATUS:
            raise ValueError(f"{document_id}: rights status is not {RIGHTS_STATUS}")
        if metadata.get("localOnly"):
            raise ValueError(f"{document_id}: a local-only document cannot ship in a public module")
        sources = metadata.get("sourceBooks")
        if not isinstance(sources, list) or not sources:
            raise ValueError(f"{document_id}: no sourceBooks")
        for item in cast("list[object]", sources):
            entry = json_object(item, f"{document_id} sourceBook")
            required_text(entry.get("citation"), f"{document_id} sourceBook citation")
            required_text(entry.get("sha256"), f"{document_id} sourceBook sha256")
            books.add(required_text(entry.get("id"), f"{document_id} sourceBook id"))

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"reference-feeding-{version}",
            file_stem="minimed.reference.feeding",
            title=TITLE,
            tags=("feeding", "nutrition", "reference", "pediatrics"),
            structured_tables=True,
            collection=COLLECTION,
            list_documents=True,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=DESCRIPTION,
        report_extra={"sourceType": SOURCE_TYPE, "books": sorted(books)},
    )
