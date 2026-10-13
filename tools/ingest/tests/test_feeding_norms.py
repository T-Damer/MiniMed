"""Feeding-norms workspace: citation contract, book values, build and packaging."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest
import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.feeding_distribution import package_feeding_module
from localmed_ingest.feeding_norms import (
    DOCUMENT_PREFIX,
    FeedingSourceError,
    check_document,
    check_row,
    normalize,
    prepare_feeding_norms,
    split_front_matter,
    table_cells,
    verify_feeding_sources,
)

ROOT = Path(__file__).resolve().parents[3]
WORKSPACE = ROOT / "content/feeding-norms"
MARKER = re.compile(r"^<!-- localmed:source (\{.*\}) -->$")
BOOK_IDS = {"prog2019", "poch2014", "poch2021", "wb2018", "shab7", "pit2022", "kap2019"}


def _copy(tmp_path: Path) -> Path:
    target = tmp_path / "feeding-norms"
    shutil.copytree(WORKSPACE, target)
    return target


def _documents() -> list[Path]:
    return sorted(WORKSPACE.glob(f"{DOCUMENT_PREFIX}*.md"))


def _tables(name: str) -> dict[str, list[list[str]]]:
    """GFM tables of one document by their caption heading; rows without the separator."""
    path = WORKSPACE / f"{DOCUMENT_PREFIX}{name}.md"
    _front, body = split_front_matter(path.read_text(encoding="utf-8"), path.name)
    tables: dict[str, list[list[str]]] = {}
    caption = ""
    current: list[list[str]] | None = None
    for line in body.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            caption = stripped.lstrip("#").strip()
            current = None
        elif stripped.startswith("| ---"):
            continue
        elif stripped.startswith("|"):
            if current is None:
                current = tables.setdefault(caption, [])
            current.append(table_cells(stripped))
        else:
            current = None
    return tables


def _table(name: str, caption_start: str) -> list[list[str]]:
    matches = [rows for caption, rows in _tables(name).items() if caption.startswith(caption_start)]
    assert len(matches) == 1, f"{name}: {caption_start!r} matched {len(matches)} tables"
    return matches[0]


def _row(rows: list[list[str]], label: str) -> list[str]:
    found = [row for row in rows if row[0] == label]
    assert len(found) == 1, f"row {label!r} matched {len(found)} times"
    return found[0][1:]


def test_workspace_documents_follow_the_citation_contract(tmp_path: Path) -> None:
    workspace = _copy(tmp_path)
    reports = [check_document(path) for path in sorted(workspace.glob(f"{DOCUMENT_PREFIX}*.md"))]
    assert len(reports) == 16
    assert sum(report.tables for report in reports) >= 40
    assert sum(report.table_rows for report in reports) >= 400
    assert {book for report in reports for book in report.books} == BOOK_IDS
    for report in reports:
        assert len(report.aliases) >= 5, report.document_id
        assert report.editorial_blocks >= 1, report.document_id


def test_every_table_row_sits_under_a_book_citation() -> None:
    for path in _documents():
        front, body = split_front_matter(path.read_text(encoding="utf-8"), path.name)
        books = {item["id"]: item for item in front["metadata"]["sourceBooks"]}
        editorial_document = front["metadata"].get("contentMode") == "editorial"
        marker: dict[str, str] | None = None
        rows = 0
        for line in body.split("\n"):
            stripped = line.strip()
            found = MARKER.match(stripped)
            if found:
                marker = json.loads(found.group(1))
                continue
            if stripped.startswith("#"):
                marker = None
                continue
            if stripped.startswith("|") and not stripped.startswith("| ---"):
                rows += 1
                assert marker is not None, f"{path.name}: table row without a marker"
                if not editorial_document:
                    assert marker["contentMode"] == "verbatim", path.name
                    assert marker["bookId"] in books, path.name
                    assert re.fullmatch(r"\d+(–\d+)?", marker["pdfPages"]), path.name
                    assert marker["sourceSection"], path.name
        for book in books.values():
            assert re.fullmatch(r"[0-9a-f]{64}", book["sha256"]), path.name
            assert book["citation"], path.name
        if not editorial_document and "table" in path.name:
            assert rows > 0


def test_every_cited_block_shows_its_book_and_pages() -> None:
    for path in _documents():
        lines = path.read_text(encoding="utf-8").split("\n")
        verbatim = 0
        for number, line in enumerate(lines):
            found = MARKER.match(line.strip())
            if not found or json.loads(found.group(1))["contentMode"] != "verbatim":
                continue
            verbatim += 1
            citation = next(text for text in lines[number + 1 :] if text.strip())
            assert re.fullmatch(r"\*Источник: .+, (PDF )?с\. [\d–]+\.\*", citation), (
                path.name,
                citation,
            )
        assert verbatim > 0 or path.name.endswith("sources-and-notes.md")


def test_a_cited_block_without_a_visible_source_stops_the_preparer(tmp_path: Path) -> None:
    workspace = _copy(tmp_path)
    path = workspace / f"{DOCUMENT_PREFIX}vitamin-d-infants.md"
    text = path.read_text(encoding="utf-8")
    path.write_text(re.sub(r"\n\*Источник: [^\n]+\.\*\n", "\n", text, count=1), encoding="utf-8")
    with pytest.raises(FeedingSourceError, match="visible source"):
        check_document(path)


def test_every_book_citation_names_pages() -> None:
    for path in _documents():
        front, _body = split_front_matter(path.read_text(encoding="utf-8"), path.name)
        if front["metadata"].get("contentMode") == "editorial":
            continue
        for book in front["metadata"]["sourceBooks"]:
            assert re.fullmatch(r"\d+(–\d+)?", str(book["pdfPages"])), (path.name, book["id"])


def test_programme_tables_keep_the_book_values() -> None:
    complementary = _table("complementary-feeding", "Таблица 5.1")
    assert complementary[0][1:] == ["4–5", "6", "7", "8", "9–12"]
    assert _row(complementary, "Овощное пюре") == ["10–150", "150", "150", "150", "150"]
    assert _row(complementary, "Каша") == ["10–150", "150", "150", "180", "200"]
    assert _row(complementary, "Мясное пюре промышленного производства*/отварное мясо") == [
        "-",
        "5–30/3–15",
        "40–50/20–30",
        "60–70/30–35",
        "80–100/40–50",
    ]
    assert _row(complementary, "Желток") == ["-", "-", "1/4", "1/2", "1/2"]

    pregnancy = _table("programme-pregnancy", "Таблица 1.1")
    assert _row(pregnancy, "Энергия, ккал") == ["2200", "350", "2550"]
    assert _row(pregnancy, "Железо, мг") == ["18", "15", "33"]
    lactation = _table("programme-lactation", "Таблица 2.1")
    assert _row(lactation, "Энергия, ккал") == ["2200", "500", "450"]
    assert _row(lactation, "Белки, г") == ["66", "40", "30"]

    colostrum = _table("breastfeeding", "Таблица 3.1")
    assert [row[1] for row in colostrum[1:]] == ["2–10", "5–15", "15–30", "30–60"]


def test_infant_norms_and_volume_tables_keep_the_book_values() -> None:
    energy = _table("infant-norms", "Среднесуточные нормы физиологических потребностей в пищевых")
    assert _row(energy, "0–3 мес") == ["115", "2,2", "6,5", "13"]
    assert _row(energy, "4–6 мес") == ["115", "2,6", "6,0", "13"]
    assert _row(energy, "7–12 мес") == ["110", "2,9", "5,5", "13"]
    volume = _table("daily-volume-methods", "Таблица 7.5")
    assert volume[1:] == [
        ["1", "600–700 мл", "не более 500 мл"],
        ["2", "700–800 мл", "не более 600 мл"],
        ["3", "850 мл", "не более 650 мл"],
        ["4", "900 мл", "не более 700 мл"],
    ]
    vitamin_d = _table("vitamin-d-infants", "Таблица 10.4")
    assert vitamin_d[1][1:] == ["1000 МЕ/сут"] * 4
    assert vitamin_d[2][1:] == ["1000 МЕ/сут", "1000 МЕ/сут", "1500 МЕ/сут", "1500 МЕ/сут"]


def test_child_norm_table_repeats_merged_cells_of_the_print() -> None:
    norms = _table("children-nutrient-norms", "Нормы физиологических потребностей в энергии")
    assert len(norms[0]) == 12
    assert all(len(row) == 12 for row in norms)
    assert _row(norms, "Энергия (ккал)") == [
        "115*", "115*", "110*", "1200", "1400", "1800", "2100", "2500", "2300", "2900", "2500",
    ]  # fmt: skip
    # iron: one printed cell spans 7-12 months to 3-7 years, another 11-14 girls and 14-18 boys
    assert _row(norms, "Железо, мг") == [
        "4,0", "7,0", "10,0", "10,0", "10,0", "10,0", "12,0", "12,0", "15,0", "15,0", "18,0",
    ]  # fmt: skip
    assert _row(norms, "Витамин D, мкг") == ["10,0"] * 11


def test_who_weight_increment_tables_have_twelve_intervals_each() -> None:
    tables = _tables("growth-and-weight-gain")
    boys = next(rows for caption, rows in tables.items() if "BOYS" in caption)
    girls = next(rows for caption, rows in tables.items() if "GIRLS" in caption)
    for rows in (boys, girls):
        assert len(rows) == 13  # header + 12 intervals
        assert all(len(row) == 8 for row in rows)
        assert [row[0] for row in rows[1:]][:3] == ["0–4 wks", "4 wks–2 mo", "2–3 mo"]
    assert boys[1] == ["0–4 wks", "-160", "321", "694", "1023", "1325", "1608", "1876"]
    assert girls[-1] == ["11–12 mo", "-324", "-166", "22", "232", "458", "699", "953"]


def test_volume_formulas_are_cited_from_each_book() -> None:
    text = (WORKSPACE / f"{DOCUMENT_PREFIX}daily-volume-methods.md").read_text(encoding="utf-8")
    for formula in ("п х 70", "2 % массы тела", "1/5 массы тела", "120-125", "800 мл"):
        assert formula in text
    front, _body = split_front_matter(text, "daily-volume-methods")
    cited = {book["id"] for book in front["metadata"]["sourceBooks"]}
    assert {"prog2019", "poch2014", "poch2021", "wb2018", "shab7", "pit2022"} <= cited


def test_the_kapitan_worked_examples_are_in_the_module() -> None:
    text = (WORKSPACE / f"{DOCUMENT_PREFIX}kapitan-volume-and-regime.md").read_text(
        encoding="utf-8"
    )
    for example in (
        "V = 4 · 70 = 280 мл",
        "3 · 5 · 3,3 = 50 мл",
        "5200 · 1/6 = 866 мл = 870 мл",
        "7950 · 1/8 = 993 мл = 1000 мл",
        "115 · 6,4 · 1000 / 700 = 1051 мл",
        "115 · 3,8 · 1000 / 700 = 625 мл",
    ):
        assert example in text
    front, _body = split_front_matter(text, "kapitan")
    assert front["metadata"]["sourceBooks"][0]["textLayer"] is False


def test_prepare_writes_manifest_and_aliases_deterministically(tmp_path: Path) -> None:
    first = _copy(tmp_path)
    report = prepare_feeding_norms(first)
    assert report.documents == 16
    assert report.aliases >= 100
    manifest = yaml.safe_load((first / "manifest.yaml").read_text(encoding="utf-8"))
    assert manifest["id"] == "minimed.feeding.norms"
    assert manifest["schemaVersion"] == 2
    assert manifest["version"] == report.version
    aliases = yaml.safe_load((first / "aliases.yaml").read_text(encoding="utf-8"))["aliases"]
    terms = {row["alias"] for row in aliases}
    assert {"прикорм", "объём кормления", "сколько молока ребёнку 3 месяца"} <= terms
    assert len({row["id"] for row in aliases}) == len(aliases)
    second = tmp_path / "again"
    shutil.copytree(first, second)
    prepare_feeding_norms(second)
    assert {p.name: p.read_bytes() for p in first.iterdir()} == {
        p.name: p.read_bytes() for p in second.iterdir()
    }
    # the committed manifest and aliases are the ones the preparer writes
    assert (WORKSPACE / "manifest.yaml").read_bytes() == (first / "manifest.yaml").read_bytes()
    assert (WORKSPACE / "aliases.yaml").read_bytes() == (first / "aliases.yaml").read_bytes()


def _mutated(tmp_path: Path, name: str, edit: tuple[str, str]) -> Path:
    workspace = _copy(tmp_path)
    path = workspace / f"{DOCUMENT_PREFIX}{name}.md"
    text = path.read_text(encoding="utf-8")
    assert edit[0] in text
    path.write_text(text.replace(edit[0], edit[1], 1), encoding="utf-8")
    return path


def test_a_table_without_a_marker_stops_the_preparer(tmp_path: Path) -> None:
    path = _mutated(
        tmp_path,
        "complementary-feeding",
        (
            '<!-- localmed:source {"bookId":"prog2019","contentMode":"verbatim","pdfPages":"33"',
            "<!-- x",
        ),
    )
    with pytest.raises(FeedingSourceError):
        check_document(path)


def test_an_undeclared_book_stops_the_preparer(tmp_path: Path) -> None:
    path = _mutated(tmp_path, "breastfeeding", ('"bookId":"prog2019"', '"bookId":"unknown-book"'))
    with pytest.raises(FeedingSourceError, match="not declared"):
        check_document(path)


def test_a_wrong_rights_status_stops_the_preparer(tmp_path: Path) -> None:
    path = _mutated(
        tmp_path,
        "formula-feeding",
        (
            "rightsStatus: personal-library-private-use",
            "rightsStatus: official-act-not-copyrighted",
        ),
    )
    with pytest.raises(FeedingSourceError, match="rightsStatus"):
        check_document(path)


def test_a_bad_checksum_stops_the_preparer(tmp_path: Path) -> None:
    workspace = _copy(tmp_path)
    path = workspace / f"{DOCUMENT_PREFIX}vitamin-d-infants.md"
    text = path.read_text(encoding="utf-8")
    path.write_text(
        re.sub(r"(    sha256: )[0-9a-f]{64}", r"\1deadbeef", text, count=1), encoding="utf-8"
    )
    with pytest.raises(FeedingSourceError, match="SHA-256"):
        check_document(path)


def test_normalize_ignores_case_spaces_hyphens_and_bullet_glyphs() -> None:
    assert normalize("Рас-\nчёт  объёма") == normalize("расчет объема")
    assert normalize("1,5–2 ч") == normalize("1,52ч")
    assert normalize("ab") == "ab"


def test_check_row_tells_strict_weak_and_failed_rows_apart() -> None:
    page = normalize("Энергия, ккал 2200 350 2550 Белки, г 66 в т.ч. 33 30 20")
    assert check_row(["Энергия, ккал", "2200", "350", "2550"], page) == "strict"
    assert check_row(["Белки, г", "66", "30"], page) == "weak"
    assert check_row(["Белки, г", "67", "30"], page) == "fail"
    assert table_cells(r"| a \| b | c |") == ["a | b", "c"]


def test_verify_checks_blocks_against_a_page_reader(tmp_path: Path) -> None:
    workspace = _copy(tmp_path)
    pages: dict[tuple[str, int], str] = {}

    def reader(pdf: Path, page: int) -> str:
        return pages.get((pdf.name, page), "")

    report = verify_feeding_sources(workspace, tmp_path / "library", read_page=reader)
    assert report.checked > 800
    assert len(report.failures) > 800  # nothing is on the empty pages
    assert report.failures[0].startswith("reference.feeding.")
    assert report.scan_blocks >= 8  # the Kapitan scan has no text layer to compare with


def test_verify_accepts_text_that_the_pdf_layer_hyphenates_and_interrupts(tmp_path: Path) -> None:
    sources = tmp_path / "docs"
    sources.mkdir()
    sha = "a" * 64
    document = (
        "---\nid: reference.feeding.sample\ntitle: Образец\nsource_type: medical_reference\n"
        "synthetic_fixture: false\nsource_checksum: sha256:" + sha + "\nmetadata:\n"
        "  rightsStatus: personal-library-private-use\n  navigationAliases:\n  - образец\n"
        "  sourceBooks:\n  - id: b\n    citation: Книга\n    privateLibraryFile: b.pdf\n"
        "    sha256: " + sha + "\n---\n\n# Образец\n\n"
        '<!-- localmed:source {"bookId":"b","contentMode":"verbatim","pdfPages":"1–2",'
        '"sourceSection":"гл. 1"} -->\n\n*Источник: Книга, с. 1.*\n\n'
        "Суточный объем питания рассчитывают по формуле Шкарина для ребенка.\n\n"
        "| Возраст | Объем |\n| --- | --- |\n| 2 мес | 800 мл |\n"
    )
    (sources / "reference.feeding.sample.md").write_text(document, encoding="utf-8")
    pages = {
        1: "Суточный объем пита-\nния рассчитывают по формуле",
        2: "12\nШкарина для ребенка.\nВозраст Объем\n2 мес\n800 мл",
    }
    report = verify_feeding_sources(sources, tmp_path, read_page=lambda _pdf, number: pages[number])
    assert report.failures == []
    assert report.checked == 3  # the paragraph, the header row and one data row
    assert check_document(sources / "reference.feeding.sample.md").table_rows == 1


def test_workspace_lints_builds_and_packages(tmp_path: Path) -> None:
    workspace = _copy(tmp_path)
    prepare_feeding_norms(workspace)
    assert lint_content_pack(load_content_pack(workspace)) == []
    database = tmp_path / "feeding.db"
    build_content_pack(workspace, database, include_embeddings=False, compact_search_text=True)
    report = package_feeding_module(
        database, tmp_path / "release", version="2026.10.13", min_app_version="0.6.59"
    )
    assert report["documents"] == 16
    entry = json.loads(Path(str(report["catalogEntry"])).read_text(encoding="utf-8"))
    assert entry["id"] == "minimed.reference.feeding.ru"
    assert entry["collection"] == "feeding"
    assert entry["kind"] == "reference"
    assert entry["releaseState"] == "preview"
    assert entry["compatibility"]["minAppVersion"] == "0.6.59"
    assert len(entry["documents"]) == 16
    assert set(report["books"]) == BOOK_IDS  # type: ignore[arg-type]
