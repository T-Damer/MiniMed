"""Package the compact RLS MKB code module (`minimed.mkb.ru`) and its packaging module."""

from __future__ import annotations

import sqlite3
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

CODE_MODULE_ID = "minimed.mkb.ru"
PACKAGING_MODULE_ID = "minimed.rls.packaging.ru"
CODE_PREFIX = "rls.mkb."
PACKAGING_PREFIX = "rls.packaging."
SOURCE_HOST = "www.rlsnet.ru"


def _validator(counts: dict[str, int]):
    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        url = required_text(metadata.get("officialSourceUrl"), f"{document_id} officialSourceUrl")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != SOURCE_HOST:
            raise ValueError(f"{document_id}: source URL is outside {SOURCE_HOST}")
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        required_text(metadata.get("rightsStatus"), f"{document_id} rightsStatus")
        require_publication_decision(document_id, metadata)
        kind = required_text(metadata.get("sourceKind"), f"{document_id} sourceKind")
        counts[kind] = counts.get(kind, 0) + 1

    return validate


def _knowledge_counts(database: Path) -> dict[str, object]:
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:

        def count(sql: str) -> int:
            return int(connection.execute(sql).fetchone()[0])

        return {
            "entities": count("SELECT count(*) FROM knowledge_entities"),
            "names": count("SELECT count(*) FROM knowledge_names"),
            "relations": dict(
                connection.execute(
                    "SELECT predicate, count(*) FROM knowledge_relations GROUP BY predicate "
                    "ORDER BY predicate"
                ).fetchall()
            ),
            "evidence": count("SELECT count(*) FROM knowledge_evidence"),
            "medicationProfiles": count("SELECT count(*) FROM medication_profiles"),
            "brands": count("SELECT count(*) FROM medication_profiles WHERE concept_level='brand'"),
            "substances": count(
                "SELECT count(*) FROM medication_profiles WHERE concept_level='substance'"
            ),
            "aliases": count("SELECT count(*) FROM aliases"),
            "sections": count("SELECT count(*) FROM sections"),
        }


def package_rls_mkb_modules(
    code_database: Path,
    packaging_database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
    core_database: Path | None = None,
) -> dict[str, object]:
    release_tag = f"reference-rls-mkb-{version}"
    code_kinds: dict[str, int] = {}
    code_membership = read_pack_membership(
        code_database, document_prefixes=(CODE_PREFIX,), validate=_validator(code_kinds)
    )
    knowledge = _knowledge_counts(code_database)
    codes = sum(
        str(item["documentId"]).startswith("rls.mkb.node.") for item in code_membership.documents
    )
    code_description = (
        f"МКБ-10 по классификации РЛС: {plural_ru(codes, 'код', 'кода', 'кодов')} — "
        "рубрики, блоки и классы с синонимами, иерархией и ссылкой на исходную страницу; "
        "поиск по коду и по названию диагноза. Связи с "
        f"{plural_ru(int(str(knowledge['brands'])), 'препаратом', 'препаратами', 'препаратами')}"
        " и "
        f"{plural_ru(int(str(knowledge['substances'])), 'веществом', 'веществами', 'веществами')}"
        ", указанными на страницах кодов, — справочная привязка, не показание. Формы и упаковки "
        "— в отдельном наборе. Клинически не проверено."
    )
    code_report = package_module(
        code_database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=CODE_MODULE_ID,
            release_tag=release_tag,
            file_stem="minimed.reference.rls-mkb",
            title="МКБ-10 и привязки РЛС",
            tags=("icd-10", "mkb", "rls", "requires-review", "experimental"),
            structured_knowledge=True,
            collection="conditions",
        ),
        version=version,
        min_app_version=min_app_version,
        membership=code_membership,
        description=code_description,
        core_database=core_database,
        pointer_prefixes=(CODE_PREFIX,),
        report_extra={"sourceKinds": dict(sorted(code_kinds.items())), "knowledge": knowledge},
    )

    packaging_kinds: dict[str, int] = {}
    packaging_membership = read_pack_membership(
        packaging_database,
        document_prefixes=(PACKAGING_PREFIX,),
        validate=_validator(packaging_kinds),
    )
    brands = len(packaging_membership.documents)
    names = plural_ru(
        brands, "торгового наименования", "торговых наименований", "торговых наименований"
    )
    packaging_description = (
        f"Формы, дозировки, упаковки и производители {names}"
        " из таблиц РЛС — по одному документу на препарат, со ссылками на коды МКБ-10 набора "
        "«МКБ-10 и привязки РЛС». Не инструкция и не схема дозирования; клинически не проверено."
    )
    packaging_report = package_module(
        packaging_database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=PACKAGING_MODULE_ID,
            release_tag=release_tag,
            file_stem="minimed.reference.rls-packaging",
            title="Формы, дозировки и упаковки РЛС",
            tags=("drugs", "packaging", "rls", "requires-review", "experimental"),
            structured_tables=True,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=packaging_membership,
        description=packaging_description,
        report_extra={"sourceKinds": dict(sorted(packaging_kinds.items()))},
    )
    return {"releaseTag": release_tag, "code": code_report, "packaging": packaging_report}
