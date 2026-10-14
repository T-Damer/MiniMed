"""Package the verified regulatory pack as the downloadable regulatory module.

Every act in the pack must carry what a reader needs to trust it: number, signing date, issuer,
edition, an official https source and the checksum of the source text it was verified against.
Acts published on publication.pravo.gov.ru also carry the SHA-256 and page count of the official
PDF that `regulatory_verify` read. The two crosswalk cards (`medical_reference`) are checked for
their source link only.
"""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit

from .module_distribution import (
    ModuleDescriptor,
    package_module,
    read_pack_membership,
)

MODULE_ID = "minimed.regulatory.pediatrics.ru"
DOCUMENT_PREFIX = "regulatory.rf."
TITLE = "Нормативные документы РФ: педиатрия"
ACT_SOURCE_TYPE = "regulatory_act_summary"
REFERENCE_SOURCE_TYPE = "medical_reference"
SOURCE_HOSTS = frozenset(
    {
        "publication.pravo.gov.ru",
        "pravo.gov.ru",
        "rg.ru",
        "minzdrav.gov.ru",
        "www.consultant.ru",
        "sfr.gov.ru",
    }
)
PORTAL_HOST = "publication.pravo.gov.ru"
DESCRIPTION = (
    "Действующие и прежние приказы и законы для педиатрии: профилактические осмотры, диспансерное "
    "наблюдение, прививки, листки нетрудоспособности, порядки оказания помощи, квалификационные "
    "требования. У каждого документа указаны номер, дата, редакция и официальный источник."
)
_SHA256 = re.compile(r"[0-9a-f]{64}")


def check_act_metadata(
    document_id: str,
    source_type: str,
    metadata: dict[str, object],
    source_checksum: str,
) -> list[str]:
    """Problems that keep an act out of a published module (empty list: the act is complete)."""
    problems: list[str] = []
    if not source_checksum.startswith("sha256:") or not _SHA256.fullmatch(source_checksum[7:]):
        problems.append("version has no SHA-256 source checksum")
    url = metadata.get("officialSourceUrl")
    if not isinstance(url, str):
        problems.append("officialSourceUrl is missing")
    else:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc not in SOURCE_HOSTS:
            problems.append(f"source URL {url} is outside the official hosts")
    if source_type == REFERENCE_SOURCE_TYPE:
        return problems
    if source_type != ACT_SOURCE_TYPE:
        return [*problems, f"unexpected source type {source_type}"]
    for key in ("documentNumber", "signedAt", "issuer", "edition", "sourceReviewedAt"):
        value = metadata.get(key)
        if not isinstance(value, str) or not value.strip():
            problems.append(f"{key} is missing")
    signed = metadata.get("signedAt")
    if isinstance(signed, str) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", signed):
        problems.append("signedAt is not YYYY-MM-DD")
    if metadata.get("editionVerified") is not True:
        problems.append("editionVerified is not true")
    if isinstance(url, str) and urlsplit(url).netloc == PORTAL_HOST:
        digest = metadata.get("sourcePdfSha256")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            problems.append("sourcePdfSha256 is missing for a portal publication")
        pages = metadata.get("sourcePdfPages")
        if not isinstance(pages, int) or pages < 1:
            problems.append("sourcePdfPages is missing for a portal publication")
    return problems


def empty_sections(database: Path) -> list[str]:
    """Sections without any text of their own or in a sub-section, per document.

    A pack with any is not publishable. A heading that only introduces numbered sub-sections
    («III. Характеристика …» → 3.1, 3.2) is not empty.
    """
    found: list[str] = []
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "WITH RECURSIVE tree(root, id) AS ("
            "SELECT id, id FROM sections "
            "UNION ALL SELECT tree.root, s.id FROM sections s "
            "JOIN tree ON s.parent_section_id = tree.id) "
            "SELECT v.document_id, s.title FROM sections s "
            "JOIN document_versions v ON v.id = s.document_version_id "
            "WHERE NOT EXISTS (SELECT 1 FROM tree JOIN chunks c ON c.section_id = tree.id "
            "WHERE tree.root = s.id AND length(trim(c.original_text)) > 0)"
        ).fetchall()
        found.extend(f"{document}: {title}" for document, title in rows)
    return found


def package_regulatory_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
    transport: str = "zstd",
) -> dict[str, object]:
    failures: list[str] = []
    acts = 0
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        source_types = {
            str(row[0]): str(row[1])
            for row in connection.execute("SELECT id, source_type FROM documents")
        }

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        nonlocal acts
        source_type = source_types[document_id]
        problems = check_act_metadata(document_id, source_type, metadata, source_checksum)
        failures.extend(f"{document_id}: {problem}" for problem in problems)
        if source_type == ACT_SOURCE_TYPE:
            acts += 1

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    failures.extend(f"empty section {item}" for item in empty_sections(database))
    if failures:
        raise ValueError("Regulatory pack is not publishable:\n" + "\n".join(sorted(failures)))
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"regulatory-{version}",
            file_stem="minimed.regulatory.pediatrics",
            title=TITLE,
            tags=("regulation", "administration"),
            structured_knowledge=True,
            structured_tables=True,
            collection="shared",
            list_documents=True,
            kind="regulatory",
            specialties=("pediatrics", "health-administration"),
            populations=("children",),
            release_state="published",
            dependencies=(
                {"moduleId": "minimed.core.ru", "versionRange": "^1.0.0", "required": True},
            ),
            transport=transport,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=DESCRIPTION,
        report_extra={"acts": acts, "sourceType": ACT_SOURCE_TYPE},
    )


__all__ = [
    "MODULE_ID",
    "check_act_metadata",
    "empty_sections",
    "package_regulatory_module",
]
