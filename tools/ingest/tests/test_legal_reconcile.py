"""Reconciliation of Marker's Markdown with Vision's lines (fixtures, no network, no files)."""

from localmed_ingest.legal_reconcile import (
    act_identity,
    canonical_self_references,
    clean_marker_markdown,
    dehyphenate,
    detect_loops,
    numbered_gaps,
    reconcile_page,
    strip_furniture,
    strip_header_marker,
    strip_header_vision,
    tokenize,
)

RECORD = {
    "number": "195н",
    "documentDate": "2025-04-11T00:00:00",
    "name": "Об утверждении Порядка проведения экспертизы временной нетрудоспособности",
    "complexName": (
        "Приказ Министерства здравоохранения Российской Федерации от 11.04.2025 № 195н<br /> "
        '"Об утверждении Порядка проведения экспертизы временной нетрудоспособности"'
    ),
    "jdRegNumber": "82144",
    "jdRegDate": "2025-05-13T00:00:00",
}

BODY = (
    "Экспертиза временной нетрудоспособности проводится медицинскими организациями, имеющими лицензию "
    "на медицинскую деятельность, включая работы по экспертизе временной нетрудоспособности. "
    "Срок хранения протокола врачебной комиссии составляет 10 лет, а лист нетрудоспособности выдается на 15 дней."
)


def vision(text: str) -> list[str]:
    return [line for line in text.split("\n") if line.strip()]


def test_identity_comes_from_the_portal_record() -> None:
    identity = act_identity(RECORD)
    assert identity.number == "195н"
    assert identity.date == "2025-04-11"
    assert identity.reference == "от 11 апреля 2025 г. № 195н"
    assert identity.kind_line.endswith("№ 195н")
    assert {"195", "82144", "2025", "11"} <= identity.known_numbers()


def test_handwritten_n_read_as_4_is_replaced_by_the_portal_number() -> None:
    identity = act_identity(RECORD)
    marker = (
        "Приложение  \nк приказу Министерства здравоохранения  \nРоссийской Федерации  \n"
        "от 11 апреля 2015 г. № 1954\n\n" + BODY
    )
    rewritten, rewrites = canonical_self_references(marker, identity)
    assert "от 11 апреля 2025 г. № 195н" in rewritten
    assert "1954" not in rewritten
    assert rewrites == ["от 11 апреля 2015 г. № 1954"]
    other = "Приложение к приказу Министерства финансов от 3 мая 2020 г. № 77н\n\n" + BODY
    assert canonical_self_references(other, identity)[0] == other


def test_first_page_header_is_cut_in_both_readings_up_to_the_title() -> None:
    identity = act_identity(RECORD)
    marker = (
        "МИНИСТЕРСТВО ЗДРАВООХРАНЕНИЯ  \nРОССИЙСКОЙ ФЕДЕРАЦИИ\n\n11 апреля 2025 г.\n\n№ *1954*\n\n"
        "**Об утверждении Порядка проведения экспертизы временной  \nнетрудоспособности**\n\n"
        "В соответствии с частью 6 статьи 59 приказываю:"
    )
    rest, removed = strip_header_marker(marker, identity)
    assert rest == "В соответствии с частью 6 статьи 59 приказываю:"
    assert removed is not None and "1954" in removed
    lines = [
        "МИНИСТЕРСТВО ЗДРАВООХРАНЕНИЯ",
        "ЗАРЕГИСТРИРОВАНО",
        "Регистрационный № 82144",
        "Об утверждении Порядка проведения экспертизы временной",
        "нетрудоспособности",
        "В соответствии с частью 6",
    ]
    kept, cut = strip_header_vision(lines, identity)
    assert kept == ["В соответствии с частью 6"]
    assert cut is not None and len(cut) == 5
    assert strip_header_marker("Текст без заголовка", identity) == ("Текст без заголовка", None)


def test_number_loop_page_falls_back_to_vision_and_is_flagged() -> None:
    loop = " / ".join(str(n) for n in range(3, 40))
    marker = f"ЭТ - {loop}\n\n25.04.1974\n\n{BODY}"
    result = reconcile_page(2, marker, vision(BODY))
    assert result.status == "review"
    assert result.reading == "vision-fallback"
    assert any(flag.kind == "loop" for flag in result.flags)
    assert "10 лет" in result.text
    assert "283" not in result.text


def test_repeated_ngram_is_a_loop() -> None:
    tokens = tokenize("C6 C9 " * 8 + "конец")
    assert detect_loops(tokens)
    assert not detect_loops(tokenize("Доза 5 мл, затем 10 мл через 15 минут, 2 раза в сутки"))


def test_dropped_table_row_shows_in_the_numbers_and_the_numbered_rows() -> None:
    marker = (
        "| № | Возраст | Прививка |\n| --- | --- | --- |\n"
        "| 1 | 12 часов | гепатит B |\n| 2 | 3 дня | БЦЖ |\n| 4 | 6 месяцев | гепатит B |\n"
    )
    lines = vision(
        "№ Возраст Прививка\n1 12 часов гепатит B\n2 3 дня БЦЖ\n3 4,5 месяца полиомиелит\n4 6 месяцев гепатит B"
    )
    result = reconcile_page(5, marker, lines)
    kinds = {flag.kind for flag in result.flags}
    assert result.status == "review"
    assert "number-mismatch" in kinds
    assert "numbered-rows" in kinds
    mismatch = next(flag for flag in result.flags if flag.kind == "number-mismatch")
    assert "4,5" in mismatch.detail
    assert "3" in next(f for f in result.flags if f.kind == "numbered-rows").detail


def test_disputed_number_takes_visions_reading_and_is_flagged() -> None:
    marker = (
        "Разовая доза составляет 0,5 мг, не более 20 мг в сутки, приём через 8 часов после еды."
    )
    lines = vision(
        "Разовая доза составляет 0,05 мг, не более 20 мг в сутки, приём через 8 часов после еды."
    )
    result = reconcile_page(7, marker, lines)
    assert result.status == "review"
    assert result.reading == "marker+vision-tokens"
    assert "0,05 мг" in result.text and "0,5" not in result.text
    substitution = next(flag for flag in result.flags if flag.kind == "token-substitution")
    assert "0,5" in substitution.detail and "0,05" in substitution.detail


def test_dropped_paragraph_is_detected_by_the_token_coverage() -> None:
    preamble = (
        "В соответствии с частью 6 статьи 59 Федерального закона от 21 ноября 2011 г. № 323-ФЗ "
        "и подпунктом 5.2.84 пункта 5 Положения о Министерстве здравоохранения Российской Федерации, "
        "утвержденного постановлением Правительства Российской Федерации от 19 июня 2012 г. № 608"
    )
    full = f"{preamble}, приказываю:\n\n1. Утвердить Порядок согласно приложению.\n\n{BODY}"
    cut = f"В соответствии с частью 6 статьи 59 Федерального закона от 21 ноября 2011 г.\n\n{BODY}"
    assert reconcile_page(3, full, vision(full)).status == "pass"
    result = reconcile_page(3, cut, vision(full))
    kinds = {flag.kind for flag in result.flags}
    assert result.status == "review"
    assert "coverage-vision" in kinds
    assert "dropped-span" in kinds
    assert "5.2.84" in next(f for f in result.flags if f.kind == "number-mismatch").detail


def test_clean_page_with_footnotes_and_ordinals_passes() -> None:
    marker = (
        "1. Экспертиза проводится в день обращения<sup>1</sup>.\n\n"
        "2. Срок хранения составляет 10 лет.\n\n<sup>1</sup> Часть 1 статьи 59 Федерального закона № 323-ФЗ."
    )
    lines = vision(
        "Экспертиза проводится в день обращения!\n2.\nСрок хранения составляет 10 лет.\n"
        "1 Часть 1 статьи 59 Федерального закона Nº 323-Ф3.\n47"
    )
    result = reconcile_page(8, marker, lines)
    assert result.flags == []
    assert result.status == "pass"
    assert result.furniture == ["47"]


def test_missing_marker_page_uses_vision_and_is_flagged() -> None:
    result = reconcile_page(9, None, vision(BODY))
    assert result.reading == "vision-fallback"
    assert result.flags[0].kind == "marker-missing"


def test_clean_marker_markdown_repairs_markup_only() -> None:
    cleaned = clean_marker_markdown(
        "1. 1) лечащим врачом;\n2. 2. Признать<sup>12</sup>\n\n![]()Подпись<br>строка\n\n\n\nконец  \n"
    )
    assert "1) лечащим врачом;" in cleaned
    assert "2. Признать¹²" in cleaned
    assert "![" not in cleaned
    assert "Подпись строка" in cleaned
    assert "\n\n\n" not in cleaned


def test_furniture_is_removed_only_at_the_page_edges() -> None:
    kept, removed = strip_furniture(["12", "Текст 5 мг", "**3**"])
    assert kept == ["Текст 5 мг"]
    assert removed == ["12", "**3**"]
    assert strip_furniture(["Доза", "15", "мг"])[1] == []


def test_numbered_gaps_names_missing_rows() -> None:
    table = "| 1 | а |\n| 2 | б |\n| 4 | г |\n"
    problems = numbered_gaps(table, ["1 а", "2 б", "3 в", "4 г"])
    assert any("skips 3" in p for p in problems)
    assert any("3" in p and "Marker lacks" in p for p in problems)


def test_hyphenated_word_is_joined_before_comparison() -> None:
    assert dehyphenate(["лечеб-", "ных учреждений"]) == ["лечебных учреждений"]
