from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import pymupdf

from localmed_ingest.markdown_parser import parse_sections
from localmed_ingest.models import ExtractedBlock, ExtractedPage
from localmed_ingest.ocr_requality import (
    CleanupCounters,
    assemble_lines,
    extract_with_vision,
    grade_quality,
    native_page_usable,
    refine_page,
)
from localmed_ingest.ocr_text_cleanup import Lexicon
from localmed_ingest.source_registry import render_body

LEXICON = Lexicon(
    cyrillic={
        "лекарственного": 900,
        "средства": 900,
        "препарата": 900,
        "применения": 900,
        "инъекций": 400,
        "принимают": 900,
        "внутрь": 900,
        "после": 900,
        "еды": 900,
    }
)
WIDTH, HEIGHT = 595.0, 842.0


def observation(
    text: str, x: float, y_top: float, width: float, confidence: float = 0.95
) -> dict[str, Any]:
    """A Vision observation: bbox is bottom-left based and normalised."""
    height = 12.0
    return {
        "text": text,
        "confidence": confidence,
        "bbox": [x / WIDTH, 1 - (y_top + height) / HEIGHT, width / WIDTH, height / HEIGHT],
    }


def page(*observations: dict[str, Any]) -> dict[str, Any]:
    return {"page": 1, "width": WIDTH, "height": HEIGHT, "lines": list(observations)}


def block(
    index: int, text: str, top: float, *, kind: str = "paragraph", left: float = 80.0
) -> ExtractedBlock:
    return ExtractedBlock(
        id=f"p1-b{index + 1}",
        page=1,
        order_index=index,
        kind=kind,  # type: ignore[arg-type]
        text=text,
        bbox=[left, top, 500.0, top + 12.0],
    )


def refine(
    blocks: list[ExtractedBlock], protected: tuple[str, ...] = ()
) -> tuple[ExtractedPage, CleanupCounters]:
    counters = CleanupCounters()
    source = ExtractedPage(page=1, width=WIDTH, height=HEIGHT, blocks=blocks, character_count=0)
    return refine_page(source, {}, LEXICON, protected, counters), counters


def test_observations_on_one_baseline_are_one_line() -> None:
    lines = assemble_lines(
        page(
            observation("гипогликемического", 82, 100, 112),
            observation("эффекта", 202, 101, 48),
            observation("у", 263, 100, 6),
            observation("Следующая строка", 82, 114, 120),
        )
    )
    assert [line.text for line in lines] == ["гипогликемического эффекта у", "Следующая строка"]
    assert not lines[0].columnar


def test_a_wide_gap_is_a_table_column() -> None:
    lines = assemble_lines(
        page(
            observation("Дозировка", 90, 100, 120),
            observation("Срок годности", 330, 100, 110),
        )
    )
    assert lines[0].text == "Дозировка | Срок годности"
    assert lines[0].columnar


def test_a_stamp_on_the_title_baseline_is_its_own_line() -> None:
    lines = assemble_lines(
        page(observation("ИНСТРУКЦИЯ", 80, 100, 100), observation("СОГЛАСОВАНО", 420, 101, 90))
    )
    assert sorted(line.text for line in lines) == ["ИНСТРУКЦИЯ", "СОГЛАСОВАНО"]


def test_an_amendment_table_is_read_column_by_column() -> None:
    lines = assemble_lines(
        page(
            observation("Изменение № 4", 250, 60, 100),
            observation("Старая редакция", 110, 100, 120),
            observation("Новая редакция", 380, 100, 110),
            observation("Претензии потребителей", 100, 125, 170),
            observation("1) Организация, принимающая", 330, 125, 190),
            observation("направлять по адресу", 100, 138, 150),
            observation("претензии потребителей", 330, 138, 160),
            observation("ООО «Милосердие Фарм»", 100, 151, 160),
            observation("ООО «ФармПартнер»", 330, 151, 130),
            observation("Генеральный директор", 100, 260, 140),
        )
    )
    assert [line.text for line in lines] == [
        "Изменение № 4",
        "Старая редакция",
        "Претензии потребителей",
        "направлять по адресу",
        "ООО «Милосердие Фарм»",
        "Новая редакция",
        "1) Организация, принимающая",
        "претензии потребителей",
        "ООО «ФармПартнер»",
        "Генеральный директор",
    ]


def test_line_confidence_is_character_weighted() -> None:
    lines = assemble_lines(
        page(observation("aaaa", 82, 100, 40, 1.0), observation("bbbbbbbb", 130, 100, 80, 0.5))
    )
    assert lines[0].confidence is not None
    assert abs(lines[0].confidence - (4 * 1.0 + 8 * 0.5) / 12) < 1e-9


def test_lines_are_reflowed_into_paragraphs_with_a_hyphen_join() -> None:
    page_after, counters = refine(
        [
            block(0, "Препарат принимают внутрь после", 100),
            block(1, "еды. Дозу подбирает врач, лекарствен-", 113),
            block(2, "ного средства достаточно.", 126),
            block(3, "Новый абзац после большого интервала.", 190),
        ]
    )
    texts = [b.text for b in page_after.blocks]
    assert texts == [
        "Препарат принимают внутрь после еды. Дозу подбирает врач, "
        "лекарственного средства достаточно.",
        "Новый абзац после большого интервала.",
    ]
    assert counters.hyphens_joined == 1
    merged = page_after.blocks[0]
    assert merged.metadata["blocks"] == ["p1-b1", "p1-b2", "p1-b3"]
    assert merged.bbox == [80.0, 100.0, 500.0, 138.0]  # union of the line boxes, same page
    lines = cast(list[object], merged.metadata["lines"])
    assert len(lines) == 3  # raw lines stay in the extraction


def test_a_sentence_end_before_a_capital_starts_a_paragraph_and_a_field_label_does_too() -> None:
    page_after, _ = refine(
        [
            block(0, "Принимают внутрь.", 100),
            block(1, "Дозу подбирает врач", 113),
            block(2, "Торговое наименование: Мельдоний", 126),
            block(3, "Лекарственная форма: капсулы", 139),
        ]
    )
    assert [b.text for b in page_after.blocks] == [
        "Принимают внутрь.",
        "Дозу подбирает врач",
        "Торговое наименование: Мельдоний",
        "Лекарственная форма: капсулы",
    ]


def test_stamps_become_page_marks_not_text() -> None:
    page_after, counters = refine(
        [
            block(0, "СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ", 20),
            block(1, "ИНСТРУКЦИЯПОСЛЕДОВАТЕЛЬНОСТЬ 0001) ПО МЕДИЦИНСКОМУ", 60, kind="heading"),
            block(2, "Препарат принимают внутрь.", 100),
        ]
    )
    kinds = [(b.kind, b.text) for b in page_after.blocks]
    assert ("page_mark", "СООТВЕТСТВУЕТ ЭКСПЕРТНОМУ ОТЧЕТУ") in kinds
    assert ("page_mark", "ПОСЛЕДОВАТЕЛЬНОСТЬ 0001)") in kinds
    assert ("heading", "ИНСТРУКЦИЯ ПО МЕДИЦИНСКОМУ") in kinds
    assert counters.page_marks == 2
    assert page_after.character_count == len("ИНСТРУКЦИЯ ПО МЕДИЦИНСКОМУ") + len(
        "Препарат принимают внутрь."
    )


def test_standard_headings_are_recovered_and_codes_are_not_headings() -> None:
    page_after, counters = refine(
        [
            block(0, "ПОКАЗАНИЯ К ПРИМЕНЕНИЮ", 100),
            block(1, "Препарат принимают внутрь.", 113),
            block(2, "А10ВА02", 200, kind="heading"),
        ]
    )
    heading = page_after.blocks[0]
    assert heading.kind == "heading" and heading.heading_level == 2
    assert heading.metadata["promotedFrom"] == "standard-section"
    assert page_after.blocks[-1].kind == "paragraph"
    assert (counters.headings_recovered, counters.headings_demoted) == (1, 1)


def test_word_edits_keep_the_raw_text_and_numbers_are_only_marked() -> None:
    page_after, counters = refine(
        [block(0, "Максимальная концентрация (Стах) через 1О мин после иньекций", 100)]
    )
    paragraph = page_after.blocks[0]
    assert paragraph.text == "Максимальная концентрация (Cmax) через 1О мин после инъекций"
    assert (
        paragraph.metadata["ocrRaw"]
        == "Максимальная концентрация (Стах) через 1О мин после иньекций"
    )
    assert paragraph.metadata["review"] == "ocr-uncertain-number"
    assert paragraph.metadata["uncertainNumbers"] == ["1О"]
    assert counters.uncertain_numbers == 1
    assert "1О" in paragraph.text  # the number itself is untouched


def test_protected_product_names_are_not_edited() -> None:
    page_after, _ = refine([block(0, "после приема иньекций", 100)], protected=("иньекций",))
    assert page_after.blocks[0].text == "после приема иньекций"


def test_quality_grades() -> None:
    assert grade_quality(
        mean_confidence=0.95,
        low_confidence_ratio=0.01,
        unknown_ratio=0.02,
        uncertain_per_1000=0.0,
        word_count=900,
    ) == ("good", [])
    grade, reasons = grade_quality(
        mean_confidence=0.85,
        low_confidence_ratio=0.01,
        unknown_ratio=0.02,
        uncertain_per_1000=0.0,
        word_count=900,
    )
    assert grade == "fair" and "confidence" in reasons[0]
    grade, reasons = grade_quality(
        mean_confidence=0.7,
        low_confidence_ratio=0.3,
        unknown_ratio=0.2,
        uncertain_per_1000=9.0,
        word_count=900,
    )
    assert grade == "low" and len(reasons) == 4
    assert (
        grade_quality(
            mean_confidence=0.99,
            low_confidence_ratio=0.0,
            unknown_ratio=0.0,
            uncertain_per_1000=0.0,
            word_count=3,
        )[0]
        == "low"
    )


def test_end_to_end_scanned_page_renders_marks_review_and_parses(tmp_path: Path) -> None:
    pdf = tmp_path / "scan.pdf"
    document: Any = pymupdf.open()
    document.new_page(width=WIDTH, height=HEIGHT)  # no text layer: a scan
    document.save(pdf)
    document.close()
    payload = {
        "pages": [
            page(
                observation("СОГЛАСОВАНО", 420, 40, 90),
                observation("ПОКАЗАНИЯ К ПРИМЕНЕНИЮ", 80, 100, 200),
                observation("Принимают внутрь по 1О мг после", 80, 130, 300),
                observation("еды, после иньекций.", 80, 143, 200),
            )
        ]
    }
    extracted = extract_with_vision(pdf, payload, LEXICON)
    diagnostics = extracted.diagnostics
    assert diagnostics.text_extraction_mode == "ocr" and diagnostics.ocr_engine == "macos-vision"
    assert diagnostics.ocr_mean_confidence == 0.95
    assert diagnostics.ocr_cleanup["pageMarks"] == 1
    body = render_body(extracted)
    assert "<!-- localmed:page-mark" in body and '"text":"СОГЛАСОВАНО"' in body
    assert "<!-- localmed:review ocr-uncertain-number -->" in body
    assert '"ocrConfidence":0.95' in body
    sections = parse_sections(body)
    assert [section.title for section in sections] == ["ПОКАЗАНИЯ К ПРИМЕНЕНИЮ"]
    paragraph_texts = [p.text for section in sections for p in section.paragraphs]
    assert paragraph_texts == ["Принимают внутрь по 1О мг после еды, после инъекций."]
    assert "СОГЛАСОВАНО" not in paragraph_texts[0]
    assert sections[0].paragraphs[0].metadata["review"] == "ocr-uncertain-number"


def test_a_text_layer_that_reads_as_latin_noise_is_replaced_by_the_recognised_page(
    tmp_path: Path,
) -> None:
    pdf = tmp_path / "garbled.pdf"
    document: Any = pymupdf.open()
    sheet: Any = document.new_page(width=WIDTH, height=HEIGHT)
    # a broken font encoding: the Cyrillic text layer decodes to Latin look-alike noise
    sheet.insert_text((72, 100), "YTBEPXAAIO 3aprecrureJrb AnpeKTopa ufi upu paHeHHfl " * 3)
    document.save(pdf)
    document.close()
    payload = {"pages": [page(observation("Препарат принимают внутрь после еды.", 80, 100, 300))]}
    extracted = extract_with_vision(pdf, payload, LEXICON)
    assert extracted.diagnostics.text_extraction_mode == "ocr"
    assert extracted.diagnostics.ocr_pages == [1]
    texts = [b.text for p in extracted.pages for b in p.blocks]
    assert texts == ["Препарат принимают внутрь после еды."]


def test_native_text_layer_usability() -> None:
    russian = "Препарат принимают внутрь после еды, лекарственного средства достаточно. " * 15
    assert native_page_usable(russian, LEXICON)
    assert not native_page_usable("   ", LEXICON)
    # a broken font encoding: Latin look-alike noise
    assert not native_page_usable("YTBEPXAAIO 3aprecrureJrb AnpeKTopa ufi " * 10, LEXICON)
    # Cyrillic letters but almost no words on a full page: mis-mapped glyphs
    noise = "иI]с,грукI (ия I lO м с/lи Ilи I Ic кому IIри McI IcI " * 25
    assert not native_page_usable(noise, LEXICON)
    # a page of Latin species names with their Russian transliteration is a real text layer
    plants = (
        "Arnica montana (Арника монтана) Calendula officinalis (Календула) применения препарата "
        "лекарственного средства после еды принимают внутрь. "
    ) * 8
    assert native_page_usable(plants, LEXICON)
