from __future__ import annotations

from pathlib import Path

from localmed_ingest.grls_instruction_sections import (
    GRLS_READING_ORDER,
    GRLS_SECTION_TYPES,
    classify_grls_heading_title,
    find_grls_section_boundaries,
    instruction_quality_metrics,
    resegment_paragraph_text,
)
from localmed_ingest.markdown_parser import parse_markdown_document

# A short synthetic paragraph modeled on real GRLS instruction text (e.g.
# Регидрон/Тригидросоль-style official instructions), where the PDF's font
# does not visually distinguish subheadings from body text, so everything
# extracts as one flowing paragraph with the canonical section phrases
# embedded inline, immediately after a sentence-ending period.
_INLINE_PARAGRAPH = (
    "Препарат порошок для приема внутрь. Регистрационный номер: ЛП-№(000000)-(РГ-RU) "
    "Торговое наименование: Тестомед Международное непатентованное наименование: "
    "тестовое вещество Лекарственная форма: порошок. Состав 1 пакетик содержит: "
    "действующее вещество 5 г. Фармакотерапевтическая группа: тестовое средство. "
    "Показания к применению Профилактика тестового состояния. Противопоказания "
    "• Гиперчувствительность к компонентам. С осторожностью При тестовом состоянии. "
    "Применение при беременности и в период грудного вскармливания Разрешено в "
    "рекомендуемых дозах. Способ применения и дозы Внутрь по 1 пакетику в сутки. "
    "Побочное действие Частота неизвестна: тошнота. Передозировка Не описана. "
    "Взаимодействие с другими лекарственными средствами Не изучалось. Особые указания "
    "Хранить в недоступном для детей месте. Влияние на способность управлять "
    "транспортными средствами Не влияет. Форма выпуска По 5 г в пакетике. Условия "
    "хранения При температуре не выше 25 °C. Срок годности 2 года. Условия отпуска "
    "Без рецепта. Владелец регистрационного удостоверения ООО Тест."
)


def test_fixed_vocabulary_matches_coordinator_spec() -> None:
    assert set(GRLS_SECTION_TYPES) == {
        "composition",
        "indications",
        "contraindications",
        "caution",
        "pregnancy",
        "dosage",
        "adverse-effects",
        "overdose",
        "interactions",
        "special-instructions",
        "pharmacology",
        "release-form",
        "storage",
        "dispensing",
        "registration",
        "other",
    }
    # Reading order is clinician-facing data, not code: dosage/indications/
    # contraindications first, registration last, exactly as decided.
    assert GRLS_READING_ORDER[:3] == ("dosage", "indications", "contraindications")
    assert GRLS_READING_ORDER[-1] == "registration"
    assert set(GRLS_READING_ORDER) <= set(GRLS_SECTION_TYPES)


def test_find_grls_section_boundaries_recognizes_every_embedded_heading() -> None:
    boundaries = find_grls_section_boundaries(_INLINE_PARAGRAPH)
    types_in_order = [boundary.section_type for boundary in boundaries]
    # Every standard *clinical* heading in the synthetic instruction must be
    # found, in its original document order (source order is never
    # reshuffled here). Bare-space-separated administrative sub-fields in
    # the registration preamble ("Торговое наименование: Регидрон®
    # Международное непатентованное наименование: ...", with no delimiter
    # between one field's value and the next field's label) are not all
    # individually detected as separate boundaries — they don't need to be,
    # since the whole preamble already resolves to section_type
    # 'registration' through the leading-text default (see
    # markdown_parser.expand_grls_instruction_sections).
    assert types_in_order == [
        "registration",
        "composition",
        "pharmacology",
        "indications",
        "contraindications",
        "caution",
        "pregnancy",
        "dosage",
        "adverse-effects",
        "overdose",
        "interactions",
        "special-instructions",
        "special-instructions",
        "release-form",
        "storage",
        "storage",
        "dispensing",
        "registration",
    ]


def test_find_grls_section_boundaries_ignores_mid_sentence_mentions() -> None:
    # "показания" and "состав" used as ordinary words mid-sentence (no
    # preceding sentence boundary) must not be treated as headings.
    text = "Врач учёл клинические показания и состав крови пациента при выборе дозы."
    assert find_grls_section_boundaries(text) == []


def test_resegment_paragraph_text_preserves_every_character() -> None:
    pieces = resegment_paragraph_text(_INLINE_PARAGRAPH)
    assert "".join(piece.text for piece in pieces) == _INLINE_PARAGRAPH
    assert any(piece.heading_title == "Способ применения и дозы" for piece in pieces)


def test_resegment_paragraph_text_without_any_heading_is_one_other_piece() -> None:
    pieces = resegment_paragraph_text("Обычный текст без стандартных заголовков.")
    assert len(pieces) == 1
    assert pieces[0].section_type == "other"
    assert pieces[0].heading_title is None


def test_classify_grls_heading_title_covers_spc_and_leaflet_synonyms() -> None:
    cases = {
        "Показания к применению": "indications",
        "Противопоказания": "contraindications",
        "Способ применения и дозы": "dosage",
        "Побочное действие": "adverse-effects",
        "Форма выпуска": "release-form",
        "Условия хранения": "storage",
        "Условия отпуска": "dispensing",
        "Владелец регистрационного удостоверения/Организация, принимающая"
        " претензии потребителей": "registration",
        # Patient-leaflet ("листок-вкладыш") synonyms, a second standard
        # GRLS layout distinct from the professional SPC-style instruction.
        "Прием препарата Тестомед": "dosage",
        "Продолжительность терапии": "dosage",
        "Хранение препарата Тестомед": "storage",
        "Содержимое упаковки и прочие сведения": "release-form",
        "Держатель регистрационного удостоверения": "registration",
        # Numbering prefixes and trailing qualifiers must not block a match.
        "5.1 Способ применения, дозы": "dosage",
        "Особые указания и меры предосторожности": "special-instructions",
    }
    for title, expected in cases.items():
        assert classify_grls_heading_title(title) == expected, title
    assert classify_grls_heading_title("Совершенно неизвестный заголовок") is None


def test_instruction_quality_metrics() -> None:
    assert instruction_quality_metrics(["dosage", "indications", "contraindications"]) == {
        "hasDosage": True,
        "hasIndications": True,
        "hasContraindications": True,
    }
    assert instruction_quality_metrics(["other"]) == {
        "hasDosage": False,
        "hasIndications": False,
        "hasContraindications": False,
    }


_INSTRUCTION_DOCUMENT = f"""---
id: drug.rf.test.instruction
title: 'Тестомед: инструкция по медицинскому применению'
short_title: Тестомед
version_label: grls-current
source_type: official_drug_instruction
status: active
specialties: []
age_groups: []
source_file: test.pdf
source_checksum: sha256:{"0" * 64}
synthetic_fixture: true
metadata:
  registrationNumber: ЛП-№(000000)-(РГ-RU)
---

# ИНСТРУКЦИЯ ПО МЕДИЦИНСКОМУ ПРИМЕНЕНИЮ ЛЕКАРСТВЕННОГО ПРЕПАРАТА

<!-- localmed:source {{"bbox":[0,0,1,1],"block":"p1-b1","kind":"paragraph","page":1}} -->
{_INLINE_PARAGRAPH}
"""


def test_parse_markdown_document_resegments_a_real_style_instruction(tmp_path: Path) -> None:
    path = tmp_path / "drug.rf.test.instruction.md"
    path.write_text(_INSTRUCTION_DOCUMENT, encoding="utf-8")
    document = parse_markdown_document(path, "2026-09-27T00:00:00Z")
    types = [section.section_type for section in document.sections]
    metrics = instruction_quality_metrics(types)
    assert metrics == {"hasDosage": True, "hasIndications": True, "hasContraindications": True}
    # Source spans survive the split: every resulting section still points
    # at the one original PDF block, since finer-than-block bbox data was
    # never extracted in the first place.
    for section in document.sections:
        for chunk in section.chunks:
            spans = chunk.metadata.get("sourceSpans")
            assert isinstance(spans, list) and spans
            first_span = spans[0]
            assert isinstance(first_span, dict) and first_span.get("block") == "p1-b1"
    # The registration preamble (before the first canonical heading) is
    # tagged 'registration', not silently dropped or left generic.
    registration_sections = [s for s in document.sections if s.section_type == "registration"]
    assert registration_sections
    # No source text was lost: concatenating every chunk's original text
    # reconstructs the full paragraph (whitespace-insensitive: splitting
    # inserts section boundaries, never removes or rewrites characters).
    reconstructed = "".join(
        chunk.original_text for section in document.sections for chunk in section.chunks
    )
    assert reconstructed.replace(" ", "") == _INLINE_PARAGRAPH.replace(" ", "")


_REGISTRY_CARD_DOCUMENT = f"""---
id: drug.registry.ru.test
title: 'Тестомед: регистрационная карточка ГРЛС'
short_title: Тестомед
version_label: grls-24-07-2026
source_type: official_registry_summary
status: active
source_file: https://grls.rosminzdrav.ru/GRLS.aspx
source_checksum: sha256:{"1" * 64}
synthetic_fixture: true
metadata:
  registrationNumber: ЛП-№(000000)-(РГ-RU)
---

# Регистрационная запись

<!-- localmed:source {{"recordId":"ЛП-№(000000)-(РГ-RU)"}} -->
В Государственном реестре лекарственных средств зарегистрирован препарат «Тестомед».

# Формы и дозировки

## порошок — 5 г

<!-- localmed:source {{"recordId":"ЛП-№(000000)-(РГ-RU)"}} -->
Препарат «Тестомед», регистрационное удостоверение ЛП-№(000000)-(РГ-RU): форма — порошок.
"""


def test_registry_card_sections_are_all_registration_type(tmp_path: Path) -> None:
    path = tmp_path / "drug.registry.ru.test.md"
    path.write_text(_REGISTRY_CARD_DOCUMENT, encoding="utf-8")
    document = parse_markdown_document(path, "2026-09-27T00:00:00Z")
    assert document.sections
    assert all(section.section_type == "registration" for section in document.sections)
