from __future__ import annotations

import pytest

from localmed_ingest.grls_collect import select_current_documents
from localmed_ingest.grls_groups import (
    DocumentKind,
    FormClass,
    build_group_queue,
    build_groups,
    classify_document_kind,
    dosage_form_class,
    normalize_inn,
)


@pytest.mark.parametrize(
    ("form", "expected"),
    [
        ("таблетки, покрытые пленочной оболочкой", "oral-solid"),
        ("капсулы кишечнорастворимые", "oral-solid"),
        ("раствор для внутривенного введения", "parenteral"),
        ("раствор для инфузий", "parenteral"),
        (
            "порошок для приготовления раствора для внутривенного и внутримышечного введения",
            "parenteral",
        ),
        ("лиофилизат для приготовления раствора для инъекций", "parenteral"),
        (
            "лиофилизат для приготовления концентрата для приготовления раствора для инфузий",
            "parenteral",
        ),
        ("концентрат для приготовления раствора для инфузий", "parenteral"),
        ("суспензия для внутримышечного введения пролонгированного действия", "parenteral"),
        ("раствор для интравитреального введения", "parenteral"),
        ("порошок для приготовления суспензии для приема внутрь", "oral-liquid"),
        ("гранулы для приготовления суспензии для приема внутрь", "oral-liquid"),
        ("капли для приема внутрь", "oral-liquid"),
        ("сироп", "oral-liquid"),
        ("раствор для приема внутрь", "oral-liquid"),
        ("капли глазные", "eye"),
        ("мазь глазная", "eye"),
        ("капли ушные", "ear"),
        ("спрей назальный дозированный", "nasal"),
        ("капли назальные", "nasal"),
        ("аэрозоль для ингаляций дозированный", "inhalation"),
        ("раствор для ингаляций", "inhalation"),
        ("порошок для ингаляций дозированный", "inhalation"),
        ("мазь для наружного применения", "topical"),
        ("крем", "topical"),
        ("гель для наружного применения", "topical"),
        ("раствор для наружного применения", "topical"),
        ("суппозитории ректальные", "rectal"),
        ("суппозитории вагинальные", "vaginal"),
        ("таблетки вагинальные", "vaginal"),
        ("система терапевтическая трансдермальная", "transdermal"),
        ("раствор для перитонеального диализа", "dialysis"),
        ("субстанция-порошок", "substance"),
        ("трава измельченная", "herbal"),
        ("", "other"),
    ],
)
def test_dosage_form_class(form: str, expected: FormClass) -> None:
    assert dosage_form_class(form) == expected


def test_inn_normalization_sorts_combination_parts() -> None:
    assert normalize_inn("Лозартан+Гидрохлоротиазид") == normalize_inn(
        "гидрохлоротиазид + лозартан"
    )
    assert normalize_inn("~") is None
    assert normalize_inn(None) is None
    assert normalize_inn("Ёлочная кислота") == "елочная кислота"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("# ОБЩАЯ ХАРАКТЕРИСТИКА ЛЕКАРСТВЕННОГО ПРЕПАРАТА\n1. НАИМЕНОВАНИЕ", "ohlp"),
        ("Листок-вкладыш – информация для пациента", "leaflet"),
        ("# ЛИСТОК-ВКЛАДЫШ # Информация для пациента", "leaflet"),
        (
            "# ИНСТРУКЦИЯ <!-- localmed:source {} --> по медицинскому применению",
            "national-instruction",
        ),
        ("Инструкция по применению лекарственного препарата", "national-instruction"),
        ("Состав: действующее вещество", "unknown"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_document_kind(text: str | None, expected: DocumentKind) -> None:
    assert classify_document_kind(text) == expected


def record(
    number: str,
    inn: str,
    form: str,
    *,
    essential: bool = False,
    country: str = "Россия",
    registered: str = "01.01.2020",
) -> dict[str, object]:
    return {
        "registrationNumber": number,
        "inn": inn,
        "dosageForm": form,
        "status": "Действующий",
        "essentialDrug": "Да" if essential else "Нет",
        "holderCountry": country,
        "registrationDate": registered,
        "tradeName": number,
    }


def test_groups_split_by_form_class_and_skip_substances() -> None:
    groups = build_groups(
        [
            record("A", "ибупрофен", "таблетки"),
            record("B", "Ибупрофен", "таблетки, покрытые оболочкой"),
            record("C", "ибупрофен", "суспензия для приема внутрь"),
            record("D", "ибупрофен", "субстанция-порошок"),
            {**record("E", "ибупрофен", "таблетки"), "status": "Исключённый"},
        ]
    )
    sizes = {key.label(): len(group.members) for key, group in groups.items()}
    assert sizes == {"ибупрофен|oral-solid": 2, "ибупрофен|oral-liquid": 1}


def test_queue_picks_one_originator_per_uncovered_group_essential_first() -> None:
    records = [
        record("GEN1", "ибупрофен", "таблетки", registered="01.01.2015"),
        record("GEN2", "ибупрофен", "таблетки", registered="01.01.2010"),
        record("ORIG", "ибупрофен", "таблетки", country="Германия", registered="01.01.2018"),
        record("ESS1", "редкин", "раствор для инфузий", essential=True),
        record("ESS2", "редкин", "раствор для инфузий", essential=True),
        record("DONE", "покрыт", "таблетки"),
        record("NOINN1", "~", "трава измельченная"),
        record("BIGGER1", "второй", "капсулы"),
        record("BIGGER2", "второй", "капсулы"),
        record("BIGGER3", "второй", "капсулы"),
    ]
    plan = {
        "GEN1",
        "GEN2",
        "ORIG",
        "ESS1",
        "ESS2",
        "DONE",
        "NOINN1",
        "BIGGER1",
        "BIGGER2",
        "BIGGER3",
    }
    picks, stats = build_group_queue(records, plan, covered_numbers={"DONE"}, permanent_failures={})
    assert [(pick.registration_number, pick.essential) for pick in picks] == [
        ("ESS1", True),  # essential group first
        ("BIGGER1", False),  # then bigger groups
        ("ORIG", False),  # foreign originator beats the earlier generic
        ("NOINN1", False),  # INN-less tail last
    ]
    assert stats.groups_total == 5 and stats.groups_covered == 1
    assert stats.essential_groups_total == 1 and stats.essential_groups_covered == 0


def test_failed_representative_is_replaced_and_unreachable_groups_are_counted() -> None:
    records = [
        record("ORIG", "ибупрофен", "таблетки", country="Германия"),
        record("GEN", "ибупрофен", "таблетки"),
        record("LEGACY", "легаси", "таблетки"),
    ]
    picks, stats = build_group_queue(
        records, {"ORIG", "GEN"}, covered_numbers=set(), permanent_failures={"ORIG": 2}
    )
    assert [pick.registration_number for pick in picks] == ["GEN"]
    assert stats.unreachable_groups == 1


def test_second_pass_asks_for_ohlp_only_where_we_hold_just_a_leaflet() -> None:
    records = [
        record("LEAF-EAEU", "один", "таблетки", essential=True),
        record("HAS-OHLP", "два", "таблетки"),
        record("NATIONAL", "три", "таблетки"),
    ]
    kinds: dict[str, set[DocumentKind]] = {
        "LEAF-EAEU": {"leaflet"},
        "HAS-OHLP": {"leaflet", "ohlp"},
        "NATIONAL": {"national-instruction"},
    }
    picks, stats = build_group_queue(
        records,
        {"LEAF-EAEU", "HAS-OHLP", "NATIONAL"},
        covered_numbers={"LEAF-EAEU", "HAS-OHLP", "NATIONAL"},
        permanent_failures={},
        document_kinds=kinds,
        revisit_candidates={"LEAF-EAEU", "HAS-OHLP", "NATIONAL"},
    )
    assert [(pick.registration_number, pick.reason) for pick in picks] == [
        ("LEAF-EAEU", "ohlp-second-pass")
    ]
    assert stats.leaflet_only_groups == 1 and stats.groups_with_ohlp == 1


def test_current_documents_keep_newest_amendment_per_entry_and_both_eaeu_kinds() -> None:
    def doc(url: str, label: str, index: int) -> dict[str, object]:
        return {
            "url": url,
            "label": label,
            "instructionLabel": "x",
            "sourceName": "GRLS",
            "instructionIndex": index,
        }

    selected = select_current_documents(
        [
            doc("https://grls.rosminzdrav.ru/a0.pdf", "Изм. № 0, X, 2020", 0),
            doc("https://grls.rosminzdrav.ru/a2.pdf", "Изм. № 2, X, 2024", 0),
            doc("https://grls.rosminzdrav.ru/b.pdf", "Изм. № 1, X, 2024", 1),
            doc("https://grls.rosminzdrav.ru/c.pdf", "Изм. № 1, X, 2024", 1),
        ]
    )
    assert sorted(str(item["url"]).rsplit("/", 1)[1] for item in selected) == [
        "a2.pdf",
        "b.pdf",
        "c.pdf",
    ]
