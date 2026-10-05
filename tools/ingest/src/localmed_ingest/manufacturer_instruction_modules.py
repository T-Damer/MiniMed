"""Released manufacturer-site instruction module (M1 documents, owner decision D2 of 2026-10-05).

Pure planning and staging parts of `scripts/build_manufacturer_instruction_module.py`. Input is the
collector's `data/raw/manufacturer-instructions/manifest.jsonl` (one row per downloaded document
and page; a file reached from several pages has several rows) and, per site, the raw files and the
text the collector extracted (`<site>/text/<sha256>.json`).

What is shipped is ONE module of ONE source class (`manufacturer-site`): the holder's own document,
not a ГРЛС file, attached to the registrations it was matched to. Only the manifest's strict or
owner-accepted match levels count:

- `text-number`: the registration number is printed in the document;
- `page-number`: the number is printed on the holder's product page the file was linked from;
- `label-unique`: no number is printed (EAEU leaflets omit it); the trade name heads the document,
  the dosage form fits, the holder is named and exactly one missing registration fits.

`label-ambiguous` (two or more registrations fit) is never accepted: a document is attached to a
registration only through accepted matches, and one that has none is left out. The strongest and the
weakest level of a document are recorded, so a reader can see how the attachment was made.

PDFs go through the normal preparer (`medbase prepare`), so the body keeps its `localmed:source`
spans. A DOCX has no preparer: the collector's extracted text is written as a plain text file and
prepared as `format: text`; the text preparer finds headings by its own rules and the text itself is
neither summarised nor repaired. Staging changes only the front matter of the prepared Markdown.
"""

from __future__ import annotations

import json
import shutil
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import yaml

from .builder import build_content_pack
from .grls_groups import classify_document_kind
from .grls_instruction_modules import heading_json_escape_reason, split_front_matter
from .sqlite_builder import repository_root

REPO_ROOT = repository_root()
RAW_ROOT = REPO_ROOT / "data" / "raw" / "manufacturer-instructions"
MANIFEST_PATH = RAW_ROOT / "manifest.jsonl"

MODULE_ID = "minimed.medications.instructions.manufacturer-site.ru"
MODULE_TITLE = "Инструкции с сайтов производителей"
PACK_VERSION = "manufacturer-2026.10.05"
BUILT_AT = "2026-10-05T00:00:00Z"
SOURCE_CLASS = "manufacturer-site"
DOCUMENT_ID_PREFIX = "drug.rf.m1."
DOCUMENT_ID_SUFFIX = ".instruction"

#: Accepted match levels, strongest first (the order is the ranking).
ACCEPTED_LEVELS: tuple[str, ...] = ("text-number", "page-number", "label-unique")
REJECTED_LEVEL = "label-ambiguous"
#: Stable, short code of how a registration was attached, per match level.
MATCH_METHODS: Mapping[str, str] = {
    "text-number": "number-in-text",
    "page-number": "number-on-page",
    "label-unique": "name-form-holder",
}

KIND_TITLE_SUFFIX = {
    "leaflet": "листок-вкладыш",
    "ohlp": "общая характеристика лекарственного препарата (ОХЛП)",
}
GENERATED_TITLE_SUFFIX = ": инструкция по медицинскому применению"
FILE_NAME_DATE_PREFIX = "file name date "
#: A printed revision entry becomes the human label only when it reads like a registration stamp or
#: a revision statement (not, say, the date of a law the text refers to).
_REVISION_MARKERS = ("РГ-RU", "ЛП-", "ЛП№", "пересмотр", "редакц", "верси", "Изм")
TEXT_DIR = "docx-text"


def level_rank(level: str) -> int:
    return ACCEPTED_LEVELS.index(level)


def _text(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _mapping_list(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [cast(Mapping[str, Any], item) for item in items if isinstance(item, dict)]


def _mapping(value: object) -> Mapping[str, Any]:
    return cast(Mapping[str, Any], value) if isinstance(value, dict) else {}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    items = cast(list[object], value)
    return [item for item in items if isinstance(item, str)]


@dataclass(frozen=True)
class AcceptedMatch:
    """One registration a document is attached to, with the strongest evidence recorded for it."""

    registration_number: str
    trade_name: str
    match_level: str
    evidence: Mapping[str, Any]

    def to_json(self) -> dict[str, Any]:
        return {
            "registrationNumber": self.registration_number,
            "tradeName": self.trade_name,
            "matchLevel": self.match_level,
            "evidence": dict(self.evidence),
        }

    @property
    def sort_key(self) -> tuple[int, str]:
        return level_rank(self.match_level), self.registration_number


@dataclass(frozen=True)
class PlannedDocument:
    """One unique file and every registration it is accepted for."""

    document_id: str
    sha256: str
    site: str
    raw_path: str
    file_format: str
    matches: tuple[AcceptedMatch, ...]
    #: Every manifest row naming this file, oldest first (the last one is the newest).
    rows: tuple[Mapping[str, Any], ...]

    @property
    def newest(self) -> Mapping[str, Any]:
        return self.rows[-1]

    @property
    def primary(self) -> AcceptedMatch:
        return self.matches[0]

    @property
    def registration_numbers(self) -> tuple[str, ...]:
        return tuple(sorted(match.registration_number for match in self.matches))

    @property
    def weakest_level(self) -> str:
        return max((match.match_level for match in self.matches), key=level_rank)

    @property
    def strongest_level(self) -> str:
        return self.matches[0].match_level

    @property
    def source_path(self) -> str:
        """Path under the registry's source root (`data/raw/manufacturer-instructions`)."""
        return f"{self.site}/files/{self.sha256_hex}.{self.file_format}"

    @property
    def sha256_hex(self) -> str:
        return self.sha256.removeprefix("sha256:")

    @property
    def text_cache_path(self) -> str:
        return f"{self.site}/text/{self.sha256_hex}.json"

    @property
    def text_source_path(self) -> str:
        return f"{TEXT_DIR}/{self.sha256_hex}.txt"

    @property
    def prepared_as_text(self) -> bool:
        return self.file_format != "pdf"


def document_id(sha256: str) -> str:
    digest = sha256.removeprefix("sha256:")
    return f"{DOCUMENT_ID_PREFIX}{digest[:20]}{DOCUMENT_ID_SUFFIX}"


def read_manifest_rows(path: Path = MANIFEST_PATH) -> list[dict[str, Any]]:
    return [
        cast(dict[str, Any], json.loads(line))
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _file_format(row: Mapping[str, Any]) -> str:
    raw_path = str(row["rawPath"])
    suffix = raw_path.rsplit(".", 1)[-1].lower()
    if suffix not in {"pdf", "docx"}:
        raise ValueError(f"Unsupported manufacturer document type: {raw_path}")
    return suffix


def _merge_matches(rows: Sequence[Mapping[str, Any]]) -> list[AcceptedMatch]:
    """Accepted matches of one file: per registration the strongest accepted level wins."""
    best: dict[str, AcceptedMatch] = {}
    for row in rows:
        for raw in _mapping_list(row.get("matches")):
            level = raw.get("matchLevel")
            number = _text(raw.get("registrationNumber"))
            if level not in ACCEPTED_LEVELS or number is None:
                continue
            candidate = AcceptedMatch(
                registration_number=number,
                trade_name=str(raw.get("tradeName") or ""),
                match_level=str(level),
                evidence=cast(Mapping[str, Any], raw.get("evidence") or {}),
            )
            current = best.get(number)
            if current is None or candidate.sort_key < current.sort_key:
                best[number] = candidate
    return sorted(best.values(), key=lambda match: match.sort_key)


@dataclass(frozen=True)
class ManufacturerPlan:
    documents: tuple[PlannedDocument, ...]
    #: Files with no accepted match: (sha256, site, registrations of their ambiguous matches).
    unattached_files: tuple[dict[str, Any], ...]
    #: Registrations that only ever matched ambiguously.
    ambiguous_only: tuple[str, ...]
    rows: int


def plan_documents(rows: Sequence[Mapping[str, Any]]) -> ManufacturerPlan:
    by_sha: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        by_sha[str(row["sha256"])].append(row)
    documents: list[PlannedDocument] = []
    unattached: list[dict[str, Any]] = []
    accepted_numbers: set[str] = set()
    ambiguous_numbers: set[str] = set()
    for sha in sorted(by_sha):
        file_rows = sorted(
            by_sha[sha], key=lambda r: (str(r.get("fetchedAt") or ""), str(r.get("sourceUrl")))
        )
        for field in ("rawPath", "site"):
            if len({str(r[field]) for r in file_rows}) != 1:
                raise ValueError(f"{sha} has rows with different {field} values.")
        matches = _merge_matches(file_rows)
        ambiguous = sorted(
            {
                str(raw["registrationNumber"])
                for row in file_rows
                for raw in _mapping_list(row.get("matches"))
                if raw.get("matchLevel") == REJECTED_LEVEL
            }
        )
        ambiguous_numbers.update(ambiguous)
        if not matches:
            unattached.append(
                {
                    "sha256": sha,
                    "site": str(file_rows[0]["site"]),
                    "reason": "no accepted match (only label-ambiguous)",
                    "ambiguousRegistrationNumbers": ambiguous,
                }
            )
            continue
        accepted_numbers.update(match.registration_number for match in matches)
        documents.append(
            PlannedDocument(
                document_id=document_id(sha),
                sha256=sha,
                site=str(file_rows[0]["site"]),
                raw_path=str(file_rows[0]["rawPath"]),
                file_format=_file_format(file_rows[0]),
                matches=tuple(matches),
                rows=tuple(file_rows),
            )
        )
    ids = [document.document_id for document in documents]
    if len(ids) != len(set(ids)):
        raise ValueError("Two manufacturer files share the first 20 hex digits of their sha256.")
    return ManufacturerPlan(
        documents=tuple(documents),
        unattached_files=tuple(unattached),
        ambiguous_only=tuple(sorted(ambiguous_numbers - accepted_numbers)),
        rows=len(rows),
    )


def registration_levels(plan: ManufacturerPlan) -> dict[str, str]:
    """Accepted registration -> its strongest accepted level over every document."""
    best: dict[str, str] = {}
    for document in plan.documents:
        for match in document.matches:
            current = best.get(match.registration_number)
            if current is None or level_rank(match.match_level) < level_rank(current):
                best[match.registration_number] = match.match_level
    return best


def _printed_revisions(revisions: Sequence[str]) -> list[str]:
    return [item for item in revisions if not item.startswith(FILE_NAME_DATE_PREFIX)]


def instruction_label(revisions: Sequence[str]) -> str | None:
    """A short label only when a revision/date statement was printed in the document itself."""
    for item in _printed_revisions(revisions):
        if not any(marker in item for marker in _REVISION_MARKERS):
            continue
        date = item.rsplit(" ", 1)[-1]
        if len(date) == 10 and date[2] == "." and date[5] == ".":
            return f"Дата в документе: {date}"
    return None


def _distinct(rows: Sequence[Mapping[str, Any]], field: str) -> list[str]:
    seen: list[str] = []
    for row in rows:
        value = _text(row.get(field))
        if value is not None and value not in seen:
            seen.append(value)
    return seen


def registry_source(document: PlannedDocument) -> dict[str, Any]:
    """One `medbase prepare` registry entry: everything here is read from the manifest."""
    newest = document.newest
    primary = document.primary
    trade_name = primary.trade_name
    source_url = _text(newest.get("sourceUrl"))
    mode = _text(newest.get("textExtractionMode"))
    revisions = _string_list(newest.get("documentRevision"))
    metadata: dict[str, Any] = {
        "sourceClass": SOURCE_CLASS,
        "publisher": newest.get("publisher"),
        "site": document.site,
        "tradeName": trade_name,
        "registrationNumber": primary.registration_number,
        "registrationNumbers": list(document.registration_numbers),
        "registrationMatches": [match.to_json() for match in document.matches],
        "matchLevel": document.weakest_level,
        "matchMethod": MATCH_METHODS[document.weakest_level],
        "officialSourceUrl": source_url
        if source_url and source_url.startswith("https://")
        else None,
        "pageUrl": newest.get("pageUrl"),
        "fetchedAt": newest.get("fetchedAt"),
        "httpLastModified": newest.get("httpLastModified"),
        "documentRevision": revisions or None,
        "instructionLabel": instruction_label(revisions),
        "pdfSha256": document.sha256,
        "fileFormat": document.file_format,
        "rawPath": document.raw_path,
        "ocr": mode == "ocr",
        "textExtractionMode": mode,
        "ocrEngine": newest.get("ocrEngine"),
        "ocrMeanConfidence": newest.get("ocrMeanConfidence"),
    }
    source_urls = _distinct(document.rows, "sourceUrl")
    page_urls = _distinct(document.rows, "pageUrl")
    if len(source_urls) > 1:
        metadata["sourceUrls"] = source_urls
    if len(page_urls) > 1:
        metadata["pageUrls"] = page_urls
    return {
        "id": document.document_id,
        "path": document.text_source_path if document.prepared_as_text else document.source_path,
        "title": f"{trade_name}{GENERATED_TITLE_SUFFIX}",
        "shortTitle": trade_name,
        "versionLabel": f"manufacturer-site-{str(newest.get('fetchedAt') or '')[:10]}",
        "sourceType": "official_drug_instruction",
        "status": "active",
        "format": "text" if document.prepared_as_text else "pdf",
        "metadata": {key: value for key, value in metadata.items() if value is not None},
    }


def registry_payload(documents: Sequence[PlannedDocument]) -> dict[str, Any]:
    return {
        "pack": {
            "id": MODULE_ID,
            "version": PACK_VERSION,
            "schemaVersion": 2,
            "title": MODULE_TITLE,
            "builtAt": BUILT_AT,
        },
        "sources": [registry_source(document) for document in documents],
    }


def write_registries(
    plan: ManufacturerPlan, workspace: Path, raw_root: Path = RAW_ROOT
) -> dict[str, Any]:
    """`registry-pdf.yaml` (source root: the raw root) and `registry-text.yaml` + `docx-text/`
    (source root: the workspace) for `medbase prepare`."""
    workspace.mkdir(parents=True, exist_ok=True)
    text_dir = workspace / TEXT_DIR
    text_dir.mkdir(exist_ok=True)
    pdfs = [document for document in plan.documents if not document.prepared_as_text]
    texts = [document for document in plan.documents if document.prepared_as_text]
    for document in texts:
        cache = cast(
            Mapping[str, Any],
            json.loads((raw_root / document.text_cache_path).read_text(encoding="utf-8")),
        )
        body = cache.get("text")
        if not isinstance(body, str) or not body.strip():
            raise ValueError(f"{document.text_cache_path} has no extracted text.")
        (workspace / document.text_source_path).write_text(body, encoding="utf-8")
    for document in pdfs:
        if not (raw_root / document.source_path).is_file():
            raise FileNotFoundError(raw_root / document.source_path)
    for name, group in (("registry-pdf.yaml", pdfs), ("registry-text.yaml", texts)):
        if group:
            (workspace / name).write_text(
                yaml.safe_dump(
                    registry_payload(group),
                    allow_unicode=True,
                    sort_keys=False,
                    width=1_000_000,
                ),
                encoding="utf-8",
            )
    return {"pdf": len(pdfs), "text": len(texts), "workspace": str(workspace)}


def augmented_markdown(text: str, document: PlannedDocument) -> str:
    """Front matter of a prepared document, completed; the body is carried over byte for byte."""
    front, body = split_front_matter(text)
    existing = front.get("metadata")
    metadata: dict[str, Any] = cast(dict[str, Any], existing) if isinstance(existing, dict) else {}
    quality = _mapping(metadata.get("extraction"))
    kind = classify_document_kind(body)
    added: dict[str, Any] = {
        "documentKind": kind,
        "qualityScore": quality.get("qualityScore"),
        "ocrLowConfidenceRatio": quality.get("ocrLowConfidenceRatio"),
        "pdfPageCount": quality.get("pageCount") if document.file_format == "pdf" else None,
    }
    for key, value in added.items():
        if value is not None:
            metadata[key] = value
    # `sourcePath` is where the preparer read it (for a DOCX the extracted text file): the raw
    # file is `rawPath` and `pdfSha256`.
    front["metadata"] = metadata
    title = front.get("title")
    suffix = KIND_TITLE_SUFFIX.get(kind)
    if suffix and isinstance(title, str) and title.endswith(GENERATED_TITLE_SUFFIX):
        front["title"] = f"{title[: -len(GENERATED_TITLE_SUFFIX)]}: {suffix}"
    rendered = yaml.safe_dump(
        front, allow_unicode=True, sort_keys=False, width=1_000_000, default_flow_style=False
    )
    return f"---\n{rendered}---\n{body}"


def prepared_markdown_path(prepared_dirs: Sequence[Path], document: PlannedDocument) -> Path | None:
    for directory in prepared_dirs:
        candidate = directory / f"{document.document_id}.md"
        if candidate.is_file():
            return candidate
    return None


def stage_module(
    stage: Path, documents: Sequence[PlannedDocument], paths: Mapping[str, Path]
) -> None:
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    (stage / "manifest.yaml").write_text(
        yaml.safe_dump(
            {
                "id": MODULE_ID,
                "version": PACK_VERSION,
                "schemaVersion": 2,
                "title": MODULE_TITLE,
                "builtAt": BUILT_AT,
                "publicationState": "local-dev",
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (stage / "aliases.yaml").write_text("aliases: []\n", encoding="utf-8")
    for document in documents:
        source = paths[document.document_id].read_text(encoding="utf-8")
        (stage / f"{document.document_id}.md").write_text(
            augmented_markdown(source, document), encoding="utf-8"
        )


def build_module(
    out: Path, plan: ManufacturerPlan, prepared_dirs: Sequence[Path]
) -> dict[str, Any]:
    """Stage the prepared documents, build the lexical-only pack and write the report."""
    stage = out / ".stage"
    raw_dir = out / "raw"
    report_dir = out / "reports"
    raw_dir.mkdir(parents=True, exist_ok=True)
    report_dir.mkdir(parents=True, exist_ok=True)
    database = raw_dir / f"{MODULE_ID}.db"
    if database.exists():
        database.unlink()
    excluded: list[dict[str, str]] = []
    paths: dict[str, Path] = {}
    kept: list[PlannedDocument] = []
    for document in plan.documents:
        path = prepared_markdown_path(prepared_dirs, document)
        if path is None:
            excluded.append(
                {
                    "documentId": document.document_id,
                    "reason": "the preparer produced no Markdown (no searchable text)",
                }
            )
            continue
        reason = heading_json_escape_reason(path)
        if reason is not None:
            excluded.append({"documentId": document.document_id, "reason": reason})
            continue
        paths[document.document_id] = path
        kept.append(document)
    build_report = None
    try:
        for _attempt in range(6):
            stage_module(stage, kept, paths)
            try:
                _pack, build_report = build_content_pack(
                    stage,
                    database,
                    report_path=report_dir / f"{MODULE_ID}.build.json",
                    include_embeddings=False,
                )
                break
            except ValueError as error:
                message = str(error)
                offenders: list[tuple[str, str]] = []
                if message.startswith("Content lint failed:"):
                    for line in message.splitlines()[1:]:
                        identifier, _, reason = line.partition(": ")
                        if any(item.document_id == identifier for item in kept):
                            offenders.append((identifier, reason or line))
                if not offenders:
                    raise
                bad = {identifier for identifier, _ in offenders}
                excluded.extend({"documentId": i, "reason": r} for i, r in offenders)
                kept = [item for item in kept if item.document_id not in bad]
                if database.exists():
                    database.unlink()
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    if build_report is None:
        raise RuntimeError("every attempt failed lint")
    kinds = {
        document.document_id: classify_document_kind(
            split_front_matter(paths[document.document_id].read_text(encoding="utf-8"))[1]
        )
        for document in kept
    }
    result = module_report(plan, kept, excluded, kinds)
    result.update(
        {
            "documents": build_report.documents,
            "sections": build_report.sections,
            "chunks": build_report.chunks,
            "sqliteIntegrity": build_report.sqlite_integrity,
            "outputChecksum": build_report.output_checksum,
            "sizeBytes": database.stat().st_size,
        }
    )
    (report_dir / f"{MODULE_ID}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return result


def _document_summary(document: PlannedDocument, kind: str | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "site": document.site,
        "registrationNumbers": list(document.registration_numbers),
        "matchLevel": document.weakest_level,
        "matchMethod": MATCH_METHODS[document.weakest_level],
        "fileFormat": document.file_format,
    }
    if kind is not None:
        entry["documentKind"] = kind
    return entry


def module_report(
    plan: ManufacturerPlan,
    kept: Sequence[PlannedDocument],
    excluded: Sequence[Mapping[str, str]],
    kinds: Mapping[str, str],
) -> dict[str, Any]:
    kept_ids = {document.document_id for document in kept}
    shipped = [document for document in plan.documents if document.document_id in kept_ids]
    shipped_plan = ManufacturerPlan(
        documents=tuple(shipped),
        unattached_files=plan.unattached_files,
        ambiguous_only=plan.ambiguous_only,
        rows=plan.rows,
    )
    levels = registration_levels(shipped_plan)
    return {
        "moduleId": MODULE_ID,
        "version": PACK_VERSION,
        "sourceClass": SOURCE_CLASS,
        "manifestRows": plan.rows,
        "excluded": list(excluded),
        "leftOut": {
            "filesWithoutAcceptedMatch": list(plan.unattached_files),
            "ambiguousOnlyRegistrations": list(plan.ambiguous_only),
        },
        "registrations": len(levels),
        "registrationsByLevel": {
            level: sum(1 for value in levels.values() if value == level)
            for level in ACCEPTED_LEVELS
        },
        "documentsByWeakestLevel": dict(Counter(d.weakest_level for d in shipped)),
        "documentsBySite": dict(sorted(Counter(d.site for d in shipped).items())),
        "documentsByFormat": dict(sorted(Counter(d.file_format for d in shipped).items())),
        "documentsByKind": dict(sorted(Counter(kinds[i] for i in kept_ids).items())),
        "documentIds": sorted(kept_ids),
        "documentSummaries": {
            document.document_id: _document_summary(document, kinds[document.document_id])
            for document in shipped
        },
    }


def summarize(plan: ManufacturerPlan) -> dict[str, Any]:
    levels = registration_levels(plan)
    pairs: Counter[str] = Counter()
    for document in plan.documents:
        for match in document.matches:
            pairs[match.match_level] += 1
    return {
        "manifestRows": plan.rows,
        "documents": len(plan.documents),
        "registrations": len(levels),
        "registrationsByLevel": {
            level: sum(1 for value in levels.values() if value == level)
            for level in ACCEPTED_LEVELS
        },
        "registrationDocumentPairsByLevel": {level: pairs[level] for level in ACCEPTED_LEVELS},
        "documentsByWeakestLevel": dict(Counter(d.weakest_level for d in plan.documents)),
        "documentsBySite": dict(sorted(Counter(d.site for d in plan.documents).items())),
        "documentsByFormat": dict(sorted(Counter(d.file_format for d in plan.documents).items())),
        "registrationsBySite": {
            site: len(
                {
                    match.registration_number
                    for document in plan.documents
                    if document.site == site
                    for match in document.matches
                }
            )
            for site in sorted({document.site for document in plan.documents})
        },
        "filesWithoutAcceptedMatch": list(plan.unattached_files),
        "ambiguousOnlyRegistrations": list(plan.ambiguous_only),
    }
