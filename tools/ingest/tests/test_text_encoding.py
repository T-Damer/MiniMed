from __future__ import annotations

from localmed_ingest.text_encoding import (
    cyrillic_letter_ratio,
    expects_russian_clinical_text,
    is_likely_english_dominant_russian_source,
    is_likely_garbled_russian_pdf_text,
    latin_letter_ratio,
    lint_english_dominant_russian_text,
    lint_garbled_russian_text,
)

GARBLED_SAMPLE = (
    "8=D>@<0F8S ?> 701>;520=8N 8;8 A>AB>O=8N. "
    ":;8=8G5A:85 8AA;54>20=89, 2K?>;=5==KE 2 45AOB:0E ;01>@0B>@89 @07;8G=KE AB@0=."
) * 4
RUSSIAN_SAMPLE = (
    "Рекомендовано оценить жалобы, анамнез, объективные признаки и результаты обследований. "
    "Исходная формулировка сохраняется без пересказа и используется для локального поиска."
)
ENGLISH_TRANSLATION_SAMPLE = (
    "Clinical recommendations describe diagnosis, treatment, follow-up, prevention, and the "
    "organization of medical care. The extracted document must preserve the original wording, "
    "population constraints, contraindications, units, tables, and source page references. "
) * 8


def test_cyrillic_ratio_detects_russian_text() -> None:
    assert cyrillic_letter_ratio(RUSSIAN_SAMPLE) > 0.9
    assert cyrillic_letter_ratio(GARBLED_SAMPLE) < 0.05
    assert latin_letter_ratio(ENGLISH_TRANSLATION_SAMPLE) > 0.9


def test_garbled_pdf_text_signature() -> None:
    assert is_likely_garbled_russian_pdf_text(GARBLED_SAMPLE)
    assert not is_likely_garbled_russian_pdf_text(RUSSIAN_SAMPLE)


def test_lint_reports_broken_encoding() -> None:
    message = lint_garbled_russian_text(GARBLED_SAMPLE, context="kr.rf.898_1/chunk-1")
    assert message is not None
    assert "broken PDF font encoding" in message


def test_english_dominant_output_is_rejected_for_russian_source() -> None:
    assert is_likely_english_dominant_russian_source(ENGLISH_TRANSLATION_SAMPLE)
    assert not is_likely_english_dominant_russian_source(RUSSIAN_SAMPLE * 5)
    assert not is_likely_english_dominant_russian_source(GARBLED_SAMPLE * 5)

    message = lint_english_dominant_russian_text(
        ENGLISH_TRANSLATION_SAMPLE,
        context="kr.rf.714_2",
    )
    assert message is not None
    assert "must not translate" in message


def test_expects_russian_clinical_text_from_title_or_source_type() -> None:
    assert expects_russian_clinical_text("Сепсис (у взрослых)")
    assert expects_russian_clinical_text("Sepsis", source_type="clinical_recommendation")
    assert not expects_russian_clinical_text("Sepsis", source_type="guideline")
