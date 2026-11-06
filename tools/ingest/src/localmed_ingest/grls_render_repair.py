"""FIX-BATCH2: repairs of the prepared ГРЛС instructions that need no new OCR or PDF extraction.

The extraction JSON of every prepared instruction is kept next to its Markdown (`.localmed/
extractions/`), and the Markdown body is `render_body` of it. A change of the block rules therefore
reaches the modules by re-rendering the body from the stored extraction, as LEAF1 did for leaflet
contents lists (`grls_contents_lists.py`): the front matter is carried over byte for byte, the old
workspaces, the manifest and the PDFs are left alone, and a document whose stored extraction no
longer renders to its stored body is refused (`BodyNotReproducedError`).

The rules (an OCR audit of the 2 306 OCR texts by Haiku agents, 2026-11-06; FIX-BATCH1 findings):

* OCR texts: a heading that is no standard section title and reads as a registry stamp, requisites
  or scan noise becomes a paragraph (`demotedFrom: heading`) — the same rule `ocr_requality` now
  applies when it prepares a new OCR text («08103m90 • ОГРН 112189 Г. ЯРОС!»). Nothing is dropped.
  Also stamp words of the ministry copy, registration numbers printed as page headers, table rows
  (cells apart by « | ») and sentences starting in lower case, which the OCR promoted to headings.
* OCR texts: ATC and CYP codes spelled with Cyrillic look-alike letters (CYP3A4 read with a
  Cyrillic S, U, R and a Ze for the 3) are written in Latin; only a whole token that becomes a
  valid code changes, and the block keeps
  the original in `ocrCodeFixes`.
* Text-layer PDFs: a table the text layer holds cell by cell is marked `table_candidate` with
  `flattenedTable: true` (`pdf_import._mark_flattened_tables`); the text stays as extracted and the
  reader shows it as a table read from the page, not as a column of loose words.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from .grls_contents_lists import BodyNotReproducedError, split_prepared
from .grls_text_manifest import _text_digest  # pyright: ignore[reportPrivateUsage]
from .models import ExtractedBlock, ExtractedPage, ExtractedSource
from .ocr_requality import STAMP_REQUISITES
from .ocr_text_cleanup import standard_heading
from .pdf_import import _mark_flattened_tables  # pyright: ignore[reportPrivateUsage]
from .source_registry import render_body

OVERLAY_VERSION = 1

#: A heading of scan noise: no word of three letters, or more digits and signs than letters.
_LETTER = re.compile(r"[a-zа-яё]", re.IGNORECASE)
_WORD = re.compile(r"[a-zа-яё]{3,}", re.IGNORECASE)
#: Approval stamps and page headers of the ministry copy (Haiku audit, rare headings).
_STAMP_LEXICON = re.compile(
    r"МИНИСТЕРСТВ|МИНЗДРАВ|ЗДРАВООХРАН|СОГЛАСОВАН|ЭКСПЕРТ|ДЕЙСТВИТЕЛЕН|ВЕРСИ[ИЙЯ] ДОКУМЕНТ|"
    r"ПОСЛЕДОВАТЕЛЬНОСТ",
    re.IGNORECASE,
)
#: A registration number printed as a page header: ЛП-№(000577)-(РГ-RU)-160222.
_REGISTRATION_CODE = re.compile(r"^(?:ЛП|ЛСР|ЛС|П\s?N|J[IП1]+|ІСР|JIC)\S*[-\s№Nº#М]", re.IGNORECASE)


def is_junk_heading(text: str) -> bool:
    """A heading that is not a section title: a stamp, requisites or scan noise (OCR texts only)."""
    stripped = text.strip()
    if not stripped or standard_heading(stripped) is not None:
        return False
    if STAMP_REQUISITES.search(stripped) or _STAMP_LEXICON.search(stripped):
        return True
    if _REGISTRATION_CODE.search(stripped) and re.search(r"\d{4,}", stripped):
        return True
    # A table row (cells kept apart by « | ») or a sentence of the text that starts in lower case.
    if " | " in stripped or re.match(r"[а-яё]", stripped):
        return True
    if "\\" in stripped or (re.search(r"\d", stripped) and len(stripped) <= 14):
        return True
    letters = len(_LETTER.findall(stripped))
    return _WORD.search(stripped) is None or letters * 2 < len(stripped.replace(" ", ""))


#: Cyrillic look-alikes the OCR put into Latin drug codes; in a digit place, look-alike digits.
_LATIN = str.maketrans("АВСЕНКМОРТХУІ", "ABCEHKMOPTXYI")
_DIGIT = str.maketrans({"О": "0", "O": "0", "З": "3", "І": "1", "I": "1", "l": "1", "Б": "6"})
_CODE_CANDIDATE = re.compile(r"(?<![\w-])[A-ZА-ЯІ0-9]{6,7}(?![\w-])")
_ATC = re.compile(r"[ABCDGHJLMNPRSV]\d\d[A-Z][A-Z]\d\d")
_CYP = re.compile(r"CYP\d[A-Z]\d{1,2}")


def _as_code(token: str) -> str | None:
    """The ATC or CYP code a token spells with look-alike letters, ``None`` if it is none."""
    if token.isascii():
        return None
    if token[:3].translate(_LATIN) == "CYP":
        rest = token[3:]
        fixed = "CYP" + rest[0].translate(_DIGIT) + rest[1:2].translate(_LATIN)
        fixed += rest[2:].translate(_DIGIT)
        return fixed if _CYP.fullmatch(fixed) else None
    if len(token) != 7:
        return None
    fixed = (
        token[0].translate(_LATIN)
        + token[1:3].translate(_DIGIT)
        + token[3:5].translate(_LATIN)
        + token[5:7].translate(_DIGIT)
    )
    return fixed if _ATC.fullmatch(fixed) else None


def fix_codes(text: str) -> tuple[str, list[list[str]]]:
    """ATC and CYP codes written with Cyrillic look-alike letters, spelled in Latin.

    Only a whole token that becomes a valid code is rewritten; Russian words never match (an ATC
    code needs digits in fixed places, a CYP code the «CYP» prefix).
    """
    fixes: list[list[str]] = []

    def replace(match: re.Match[str]) -> str:
        code = _as_code(match.group(0))
        if code is None or code == match.group(0):
            return match.group(0)
        fixes.append([match.group(0), code])
        return code

    return _CODE_CANDIDATE.sub(replace, text), fixes


@dataclass
class RepairCounters:
    headings_demoted: int = 0
    flattened_table_blocks: int = 0
    codes_fixed: int = 0
    examples: list[str] = field(default_factory=lambda: list[str]())
    #: Every code rewritten, with its block: the overlay keeps them as the record of the change.
    code_fixes: list[dict[str, str]] = field(default_factory=lambda: list[dict[str, str]]())


def repair_page(page: ExtractedPage, *, ocr: bool, counters: RepairCounters) -> ExtractedPage:
    blocks = sorted(page.blocks, key=lambda item: item.order_index)
    repaired: list[ExtractedBlock] = []
    for block in blocks:
        if ocr and block.kind == "heading" and not block.removed and is_junk_heading(block.text):
            counters.headings_demoted += 1
            if len(counters.examples) < 40:
                counters.examples.append(block.text[:120])
            block = block.model_copy(
                update={
                    "kind": "paragraph",
                    "heading_level": None,
                    "metadata": {**block.metadata, "demotedFrom": "heading"},
                }
            )
        if ocr and not block.removed and block.kind != "page_mark":
            text, fixes = fix_codes(block.text)
            if fixes:
                counters.codes_fixed += len(fixes)
                counters.code_fixes.extend(
                    {"block": block.id, "from": before, "to": after} for before, after in fixes
                )
                block = block.model_copy(
                    update={"text": text, "metadata": {**block.metadata, "ocrCodeFixes": fixes}}
                )
        repaired.append(block)
    if not ocr:
        native_ids = {block.id for block in repaired}
        before = sum(1 for block in repaired if block.metadata.get("flattenedTable"))
        repaired = _mark_flattened_tables(repaired, native_ids)
        counters.flattened_table_blocks += (
            sum(1 for block in repaired if block.metadata.get("flattenedTable")) - before
        )
    return page.model_copy(update={"blocks": repaired})


def repair_extraction(extracted: ExtractedSource, counters: RepairCounters) -> ExtractedSource:
    diagnostics = extracted.diagnostics
    ocr_document = diagnostics.text_extraction_mode == "ocr"
    ocr_pages = set(diagnostics.ocr_pages)

    def page_is_ocr(page: ExtractedPage) -> bool:
        return ocr_document and (not ocr_pages or page.page in ocr_pages)

    return extracted.model_copy(
        update={
            "pages": [
                repair_page(page, ocr=page_is_ocr(page), counters=counters)
                for page in extracted.pages
            ]
        }
    )


@dataclass(frozen=True)
class Repaired:
    document_id: str
    markdown: str
    text_sha256: str
    text_sha256_before: str
    headings_demoted: int
    flattened_table_blocks: int
    codes_fixed: int
    code_fixes: tuple[dict[str, str], ...] = ()


def rerender_repaired(
    document_id: str, markdown: str, extracted: ExtractedSource
) -> Repaired | None:
    """The prepared Markdown with the repairs, ``None`` when nothing changes.

    The stored body must be what the stored extraction renders to (with or without leaflet contents
    lists, whichever the document was rendered with); otherwise ``BodyNotReproducedError``.
    """
    head, old_body = split_prepared(markdown)
    flag: bool | None = None
    for contents_lists in (True, False):
        if f"\n{render_body(extracted, source_id=document_id, contents_lists=contents_lists)}" == (
            old_body
        ):
            flag = contents_lists
            break
    if flag is None:
        raise BodyNotReproducedError(
            f"{document_id}: the stored extraction does not render to the stored Markdown."
        )
    counters = RepairCounters()
    body = render_body(
        repair_extraction(extracted, counters), source_id=document_id, contents_lists=flag
    )
    if f"\n{body}" == old_body:
        return None
    return Repaired(
        document_id=document_id,
        markdown=f"{head}\n{body}",
        text_sha256=_text_digest(body),
        text_sha256_before=_text_digest(old_body),
        headings_demoted=counters.headings_demoted,
        flattened_table_blocks=counters.flattened_table_blocks,
        codes_fixed=counters.codes_fixed,
        code_fixes=tuple(counters.code_fixes),
    )


def overlay_row(result: Repaired, workspace_label: str, source_workspace: str) -> dict[str, Any]:
    return {
        "overlayVersion": OVERLAY_VERSION,
        "sourceId": result.document_id,
        "workspace": workspace_label,
        "extractionWorkspace": source_workspace,
        "textSha256": result.text_sha256,
        "textSha256Before": result.text_sha256_before,
        "headingsDemoted": result.headings_demoted,
        "flattenedTableBlocks": result.flattened_table_blocks,
        "codesFixed": result.codes_fixed,
        "codeFixes": list(result.code_fixes),
    }


def read_overlay(path: Path) -> dict[str, dict[str, Any]]:
    """The overlay rows by document id; a missing file means no repaired document."""
    if not path.is_file():
        return {}
    return {
        str(row["sourceId"]): row
        for row in (
            cast(dict[str, Any], json.loads(line))
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        )
    }


def apply_overlay(
    rows: Sequence[Mapping[str, Any]], overlay: Mapping[str, Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """Applied last (after OCR1 and LEAF1): a repaired document takes its workspace and digest."""
    merged: list[dict[str, Any]] = []
    for row in rows:
        entry = dict(row)
        extra = overlay.get(str(row.get("sourceId")))
        if extra is not None and row.get("extraction") == "prepared":
            entry["workspace"] = extra["workspace"]
            entry["textSha256"] = extra["textSha256"]
            entry["repairOverlay"] = dict(extra)
        merged.append(entry)
    return merged


def summarize(results: Sequence[Repaired], failures: Sequence[Mapping[str, str]], total: int):
    counter = Counter[str]()
    for result in results:
        if result.headings_demoted:
            counter["documentsWithHeadingsDemoted"] += 1
            counter["headingsDemoted"] += result.headings_demoted
        if result.codes_fixed:
            counter["documentsWithCodesFixed"] += 1
            counter["codesFixed"] += result.codes_fixed
        if result.flattened_table_blocks:
            counter["documentsWithFlattenedTables"] += 1
            counter["flattenedTableBlocks"] += result.flattened_table_blocks
    return {
        "documents": total,
        "repaired": len(results),
        **dict(counter),
        "notReproduced": len(failures),
        "notReproducedExamples": list(failures[:10]),
    }
