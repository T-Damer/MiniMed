"""Regional Red Books of the herbal book («Травник»): ``content/herbal/regional-red-books.yaml``.

Each subject of the Russian Federation keeps its own Red Book; there is no federal register of them.
Plantarium (plantarium.ru) keeps the plant lists of the regional books with their edition year and
the act that approved them. For every plant we read its Plantarium taxon page (which lists every red
book naming the taxon, synonyms included) and keep the regions whose NEWEST edition known to
Plantarium names it. The result is a reviewed content file: the source and the fetch date are named
in it and in the chapter, and rows checked against the official regional act carry that act.
"""

from __future__ import annotations

import html
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field

PLANTARIUM = "https://www.plantarium.ru"
INDEX_URL = f"{PLANTARIUM}/page/redbooks.html"
USER_AGENT = "MiniMed-herbal/1.0 (personal reference app; contact via GitHub T-Damer/MiniMed)"
DELAY_SECONDS = 1.5
# Books that are not a current Russian region's own list: other countries, Soviet-era books, the
# federal book (kept separately from order № 320), and regions merged into others.
_NOT_A_CURRENT_REGION = re.compile(
    r"^(Украина|Республика (Армения|Беларусь|Болгария|Казахстан|Молдова|Таджикистан|Узбекистан"
    r"|Южная Осетия)|Азербайджан|Латвий|Литов|Эстон|Финлян|Туркмен|Киргиз|Узбекистан|СССР"
    r"|Российская Советская|Российская Федерация|Балтийский|Восточная Фенноскандия|Грузинская"
    r"|Казахская|Таджикская|Бурятская АССР|Пермская область|Читинская область|Усть-Ордынский"
    r"|Приднестровская)"
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)


class OfficialCheck(_Strict):
    """The row checked against the region's own act or book."""

    act: str
    url: str
    category: str | None = None


class RegionRow(_Strict):
    region: str
    year: int = Field(ge=1950)
    book: int = Field(ge=1)
    listed_as: str | None = Field(default=None, alias="as")
    checked: OfficialCheck | None = None


class PlantRegions(_Strict):
    taxon: int
    regions: tuple[RegionRow, ...] = ()


class RegionalRedBooks(_Strict):
    source: str
    url: str
    fetched: str
    plants: dict[str, PlantRegions]


def load_regional_red_books(path: Path) -> RegionalRedBooks:
    return RegionalRedBooks.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))


@dataclass(frozen=True)
class Book:
    id: int
    region: str
    year: int


@dataclass(frozen=True)
class TaxonEntry:
    book: int
    region: str
    year: int
    listed_as: str | None


def parse_index(page: str) -> list[Book]:
    """Every list on Plantarium's red-book index: book id, region, edition year."""
    rows = re.findall(
        r'href="/page/redbook/id/(\d+)\.html"[^>]*>([^<]+)</a></td>'
        r'<td class="right(?: bold)?">(\d{4})</td>',
        page,
    )
    return [
        Book(int(book), html.unescape(region).strip(), int(year)) for book, region, year in rows
    ]


def latest_editions(books: list[Book]) -> dict[str, int]:
    """The newest edition year of each current Russian region."""
    latest: dict[str, int] = {}
    for book in books:
        if _NOT_A_CURRENT_REGION.match(book.region):
            continue
        latest[book.region] = max(latest.get(book.region, 0), book.year)
    return latest


def search_taxon(page: str, name: str) -> int | None:
    """The taxon id of the exact binomial on a Plantarium search result page (not a subspecies)."""
    exact = re.compile(rf"^{re.escape(name)}(?:\s+(?!ssp\.|subsp\.|var\.|f\.)[A-Z(]|\s*–|\s*$)")
    for match in re.finditer(r'view/item/(\d+)\.html">', page):
        label = html.unescape(re.sub(r"<[^>]+>", " ", page[match.end() : match.end() + 400]))
        if exact.match(re.sub(r"\s+", " ", label).strip()):
            return int(match.group(1))
    return None


def parse_taxon(page: str) -> list[TaxonEntry]:
    """The red books a taxon page names, with the synonym a book lists it under."""
    starts = [match.start() for match in re.finditer(r"Указания в Красных книгах", page)]
    if not starts:
        return []
    block = page[starts[-1] : starts[-1] + 40000]
    end = block.find("Указания во флористических списках")
    block = block[: end if end > 0 else len(block)]
    entries: list[TaxonEntry] = []
    for match in re.finditer(
        r'href="/page/redbook/id/(\d+)\.html"[^>]*>(.*?)</a>\s*\((\d{4})\)(.*?)'
        r'(?=<a href="/page/redbook|$)',
        block,
        re.S,
    ):
        rest = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", match.group(4)))).strip()
        synonym = re.search(r"как\s+(.+?)\s*$", rest)
        region = html.unescape(re.sub(r"<[^>]+>", "", match.group(2))).strip()
        entries.append(
            TaxonEntry(
                int(match.group(1)),
                region,
                int(match.group(3)),
                synonym.group(1)[:80] if synonym else None,
            )
        )
    return entries


def current_rows(entries: list[TaxonEntry], latest: dict[str, int]) -> list[TaxonEntry]:
    """The regions whose newest edition lists the taxon, one row per region."""
    rows = {e.region: e for e in entries if latest.get(e.region) == e.year}
    return sorted(rows.values(), key=lambda entry: entry.region)


def binomial(latin: str) -> str:
    words = latin.replace("×", "x").split()
    return " ".join(words[:3] if len(words) > 2 and words[1] == "x" else words[:2])


def _get(url: str) -> str:
    time.sleep(DELAY_SECONDS)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", "replace")


def fetch_regional_red_books(
    plants: list[tuple[str, str]], raw_dir: Path, output: Path, fetched: str
) -> dict[str, int]:
    """Fetch the index and each plant's taxon page into ``raw_dir``, write the content file.
    ``plants`` are (plant id, Latin name). Keeps rows checked earlier (``checked``) when the region
    and edition are unchanged. Returns the number of regions per plant."""
    raw_dir.mkdir(parents=True, exist_ok=True)
    index = _get(INDEX_URL)
    (raw_dir / "redbooks.html").write_text(index, encoding="utf-8")
    latest = latest_editions(parse_index(index))
    previous = load_regional_red_books(output) if output.is_file() else None
    result: dict[str, dict[str, object]] = {}
    counts: dict[str, int] = {}
    for plant_id, latin in plants:
        name = binomial(latin)
        search = _get(
            f"{PLANTARIUM}/page/search.html?type=0&match=1&mode=full&sample="
            + urllib.parse.quote_plus(name)
        )
        taxon = search_taxon(search, name)
        if taxon is None:
            continue
        page = _get(f"{PLANTARIUM}/page/view/item/{taxon}.html")
        (raw_dir / f"taxon-{plant_id}.html").write_text(page, encoding="utf-8")
        old = {
            row.region: row
            for row in (
                previous.plants[plant_id].regions
                if previous and plant_id in previous.plants
                else ()
            )
        }
        rows: list[dict[str, object]] = []
        for entry in current_rows(parse_taxon(page), latest):
            row: dict[str, object] = {
                "region": entry.region,
                "year": entry.year,
                "book": entry.book,
            }
            if entry.listed_as:
                row["as"] = entry.listed_as
            kept = old.get(entry.region)
            if kept is not None and kept.year == entry.year and kept.checked is not None:
                row["checked"] = kept.checked.model_dump(exclude_none=True)
            rows.append(row)
        counts[plant_id] = len(rows)
        if rows:
            result[plant_id] = {"taxon": taxon, "regions": rows}
    document = {
        "source": "Плантариум: перечни видов региональных Красных книг",
        "url": INDEX_URL,
        "fetched": fetched,
        "plants": result,
    }
    output.write_text(
        "# Regional Red Books: newest edition of each Russian region that lists the plant, from\n"
        "# Plantarium; rows with `checked` were compared with the region's own act. Rebuilt by\n"
        "# `medbase fetch-regional-red-books`; do not edit rows by hand except `checked`.\n"
        + yaml.safe_dump(document, allow_unicode=True, sort_keys=False, width=100),
        encoding="utf-8",
    )
    return counts
