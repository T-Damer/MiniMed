"""Prepared Markdown of the feeding-norms module: book-cited nutrition norms and formulas.

The Markdown in ``content/feeding-norms/`` is authored from books of the owner's private library
(national feeding programme, textbooks, a workbook, a neonatology textbook). Every verbatim block
is preceded by a ``localmed:source`` marker naming the book (``bookId``, declared with its SHA-256
in the document's ``sourceBooks``), the PDF pages and the section; editorial notes carry the
``editorial-note`` marker. Tables are GFM tables under such a marker, so every table row has a
citation. Table cells that the print merged across rows or columns repeat the merged value.

``prepare_feeding_norms`` validates that structure and writes ``manifest.yaml`` and
``aliases.yaml`` deterministically. ``verify_feeding_sources`` re-checks every verbatim block
against the text layer of the PDF in the private library (skipped by CI, which has no library).
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

import yaml

PACK_ID = "minimed.feeding.norms"
DOCUMENT_PREFIX = "reference.feeding."
SOURCE_TYPE = "medical_reference"
RIGHTS_STATUS = "personal-library-private-use"
TITLE = "Нормы питания: беременные, кормящие, дети"
BUILT_AT = "2026-10-13T00:00:00Z"
CONTENT_MODES = frozenset({"verbatim", "editorial", "editorial-note"})
_MARKER = re.compile(r"^<!-- localmed:source (\{.*\}) -->$")
CITATION_PREFIX = "*Источник: "
_PAGES = re.compile(r"^\d+(?:–\d+)?$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_YAML_DUMPER = getattr(yaml, "CSafeDumper", yaml.SafeDumper)


class FeedingSourceError(ValueError):
    """The prepared feeding-norms workspace violates the citation contract."""


@dataclass(frozen=True)
class DocumentReport:
    document_id: str
    title: str
    tables: int
    table_rows: int
    verbatim_blocks: int
    editorial_blocks: int
    books: tuple[str, ...]
    aliases: tuple[str, ...]


@dataclass(frozen=True)
class PrepareReport:
    documents: int
    tables: int
    table_rows: int
    verbatim_blocks: int
    editorial_blocks: int
    aliases: int
    books: list[str] = field(default_factory=lambda: [])
    version: str = ""
    output: str = ""


def split_front_matter(text: str, label: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---\n"):
        raise FeedingSourceError(f"{label}: no front matter")
    head, separator, body = text[4:].partition("\n---\n")
    if not separator:
        raise FeedingSourceError(f"{label}: unterminated front matter")
    loaded: object = yaml.safe_load(head)
    if not isinstance(loaded, dict):
        raise FeedingSourceError(f"{label}: front matter is not a mapping")
    return cast("dict[str, Any]", loaded), body


def _mapping(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise FeedingSourceError(f"{label} must be a mapping")
    return cast("dict[str, Any]", value)


def _text(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FeedingSourceError(f"{label} must be a non-empty string")
    return value


def _string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise FeedingSourceError(f"{label} must be a non-empty list")
    return [_text(item, label) for item in cast("list[object]", value)]


def check_document(path: Path) -> DocumentReport:
    """Validate one prepared document; return its counts."""
    label = path.name
    front, body = split_front_matter(path.read_text(encoding="utf-8"), label)
    document_id = _text(front.get("id"), f"{label} id")
    if document_id != path.stem or not document_id.startswith(DOCUMENT_PREFIX):
        raise FeedingSourceError(f"{label}: id {document_id} does not match the file name")
    if front.get("source_type") != SOURCE_TYPE:
        raise FeedingSourceError(f"{label}: source_type must be {SOURCE_TYPE}")
    if front.get("synthetic_fixture") is not False:
        raise FeedingSourceError(f"{label}: synthetic_fixture must be false")
    title = _text(front.get("title"), f"{label} title")
    metadata = _mapping(front.get("metadata"), f"{label} metadata")
    if metadata.get("rightsStatus") != RIGHTS_STATUS:
        raise FeedingSourceError(f"{label}: rightsStatus must be {RIGHTS_STATUS}")
    if metadata.get("localOnly"):
        raise FeedingSourceError(f"{label}: a local-only document cannot ship in a public module")
    aliases = _string_list(metadata.get("navigationAliases"), f"{label} navigationAliases")
    declared: dict[str, dict[str, Any]] = {}
    for item in cast("list[object]", metadata.get("sourceBooks") or []):
        book = _mapping(item, f"{label} sourceBook")
        book_id = _text(book.get("id"), f"{label} sourceBook id")
        _text(book.get("citation"), f"{label} {book_id} citation")
        _text(book.get("privateLibraryFile"), f"{label} {book_id} privateLibraryFile")
        if not _SHA256.match(_text(book.get("sha256"), f"{label} {book_id} sha256")):
            raise FeedingSourceError(f"{label}: {book_id} has no SHA-256")
        declared[book_id] = book
    if not declared:
        raise FeedingSourceError(f"{label}: no sourceBooks")
    checksum = _text(front.get("source_checksum"), f"{label} source_checksum")
    if not checksum.startswith("sha256:"):
        raise FeedingSourceError(f"{label}: source_checksum is not a SHA-256")

    editorial_document = metadata.get("contentMode") == "editorial"
    tables = table_rows = verbatim = editorial = 0
    current: dict[str, Any] | None = None
    used: list[str] = []
    in_table = False
    citation_due = False
    for number, line in enumerate(body.split("\n"), start=1):
        stripped = line.strip()
        marker = _MARKER.match(stripped)
        if marker:
            payload = _mapping(json.loads(marker.group(1)), f"{label}:{number} marker")
            mode = _text(payload.get("contentMode"), f"{label}:{number} contentMode")
            if mode not in CONTENT_MODES:
                raise FeedingSourceError(f"{label}:{number}: unknown contentMode {mode}")
            if mode == "verbatim":
                book_id = _text(payload.get("bookId"), f"{label}:{number} bookId")
                if book_id not in declared:
                    raise FeedingSourceError(f"{label}:{number}: book {book_id} is not declared")
                if not _PAGES.match(_text(payload.get("pdfPages"), f"{label}:{number} pdfPages")):
                    raise FeedingSourceError(f"{label}:{number}: bad pdfPages")
                _text(payload.get("sourceSection"), f"{label}:{number} sourceSection")
                verbatim += 1
                used.append(book_id)
            else:
                editorial += 1
            current = payload
            in_table = False
            citation_due = mode == "verbatim"
            continue
        if not stripped:
            in_table = False
            continue
        if citation_due:
            if not (stripped.startswith(CITATION_PREFIX) and stripped.endswith(".*")):
                raise FeedingSourceError(f"{label}:{number}: cited block without a visible source")
            citation_due = False
            continue
        if stripped.startswith("#"):
            current = None
            in_table = False
            continue
        if current is None:
            raise FeedingSourceError(f"{label}:{number}: content without a source marker")
        if stripped.startswith("|"):
            if not in_table:
                if current.get("contentMode") != "verbatim" and not editorial_document:
                    raise FeedingSourceError(f"{label}:{number}: table outside a cited block")
                tables += 1
                in_table = True
            elif not stripped.startswith("| ---"):
                table_rows += 1
        else:
            in_table = False
    if not editorial_document:
        if verbatim == 0:
            raise FeedingSourceError(f"{label}: no cited blocks")
        unused = sorted(set(declared) - set(used))
        if unused:
            raise FeedingSourceError(f"{label}: declared but never cited: {unused}")
    return DocumentReport(
        document_id,
        title,
        tables,
        table_rows,
        verbatim,
        editorial,
        tuple(sorted(declared)),
        tuple(aliases),
    )


def alias_rows(reports: list[DocumentReport]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for report in reports:
        key = report.document_id.removeprefix(DOCUMENT_PREFIX)
        for index, alias in enumerate(report.aliases):
            identity = (report.document_id, alias.casefold())
            if identity in seen:
                continue
            seen.add(identity)
            digest = hashlib.sha256(alias.casefold().encode()).hexdigest()[:10]
            rows.append(
                {
                    "id": f"feeding-{key}-{digest}",
                    "canonicalTerm": report.title,
                    "alias": alias,
                    "category": "reference",
                    "weight": 1.5 if index == 0 else 1.3,
                }
            )
    return rows


def prepare_feeding_norms(directory: Path) -> PrepareReport:
    """Validate ``directory`` and (re)write its manifest and aliases."""
    paths = sorted(directory.glob(f"{DOCUMENT_PREFIX}*.md"))
    if not paths:
        raise FeedingSourceError(f"{directory}: no {DOCUMENT_PREFIX}*.md documents")
    reports = [check_document(path) for path in paths]
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    version = f"0.1.0-{digest.hexdigest()[:8]}"
    aliases = alias_rows(reports)
    manifest = {
        "id": PACK_ID,
        "version": version,
        "schemaVersion": 2,
        "title": TITLE,
        "builtAt": BUILT_AT,
        "publicationState": "local-dev",
    }
    with tempfile.TemporaryDirectory(prefix=".feeding-norms.", dir=directory.parent) as temporary:
        staged = Path(temporary)
        (staged / "manifest.yaml").write_text(
            yaml.safe_dump(manifest, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )
        (staged / "aliases.yaml").write_text(
            yaml.dump(
                {"aliases": aliases},
                Dumper=_YAML_DUMPER,
                allow_unicode=True,
                sort_keys=False,
                width=1_000_000,
            ),
            encoding="utf-8",
        )
        for name in ("manifest.yaml", "aliases.yaml"):
            shutil.copyfile(staged / name, directory / name)
    books = sorted({book for report in reports for book in report.books})
    return PrepareReport(
        documents=len(reports),
        tables=sum(report.tables for report in reports),
        table_rows=sum(report.table_rows for report in reports),
        verbatim_blocks=sum(report.verbatim_blocks for report in reports),
        editorial_blocks=sum(report.editorial_blocks for report in reports),
        aliases=len(aliases),
        books=books,
        version=version,
        output=str(directory),
    )


def report_json(report: PrepareReport) -> str:
    return json.dumps(asdict(report), ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------------------------
# Verification against the private library (not run in CI)
# ---------------------------------------------------------------------------------------------

_DROP = re.compile(r"[\s­\-‐-―−-]")
_FURNITURE = re.compile(r"^(\d{1,3}|ГЛАВА \d+\..*|[А-ЯЁ0-9 .,\-–()]{12,})$")


def normalize(text: str) -> str:
    """Case-, space-, hyphen- and bullet-glyph-insensitive form used to compare with a PDF."""
    return _DROP.sub("", text.lower().replace("ё", "е"))


def table_cells(row: str) -> list[str]:
    inner = row.strip()[1:-1]
    return [cell.replace("\\|", "|").strip() for cell in re.split(r"(?<!\\)\|", inner)]


def _subsequence_in_window(needle: str, haystack: str, factor: int = 6) -> bool:
    """Needle's characters appear in order inside one short window (interleaved columns)."""
    if len(needle) < 6:
        return False
    head = needle[:4]
    start = 0
    while True:
        position = haystack.find(head, start)
        if position < 0:
            return False
        end = min(len(haystack), position + len(needle) * factor)
        cursor = position
        found = True
        for char in needle:
            cursor = haystack.find(char, cursor, end)
            if cursor < 0:
                found = False
                break
            cursor += 1
        if found:
            return True
        start = position + 1


def _spans_pages(text: str, page: str, page_clean: str) -> bool:
    """A paragraph is on the pages, possibly interrupted by a table or running heads."""
    wanted = normalize(text)
    if wanted in page or wanted in page_clean:
        return True
    for split in range(len(wanted) - 1, 20, -1):
        tail = wanted[split:]
        if len(tail) > 20 and wanted[:split] in page and tail in page:
            return True
    return False


def check_row(cells: list[str], page: str) -> str:
    """Return ``strict``, ``weak`` or ``fail`` for one table row against normalized page text."""
    if normalize("".join(cells)) in page:
        return "strict"
    for cell in cells:
        if not cell:
            continue
        for piece in re.split(r"; | / ", cell):
            wanted = normalize(piece)
            if wanted in page:
                continue
            words = [word for word in re.split(r"[\s()]+", piece) if word]
            if words and all(normalize(word) in page for word in words):
                continue
            if _subsequence_in_window(wanted, page):
                continue
            return "fail"
    return "weak"


@dataclass(frozen=True)
class VerifyReport:
    checked: int
    weak: int
    failures: list[str]
    scan_blocks: int = 0


def verify_feeding_sources(
    directory: Path,
    library: Path,
    *,
    read_page: Callable[[Path, int], str] | None = None,
) -> VerifyReport:
    """Check every verbatim block against the PDF text layer of its book in ``library``."""
    reader = read_page or _read_pdf_page
    checked = weak = scan_blocks = 0
    failures: list[str] = []
    for path in sorted(directory.glob(f"{DOCUMENT_PREFIX}*.md")):
        front, body = split_front_matter(path.read_text(encoding="utf-8"), path.name)
        scans = {
            str(book["id"])
            for book in cast(
                "list[dict[str, Any]]",
                _mapping(front["metadata"], path.name).get("sourceBooks") or [],
            )
            if book.get("textLayer") is False
        }
        books = {
            str(book["id"]): library / str(book["privateLibraryFile"])
            for book in cast(
                "list[dict[str, Any]]",
                _mapping(front["metadata"], path.name).get("sourceBooks") or [],
            )
        }
        page = page_clean = ""
        pending_caption: str | None = None
        active = False
        for number, line in enumerate(body.split("\n"), start=1):
            stripped = line.strip()
            marker = _MARKER.match(stripped)
            if marker:
                payload = _mapping(json.loads(marker.group(1)), path.name)
                active = payload.get("contentMode") == "verbatim"
                if active and str(payload.get("bookId")) in scans:
                    scan_blocks += 1  # a scan without a text layer: transcribed from the image
                    active = False
                    pending_caption = None
                    continue
                if not active:
                    pending_caption = None
                    continue
                first, _, last = str(payload["pdfPages"]).partition("–")
                pages = range(int(first), int(last or first) + 1)
                raw = "\n".join(reader(books[str(payload["bookId"])], index) for index in pages)
                page = normalize(raw)
                page_clean = normalize(
                    "\n".join(
                        text for text in raw.split("\n") if not _FURNITURE.match(text.strip())
                    )
                )
                if pending_caption is not None:
                    checked += 1
                    if not _spans_pages(pending_caption, page, page_clean):
                        failures.append(f"{path.name}:{number} caption: {pending_caption[:80]}")
                    pending_caption = None
                continue
            if stripped.startswith("#"):
                title = stripped.lstrip("#").strip()
                pending_caption = title if title.startswith("Таблица") else None
                active = False
                continue
            if not active or not stripped or stripped.startswith(("| ---", CITATION_PREFIX)):
                continue
            checked += 1
            if stripped.startswith("|"):
                outcome = check_row(table_cells(stripped), page)
                if outcome == "fail":
                    failures.append(f"{path.name}:{number} row: {stripped[:100]}")
                elif outcome == "weak":
                    weak += 1
                continue
            text = stripped[2:] if stripped.startswith("- ") else stripped
            if not _spans_pages(text, page, page_clean):
                failures.append(f"{path.name}:{number} text: {text[:100]}")
    return VerifyReport(checked, weak, failures, scan_blocks)


@lru_cache(maxsize=8)
def _open_pdf(pdf: Path) -> Any:
    import pymupdf

    return pymupdf.open(pdf)


def _read_pdf_page(pdf: Path, page_number: int) -> str:
    document = _open_pdf(pdf)
    return str(document[page_number - 1].get_text())
