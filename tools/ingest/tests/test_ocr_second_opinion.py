from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pymupdf

from localmed_ingest.ocr_requality import extract_with_vision
from localmed_ingest.ocr_second_opinion import (
    AltLine,
    choose_reading,
    digit_tokens,
    load_alt_lines,
    matching_alternative,
    numbers_conflict,
    reading_profile,
)
from localmed_ingest.ocr_text_cleanup import Lexicon
from localmed_ingest.source_registry import render_body

LEXICON = Lexicon(
    cyrillic={
        "упаковке": 500,
        "контурной": 500,
        "ячейковой": 500,
        "банке": 500,
        "полимерной": 500,
        "крышкой": 500,
        "препарата": 500,
        "применения": 500,
    },
    latin={"mg": 50},
)
WIDTH, HEIGHT = 595.0, 842.0


def test_reading_profile_counts_known_unknown_and_latin_junk() -> None:
    assert reading_profile("в контурной ячейковой упаковке", LEXICON) == (3, 0, 0)
    assert reading_profile("контурной пейовой раковке Hg Fan", LEXICON) == (1, 2, 2)
    assert reading_profile("по 10 mg", LEXICON) == (0, 0, 0)  # a known Latin unit is no junk


def test_the_reading_with_better_words_is_chosen_and_the_other_one_kept() -> None:
    vision = "по пекла контурной пейовой раковке или по 10 г, 20 1,23"
    tesseract = "в контурной ячейковой упаковке или по 10 г, 20 г, 25 г"
    info = choose_reading(vision, tesseract, LEXICON)
    assert info is not None
    assert info.chosen == "tesseract" and info.other_text == vision
    assert info.digits_differ  # «1,23» against «25»: a disagreement about numbers is reported


def test_a_reading_of_names_only_is_never_replaced() -> None:
    assert choose_reading("моджха Санкет Ананг", "; A бк Ананд", LEXICON) is None


def test_noise_does_not_win_by_having_fewer_long_words() -> None:
    vision = "Директор контурной упаковке амалеи"
    tesseract = "Директор Hg Fan и"
    assert choose_reading(vision, tesseract, LEXICON) is None


def test_equal_words_but_different_digits_keep_vision_and_flag_the_disagreement() -> None:
    info = choose_reading("в банке по 25 г", "в банке по 26 г", LEXICON)
    assert info is not None
    assert info.chosen == "vision" and info.digits_differ and info.other_text == "в банке по 26 г"
    assert choose_reading("в банке по 25 г", "в банке по 25 г.", LEXICON) is None


def test_a_line_of_another_length_is_not_the_same_line() -> None:
    assert (
        choose_reading(
            "в банке", "в банке полимерной с крышкой с контролем первого вскрытия", LEXICON
        )
        is None
    )


def test_matching_alternative_needs_the_same_baseline_and_width() -> None:
    row = AltLine("a", 80, 100, 300, 112, None)
    far = AltLine("b", 80, 140, 300, 152, None)
    narrow = AltLine("c", 80, 100, 120, 112, None)
    wide = AltLine("d", 10, 100, 590, 112, None)
    match = matching_alternative((82, 101, 298, 111), [far, wide, row])
    assert match is not None and match.text == "a"
    assert matching_alternative((82, 101, 298, 111), [far, narrow, wide]) is None


def test_the_lines_inside_a_tall_box_are_joined_top_to_bottom() -> None:
    # one Vision observation that spans two text lines of the page
    first = AltLine("По 5 г в пенале или по 2 пенала в упаковке", 80, 100, 400, 112, 0.9)
    second = AltLine("или по 10 г, 20 г, 25 г в банке полимерной", 80, 114, 330, 126, 0.8)
    other = AltLine("Условия хранения", 80, 160, 200, 172, 0.9)
    match = matching_alternative((80, 100, 400, 126), [other, second, first])
    assert match is not None
    assert (
        match.text
        == "По 5 г в пенале или по 2 пенала в упаковке или по 10 г, 20 г, 25 г в банке полимерной"
    )
    assert (match.x0, match.y0, match.x1, match.y1) == (80, 100, 400, 126)
    assert abs((match.confidence or 0) - 0.85) < 1e-9


def test_fragments_of_one_baseline_are_joined_left_to_right() -> None:
    left = AltLine("Старая", 80, 100, 150, 112, None)
    right = AltLine("редакция", 160, 100, 240, 112, None)
    match = matching_alternative((80, 100, 240, 112), [right, left])
    assert match is not None and match.text == "Старая редакция"


def test_digit_tokens_ignore_the_decimal_separator() -> None:
    assert digit_tokens("0,5 мг и 2.5 ч") == ["0.5", "2.5"]


def test_load_alt_lines_converts_pixels_at_300_dpi_to_points(tmp_path: Path) -> None:
    path = tmp_path / "1.json"
    path.write_text(
        json.dumps(
            {
                "lines": [
                    {
                        "text": " по 5 г в пенале ",
                        "confidence": 91.5,
                        "bbox": {"x0": 300, "y0": 600, "x1": 1500, "y1": 660},
                    },
                    {"text": "  ", "confidence": 10, "bbox": {"x0": 0, "y0": 0, "x1": 1, "y1": 1}},
                ]
            }
        ),
        encoding="utf-8",
    )
    (line,) = load_alt_lines(path)
    assert line.text == "по 5 г в пенале"
    assert (line.x0, line.y0, line.x1, line.y1) == (72.0, 144.0, 360.0, 158.4)
    assert line.confidence == 0.915


def observation(
    text: str, x: float, y_top: float, width: float, confidence: float
) -> dict[str, Any]:
    height = 12.0
    return {
        "text": text,
        "confidence": confidence,
        "bbox": [x / WIDTH, 1 - (y_top + height) / HEIGHT, width / WIDTH, height / HEIGHT],
    }


def test_the_pipeline_takes_the_better_line_and_marks_the_numbers_in_doubt(tmp_path: Path) -> None:
    pdf = tmp_path / "scan.pdf"
    document: Any = pymupdf.open()
    document.new_page(width=WIDTH, height=HEIGHT)
    document.save(pdf)
    document.close()
    payload = {
        "pages": [
            {
                "page": 1,
                "width": WIDTH,
                "height": HEIGHT,
                "lines": [
                    observation("Форма выпуска", 80, 100, 100, 1.0),
                    observation("по пекла контурной пейовой раковке 20 1,23", 80, 130, 300, 0.3),
                ],
            }
        ]
    }
    alternatives = {
        1: [
            AltLine("Форма выпуска", 80, 100, 180, 112, 0.9),
            AltLine("в контурной ячейковой упаковке 20 г, 25 г", 80, 130, 380, 142, 0.9),
        ]
    }
    extracted = extract_with_vision(pdf, payload, LEXICON, alternatives=alternatives)
    cleanup = extracted.diagnostics.ocr_cleanup
    assert cleanup["secondOpinion"] == {
        "tool": "tesseract.js",
        "pages": [1],
        "linesCompared": 1,
        "linesReplaced": 1,
        "digitDisagreements": 1,
    }
    body = render_body(extracted)
    assert "в контурной ячейковой упаковке 20 г, 25 г" in body
    assert "раковке" not in body  # the raw reading lives in the extraction JSON, not in the text
    assert "<!-- localmed:review ocr-uncertain-number -->" in body
    paragraph = next(
        block for page in extracted.pages for block in page.blocks if "контурной" in block.text
    )
    (alternative,) = cast(list[dict[str, Any]], paragraph.metadata["ocrAlternatives"])
    assert alternative["chosen"] == "tesseract"
    assert alternative["other"] == "по пекла контурной пейовой раковке 20 1,23"
    assert paragraph.metadata["enginesDisagreeOnNumbers"] is True


def test_only_a_number_each_reading_lacks_is_a_conflict() -> None:
    # a digit lost in a unit or a code read with look-alike letters is not a disagreement
    assert not numbers_conflict("доз 260 и 340 мг/м2", "доз 260 и 340 мг/м?")
    assert not numbers_conflict("Код ATX: L01EA01", "Код ATX: LO1EAO1")
    assert not numbers_conflict("DDR1 и DDR2", "DDR; и ЭПК»")
    assert not numbers_conflict("витамин B12", "витамин В,э")
    assert numbers_conflict("по 25 г", "по 26 г")
    assert numbers_conflict("20 1,23", "20 г, 25 г")
    assert digit_tokens("мг/м2 и B12 и 7,4 %") == ["7.4"]


def test_a_line_that_spans_two_text_lines_may_be_read_as_two() -> None:
    vision = "мли по 10 г, 20 1,23 банковало ной по пекла контурной пейовой раковке"
    tesseract = (
        "По 5 г в пенале с крышкой-дозатором или по 2 пенала в контурной ячейковой упаковке "
        "или по 10 г, 20 г, 25 г в банке полимерной с крышкой"
    )
    assert choose_reading(vision, tesseract, LEXICON) is None  # twice as long: not one line
    info = choose_reading(vision, tesseract, LEXICON, parts=2)
    assert info is not None and info.chosen == "tesseract"
