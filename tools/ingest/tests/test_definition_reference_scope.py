from __future__ import annotations

import copy
from dataclasses import dataclass
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_scope import definition_scope


@dataclass(frozen=True)
class ExampleEntry:
    id: str
    coverage: str
    text_kind: str = "source-excerpt"
    kind: str = "term"


@pytest.mark.parametrize("coverage", ["definition", "explicit-definition"])
@pytest.mark.parametrize("kind", ["term", "symptom", "syndrome", "scale", "criterion_set"])
def test_definitions_remain_definition_candidates(coverage: str, kind: str) -> None:
    selected, report = definition_scope({"a": ExampleEntry("a", coverage, kind=kind)})
    assert selected == {"a"}
    assert report["definitionRecordsAfter"] == 1


@pytest.mark.parametrize(
    "coverage",
    [
        "definition-section",
        "contextual-definition",
        "criterion-list",
        "classification",
        "section-overview",
        "section-excerpt",
        "tool-description",
        "source-description",
        "cross-reference",
        "mention-only",
        "gloss",
    ],
)
def test_nondefinition_cards_do_not_pad_dictionary_count(coverage: str) -> None:
    selected, report = definition_scope({"a": ExampleEntry("a", coverage)})
    assert selected == set()
    assert report["excludedRecords"] == 1


@pytest.mark.parametrize("coverage", ["definition", "explicit-definition", "gloss"])
def test_lexical_source_is_not_promoted_by_a_default_coverage_label(coverage: str) -> None:
    selected, report = definition_scope(
        {"a": ExampleEntry("a", coverage, text_kind="source-gloss")}
    )
    assert selected == set()
    assert report["excludedByReason"] == {"lexical-gloss-not-clinical-definition": 1}


def test_history_and_empty_input_are_not_definitions() -> None:
    assert definition_scope({})[0] == set()
    entry = ExampleEntry("a", "definition", kind="history_note")
    assert definition_scope({"a": entry})[0] == set()


def test_source_variants_stay_separate_and_input_is_unchanged() -> None:
    entries = {
        "a": ExampleEntry("a", "definition"),
        "b": ExampleEntry("b", "explicit-definition"),
        "c": ExampleEntry("c", "mention-only"),
    }
    before = copy.deepcopy(entries)
    selected, report = definition_scope(entries)
    assert entries == before
    assert selected == {"a", "b"}
    assert report == definition_scope(dict(reversed(list(entries.items()))))[1]
    assert report["sourceRecordsBefore"] == 3
    assert report["definitionRecordsAfter"] == 2
    assert report["excludedEntries"] == [
        {"id": "c", "coverage": "mention-only", "reason": "not-a-standalone-definition"}
    ]


def test_mismatched_identity_is_rejected() -> None:
    with pytest.raises(ValueError, match="identity"):
        definition_scope({"a": ExampleEntry("b", "definition")})


def test_real_projection_retains_source_text_and_only_indexes_definitions(tmp_path: Path) -> None:
    import json
    import sqlite3

    from localmed_ingest.definition_reference_compact_pack import (
        build_compact_definition_reference,
    )
    from localmed_ingest.definition_reference_pack import Projection, digest, encoded, obj
    from test_definition_reference_pack import fixture

    payload = fixture()
    raw = encoded(payload)
    source_path = tmp_path / "source.json"
    source_path.write_text(raw, encoding="utf-8")
    full = Projection()
    full.add(payload, digest(raw))
    database = tmp_path / "definitions.db"
    report = build_compact_definition_reference(
        (source_path,),
        database,
        input_root=tmp_path,
        edition_id="fixture.definitions",
        version="1",
        built_at="2026-09-22",
        definitions_only=True,
    )
    assert source_path.read_text(encoding="utf-8") == raw
    assert report["entries"] == 1
    assert report["logicalRoundTripEqual"] is True
    assert obj(report["selection"])["sourceRecordsBefore"] == 2
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT id FROM knowledge_entities").fetchall() == [("fixture.second",)]
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (0,)
        for identifier, (_, chunk) in full.chunks.items():
            row = db.execute(
                "SELECT original_text, metadata_json FROM chunks WHERE id=?", (identifier,)
            ).fetchone()
            assert row is not None
            assert row[0] == chunk.original_text
            assert json.loads(row[1]) == chunk.metadata


def test_real_projection_validates_excluded_records_before_selection(tmp_path: Path) -> None:
    from localmed_ingest.definition_reference_pack import (
        build_definition_reference,
        encoded,
        obj,
        seq,
    )
    from test_definition_reference_pack import fixture

    payload = fixture()
    obj(seq(payload["terms"], 10)[0])["blockIds"] = [999999]
    source_path = tmp_path / "broken.json"
    source_path.write_text(encoded(payload), encoding="utf-8")
    with pytest.raises(ValueError, match="Dangling"):
        build_definition_reference(
            (source_path,),
            tmp_path / "must-not-exist.db",
            input_root=tmp_path,
            edition_id="fixture.definitions",
            version="1",
            built_at="2026-09-22",
            definitions_only=True,
        )
    assert not (tmp_path / "must-not-exist.db").exists()
