"""Same-substance fallback (ADR-0023): strengths, form classes, levels, never across МНН."""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest

from localmed_ingest.substance_fallback import (
    FLAG_FORM_DIFFERS,
    FLAG_STRENGTH_DIFFERS,
    FLAG_STRENGTH_UNKNOWN,
    MAX_DONORS,
    DonorFacts,
    Registration,
    asset_payload,
    assign_fallbacks,
    best_kind,
    canonical_strength,
    card_registrations,
    parse_registry_date,
    relate,
)


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("500 мг", "500.0мг"),
        ("500 мг", "0.5 г"),
        ("500 мг", "0,5 г"),
        ("0.5 мкг", "0.0005 мг"),
        ("1 мг/мл", "1 мг/1 мл"),
        ("1 г", "1000 мг"),
        ("40 мг + 10 мг", "40 мг+10 мг"),
        ("40 мг и 10 мг", "40 мг + 10 мг"),
        ("5 мг/мл", "5.0 мг/мл"),
        ("10 %", "10 %"),
        ("100 МЕ/мл", "100 МЕ/мл"),
    ],
)
def test_equal_strengths_share_one_key(left: str, right: str) -> None:
    assert canonical_strength(left) == canonical_strength(right)
    assert canonical_strength(left) is not None


@pytest.mark.parametrize(
    ("left", "right"),
    [
        ("500 мг", "250 мг"),
        ("40 мг + 10 мг", "10 мг + 40 мг"),
        ("1 мг/мл", "2 мг/мл"),
        ("1 мг/мл", "1 мг"),
        ("10 %", "10 мг"),
        ("100 МЕ", "100 мг"),
        ("3 мг/3 мл", "1 мг/мл"),
    ],
)
def test_different_strengths_never_share_a_key(left: str, right: str) -> None:
    assert canonical_strength(left) != canonical_strength(right)


@pytest.mark.parametrize("value", [None, "", "НЕ УКАЗАНО", "не указано", "~", " - "])
def test_an_unstated_strength_is_none(value: str | None) -> None:
    assert canonical_strength(value) is None


def test_unknown_grammar_is_kept_as_text_so_identical_text_still_matches() -> None:
    assert canonical_strength("0.25/0.5/1 мг/доза") == canonical_strength("0.25/0.5/1 мг/доза")
    assert canonical_strength("0.25/0.5/1 мг/доза") != canonical_strength("0.5/0.5/1 мг/доза")


def card(
    card_id: str,
    nodes: list[dict[str, Any]],
) -> list[Registration]:
    return card_registrations(card_id, {"smnnNodes": nodes})


def node(
    code: str,
    form: str,
    strength: str,
    trades: list[tuple[str, str]],
    *,
    normalized: str | None = None,
) -> dict[str, Any]:
    return {
        "smnnCode": code,
        "dosageForm": form,
        "strength": strength,
        "tradeNames": [
            {
                "tradeName": name,
                "registrationNumber": number,
                "dosageForm": form,
                "strength": f"1.0 {strength}",
                "normalizedFormsStrengths": [normalized or f"{form} ({strength})"],
            }
            for name, number in trades
        ],
    }


def facts(kind: str = "national-instruction", **overrides: Any) -> DonorFacts:
    values: dict[str, Any] = {
        "source_class": "grls",
        "kind": kind,
        "foreign_holder": False,
        "registered_on": None,
    }
    values.update(overrides)
    return DonorFacts(**values)


def test_card_registrations_reads_the_normalized_form_and_strength() -> None:
    registrations = card(
        "esklp.mnn.ибупрофен",
        [node("n1", "ТАБЛЕТКИ", "200 мг", [("Нурофен", "R1")])],
    )
    assert [r.number for r in registrations] == ["R1"]
    (presentation,) = registrations[0].presentations
    assert presentation.form == "таблетки"
    assert presentation.form_class == "oral-solid"
    assert presentation.strength == canonical_strength("200 мг")


def test_a_registration_listed_in_two_nodes_keeps_both_presentations() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ТАБЛЕТКИ", "10 мг", [("А", "R1")]),
            node("n2", "ТАБЛЕТКИ", "20 мг", [("А", "R1")]),
        ],
    )
    assert len(registrations) == 1
    assert {p.strength for p in registrations[0].presentations} == {
        canonical_strength("10 мг"),
        canonical_strength("20 мг"),
    }


def test_level_one_is_same_form_and_same_strength() -> None:
    registrations = card(
        "esklp.mnn.ибупрофен",
        [node("n1", "ТАБЛЕТКИ", "200 мг", [("А", "R1"), ("Б", "R2")])],
    )
    target, donor = registrations
    assert relate(target, donor) == (1, 0)


def test_level_one_when_the_registry_splits_one_strength_into_two_nodes() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ТАБЛЕТКИ", "500 мг", [("А", "R1")]),
            node("n2", "ТАБЛЕТКИ", "0.5 г", [("Б", "R2")]),
        ],
    )
    assert relate(registrations[0], registrations[1]) == (1, 0)


def test_a_different_strength_is_level_two_with_a_flag() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ТАБЛЕТКИ", "200 мг", [("А", "R1")]),
            node("n2", "ТАБЛЕТКИ", "400 мг", [("Б", "R2")]),
        ],
    )
    assert relate(registrations[0], registrations[1]) == (2, FLAG_STRENGTH_DIFFERS)


def test_an_unstated_strength_is_never_the_same_strength() -> None:
    registrations = card(
        "esklp.mnn.x",
        [node("n1", "ЛИСТЬЯ", "НЕ УКАЗАНО", [("А", "R1"), ("Б", "R2")])],
    )
    assert relate(registrations[0], registrations[1]) == (2, FLAG_STRENGTH_UNKNOWN)


def test_the_same_strength_in_another_wording_of_the_form_is_level_two() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ТАБЛЕТКИ", "150 мг", [("А", "R1")]),
            node("n2", "КАПСУЛЫ", "150 мг", [("Б", "R2")]),
        ],
    )
    assert relate(registrations[0], registrations[1]) == (2, FLAG_FORM_DIFFERS)


def test_forms_of_another_class_never_relate() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ТАБЛЕТКИ", "10 мг", [("А", "R1")]),
            node("n2", "РАСТВОР ДЛЯ ВНУТРИВЕННОГО ВВЕДЕНИЯ", "10 мг", [("Б", "R2")]),
            node("n3", "МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ", "10 мг", [("В", "R3")]),
        ],
    )
    first, second, third = registrations
    assert relate(first, second) is None
    assert relate(first, third) is None
    assert relate(second, third) is None


def test_a_form_the_classifier_cannot_place_matches_only_exactly() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ГАЗ ДЛЯ ИНГАЛЯЦИЙ", "НЕ УКАЗАНО", [("А", "R1")]),
            node("n2", "ЧТО-ТО НЕЯСНОЕ", "5 мг", [("Б", "R2")]),
            node("n3", "ЧТО-ТО ИНОЕ", "5 мг", [("В", "R3")]),
        ],
    )
    assert relate(registrations[1], registrations[2]) is None


def test_never_across_an_mnn_even_for_identical_form_and_strength() -> None:
    first = card("esklp.mnn.ибупрофен", [node("n1", "ТАБЛЕТКИ", "200 мг", [("А", "R1")])])
    second = card("esklp.mnn.парацетамол", [node("n1", "ТАБЛЕТКИ", "200 мг", [("Б", "R2")])])
    assert relate(first[0], second[0]) is None
    entries = assign_fallbacks([*first, *second], {"R2": facts()})
    assert entries == {}


def test_a_combination_is_its_own_mnn_and_a_single_substance_is_no_donor_for_it() -> None:
    combination = card(
        "esklp.mnn.амоксициллин-клавулановая-кислота",
        [node("n1", "ТАБЛЕТКИ", "500 мг + 125 мг", [("А", "R1")])],
    )
    single = card("esklp.mnn.амоксициллин", [node("n1", "ТАБЛЕТКИ", "500 мг", [("Б", "R2")])])
    assert assign_fallbacks([*combination, *single], {"R2": facts()}) == {}


def test_a_registration_with_its_own_text_gets_no_fallback_and_is_a_donor() -> None:
    registrations = card(
        "esklp.mnn.x",
        [node("n1", "ТАБЛЕТКИ", "10 мг", [("А", "R1"), ("Б", "R2"), ("В", "R3")])],
    )
    entries = assign_fallbacks(registrations, {"R1": facts(), "R2": facts()})
    assert set(entries) == {"R3"}
    assert [number for number, _flags in entries["R3"].donors] == ["R1", "R2"]
    assert entries["R3"].level == 1


def test_level_two_is_used_only_when_level_one_has_no_donor() -> None:
    registrations = card(
        "esklp.mnn.x",
        [
            node("n1", "ТАБЛЕТКИ", "10 мг", [("А", "R1"), ("Б", "R2")]),
            node("n2", "ТАБЛЕТКИ", "20 мг", [("В", "R3")]),
        ],
    )
    entries = assign_fallbacks(registrations, {"R1": facts(), "R3": facts()})
    assert entries["R2"].level == 1
    assert entries["R2"].donors == (("R1", 0),)
    only_other = assign_fallbacks(registrations, {"R3": facts()})
    assert only_other["R1"].level == 2
    assert only_other["R1"].donors == (("R3", FLAG_STRENGTH_DIFFERS),)


def test_donors_are_ranked_by_source_class_kind_originator_date_then_number() -> None:
    registrations = card(
        "esklp.mnn.x",
        [node("n1", "ТАБЛЕТКИ", "10 мг", [(f"T{i}", f"R{i}") for i in range(1, 8)])],
    )
    donors = {
        "R1": facts("leaflet"),
        "R2": facts("national-instruction", source_class="manufacturer-site"),
        "R3": facts("ohlp", source_class="manufacturer-site"),
        "R4": facts("national-instruction", registered_on=date(2015, 1, 1)),
        "R5": facts("national-instruction", registered_on=date(2010, 1, 1)),
        "R6": facts("national-instruction", foreign_holder=True, registered_on=date(2020, 1, 1)),
    }
    entries = assign_fallbacks(registrations, donors)
    assert [number for number, _ in entries["R7"].donors] == ["R6", "R5", "R4", "R1"]
    assert len(entries["R7"].donors) == MAX_DONORS


def test_a_manufacturer_site_donor_never_outranks_a_grls_one() -> None:
    registrations = card(
        "esklp.mnn.x", [node("n1", "ТАБЛЕТКИ", "10 мг", [("А", "R1"), ("Б", "R2"), ("В", "R3")])]
    )
    donors = {
        "R1": facts("ohlp", source_class="manufacturer-site"),
        "R2": facts("leaflet"),
    }
    assert assign_fallbacks(registrations, donors)["R3"].donors[0][0] == "R2"


def test_best_kind_prefers_the_professional_text() -> None:
    assert best_kind(["leaflet", "ohlp"]) == "ohlp"
    assert best_kind(["leaflet", "national-instruction"]) == "national-instruction"
    assert best_kind([]) == "unknown"


def test_asset_shares_identical_donor_lists_and_points_registrations_at_them() -> None:
    registrations = card(
        "esklp.mnn.x", [node("n1", "ТАБЛЕТКИ", "10 мг", [(f"T{i}", f"R{i}") for i in range(1, 5)])]
    )
    entries = assign_fallbacks(registrations, {"R1": facts()})
    payload = asset_payload(entries, {"esklpEdition": "2026-08-28"})
    assert payload["schemaVersion"] == 1
    assert payload["groups"] == [{"level": 1, "donors": [["R1", 0]]}]
    assert payload["registrations"] == {"R2": 0, "R3": 0, "R4": 0}


def test_registry_dates_parse_only_in_the_registry_format() -> None:
    assert parse_registry_date("21.10.2005") == date(2005, 10, 21)
    assert parse_registry_date("2005-10-21") is None
    assert parse_registry_date("31.02.2005") is None
    assert parse_registry_date(None) is None
