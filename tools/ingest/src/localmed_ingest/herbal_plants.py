"""The hand-authored plant list of the herbal book («Травник»): ``content/herbal/plants.yaml``.

It is the only manual input of the module. Each plant links one monograph (an EMA/HMPC herbal page
or, where EMA has none, a WHO monograph) and optionally a ГРЛС raw-material name group, a ГФ
article, a botanical plate (public domain on Wikimedia Commons, or a picture the owner supplied)
and its row in the federal Red Book plant list. Everything the app shows is generated from those.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PLATE_BOOKS = {
    "kohler": "Köhler's Medizinal-Pflanzen (1887–1898)",
    "thome": "O. W. Thomé, Flora von Deutschland, Österreich und der Schweiz (1885)",
    "sturm": "J. Sturm, Deutschlands Flora in Abbildungen (1796–1862)",
    "lindman": "C. A. M. Lindman, Bilder ur Nordens Flora (1901–1905)",
    "curtis": "Curtis's Botanical Magazine, vol. 96 (1870)",
    "curtis1787": "Curtis's Botanical Magazine, vol. 1 (1787)",
    "siebold": "Siebold, Zuccarini, Flora Japonica (1870)",
    "floradanica": "Flora Danica, fasc. 4 (1765)",
    "vietz": "F. B. Vietz, Icones plantarum medico-oeconomico-technologicarum, vol. 2 (1804)",
    # A picture the owner supplied for a plant without a public-domain plate (2026-10-19).
    "owner": "Иллюстрация, предоставленная владельцем приложения",
}
# The short credit under a plate: the author of the book.
PLATE_AUTHORS = {
    "kohler": "Köhler",
    "thome": "Thomé",
    "sturm": "Sturm",
    "lindman": "Lindman",
    "curtis": "Fitch",
    "curtis1787": "Edwards",
    "siebold": "Siebold",
    "floradanica": "Oeder",
    "vietz": "Vietz",
    "owner": "от владельца",
}
OWNER_PLATE_LICENCE = "Owner-supplied"
PLATE_LICENCES = frozenset({"Public domain", OWNER_PLATE_LICENCE})
_ID = re.compile(r"^[a-z][a-z0-9-]*$")
_OWNER_PICTURE = re.compile(r"^pictures/[a-z0-9-]+\.(?:png|jpe?g)$")
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
    # The monograph covers other species than the plant (thyme: T. vulgaris/zygis, not
    # T. serpyllum); the chapter then names them above the EMA facts.
    other_species: bool = Field(default=False, alias="otherSpecies")

    @model_validator(mode="after")
    def _other_species_named(self) -> EmaLink:
        if self.other_species and not self.species:
            raise ValueError("otherSpecies needs the monograph's species")
        return self

    @field_validator("page")
    @classmethod
    def _page(cls, value: str) -> str:
        if not _EMA_PAGE.fullmatch(value):
            raise ValueError(f"not an EMA herbal page: {value}")
        return value

    @property
    def slug(self) -> str:
        return self.page.rsplit("/", 1)[1]


WhoVolume = Literal["1", "2", "3", "4", "NIS"]


class WhoLink(_Strict):
    """A WHO monograph: its volume, Latin title and first and last PDF page in that volume."""

    volume: WhoVolume
    title: str
    pages: tuple[int, int]

    @field_validator("pages")
    @classmethod
    def _pages(cls, value: tuple[int, int]) -> tuple[int, int]:
        if not 1 <= value[0] <= value[1]:
            raise ValueError(f"bad WHO page range {value}")
        return value


class PlateLink(_Strict):
    book: Literal[
        "kohler",
        "thome",
        "sturm",
        "lindman",
        "curtis",
        "vietz",
        "curtis1787",
        "siebold",
        "floradanica",
        "owner",
    ]
    # A Commons file title, or for ``owner`` a picture under ``content/herbal/pictures/``.
    file: str
    species: str | None = None

    @model_validator(mode="after")
    def _file(self) -> PlateLink:
        if self.book == "owner":
            if not _OWNER_PICTURE.fullmatch(self.file):
                raise ValueError(f"owner picture must be pictures/<name>.png|jpg ({self.file})")
        elif not self.file.startswith("File:"):
            raise ValueError(f"Commons file title must start with File: ({self.file})")
        return self


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


# Категории статуса редкости: п. 3.7 Порядка ведения Красной книги Российской Федерации
# (приказ Минприроды России от 23.05.2016 № 306).
RED_BOOK_CATEGORIES = {
    0: "Вероятно исчезнувшие",
    1: "Находящиеся под угрозой исчезновения",
    2: "Сокращающиеся в численности и/или распространении",
    3: "Редкие",
    4: "Неопределенные по статусу",
    5: "Восстанавливаемые и восстанавливающиеся",
}


class RedBookEntry(_Strict):
    """The plant's row in the federal Red Book plant list (приказ Минприроды России № 320)."""

    number: int = Field(ge=1)
    page: int = Field(ge=1)
    category: Literal[0, 1, 2, 3, 4, 5]
    # The row's own qualification, verbatim (e.g. populations it excludes).
    note: str | None = None


class Plant(_Strict):
    id: str
    ru: str
    latin: str
    family: str
    part: PlantPart
    # Only the monograph (EMA) is required (owner 2026-10-19): ГРЛС adds the Russian recipe, ГФ the
    # field identification, a public-domain plate the picture; a plant without one shows no plate.
    grls: GrlsLink | None = None
    ema: EmaLink | None = None
    # WHO only where EMA has no monograph: one evidence source per chapter.
    who: WhoLink | None = None
    plate: PlateLink | None = None
    gf: GfLink | None = None
    red_book: RedBookEntry | None = Field(default=None, alias="redBook")

    @model_validator(mode="after")
    def _one_monograph(self) -> Plant:
        if (self.ema is None) == (self.who is None):
            raise ValueError(f"{self.id}: exactly one of ema and who is required")
        return self

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
        monograph = (
            plant.ema.page
            if plant.ema is not None
            else f"who:{plant.who.volume}:{plant.who.title}"
            if plant.who is not None
            else plant.id
        )
        if monograph in seen_pages:
            raise ValueError(f"{plant.id}: monograph used twice ({monograph})")
        seen_pages.add(monograph)
        for name in plant.grls.inn if plant.grls else ():
            if name in seen_inn:
                raise ValueError(
                    f"{plant.id}: ГРЛС name {name!r} already belongs to {seen_inn[name]}"
                )
            seen_inn[name] = plant.id
    return data.plants
