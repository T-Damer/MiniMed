from __future__ import annotations

import copy
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.definition_name_inventory import (
    FORMAT,
    add_name_inventory,
    read_name_manifest,
)
from localmed_ingest.definition_reference_pack import Projection, digest, encoded, obj, seq
from test_definition_reference_pack import fixture


def inventory() -> dict[str, object]:
    return {
        "format": FORMAT,
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "purpose": "discovery-only",
        "inputReceipts": [],
        "sources": [
            {
                "id": 1,
                "title": "Source of name only",
                "baseUrl": "https://ru.wikipedia.org/wiki/",
                "releaseEligible": False,
            }
        ],
        "names": [
            {
                "id": "ruwiki.definition.fixture",
                "title": "Тестовый термин",
                "aliases": ["Другое имя"],
                "kind": "term",
                "source": 1,
                "path": "Test",
                "locator": "Archived page 1",
                "inputSha256": "a" * 64,
            }
        ],
    }


def test_name_is_searchable_but_is_not_a_definition(tmp_path: Path) -> None:
    p = Projection()
    original = fixture()
    p.add(original, "b" * 64)
    payload = inventory()
    before = copy.deepcopy(payload)
    assert add_name_inventory(p, payload, "c" * 64) == 1
    assert payload == before
    entry = p.entries["ruwiki.definition.fixture"]
    assert entry.coverage == "needs-definition"
    assert [role for role, _ in entry.links] == ["annotation"]
    dbfile = tmp_path / "reference.db"
    p.build(dbfile, edition_id="test.names", version="1", built_at="2026-09-23")
    with sqlite3.connect(dbfile) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute(
            "SELECT entity_id FROM knowledge_fts WHERE knowledge_fts MATCH ?", ("Другое",)
        ).fetchall() == [("ruwiki.definition.fixture",)]
        assert db.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (0,)
        assert db.execute(
            "SELECT count(*) FROM definition_reference_fts "
            "WHERE definition_reference_fts MATCH ?",
            ("Archived",),
        ).fetchone() == (0,)


@pytest.mark.parametrize(
    "field,value",
    [
        ("definition", "Not permitted medical prose"),
        ("id", "fixture.first"),
        ("source", 999),
        ("path", "../outside"),
        ("inputSha256", "broken"),
    ],
)
def test_invalid_name_rejected_before_projection_mutation(field: str, value: object) -> None:
    p = Projection()
    p.add(fixture(), "b" * 64)
    before = (len(p.entries), len(p.sources), len(p.chunks))
    payload = inventory()
    obj(seq(payload["names"], 10)[0])[field] = value
    with pytest.raises((ValueError, KeyError)):
        add_name_inventory(p, payload, "c" * 64)
    assert before == (len(p.entries), len(p.sources), len(p.chunks))


def test_two_names_do_not_establish_same_as() -> None:
    payload = inventory()
    other = copy.deepcopy(obj(seq(payload["names"], 10)[0]))
    other["id"] = "ruwiki.definition.other"
    seq(payload["names"], 10).append(other)
    p = Projection()
    assert add_name_inventory(p, payload, "c" * 64) == 2
    assert len(p.entries) == 2


def test_manifest_checksum_is_required(tmp_path: Path) -> None:
    root = tmp_path / "content/definition-drafts"
    root.mkdir(parents=True)
    raw = encoded(inventory())
    (root / "names.json").write_text(raw, encoding="utf-8")
    manifest = {
        "format": FORMAT,
        "path": "content/definition-drafts/names.json",
        "bytes": len(raw.encode()),
        "sha256": digest(raw),
    }
    path = root / "name-inputs.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    assert read_name_manifest(tmp_path) == (root / "names.json",)
    (root / "names.json").write_text(raw + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="receipt"):
        read_name_manifest(tmp_path)


def test_real_compacted_combined_build_keeps_definition_denominator_separate(tmp_path: Path) -> None:
    from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference

    original = tmp_path / "source.json"
    original.write_text(encoded(fixture()), encoding="utf-8")
    names = tmp_path / "names.json"
    names.write_text(encoded(inventory()), encoding="utf-8")
    result = build_compact_definition_reference(
        (original,),
        tmp_path / "combined.db",
        input_root=tmp_path,
        edition_id="test.combined",
        version="1",
        built_at="2026-09-23",
        definitions_only=True,
        discovery_inputs=(names,),
    )
    assert result["entries"] == 2
    assert result["discoveredNames"] == 1
    assert obj(result["selection"])["definitionRecordsAfter"] == 1
    assert result["logicalRoundTripEqual"] is True
