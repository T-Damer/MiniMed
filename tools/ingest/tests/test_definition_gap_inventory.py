"""Synthetic coverage checks; no medical assertions or live web dependencies."""

from __future__ import annotations

from copy import deepcopy

from localmed_ingest.definition_gap_inventory import build_gap_inventory
from localmed_ingest.definition_reference_pack import Entry, Projection, obj, seq


def entry(
    identifier: str,
    title: str = "Тестовое понятие",
    coverage: str = "needs-definition",
    *,
    text_kind: str = "source-excerpt",
    kind: str = "term",
) -> Entry:
    return Entry(identifier, title, kind, [title], coverage, text_kind, [], "a" * 64)


def projection(*entries: Entry) -> Projection:
    result = Projection()
    result.entries = {item.id: item for item in entries}
    return result


def test_empty_projection_has_no_invented_gaps() -> None:
    report = build_gap_inventory(projection())
    assert report["sourceRecords"] == report["definitionRecords"] == 0
    assert report["pendingRecords"] == report["pendingNormalizedTitles"] == 0
    assert report["rows"] == []


def test_unique_pending_identity_is_ready_for_research_not_approved() -> None:
    report = build_gap_inventory(projection(entry("pending-one")))
    assert report["definitionRecords"] == 0
    assert report["byStatusRecords"] == {"ready-for-source-research": 1}
    row = obj(seq(report["rows"], 10)[0])
    assert row["status"] == "ready-for-source-research"
    assert row["sameTitleDefinitionIds"] == []
    pending = obj(seq(row["pendingIdentities"], 10)[0])
    assert pending == {
        "id": "pending-one",
        "title": "Тестовое понятие",
        "kind": "term",
        "discoveryReceipt": "a" * 64,
    }


def test_normalized_title_overlap_requires_sense_review_and_keeps_ids() -> None:
    report = build_gap_inventory(
        projection(
            entry("pending", "\u00a0ОТЁК\u00a0"),
            entry("defined", "отек", "explicit-definition"),
        )
    )
    assert report["pendingRecords"] == 1
    assert report["definitionRecords"] == 1
    assert report["byStatusTitles"] == {"same-title-definition-needs-sense-review": 1}
    row = obj(seq(report["rows"], 10)[0])
    assert row["sameTitleDefinitionIds"] == ["defined"]
    assert obj(seq(row["pendingIdentities"], 10)[0])["title"] == "\u00a0ОТЁК\u00a0"


def test_ambiguous_sources_are_not_silently_merged() -> None:
    report = build_gap_inventory(projection(entry("second"), entry("first")))
    assert report["pendingRecords"] == 2
    assert report["pendingNormalizedTitles"] == 1
    assert report["byStatusRecords"] == {"ambiguous-discovered-title": 2}
    assert report["byStatusTitles"] == {"ambiguous-discovered-title": 1}
    row = obj(seq(report["rows"], 10)[0])
    assert [obj(item)["id"] for item in seq(row["pendingIdentities"], 10)] == [
        "first",
        "second",
    ]


def test_source_gloss_and_context_do_not_discharge_definition_debt() -> None:
    report = build_gap_inventory(
        projection(
            entry("pending"),
            entry("gloss", coverage="definition", text_kind="source-gloss"),
            entry("context", coverage="contextual-definition"),
            entry("mention", coverage="mention-only"),
        )
    )
    assert report["sourceRecords"] == 4
    assert report["definitionRecords"] == 0
    assert report["byStatusRecords"] == {"ready-for-source-research": 1}


def test_alias_overlap_is_not_title_identity() -> None:
    defined = entry("defined", "Иное понятие", "definition")
    defined.names.append("Тестовое понятие")
    report = build_gap_inventory(projection(entry("pending"), defined))
    assert report["byStatusRecords"] == {"ready-for-source-research": 1}


def test_same_title_different_kind_is_review_not_equivalence() -> None:
    report = build_gap_inventory(
        projection(entry("pending", kind="scale"), entry("defined", coverage="definition"))
    )
    assert report["byStatusRecords"] == {"same-title-definition-needs-sense-review": 1}
    row = obj(seq(report["rows"], 10)[0])
    assert obj(seq(row["pendingIdentities"], 10)[0])["kind"] == "scale"


def test_inventory_is_deterministic_and_does_not_mutate_projection() -> None:
    first = entry("z", "Явление")
    second = entry("a", "Аспект")
    original = projection(first, second)
    before = deepcopy(original.entries)
    report = build_gap_inventory(original)
    assert report == build_gap_inventory(projection(second, first))
    assert original.entries == before
    assert report["pendingRecords"] == sum(obj(report["byStatusRecords"]).values())
