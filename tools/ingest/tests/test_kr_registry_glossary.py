from __future__ import annotations

import json
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any

from localmed_ingest.definition_reference_pack import Projection
from localmed_ingest.kr_registry_cli import resolve_anchors, split_shards
from localmed_ingest.kr_registry_glossary import (
    SECTION_DISEASE,
    SECTION_TERMS,
    ExtractionStats,
    build_shard,
    extract_document,
    fold_entries,
    read_registry_document,
    section_paragraphs,
)


def _registry_file(
    directory: Path,
    code: str,
    terms_html: str,
    *,
    name: str = "Переломы",
    mkb: str = "S72.3",
    disease_html: str = "",
    status: int = 0,
) -> Path:
    payload: dict[str, Any] = {
        "id": code,
        "name": name,
        "mkb": mkb,
        "mkbs": mkb.split("/"),
        "status": status,
        "apply_status": "Применяется",
        "obj": {
            "sections": [
                {"id": SECTION_TERMS, "title": "Термины и определения", "content": terms_html},
                {"id": SECTION_DISEASE, "title": "1.1 Определение", "content": disease_html},
            ]
        },
    }
    path = directory / f"{code}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def _entries(tmp_path: Path, html: str, **kwargs: Any) -> tuple[list[Any], ExtractionStats]:
    path = _registry_file(tmp_path, "904_1", html, **kwargs)
    stats = ExtractionStats()
    document = read_registry_document(path, tmp_path)
    return extract_document(document, stats), stats


def test_html_paragraphs_keep_bold_prefix_and_collapse_space() -> None:
    paragraphs = section_paragraphs(
        "<p><strong>Исход</strong>&nbsp;– любой&nbsp;результат.</p><ul><li>пункт</li></ul>"
    )
    assert [p.text for p in paragraphs] == ["Исход – любой результат.", "пункт"]
    assert paragraphs[0].bold_prefix == "Исход"
    assert paragraphs[1].is_list_item


def test_depression_keeps_its_traumatology_sense_and_field(tmp_path: Path) -> None:
    entries, _ = _entries(
        tmp_path,
        "<p>Импрессия – процесс формирования перелома суставной поверхности.</p>"
        "<p><strong>Депрессия</strong> – процесс формирования перелома суставной поверхности "
        "кости, при котором зона импрессии отделяется от основной суставной поверхности.</p>",
    )
    assert [entry.title for entry in entries] == ["Импрессия", "Депрессия"]
    shard = build_shard(fold_entries(entries), edition="test")
    block = next(b for b in shard["blocks"] if b["text"].startswith("Депрессия"))
    assert block["field"] == "traumatology"
    assert block["documentId"] == "kr.rf.904_1"
    assert block["path"] == "preview-cr/904_1"


def test_dash_inside_bracket_does_not_cut_the_term(tmp_path: Path) -> None:
    entries, stats = _entries(
        tmp_path,
        "<p>Толерантность (лат. – tolerantia, «выносливость, способность переносить») — "
        "прогрессирующее ослабление эффекта.</p>"
        "<p>2 балла – 10-19 в 10 полях</p>"
        "<p>а) простой стеатоз – состояние без воспаления.</p>",
    )
    assert [entry.title for entry in entries] == ["Толерантность", "простой стеатоз"]
    assert entries[0].aliases == ("tolerantia", "«выносливость, способность переносить»")
    assert stats.rejected["score-line"] == 1
    assert entries[1].flags == ("list-item",)


def test_continuation_paragraph_joins_the_previous_definition(tmp_path: Path) -> None:
    entries, stats = _entries(
        tmp_path,
        "<p>Стадии – ступени развития:</p><ul><li>первая;</li><li>вторая.</li></ul>",
    )
    assert len(entries) == 1
    assert entries[0].text == "Стадии – ступени развития:\nпервая;\nвторая."
    assert stats.continuation_paragraphs == 2


def test_prose_without_a_pair_is_counted_not_forced(tmp_path: Path) -> None:
    entries, stats = _entries(tmp_path, "<p>Не применяются.</p>")
    assert entries == []
    assert stats.unparsed_paragraphs == 1


def test_sentence_is_rejected_with_a_named_reason(tmp_path: Path) -> None:
    entries, stats = _entries(
        tmp_path,
        "<p>Агорафобия происходит от греческого корня «агора», означающего место, строение "
        "и площадь собрания – такова этимология.</p>",
    )
    assert entries == []
    assert stats.rejected["sentence-as-term"] == 1


def test_identical_wording_folds_with_one_block_per_recommendation(tmp_path: Path) -> None:
    stats = ExtractionStats()
    entries = []
    for code in ("1_1", "2_1"):
        path = _registry_file(tmp_path, code, "<p>Исход – любой результат воздействия.</p>")
        entries += extract_document(read_registry_document(path, tmp_path), stats)
    other = _registry_file(tmp_path, "3_1", "<p>Исход – итог лечения.</p>")
    entries += extract_document(read_registry_document(other, tmp_path), stats)
    folded = fold_entries(entries)
    assert sorted(len(item.entries) for item in folded) == [1, 2]
    assert len({item.identifier for item in folded}) == 2


def test_replaced_edition_follows_the_current_one(tmp_path: Path) -> None:
    stats = ExtractionStats()
    old = _registry_file(tmp_path, "9_1", "<p>Исход – результат.</p>", status=4)
    new = _registry_file(tmp_path, "9_2", "<p>Исход – результат.</p>")
    entries = extract_document(read_registry_document(old, tmp_path), stats)
    entries += extract_document(read_registry_document(new, tmp_path), stats)
    (item,) = fold_entries(entries)
    assert [member.document.current for member in item.entries] == [True, False]


def test_single_paragraph_disease_section_defines_the_recommendation_title(
    tmp_path: Path,
) -> None:
    entries, _ = _entries(
        tmp_path,
        "",
        name="Эпилепсия (Другие уточненные нарушения, МКБ)",
        disease_html="<p>Хроническое заболевание мозга с повторными приступами.</p>",
    )
    assert [e.title for e in entries] == ["Эпилепсия"]
    assert entries[0].flags == ("section-defines-title",)


def test_shard_is_a_valid_draft_input_for_the_reference_projection(tmp_path: Path) -> None:
    entries, _ = _entries(
        tmp_path,
        "<p>Депрессия – процесс формирования перелома суставной поверхности кости.</p>",
    )
    shard = build_shard(fold_entries(entries), edition="test")
    projection = Projection()
    projection.add(shard, "0" * 64)
    (entry,) = projection.entries.values()
    assert entry.title == "Депрессия"
    assert entry.coverage == "explicit-definition"


def test_split_shards_renumber_blocks_and_stay_loadable(tmp_path: Path) -> None:
    html = "".join(f"<p>Термин{i} – определение номер {i}.</p>" for i in range(30))
    entries, _ = _entries(tmp_path, html)
    shard = build_shard(fold_entries(entries), edition="test")
    parts = split_shards(shard, limit=5000)
    assert len(parts) > 1
    assert sum(len(part["terms"]) for part in parts) == 30
    for part in parts:
        ids = [block["id"] for block in part["blocks"]]
        assert ids == list(range(1, len(ids) + 1))
        Projection().add(part, "1" * 64)


def test_anchor_comes_from_the_reader_chunk_that_holds_the_paragraph(tmp_path: Path) -> None:
    entries, _ = _entries(
        tmp_path, "<p>Депрессия – процесс формирования перелома суставной поверхности кости.</p>"
    )
    databases = tmp_path / "databases"
    databases.mkdir()
    with closing(sqlite3.connect(databases / "clinical-904_1-clinical-json-x.db")) as connection:
        connection.executescript(
            "CREATE TABLE sections(id TEXT, title TEXT, order_index INT);"
            "CREATE TABLE chunks(id TEXT, section_id TEXT, original_text TEXT, anchor TEXT,"
            " document_version_id TEXT, order_index INT);"
            "INSERT INTO sections VALUES('s1','Термины и определения',3);"
            "INSERT INTO chunks VALUES('chunk.aa','s1',"
            "'Импрессия – x\n\nДепрессия – процесс формирования перелома суставной поверхности "
            "кости.','kr.rf.904_1@904_1/термины-и-определения#chunk-aa','kr.rf.904_1@904_1',0);"
        )
        connection.commit()
    anchors, outcome = resolve_anchors(entries, [databases])
    assert outcome == Counter(anchored=1)
    shard = build_shard(fold_entries(entries), edition="test", anchors=anchors)
    assert shard["blocks"][0]["anchor"] == "kr.rf.904_1@904_1/термины-и-определения#chunk-aa"
    _, missing = resolve_anchors(entries, [tmp_path / "nowhere"])
    assert missing == Counter({"no-reader-document": 1})
