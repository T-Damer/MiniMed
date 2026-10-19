"""Look-alikes of the herbal book's plants from pharmacognosy teaching texts.

``content/herbal/lookalikes.yaml`` names, per plant, the species a teaching manual lists as an
admixture (not to be collected), with the manual's distinguishing text, and optionally the line on
how the genuine herb differs. The manuals are pinned in ``data/raw/herbal/manuals``; every name,
Latin name and quote must occur on the cited page (spaces and line-break hyphens ignored), so the
file carries the manual's words, never a rewording.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

from .herbal_ema import normalize, page_texts

ManualId = Literal["nuph-2016", "ssmu-2013"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ManualQuote(_Strict):
    source: ManualId
    page: int = Field(ge=1)
    quote: str = Field(min_length=12)


class Lookalike(ManualQuote):
    name: str
    latin: str
    poisonous: bool = False


class PlantLookalikes(_Strict):
    key: ManualQuote | None = None
    lookalikes: tuple[Lookalike, ...] = Field(min_length=1)


class LookalikeFile(_Strict):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    plants: dict[str, PlantLookalikes]


def load_lookalikes(path: Path) -> dict[str, PlantLookalikes]:
    return LookalikeFile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8"))).plants


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", normalize(text))


def manual_paths(raw_root: Path) -> dict[str, Path]:
    manifest = json.loads((raw_root / "MANIFEST.json").read_text(encoding="utf-8"))
    return {key: raw_root / entry["path"] for key, entry in manifest["manuals"].items()}


def check_lookalikes(
    plants: dict[str, PlantLookalikes], manuals: dict[str, Path], plant_ids: set[str]
) -> list[str]:
    """Every problem: an unknown plant or manual, or a name or quote not on its page."""
    problems: list[str] = []
    for plant_id, entry in plants.items():
        if plant_id not in plant_ids:
            problems.append(f"{plant_id}: not a plant of the book")
        items: list[tuple[str, ManualQuote, tuple[str, ...]]] = []
        if entry.key is not None:
            items.append(("key", entry.key, (entry.key.quote,)))
        items += [
            (item.name, item, (item.name, item.latin, item.quote)) for item in entry.lookalikes
        ]
        for label, item, texts in items:
            pdf = manuals.get(item.source)
            if pdf is None:
                problems.append(f"{plant_id} {label}: no manual {item.source}")
                continue
            pages = page_texts(pdf)
            if item.page > len(pages):
                problems.append(f"{plant_id} {label}: page {item.page} > {len(pages)}")
                continue
            on_page = (
                _compact(pages[item.page - 1]),
                _compact(page_texts(pdf, sort=True)[item.page - 1]),
            )
            for text in texts:
                if not any(_compact(text) in page for page in on_page):
                    problems.append(
                        f"{plant_id} {label}: not on {item.source} p{item.page}: {text[:60]!r}"
                    )
    return problems
