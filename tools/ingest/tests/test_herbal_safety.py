from __future__ import annotations

from pathlib import Path
from typing import Any

import pymupdf
import pytest

from localmed_ingest.herbal_safety import (
    TRTS_PDF,
    PlantSafety,
    lactmed_path,
    livertox_path,
    livertox_score,
    markup_text,
    nccih_path,
    validate_safety,
)


def _write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _trts_pdf(root: Path, pages: list[str]) -> None:
    path = root / TRTS_PDF
    path.parent.mkdir(parents=True, exist_ok=True)
    document: Any = pymupdf.open()
    for text in pages:
        document.new_page().insert_text((72, 72), text, fontsize=10)
    document.save(path)
    document.close()


def test_livertox_score_is_named_from_the_chapter_sentence() -> None:
    text = markup_text(
        "<p>Likelihood score: <bold>E</bold> (unlikely cause of clinically apparent liver "
        "injury).</p>"
    )
    letter, russian, sentence = livertox_score(text)
    assert (letter, russian) == ("E", "маловероятная причина поражения печени")
    assert sentence.startswith("Likelihood score: E")
    # An unknown wording is an error, never a guess.
    with pytest.raises(ValueError, match="unknown LiverTox likelihood wording"):
        livertox_score("Likelihood score: C (somewhat suspicious).")
    with pytest.raises(ValueError, match="no «Likelihood score»"):
        livertox_score("No score here.")


def test_safety_lines_must_quote_their_source(tmp_path: Path) -> None:
    _write(
        tmp_path,
        nccih_path("sage"),
        "<html><body><p>Sage is possibly safe in amounts up to 6 grams a day.</p></body></html>",
    )
    _write(
        tmp_path,
        lactmed_path("LM903"),
        "<sec><p>No data exist on the safety of sage during breastfeeding.</p></sec>",
    )
    _write(
        tmp_path,
        livertox_path("Senna"),
        "<p>Likelihood score: D (possible rare cause of clinically apparent liver injury).</p>",
    )
    _trts_pdf(
        tmp_path,
        ["cover", "contents", "157 Krushina Frangula alnus Mill unripe fruits, fresh bark"],
    )
    good = PlantSafety.model_validate(
        {
            "plant": "salvia-officinalis",
            "nccih": "sage",
            "lactmed": "LM903",
            "livertox": "Senna",
            "lines": [
                {
                    "source": "nccih",
                    "kind": "use",
                    "ru": "Вероятно безопасен до 6 г в день",
                    "quote": "Sage is possibly safe in amounts up to 6 grams a day.",
                },
                {
                    "source": "lactmed",
                    "kind": "lactation",
                    "ru": "Данных о безопасности при грудном вскармливании нет",
                    "quote": "No data exist on the safety of sage during breastfeeding.",
                },
            ],
            "trts": {
                "section": "1.1",
                "number": 157,
                "page": 3,
                "name": "Krushina",
                "latin": "Frangula alnus Mill",
                "parts": "unripe fruits, fresh bark",
            },
        }
    )
    assert validate_safety(good, tmp_path) == []
    bad = good.model_copy(
        update={
            "lines": (
                good.lines[0].model_copy(update={"ru": "Вероятно безопасен до 8 г в день"}),
                good.lines[1].model_copy(update={"quote": "Sage is safe during breastfeeding."}),
            ),
            "trts": good.trts.model_copy(update={"page": 1}) if good.trts else None,
        }
    )
    problems = validate_safety(bad, tmp_path)
    assert any("numbers ['8']" in problem for problem in problems)
    assert any("quote not in the source" in problem for problem in problems)
    assert any("is not on page 1" in problem for problem in problems)
