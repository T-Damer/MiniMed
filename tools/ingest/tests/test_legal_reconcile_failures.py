"""Silent failures of Marker that the reconciliation must catch (each case taken from a real page of the 30 acts)."""

from localmed_ingest.legal_reconcile import (
    act_identity,
    canonical_self_references,
    clean_marker_markdown,
    detect_loops,
    reconcile_page,
    tokenize,
)

RECORD = {
    "number": "213н",
    "documentDate": "2025-04-14T00:00:00",
    "name": "Об утверждении Порядка оказания несовершеннолетним медицинской помощи",
    "complexName": "Приказ Министерства здравоохранения Российской Федерации от 14.04.2025 № 213н",
    "jdRegNumber": "82500",
    "jdRegDate": "2025-05-26T00:00:00",
}


def vision(text: str) -> list[str]:
    return [line for line in text.split("\n") if line.strip()]


CALENDAR_ROWS = [
    ("5.", "Дети 3 месяца", "Первая вакцинация против дифтерии, коклюша, столбняка"),
    ("", "", "Первая вакцинация против полиомиелита"),
    ("", "", "Первая вакцинация против гемофильной инфекции типа b"),
    ("6.", "Дети 4,5 месяца", "Вторая вакцинация против дифтерии, коклюша, столбняка"),
    ("", "", "Вторая вакцинация против полиомиелита"),
    ("", "", "Вторая вакцинация против гемофильной инфекции типа b"),
    ("7.", "Дети 6 месяцев", "Третья вакцинация против дифтерии, коклюша, столбняка"),
    ("", "", "Третья вакцинация против полиомиелита"),
]
POLIO = {"Первая вакцинация против полиомиелита", "Вторая вакцинация против полиомиелита"}


def _table(rows: list[tuple[str, str, str]]) -> str:
    lines = ["| № п/п | Возраст | Прививка |", "| --- | --- | --- |"]
    lines.extend(f"| {a} | {b} | {c} |" for a, b, c in rows)
    return "\n".join(lines)


def test_dropped_rows_made_of_words_found_elsewhere_are_still_detected() -> None:
    """1122н: two polio rows vanished from the calendar; every word of them is in other rows."""
    reading = vision("\n".join(" ".join(part for part in row if part) for row in CALENDAR_ROWS))
    assert reconcile_page(3, _table(CALENDAR_ROWS), reading).status == "pass"
    lost = _table([row for row in CALENDAR_ROWS if row[2] not in POLIO])
    result = reconcile_page(3, lost, reading)
    assert result.status == "review"
    flagged = [f for f in result.flags if f.kind in {"repeated-content-missing", "coverage-vision"}]
    assert flagged and "полиомиелита" in flagged[0].detail


def test_lines_cut_at_the_foot_of_a_page_are_detected() -> None:
    """220н: the last two lines of a list were dropped by Marker."""
    head = (
        "5. Проведение подробного осмотра и опроса пострадавшего:\n\nопрос пострадавшего;\n\n"
        "проведение осмотра головы;"
    )
    tail = "\n\nпроведение осмотра шеи;\n\nпроведение осмотра груди;"
    other = "\n\nпри наличии сознания проведение подробного осмотра и опроса;\n\nпроведение осмотра места."
    result = reconcile_page(5, head + other, vision(head + tail + other))
    assert result.status == "review"
    assert any(
        f.kind in {"repeated-content-missing", "dropped-span", "coverage-vision"}
        for f in result.flags
    )


def test_compound_hyphen_lost_by_marker_at_a_line_end_is_restored() -> None:
    marker = (
        "группы повышенного медикосоциального риска, а также санитарногигиенические требования."
    )
    lines = vision(
        "группы повышенного медико-\nсоциального риска, а также санитарно-\nгигиенические требования."
    )
    result = reconcile_page(10, marker, lines)
    assert "медико-социального" in result.text
    assert "санитарно-гигиенические" in result.text
    assert result.status == "pass"
    assert any("hyphen restored" in note for note in result.portal_rewrites)
    soft = reconcile_page(10, "работа по организации", vision("работа по организа-\nции"))
    assert "организа-ции" not in soft.text


def test_annex_header_with_one_misread_figure_gets_the_portal_number() -> None:
    identity = act_identity(RECORD)
    text = (
        "Приложение № 1\nк Порядку, утвержденному приказом Министерства\n"
        "от «14»апреля 2025 г. № 113\n\nПоложение"
    )
    rewritten, rewrites = canonical_self_references(text, identity)
    assert "от 14 апреля 2025 г. № 213н" in rewritten
    assert len(rewrites) == 1


def test_html_left_in_table_cells_by_marker_is_flattened() -> None:
    cleaned = clean_marker_markdown(
        "| 1. | <p>Лица:</p> <ul><li>- первые;</li> <li>- вторые.</li></ul> | <b>да</b> |"
    )
    assert "<" not in cleaned
    assert "Лица:⏎- первые;⏎- вторые." in cleaned


def test_a_disputed_number_is_never_replaced_by_words() -> None:
    result = reconcile_page(8, "Термометр | 4 |", vision("Термометр сплава галлия"))
    assert "4" in result.text and "галлия" not in result.text
    assert result.status == "review"


def test_a_disputed_number_takes_visions_figure_and_is_flagged() -> None:
    result = reconcile_page(15, "Грелка медицинская | 2 |", vision("Грелка медицинская 17"))
    assert "| 17 |" in result.text
    assert any(f.kind == "token-substitution" for f in result.flags)
    assert result.status == "review"


def test_phantom_table_column_is_dropped_but_a_continuation_fragment_is_kept() -> None:
    phantom = (
        "| № п/п | Наименование | | Группа | Количество |\n"
        "|---|---|--|---|---|\n"
        "| 1. | Рабочее место врача | | 2, 3 | 1 |\n"
        "| 2. | Рабочее место сестры | | 2, 3 | 1 |"
    )
    cleaned = clean_marker_markdown(phantom)
    assert "| № п/п | Наименование | Группа | Количество |" in cleaned
    assert "| 1. | Рабочее место врача | 2, 3 | 1 |" in cleaned
    fragment = (
        "| | | | 366210 | Аппарат для измерения | |\n"
        "|--|--|--|--|--|--|\n"
        "| 3. | Кушетка | 2, 3 | 187150 | Стол | 1 |"
    )
    assert clean_marker_markdown(fragment).count("|") == fragment.count("|")


def test_a_roman_numeral_is_never_swapped_for_an_arabic_one() -> None:
    result = reconcile_page(
        8,
        "К основной группе (I группа) относятся",
        vision("К основной группе (1 группа) относятся"),
    )
    assert "(I группа)" in result.text and "(1 группа)" not in result.text
    assert result.status == "review"


def test_a_row_of_column_numbers_and_a_table_of_quantities_are_not_loops() -> None:
    numbering = "| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |"
    assert not detect_loops(tokenize(numbering), numbering)
    quantities = "| 400 | 500 | 600 | 300 | 400 | 500 | 50 | 60 | 70 | 4 | 7 | 10 | 3 | 4 | 7 |"
    assert not detect_loops(tokenize(quantities), quantities)
    counting = "Показатели 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 и далее"
    assert detect_loops(tokenize(counting), counting)
