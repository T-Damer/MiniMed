"""FIX-BATCH2: block repairs applied by re-rendering a stored extraction."""

from __future__ import annotations

import pytest

from localmed_ingest.grls_contents_lists import BodyNotReproducedError
from localmed_ingest.grls_render_repair import fix_codes, is_junk_heading, rerender_repaired
from localmed_ingest.models import ExtractedBlock, ExtractedPage, ExtractedSource
from localmed_ingest.source_registry import render_body


def _block(index: int, kind: str, text: str, bbox: list[float] | None = None) -> ExtractedBlock:
    return ExtractedBlock(
        id=f"p1-b{index + 1}",
        page=1,
        order_index=index,
        kind=kind,  # type: ignore[arg-type]
        text=text,
        bbox=bbox or [80.0, 100.0 + index * 20, 400.0, 112.0 + index * 20],
        heading_level=1 if kind == "heading" else None,
    )


def _source(blocks: list[ExtractedBlock], mode: str) -> ExtractedSource:
    return ExtractedSource.model_validate(
        {
            "schemaVersion": 2,
            "extractorRevision": 1,
            "sourceFile": "pdf/x.pdf",
            "sourceChecksum": "sha256:" + "0" * 64,
            "sourceFormat": "pdf",
            "pages": [
                ExtractedPage(
                    page=1, width=595, height=842, blocks=blocks, character_count=100
                ).model_dump(by_alias=True)
            ],
            "diagnostics": {
                "sourceChecksum": "sha256:" + "0" * 64,
                "sourceFormat": "pdf",
                "pageCount": 1,
                "blockCount": len(blocks),
                "includedBlockCount": len(blocks),
                "characterCount": 100,
                "removedRepeatedBlocks": 0,
                "headingCandidates": 0,
                "tableCandidates": 0,
                "qualityScore": 1.0,
                "requiresReview": False,
                "textExtractionMode": mode,
            },
        }
    )


def _prepared(source: ExtractedSource, document_id: str = "doc") -> str:
    return f"---\nid: {document_id}\n---\n\n{render_body(source, source_id=document_id)}"


@pytest.mark.parametrize(
    "text",
    [
        "08103m90 • ОГРН 112189 Г. ЯРОС!",
        "ИНН 7701234567",
        "||| 0062 ..",
        "12-34/5",
        "ЛП-Nº(000577)-(PГ-RU) -160222",
        "МИНИСТЕРСТВО ЗДРАВООХРАНЕНИЯ РОССИЙСКОЙ ФЕДЕРАЦИИ",
        "Нарушения со стороны крови | Часто | Редко",
        "применяют при болях в суставах",
    ],
)
def test_stamps_and_scan_noise_are_not_headings(text: str) -> None:
    assert is_junk_heading(text)


@pytest.mark.parametrize(
    "text",
    [
        "Побочное действие",
        "Взаимодействие с другими лекарственными средствами",
        "Состав",
        "Применение препарата у взрослых:",
        "ТАСИГНА®",
    ],
)
def test_section_titles_stay_headings(text: str) -> None:
    assert not is_junk_heading(text)


def test_an_ocr_stamp_heading_is_rendered_as_text_of_the_claims_section() -> None:
    source = _source(
        [
            _block(0, "heading", "Организация, принимающая претензии потребителей"),
            _block(1, "paragraph", "ООО «КлинФармДевелопмент»"),
            _block(2, "heading", "08103m90 • ОГРН 112189 Г. ЯРОС!"),
        ],
        "ocr",
    )
    result = rerender_repaired("doc", _prepared(source), source)
    assert result is not None
    assert result.headings_demoted == 1
    assert "# 08103m90" not in result.markdown
    assert "08103m90 • ОГРН 112189 Г. ЯРОС!" in result.markdown
    assert '"demotedFrom":"heading"' in result.markdown or "08103m90" in result.markdown


def test_a_text_layer_table_held_cell_by_cell_is_marked_not_rewritten() -> None:
    cells = [
        ("Учащенные", 91, 497),
        ("Дизурия", 282, 497),
        ("Нарушение", 378, 497),
        ("позывы к", 186, 516),
        ("мочеиспускания", 378, 516),
        ("мочеиспуска-", 186, 535),
        ("Задержка мочи", 378, 535),
        ("нию13", 186, 554),
        ("Гинекологичес-", 91, 593),
        ("Сексуальная", 282, 593),
        ("Галакторея", 378, 593),
        ("кие", 186, 612),
        ("дисфункция16", 282, 612),
        ("Гиперпролакти-", 378, 612),
    ]
    blocks = [
        _block(i, "paragraph", text, [x, y, x + 70.0, y + 12.0])
        for i, (text, x, y) in enumerate(cells)
    ]
    source = _source(blocks, "pdf_text_layer")
    result = rerender_repaired("doc", _prepared(source), source)
    assert result is not None
    assert result.flattened_table_blocks >= 8
    assert "localmed:review table-candidate" in result.markdown
    for text, _x, _y in cells:
        assert text in result.markdown


def test_nothing_to_repair_gives_none_and_an_edited_body_is_refused() -> None:
    source = _source([_block(0, "heading", "Состав"), _block(1, "paragraph", "Текст.")], "ocr")
    assert rerender_repaired("doc", _prepared(source), source) is None
    with pytest.raises(BodyNotReproducedError):
        rerender_repaired("doc", _prepared(source) + "\nправка руками\n", source)


def test_drug_codes_written_with_cyrillic_look_alikes_are_spelled_in_latin() -> None:
    text, fixes = fix_codes("Ингибиторы СУРЗА4 и СУР2D6; код АТХ А10ВВ09, ВОIАC06 и СОСТАВ.")
    assert text == "Ингибиторы CYP3A4 и CYP2D6; код АТХ A10BB09, B01AC06 и СОСТАВ."
    assert fixes == [
        ["СУРЗА4", "CYP3A4"],
        ["СУР2D6", "CYP2D6"],
        ["А10ВВ09", "A10BB09"],
        ["ВОIАC06", "B01AC06"],
    ]
    assert fix_codes("Латинский CYP3A4 и слово ПРЕПАРАТ")[1] == []


def test_a_running_page_header_read_as_a_heading_becomes_a_page_mark() -> None:
    source = _source(
        [
            _block(0, "heading", "КЛОЗАПИН АВЕКСИМА"),
            _block(1, "heading", "Состав"),
            _block(2, "paragraph", "Клозапин 25 мг."),
            _block(3, "heading", "КЛОЗАПИН АВЕКСИМА"),
            _block(4, "paragraph", "Текст следующей страницы."),
        ],
        "ocr",
    )
    prepared = _prepared(source).replace(
        "id: doc\n", "id: doc\nmetadata:\n  tradeName: Клозапин Авексима\n"
    )
    result = rerender_repaired("doc", prepared, source)
    assert result is not None
    assert result.running_headers == 1
    body = result.markdown.split("\n---\n", 1)[1]
    assert body.count("# КЛОЗАПИН АВЕКСИМА") == 1
    assert "localmed:page-mark" in body
