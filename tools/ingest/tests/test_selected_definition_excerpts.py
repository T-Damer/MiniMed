from __future__ import annotations

import copy
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_pack import Projection, digest, encoded, obj, seq
from localmed_ingest.selected_definition_excerpts import FORMAT, compile_selected_definitions


def fixture() -> dict[str, object]:
    return {
        "format": FORMAT,
        "id": "fixture.selected-definitions",
        "inspectedAt": "2026-09-23",
        "sources": [{
            "id": 1, "title": "Synthetic teaching source",
            "baseUrl": "https://example.org/medical/", "sourceType": "fixture",
            "authority": "third-party", "releaseEligible": False,
            "rightsStatus": "requires-review", "language": "ru",
        }],
        "entries": [{
            "id": "medical.definition.example", "title": "Учебный пример", "kind": "term",
            "aliases": [], "source": 1, "path": "example", "definition": "Учебный пример — это вымышленное объяснение для проверки программы.",
            "locator": "First sentence, synthetic text", "authors": [], "reviewers": [],
            "sourceUpdated": None, "classification": None, "population": None,
        }],
    }


def entry(payload: dict[str, object]) -> dict[str, object]:
    return obj(seq(payload["entries"], 500)[0])


def source(payload: dict[str, object]) -> dict[str, object]:
    return obj(seq(payload["sources"], 32)[0])


def test_exact_sentence_and_explicit_acquisition_limits() -> None:
    payload = fixture()
    original = copy.deepcopy(payload)
    catalog, report = compile_selected_definitions(payload)
    assert payload == original
    block = obj(seq(catalog["blocks"], 100)[0])
    assert block["text"] == entry(payload)["definition"]
    assert block["textSha256"] == digest(str(block["text"]))
    assert block["fullPageSnapshotAvailable"] is False
    assert block["acquisitionMethod"] == "inspected-web-excerpt"
    assert block["medicalReview"] == "requires-review"
    assert block["sourceUpdated"] is None
    term = obj(seq(catalog["terms"], 100)[0])
    assert term["coverage"] == "definition"
    assert term["blockIds"] == [1]
    assert "detailBlocks" not in term
    assert report["candidates"] == report["selectedDefinitions"] == 1
    assert report["newInstruments"] == 0


@pytest.mark.parametrize("existing", ["Учебный пример", "УЧЕБНЫЙ ПРИМЕР", "  учебный   пример  "])
def test_already_named_definitions_are_deferred_not_overwritten(existing: str) -> None:
    payload = fixture()
    original = copy.deepcopy(payload)
    catalog, report = compile_selected_definitions(payload, [existing])
    assert payload == original
    assert catalog["terms"] == []
    assert catalog["blocks"] == []
    assert catalog["sources"] == []
    deferred = seq(report["deferred"], 100)
    assert len(deferred) == 1
    assert obj(deferred[0])["reason"] == "existing-definition-name-needs-sense-review"


def test_different_title_is_not_an_inferred_synonym() -> None:
    catalog, _ = compile_selected_definitions(fixture(), ["Другой пример"])
    assert len(seq(catalog["terms"], 100)) == 1


def test_only_source_evidenced_alias_is_admitted() -> None:
    payload = fixture()
    entry(payload)["definition"] = "Учебный пример (тест) — это вымышленное объяснение для проверки программы."
    entry(payload)["aliases"] = ["Тест"]
    catalog, _ = compile_selected_definitions(payload)
    assert obj(seq(catalog["terms"], 100)[0])["aliases"] == ["Тест"]
    entry(payload)["aliases"] = ["Выдуманный синоним"]
    with pytest.raises(ValueError, match="Alias"):
        compile_selected_definitions(payload)


@pytest.mark.parametrize("field,value", [
    ("source", 99), ("path", "../private"), ("path", "https://other.example/test"),
    ("path", "example#unknown"), ("definition", "Incomplete source"),
    ("definition", "Обрезанная часть…"), ("definition", " ".join(["слово"] * 26) + "."),
    ("kind", "scale"), ("sourceUpdated", "2026-19"),
    ("id", "broken id"), ("aliases", ["unsupported name"]),
    ("score", "arbitrary scoring instructions"),
])
def test_invalid_or_unwanted_content_is_rejected_even_when_title_would_defer(
    field: str, value: object,
) -> None:
    payload = fixture()
    entry(payload)[field] = value
    with pytest.raises(ValueError):
        compile_selected_definitions(payload, ["Учебный пример"])


@pytest.mark.parametrize("field,value", [
    ("releaseEligible", True), ("rightsStatus", "cleared"), ("language", "en"),
    ("authority", "clinically-approved"), ("baseUrl", "http://example.org/"),
])
def test_source_family_never_automatically_promotes_medical_or_release_state(
    field: str, value: object,
) -> None:
    payload = fixture()
    source(payload)[field] = value
    with pytest.raises(ValueError):
        compile_selected_definitions(payload)


def test_duplicate_titles_and_source_ids_are_rejected() -> None:
    payload = fixture()
    duplicate = copy.deepcopy(entry(payload))
    duplicate["id"] = "medical.definition.another"
    seq(payload["entries"], 500).append(duplicate)
    with pytest.raises(ValueError, match="per title"):
        compile_selected_definitions(payload)
    payload = fixture()
    seq(payload["sources"], 32).append(copy.deepcopy(source(payload)))
    with pytest.raises(ValueError, match="Duplicate"):
        compile_selected_definitions(payload)


def test_multiple_sentences_from_one_page_share_the_quote_budget() -> None:
    payload = fixture()
    first = entry(payload)
    first["definition"] = " ".join(["слово"] * 15) + "."
    second = copy.deepcopy(first)
    second["id"] = "medical.definition.other"
    second["title"] = "Иное понятие"
    seq(payload["entries"], 500).append(second)
    with pytest.raises(ValueError, match="budget"):
        compile_selected_definitions(payload)


def test_real_numeric_pack_preserves_source_text_and_provenance(tmp_path: Path) -> None:
    from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference

    payload = fixture()
    catalog, _ = compile_selected_definitions(payload)
    raw = encoded(catalog)
    prepared = tmp_path / "selected.json"
    prepared.write_text(raw, encoding="utf-8")
    projection = Projection()
    projection.add(catalog, digest(raw))
    database = tmp_path / "selected.db"
    report = build_compact_definition_reference(
        (prepared,), database, input_root=tmp_path, edition_id="fixture.reference",
        version="1", built_at="2026-09-23", definitions_only=True,
    )
    assert report["entries"] == 1
    assert report["logicalRoundTripEqual"] is True
    with sqlite3.connect(database) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT id FROM knowledge_entities").fetchall() == [
            ("medical.definition.example",)
        ]
        for table in ("knowledge_facts", "knowledge_relations"):
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
        for identifier, (_, chunk) in projection.chunks.items():
            row = db.execute(
                "SELECT original_text, metadata_json FROM chunks WHERE id = ?", (identifier,),
            ).fetchone()
            assert row is not None
            assert row[0] == chunk.original_text
            assert json.loads(row[1]) == chunk.metadata


def test_inspected_authoring_batch_obeys_the_same_contract() -> None:
    root = Path(__file__).resolve().parents[3]
    payload = json.loads(
        (root / "content/reference-authoring/medical-definitions-2026.09.23.json").read_bytes()
    )
    catalog, report = compile_selected_definitions(payload)
    assert report["candidates"] == 25
    assert report["selectedDefinitions"] == 25
    assert report["maximumWordsPerPage"] <= 25
    projection = Projection()
    projection.add(catalog, digest(encoded(catalog)))
    assert len(projection.entries) == 25
    assert len(projection.chunks) == 25
