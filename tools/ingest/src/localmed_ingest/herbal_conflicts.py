"""ГРЛС instruction against EMA/WHO monograph: ``content/herbal/conflicts/<plant>.yaml``.

The chapter shows the ГРЛС instruction verbatim and the monograph as Russian fields; a doctor
reading one does not see that the other says otherwise (a course of 2-3 weeks against «not more
than 1 week», doses for infants against «not recommended under 12»). Each item names the topic,
one Russian line that states both sides, the exact ГРЛС sentence and the exact monograph sentence
with its page. The ГРЛС sentence must be in the instruction text, the monograph sentence on its
page, and every number of the Russian line in one of the two.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .herbal_ema import (
    EmaDocument,
    ema_documents,
    normalize,
    numbers_in,
    quote_on_page,
    who_documents,
)

ConflictTopic = Literal[
    "age",
    "course",
    "dose",
    "indication",
    "contraindication",
    "pregnancy",
    "lactation",
    "interaction",
]
TOPIC_LABELS: dict[str, str] = {
    "age": "Возраст",
    "course": "Курс",
    "dose": "Доза",
    "indication": "Показания",
    "contraindication": "Кому нельзя",
    "pregnancy": "Беременность",
    "lactation": "Кормление",
    "interaction": "Лекарства",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class MonographSide(_Strict):
    doc: EmaDocument
    page: int = Field(ge=1)
    quote: str = Field(min_length=12)


class Conflict(_Strict):
    topic: ConflictTopic
    ru: str = Field(min_length=10)
    grls: str = Field(min_length=8)
    monograph: MonographSide


class PlantConflicts(_Strict):
    plant: str
    items: tuple[Conflict, ...] = Field(min_length=1)


def load_conflicts(path: Path) -> PlantConflicts:
    return PlantConflicts.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


def validate_conflicts(
    item: PlantConflicts,
    grls_texts: Iterable[str],
    documents: dict[str, Path],
    pages: tuple[int, int] | None = None,
) -> list[str]:
    """Every problem: a ГРЛС sentence not in the instruction, a monograph sentence not on its page
    (or outside the WHO monograph's pages), a number of the Russian line in neither quote."""
    grls = normalize(" ".join(grls_texts))
    problems: list[str] = []
    if not grls:
        return ["no ГРЛС instruction text for this plant"]
    for index, conflict in enumerate(item.items):
        label = f"conflict {index} ({conflict.topic})"
        if normalize(conflict.grls) not in grls:
            problems.append(
                f"{label}: ГРЛС sentence not in the instruction: {conflict.grls[:80]!r}"
            )
        side = conflict.monograph
        pdf = documents.get(side.doc)
        if pdf is None:
            problems.append(f"{label}: no downloaded {side.doc}")
        elif not quote_on_page(side.quote, pdf, side.page):
            problems.append(f"{label}: quote not found on page {side.page}: {side.quote[:80]!r}")
        if pages is not None and not pages[0] <= side.page <= pages[1]:
            problems.append(f"{label}: page {side.page} is outside the monograph {pages}")
        missing = numbers_in(conflict.ru) - numbers_in(conflict.grls) - numbers_in(side.quote)
        if missing:
            problems.append(f"{label}: numbers {sorted(missing)} are in neither quote")
    return problems


def chapter_grls_text(chapter_markdown: str) -> str:
    """The ГРЛС instruction text of a built chapter (its body), for checking a conflicts file
    without rebuilding the book."""
    parts = chapter_markdown.split("---", 2)
    return parts[2] if len(parts) == 3 else chapter_markdown


def plant_documents(raw_root: Path, plant_id: str, who_volume: str | None) -> dict[str, Path]:
    return who_documents(raw_root, who_volume) if who_volume else ema_documents(raw_root, plant_id)


def check_conflicts(
    directory: Path,
    raw_root: Path,
    book: Path,
    who: dict[str, tuple[str, tuple[int, int]]],
    plant_ids: set[str],
) -> dict[str, list[str]]:
    """Validate every ``<plant>.yaml`` against the built chapter's ГРЛС text and the monograph."""
    results: dict[str, list[str]] = {}
    for path in sorted(directory.glob("*.yaml")):
        item = load_conflicts(path)
        if item.plant != path.stem or item.plant not in plant_ids:
            results[path.stem] = [f"file names plant {item.plant}, not in the plant list"]
            continue
        chapter = book / f"herbal.plant.{item.plant}.md"
        text = chapter_grls_text(chapter.read_text(encoding="utf-8")) if chapter.is_file() else ""
        volume, pages = who.get(item.plant, (None, None))
        results[path.stem] = validate_conflicts(
            item, [text], plant_documents(raw_root, item.plant, volume), pages
        )
    return results
