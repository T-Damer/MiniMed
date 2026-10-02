from __future__ import annotations

from localmed_ingest.manufacturer_instructions import (
    RobotsRules,
    Target,
    holder_key,
    match_document,
    numbers_in,
    parse_page,
    registration_key,
    relevant,
    revision_dates,
)


def target(
    number: str,
    name: str,
    form: str = "таблетки, покрытые пленочной оболочкой",
    release: str = "",
    holder: str = 'Акционерное общество "ВЕРТЕКС" (АО "ВЕРТЕКС")',
) -> Target:
    return Target(
        registration_number=number,
        trade_name=name,
        inn="",
        dosage_form=form,
        release_forms=release,
        holder=holder,
        manufacturer="",
        country="Россия",
        essential=True,
        prescription="По рецепту",
        status="Действующий",
        covered_numbers=(number,),
    )


HOLDER = ("ВЕРТЕКС", "вертекс")


def test_robots_longest_match_wildcards_and_agent_group() -> None:
    rules = RobotsRules.parse(
        "User-agent: *\nAllow: /upload/*\nDisallow: /upload/\nDisallow: /*?print=\n"
        "User-agent: BadBot\nDisallow: /\n"
    )
    assert rules.allowed("https://x.ru/upload/a.pdf")
    assert not rules.allowed("https://x.ru/catalog/?print=Y")
    assert rules.allowed("https://x.ru/catalog/")
    assert not RobotsRules.parse("User-agent: *\nDisallow: /\n").allowed("https://x.ru/a")
    assert RobotsRules.parse("").allowed("https://x.ru/a")


def test_registration_keys_and_numbers_in_text() -> None:
    assert registration_key("ЛП-№(011241)-(РГ-RU)") == ("E", "011241")
    assert registration_key("ЛП-006417") == ("ЛП", "006417")
    assert registration_key("П N014329/01") == ("П", "014329/01")
    found = numbers_in("Рег. номер: ЛП-№(011241)-(РГ-RU); также ЛП-006417 и ЛС-181 мг")
    assert ("E", "011241") in found
    assert ("ЛП", "006417") in found
    assert not any(core == "181" for _, core in found)


def test_holder_key_uses_short_name_or_strips_legal_form() -> None:
    assert holder_key('Акционерное общество "ВЕРТЕКС" (АО "ВЕРТЕКС")') == "вертекс"
    assert holder_key('Общество с ограниченной ответственностью Фирма "Здоровье"') == "здоровье"


def test_number_in_text_with_name_and_holder_is_text_number() -> None:
    text = "Инструкция. Эторикоксиб-ВЕРТЕКС. ЛП-№(006854)-(РГ-RU). Производитель АО ВЕРТЕКС"
    hits = match_document(text, "", [target("ЛП-№(006854)-(РГ-RU)", "Эторикоксиб-ВЕРТЕКС")], HOLDER)
    assert [h.level for h in hits] == ["text-number"]


def test_number_only_on_page_is_page_number() -> None:
    text = "Листок-вкладыш Эторикоксиб-ВЕРТЕКС таблетки. АО ВЕРТЕКС"
    page = "Эторикоксиб-ВЕРТЕКС Рег. удостоверение ЛП-№(006854)-(РГ-RU)"
    hits = match_document(
        text, page, [target("ЛП-№(006854)-(РГ-RU)", "Эторикоксиб-ВЕРТЕКС")], HOLDER
    )
    assert [h.level for h in hits] == ["page-number"]


def test_label_match_unique_by_form_and_strength() -> None:
    text = (
        "Листок-вкладыш – информация для пациента\n"
        "Эторикоксиб-ВЕРТЕКС, 60 мг, таблетки, покрытые пленочной оболочкой\n"
        "Держатель АО ВЕРТЕКС"
    )
    capsules = target("ЛП-№(000001)-(РГ-RU)", "Эторикоксиб-ВЕРТЕКС", "капсулы", "капсулы, 60 мг")
    tablets = target(
        "ЛП-№(000002)-(РГ-RU)",
        "Эторикоксиб-ВЕРТЕКС",
        "таблетки, покрытые пленочной оболочкой",
        "таблетки, покрытые пленочной оболочкой, 60 мг",
    )
    hits = match_document(text, "", [capsules, tablets], HOLDER)
    assert [(h.registration_number, h.level) for h in hits] == [
        ("ЛП-№(000002)-(РГ-RU)", "label-unique")
    ]


def test_label_match_ambiguous_when_two_registrations_fit() -> None:
    text = "Эторикоксиб-ВЕРТЕКС таблетки, покрытые пленочной оболочкой. ВЕРТЕКС"
    first = target("ЛП-№(000001)-(РГ-RU)", "Эторикоксиб-ВЕРТЕКС")
    second = target("ЛП-№(000002)-(РГ-RU)", "Эторикоксиб-ВЕРТЕКС")
    hits = match_document(text, "", [first, second], HOLDER)
    assert {h.level for h in hits} == {"label-ambiguous"}
    assert len(hits) == 2


def test_inn_trade_name_does_not_match_a_combination_product() -> None:
    text = "Листок-вкладыш Ампициллин + Сульбактам порошок для приготовления раствора. ВЕРТЕКС"
    single = target("ЛП-№(009925)-(РГ-RU)", "Ампициллин", "порошок для приготовления раствора")
    assert match_document(text, "", [single], HOLDER) == []


def test_parse_page_keeps_instruction_documents_and_drops_legal_files() -> None:
    markup = (
        b"<h1>Reduxin</h1>"
        b'<a href="/upload/a/Instruction.pdf">Instruction</a>'
        b'<a href="/upload/docs/policy.pdf">policy</a>' + "<p>ЛП-006417</p>".encode()
    )
    page = parse_page("https://x.ru/catalog/reduxin/", markup)
    assert [d.url for d in page.documents] == ["https://x.ru/upload/a/Instruction.pdf"]
    assert page.title == "Reduxin"
    assert page.registrations == ("ЛП-006417",)


def test_revision_dates_keep_printed_statements_only() -> None:
    text = (
        "Листок-вкладыш пересмотрен: 12.03.2025\n"
        "изменение поведения; ЛП-№(011241)-(РГ-RU) от 19.07.2023"
    )
    found = revision_dates(text, "2025-10-20_0005_ИМП.pdf")
    assert found[0] == "пересмотрен: 12.03.2025"
    assert found[-1] == "file name date 2025-10-20"
    assert not any("поведения" in item for item in found)


def test_relevant_prefilter_uses_name_and_inn_stems() -> None:
    candidates = [target("ЛП-1", "Эторикоксиб-ВЕРТЕКС")]
    assert relevant(candidates, "Эторикоксиб", "Листок")
    assert not relevant(candidates, "Ибупрофен")
