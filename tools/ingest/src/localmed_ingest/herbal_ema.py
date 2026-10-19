"""EMA/HMPC facts of the herbal book: the reviewed extraction files and their quote check.

The EMA monographs and assessment reports are English. The book shows limits, doses and
constituent effects as short Russian structured fields; every field carries the exact English
sentence it came from (shown on tap) and the PDF page. ``content/herbal/ema/<plant>.yaml`` is a
separate draft artifact (status ``proposed``): it is written by a reader, never by the build, and
``validate_ema_extraction`` refuses any quote that is not on the cited page of the downloaded PDF,
and any number in a Russian field that the quote does not contain.
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import pymupdf
import yaml
from pydantic import BaseModel, ConfigDict, Field

EmaDocument = Literal["monograph", "public-statement", "assessment-report", "summary"]
FactKind = Literal[
    "use-type",
    "indication",
    "posology",
    "age",
    "duration",
    "contraindication",
    "pregnancy",
    "lactation",
    "interaction",
    "warning",
    "adverse",
    "overdose",
    "statement",
    "lookalike",
]
Evidence = Literal["clinical", "animal", "in-vitro", "traditional", "review"]
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
_DASHES = str.maketrans(
    {"–": "-", "—": "-", "‑": "-", "−": "-", "’": "'", "‘": "'", "“": '"', "”": '"'}
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Quote(_Strict):
    doc: EmaDocument
    page: int = Field(ge=1)
    quote: str = Field(min_length=12)


class Dose(_Strict):
    """Numbers exactly as the monograph states them (ranges stay strings: «1.5-4»)."""

    preparation_ru: str = Field(alias="preparationRu")
    amount: str | None = None
    unit: str | None = None
    water_ml: str | None = Field(default=None, alias="waterMl")
    times_per_day: str | None = Field(default=None, alias="timesPerDay")
    population_ru: str = Field(alias="populationRu")


class Fact(Quote):
    kind: FactKind
    ru: str = Field(min_length=3)
    dose: Dose | None = None
    min_age_months: int | None = Field(default=None, alias="minAgeMonths")
    max_days: int | None = Field(default=None, alias="maxDays")


class Constituent(Quote):
    compound: str
    compound_ru: str = Field(alias="compoundRu")
    class_ru: str | None = Field(default=None, alias="classRu")
    effect_ru: str = Field(alias="effectRu")
    evidence: Evidence


class EmaExtraction(_Strict):
    plant: str
    status: Literal["proposed", "reviewed"] = "proposed"
    use_type: Literal["traditional", "well-established", "both", "public-statement"] = Field(
        alias="useType"
    )
    facts: tuple[Fact, ...] = Field(min_length=1)
    constituents: tuple[Constituent, ...] = ()


def normalize(text: str) -> str:
    """Compare text the way a reader sees it: one space; case and hyphens ignored, since PDF lines
    break at «anti-|inflammatory» as well as inside words."""
    text = unicodedata.normalize("NFKC", text).translate(_DASHES)
    text = re.sub(r"[­-]\s*", "", text)
    return re.sub(r"\s+", " ", text).strip().lower()


_PAGE_LINE = re.compile(r"^\s*Page \d+/\d+\s*$")


@lru_cache(maxsize=128)
def page_texts(pdf: Path, *, sort: bool = False) -> tuple[str, ...]:
    """Page texts in the PDF's content order, or (``sort``) in reading position order — some EMA
    monographs store their text spans out of order."""
    texts: list[str] = []
    document: Any = pymupdf.open(pdf)
    try:
        for index in range(document.page_count):
            text: object = document.load_page(index).get_text("text", sort=sort)
            texts.append(text if isinstance(text, str) else "")
    finally:
        document.close()
    return tuple(texts)


@lru_cache(maxsize=128)
def _body_texts(pdf: Path) -> tuple[str, ...]:
    """Page texts without running headers and footers, used only to find a sentence that continues
    on the next page. Dropped: lines repeated on most pages, «Page N/M», and a page's header block —
    the leading run of blank or repeated lines up to its «Page N/M» line (a running title that wraps
    differently on some pages)."""
    pages = page_texts(pdf)
    counts: dict[str, int] = {}
    for text in pages:
        for line in {line.strip() for line in text.splitlines() if line.strip()}:
            counts[line] = counts.get(line, 0) + 1
    threshold = max(3, len(pages) // 2)
    bodies: list[str] = []
    for text in pages:
        lines = text.splitlines()
        start = 0
        for index, line in enumerate(lines):
            if _PAGE_LINE.match(line):
                start = index + 1
            elif line.strip() and counts.get(line.strip(), 0) < 2:
                break
        bodies.append(
            "\n".join(
                line
                for line in lines[start:]
                if not _PAGE_LINE.match(line) and counts.get(line.strip(), 0) < threshold
            )
        )
    return tuple(bodies)


# «3 For guidance…», also without the space («3For…», carvi).
_FOOTNOTE = re.compile(r"^\s*\d{1,2} ?[A-Z]")


def _footnote_cuts(body: str) -> list[str]:
    """The page body, then the body cut before each line that may open its footnote block
    («3 For guidance on herbal substance…»): a footnote at the foot of a page sits between the two
    halves of a sentence that runs on to the next page."""
    lines = body.splitlines()
    return [body] + [
        "\n".join(lines[:index]) for index, line in enumerate(lines) if _FOOTNOTE.match(line)
    ]


def dump_text(pdf: Path, target: Path) -> int:
    """Write the PDF text with ``=== page N ===`` lines, for the person writing the extraction."""
    pages = page_texts(pdf)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "".join(f"=== page {index} ===\n{text}\n" for index, text in enumerate(pages, start=1)),
        encoding="utf-8",
    )
    return len(pages)


def load_extraction(path: Path) -> EmaExtraction:
    return EmaExtraction.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def _numbers(text: str) -> set[str]:
    return {match.replace(",", ".") for match in _NUMBER.findall(text)}


def validate_ema_extraction(extraction: EmaExtraction, documents: dict[str, Path]) -> list[str]:
    """Return every problem: unknown document, quote not on its page, number not in its quote."""
    problems: list[str] = []
    items: list[tuple[str, Quote, str]] = [
        (f"fact {index} ({fact.kind})", fact, _fact_numbers_text(fact))
        for index, fact in enumerate(extraction.facts)
    ]
    items += [
        (f"constituent {index} ({item.compound})", item, item.effect_ru)
        for index, item in enumerate(extraction.constituents)
    ]
    for label, item, russian in items:
        pdf = documents.get(item.doc)
        if pdf is None:
            problems.append(f"{label}: no downloaded EMA {item.doc}")
            continue
        pages = page_texts(pdf)
        if item.page > len(pages):
            problems.append(f"{label}: page {item.page} > {len(pages)} pages")
            continue
        if not _on_page(normalize(item.quote), pages, _body_texts(pdf), item.page) and (
            _compact(item.quote) not in _compact(page_texts(pdf, sort=True)[item.page - 1])
        ):
            problems.append(f"{label}: quote not found on page {item.page}: {item.quote[:80]!r}")
        missing = _numbers(russian) - _numbers(item.quote)
        if missing:
            problems.append(f"{label}: numbers {sorted(missing)} are not in the quote")
    return problems


def _compact(text: str) -> str:
    """Text with every space removed: position-sorted extraction can split a word («burni ng»)."""
    return re.sub(r"\s+", "", normalize(text))


def _on_page(quote: str, pages: tuple[str, ...], bodies: tuple[str, ...], page: int) -> bool:
    """The quote is on the page, or starts there and runs on to the next page (headers, footers
    and the page's footnotes between the two are left out)."""
    if quote in normalize(pages[page - 1]):
        return True
    if page >= len(bodies):
        return False
    for body in _footnote_cuts(bodies[page - 1]):
        current = normalize(body)
        position = normalize(f"{body} {bodies[page]}").find(quote)
        if 0 <= position < len(current):
            return True
    return False


def _fact_numbers_text(fact: Fact) -> str:
    parts = [fact.ru]
    if fact.dose is not None:
        parts += [
            value
            for value in (
                fact.dose.amount,
                fact.dose.water_ml,
                fact.dose.times_per_day,
                fact.dose.population_ru,
            )
            if value is not None
        ]
    # minAgeMonths / maxDays are a reading of words («one week»), shown next to the quote.
    return " ".join(parts)


def ema_documents(raw_root: Path, plant_id: str) -> dict[str, Path]:
    """The downloaded EMA PDFs of one plant, from ``data/raw/herbal/MANIFEST.json``."""
    manifest = json.loads((raw_root / "MANIFEST.json").read_text(encoding="utf-8"))
    entry = manifest["ema"][plant_id]
    return {kind: raw_root / item["path"] for kind, item in entry["documents"].items()}


def check_ema_extractions(directory: Path, raw_root: Path) -> dict[str, list[str]]:
    """Validate every ``<plant>.yaml`` in ``directory``; returns problems per plant (empty = ok)."""
    results: dict[str, list[str]] = {}
    for path in sorted(directory.glob("*.yaml")):
        extraction = load_extraction(path)
        if extraction.plant != path.stem:
            results[path.stem] = [f"file names plant {extraction.plant}"]
            continue
        results[path.stem] = validate_ema_extraction(
            extraction, ema_documents(raw_root, extraction.plant)
        )
    return results
