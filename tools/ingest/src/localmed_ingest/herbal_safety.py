"""Safety lines of the herbal book («Травник»): ``content/herbal/safety/<plant>.yaml``.

Four sources, each named under its line:

* NCCIH «Herbs at a Glance» pages and LactMed chapters (US public domain): Russian lines, each with
  the English sentence it was read from; the quote must be in the saved page or chapter, and every
  number of the Russian line must be in its quote.
* LiverTox chapters (US public domain): the likelihood score, read by code from the chapter's own
  sentence and named in Russian by a fixed table (an unknown wording is an error, not a guess).
* EAEU technical regulation TR CU 021/2011 (food safety), annex 7: the plant's row in the list of
  plants not allowed in food supplements (БАД), checked against the page of the official PDF.
"""

from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .herbal_ema import normalize, page_texts

SafetyKind = Literal["adverse", "interaction", "pregnancy", "lactation", "warning", "use"]

# LiverTox states the score as «E (unlikely cause of clinically apparent liver injury).»; the
# parenthesis is translated as written, so the line never says more than the chapter does.
LIVERTOX_SCORES = {
    "well known cause of clinically apparent liver injury": "известная причина поражения печени",
    "likely but rare cause of clinically apparent liver injury": (
        "вероятная, но редкая причина поражения печени"
    ),
    "probable rare cause of clinically apparent liver injury": (
        "вероятная редкая причина поражения печени"
    ),
    "possible rare cause of clinically apparent liver injury": (
        "возможная редкая причина поражения печени"
    ),
    "possible, rare cause of clinically apparent liver injury": (
        "возможная редкая причина поражения печени"
    ),
    "uncommon but likely cause of clinically apparent liver injury": (
        "нечастая, но вероятная причина поражения печени"
    ),
    "possible cause of clinically apparent liver injury": "возможная причина поражения печени",
    "unlikely cause of clinically apparent liver injury": (
        "маловероятная причина поражения печени"
    ),
    "by itself, unlikely cause of clinically apparent liver injury": (
        "сам по себе — маловероятная причина поражения печени"
    ),
    "unproven but suspected cause of clinically apparent liver injury": (
        "не доказанная, но подозреваемая причина поражения печени"
    ),
}
_LIKELIHOOD = re.compile(
    r"Likelihood score:\s*([A-EX]\*?(?:\[[^\]]*\])?)\s*\(([^)]+)\)", re.IGNORECASE
)
TRTS_SECTIONS = {
    "1.1": "запрещено в составе БАД",
    "1.2": "не допускается в однокомпонентных БАД",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class SafetyLine(_Strict):
    source: Literal["nccih", "lactmed"]
    kind: SafetyKind
    ru: str = Field(min_length=3)
    quote: str = Field(min_length=12)


class TrtsRow(_Strict):
    """The plant's row of TR CU 021/2011 annex 7, as printed (name, Latin name, parts)."""

    section: Literal["1.1", "1.2"]
    number: int = Field(ge=1)
    page: int = Field(ge=1)
    name: str
    latin: str
    parts: str


class PlantSafety(_Strict):
    plant: str
    nccih: str | None = None
    lactmed: str | None = None
    livertox: str | None = None
    lines: tuple[SafetyLine, ...] = ()
    trts: TrtsRow | None = None


def load_safety(path: Path) -> PlantSafety:
    return PlantSafety.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def load_safety_dir(directory: Path) -> dict[str, PlantSafety]:
    items: dict[str, PlantSafety] = {}
    for path in sorted(directory.glob("*.yaml")):
        item = load_safety(path)
        if item.plant != path.stem:
            raise ValueError(f"{path}: plant {item.plant} does not match the file name")
        items[item.plant] = item
    return items


def markup_text(raw: str) -> str:
    """The reading text of an HTML page or an NXML chapter: tags dropped, entities decoded."""
    raw = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def nccih_path(slug: str) -> str:
    return f"safety/nccih/{slug}.html"


def lactmed_path(chapter: str) -> str:
    return f"safety/lactmed/{chapter}.nxml"


def livertox_path(chapter: str) -> str:
    return f"safety/livertox/{chapter}.nxml"


TRTS_PDF = "safety/trts-021-2011.pdf"


def livertox_score(text: str) -> tuple[str, str, str]:
    """(letter, Russian name, the chapter's sentence) of a LiverTox likelihood score."""
    match = _LIKELIHOOD.search(text)
    if match is None:
        raise ValueError("no «Likelihood score» sentence")
    letter = match.group(1).split("[", 1)[0]
    wording = re.sub(r"\s+", " ", match.group(2)).strip().rstrip(".").lower()
    if wording not in LIVERTOX_SCORES:
        raise ValueError(f"unknown LiverTox likelihood wording {wording!r}")
    return letter, LIVERTOX_SCORES[wording], match.group(0).strip()


def _numbers(text: str) -> set[str]:
    return {match.replace(",", ".") for match in re.findall(r"\d+(?:[.,]\d+)?", text)}


def validate_safety(item: PlantSafety, raw_root: Path) -> list[str]:
    """Every problem: a missing source file, a quote not in its source, a number not in its quote,
    an unreadable LiverTox score, a TR CU 021/2011 row not on its page."""
    problems: list[str] = []
    texts: dict[str, str] = {}
    for source, relative in (
        ("nccih", nccih_path(item.nccih) if item.nccih else None),
        ("lactmed", lactmed_path(item.lactmed) if item.lactmed else None),
    ):
        if relative is None:
            continue
        path = raw_root / relative
        if not path.exists():
            problems.append(f"{source}: no saved {relative}; run fetch-herbal-sources")
            continue
        texts[source] = normalize(markup_text(path.read_text(encoding="utf-8")))
    for index, line in enumerate(item.lines):
        label = f"line {index} ({line.source}, {line.kind})"
        if line.source not in texts:
            problems.append(f"{label}: the plant has no {line.source} source")
            continue
        if normalize(line.quote) not in texts[line.source]:
            problems.append(f"{label}: quote not in the source: {line.quote[:80]!r}")
        missing = _numbers(line.ru) - _numbers(line.quote)
        if missing:
            problems.append(f"{label}: numbers {sorted(missing)} are not in the quote")
    if item.livertox:
        path = raw_root / livertox_path(item.livertox)
        if not path.exists():
            problems.append(f"livertox: no saved {path.name}; run fetch-herbal-sources")
        else:
            try:
                livertox_score(markup_text(path.read_text(encoding="utf-8")))
            except ValueError as error:
                problems.append(f"livertox {item.livertox}: {error}")
    if item.trts is not None:
        pdf = raw_root / TRTS_PDF
        pages = page_texts(pdf) if pdf.exists() else ()
        if item.trts.page > len(pages):
            problems.append(f"ТР ТС: no page {item.trts.page} in {TRTS_PDF}")
        else:
            # A row may run on to the next page past the repeated table header (the valerian
            # parts are split there): the words of each value must follow in order.
            page = normalize(" ".join(pages[item.trts.page - 1 : item.trts.page + 1]))
            for value in (item.trts.name, item.trts.latin, item.trts.parts):
                if not _words_in_order(normalize(value), page):
                    problems.append(f"ТР ТС: {value!r} is not on page {item.trts.page}")
    return problems


def _words_in_order(value: str, text: str) -> bool:
    words = value.split()
    first = text.find(words[0]) if words else -1
    while first >= 0:
        position = first + len(words[0])
        for word in words[1:]:
            found = text.find(word, position)
            # The words of one cell stay close; a later match elsewhere does not count.
            if found < 0 or found - position > 200:
                break
            position = found + len(word)
        else:
            return True
        first = text.find(words[0], first + 1)
    return False


def check_safety(directory: Path, raw_root: Path, plant_ids: set[str]) -> dict[str, list[str]]:
    items = load_safety_dir(directory)
    report = {
        plant: problems
        for plant, item in items.items()
        if (problems := validate_safety(item, raw_root))
    }
    for plant in sorted(set(items) - plant_ids):
        report.setdefault(plant, []).append("not in the plant list")
    return report
