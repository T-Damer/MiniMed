"""Prepare the WHO ICD-11 MMS (Russian linearization) as a separate, source-exact workspace.

Input is exactly what WHO publishes without an account: the Russian "Simple tabulation" spreadsheet
(`SimpleTabulation-ICD-11-MMS-ru.txt`) and the ICD-10/ICD-11 mapping tables. Nothing is translated,
summarised or corrected here: Russian titles and coding notes are WHO's own text, an entity whose
Russian title is empty keeps WHO's English title and says so. ICD-11 never carries the
metadata keys that the app uses for ICD-10 (`mkbCode`, `icd10Codes`, `entityType`, source type
`rls_mkb_reference`), so it cannot be mistaken for an ICD-10 code anywhere.

Every paragraph is preceded by a `localmed:source` marker with the entity's browser URL, the raw
file's SHA-256 and the line (tabulation) or row set (mapping) it was taken from.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sqlite3
import tempfile
import zipfile
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import quote

import yaml

from .icd11_api_fetch import API_ARCHIVE_NAME, API_DIRECTORY
from .icd11_api_text import ApiEntityText, ApiText, ApiTextArchive, load_api_text
from .icd11_fetch import MANIFEST_NAME, MAPPING_NAME, TABULATION_NAME
from .publication import PublicationDecision

DOCUMENT_PREFIX = "who.icd11.mms."
SOURCE_TYPE = "who_icd11_reference"
PACK_ID = "minimed.who.icd11.mms.ru"
TABULATION_MEMBER = "SimpleTabulation-ICD-11-MMS-ru.txt"
LINEARIZATION_BASE = "http://id.who.int/icd/release/11/mms/"
CITATION = (
    "International Classification of Diseases, Eleventh Revision (ICD-11), "
    "World Health Organization (WHO) 2019"
)
ICD10_DOCUMENT_PREFIX = "rls.mkb.node."
LICENCE_ID = "cc-by-nd-3.0-igo"
_TABULATION_COLUMNS = (
    "Foundation URI",
    "Linearization URI",
    "Code",
    "BlockId",
    "TitleEN",
    "Title",
    "ClassKind",
    "DepthInKind",
    "IsResidual",
    "ChapterNo",
    "BrowserLink",
    "isLeaf",
    "Primary tabulation",
    "Grouping1",
    "Grouping2",
    "Grouping3",
    "Grouping4",
    "Grouping5",
    "CodingNote",
    "Parent",
)
_YAML_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)
_DASHES = re.compile(r"^(?:- )+")
MAIN_SECTION = "Рубрика МКБ-11"
CROSSWALK_SECTION = "Соответствие МКБ-10 (таблицы ВОЗ)"
PROVISIONAL_NOTE = " (пометка ВОЗ: possible translation)"
_KINDS = frozenset({"chapter", "block", "category"})


@dataclass(frozen=True)
class Icd11Entity:
    line: int
    foundation_uri: str
    entity_id: str
    code: str
    block_id: str
    title_en: str
    title_ru: str | None
    kind: str
    residual: bool
    chapter: str
    leaf: bool
    coding_note: str | None
    parent_uri: str | None


@dataclass(frozen=True)
class Icd10Link:
    """One row of a WHO mapping table that points at an ICD-11 entity."""

    relation: str  # closest | mapped-into-this | mapped-into-this-multiple
    icd10_code: str
    icd10_kind: str
    icd10_title_en: str
    icd11_code: str
    line: int
    table: str


@dataclass
class Icd11PrepareReport:
    release: str
    documents: int = 0
    chapters: int = 0
    blocks: int = 0
    categories: int = 0
    russian_titles: int = 0
    english_only_titles: int = 0
    coding_notes: int = 0
    coding_notes_api_only: int = 0
    entities_with_icd10_closest: int = 0
    entities_with_icd10_sources: int = 0
    mapping_rows_unmatched: dict[str, int] = field(default_factory=dict)
    icd10_links_resolved: int = 0
    icd10_links_unresolved: int = 0
    tabulation_sha256: str = ""
    mapping_sha256: str = ""
    api_archive_sha256: str = ""
    api_container_image: str = ""
    api_data_release: str = ""
    api_entities: int = 0
    # property -> {served, kept, englishFallbackOmitted, unmarkedEnglishOmitted, provisional}
    api_text: dict[str, dict[str, int]] = field(default_factory=dict)
    documents_with_api_text: dict[str, int] = field(default_factory=dict)
    output: str = ""


def _text(value: str) -> str:
    return value.replace("\r\n", "\n").strip()


def _quoted(value: str, label: str) -> str:
    if not value:
        return ""
    if len(value) < 2 or not (value.startswith('"') and value.endswith('"')):
        raise ValueError(f"{label}: title is not a quoted field")
    return value[1:-1].replace('""', '"')


def _clean_title(value: str, label: str) -> str:
    return _DASHES.sub("", _quoted(value, label)).strip()


def _entity_id(linearization_uri: str) -> str:
    if not linearization_uri.startswith(LINEARIZATION_BASE):
        raise ValueError(f"Unexpected linearization URI: {linearization_uri}")
    return linearization_uri[len(LINEARIZATION_BASE) :]


def document_id(entity_id: str) -> str:
    return DOCUMENT_PREFIX + entity_id.replace("/", ".")


def browser_url(release: str, entity_id: str) -> str:
    return f"https://icd.who.int/browse/{release}/mms/ru#{quote(entity_id, safe='')}"


def _records(text: str) -> list[tuple[int, list[str]]]:
    """Split WHO's CRLF tab file; a coding note may itself contain line breaks."""
    lines = text.split("\r\n")
    records: list[tuple[int, list[str]]] = []
    buffer: str | None = None
    start = 0
    for number, line in enumerate(lines[1:], start=2):
        if buffer is None:
            if not line:
                continue
            buffer, start = line, number
        else:
            buffer = f"{buffer}\n{line}"
        if buffer.count("\t") >= len(_TABULATION_COLUMNS) - 1:
            records.append((start, buffer.split("\t")))
            buffer = None
    if buffer is not None:
        raise ValueError(f"Unterminated record starting at line {start}")
    return records


def parse_tabulation(text: str) -> list[Icd11Entity]:
    header = text.split("\r\n", 1)[0].lstrip("﻿").split("\t")
    if tuple(header[: len(_TABULATION_COLUMNS)]) != _TABULATION_COLUMNS:
        raise ValueError(f"Unexpected tabulation columns: {header}")
    entities: list[Icd11Entity] = []
    for line, fields in _records(text):
        if len(fields) != len(_TABULATION_COLUMNS):
            raise ValueError(f"Line {line}: expected {len(_TABULATION_COLUMNS)} fields")
        row = dict(zip(_TABULATION_COLUMNS, fields, strict=True))
        kind = row["ClassKind"]
        if kind not in _KINDS:
            raise ValueError(f"Line {line}: unknown class kind {kind!r}")
        label = f"line {line}"
        title_ru = _clean_title(row["Title"], label)
        title_en = _clean_title(row["TitleEN"], label)
        if not title_en:
            raise ValueError(f"{label}: WHO English title is empty")
        note = _text(row["CodingNote"])
        entities.append(
            Icd11Entity(
                line=line,
                foundation_uri=row["Foundation URI"],
                entity_id=_entity_id(row["Linearization URI"]),
                code=row["Code"],
                block_id=row["BlockId"],
                title_en=title_en,
                title_ru=title_ru or None,
                kind=kind,
                residual=row["IsResidual"] == "True",
                chapter=row["ChapterNo"],
                leaf=row["isLeaf"] == "True",
                coding_note=note or None,
                parent_uri=row["Parent"] or None,
            )
        )
    ids = [entity.entity_id for entity in entities]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate linearization URI in the tabulation")
    codes = [entity.code for entity in entities if entity.code]
    if len(set(codes)) != len(codes):
        raise ValueError("Duplicate ICD-11 code in the tabulation")
    return entities


def _table(text: str) -> tuple[list[str], list[tuple[int, list[str]]]]:
    lines = text.lstrip("﻿").split("\n")
    header = lines[0].rstrip("\r").split("\t")
    rows = [
        (number, line.rstrip("\r").split("\t"))
        for number, line in enumerate(lines[1:], start=2)
        if line.strip()
    ]
    return header, rows


def _mapped_entity_id(uri: str) -> str:
    """`.../release/11/2026-01/mms/<id>[/other]` -> `<id>[/other]` (the tabulation's entity id)."""
    return re.sub(r"^.*?/mms/", "", re.sub(r"/\d{4}-\d{2}/", "/", uri))


def _column(header: list[str], *names: str) -> int:
    lowered = [item.strip().casefold() for item in header]
    for name in names:
        if name.casefold() in lowered:
            return lowered.index(name.casefold())
    raise ValueError(f"Mapping table has none of the columns {names}: {header}")


def parse_mapping_11_to_10(text: str) -> dict[str, tuple[int, str, str]]:
    """Entity id -> (line, ICD-10 code, WHO English ICD-10 title)."""
    header, rows = _table(text)
    uri = _column(header, "Linearization (release) URI")
    code = _column(header, "icd10Code")
    title = _column(header, "icd10Title")
    closest: dict[str, tuple[int, str, str]] = {}
    for number, row in rows:
        entity = _mapped_entity_id(row[uri])
        if not row[code]:
            continue
        closest[entity] = (number, row[code], row[title])
    return closest


def parse_mapping_10_to_11(text: str, table: str, relation: str) -> list[tuple[str, Icd10Link]]:
    """(ICD-11 entity id, link) for every row of a 10 -> 11 table."""
    header, rows = _table(text)
    kind = _column(header, "10ClassKind")
    icd10 = _column(header, "icd10Code")
    icd10_title = _column(header, "icd10Title")
    uri = _column(header, "Linearization (release) URI", "Linearization (releaseURI)")
    icd11 = _column(header, "icd11Code")
    links: list[tuple[str, Icd10Link]] = []
    for number, row in rows:
        entity = _mapped_entity_id(row[uri])
        links.append(
            (
                entity,
                Icd10Link(
                    relation=relation,
                    icd10_code=row[icd10],
                    icd10_kind=row[kind],
                    icd10_title_en=row[icd10_title],
                    icd11_code=row[icd11],
                    line=number,
                    table=table,
                ),
            )
        )
    return links


def read_icd10_document_ids(database: Path | None) -> frozenset[str]:
    if database is None:
        return frozenset()
    with sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True) as connection:
        rows = connection.execute(
            "SELECT id FROM documents WHERE id LIKE ?", (f"{ICD10_DOCUMENT_PREFIX}%",)
        ).fetchall()
    return frozenset(str(row[0]) for row in rows)


def icd10_document_id(code: str) -> str:
    return f"{ICD10_DOCUMENT_PREFIX}{code.lower().replace('.', '-')}"


class _Names:
    """Display titles; an English-only title is marked wherever it is shown as a name."""

    def __init__(self, entities: list[Icd11Entity]) -> None:
        self.by_code = {entity.code: entity for entity in entities if entity.code}

    @staticmethod
    def title(entity: Icd11Entity) -> str:
        return entity.title_ru or entity.title_en

    def label(self, entity: Icd11Entity) -> str:
        title = self.title(entity)
        if entity.kind == "chapter":
            return f"Глава {entity.chapter}. {title}"
        if entity.kind == "block":
            return f"Блок: {title}"
        return f"{entity.code} {title}"

    def cluster_parts(self, code: str) -> list[tuple[str, str | None]]:
        parts = [part for part in re.split(r"[&/]", code) if part]
        return [
            (part, self.title(self.by_code[part]) if part in self.by_code else None)
            for part in parts
        ]


def _flagged(item: ApiText) -> str:
    return item.text + (PROVISIONAL_NOTE if item.provisional else "")


class _Paragraphs:
    """Markdown body of one section; a paragraph that cites WHO rows carries its source marker."""

    def __init__(self) -> None:
        self.lines: list[str] = []

    def add(self, text: str, marker: str | None = None) -> None:
        if marker:
            self.lines.append(marker)
        self.lines.extend([text, ""])


def _api_marker(entity_id: str, entry: str, selector: str, kind: str, release: str) -> str:
    del entity_id
    return _source_marker_compact(
        f"icd11/{release}/{API_DIRECTORY}/{API_ARCHIVE_NAME}", f"{entry}#{selector}", kind
    )


def _source_marker_compact(raw_path: str, selector: str, kind: str) -> str:
    payload = {"rawPath": raw_path, "selector": selector, "sourceKind": kind}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"<!-- localmed:source {encoded} -->"


def _entity_document(
    entity: Icd11Entity,
    *,
    release: str,
    entities_by_uri: dict[str, Icd11Entity],
    children: dict[str, list[Icd11Entity]],
    names: _Names,
    closest: tuple[int, str, str] | None,
    sources: list[Icd10Link],
    icd10_ids: frozenset[str],
    tabulation_member: str,
    tabulation_sha256: str,
    mapping_sha256: str,
    api: ApiEntityText | None,
    api_archive_sha256: str | None,
    fetched_at: str,
    publication: PublicationDecision,
    counters: Icd11PrepareReport,
) -> tuple[str, str]:
    url = browser_url(release, entity.entity_id)
    raw_path = f"icd11/{release}/{tabulation_member}"
    mapping_path = f"icd11/{release}/mapping"

    def marker(kind: str) -> str:
        return _source_marker_compact(raw_path, f"line:{entity.line}", kind)

    def mapping_marker(kind: str, table: str, lines: list[int]) -> str:
        return _source_marker_compact(
            f"{mapping_path}/{table}", "lines:" + ",".join(str(line) for line in lines), kind
        )

    def api_marker(selector: str, kind: str) -> str:
        assert api is not None
        return _api_marker(entity.entity_id, api.entry, selector, kind, release)

    path: list[Icd11Entity] = []
    parent = entities_by_uri.get(entity.parent_uri) if entity.parent_uri else None
    while parent is not None:
        path.append(parent)
        parent = entities_by_uri.get(parent.parent_uri) if parent.parent_uri else None
    # path[0] is the nearest ancestor (same order as the ICD-10 module's classificationPath).
    classification_path = [
        {"title": names.title(item), "documentId": document_id(item.entity_id)} for item in path
    ]

    title = names.title(entity)
    language_note = (
        "Русское название — по переводу ВОЗ."
        if entity.title_ru
        else "В русской версии ВОЗ у этой рубрики нет перевода названия; показано название ВОЗ на "
        "английском языке, перевод не выполнялся."
    )
    if entity.kind == "category":
        identity = f"Код МКБ-11: {entity.code}. Название: {title}."
    elif entity.kind == "block":
        identity = f"Блок МКБ-11 без собственного кода. Название: {title}."
    else:
        identity = f"Глава {entity.chapter} МКБ-11, кода нет. Название: {title}."
    english = f" Название ВОЗ на английском: {entity.title_en}." if entity.title_ru else ""
    residual = (
        " Остаточная рубрика (другое уточнённое или неуточнённое состояние)."
        if (entity.residual)
        else ""
    )
    # The hierarchy and the children are stored once, as links in the document metadata (the card
    # panel shows them); repeating them as searchable text only multiplied rows.
    is_main = entity.entity_id == entity.foundation_uri.rsplit("/", 1)[-1]
    kids = [
        item
        for item in (children.get(entity.foundation_uri, []) if is_main else [])
        if item.entity_id != entity.entity_id
    ]

    main = _Paragraphs()
    main.add(f"{identity} {language_note}{english}{residual}", marker("classification"))
    if api is not None:
        if api.fully_specified_name is not None:
            main.add(
                f"Полное название ВОЗ: {_flagged(api.fully_specified_name)}",
                api_marker("fullySpecifiedName", "fully-specified-name"),
            )
        for label, kind, selector, text in (
            ("Определение", "definition", "definition", api.definition),
            ("Подробное определение", "long-definition", "longDefinition", api.long_definition),
        ):
            if text is None:
                continue
            lines = [line for line in _flagged(text).split("\n") if line.strip()]
            span = api_marker(selector, kind)
            main.add(f"{label}: {lines[0].strip()}", span)
            for line in lines[1:]:
                main.add(line.strip(), span)
        for label, kind, selector, items in (
            ("Включения", "inclusion", "inclusion", api.inclusions),
            ("Исключения", "exclusion", "exclusion", api.exclusions),
            ("Термины указателя", "index-term", "indexTerm", _distinct_terms(api, title)),
            (
                "Дочерние понятия, которые ВОЗ размещает в других рубриках",
                "foundation-child-elsewhere",
                "foundationChildElsewhere",
                api.elsewhere,
            ),
        ):
            if items:
                main.add(f"{label}:")
                main.add(
                    "\n".join(f"- {_flagged(item)}" for item in items), api_marker(selector, kind)
                )
    if entity.coding_note:
        counters.coding_notes += 1
        for index, paragraph in enumerate(entity.coding_note.split("\n")):
            if paragraph.strip():
                prefix = "Указание по кодированию: " if index == 0 else ""
                main.add(f"{prefix}{paragraph.strip()}", marker("coding-note"))
    elif api is not None and api.coding_note is not None:
        counters.coding_notes_api_only += 1
        lines = [line for line in _flagged(api.coding_note).split("\n") if line.strip()]
        span = api_marker("codingNote", "coding-note")
        main.add(f"Указание по кодированию: {lines[0].strip()}", span)
        for line in lines[1:]:
            main.add(line.strip(), span)
    main.add(
        f"Источник: ВОЗ, МКБ-11 (MMS), выпуск {release}, русская версия. "
        "ICD-11 © ВОЗ 2019, лицензия CC BY-ND 3.0 IGO."
    )
    body: list[str] = [f"# {MAIN_SECTION}", "", *main.lines]

    crosswalk: list[dict[str, object]] = []

    def link_entry(
        relation: str, code: str, title_en: str, cluster: str | None, kind: str
    ) -> dict[str, object]:
        target = icd10_document_id(code)
        resolved = target in icd10_ids
        counters.icd10_links_resolved += resolved
        counters.icd10_links_unresolved += not resolved and bool(icd10_ids)
        entry: dict[str, object] = {
            "relation": relation,
            "icd10Code": code,
            "icd10Kind": kind,
            "icd10TitleEn": title_en,
        }
        if resolved:
            entry["icd10DocumentId"] = target
        if cluster:
            entry["icd11Cluster"] = cluster
        return entry

    crosswalk_body = _Paragraphs()
    if closest is not None:
        line, code, title_en = closest
        crosswalk.append(link_entry("closest", code, title_en, None, "unknown"))
        crosswalk_body.add(
            f"Ближайшее соответствие в МКБ-10 по таблице ВОЗ «МКБ-11 → МКБ-10»: {code}.",
            mapping_marker("crosswalk-11-to-10", "11To10MapToOneCategory.txt", [line]),
        )
    for relation, table, heading in (
        (
            "mapped-into-this",
            "10To11MapToOneCategory.txt",
            "Коды МКБ-10, которые таблица ВОЗ «МКБ-10 → МКБ-11» (одна категория) относит к этой "
            "рубрике:",
        ),
        (
            "mapped-into-this-multiple",
            "10To11MapToMultipleCategories.txt",
            "Коды МКБ-10, которые таблица ВОЗ «МКБ-10 → МКБ-11» (несколько категорий) относит "
            "в том числе к этой рубрике:",
        ),
    ):
        picked = [link for link in sources if link.relation == relation]
        if relation == "mapped-into-this-multiple":
            # The «несколько категорий» table repeats every single-category row: show only the rest.
            shown = {
                (link.icd10_code, link.icd11_code)
                for link in sources
                if link.relation == "mapped-into-this"
            }
            picked = [link for link in picked if (link.icd10_code, link.icd11_code) not in shown]
        if not picked:
            continue
        lines = []
        for link in picked:
            cluster = link.icd11_code if re.search(r"[&/]", link.icd11_code) else None
            crosswalk.append(
                link_entry(relation, link.icd10_code, link.icd10_title_en, cluster, link.icd10_kind)
            )
            # The English ICD-10 titles of WHO's tables stay in the metadata (the card panel shows
            # them); the searchable text carries the codes only.
            text = f"- {link.icd10_code}"
            if cluster:
                described = "; ".join(
                    f"{part} — {title_text}" if title_text else part
                    for part, title_text in names.cluster_parts(cluster)
                )
                text += f"; код МКБ-11 с расширением: {cluster} ({described})"
            lines.append(text)
        crosswalk_body.add(heading)
        crosswalk_body.add(
            "\n".join(lines),
            mapping_marker(f"crosswalk-{relation}", table, [link.line for link in picked]),
        )
    if crosswalk_body.lines:
        body.extend([f"# {CROSSWALK_SECTION}", "", *crosswalk_body.lines])

    if entity.kind == "category":
        doc_title = f"{entity.code} {title}, МКБ-11 (ВОЗ)"
        short_title = f"{entity.code} {title} (МКБ-11)"
    elif entity.kind == "block":
        doc_title = f"Блок «{title}», МКБ-11 (ВОЗ)"
        short_title = f"Блок: {title} (МКБ-11)"
    else:
        doc_title = f"Глава {entity.chapter}. {title}, МКБ-11 (ВОЗ)"
        short_title = f"Глава {entity.chapter}. {title} (МКБ-11)"
    # Identity of the exact source rows (the paragraphs cite the same rows).
    source_basis: dict[str, object] = {
        "tabulationLine": entity.line,
        "tabulationSha256": tabulation_sha256,
        "mappingLines": sorted(
            [(link.table, link.line) for link in sources]
            + ([("11To10MapToOneCategory.txt", closest[0])] if closest else [])
        ),
        "mappingSha256": mapping_sha256,
    }
    if api is not None:
        source_basis["apiEntry"] = api.entry
        source_basis["apiEntrySha256"] = api.entry_sha256
        source_basis["apiArchiveSha256"] = api_archive_sha256
    checksum = hashlib.sha256(
        json.dumps(source_basis, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    # Raw-file checksums and the fetch time are recorded once, in the module's release report and
    # in the raw manifests; the per-entity `source_checksum` above binds the entity to them.
    metadata: dict[str, object] = {
        "id": document_id(entity.entity_id),
        "title": doc_title,
        "short_title": short_title,
        "version_label": f"who-{release}",
        "source_type": SOURCE_TYPE,
        "status": "active",
        "specialties": ["medical-reference"],
        "source_file": f"icd11/{release}",
        "source_checksum": f"sha256:{checksum}",
        "synthetic_fixture": False,
        "metadata": {
            "publisher": "ВОЗ (WHO)",
            "officialSourceUrl": url,
            "codingSystem": "icd-11",
            "icd11Release": release,
            "icd11Code": entity.code or None,
            "icd11ClassKind": entity.kind,
            "icd11Chapter": entity.chapter,
            "icd11TitleLanguage": "ru" if entity.title_ru else "en-source-only",
            "classificationPath": classification_path,
            "childDocuments": [
                {"documentId": document_id(item.entity_id), "label": names.label(item)}
                for item in kids
            ],
            "crosswalkIcd10": crosswalk,
            "requiresReview": True,
            "rightsStatus": LICENCE_ID,
            "publicationState": publication.state,
            "publicationDecision": publication.metadata(),
        },
    }
    # Derivable or empty values are left out: the foundation entity is the id's first part, the
    # English title is in the card text, and a false flag says nothing.
    extra: dict[str, object] = {}
    if entity.block_id:
        extra["icd11BlockId"] = entity.block_id
    if entity.residual:
        extra["icd11Residual"] = True
    metadata["metadata"].update(extra)  # type: ignore[attr-defined]
    front_matter = yaml.dump(
        metadata,
        Dumper=_YAML_DUMPER,
        allow_unicode=True,
        sort_keys=False,
        default_flow_style=False,
    ).rstrip()
    return document_id(entity.entity_id), f"---\n{front_matter}\n---\n\n" + "\n".join(body) + "\n"


def _distinct_terms(api: ApiEntityText, title: str) -> tuple[ApiText, ...]:
    """Index terms without the entity's own title (it is already the card's name)."""
    return tuple(item for item in api.index_terms if item.text.casefold() != title.casefold())


def _count_api_text(report: Icd11PrepareReport, api: ApiEntityText, title: str) -> None:
    for prop, count in api.served.items():
        bucket = report.api_text.setdefault(
            prop,
            {
                "served": 0,
                "kept": 0,
                "englishFallbackOmitted": 0,
                "unmarkedEnglishOmitted": 0,
                "provisional": 0,
            },
        )
        bucket["served"] += count
        bucket["kept"] += api.kept[prop]
        bucket["englishFallbackOmitted"] += api.omitted_fallback[prop]
        bucket["unmarkedEnglishOmitted"] += api.omitted_unmarked_foreign[prop]
        bucket["provisional"] += api.provisional[prop]
    present = {
        "definition": api.definition,
        "longDefinition": api.long_definition,
        "fullySpecifiedName": api.fully_specified_name,
        "codingNote": api.coding_note,
        "inclusion": api.inclusions,
        "exclusion": api.exclusions,
        "indexTerm": _distinct_terms(api, title),
        "foundationChildElsewhere": api.elsewhere,
    }
    for prop, value in present.items():
        if value:
            report.documents_with_api_text[prop] = report.documents_with_api_text.get(prop, 0) + 1


def _read_member(archive: Path, member: str) -> bytes:
    with zipfile.ZipFile(archive) as bundle:
        return bundle.read(member)


def _verified_files(raw_root: Path) -> tuple[dict[str, object], Path, Path]:
    manifest = json.loads((raw_root / MANIFEST_NAME).read_text(encoding="utf-8"))
    recorded = {str(item["name"]): str(item["sha256"]) for item in manifest["files"]}
    paths: dict[str, Path] = {}
    for name in (TABULATION_NAME, MAPPING_NAME):
        path = raw_root / name
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if recorded.get(name) != digest:
            raise ValueError(f"{name}: SHA-256 differs from the manifest")
        paths[name] = path
    return manifest, paths[TABULATION_NAME], paths[MAPPING_NAME]


def prepare_icd11(
    raw_root: Path,
    output: Path,
    publication: PublicationDecision,
    *,
    mkb10_database: Path | None = None,
    with_api_text: bool = True,
) -> Icd11PrepareReport:
    manifest, tabulation_zip, mapping_zip = _verified_files(raw_root)
    release = str(manifest["release"])
    tabulation_bytes = _read_member(tabulation_zip, TABULATION_MEMBER)
    tabulation_sha256 = hashlib.sha256(tabulation_bytes).hexdigest()
    entities = parse_tabulation(tabulation_bytes.decode("utf-8-sig"))
    mapping_digest = hashlib.sha256()
    mapping_files = {
        "11To10MapToOneCategory.txt": "closest",
        "10To11MapToOneCategory.txt": "mapped-into-this",
        "10To11MapToMultipleCategories.txt": "mapped-into-this-multiple",
    }
    texts: dict[str, str] = {}
    for name in mapping_files:
        payload = _read_member(mapping_zip, name)
        mapping_digest.update(name.encode() + hashlib.sha256(payload).digest())
        texts[name] = payload.decode("utf-8-sig")
    mapping_sha256 = mapping_digest.hexdigest()

    ids = {entity.entity_id for entity in entities}
    closest_by_entity = parse_mapping_11_to_10(texts["11To10MapToOneCategory.txt"])
    sources_by_entity: dict[str, list[Icd10Link]] = defaultdict(list)
    unmatched: dict[str, int] = {}
    for name, relation in mapping_files.items():
        if relation == "closest":
            unmatched[name] = sum(1 for key in closest_by_entity if key not in ids)
            continue
        missing = 0
        for entity_id, link in parse_mapping_10_to_11(texts[name], name, relation):
            if entity_id in ids:
                sources_by_entity[entity_id].append(link)
            else:
                missing += 1
        unmatched[name] = missing

    by_uri = {
        entity.foundation_uri: entity
        for entity in entities
        if entity.entity_id == entity.foundation_uri.rsplit("/", 1)[-1]
    }
    children: dict[str, list[Icd11Entity]] = defaultdict(list)
    for entity in entities:
        if entity.parent_uri is not None:
            if entity.parent_uri not in by_uri:
                raise ValueError(f"Line {entity.line}: parent {entity.parent_uri} is not a row")
            children[entity.parent_uri].append(entity)
    names = _Names(entities)
    icd10_ids = read_icd10_document_ids(mkb10_database)
    report = Icd11PrepareReport(release=release, mapping_rows_unmatched=unmatched)
    report.tabulation_sha256 = tabulation_sha256
    report.mapping_sha256 = mapping_sha256
    api_archive: ApiTextArchive | None = None
    if with_api_text:
        api_archive = load_api_text(raw_root, release)
        absent = ids - set(api_archive.entities)
        if absent:
            raise ValueError(f"{len(absent)} tabulation entities have no cached ICD-API answer")
        report.api_archive_sha256 = api_archive.archive_sha256
        report.api_container_image = api_archive.container_image
        report.api_data_release = api_archive.data_release
        report.api_entities = len(api_archive.entities)
    fetched_at = str(manifest["fetchedAt"])

    prepared: list[tuple[str, str]] = []
    for entity in entities:
        name, markdown = _entity_document(
            entity,
            release=release,
            entities_by_uri=by_uri,
            children=children,
            names=names,
            closest=closest_by_entity.get(entity.entity_id),
            sources=sources_by_entity.get(entity.entity_id, []),
            icd10_ids=icd10_ids,
            tabulation_member=TABULATION_MEMBER,
            tabulation_sha256=tabulation_sha256,
            mapping_sha256=mapping_sha256,
            api=api_archive.entities[entity.entity_id] if api_archive else None,
            api_archive_sha256=api_archive.archive_sha256 if api_archive else None,
            fetched_at=fetched_at,
            publication=publication,
            counters=report,
        )
        if api_archive:
            _count_api_text(report, api_archive.entities[entity.entity_id], names.title(entity))
        prepared.append((f"{name}.md", markdown))
        report.documents += 1
        report.chapters += entity.kind == "chapter"
        report.blocks += entity.kind == "block"
        report.categories += entity.kind == "category"
        report.russian_titles += entity.title_ru is not None
        report.english_only_titles += entity.title_ru is None
        report.entities_with_icd10_closest += entity.entity_id in closest_by_entity
        report.entities_with_icd10_sources += entity.entity_id in sources_by_entity
    if not prepared:
        raise ValueError("The tabulation contains no entities")

    output.parent.mkdir(parents=True, exist_ok=True)
    report.output = str(output)
    with tempfile.TemporaryDirectory(prefix=f".{output.name}.", dir=output.parent) as temporary:
        workspace = Path(temporary)
        for file_name, markdown in prepared:
            (workspace / file_name).write_text(markdown, encoding="utf-8")
        pack_manifest = {
            "id": PACK_ID,
            "version": f"0.1.0-{tabulation_sha256[:8]}{mapping_sha256[:4]}",
            "schemaVersion": 2,
            "title": f"МКБ-11 (ВОЗ), выпуск {release}, русская версия",
            "builtAt": fetched_at,
            "publicationState": "local-dev",
        }
        (workspace / "manifest.yaml").write_text(
            yaml.safe_dump(pack_manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (workspace / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
        (workspace / "prepare-report.json").write_text(
            json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        if output.exists():
            shutil.rmtree(output)
        workspace.rename(output)
    return report
