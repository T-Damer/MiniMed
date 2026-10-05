"""Deterministic preparer for official unified medical forms (docs/FORMS_PLAN.md).

The official publication of a Минздрав order (publication.pravo.gov.ru) is a scanned PDF. This
module fetches it with its provenance, recognises the text (macOS Vision, the repository's OCR
step), cuts the «Порядок заполнения» into numbered paragraphs with page/line source spans, and
assembles a form schema (`@localmed/contracts` `FormSchemaSchema`) from a reviewed per-form
blueprint (see `medical_form_070u`). Nothing is invented: a field the order does not define is
marked `undefined`, every printed label is checked against the OCR text of the blank page, and
every applied OCR correction is recorded in the schema.
"""

from __future__ import annotations

import argparse
import copy
import difflib
import hashlib
import importlib
import json
import pkgutil
import re
import subprocess
import urllib.parse
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Final

from localmed_ingest.medical_form_calibration import apply_calibration, load_calibration

REPO: Final = Path(__file__).resolve().parents[4]
DEFAULT_REGISTRY: Final = REPO / "tools/ingest/medical-form-sources.json"
DEFAULT_RAW: Final = REPO / "data/raw/medical-forms"
DEFAULT_SCHEMAS: Final = REPO / "apps/app/src/features/forms/schemas"
PRAVO_API: Final = "http://publication.pravo.gov.ru/api"
PRAVO_PDF: Final = "http://publication.pravo.gov.ru/file/pdf?eoNumber="
PRAVO_PAGE: Final = "http://publication.pravo.gov.ru/document/"
OCR_METHOD: Final = "macos-vision-ocr-v1"
# Rows of one printed line differ in height by less than this fraction of the page.
ROW_TOLERANCE: Final = 0.009
PAGE_NUMBER_MIN_Y: Final = 0.955
PAGE_HEADER_MIN_Y: Final = 0.94


class FormSourceError(RuntimeError):
    """The official source is missing or does not contain what the blueprint expects."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- source acquisition


def fetch_official_order(
    out_dir: Path, *, number: str, date: str, now: datetime | None = None
) -> dict[str, Any]:
    """Download the official PDF of an order and write `<eoNumber>.source.json` beside it."""
    query = urllib.parse.urlencode({"Number": number})
    with urllib.request.urlopen(f"{PRAVO_API}/Documents?{query}", timeout=60) as response:
        listing = json.load(response)
    matches = [
        item
        for item in listing.get("items", [])
        if str(item.get("documentDate", "")).startswith(date)
        and item.get("jdRegNumber")
        and "Министерства здравоохранения" in str(item.get("complexName", ""))
    ]
    if len(matches) != 1:
        raise FormSourceError(f"expected one order {number} of {date}, found {len(matches)}")
    item = matches[0]
    eo_number = str(item["eoNumber"])
    out_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = out_dir / f"{eo_number}.pdf"
    with urllib.request.urlopen(f"{PRAVO_PDF}{eo_number}", timeout=180) as response:
        payload = response.read()
    if not payload.startswith(b"%PDF"):
        raise FormSourceError("the official download is not a PDF")
    pdf_path.write_bytes(payload)
    retrieved = (now or datetime.now(UTC)).date().isoformat()
    record: dict[str, Any] = {
        "eoNumber": eo_number,
        "orderNumber": number,
        "orderDate": date,
        "complexName": item["complexName"],
        "registration": {"number": str(item["jdRegNumber"]), "date": item["jdRegDate"][:10]},
        "publicationUrl": f"{PRAVO_PAGE}{eo_number}",
        "pdfUrl": f"{PRAVO_PDF}{eo_number}",
        "pagesCount": item.get("pagesCount"),
        "retrievedAt": retrieved,
        "sha256": sha256_file(pdf_path),
        "bytes": len(payload),
    }
    (out_dir / f"{eo_number}.source.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return record


def run_ocr(pdf_path: Path, out_path: Path, swift_script: Path) -> None:
    """Recognise a scanned PDF with the repository's macOS Vision script."""
    completed = subprocess.run(
        ["swift", str(swift_script), str(pdf_path)],
        check=True,
        capture_output=True,
        text=True,
    )
    json.loads(completed.stdout)
    out_path.write_text(completed.stdout, encoding="utf-8")


# ------------------------------------------------------------------------------ OCR page rows


@dataclass(frozen=True)
class Fragment:
    text: str
    x: float
    y: float
    confidence: float


@dataclass(frozen=True)
class Row:
    """One printed line of a page, rebuilt from OCR fragments in reading order."""

    page: int
    index: int
    text: str
    x: float
    y: float
    confidence: float


@dataclass(frozen=True)
class Correction:
    page: int
    source: str
    replacement: str
    reason: str


# Systematic OCR confusions, applied everywhere and recorded each time they fire.
GENERIC_CORRECTIONS: Final[tuple[tuple[str, str, str], ...]] = (
    ("Nº", "№", "OCR renders № as Nº"),
    ("Ф3", "ФЗ", "OCR renders the Cyrillic З of «ФЗ» as 3"),
)
NOISE_FRAGMENT = re.compile(r"^[•·°*_|¤.,:;]+$")
LEADING_BULLET = re.compile(r"^[•·]\s*")


def load_ocr_pages(
    ocr_json: dict[str, Any], footnote_below: Mapping[int, float] | None = None
) -> dict[int, list[Fragment]]:
    """Fragments per page; text under `footnote_below[page]` (reviewed per page) is a footnote."""
    limits = footnote_below or {}
    pages: dict[int, list[Fragment]] = {}
    for page in ocr_json["pages"]:
        number = int(page["page"])
        fragments: list[Fragment] = []
        for line in page["lines"]:
            text = LEADING_BULLET.sub("", str(line["text"]).strip())
            if not text or NOISE_FRAGMENT.match(text):
                continue
            x, y, _width, height = line["bbox"]
            centre = float(y) + float(height) / 2
            if centre < limits.get(number, 0.0):
                continue
            fragments.append(Fragment(text, float(x), centre, float(line["confidence"])))
        pages[number] = fragments
    return pages


def build_rows(page: int, fragments: list[Fragment]) -> list[Row]:
    """Group fragments into printed lines (top to bottom, left to right within a line)."""
    ordered = sorted(fragments, key=lambda fragment: -fragment.y)
    groups: list[list[Fragment]] = []
    for fragment in ordered:
        if groups and abs(groups[-1][0].y - fragment.y) <= ROW_TOLERANCE:
            groups[-1].append(fragment)
        else:
            groups.append([fragment])
    rows: list[Row] = []
    for group in groups:
        group.sort(key=lambda fragment: fragment.x)
        text = " ".join(fragment.text for fragment in group)
        rows.append(
            Row(
                page=page,
                index=len(rows),
                text=text,
                x=group[0].x,
                y=sum(fragment.y for fragment in group) / len(group),
                confidence=min(fragment.confidence for fragment in group),
            )
        )
    return rows


def apply_corrections(rows: list[Row], applied: list[Correction]) -> list[Row]:
    """Apply the systematic substitutions row by row, logging each one."""
    result: list[Row] = []
    for row in rows:
        text = row.text
        for source, replacement, reason in GENERIC_CORRECTIONS:
            if source in text:
                text = text.replace(source, replacement)
                applied.append(Correction(row.page, source, replacement, reason))
        result.append(Row(row.page, row.index, text, row.x, row.y, row.confidence))
    return result


def apply_row_corrections(
    rows: list[Row], reviewed: tuple[Correction, ...], applied: list[Correction]
) -> list[Row]:
    """Apply the reviewed line-level substitutions that belong to the page of each row."""
    result: list[Row] = []
    for row in rows:
        text = row.text
        for correction in reviewed:
            if correction.page == row.page and correction.source in text:
                text = text.replace(correction.source, correction.replacement)
                applied.append(correction)
        result.append(Row(row.page, row.index, text, row.x, row.y, row.confidence))
    return result


def correct_text(
    text: str,
    pages: set[int],
    reviewed: tuple[Correction, ...],
    applied: list[Correction],
) -> str:
    """Apply the reviewed substitutions that belong to the pages a passage was cut from."""
    for correction in reviewed:
        if correction.page in pages and correction.source in text:
            text = text.replace(correction.source, correction.replacement)
            applied.append(correction)
    return text


def body_rows(rows: list[Row]) -> list[Row]:
    """Drop the running page number; row indices keep pointing into the full row list.

    The number sits above `PAGE_NUMBER_MIN_Y` on most pages; where a scan prints it a little lower
    (order 1094н), a row that is nothing but digits in the page header band is dropped as well.
    """
    return [
        row
        for row in rows
        if row.y < PAGE_NUMBER_MIN_Y and not (row.y > PAGE_HEADER_MIN_Y and row.text.isdigit())
    ]


# ------------------------------------------------------------------------------ paragraphs

PARAGRAPH_START = re.compile(r"^(\d{1,2}(?:\.\d{1,2})*)\.\s+\S")


@dataclass
class Paragraph:
    number: str
    rows: list[Row]

    @property
    def text(self) -> str:
        return join_rows([row.text for row in self.rows])

    def spans(self) -> list[dict[str, int]]:
        spans: list[dict[str, int]] = []
        for row in self.rows:
            if (
                spans
                and spans[-1]["pdfPage"] == row.page
                and row.index == spans[-1]["lastLine"] + 1
            ):
                spans[-1]["lastLine"] = row.index
            elif spans and spans[-1]["pdfPage"] == row.page and row.index <= spans[-1]["lastLine"]:
                continue
            else:
                spans.append({"pdfPage": row.page, "firstLine": row.index, "lastLine": row.index})
        return spans


def join_rows(lines: list[str]) -> str:
    """Join printed lines; a compound broken at a hyphen is re-joined without a space."""
    text = ""
    for line in lines:
        piece = line.strip()
        if not piece:
            continue
        if not text:
            text = piece
        elif text.endswith("-") and not text.endswith(" -") and piece[:1].islower():
            text += piece
        else:
            text += " " + piece
    return re.sub(r"\s+", " ", text).strip()


def split_paragraphs(rows: list[Row]) -> list[Paragraph]:
    paragraphs: list[Paragraph] = []
    for row in rows:
        match = PARAGRAPH_START.match(row.text)
        if match:
            paragraphs.append(Paragraph(match.group(1), [row]))
        elif paragraphs:
            paragraphs[-1].rows.append(row)
    return paragraphs


# An order whose «Порядок» lists items instead of numbered paragraphs (joint order 488н/551н):
# «10. При заполнении указываются: 1) в строке … 8) в подпунктах пункта 5 … в подпункте 5.1
# делается отметка …». Item `N)` of paragraph 10 becomes paragraph `10.N`, each «в подпункте X.Y
# делается …» line `10.N.X.Y` (the line «в подпунктах 9.2, 9.3 …» is one paragraph, under 9.2).
NUMBERED_ITEM_START = re.compile(r"^(\d{1,3})\)\s+\S")
SUBPOINT_START = re.compile(
    r"^(?:[вВ]\s+)?(?:под)?пункт(?:е|ах)\s+(\d{1,2}(?:\.\d{1,2})+)(?:\s*,\s*\d{1,2}(?:\.\d{1,2})+)*"
    r"\s+(?:дела|указыва|в\s+случае)"
)


def split_item_paragraphs(paragraph: Paragraph, parent: str) -> list[Paragraph]:
    """The introduction of `parent`, then its `N)` items and the sub-point lines under each."""
    result = [Paragraph(parent, [])]
    item = 0
    seen: set[str] = {parent}
    for row in paragraph.rows:
        number: str | None = None
        item_match = NUMBERED_ITEM_START.match(row.text)
        sub_match = SUBPOINT_START.match(row.text) if item else None
        if item_match:
            if int(item_match.group(1)) != item + 1:
                raise FormSourceError(
                    f"paragraph {parent}: item {item_match.group(1)}) follows item {item})"
                )
            item += 1
            number = f"{parent}.{item}"
        elif sub_match:
            number = f"{parent}.{item}.{sub_match.group(1)}"
        if number is None:
            result[-1].rows.append(row)
            continue
        if number in seen:
            raise FormSourceError(f"paragraph {number} occurs twice in the order text")
        seen.add(number)
        result.append(Paragraph(number, [row]))
    return result


# -------------------------------------------------------------------------------- code lists

ITEM_START = re.compile(r"^«\s*([^»]{1,8}?)\s*»\s*[-–—]\s*(.*)$")
CODE_LOOKALIKES: Final = str.maketrans(
    {
        "O": "0",
        "О": "0",
        "o": "0",
        "о": "0",
        "I": "1",
        "l": "1",
        "|": "1",
        "б": "6",
        "Б": "6",
        "/": "7",
        "]": "1",
    }
)


def normalise_code(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.translate(CODE_LOOKALIKES)).strip()


@dataclass(frozen=True)
class ListItem:
    code: str
    label: str
    page: int
    raw_code: str


def split_list(rows: list[Row]) -> tuple[list[Row], list[ListItem]]:
    """Split a paragraph's rows into the introduction and the «code» - name items.

    An item the printed list repeats verbatim (the official text lists «82» twice) is kept once.
    """
    intro: list[Row] = []
    items: list[tuple[str, str, int, list[str]]] = []
    for row in rows:
        match = ITEM_START.match(row.text)
        if match:
            raw = match.group(1)
            items.append((normalise_code(raw), raw, row.page, [match.group(2)]))
        elif items:
            items[-1][3].append(row.text)
        else:
            intro.append(row)
    result: list[ListItem] = []
    for code, raw, page, parts in items:
        item = ListItem(code, join_rows(parts).rstrip(";.,").strip(), page, raw)
        if result and (result[-1].code, result[-1].label) == (item.code, item.label):
            continue
        result.append(item)
    return intro, result


# -------------------------------------------------------------------------------- blueprints


@dataclass(frozen=True)
class RulesSection:
    """A further appendix of the order whose paragraphs a form cites (order 1094н: the blanks are
    in appendix 2, the requirements for their lines in appendices 1 and 3)."""

    appendix: int
    title: str
    pages: tuple[int, ...]


@dataclass(frozen=True)
class FormBlueprint:
    """A reviewed reading of one form's blank and the paragraphs of its «Порядок заполнения»."""

    form_id: str
    form_number: str
    title: str
    order_number: str
    order_date: str
    order_title: str
    registration: dict[str, str]
    effective_from: str
    effective_until: str | None
    blank_appendix: int
    blank_pages: tuple[int, ...]
    rules_appendix: int
    rules_pages: tuple[int, ...]
    footnote_below: dict[int, float]
    corrections: tuple[Correction, ...]
    fields: list[dict[str, Any]]
    code_lists: dict[str, str]
    sequential_lists: dict[str, int]
    sections: list[dict[str, Any]]
    layout: dict[str, Any]
    notes: list[str]
    # Reviewed fixes of whole printed lines (a garbled line, a lost dot after a paragraph number),
    # applied to the OCR rows of their page before the text is cut into paragraphs.
    row_corrections: tuple[Correction, ...] = ()
    # Printed captions the OCR dropped from the blank (a short word such as «дом» on a crowded
    # line) that a reviewer confirmed on the scan; each is recorded in the schema.
    scan_reviewed_captions: tuple[str, ...] = ()
    # Who issued the order (a joint order names both ministries) and what the edition line calls it.
    issuer: str = "Министерство здравоохранения Российской Федерации"
    issuer_short: str = "Минздрава России"
    # A paragraph number whose `N)` items and «в подпункте X.Y …» lines are cut into paragraphs
    # `<number>.N` and `<number>.N.X.Y` (see `split_item_paragraphs`).
    item_paragraphs: str | None = None
    # Added to the edition line, e.g. when the order names no entry-into-force date and the date
    # is taken from the general rule (the basis is stated in the text).
    edition_note: str | None = None
    # More than one appendix holds the requirements (`extra_rules`): paragraph ids are then
    # `<appendix>.<paragraph>` for every cited paragraph (the appendices number their paragraphs
    # independently), each schema paragraph names its appendix, and `rules_title` is the title of
    # the primary `rules_appendix`. Empty `extra_rules` keeps the single-appendix behaviour.
    extra_rules: tuple[RulesSection, ...] = ()
    rules_title: str = "Порядок заполнения"
    # Several forms may share one scan page (order 1094н prints a blank under the reverse side of
    # the previous one): per blank page, the (low, high) share of the page height, origin at the
    # bottom as in the OCR boxes, that belongs to this form. Captions are searched only there.
    blank_regions: dict[int, tuple[float, float]] = dataclass_field(default_factory=dict)

    @property
    def schema_filename(self) -> str:
        return f"{self.form_id.replace('.', '-')}.json"


def _letters(value: str) -> str:
    return re.sub(r"[^0-9a-zа-я]", "", value.lower().replace("ё", "е").replace("nº", "№"))


def anchor_found(anchor: str, page_text: str, threshold: float = 0.8) -> bool:
    """Whether a printed caption occurs in the OCR text of the blank, tolerating OCR slips."""
    needle = _letters(anchor)
    haystack = _letters(page_text)
    if not needle:
        raise FormSourceError("empty anchor")
    if needle in haystack:
        return True
    width = len(needle)
    best = 0.0
    for start in range(max(1, len(haystack) - width + 1)):
        window = haystack[start : start + width]
        ratio = difflib.SequenceMatcher(None, window, needle, autojunk=False).ratio()
        best = max(best, ratio)
        if best >= threshold:
            return True
    return False


def prepare_form(
    blueprint: FormBlueprint, source: dict[str, Any], ocr_path: Path
) -> dict[str, Any]:
    """Assemble the form schema JSON from the official OCR text and the reviewed blueprint."""
    ocr_json = json.loads(ocr_path.read_text(encoding="utf-8"))
    fragments = load_ocr_pages(ocr_json, blueprint.footnote_below)
    applied: list[Correction] = []
    rows_by_page: dict[int, list[Row]] = {}
    extra_pages = tuple(page for section in blueprint.extra_rules for page in section.pages)
    for page in (*blueprint.blank_pages, *blueprint.rules_pages, *extra_pages):
        if page not in fragments:
            raise FormSourceError(f"page {page} is missing from the OCR text")
        rows = apply_corrections(build_rows(page, fragments[page]), applied)
        rows_by_page[page] = apply_row_corrections(rows, blueprint.row_corrections, applied)

    unused = [correction for correction in blueprint.row_corrections if correction not in applied]
    if unused:
        raise FormSourceError(
            "reviewed line correction no longer applies (the source text changed?): "
            + "; ".join(f"p.{c.page} {c.source!r}" for c in unused)
        )

    blank_text = "\n".join(
        row.text
        for page in blueprint.blank_pages
        for row in rows_by_page[page]
        if _in_region(row.y, blueprint.blank_regions.get(page))
    )
    verified = 0
    scan_reviewed: list[str] = []
    for field in blueprint.fields:
        anchor = field.get("_anchor")
        if anchor is None:
            continue
        if anchor_found(str(anchor), blank_text):
            verified += 1
        elif str(anchor) in blueprint.scan_reviewed_captions:
            if str(anchor) not in scan_reviewed:
                scan_reviewed.append(str(anchor))
        else:
            raise FormSourceError(f"printed caption not found on the blank: {anchor!r}")

    sections = [
        RulesSection(blueprint.rules_appendix, blueprint.rules_title, blueprint.rules_pages),
        *blueprint.extra_rules,
    ]
    prefixed = bool(blueprint.extra_rules)
    paragraphs: dict[str, Paragraph] = {}
    appendix_of: dict[str, RulesSection] = {}
    for section in sections:
        body: list[Row] = []
        for page in section.pages:
            body.extend(body_rows(rows_by_page[page]))
        for paragraph in split_paragraphs(body):
            key = f"{section.appendix}.{paragraph.number}" if prefixed else paragraph.number
            paragraphs[key] = paragraph
            appendix_of[key] = section
    if blueprint.item_paragraphs:
        parent = paragraphs.get(blueprint.item_paragraphs)
        if parent is None:
            raise FormSourceError(f"paragraph {blueprint.item_paragraphs} not found in the order")
        for part in split_item_paragraphs(parent, blueprint.item_paragraphs):
            paragraphs[part.number] = part
            appendix_of[part.number] = appendix_of[blueprint.item_paragraphs]

    cited: list[str] = []
    for field in blueprint.fields:
        for paragraph_id in field["rule"]["paragraphIds"]:
            if paragraph_id not in paragraphs:
                raise FormSourceError(f"paragraph {paragraph_id} not found in the order text")
            if paragraph_id not in cited:
                cited.append(paragraph_id)
    cited.sort(key=lambda number: [int(part) for part in number.split(".")])

    options: dict[str, list[dict[str, str]]] = {}
    notes = list(blueprint.notes)
    rules: list[dict[str, Any]] = []
    for number in cited:
        paragraph = paragraphs[number]
        pages = {row.page for row in paragraph.rows}
        text = paragraph.text
        entry: dict[str, Any] = {"id": number}
        if prefixed:
            entry["appendix"] = {
                "number": appendix_of[number].appendix,
                "title": appendix_of[number].title,
            }
            entry["clause"] = paragraph.number
        if number in blueprint.code_lists.values():
            intro, items = split_list(paragraph.rows)
            text = join_rows([row.text for row in intro])
            items = [
                ListItem(
                    item.code,
                    correct_text(item.label, {item.page}, blueprint.corrections, applied),
                    item.page,
                    item.raw_code,
                )
                for item in items
            ]
            _check_list(number, items, blueprint.sequential_lists.get(number))
            for item in items:
                if item.code != item.raw_code:
                    applied.append(
                        Correction(
                            item.page,
                            f"«{item.raw_code}»",
                            f"«{item.code}»",
                            "OCR lookalike in a code",
                        )
                    )
            field_id = next(key for key, value in blueprint.code_lists.items() if value == number)
            options[field_id] = [{"value": item.code, "label": item.label} for item in items]
            entry["listItemCount"] = len(items)
        text = correct_text(text, pages, blueprint.corrections, applied)
        entry["text"] = text
        entry["spans"] = paragraph.spans()
        entry["textSha256"] = sha256_text(text)
        rules.append(entry)

    fields: list[dict[str, Any]] = []
    for blueprint_field in blueprint.fields:
        field = {key: value for key, value in blueprint_field.items() if not key.startswith("_")}
        if field["id"] in options:
            field["options"] = options[field["id"]]
        fields.append(field)

    corrections = sorted(
        {(c.page, c.source, c.replacement, c.reason) for c in applied},
    )
    source_block: dict[str, Any] = {
        "issuer": blueprint.issuer,
        "orderNumber": blueprint.order_number,
        "orderDate": blueprint.order_date,
        "orderTitle": blueprint.order_title,
        "registration": blueprint.registration,
        "effectiveFrom": blueprint.effective_from,
        **({"effectiveUntil": blueprint.effective_until} if blueprint.effective_until else {}),
        "publicationUrl": source["publicationUrl"],
        "pdfUrl": source["pdfUrl"],
        "retrievedAt": source["retrievedAt"],
        "sha256": source["sha256"],
        "pdfPages": int(ocr_json["pages"][-1]["page"]),
        "blankAppendix": {
            "number": blueprint.blank_appendix,
            "pdfPages": list(blueprint.blank_pages),
        },
        "rulesAppendix": {
            "number": blueprint.rules_appendix,
            "pdfPages": list(blueprint.rules_pages),
        },
        "extraction": {
            "method": OCR_METHOD,
            "ocrSha256": sha256_file(ocr_path),
            "corrections": [
                {"pdfPage": page, "from": src, "to": dst, "reason": reason}
                for page, src, dst, reason in corrections
            ],
            "blankLabelsVerified": verified,
            **({"captionsReviewedOnScan": scan_reviewed} if scan_reviewed else {}),
            "note": (
                "The official PDF is a scan without a text layer. Text recognised by macOS Vision; "
                "fragments are regrouped into printed lines (top to bottom, left to right) and "
                "footnotes under the per-page limits of the blueprint are dropped. Span line "
                "indices count these regrouped lines of each PDF page from 0. Corrections listed "
                "here were reviewed against the scan."
            ),
        },
    }
    undefined = [field["id"] for field in fields if field["rule"]["status"] == "undefined"]
    notes.append(
        "Поля, которые порядок не определяет (rule.status = undefined): "
        + ", ".join(undefined)
        + "."
    )
    return {
        "schemaVersion": 1,
        "id": blueprint.form_id,
        "formNumber": blueprint.form_number,
        "title": blueprint.title,
        "edition": (
            f"Приказ {blueprint.issuer_short} от {_ru_date(blueprint.order_date)} "
            f"№ {blueprint.order_number}, приложение № {blueprint.blank_appendix}; действует с "
            f"{_ru_date(blueprint.effective_from)}"
            + (f" по {_ru_date(blueprint.effective_until)}" if blueprint.effective_until else "")
            + (f" ({blueprint.edition_note})" if blueprint.edition_note else "")
        ),
        "source": source_block,
        "sections": blueprint.sections,
        "fields": fields,
        "rules": rules,
        "layout": apply_calibration(
            copy.deepcopy(blueprint.layout), load_calibration(blueprint.form_id)
        ),
        "notes": notes,
    }


def _in_region(y: float, region: tuple[float, float] | None) -> bool:
    return region is None or region[0] <= y <= region[1]


def _check_list(number: str, items: list[ListItem], sequential: int | None) -> None:
    codes = [item.code for item in items]
    if len(set(codes)) != len(codes):
        raise FormSourceError(f"paragraph {number}: duplicate code after normalisation")
    if sequential is not None:
        if codes != [str(index) for index in range(1, sequential + 1)]:
            raise FormSourceError(
                f"paragraph {number}: expected codes 1..{sequential}, got {codes}"
            )
        return
    numeric = [int(code) for code in codes if code.isdigit() and len(code) <= 2]
    if numeric != sorted(numeric):
        raise FormSourceError(f"paragraph {number}: codes are not ascending: {numeric}")
    if len(codes) < 80:
        raise FormSourceError(f"paragraph {number}: the list is incomplete ({len(codes)} items)")


def _ru_date(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day:02d}.{month:02d}.{year}"


# ------------------------------------------------------------------------------------- CLI


def _discover_blueprints() -> Mapping[str, str]:
    """Blueprint modules by form key: `medical_form_070u` is `070u`, `medical_form_025_1u` is
    `025-1u`. A new form is one new module; the registry (medical-form-sources.json) says which
    official order each key is built from."""
    found: dict[str, str] = {}
    package = importlib.import_module("localmed_ingest")
    for module in pkgutil.iter_modules(package.__path__):
        match = re.fullmatch(r"medical_form_(\d[0-9a-z_]*)", module.name)
        if match:
            found[match.group(1).replace("_", "-")] = f"localmed_ingest.{module.name}"
    return dict(sorted(found.items()))


FORM_BLUEPRINT_MODULES: Final[Mapping[str, str]] = _discover_blueprints()


def load_blueprint(name: str) -> FormBlueprint:
    module = FORM_BLUEPRINT_MODULES.get(name)
    if module is None:
        raise FormSourceError(f"unknown form {name!r}")
    # Duck-typed: when this file runs as `__main__` the dataclass is a distinct class object.
    blueprint: FormBlueprint = importlib.import_module(module).BLUEPRINT
    return blueprint


def write_schema(schema: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="medical_forms", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    fetch = sub.add_parser("fetch", help="download the official PDF with its provenance")
    fetch.add_argument("--number", default="274н")
    fetch.add_argument("--date", default="2025-05-13")
    fetch.add_argument("--out", type=Path, default=Path("data/raw/medical-forms"))
    ocr = sub.add_parser("ocr", help="recognise the scanned PDF (macOS Vision)")
    ocr.add_argument("--pdf", type=Path, required=True)
    ocr.add_argument("--out", type=Path, required=True)
    ocr.add_argument("--swift", type=Path, default=Path("tools/ingest/macos_vision_ocr.swift"))
    prepare = sub.add_parser(
        "prepare", help="build the form schema JSON files from the registry and the raw files"
    )
    prepare.add_argument("--form", default="all", help="form key (registry), or `all`")
    prepare.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    prepare.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    prepare.add_argument("--out-dir", type=Path, default=DEFAULT_SCHEMAS)
    args = parser.parse_args(argv)
    if args.command == "fetch":
        record = fetch_official_order(args.out, number=args.number, date=args.date)
        print(json.dumps(record, ensure_ascii=False, indent=2))
    elif args.command == "ocr":
        run_ocr(args.pdf, args.out, args.swift)
    else:
        registry = json.loads(args.registry.read_text(encoding="utf-8"))
        built = 0
        for entry in registry["sources"]:
            eo_number = entry["eoNumber"]
            source = json.loads((args.raw / f"{eo_number}.source.json").read_text(encoding="utf-8"))
            ocr_path = args.raw / f"{eo_number}.ocr.json"
            for form in entry["forms"]:
                if args.form not in ("all", form["key"]):
                    continue
                target = args.out_dir / form["schemaFile"]
                write_schema(prepare_form(load_blueprint(form["key"]), source, ocr_path), target)
                print(f"wrote {target}")
                built += 1
        if built == 0:
            parser.error(f"no form {args.form!r} in {args.registry}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
