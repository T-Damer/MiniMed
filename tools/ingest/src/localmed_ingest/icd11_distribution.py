"""Package the WHO ICD-11 MMS (Russian) pack as one optional, exact, gzip-transported module.

ICD-10 stays the default coding system: this module has its own id, collection and document
prefix, carries no ICD-10 metadata keys, and the discovery core has no pointers to it, so there is
no core membership check to run.
"""

from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

from .icd11_api_fetch import API_DIRECTORY, API_MANIFEST_NAME
from .icd11_fetch import MANIFEST_NAME
from .icd11_prepare import CITATION, DOCUMENT_PREFIX, LICENCE_ID, SOURCE_TYPE
from .module_distribution import (
    ModuleDescriptor,
    package_module,
    plural_ru,
    read_pack_membership,
    require_publication_decision,
    required_text,
)

MODULE_ID = "minimed.reference.icd11.ru"
COLLECTION = "icd11"
SOURCE_HOST = "icd.who.int"
TITLE = "МКБ-11 (ВОЗ), справочно; в РФ действует МКБ-10"


def raw_sources(raw_root: Path) -> dict[str, object]:
    """Checksums of the raw inputs, recorded once in the release report (not in every document)."""
    files = json.loads((raw_root / MANIFEST_NAME).read_text(encoding="utf-8"))
    api = json.loads((raw_root / API_DIRECTORY / API_MANIFEST_NAME).read_text(encoding="utf-8"))
    return {
        "release": files["release"],
        "fetchedAt": files["fetchedAt"],
        "files": [
            {"name": item["name"], "url": item["url"], "sha256": item["sha256"]}
            for item in files["files"]
        ],
        "icdApi": {
            "containerImage": api["containerImage"],
            "dataRelease": api["dataRelease"],
            "apiVersions": api["apiVersions"],
            "language": api["acceptLanguage"],
            "fetchedAt": api["fetchedAt"],
            "archive": api["archive"],
            "entityCount": api["entityCount"],
            "missing": api["missing"],
        },
    }


def package_icd11_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
    raw_root: Path | None = None,
) -> dict[str, object]:
    kinds: dict[str, int] = {}
    english_only = 0
    releases: set[str] = set()

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        nonlocal english_only
        url = required_text(metadata.get("officialSourceUrl"), f"{document_id} officialSourceUrl")
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != SOURCE_HOST:
            raise ValueError(f"{document_id}: source URL is outside {SOURCE_HOST}")
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        if metadata.get("rightsStatus") != LICENCE_ID:
            raise ValueError(f"{document_id}: rights status is not {LICENCE_ID}")
        if metadata.get("codingSystem") != "icd-11":
            raise ValueError(f"{document_id}: not marked as ICD-11")
        # ICD-11 must never look like ICD-10 to the app.
        for key in ("mkbCode", "icd10Codes", "entityType", "terminology"):
            if key in metadata:
                raise ValueError(f"{document_id}: ICD-11 document carries the ICD-10 key {key}")
        require_publication_decision(document_id, metadata)
        kind = required_text(metadata.get("icd11ClassKind"), f"{document_id} icd11ClassKind")
        kinds[kind] = kinds.get(kind, 0) + 1
        english_only += metadata.get("icd11TitleLanguage") == "en-source-only"
        releases.add(required_text(metadata.get("icd11Release"), f"{document_id} release"))

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    if len(releases) != 1:
        raise ValueError(f"Expected one ICD-11 release, found {sorted(releases)}")
    release = next(iter(releases))
    codes = kinds.get("category", 0)
    description = (
        f"МКБ-11 (ВОЗ, MMS, выпуск {release}, русская версия ВОЗ): "
        f"{plural_ru(codes, 'рубрика', 'рубрики', 'рубрик')} с кодами, "
        f"{plural_ru(kinds.get('block', 0), 'блок', 'блока', 'блоков')} и "
        f"{plural_ru(kinds.get('chapter', 0), 'глава', 'главы', 'глав')}: названия, иерархия, "
        "определения, включения, исключения и термины указателя (русский текст, как его отдаёт "
        "ICD-API ВОЗ; если русского текста у ВОЗ нет, поле опущено, английский текст не "
        "подставляется), указания по кодированию и соответствие кодам МКБ-10 по таблицам ВОЗ. "
        f"У {plural_ru(english_only, 'рубрики', 'рубрик', 'рубрик')} в русской версии ВОЗ нет "
        "перевода названия — показано английское название ВОЗ. "
        "В Российской Федерации действует МКБ-10; этот набор необязательный, справочный и "
        f"не заменяет МКБ-10. Лицензия ВОЗ CC BY-ND 3.0 IGO; {CITATION}. Таблицы соответствия — "
        "таблицы ВОЗ без изменений; перевод и сопоставления ВОЗ вне лицензии на классификацию."
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"reference-icd11-{version}",
            file_stem="minimed.reference.icd11",
            title=TITLE,
            tags=("icd-11", "who", "reference", "requires-review", "experimental"),
            collection=COLLECTION,
            list_documents=False,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=description,
        report_extra={
            "sourceType": SOURCE_TYPE,
            "icd11Release": release,
            "classKinds": dict(sorted(kinds.items())),
            "englishOnlyTitles": english_only,
            **({"rawSources": raw_sources(raw_root)} if raw_root is not None else {}),
        },
    )
