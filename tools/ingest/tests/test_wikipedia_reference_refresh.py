from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import Projection
from localmed_ingest.wikipedia_definitions import Snapshot, encoded, sha, source_descriptor
from localmed_ingest.wikipedia_reference_refresh import (
    SourceRecord,
    deepen_record,
    merge_new_records,
    read_records,
    repack,
    write_shards,
)
from localmed_ingest.wikipedia_reference_sections import extract_sections

INTRO = "Исходное учебное описание условного инструмента, не клиническая рекомендация."
HTML = (
    '<div class="mw-parser-output"><p>' + INTRO + "</p>"
    '<div class="mw-heading"><h2 id="Items">Пункты</h2></div>'
    '<ol start="3"><li>Первый пункт</li><li value="9">Второй пункт</li></ol>'
    '<h2><span id="Table">Таблица</span></h2>'
    "<table><caption>Исходные значения</caption><tr><th>Группа</th><th>Значение</th></tr>"
    '<tr><td rowspan="2">А</td><td>1</td></tr><tr><td>2</td></tr></table>'
    '<h2 id="Limitations">Ограничения</h2><p>Содержательное ограничение источника.</p>'
    '<div class="navbox"><p>Навигация, не определение</p></div></div>'
)


def record(page_id: int = 72, body: str = INTRO) -> SourceRecord:
    source = source_descriptor("2026-09-22")
    block = {
        "id": 1,
        "source": 1,
        "text": body,
        "textSha256": sha(body.encode()),
        "path": "Fixture",
        "locator": "Synthetic introduction",
        "pageId": page_id,
        "observedRevisionId": 12345,
    }
    term = {
        "id": f"ruwiki.definition.{page_id}",
        "title": "Условная шкала",
        "kind": "scale",
        "aliases": [],
        "coverage": "source-description",
        "blockIds": [1],
    }
    return SourceRecord(term, {1: block}, {1: source})


def snapshot(html: str = HTML, page_id: int = 72, revision: int = 12345) -> Snapshot:
    data: dict[str, object] = {
        "parse": {"pageid": page_id, "revid": revision, "title": "Условная шкала", "text": html}
    }
    return Snapshot(data, sha(encoded(data)), "2026-09-22T00:00:00+00:00")


def test_full_sections_keep_order_lists_and_source_limitations() -> None:
    sections, _ = extract_sections(HTML)
    assert [s.title for s in sections] == ["Вводный раздел", "Пункты", "Таблица", "Ограничения"]
    assert sections[0].text == INTRO
    assert sections[1].text == "3. Первый пункт\n9. Второй пункт"
    assert sections[1].anchor == "Items"
    assert sections[2].anchor == "Table"
    assert sections[3].text == "Содержательное ограничение источника."
    assert "Навигация" not in " ".join(s.text for s in sections)


def test_table_preserves_physical_rows_headers_and_merged_cell_geometry() -> None:
    sections, _ = extract_sections(HTML)
    table = sections[2].tables[0]
    assert len(table) == 3
    assert [len(row) for row in table] == [2, 2, 1]
    assert table[0][0] == {"text": "Группа", "header": True, "rowspan": 1, "colspan": 1}
    assert table[1][0] == {"text": "А", "header": False, "rowspan": 2, "colspan": 1}
    assert table[2][0]["text"] == "2"
    assert "rowspan=2, colspan=1" in sections[2].text
    assert "Исходные значения" in sections[2].text


def test_unicode_inline_punctuation_and_entities_are_not_word_soup() -> None:
    sections, _ = extract_sections(
        "<p>Условный <b>термин</b> — исходное определение с α, 🔬 и &lt;3; "
        "дополнительный текст.</p>"
    )
    assert sections[0].text == (
        "Условный термин — исходное определение с α, 🔬 и <3; дополнительный текст."
    )


def test_assets_are_not_text_or_fetched() -> None:
    sections, omitted = extract_sections(
        "<script>steal()</script><p>" + INTRO + '<img src="https://example.org/private" /></p>'
    )
    assert sections[0].text == INTRO
    assert omitted["media"] == 1
    assert omitted["layout"] == 1


def test_nested_lists_keep_each_item_once() -> None:
    sections, _ = extract_sections(
        "<p>" + INTRO + '</p><h2 id="x">Группа</h2>'
        "<ol><li>Главный<ul><li>Деталь А</li><li>Деталь Б</li></ul></li><li>Последний</li></ol>"
    )
    assert sections[1].text == "1. Главный\n• Деталь А\n• Деталь Б\n2. Последний"


@pytest.mark.parametrize(
    "html",
    [
        "<p>Коротко</p>",
        "<p>" + INTRO + '</p><table><tr><td rowspan="0">A</td></tr></table>',
        "<p>" + INTRO + "</p><table><tr><td><table><tr><td>A</td></tr></table></td></tr></table>",
        "<p>" + INTRO + '</p><ol start="NaN"><li>A</li></ol>',
        "<p>" + INTRO + "\0</p>",
    ],
)
def test_unsupported_layout_is_explicit_rejection_not_silent_cell_loss(html: str) -> None:
    with pytest.raises(ValueError):
        extract_sections(html)


def test_sections_stay_reference_only_and_bound_to_actual_revision() -> None:
    old = record()
    original = copy.deepcopy(old)
    updated, report = deepen_record(old, snapshot(), 12345, "2026-09-22")
    assert old == original
    assert updated.term["id"] == old.term["id"]
    assert updated.term["blockIds"] == [1]
    assert updated.term["detailBlocks"] == [2, 3, 4]
    assert "itemBlocks" not in updated.term
    assert "scoring" not in updated.term and "interactiveRoute" not in updated.term
    assert updated.blocks[3]["tableReviewStatus"] == "requires-review"
    assert updated.blocks[3]["revisionId"] == 12345
    assert updated.blocks[3]["apiResponseSha256"] == snapshot().response_sha256
    assert report["sections"] == 4 and report["tables"] == 1
    payload = repack([updated])
    projection = Projection()
    projection.add(payload, sha(encoded(payload)))
    assert len(projection.entries) == 1
    assert read_records(payload)["ruwiki.definition.72"].term == updated.term


@pytest.mark.parametrize(("page_id", "revision"), [(73, 12345), (72, 12346)])
def test_wrong_page_or_revision_cannot_replace_a_card(page_id: int, revision: int) -> None:
    with pytest.raises(ValueError, match="page or revision"):
        deepen_record(record(), snapshot(page_id=page_id, revision=revision), 12345, "2026-09-22")


def test_same_page_is_not_new_even_when_its_latest_description_changes() -> None:
    old, incoming = record(), record(body=INTRO + " Изменение.")
    combined, counts = merge_new_records(
        {"ruwiki.definition.72": old}, {"ruwiki.definition.72": incoming}
    )
    assert combined["ruwiki.definition.72"] is old
    assert counts == {"newPageIdentities": 0, "overlapPageIdentities": 1}


def test_identical_titles_do_not_merge_distinct_page_identities() -> None:
    combined, counts = merge_new_records(
        {"ruwiki.definition.72": record()}, {"ruwiki.definition.73": record(73)}
    )
    assert len(combined) == 2 and counts["newPageIdentities"] == 1
    payload = repack(list(combined.values()))
    assert len(read_records(payload)) == 2


def test_numeric_namespaces_cannot_cross_link_source_text() -> None:
    a, b = record(), record(73, INTRO + " Второе значение.")
    result = read_records(repack([a, b]))
    for key, expected in (
        ("ruwiki.definition.72", INTRO),
        ("ruwiki.definition.73", INTRO + " Второе значение."),
    ):
        item = result[key]
        assert [v["text"] for v in item.blocks.values()] == [expected]
    assert len(result["ruwiki.definition.72"].sources) == 1


def test_root_annotations_cannot_be_silently_dropped() -> None:
    payload = repack([record()])
    payload["historicalMentions"] = [{"name": "Unresolved"}]
    with pytest.raises(ValueError, match="Root source annotations"):
        read_records(payload)


def test_generated_shards_roundtrip_and_cannot_overwrite_previous_outputs(tmp_path: Path) -> None:
    values = [record(), record(73, INTRO + " Другая запись.")]
    paths = write_shards(values, tmp_path)
    assert len(paths) == 1
    loaded = read_records(json.loads(paths[0].read_bytes()))
    assert set(loaded) == {"ruwiki.definition.72", "ruwiki.definition.73"}
    before = paths[0].read_bytes()
    with pytest.raises(FileExistsError):
        write_shards(values, tmp_path)
    assert paths[0].read_bytes() == before
