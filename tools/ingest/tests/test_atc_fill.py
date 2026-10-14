"""ATC code completion: parsing, normalisation, the rules of each source and the metadata patch."""

from __future__ import annotations

from typing import Any

import pytest

from localmed_ingest.atc_fill import (
    AtcNode,
    Candidate,
    InstructionCodes,
    atc_level,
    consensus_problems,
    coverage_row,
    decide_all,
    final_code,
    flatten_nsi_rows,
    form_class,
    inn_key,
    nodes_of_document,
    normalize_atc,
    nsi_options,
    nsi_substance_index,
    parse_instruction_atc,
    patch_metadata,
    stub_consensus,
)

CYR = "АВСЕНКМОРТХ"


def test_normalize_atc_levels_and_lookalikes() -> None:
    assert normalize_atc("N06BX03") == "N06BX03"
    assert normalize_atc(" n06 bx03 ") == "N06BX03"
    # Cyrillic С, А, Х typed on a Russian keyboard
    assert normalize_atc("С01ЕВ04") == "C01EB04"
    assert normalize_atc("N06ВХ") == "N06BX"
    # the letter O in digit positions is an OCR zero
    assert normalize_atc("NO6BXO3") == "N06BX03"
    assert normalize_atc("~") is None
    assert normalize_atc("") is None
    assert normalize_atc(None) is None
    assert normalize_atc("Z99AA01") is None
    assert normalize_atc("N06BX0") is None
    assert [atc_level(c) for c in ("N", "N06", "N06B", "N06BX", "N06BX03", None)] == [
        1,
        2,
        3,
        4,
        5,
        0,
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Фармакотерапевтическая группа: ...\nКод АТХ: C09AA05\nСостав", ["C09AA05"]),
        ("АТХ: С01ЕВ04.", ["C01EB04"]),
        ("(АТХ N06BX03)", ["N06BX03"]),
        ("Код АТХ: R03DC03Фармакотерапевтическая", ["R03DC03"]),
        ("АТХ: N06BX03, N06BX12 и N06BX13 далее текст", ["N06BX03", "N06BX12", "N06BX13"]),
        ("Код АТХ:\nJ01CR02\nпрочее", ["J01CR02"]),
        ("ATC code: N02BE01", []),  # the word «code» sits between marker and code
        ("Контроль штаммами ATCC 25922 и ATCC 29213", []),
        ("Код АТХ приведён в разделе 2", []),
        ("АТХ: N06BX0 (обрезано)", []),
        ("АТХ: N06BX03 и АТХ: N06BX03", ["N06BX03"]),
        ("АТХ: N06B текст", ["N06B"]),
        ("", []),
    ],
)
def test_parse_instruction_atc(text: str, expected: list[str]) -> None:
    assert parse_instruction_atc(text) == expected


def test_form_class_separates_routes() -> None:
    assert form_class("ТАБЛЕТКИ, ПОКРЫТЫЕ ОБОЛОЧКОЙ") == "oral-solid"
    assert form_class("КАПЛИ ГЛАЗНЫЕ") == "eye"
    assert form_class("МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ") == "topical"
    assert form_class("СУППОЗИТОРИИ РЕКТАЛЬНЫЕ") == "rectal"
    assert form_class("ТАБЛЕТКИ ВАГИНАЛЬНЫЕ") == "vaginal"
    assert form_class("РАСТВОР ДЛЯ ВНУТРИВЕННОГО ВВЕДЕНИЯ") == "injection"
    assert form_class("СБОР ИЗМЕЛЬЧЕННЫЙ") == "form:сбор измельченный"
    assert inn_key("Б+Ё") == inn_key("ё + б") == "б+е"


def node(
    key: str,
    inn: str,
    form: str,
    atc: str | None,
    registrations: tuple[str, ...] = (),
    module: str = "nervous-system",
) -> AtcNode:
    return AtcNode(
        document_id=f"esklp.mnn.{key.split('/')[0]}",
        smnn_code=key,
        module=module,
        inn=inn,
        form=form,
        original_raw=atc,
        original=normalize_atc(atc),
        registrations=frozenset(registrations),
    )


NSI_ROWS = flatten_nsi_rows(
    [
        [{"column": "ATC_CODE", "value": "N06BX03"}, {"column": "ATC_NAME", "value": "Пирацетам"}],
        [
            {"column": "ATC_CODE", "value": "H02AB09"},
            {"column": "ATC_NAME", "value": "Гидрокортизон"},
        ],
        [
            {"column": "ATC_CODE", "value": "D07AA02"},
            {"column": "ATC_NAME", "value": "Гидрокортизон"},
        ],
        [
            {"column": "ATC_CODE", "value": "S01BA02"},
            {"column": "ATC_NAME", "value": "Гидрокортизон"},
        ],
        [
            {"column": "ATC_CODE", "value": "C09DB01"},
            {"column": "ATC_NAME", "value": "Валсартан и амлодипин"},
        ],
        [{"column": "ATC_CODE", "value": "N06BX"}, {"column": "ATC_NAME", "value": "Другие"}],
    ]
)
NSI = nsi_substance_index(NSI_ROWS)


def single(nodes: list[AtcNode], target: str, docs: list[InstructionCodes] | None = None) -> Any:
    decisions = decide_all(nodes, docs or [], NSI)
    return next(d for d in decisions if d.node.smnn_code == target)


def test_nsi_index_only_level_five_and_combinations_in_any_order() -> None:
    assert NSI["пирацетам"] == frozenset({"N06BX03"})
    assert "другие" not in NSI
    assert nsi_options(("амлодипин", "валсартан"), NSI) == frozenset({"C09DB01"})
    assert nsi_options(("валсартан", "амлодипин"), NSI) == frozenset({"C09DB01"})
    assert nsi_options(("нет такого",), NSI) == frozenset()


def test_instruction_text_fills_a_missing_code_with_provenance() -> None:
    target = node("a/1", "ПИРАЦЕТАМ", "ТАБЛЕТКИ", "~", ("ЛП-1",))
    docs = [InstructionCodes("doc1", ("ЛП-1",), ("N06BX03",), ocr=False)]
    decision = single([target], "a/1", docs)
    assert (decision.status, decision.code) == ("filled", "N06BX03")
    # НСИ names the substance with the same single code, so it supports the instruction
    assert decision.sources == ["instruction-text", "registry-nsi"]


def test_same_inn_same_form_class_fills_and_other_form_is_not_used_for_route_dependent_inn() -> (
    None
):
    nodes = [
        node("h/1", "ГИДРОКОРТИЗОН", "ТАБЛЕТКИ", "H02AB09"),
        node("h/2", "ГИДРОКОРТИЗОН", "МАЗЬ ДЛЯ НАРУЖНОГО ПРИМЕНЕНИЯ", "D07AA02"),
        node("h/3", "ГИДРОКОРТИЗОН", "ТАБЛЕТКИ", "~"),
        node("h/4", "ГИДРОКОРТИЗОН", "КАПЛИ ГЛАЗНЫЕ", "~"),
    ]
    same_class = single(nodes, "h/3")
    assert (same_class.status, same_class.code) == ("filled", "H02AB09")
    assert same_class.sources == ["same-inn", "registry-nsi"]
    # no eye donor, and the МНН has three codes in the registry/НСИ: nothing is guessed
    eye = single(nodes, "h/4")
    assert eye.status == "ambiguous"
    assert eye.code is None
    assert eye.nsi_options == ["D07AA02", "H02AB09", "S01BA02"]


def test_other_form_donor_is_used_only_when_the_inn_has_one_code_everywhere() -> None:
    nodes = [
        node("p/1", "ПИРАЦЕТАМ", "ТАБЛЕТКИ", "N06BX03"),
        node("p/2", "ПИРАЦЕТАМ", "РАСТВОР ДЛЯ ВНУТРИВЕННОГО ВВЕДЕНИЯ", "~"),
    ]
    decision = single(nodes, "p/2")
    assert (decision.status, decision.code) == ("filled", "N06BX03")
    assert decision.sources[0] == "same-inn-other-form"
    split = [
        *nodes,
        node("p/3", "ПИРАЦЕТАМ", "ТАБЛЕТКИ ВАГИНАЛЬНЫЕ", "G01AX99"),
        node("p/4", "ПИРАЦЕТАМ", "КАПСУЛЫ", "~"),
    ]
    assert single(split, "p/2").status == "filled"  # an injection donor does not exist ...
    assert single(split, "p/4").sources[0] != "same-inn-other-form"  # ... the oral class has one


def test_node_with_its_own_full_code_ignores_a_donor_of_another_route() -> None:
    nodes = [
        node("q/1", "ПИРАЦЕТАМ", "КАПСУЛЫ", "N06BX03"),
        node("q/2", "ПИРАЦЕТАМ", "КАПЛИ ГЛАЗНЫЕ", "S01XA99"),
    ]
    assert single(nodes, "q/1").status == "confirmed"


def test_refines_a_group_stub_but_never_contradicts_it() -> None:
    stub = node("s/1", "ПИРАЦЕТАМ", "КАПСУЛЫ", "N06BX")
    donor = node("s/2", "ПИРАЦЕТАМ", "КАПСУЛЫ", "N06BX03")
    refined = single([stub, donor], "s/1")
    assert (refined.status, refined.code) == ("refined", "N06BX03")
    other = node("s/3", "ПИРАЦЕТАМ", "КАПСУЛЫ", "C09AA05")
    contradicted = single([stub, other], "s/1")
    assert contradicted.status == "conflict"
    assert final_code(contradicted) == "N06BX"


def test_disagreement_with_a_full_registry_code_is_flagged_not_applied() -> None:
    target = node("m/1", "МЕТИЛДОПА", "ТАБЛЕТКИ", "C02AB01", ("ЛП-9",))
    docs = [InstructionCodes("doc9", ("ЛП-9",), ("C02AB02",), ocr=False)]
    decision = single([target], "m/1", docs)
    assert decision.status == "conflict"
    assert final_code(decision) == "C02AB01"
    assert {c.code for c in decision.candidates} == {"C02AB01", "C02AB02"}


def test_nsi_conflict_with_registry_and_ambiguous_nsi_with_group_stub() -> None:
    # НСИ names the substance only with other codes
    off = single([node("v/1", "ПИРАЦЕТАМ", "КАПСУЛЫ", "N06BX99")], "v/1")
    assert off.status == "conflict"
    assert off.nsi_options == ["N06BX03"]
    # a stub that several НСИ codes extend is not resolved
    many = single([node("g/1", "ГИДРОКОРТИЗОН", "ТАБЛЕТКИ", "D07AA")], "g/1")
    assert many.status == "refined"
    assert many.code == "D07AA02"
    broad = single([node("g/2", "ГИДРОКОРТИЗОН", "ТАБЛЕТКИ", "D")], "g/2")
    assert broad.status == "conflict" or broad.status == "refined"


def test_ocr_instruction_needs_a_second_source() -> None:
    target = node("o/1", "НЕИЗВЕСТНЫЙ", "ТАБЛЕТКИ", "~", ("ЛП-5",))
    ocr = [InstructionCodes("docO", ("ЛП-5",), ("N06BX03",), ocr=True)]
    alone = single([target], "o/1", ocr)
    assert alone.status == "unconfirmed"
    assert final_code(alone) is None
    donor = node("o/2", "НЕИЗВЕСТНЫЙ", "ТАБЛЕТКИ", "N06BX03")
    both = single([target, donor], "o/1", ocr)
    assert (both.status, both.code) == ("filled", "N06BX03")
    assert both.sources == ["same-inn", "instruction-text-ocr"]


def test_same_inn_instruction_donor_from_another_registration() -> None:
    target = node("i/1", "НЕИЗВЕСТНЫЙ", "ТАБЛЕТКИ", "~", ("ЛП-1",))
    other = node("i/2", "НЕИЗВЕСТНЫЙ", "ТАБЛЕТКИ", "~", ("ЛП-2",))
    docs = [InstructionCodes("doc2", ("ЛП-2",), ("N06BX03",), ocr=False)]
    decision = single([target, other], "i/1", docs)
    assert decision.sources == ["same-inn-instruction"]
    assert decision.code == "N06BX03"


def test_nothing_to_go_on_is_left_alone() -> None:
    decision = single([node("n/1", "ЗВЕРОБОЯ ТРАВА", "ТРАВА", "~")], "n/1")
    assert decision.status == "unresolved"
    assert final_code(decision) is None
    confirmed = single([node("n/2", "ПИРАЦЕТАМ", "КАПСУЛЫ", "N06BX03")], "n/2")
    assert confirmed.status == "confirmed"
    assert confirmed.sources == ["esklp", "registry-nsi"]


def card_metadata() -> dict[str, Any]:
    return {
        "atcCodes": ["~", "C02AB01"],
        "smnnNodes": [
            {
                "smnnCode": "x/1",
                "standardizedInn": "ПИРАЦЕТАМ",
                "dosageForm": "КАПСУЛЫ",
                "atcCode": "~",
                "tradeNames": [{"registrationNumber": "ЛП-1"}],
            },
            {
                "smnnCode": "x/2",
                "standardizedInn": "МЕТИЛДОПА",
                "dosageForm": "ТАБЛЕТКИ",
                "atcCode": "C02AB01",
                "tradeNames": [{"registrationNumber": "ЛП-9"}],
            },
        ],
    }


def test_patch_metadata_records_provenance_and_flags_conflicts() -> None:
    metadata = card_metadata()
    nodes = nodes_of_document("esklp.mnn.x", "nervous-system", metadata)
    docs = [
        InstructionCodes("doc1", ("ЛП-1",), ("N06BX03",), ocr=False),
        InstructionCodes("doc9", ("ЛП-9",), ("C02AB02",), ocr=False),
    ]
    decisions = {d.node.key: d for d in decide_all(nodes, docs, NSI)}
    patched, changed = patch_metadata(metadata, decisions, "esklp.mnn.x")
    assert changed == 1
    filled, flagged = patched["smnnNodes"]
    assert filled["atcCode"] == "N06BX03"
    assert filled["atcOriginal"] == "~"
    assert filled["atcSource"] == "instruction-text"
    assert filled["atcSources"] == ["instruction-text", "registry-nsi"]
    assert flagged["atcCode"] == "C02AB01"
    assert flagged["atcFlag"] == "conflict"
    assert flagged["atcCandidates"] == [
        {"code": "C02AB01", "sources": ["esklp"]},
        {"code": "C02AB02", "sources": ["instruction-text"]},
    ]
    assert patched["atcCodes"] == ["N06BX03", "C02AB01"]
    assert patched["atcFill"]["filledNodes"] == 1
    assert patched["atcFill"]["flaggedNodes"] == 1
    assert patched["atcFill"]["codeSources"] == {"N06BX03": ["instruction-text", "registry-nsi"]}
    # the input is untouched, and a card without a decision is returned equal
    assert metadata == card_metadata()
    assert patch_metadata(metadata, {}, "esklp.mnn.x") == (metadata, 0)


def test_flag_only_card_keeps_its_code_list() -> None:
    metadata = card_metadata()
    metadata["smnnNodes"][0]["standardizedInn"] = "ЗВЕРОБОЯ ТРАВА"
    nodes = nodes_of_document("esklp.mnn.x", "nervous-system", metadata)
    docs = [InstructionCodes("doc9", ("ЛП-9",), ("C02AB02",), ocr=False)]
    decisions = {d.node.key: d for d in decide_all(nodes, docs, NSI)}
    patched, changed = patch_metadata(metadata, decisions, "esklp.mnn.x")
    assert changed == 0
    assert patched["atcCodes"] == ["~", "C02AB01"]
    assert patched["smnnNodes"][0]["atcCode"] == "~"
    assert patched["smnnNodes"][1]["atcFlag"] == "conflict"


def test_coverage_row_shares() -> None:
    row = coverage_row([0, 0, 4, 5, 5])
    assert row["total"] == 5
    assert (row["anyCode"], row["levelAtLeast4"], row["level5"]) == (3, 3, 2)
    assert row["level5Pct"] == 40.0
    assert coverage_row([])["anyCodePct"] == 0.0


# --------------------------------------------------------------------------------------------
# Consensus against a group stub (ATC3: the registry value stays, the agreed code is recorded)
# --------------------------------------------------------------------------------------------


def stub_with(
    donor_code: str | None, instruction_codes: tuple[str, ...] = (), ocr: bool = False
) -> Any:
    """A stub node, an optional same-МНН donor with a full code, optional instruction codes."""
    target = node("u/1", "УМИФЕНОВИР", "ТАБЛЕТКИ", "L03AX", ("ЛП-1",))
    nodes = [target]
    if donor_code is not None:
        nodes.append(node("u/2", "УМИФЕНОВИР", "ТАБЛЕТКИ", donor_code))
    docs = (
        [InstructionCodes("doc1", ("ЛП-1",), instruction_codes, ocr=ocr)]
        if instruction_codes
        else []
    )
    return single(nodes, "u/1", docs)


def test_registry_and_instruction_agreeing_on_a_full_code_make_a_consensus() -> None:
    decision = stub_with("J05AX13", ("J05AX13",))
    assert decision.status == "conflict"
    # the registry value stays official: nothing is applied
    assert decision.code is None
    assert final_code(decision) == "L03AX"
    assert decision.consensus is not None
    assert decision.consensus.code == "J05AX13"
    assert decision.consensus.sources == ("instruction-text", "same-inn")


def test_a_consensus_is_not_made_from_one_source_kind() -> None:
    donor_only = stub_with("J05AX13")
    assert donor_only.status == "conflict"
    assert donor_only.consensus is None
    instruction_only = stub_with(None, ("J05AX13",))
    assert instruction_only.status == "conflict"
    assert instruction_only.consensus is None
    # two instructions are still one kind of evidence
    target = node("u/1", "УМИФЕНОВИР", "ТАБЛЕТКИ", "L03AX", ("ЛП-1", "ЛП-2"))
    docs = [
        InstructionCodes("doc1", ("ЛП-1",), ("J05AX13",), ocr=False),
        InstructionCodes("doc2", ("ЛП-2",), ("J05AX13",), ocr=False),
    ]
    assert single([target], "u/1", docs).consensus is None


def test_ocr_text_alone_is_no_consensus_but_corroborates_another_kind() -> None:
    assert stub_with(None, ("J05AX13",), ocr=True).consensus is None
    # the OCR instruction and the same МНН elsewhere in ЕСКЛП: two kinds, one self-sufficient
    corroborated = stub_with("J05AX13", ("J05AX13",), ocr=True)
    assert corroborated.consensus is not None
    assert corroborated.consensus.sources == ("same-inn", "instruction-text-ocr")


def test_disagreeing_sources_make_no_consensus() -> None:
    # two different full codes outside the stub
    assert stub_with("J05AX13", ("J05AX12",)).consensus is None
    # an instruction that names another group
    assert stub_with("J05AX13", ("D06AX",)).consensus is None
    # a source that only repeats the stub votes for nothing, so it makes no consensus alone ...
    assert stub_with("J05AX13", ("L03AX",)).consensus is None
    # ... and, like one that stops at the group the full code belongs to, does not veto one
    target = node("u/1", "УМИФЕНОВИР", "ТАБЛЕТКИ", "L03AX", ("ЛП-1", "ЛП-2", "ЛП-3"))
    donor = node("u/2", "УМИФЕНОВИР", "ТАБЛЕТКИ", "J05AX13")
    docs = [
        InstructionCodes("doc1", ("ЛП-1",), ("J05AX13",), ocr=False),
        InstructionCodes("doc2", ("ЛП-2",), ("L03AX",), ocr=False),
        InstructionCodes("doc3", ("ЛП-3",), ("J05AX",), ocr=False),
    ]
    neutral = single([target, donor], "u/1", docs)
    assert neutral.consensus is not None
    assert neutral.consensus.code == "J05AX13"


def test_consensus_needs_a_registry_group_stub() -> None:
    # a full registry code that other sources contradict is a plain conflict
    full = single(
        [
            node("f/1", "УМИФЕНОВИР", "ТАБЛЕТКИ", "L03AX13", ("ЛП-1",)),
            node("f/2", "УМИФЕНОВИР", "ТАБЛЕТКИ", "J05AX13"),
        ],
        "f/1",
        [InstructionCodes("doc1", ("ЛП-1",), ("J05AX13",), ocr=False)],
    )
    assert full.status == "conflict"
    assert full.consensus is None
    # no registry code at all: the agreed code is simply applied
    none = single(
        [
            node("n/1", "УМИФЕНОВИР", "ТАБЛЕТКИ", "~", ("ЛП-1",)),
            node("n/2", "УМИФЕНОВИР", "ТАБЛЕТКИ", "J05AX13"),
        ],
        "n/1",
        [InstructionCodes("doc1", ("ЛП-1",), ("J05AX13",), ocr=False)],
    )
    assert none.status == "filled"
    assert none.consensus is None


def test_stub_consensus_ignores_the_registry_candidate_and_the_nsi_options() -> None:
    candidates = [
        Candidate("L03AX", "esklp"),
        Candidate("J05AX13", "same-inn"),
        Candidate("J05AX13", "same-inn-instruction"),
    ]
    found = stub_consensus("L03AX", candidates)
    assert found is not None
    assert (found.code, found.sources) == ("J05AX13", ("same-inn", "same-inn-instruction"))
    assert stub_consensus("L03AX13", candidates) is None
    assert stub_consensus(None, candidates) is None
    assert stub_consensus("L03AX", candidates[:2]) is None


def test_consensus_is_recorded_beside_the_registry_code() -> None:
    metadata: dict[str, Any] = {
        "atcCodes": ["L03AX"],
        "smnnNodes": [
            {
                "smnnCode": "u/1",
                "standardizedInn": "УМИФЕНОВИР",
                "dosageForm": "ТАБЛЕТКИ",
                "atcCode": "L03AX",
                "tradeNames": [{"registrationNumber": "ЛП-1"}],
            },
            {
                "smnnCode": "u/2",
                "standardizedInn": "УМИФЕНОВИР",
                "dosageForm": "ТАБЛЕТКИ",
                "atcCode": "J05AX13",
            },
        ],
    }
    nodes = nodes_of_document("esklp.mnn.u", "antiinfectives", metadata)
    docs = [InstructionCodes("doc1", ("ЛП-1",), ("J05AX13",), ocr=False)]
    decisions = {d.node.key: d for d in decide_all(nodes, docs, NSI)}
    patched, changed = patch_metadata(metadata, decisions, "esklp.mnn.u")
    assert changed == 0
    stub_node, donor_node = patched["smnnNodes"]
    assert stub_node["atcCode"] == "L03AX"
    assert "atcOriginal" not in stub_node
    assert stub_node["atcFlag"] == "conflict"
    assert stub_node["atcConsensus"] == {
        "code": "J05AX13",
        "sources": ["instruction-text", "same-inn"],
    }
    assert "atcConsensus" not in donor_node
    assert patched["atcCodes"] == ["L03AX"]
    assert patched["atcConsensusCodes"] == ["J05AX13"]
    assert patched["atcFill"]["consensusNodes"] == 1
    assert patched["atcFill"]["version"] == "atc-fill-1"


def consensus_card(**overrides: Any) -> dict[str, Any]:
    node: dict[str, Any] = {
        "smnnCode": "u/1",
        "atcCode": "L03AX",
        "atcFlag": "conflict",
        "atcConsensus": {"code": "J05AX13", "sources": ["instruction-text", "same-inn"]},
    }
    node.update(overrides)
    return {"atcConsensusCodes": ["J05AX13"], "smnnNodes": [node]}


def test_consensus_problems_accepts_a_well_formed_node_and_names_each_defect() -> None:
    assert consensus_problems(consensus_card(), "esklp.mnn.u") == []
    assert consensus_problems({"smnnNodes": [{"atcCode": "L03AX"}]}) == []
    bad_code = consensus_card(atcConsensus={"code": "J05AX", "sources": ["same-inn", "x"]})
    assert "not a level-5" in consensus_problems(bad_code)[0]
    one_source = consensus_card(atcConsensus={"code": "J05AX13", "sources": ["same-inn"]})
    assert "two or more" in consensus_problems(one_source)[0]
    one_kind = consensus_card(
        atcConsensus={"code": "J05AX13", "sources": ["instruction-text", "same-inn-instruction"]}
    )
    assert "one kind" in consensus_problems(one_kind)[0]
    assert "not a stub" in consensus_problems(consensus_card(atcCode="L03AX13"))[0]
    assert "atcFlag" in consensus_problems(consensus_card(atcFlag="ambiguous"))[0]
    unlisted = consensus_card()
    unlisted["atcConsensusCodes"] = []
    assert "atcConsensusCodes" in consensus_problems(unlisted)[0]
