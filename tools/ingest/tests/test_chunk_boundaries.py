"""A paragraph over the chunk limit is cut at a line, sentence or word boundary, never mid-word.

The ESKLP card of an INN is one long list of position lines and therefore one paragraph; it used
to be cut every 3 200 characters wherever that fell, so a chunk ended in the first letters of a
label and the next one began with the rest of the word.
"""

from __future__ import annotations

from localmed_ingest.markdown_parser import (
    DraftParagraph,
    chunk_paragraphs,
    split_long_text,
)

KLP_LINE = (
    "- КЛП: {n}. ТН: Тест. Регистрация: ЛП-{n}. Лекарственная форма: раствор. "
    "Количество единиц: 120. Первичная упаковка: ФЛАКОН. Вторичная упаковка: ПАЧКА. "
    "Период действия: 16.02.2026. Цена: не указано в каталоге."
)


def _paragraph(lines: int) -> str:
    return "\n".join(KLP_LINE.format(n=100000 + index) for index in range(lines))


def test_a_long_list_paragraph_is_cut_between_lines() -> None:
    text = _paragraph(60)
    assert len(text) > 3200 * 2

    chunks = chunk_paragraphs([DraftParagraph(text=text)])

    assert len(chunks) >= 3
    assert all(len(chunk.text) <= 3200 for chunk in chunks)
    assert all(chunk.text.startswith("- КЛП: ") for chunk in chunks)
    assert all(chunk.text.endswith("Цена: не указано в каталоге.") for chunk in chunks)
    assert "\n".join(chunk.text for chunk in chunks) == text
    offsets = [int(str(chunk.metadata["sourcePartOffset"])) for chunk in chunks]
    assert offsets == sorted(offsets)


def test_offsets_point_at_the_start_of_each_part() -> None:
    text = _paragraph(60)
    for offset, part in split_long_text(text, 3200):
        assert text[offset : offset + len(part)] == part


def test_prose_without_line_breaks_is_cut_at_a_sentence_end_or_a_space() -> None:
    sentence = "Препарат применяют по назначению врача в течение курса лечения. "
    text = (sentence * 120).strip()

    parts = [part for _offset, part in split_long_text(text, 3200)]

    assert len(parts) >= 3
    assert all(part.endswith("лечения.") and part.startswith("Препарат") for part in parts)
    assert " ".join(parts) == text


def test_a_run_without_any_space_is_still_cut_hard_and_loses_nothing() -> None:
    text = "а" * 7000

    parts = [part for _offset, part in split_long_text(text, 3200)]

    assert [len(part) for part in parts] == [3200, 3200, 600]
    assert "".join(parts) == text
