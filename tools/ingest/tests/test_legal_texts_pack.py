"""Integrity of the full texts of the regulatory acts (LEGAL1): committed cards, provenance and review logs.

No network, no private data: everything checked here is committed under content/regulatory-rf-pilot and
content/regulatory-rf-texts. Search by act number is covered by `bun run benchmark:regulatory`.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

from localmed_ingest.builder import build_content_pack, lint_content_pack, load_content_pack
from localmed_ingest.regulatory_distribution import check_act_metadata

ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT / "content" / "regulatory-rf-pilot"
TEXTS = ROOT / "content" / "regulatory-rf-texts"
SOURCES = json.loads((TEXTS / "sources.json").read_text(encoding="utf-8"))["acts"]
CHECKSUM = "sha256:" + "0" * 64
AWAITING_FULL_TEXT = {
    "order-374n-disability-criteria.md",
}
"""Acts whose full text is still being converted and reviewed (LEGAL1). The set only shrinks; it must be empty
when the full-text module is released (`test_no_act_awaits_its_full_text`)."""


def _done() -> list[dict[str, Any]]:
    return [row for row in SOURCES if row["card"] not in AWAITING_FULL_TEXT]


def _card(row: dict[str, Any]) -> tuple[dict[str, Any], str]:
    text = (PACK / row["card"]).read_text(encoding="utf-8")
    match = re.match(r"---\n(.*?)\n---\n(.*)", text, re.DOTALL)
    assert match, row["card"]
    return yaml.safe_load(match.group(1)), match.group(2)


def _provenance(row: dict[str, Any]) -> dict[str, Any]:
    return json.loads((TEXTS / f"{row['slug']}.provenance.json").read_text(encoding="utf-8"))


def test_every_act_of_the_pack_has_a_recorded_official_file() -> None:
    cards = {
        path.name
        for path in PACK.glob("*.md")
        if "source_type: regulatory_act_summary" in path.read_text(encoding="utf-8")[:2000]
    }
    assert {row["card"] for row in SOURCES} == cards
    assert len(SOURCES) == 30
    for row in SOURCES:
        assert re.fullmatch(r"[0-9a-f]{64}", row["sha256"]), row["slug"]
        assert row["bytes"] > 0 and row["officialUrl"].startswith("https://")
        assert row["record"]["number"] and row["record"]["documentDate"] and row["record"]["name"]


def test_the_awaiting_list_is_honest() -> None:
    paraphrase = {
        path.name
        for path in PACK.glob("*.md")
        if "source_type: regulatory_act_summary" in path.read_text(encoding="utf-8")[:2000]
        and "contentMode: source_text" not in path.read_text(encoding="utf-8")[:6000]
    }
    assert paraphrase == AWAITING_FULL_TEXT


def test_every_act_is_complete_and_its_text_is_the_full_text() -> None:
    for row in _done():
        front, body = _card(row)
        metadata = front["metadata"]
        assert check_act_metadata(front["id"], front["source_type"], metadata, CHECKSUM) == [], row[
            "slug"
        ]
        assert metadata["contentMode"] == "source_text", row["slug"]
        assert metadata["description"], row["slug"]
        # The identity in the card is the portal's (or the ministry's), not an OCR reading of a stamp.
        assert metadata["documentNumber"] == row["record"]["number"], row["slug"]
        assert metadata["signedAt"] == row["record"]["documentDate"][:10], row["slug"]
        assert metadata["textReading"], row["slug"]
        sections = re.split(r"\n(?=# )", body.strip())
        assert sections[-1].startswith("# Источник и редакция"), row["slug"]
        # a full text is long: the paraphrase cards were 3-17 KB
        assert len(body) > 8000, f"{row['slug']}: {len(body)} characters"
        for section in sections:
            visible = re.sub(r"<!--.*?-->", "", section.partition("\n")[2], flags=re.DOTALL).strip()
            assert visible, f"{row['slug']}: empty section {section.partition(chr(10))[0]}"


def test_scanned_acts_have_page_provenance_and_no_unreviewed_page() -> None:
    for row in _done():
        if row["reader"] not in ("scan", "tiff-zip"):
            continue
        front, body = _card(row)
        provenance = _provenance(row)
        assert provenance["source"]["sha256"] == row["sha256"], row["slug"]
        pages = provenance["pages"]
        expected = (
            front["metadata"].get("sourcePdfPages")
            or row["record"].get("pagesCount")
            or len(provenance["pages"])
        )
        assert [p["page"] for p in pages] == list(range(1, int(expected) + 1)), row["slug"]
        review_path = TEXTS / f"{row['slug']}.review.json"
        review = json.loads(review_path.read_text(encoding="utf-8")) if review_path.exists() else {}
        verdicts = {int(k) for k in review.get("verdicts", {})}
        corrected = {int(c["page"]) for c in review.get("corrections", [])}
        for page in pages:
            assert page["reading"] and page["confidence"], (row["slug"], page["page"])
            assert page["status"] != "review", (row["slug"], page["page"], "flagged, not reviewed")
            if page["flags"]:
                assert page["page"] in verdicts | corrected, (row["slug"], page["page"])
        assert corrected <= verdicts | corrected
        # every page of the PDF is represented in the text by a source span
        spans: set[int] = set()
        for match in re.finditer(r'"page":(\d+)(?:,"pageEnd":(\d+))?', body):
            first = int(match.group(1))
            spans.update(range(first, int(match.group(2) or first) + 1))
        blank = {p["page"] for p in pages if p.get("blank")}
        missing = set(range(1, int(expected) + 1)) - spans - blank
        assert not missing, f"{row['slug']}: pages without text {sorted(missing)}"


def test_review_logs_are_well_formed() -> None:
    for path in sorted(TEXTS.glob("*.review.json")):
        review = json.loads(path.read_text(encoding="utf-8"))
        assert review["reviewer"] and review["reviewedAt"], path.name
        for item in review.get("corrections", []):
            assert item["find"] != item["replace"] and item["why"], (path.name, item["page"])
        assert path.name.removesuffix(".review.json") in {row["slug"] for row in SOURCES}


def _render_tables(body: str) -> list[tuple[str, dict[str, Any]]]:
    found: list[tuple[str, dict[str, Any]]] = []
    for match in re.finditer(r"<!-- localmed:source (\{.*\}) -->", body):
        source = json.loads(match.group(1))
        block = source.get("renderBlock")
        if block and block.get("kind") == "table":
            found.append((f"page {source.get('page')}", block))
    return found


def test_tables_are_rectangular_and_have_no_empty_rows() -> None:
    """The reader draws a `renderBlock` table as it is: a ragged or an empty row would show as a broken table."""
    for row in _done():
        _, body = _card(row)
        for where, block in _render_tables(body):
            rows = block["rows"]
            assert rows and rows[0]["cells"] and all(c["header"] for c in rows[0]["cells"]), (
                row["slug"],
                where,
                "no header row",
            )
            widths = {sum(cell["colSpan"] for cell in r["cells"]) for r in rows if r["cells"]}
            assert len(widths) == 1, (row["slug"], where, f"ragged table, widths {sorted(widths)}")
            filled = [any(cell["text"].strip() for cell in r["cells"]) for r in rows]
            # empty rows at the end of a table are the blank lines of a printed form; one between filled rows is an artefact
            last_filled = max(i for i, f in enumerate(filled) if f)
            stray = [i + 1 for i, f in enumerate(filled) if not f and i < last_filled]
            assert not stray, (row["slug"], where, f"empty rows {stray}")


def test_the_pack_with_full_texts_builds_and_lints(tmp_path: Path) -> None:
    assert lint_content_pack(load_content_pack(PACK)) == []
    database = tmp_path / "regulatory.db"
    build_content_pack(PACK, database, include_embeddings=False)
    assert database.stat().st_size > 0
