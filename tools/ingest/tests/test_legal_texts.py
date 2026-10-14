"""Full-text assembly of the regulatory acts: blocks, page joins, structure, review log, cards, text sources."""

import io
import zipfile
from pathlib import Path

import pytest

from localmed_ingest.legal_cards import assemble_card, description_of, sections_of, split_card
from localmed_ingest.legal_reconcile import act_identity
from localmed_ingest.legal_text_sources import (
    docx_to_markdown,
    ips_html_to_markdown,
    rg_html_to_markdown,
)
from localmed_ingest.legal_texts import (
    Correction,
    CorrectionError,
    Review,
    apply_corrections,
    build_act_text,
    build_text_source_act,
    merge_pages,
    parse_blocks,
    reconcile_act,
    render_blocks,
    structure,
)
from localmed_ingest.markdown_parser import parse_markdown_document

RECORD = {
    "number": "195н",
    "documentDate": "2025-04-11T00:00:00",
    "name": "Об утверждении Порядка проведения экспертизы временной нетрудоспособности",
    "complexName": "Приказ Министерства здравоохранения Российской Федерации от 11.04.2025 № 195н",
    "jdRegNumber": "82144",
    "jdRegDate": "2025-05-13T00:00:00",
}
IDENTITY = act_identity(RECORD)

PAGE1 = (
    "МИНИСТЕРСТВО ЗДРАВООХРАНЕНИЯ\n\n№ *1954*\n\n"
    "**Об утверждении Порядка проведения экспертизы временной нетрудоспособности**\n\n"
    "В соответствии с частью 6 статьи 59 Федерального закона приказываю:\n\n"
    "1. 1. Утвердить Порядок согласно приложению.\n\n2. 2. Настоящий приказ вступает в силу с 1 сентября 2025 г."
)
PAGE2 = (
    "Приложение  \nк приказу Министерства здравоохранения  \nот 11 апреля 2015 г. № 1954\n\n"
    "**Порядок проведения экспертизы**\n\n"
    "1. Экспертиза проводится в день обращения гражданина в медицинскую организацию и\n\n"
    "<sup>1</sup> Часть 1 статьи 59 Федерального закона № 323-ФЗ."
)
PAGE3 = (
    "продолжается в соответствии с порядком.\n\n"
    "| № | Срок | Документ |\n| --- | --- | --- |\n| 1 | 10 дней | протокол |\n| 2 | 15 дней | лист |"
)
PAGE4 = "| № | Срок | Документ |\n| --- | --- | --- |\n| 3 | 20 дней | справка |"


def vision_for(*pages: int) -> dict[int, list[str]]:
    plain = {1: PAGE1, 2: PAGE2, 3: PAGE3, 4: PAGE4}
    return {n: [x for x in plain[n].replace("|", " ").split("\n") if x.strip()] for n in pages}


def test_parse_blocks_splits_items_tables_headings_and_footnotes() -> None:
    blocks = parse_blocks(PAGE2.replace("<sup>1</sup>", "¹"), 2)
    kinds = [(b.kind, b.text[:20]) for b in blocks]
    assert kinds[0][0] == "paragraph" and kinds[0][1].startswith("Приложение")
    assert ("heading", "Порядок проведения э") in kinds
    assert blocks[-1].kind == "footnote"
    table = parse_blocks(PAGE3, 3)[-1]
    assert table.kind == "table"
    assert table.rows[0] == ["№", "Срок", "Документ"]
    assert len(table.rows) == 3
    items = parse_blocks("1) первое;\n2) второе;\n3) третье.", 4)
    assert [b.text for b in items] == ["1) первое;", "2) второе;", "3) третье."]


def test_paragraph_and_table_running_across_a_page_break_are_joined() -> None:
    p2 = parse_blocks(PAGE2.replace("<sup>1</sup>", "¹"), 2)
    p3 = parse_blocks(PAGE3, 3)
    p4 = parse_blocks(PAGE4, 4)
    merged = merge_pages([p2, p3, p4])
    joined = next(b for b in merged if b.text.startswith("1. Экспертиза"))
    assert joined.text.endswith("и продолжается в соответствии с порядком.")
    assert (joined.page, joined.end_page) == (2, 3)
    # the footnote of page 2 stays behind the paragraph it belongs to, not inside it
    assert merged[merged.index(joined) + 1].kind == "footnote"
    tables = [b for b in merged if b.kind == "table"]
    assert len(tables) == 1
    assert [row[0] for row in tables[0].rows] == ["№", "1", "2", "3"]
    assert tables[0].end_page == 4


def test_table_continues_across_a_footnote_and_a_repeated_header_block_is_dropped() -> None:
    first = parse_blocks(
        "| Код | Наименование |\n|---|---|\n| 1 | 2 |\n| 3 | Кушетка |\n\n¹ Сноска страницы.", 1
    )
    second = parse_blocks(
        "| Код | Наименование |\n|---|---|\n| 1 | 2 |\n| 4 | Весы |\n| 5 | Ширма |", 2
    )
    merged = merge_pages([first, second])
    tables = [b for b in merged if b.kind == "table"]
    assert len(tables) == 1
    assert [row[0] for row in tables[0].rows] == ["Код", "1", "3", "4", "5"]
    assert tables[0].end_page == 2
    assert merged[-1].kind == "footnote"  # the footnote stays after the table it was printed under


def test_a_numbered_row_cut_by_the_page_break_is_joined_cell_by_cell() -> None:
    first = parse_blocks(
        "| № | Период | Врачи |\n|---|---|---|\n| 26. | 12 лет | Врач-педиатр |", 1
    )
    second = parse_blocks(
        "| | | Врач-стоматолог детский |\n|---|---|---|\n| 27. | 13 лет | Врач-педиатр |", 2
    )
    merged = merge_pages([first, second])
    rows = next(b for b in merged if b.kind == "table").rows
    assert rows[1] == ["26.", "12 лет", "Врач-педиатр\nВрач-стоматолог детский"]
    assert rows[2][0] == "27."
    # a label that spans several item rows is not a numbered row: the next item stays a row of its own
    labelled = parse_blocks("| | |\n|---|---|\n| Знания | Первое умение |", 1)
    after = parse_blocks("| | Второе умение |\n|---|---|\n| | Третье умение |", 2)
    kept = next(b for b in merge_pages([labelled, after]) if b.kind == "table").rows
    assert [row[1] for row in kept[1:]] == ["Первое умение", "Второе умение", "Третье умение"]


def test_a_wrapped_word_is_rejoined_only_when_the_act_prints_the_whole_word() -> None:
    from localmed_ingest.legal_texts import Block, rejoin_wrapped_words

    table = Block(
        "table",
        "",
        1,
        rows=[
            ["1.", "под кодом медицинс-ким изделием", "1 на 1 врача-специалиста"],
            [
                "2.",
                "медицинским изделием",
                "номен-клатурной классифи-кации номенклатурной классификации",
            ],
        ],
    )
    assert rejoin_wrapped_words([table]) == 3
    assert table.rows[0][1] == "под кодом медицинским изделием"
    assert table.rows[0][2] == "1 на 1 врача-специалиста"
    assert "номенклатурной классификации номенклатурной" in table.rows[1][2]


def test_label_rows_take_one_shape_whatever_marker_made_of_them() -> None:
    from localmed_ingest.legal_texts import label_rows_markdown

    labels = ("Уровень профессионального образования", "Должности")
    text = "\n".join(
        [
            "Специальность «Авиационная медицина»",
            "",
            "| Уровень профессионального образования | Высшее⏎Ординатура |",
            "|---|---|",
            "",
            "#### Специальность «Гигиена труда»",
            "",
            "Должности      Врач по гигиене труда",
            "",
            "**Уровень профессионального образования** Высшее образование",
            "",
            "#### Уровень профессионального",
            "",
            "Высшее образование – специалитет",
            "",
            "Обычный абзац.",
        ]
    )
    result = label_rows_markdown(text, labels)
    assert "### Специальность «Авиационная медицина»" in result
    assert "**Уровень профессионального образования.** Высшее\n\nОрдинатура" in result
    assert "### Специальность «Гигиена труда»" in result
    assert "**Должности.** Врач по гигиене труда" in result
    assert "**Уровень профессионального образования.** Высшее образование\n" in result
    assert "**Уровень профессионального образования.** Высшее образование – специалитет" in result
    assert "Обычный абзац." in result


def test_act_text_has_portal_title_annex_sections_and_no_empty_section(tmp_path: Path) -> None:
    results, _pending = reconcile_act(
        {1: PAGE1, 2: PAGE2, 3: PAGE3, 4: PAGE4}, vision_for(1, 2, 3, 4), IDENTITY
    )
    act = build_act_text(results, IDENTITY)
    assert act.body.startswith("# Приказ № 195н\n")
    assert "«Об утверждении Порядка проведения экспертизы временной нетрудоспособности»" in act.body
    assert "1954" not in act.body
    assert "от 11 апреля 2025 г. № 195н" in act.body
    assert "# Приложение" in act.body
    assert "1. 1." not in act.body
    card = tmp_path / "card.md"
    card.write_text(
        "---\nid: regulatory.rf.test.195n\ntitle: Тест — приказ № 195н\nversion_label: v1\n"
        "source_type: regulatory_act_summary\nstatus: active\n---\n" + act.body,
        encoding="utf-8",
    )
    document = parse_markdown_document(card, "2026-10-14T00:00:00Z")
    assert all(section.chunks for section in document.sections)
    table_chunks = [c for s in document.sections for c in s.chunks if "renderBlock" in c.metadata]
    assert len(table_chunks) == 1
    render = table_chunks[0].metadata["renderBlock"]
    assert isinstance(render, dict) and render["kind"] == "table"
    assert "| 3 | 20 дней | справка |" in table_chunks[0].original_text
    pages = {c.page_start for s in document.sections for c in s.chunks}
    assert {1, 2, 3} <= pages


def test_structure_merges_adjacent_headings_and_keeps_law_levels() -> None:
    law = [
        *parse_blocks(
            "**Глава 1. Общие положения**\n\n**Статья 1. Предмет**\n\n1. Закон определяет условия.",
            0,
        ),
        *parse_blocks("**Статья 2. Лица**\n\n1. Право имеют граждане.", 0),
    ]
    blocks = structure(law, IDENTITY, first_page=0)
    headings = [(b.level, b.text) for b in blocks if b.kind == "heading"]
    assert headings[0] == (1, "Приказ № 195н")
    assert (2, "Глава 1. Общие положения") in headings
    assert (3, "Статья 2. Лица") in headings
    assert "<!-- localmed:source {} -->" not in render_blocks(blocks)


def test_review_log_corrections_apply_once_and_clear_the_flag() -> None:
    marker = "Срок хранения протокола составляет 10 лет, а лист выдается на 15 дней и более."
    vision = {5: ["Срок хранения протокола составляет 10 лет, а лист выдается на 25 дней и более."]}
    results, pending = reconcile_act({5: marker}, vision, IDENTITY)
    assert pending == [5] and results[0].status == "review"
    review = Review(
        verdicts={5: "image shows 15; Vision misread"},
        corrections=[Correction(5, "на 15 дней", "на 15 дней", "number", "checked")],
    )
    results, pending = reconcile_act({5: marker}, vision, IDENTITY, review)
    assert pending == []
    assert results[0].status == "reviewed"
    assert (
        "на 15 дней" in results[0].text
    )  # a reviewed page keeps Marker's reading, not Vision's token
    with pytest.raises(CorrectionError):
        apply_corrections(results[0], [Correction(5, "нет такого текста", "x", "text", "")])
    with pytest.raises(CorrectionError):
        apply_corrections(results[0], [Correction(5, "о", "О", "text", "")])


def test_unreviewed_flagged_pages_keep_a_review_mark_in_the_text() -> None:
    marker = "Срок хранения протокола составляет 10 лет, а лист выдается на 15 дней и более."
    vision = {5: ["Срок хранения протокола составляет 10 лет, а лист выдается на 25 дней и более."]}
    results, pending = reconcile_act({5: marker}, vision, IDENTITY)
    act = build_act_text(results, IDENTITY)
    assert act.pending_pages == pending == [5]
    assert "<!-- localmed:review page 5:" in act.body


def _docx(paragraphs: list[str]) -> bytes:
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    table = (
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Возраст</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>Осмотр</w:t></w:r></w:p></w:tc></w:tr>"
        "<w:tr><w:tc><w:p><w:r><w:t>1 год</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>педиатр</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
    )
    xml = f'<?xml version="1.0"?><w:document xmlns:w="{ns}"><w:body>{body}{table}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


def test_text_sources_become_markdown_with_tables_footnotes_and_no_rules() -> None:
    markdown = docx_to_markdown(
        _docx(
            [
                "I. Общие положения",
                "1. Порядок &lt;1&gt;.",
                "--------------------------------",
                "&lt;1&gt; Часть 1 статьи 46.",
            ]
        )
    )
    assert "1. Порядок ¹." in markdown
    assert "----------" not in markdown
    assert "| Возраст | Осмотр |" in markdown and "| 1 год | педиатр |" in markdown
    act = build_text_source_act(markdown, IDENTITY, cut_header=False)
    assert "## I. Общие положения" in act.body
    assert act.pending_pages == []
    html = (
        '<div class="PageDocumentContent_text__x"><p><i>Прим. ред.: Актуальная редакция</i></p>'
        "<p><strong>Статья 1. Предмет</strong></p><p>1. Закон определяет условия.</p></div>"
    )
    assert rg_html_to_markdown(html) == "**Статья 1. Предмет**\n\n1. Закон определяет условия."
    ips = '<html><body><p class="H">Глава I. Общие положения</p><p>&nbsp;</p><p>Текст&nbsp;закона.</p></body></html>'
    assert ips_html_to_markdown([ips]) == "**Глава I. Общие положения**\n\nТекст закона."


OLD_CARD = """---
id: regulatory.rf.test.366n
title: Порядок — приказ № 366н (утратил силу)
version_label: 366n-superseded
source_type: regulatory_act_summary
status: superseded
metadata:
  documentNumber: 366н
  contentMode: source_linked_paraphrase
  edition: "с изменениями приказа № 1н"
---
# Статус документа

<!-- localmed:source {"documentNumber":"366н"} -->
Приказ № 366н утратил силу. Действует приказ № 120н.

# Историческое содержание

Старый пересказ.

# Источник и редакция

Приказ от 16 апреля 2012 г. № 366н.

Редакция: с изменениями приказа № 1н.

Сверено с официальным текстом 13 октября 2026 г.

Официальный текст: https://minzdrav.gov.ru/documents/1
"""


def test_card_keeps_status_and_footer_and_replaces_the_paraphrase() -> None:
    card = assemble_card(
        OLD_CARD,
        "# Приказ № 366н\n\nТекст приказа.\n",
        pages=35,
        amended=True,
        extra={"textPages": 35},
    )
    front, body = split_card(card)
    assert "contentMode: source_text" in front
    assert "contentMode: source_linked_paraphrase" not in front
    assert 'description: "Приказ № 366н утратил силу. Действует приказ № 120н."' in front
    assert "version_label: 366n-superseded\n" in front and "fulltext" not in front
    assert "textPages: 35" in front
    titles = [s.title for s in sections_of(body)]
    assert titles == ["Статус документа", "Приказ № 366н", "Источник и редакция"]
    assert "Старый пересказ" not in body
    footer = sections_of(body)[-1].text
    assert "Текст выше — первоначальная публикация" in footer
    assert "(35 стр.)" in footer
    assert description_of(sections_of(split_card(OLD_CARD)[1])).startswith(
        "Приказ № 366н утратил силу"
    )
    # assembling again from the new card is stable
    again = assemble_card(
        card, "# Приказ № 366н\n\nТекст приказа.\n", pages=35, amended=True, extra={"textPages": 35}
    )
    assert again.count("textPages") == 1


def test_a_labelled_row_cut_by_the_page_break_runs_on_into_the_quoted_names_and_hyphen_wraps() -> (
    None
):
    first = parse_blocks("Высшее образование – специалитет по специальности", 1)
    second = parse_blocks("«Лечебное дело», «Педиатрия»\n\nи ещё одна", 2)
    # a quoted name continues a paragraph that stops at a word, but only in acts with labelled rows
    assert len(merge_pages([first, second], labelled_rows=True)) == 2
    joined = merge_pages(
        [
            parse_blocks("Подготовка по специальности «Санитарно-", 1),
            parse_blocks("гигиенические» или", 2),
        ]
    )
    assert joined[0].text == "Подготовка по специальности «Санитарно-гигиенические» или"
    plain = merge_pages(
        [
            parse_blocks("Высшее образование – специалитет по специальности", 1),
            parse_blocks("«Лечебное дело»", 2),
        ]
    )
    assert len(plain) == 2  # a list item starting with a quote is not glued on in other acts
    closed = merge_pages(
        [
            parse_blocks("Высшее образование – специалитет «Клиническая психология»)»", 1),
            parse_blocks("и дополнительное образование", 2),
        ],
        labelled_rows=True,
    )
    assert len(closed) == 1
