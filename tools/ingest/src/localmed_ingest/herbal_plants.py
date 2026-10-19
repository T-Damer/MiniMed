"""The hand-authored plant list of the herbal book («Травник»): ``content/herbal/plants.yaml``.

It is the only manual input of the module. Each plant links one ГРЛС raw-material name group,
one EMA/HMPC herbal page and one public-domain botanical plate on Wikimedia Commons. Everything
the app shows is generated from those sources.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

PLATE_BOOKS = {
    "kohler": "Köhler's Medizinal-Pflanzen (1887–1898)",
    "thome": "O. W. Thomé, Flora von Deutschland, Österreich und der Schweiz (1885)",
    "sturm": "J. Sturm, Deutschlands Flora in Abbildungen (1796–1862)",
    "lindman": "C. A. M. Lindman, Bilder ur Nordens Flora (1901–1905)",
}
# The short credit under a plate: the author of the book.
PLATE_AUTHORS = {"kohler": "Köhler", "thome": "Thomé", "sturm": "Sturm", "lindman": "Lindman"}
_ID = re.compile(r"^[a-z][a-z0-9-]*$")
_GF_PATH = re.compile(r"^/pharmacopoeia/izdanie-1(?:4/2/2-5|5/2/2-3)/[a-z0-9-]+/$")
_EMA_PAGE = re.compile(r"^https://www\.ema\.europa\.eu/en/medicines/herbal/[a-z0-9-]+$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PlantPart(_Strict):
    ru: str
    la: str


class GrlsLink(_Strict):
    inn: tuple[str, ...] = Field(min_length=1)

    @field_validator("inn")
    @classmethod
    def _lower(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        for name in value:
            if name != name.lower().strip():
                raise ValueError(f"ГРЛС name must be lower case and trimmed: {name!r}")
        return value


class EmaLink(_Strict):
    page: str
    species: str | None = None

    @field_validator("page")
    @classmethod
    def _page(cls, value: str) -> str:
        if not _EMA_PAGE.fullmatch(value):
            raise ValueError(f"not an EMA herbal page: {value}")
        return value

    @property
    def slug(self) -> str:
        return self.page.rsplit("/", 1)[1]


class PlateLink(_Strict):
    book: Literal["kohler", "thome", "sturm", "lindman"]
    file: str
    species: str | None = None

    @field_validator("file")
    @classmethod
    def _file(cls, value: str) -> str:
        if not value.startswith("File:"):
            raise ValueError(f"Commons file title must start with File: ({value})")
        return value


class GfLink(_Strict):
    """The ГФ raw-material article (ФС) of the plant: XV where it has one, else XIV."""

    edition: Literal[14, 15]
    path: str

    @field_validator("path")
    @classmethod
    def _path(cls, value: str) -> str:
        if not _GF_PATH.fullmatch(value):
            raise ValueError(f"not a ГФ raw-material article path: {value}")
        return value


class Plant(_Strict):
    id: str
    ru: str
    latin: str
    family: str
    part: PlantPart
    grls: GrlsLink
    ema: EmaLink
    plate: PlateLink
    gf: GfLink

    @field_validator("id")
    @classmethod
    def _id(cls, value: str) -> str:
        if not _ID.fullmatch(value):
            raise ValueError(f"bad plant id {value!r}")
        return value

    @property
    def document_id(self) -> str:
        return f"herbal.plant.{self.id}"


class PlantList(_Strict):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    plants: tuple[Plant, ...] = Field(min_length=1)


def load_plants(path: Path) -> tuple[Plant, ...]:
    """Read and validate the plant list; ids, ГРЛС names and EMA pages must be unique."""
    data = PlantList.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
    seen_ids: set[str] = set()
    seen_inn: dict[str, str] = {}
    seen_pages: set[str] = set()
    for plant in data.plants:
        if plant.id in seen_ids:
            raise ValueError(f"duplicate plant id {plant.id}")
        seen_ids.add(plant.id)
        if plant.ema.page in seen_pages:
            raise ValueError(f"{plant.id}: EMA page used twice ({plant.ema.page})")
        seen_pages.add(plant.ema.page)
        for name in plant.grls.inn:
            if name in seen_inn:
                raise ValueError(
                    f"{plant.id}: ГРЛС name {name!r} already belongs to {seen_inn[name]}"
                )
            seen_inn[name] = plant.id
    return data.plants
