from __future__ import annotations

from pathlib import Path
from typing import Any

import pymupdf

from localmed_ingest.herbal_conflicts import PlantConflicts, validate_conflicts
from localmed_ingest.herbal_regions import (
    Book,
    TaxonEntry,
    current_rows,
    latest_editions,
    parse_index,
    parse_taxon,
    search_taxon,
)

INDEX = (
    '<tr><td class="right">1.</td><td><a href="/page/redbook/id/113.html" title="x">'
    'Республика Адыгея</a></td><td class="right">2011</td></tr>'
    '<tr><td class="right">2.</td><td class="bold"><a href="/page/redbook/id/322.html" title="x">'
    'Республика Адыгея</a></td><td class="right bold">2021</td></tr>'
    '<tr><td><a href="/page/redbook/id/7.html">Российская Федерация</a></td>'
    '<td class="right bold">2023</td></tr>'
    '<tr><td><a href="/page/redbook/id/9.html">Украина, Киев</a></td>'
    '<td class="right">2000</td></tr>'
)

TAXON = (
    "<h2>Указания в Красных книгах (3)</h2>"
    '<a href="/page/redbook/id/113.html">Республика Адыгея</a> (2011) '
    '<a href="/page/redbook/id/322.html">Республика Адыгея</a> (2021) — как '
    "<i>Chamerion angustifolium</i> "
    '<a href="/page/redbook/id/7.html">Российская Федерация</a> (2023) '
    "<h2>Указания во флористических списках</h2>"
)


def test_regions_keep_the_newest_edition_of_current_russian_regions() -> None:
    books = parse_index(INDEX)
    # The newest editions are set in bold on the index; both kinds of row are read.
    assert books == [
        Book(113, "Республика Адыгея", 2011),
        Book(322, "Республика Адыгея", 2021),
        Book(7, "Российская Федерация", 2023),
        Book(9, "Украина, Киев", 2000),
    ]
    latest = latest_editions(books)
    # The federal book is kept separately; other countries are left out.
    assert latest == {"Республика Адыгея": 2021}
    entries = parse_taxon(TAXON)
    assert entries[1] == TaxonEntry(322, "Республика Адыгея", 2021, "Chamerion angustifolium")
    assert current_rows(entries, latest) == [entries[1]]
    # A plant listed only in an older edition is not in the region's current book.
    assert current_rows([entries[0]], latest) == []


def test_search_takes_the_species_not_a_subspecies() -> None:
    page = (
        '<a href="/page/view/item/31808.html"><i>Rhodiola rosea</i> ssp. arctica</a>'
        '<a href="/page/view/item/31830.html"><i>Rhodiola rosea</i> L. &ndash; 255 фото</a>'
    )
    assert search_taxon(page, "Rhodiola rosea") == 31830
    assert search_taxon(page, "Rhodiola integrifolia") is None


def test_conflicts_quote_both_sources(tmp_path: Path) -> None:
    pdf = tmp_path / "monograph.pdf"
    document: Any = pymupdf.open()
    document.new_page().insert_text((72, 72), "Not to be used for more than 1 week.", fontsize=10)
    document.save(pdf)
    document.close()

    def conflicts(ru: str, grls: str) -> PlantConflicts:
        return PlantConflicts.model_validate(
            {
                "plant": "senna-alexandrina",
                "items": [
                    {
                        "topic": "course",
                        "ru": ru,
                        "grls": grls,
                        "monograph": {
                            "doc": "monograph",
                            "page": 1,
                            "quote": "Not to be used for more than 1 week.",
                        },
                    }
                ],
            }
        )

    text = ["Принимают внутрь по 1/2 стакана. Курс лечения 2-3 недели."]
    good = conflicts("ГРЛС: курс 2–3 недели; EMA: не дольше 1 недели", "Курс лечения 2-3 недели.")
    assert validate_conflicts(good, text, {"monograph": pdf}) == []
    invented = conflicts("ГРЛС: курс 4 недели; EMA: не дольше 1 недели", "Курс лечения 2-3 недели.")
    assert validate_conflicts(invented, text, {"monograph": pdf}) == [
        "conflict 0 (course): numbers ['4'] are in neither quote"
    ]
    misquoted = conflicts("ГРЛС: курс до месяца; EMA: не дольше 1 недели", "Курс лечения месяц.")
    assert any(
        "not in the instruction" in problem
        for problem in validate_conflicts(misquoted, text, {"monograph": pdf})
    )
    # A WHO fact must stay inside its monograph's pages.
    assert validate_conflicts(good, text, {"monograph": pdf}, (2, 5)) != []
