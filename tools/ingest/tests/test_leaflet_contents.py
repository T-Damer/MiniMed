"""LEAF1: the table of contents of a patient leaflet stays one list (excerpts of real documents)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from localmed_ingest.grls_contents_lists import (
    BodyNotReproducedError,
    apply_overlay,
    overlay_row,
    rerender_contents,
    split_prepared,
)
from localmed_ingest.grls_instruction_sections import find_grls_section_boundaries
from localmed_ingest.leaflet_contents import find_contents_runs, is_contents_header
from localmed_ingest.markdown_parser import (
    CONTENTS_FLAG,
    expand_grls_instruction_sections,
    parse_markdown_document,
    parse_sections,
)
from localmed_ingest.models import (
    ExtractedBlock,
    ExtractedPage,
    ExtractedSource,
    ExtractionDiagnostics,
)
from localmed_ingest.source_registry import render_body

CHECKSUM = "sha256:" + "0" * 64


def blocks_of(*specs: tuple[str, str] | tuple[str, str, bool]) -> list[ExtractedBlock]:
    """Blocks of one page in reading order: (kind, text) or (kind, text, bold)."""
    result: list[ExtractedBlock] = []
    for index, spec in enumerate(specs):
        kind, text = spec[0], spec[1]
        bold = spec[2] if len(spec) > 2 else False  # type: ignore[misc]
        top = 40.0 + 20.0 * index
        result.append(
            ExtractedBlock(
                id=f"p1-b{index + 1}",
                page=1,
                order_index=index,
                kind=kind,  # type: ignore[arg-type]
                text=text,
                bbox=[56.7, top, 440.0, top + 16.0],
                bold=bold,
                heading_level=(1 if bold and text[:1].isdigit() else 2)
                if kind == "heading"
                else None,
            )
        )
    return result


def source_of(blocks: list[ExtractedBlock]) -> ExtractedSource:
    return ExtractedSource(
        source_file="leaflet.pdf",
        source_checksum=CHECKSUM,
        source_format="pdf",
        pages=[ExtractedPage(page=1, width=595.0, height=842.0, blocks=blocks, character_count=1)],
        diagnostics=ExtractionDiagnostics(
            source_checksum=CHECKSUM,
            source_format="pdf",
            page_count=1,
            block_count=len(blocks),
            included_block_count=len(blocks),
            character_count=1,
            removed_repeated_blocks=0,
            heading_candidates=0,
            table_candidates=0,
            quality_score=1.0,
            requires_review=False,
        ),
    )


# Вермокс (drug.rf.7687a385d1076d10a7d7.instruction, ЛП-№(002347)-(РГ-RU), page 1): the list stands
# after «Содержание листка-вкладыша»; "4. Возможные нежелательные реакции." ends in a common
# heading phrase, so the generic rule made it a heading.
VERMOX = (
    ("paragraph", "Действующее вещество: мебендазол"),
    ("paragraph", "Содержание листка-вкладыша", True),
    ("list", "1. Что из себя представляет препарат Вермокс, и для чего его применяют."),
    ("list", "2. О чем следует знать перед приемом препарата Вермокс."),
    ("list", "3. Прием препарата Вермокс."),
    ("heading", "4. Возможные нежелательные реакции."),
    ("list", "5. Хранение препарата Вермокс."),
    ("list", "6. Содержимое упаковки и дополнительные сведения."),
    ("heading", "1. Что из себя представляет препарат Вермокс и для чего его применяют", True),
    ("paragraph", "Препарат Вермокс содержит действующее вещество мебендазол."),
    ("heading", "Показания к применению", True),
    ("paragraph", "Препарат Вермокс применяется у взрослых и детей старше 3 лет."),
    ("heading", "2. О чем следует знать перед приемом препарата Вермокс", True),
    ("heading", "3. Прием препарата Вермокс", True),
    ("heading", "4. Возможные нежелательные реакции", True),
    ("heading", "5. Хранение препарата Вермокс", True),
    ("heading", "6. Содержимое упаковки и дополнительные сведения", True),
)


def run_of(*specs: tuple[str, str] | tuple[str, str, bool]):
    runs = find_contents_runs(blocks_of(*specs))
    assert len(runs) == 1
    return runs[0]


def test_contents_header_variants() -> None:
    for text in (
        "Содержание листка-вкладыша",
        "Содержание листка-вкладыша:",
        "СОДЕРЖАНИЕ",
        "Оглавление",
        "Содержание листка вкладыша",
    ):
        assert is_contents_header(text), text
    for text in ("Содержание действующего вещества в таблетке", "Состав", "Содержимое упаковки"):
        assert not is_contents_header(text), text


def test_vermox_list_is_one_run_and_the_real_heading_is_not_taken() -> None:
    run = run_of(*VERMOX)
    assert [entry.number for entry in run.entries] == [1, 2, 3, 4, 5, 6]
    assert run.block_ids == ("p1-b3", "p1-b4", "p1-b5", "p1-b6", "p1-b7", "p1-b8")
    assert run.header_id == "p1-b2"
    assert run.repeated == 6
    assert run.split is None
    # the "4." heading is an entry like the others: its text is the source text, number included
    assert run.entries[3].text == "4. Возможные нежелательные реакции."


def test_one_block_with_all_entries_one_per_line() -> None:
    run = run_of(
        ("paragraph", "Содержание листка-вкладыша", True),
        (
            "list",
            "1. Что из себя представляет препарат Терифлуномид, и для чего его применяют.\n"
            "2. О чем следует знать перед приемом препарата Терифлуномид.\n"
            "3. Прием препарата Терифлуномид.\n"
            "4. Возможные нежелательные реакции.\n"
            "5. Хранение препарата Терифлуномид.\n"
            "6. Содержимое упаковки и прочие сведения.",
        ),
        (
            "heading",
            "1. Что из себя представляет препарат Терифлуномид, и для чего его применяют",
            True,
        ),
        ("heading", "2. О чем следует знать перед приемом препарата Терифлуномид", True),
        ("heading", "3. Прием препарата Терифлуномид", True),
    )
    assert len(run.entries) == 6
    assert run.block_ids == ("p1-b2",)


def test_entries_joined_on_one_line_are_split() -> None:
    run = run_of(
        ("paragraph", "Содержание листка-вкладыша", True),
        (
            "list",
            "1. Что из себя представляет препарат Нейромидин, и для чего его применяют "
            "2. О чем следует знать перед приемом препарата Нейромидин "
            "3. Прием препарата Нейромидин 4. Возможные нежелательные реакции "
            "5. Хранение препарата Нейромидин 6. Содержимое упаковки и прочие сведения",
        ),
        (
            "heading",
            "1. Что из себя представляет препарат Нейромидин, и для чего его применяют",
            True,
        ),
        ("heading", "2. О чем следует знать перед приемом препарата Нейромидин", True),
        ("heading", "4. Возможные нежелательные реакции", True),
    )
    assert [entry.number for entry in run.entries] == [1, 2, 3, 4, 5, 6]


def test_a_title_wrapped_into_the_next_block_is_one_entry() -> None:
    # Ленватиниб-Фарм-Синтез: the first title wraps into a block of its own.
    run = run_of(
        ("paragraph", "Содержание листка-вкладыша", True),
        ("list", "1. Что из себя представляет препарат Ленватиниб, и для чего его"),
        ("paragraph", "применяют."),
        ("list", "2. О чем следует знать перед приемом препарата Ленватиниб."),
        ("list", "3. Прием препарата Ленватиниб."),
        ("heading", "4. Возможные нежелательные реакции."),
        ("list", "5. Хранение препарата Ленватиниб."),
        ("heading", "6. Содержимое упаковки и прочие сведения."),
        (
            "heading",
            "1. Что из себя представляет препарат Ленватиниб, и для чего его применяют",
            True,
        ),
        ("heading", "2. О чем следует знать перед приемом препарата Ленватиниб", True),
        ("heading", "3. Прием препарата Ленватиниб", True),
        ("heading", "4. Возможные нежелательные реакции", True),
    )
    assert len(run.entries) == 6
    assert run.entries[0].text.endswith("для чего его применяют.")
    assert len(run.block_ids) == 7


def test_a_number_alone_in_its_block_is_joined_with_the_title_after_it() -> None:
    run = run_of(
        ("paragraph", "Содержание листка-вкладыша", True),
        ("list", "1. Что из себя представляет препарат Вермокс."),
        ("list", "2. О чем следует знать перед приемом препарата Вермокс."),
        ("paragraph", "3."),
        ("paragraph", "Прием препарата Вермокс."),
        ("heading", "4. Возможные нежелательные реакции."),
        ("list", "5. Хранение препарата Вермокс."),
        ("heading", "1. Что из себя представляет препарат Вермокс", True),
        ("heading", "2. О чем следует знать перед приемом препарата Вермокс", True),
        ("heading", "3. Прием препарата Вермокс", True),
    )
    assert run.entries[2].text == "3. Прием препарата Вермокс."
    assert len(run.entries) == 5


def test_scan_entries_with_a_lost_or_misread_number_keep_their_source_text() -> None:
    # Арлеверт / Гемцитабин-Промомед scans: "1." lost, "4." read as "А."
    run = run_of(
        ("paragraph", "Содержание листка-вкладыша"),
        ("heading", "Что из себя представляет препарат Арлеверт, и для чего его применяют."),
        ("list", "2. О чем следует знать перед приемом препарата Арлеверт."),
        ("list", "3. Прием препарата Арлеверт"),
        ("heading", "А. Возможные нежелательные реакции."),
        ("list", "5. Хранение препарата Арлеверт"),
        ("heading", "6. Содержимое упаковки и прочие сведения."),
        ("list", "1. Что из себя представляет препарат Арлеверт, и для чего его применяют"),
        ("paragraph", "Препарат Арлеверт относится к группе. Возможные нежелательные реакции."),
        ("list", "2. О чем следует знать перед приемом препарата Арлеверт"),
    )
    assert [entry.number for entry in run.entries] == [1, 2, 3, 4, 5, 6]
    assert run.entries[3].text == "А. Возможные нежелательные реакции."
    assert run.entries[0].text.startswith("Что из себя представляет")


def test_the_list_and_the_first_section_in_one_block_are_cut_where_the_list_stops() -> None:
    # Диовенгес: the extraction joined the list with the heading line of section 1.
    list_text = (
        "1. Что из себя представляет препарат Диовенгес и для чего его применяют\n"
        "2. О чем следует знать перед приемом препарата Диовенгес\n"
        "3. Прием препарата Диовенгес\n"
        "4. Возможные нежелательные реакции\n"
        "5. Хранение препарата Диовенгес\n"
        "6. Содержимое упаковки и прочие сведения\n"
    )
    rest = "1. Что из себя представляет препарат Диовенгес и для чего его применяют"
    run = run_of(
        ("paragraph", "Содержание листка-вкладыша", True),
        ("list", list_text + rest),
        ("paragraph", "Действующими веществами препарата Диовенгес являются гесперидин и диосмин."),
        ("heading", "2. О чем следует знать перед приемом препарата Диовенгес", True),
        ("heading", "3. Прием препарата Диовенгес", True),
        ("heading", "4. Возможные нежелательные реакции", True),
    )
    assert len(run.entries) == 6
    assert run.split == ("p1-b2", len(list_text))


RUMIKOZ_BLOCK = (
    "Румикоз®, 100 мг, капсулы Действующее вещество: итраконазол Перед приемом препарата "
    "полностью прочитайте листок-вкладыш. Если у Вас возникли какие-либо нежелательные реакции, "
    "обратитесь к лечащему врачу. Содержание листка-вкладыша "
    "1. Что из себя представляет препарат Румикоз®, и для чего его применяют. "
    "2. О чем следует знать перед приемом препарата Румикоз®. "
    "3. Прием препарата Румикоз®. 4. Возможные нежелательные реакции. "
    "5. Хранение препарата Румикоз®. 6. Содержимое упаковки и прочие сведения. "
    "1. Что из себя представляет препарат Румикоз®, и для чего его применяют "
    "Препарат Румикоз® содержит действующее вещество итраконазол."
)


def test_header_and_list_inside_one_long_block_are_cut_out_of_it() -> None:
    # Румикоз: the whole first page is one paragraph block.
    specs = (
        ("paragraph", RUMIKOZ_BLOCK),
        ("paragraph", "Сообщите врачу. 2. О чем следует знать перед приемом препарата Румикоз®"),
        ("heading", "3. Прием препарата Румикоз®", True),
        ("heading", "4. Возможные нежелательные реакции", True),
        ("heading", "5. Хранение препарата Румикоз®", True),
    )
    run = run_of(*specs)
    start = RUMIKOZ_BLOCK.index("Содержание")
    end = RUMIKOZ_BLOCK.index(
        "1. Что из себя представляет препарат Румикоз®, и для чего его применяют Препарат"
    )
    assert run.head == ("p1-b1", start)
    assert run.lead == "Содержание листка-вкладыша"
    assert run.split == ("p1-b1", end)
    assert len(run.entries) == 6
    source = source_of(blocks_of(*specs))
    plain = render_body(source, source_id="r")
    body = render_body(source, source_id="r", contents_lists=True)
    assert characters(body) == characters(plain)
    lines = body.splitlines()
    marker = next(i for i, line in enumerate(lines) if '"role":"contents"' in line)
    assert lines[marker + 1] == "Содержание листка-вкладыша"
    assert lines[marker + 2].startswith("1. Что из себя представляет препарат Румикоз®")
    assert lines[marker + 7].startswith("6. Содержимое упаковки")
    # the text before the header and the text after the list are ordinary blocks of the same block
    assert RUMIKOZ_BLOCK[:start].strip() in body
    assert f'"offset":{end}' in body
    assert RUMIKOZ_BLOCK[end:].strip() in body


def test_inline_header_in_the_middle_of_a_sentence_is_not_a_header() -> None:
    specs = (
        (
            "paragraph",
            "Информация о составе: содержание листка-вкладыша 1. Первая тема. 2. Вторая тема. "
            "3. Третья тема.",
        ),
        ("paragraph", "Первая тема. Вторая тема. Третья тема."),
    )
    assert find_contents_runs(blocks_of(*specs)) == []


def test_a_list_without_its_header_is_found_by_the_leaflet_section_titles() -> None:
    # Мисуфер: the scan misread the header, the list is still the leaflet's own sections.
    run = run_of(
        ("paragraph", "Содержание листка-вкладьна"),
        ("list", "1. Что из себя представляет препарат Мисуфер, и для чего его применяют."),
        ("list", "2. О чем следует знать перед приемом препарата Мисуфер."),
        ("list", "3. Прием препарата Мисуфер."),
        ("heading", "4. Возможные нежелательные реакции."),
        ("list", "5. Хранение препарата Мисуфер."),
        ("heading", "6. Содержимое упаковки и прочие сведения."),
        ("list", "1. Что из себя представляет препарат Мисуфер, и для чего его применяют"),
        ("paragraph", "Действующим веществом препарата Мисуфер является умифеновир."),
        ("list", "2. О чем следует знать перед приемом препарата Мисуфер"),
        ("list", "3. Прием препарата Мисуфер"),
        ("heading", "4. Возможные нежелательные реакции"),
        ("list", "5. Хранение препарата Мисуфер"),
        ("heading", "6. Содержимое упаковки и прочие сведения"),
    )
    assert run.header_id is None
    assert len(run.entries) == 6


def test_a_leaflet_printed_several_times_has_a_list_per_copy() -> None:
    copy = list(VERMOX[1:])
    runs = find_contents_runs(blocks_of(*copy, *copy))
    assert len(runs) == 2


# --- negatives -------------------------------------------------------------------------------


def test_numbered_steps_that_the_text_repeats_are_not_a_contents_list() -> None:
    # Instruction for use of a syringe pen: numbered steps, summarised again further on.
    steps = (
        "Вымойте руки.",
        "Подготовьте кожу в месте инъекции.",
        "Снимите колпачок с иглы.",
        "Введите иглу под кожу.",
    )
    specs: list[tuple[str, str]] = [
        ("list", f"{number}. {text}") for number, text in enumerate(steps, 1)
    ]
    specs.append(("paragraph", " ".join(steps)))
    assert find_contents_runs(blocks_of(*specs)) == []


def test_short_numbered_headings_of_a_real_text_are_not_swallowed() -> None:
    specs = (
        ("paragraph", "Содержание листка-вкладыша", True),
        ("heading", "1. Введение", True),
        ("paragraph", "Текст введения."),
        ("heading", "2. Методы", True),
        ("paragraph", "Текст методов."),
    )
    # a header followed by one numbered heading and a paragraph is not a list of entries
    assert find_contents_runs(blocks_of(*specs)) == []


def test_entries_must_follow_each_other_without_a_gap() -> None:
    specs = (
        ("paragraph", "Содержание листка-вкладыша", True),
        ("list", "1. Что из себя представляет препарат Тест."),
        ("list", "2. О чем следует знать перед приемом препарата Тест."),
        ("list", "4. Возможные нежелательные реакции."),
        ("heading", "1. Что из себя представляет препарат Тест", True),
    )
    assert find_contents_runs(blocks_of(*specs)) == []


def test_a_numbered_list_without_header_and_leaflet_titles_is_left_alone() -> None:
    specs = (
        ("list", "1. Введение в тему."),
        ("list", "2. Обзор литературы."),
        ("list", "3. Материалы и методы."),
        ("list", "4. Результаты исследования."),
        ("heading", "1. Введение в тему", True),
        ("heading", "2. Обзор литературы", True),
        ("heading", "3. Материалы и методы", True),
        ("heading", "4. Результаты исследования", True),
    )
    assert find_contents_runs(blocks_of(*specs)) == []


def test_a_list_whose_titles_do_not_come_back_is_not_contents() -> None:
    specs = (
        ("paragraph", "Содержание листка-вкладыша", True),
        ("list", "1. Первая совершенно отдельная тема."),
        ("list", "2. Вторая совершенно отдельная тема."),
        ("list", "3. Третья совершенно отдельная тема."),
        ("paragraph", "Здесь совсем другой текст про другое."),
    )
    assert find_contents_runs(blocks_of(*specs)) == []


# --- rendering and parsing -------------------------------------------------------------------

CHARS = re.compile(r"<!--.*?-->|^#+ ", re.DOTALL | re.MULTILINE)


def characters(body: str) -> str:
    return re.sub(r"\s+", "", CHARS.sub("", body))


def test_vermox_renders_the_contents_as_one_list_block_and_loses_nothing() -> None:
    source = source_of(blocks_of(*VERMOX))
    plain = render_body(source, source_id="vermox")
    body = render_body(source, source_id="vermox", contents_lists=True)
    assert "## 4. Возможные нежелательные реакции." in plain
    assert "## 4. Возможные нежелательные реакции." not in body
    marker = re.search(r"<!-- localmed:source (\{[^\n]*\"role\":\"contents\"[^\n]*\}) -->", body)
    assert marker is not None
    assert body.count('"role":"contents"') == 1
    assert '"blocks":["p1-b3","p1-b4","p1-b5","p1-b6","p1-b7","p1-b8"]' in marker.group(1)
    assert (
        "\n1. Что из себя представляет препарат Вермокс, и для чего его применяют.\n"
        "2. О чем следует знать перед приемом препарата Вермокс.\n"
        "3. Прием препарата Вермокс.\n"
        "4. Возможные нежелательные реакции.\n"
        "5. Хранение препарата Вермокс.\n"
        "6. Содержимое упаковки и дополнительные сведения.\n"
    ) in body
    # the real headings stay headings
    assert "# 1. Что из себя представляет препарат Вермокс и для чего его применяют" in body
    assert "## Показания к применению" in body
    assert characters(body) == characters(plain)


def test_render_body_without_the_option_is_unchanged() -> None:
    source = source_of(blocks_of(*VERMOX))
    assert "contents" not in render_body(source, source_id="vermox")


def test_a_cut_block_keeps_the_text_after_the_list_as_its_own_block() -> None:
    list_text = (
        "1. Что из себя представляет препарат Диовенгес и для чего его применяют\n"
        "2. О чем следует знать перед приемом препарата Диовенгес\n"
        "3. Прием препарата Диовенгес\n"
        "4. Возможные нежелательные реакции\n"
        "5. Хранение препарата Диовенгес\n"
        "6. Содержимое упаковки и прочие сведения\n"
    )
    rest = (
        "1. Что из себя представляет препарат Диовенгес и для чего его применяют "
        "Действующее вещество."
    )
    source = source_of(
        blocks_of(
            ("paragraph", "Содержание листка-вкладыша", True),
            ("list", list_text + rest),
            ("heading", "2. О чем следует знать перед приемом препарата Диовенгес", True),
            ("heading", "3. Прием препарата Диовенгес", True),
            ("heading", "4. Возможные нежелательные реакции", True),
        )
    )
    plain = render_body(source, source_id="x")
    body = render_body(source, source_id="x", contents_lists=True)
    assert f'"offset":{len(list_text)}' in body
    assert f"\n{rest}\n" in body
    assert characters(body) == characters(plain)


def front_matter() -> str:
    return (
        "---\nid: drug.rf.test.instruction\ntitle: 'Вермокс: листок-вкладыш'\n"
        "short_title: Вермокс\nversion_label: grls-test\nsource_type: official_drug_instruction\n"
        f"status: active\nspecialties: []\nage_groups: []\nsource_file: leaflet.pdf\n"
        f"source_checksum: {CHECKSUM}\nsynthetic_fixture: true\nmetadata:\n"
        "  registrationNumber: ЛП-№(002347)-(РГ-RU)\n---\n\n"
    )


def write_document(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "drug.rf.test.instruction.md"
    path.write_text(front_matter() + body, encoding="utf-8")
    return path


def test_shipped_structure_of_vermox_before_and_after(tmp_path: Path) -> None:
    source = source_of(blocks_of(*VERMOX))
    before = parse_markdown_document(
        write_document(tmp_path, render_body(source, source_id="v")), "2026-10-15T00:00:00Z"
    )
    titles_before = [section.title for section in before.sections]
    # the defect: sections made from the contents list, lone list numbers as chunks
    assert titles_before[1:5] == [
        "Прием препарата",
        "4. Возможные нежелательные реакции.",
        "Хранение препарата",
        "Содержимое упаковки",
    ]
    lone = [
        chunk.original_text
        for section in before.sections
        for chunk in section.chunks
        if re.fullmatch(r"\d{1,2}\.\s*", chunk.original_text)
    ]
    assert lone == []  # the numbering prefix now stays with its text, even in the old render

    after = parse_markdown_document(
        write_document(tmp_path, render_body(source, source_id="v", contents_lists=True)),
        "2026-10-15T00:00:00Z",
    )
    titles = [section.title for section in after.sections]
    assert titles[0] == "Общая информация"
    assert titles[1].startswith("1. Что из себя представляет препарат Вермокс")
    first = after.sections[0]
    list_chunks = [chunk for chunk in first.chunks if chunk.metadata.get(CONTENTS_FLAG)]
    assert len(list_chunks) == 1
    assert list_chunks[0].original_text.endswith(
        "5. Хранение препарата Вермокс.\n6. Содержимое упаковки и дополнительные сведения."
    )
    spans = list_chunks[0].metadata["sourceSpans"]
    assert isinstance(spans, list)
    assert any(
        isinstance(span, dict) and span.get("role") == "contents" and len(span["blocks"]) == 6
        for span in spans
    )


def test_the_text_after_a_cut_contents_list_is_its_own_chunk(tmp_path: Path) -> None:
    # Декарис: the list is cut out of a block that goes on with «1. Что из себя …»; the reader
    # numbers consecutive «N. …» lines of one chunk as one list, so the text must not share it.
    source = source_of(
        blocks_of(
            ("paragraph", RUMIKOZ_BLOCK),
            (
                "paragraph",
                "Сообщите врачу. 2. О чем следует знать перед приемом препарата Румикоз®",
            ),
            ("heading", "3. Прием препарата Румикоз®", True),
            ("heading", "4. Возможные нежелательные реакции", True),
            ("heading", "5. Хранение препарата Румикоз®", True),
        )
    )
    document = parse_markdown_document(
        write_document(tmp_path, render_body(source, source_id="r", contents_lists=True)),
        "2026-10-15T00:00:00Z",
    )
    chunks = [chunk.original_text for section in document.sections for chunk in section.chunks]
    holder = next(text for text in chunks if "6. Содержимое упаковки и прочие сведения." in text)
    assert holder.rstrip().endswith("6. Содержимое упаковки и прочие сведения.")
    assert not any(
        text.startswith(
            "1. Что из себя представляет препарат Румикоз®, и для чего его применяют Пре"
        )
        and "6. Содержимое" in text
        for text in chunks
    )
    assert any(text.startswith("1. Что из себя представляет препарат Румикоз®") for text in chunks)


def test_numbering_prefix_stays_with_the_heading_text_it_numbers() -> None:
    text = "Хранить в защищенном месте. 5. Хранение препарата Вермокс. Не замораживать."
    boundaries = find_grls_section_boundaries(text)
    assert [boundary.canonical_title for boundary in boundaries] == ["Хранение препарата"]
    assert text[boundaries[0].piece_start :].startswith("5. Хранение препарата")
    from localmed_ingest.grls_instruction_sections import resegment_paragraph_text

    pieces = resegment_paragraph_text(text)
    assert pieces[0].text.rstrip() == "Хранить в защищенном месте."
    assert pieces[1].text == "5. Хранение препарата Вермокс. Не замораживать."
    assert "".join(piece.text for piece in pieces) == text
    # a paragraph that is only a numbered phrase yields one piece, no lone number
    assert [piece.text for piece in resegment_paragraph_text("3. Прием препарата Вермокс.")] == [
        "3. Прием препарата Вермокс."
    ]


def test_a_contents_paragraph_is_never_resegmented() -> None:
    body = (
        "# Общая информация\n\n"
        '<!-- localmed:source {"block":"p1-b3","blocks":["p1-b3","p1-b4"],"kind":"list",'
        '"page":1,"role":"contents"} -->\n'
        "3. Прием препарата Вермокс.\n5. Хранение препарата Вермокс.\n"
    )
    sections = parse_sections(body)
    expanded = expand_grls_instruction_sections(sections)
    assert [section.title for section in expanded] == ["Общая информация"]
    assert expanded[0].paragraphs[0].text == (
        "3. Прием препарата Вермокс.\n5. Хранение препарата Вермокс."
    )


# --- the re-render (module builder input) ---------------------------------------------------------


def test_rerender_replaces_only_the_body_and_records_the_lists() -> None:
    source = source_of(blocks_of(*VERMOX))
    markdown = front_matter() + render_body(source, source_id="v")
    result = rerender_contents("v", markdown, source)
    assert result is not None
    old_head, _ = split_prepared(markdown)
    new_head, new_body = split_prepared(result.markdown)
    assert new_head == old_head
    assert '"role":"contents"' in new_body
    assert result.text_sha256 != result.text_sha256_before
    row = overlay_row(result, "../../data/intermediate/x", "../../data/intermediate/y")
    assert row["sourceId"] == "v"
    assert row["contentsLists"][0]["entries"] == 6
    assert row["contentsLists"][0]["blocks"][0] == "p1-b3"
    merged = apply_overlay(
        [
            {"sourceId": "v", "extraction": "prepared", "workspace": "old", "textSha256": "a"},
            {"sourceId": "w", "extraction": "prepared", "workspace": "old", "textSha256": "a"},
        ],
        {"v": row},
    )
    assert merged[0]["workspace"] == "../../data/intermediate/x"
    assert merged[0]["textSha256"] == result.text_sha256
    assert merged[1]["workspace"] == "old"


def test_a_document_without_a_contents_list_is_not_re_rendered() -> None:
    source = source_of(
        blocks_of(
            ("heading", "Показания к применению", True),
            ("paragraph", "Препарат применяется у взрослых."),
        )
    )
    markdown = front_matter() + render_body(source, source_id="v")
    assert rerender_contents("v", markdown, source) is None


def test_an_edited_body_is_refused() -> None:
    source = source_of(blocks_of(*VERMOX))
    markdown = front_matter() + render_body(source, source_id="v") + "\nИзменено вручную.\n"
    with pytest.raises(BodyNotReproducedError):
        rerender_contents("v", markdown, source)


def test_manufacturer_workspace_gets_a_prepared_contents_directory_that_wins(
    tmp_path: Path,
) -> None:
    from localmed_ingest.manufacturer_contents import rerender_manufacturer
    from localmed_ingest.manufacturer_instruction_modules import CONTENTS_DIR, PREPARED_DIRS

    assert PREPARED_DIRS[0] == CONTENTS_DIR
    with_list = source_of(blocks_of(*VERMOX))
    without = source_of(blocks_of(("paragraph", "Просто текст без содержания.")))
    prepared = tmp_path / "prepared-pdf"
    (prepared / ".localmed" / "extractions").mkdir(parents=True)
    for name, extracted in (
        ("drug.rf.m1.a.instruction", with_list),
        ("drug.rf.m1.b.instruction", without),
    ):
        (prepared / f"{name}.md").write_text(
            front_matter() + render_body(extracted, source_id=name), encoding="utf-8"
        )
        (prepared / ".localmed" / "extractions" / f"{name}.json").write_text(
            extracted.model_dump_json(by_alias=True), encoding="utf-8"
        )
    report = rerender_manufacturer(tmp_path)
    assert report["documentIds"] == ["drug.rf.m1.a.instruction"]
    assert report["notReproduced"] == []
    rewritten = tmp_path / CONTENTS_DIR / "drug.rf.m1.a.instruction.md"
    assert '"role":"contents"' in rewritten.read_text(encoding="utf-8")
    assert not (tmp_path / CONTENTS_DIR / "drug.rf.m1.b.instruction.md").exists()
