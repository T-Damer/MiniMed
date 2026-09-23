from __future__ import annotations

import copy
import json
import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.clinic_definition_completions import verify_excerpt
from localmed_ingest.definition_name_completions import (
    FORMAT,
    apply_name_completions,
    read_completion_manifest,
)
from localmed_ingest.definition_name_inventory import add_name_inventory
from localmed_ingest.definition_reference_pack import Projection, digest, encoded, obj, seq
from test_definition_name_inventory import inventory

BODY = "Тестовый термин — описание синтетического явления."
TARGET = "ruwiki.definition.fixture"
RECEIPT = "b" * 64


def base() -> Projection:
    projection = Projection()
    add_name_inventory(projection, inventory(), RECEIPT)
    return projection


def completion() -> dict[str, object]:
    raw = f"<h1>Test source</h1><p>🔬 Начало. {BODY} Конец.</p>".encode()
    return {
        "format": FORMAT,
        "targets": [
            {
                "id": TARGET,
                "expectedTitle": "Тестовый термин",
                "discoveryReceipt": RECEIPT,
            }
        ],
        "catalog": {
            "version": 3,
            "id": "synthetic.completion",
            "publicationState": "local-dev",
            "reviewStatus": "requires-review",
            "textKind": "source-excerpt",
            "sources": [
                {
                    "id": 1,
                    "title": "Synthetic medical source",
                    "baseUrl": "https://example.org/",
                    "sourceType": "fixture",
                    "releaseEligible": False,
                }
            ],
            "blocks": [
                {
                    "id": 1,
                    "source": 1,
                    "text": BODY,
                    "textSha256": digest(BODY),
                    "path": "test",
                    "locator": "Synthetic paragraph",
                    "sourceVerification": verify_excerpt(raw, BODY),
                }
            ],
            "terms": [
                {
                    "id": TARGET,
                    "title": "Тестовый термин",
                    "kind": "term",
                    "aliases": [],
                    "coverage": "definition",
                    "blockIds": [1],
                }
            ],
        },
    }


def test_updates_one_base_and_preserves_all_discovery_data(tmp_path: Path) -> None:
    projection = base()
    old = copy.deepcopy(projection.entries[TARGET])
    old_chunks = copy.deepcopy(projection.chunks)
    assert apply_name_completions(projection, completion(), "c" * 64) == 1
    entry = projection.entries[TARGET]
    assert len(projection.entries) == 1
    assert entry.title == old.title
    assert entry.names == old.names
    assert entry.coverage == "definition"
    assert entry.links[0][0] == "definition"
    assert entry.links[1:] == old.links
    for identifier, (_, chunk) in old_chunks.items():
        assert projection.chunks[identifier][1] == chunk
    path = tmp_path / "combined.db"
    projection.build(path, edition_id="test.completed", version="1", built_at="2026-09-23")
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
        assert db.execute("SELECT id FROM knowledge_entities").fetchall() == [(TARGET,)]
        assert db.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (0,)
        assert db.execute(
            "SELECT count(*) FROM definition_reference_fts WHERE definition_reference_fts MATCH ?",
            ("синтетического",),
        ).fetchone() == (1,)
        assert db.execute(
            "SELECT count(*) FROM definition_reference_fts WHERE definition_reference_fts MATCH ?",
            ("Archived",),
        ).fetchone() == (0,)


@pytest.mark.parametrize(
    "field,value",
    [
        ("discoveryReceipt", "d" * 64),
        ("expectedTitle", "Another meaning"),
        ("id", "unknown.target"),
        ("discoveryReceipt", "invalid"),
    ],
)
def test_stale_targets_fail_before_mutation(field: str, value: object) -> None:
    projection = base()
    before = copy.deepcopy(projection)
    payload = completion()
    obj(seq(payload["targets"], 10)[0])[field] = value
    with pytest.raises(ValueError):
        apply_name_completions(projection, payload, "c" * 64)
    assert projection.entries == before.entries
    assert projection.chunks == before.chunks
    assert projection.sources == before.sources


@pytest.mark.parametrize(
    "field,value",
    [
        ("start", True),
        ("end", 1),
        ("excerptSha256", "a" * 64),
        ("responseSha256", "invalid"),
        ("method", "model-guessed"),
    ],
)
def test_incorrect_source_receipts_are_rejected(field: str, value: object) -> None:
    projection = base()
    before = copy.deepcopy(projection)
    payload = completion()
    block = obj(seq(obj(payload["catalog"])["blocks"], 10)[0])
    obj(block["sourceVerification"])[field] = value
    with pytest.raises(ValueError):
        apply_name_completions(projection, payload, "c" * 64)
    assert projection.sources == before.sources
    assert projection.entries == before.entries


def test_wikipedia_can_supply_name_identity_but_not_medical_prose() -> None:
    payload = completion()
    source = obj(seq(obj(payload["catalog"])["sources"], 10)[0])
    source["baseUrl"] = "https://ru.wikipedia.org/wiki/"
    with pytest.raises(ValueError, match="Wikipedia"):
        apply_name_completions(base(), payload, "c" * 64)


def test_definition_is_never_replaced_silently() -> None:
    projection = base()
    payload = completion()
    apply_name_completions(projection, payload, "c" * 64)
    with pytest.raises(ValueError, match="conflicts"):
        apply_name_completions(projection, payload, "c" * 64)


def test_existing_defined_title_requires_explicit_reconciliation() -> None:
    projection = base()
    source_payload = obj(completion()["catalog"])
    term = obj(seq(source_payload["terms"], 10)[0])
    term["id"] = "existing.medical.definition"
    projection.add(source_payload, "e" * 64)
    with pytest.raises(ValueError, match="existing definition"):
        apply_name_completions(projection, completion(), "c" * 64)
    assert projection.entries[TARGET].coverage == "needs-definition"


def test_unrelated_blocks_are_not_imported() -> None:
    payload = completion()
    blocks = seq(obj(payload["catalog"])["blocks"], 10)
    extra = copy.deepcopy(obj(blocks[0]))
    extra.update({"id": 2, "text": "Unrelated", "textSha256": digest("Unrelated")})
    blocks.append(extra)
    with pytest.raises(ValueError, match="unrelated"):
        apply_name_completions(base(), payload, "c" * 64)


def test_whitespace_only_normalization_and_unicode_offsets() -> None:
    raw = (
        "<h1>Article</h1><p>🔬 Начало. "
        "Тестовый\n термин — описание\u00a0синтетического явления.</p>"
    ).encode()
    proof = verify_excerpt(raw, BODY)
    assert proof["start"] == len("🔬 Начало. ")
    assert proof["end"] == len("🔬 Начало. " + BODY)
    assert proof["excerptSha256"] == digest(BODY)


@pytest.mark.parametrize(
    "raw",
    [
        f"<h1>Article</h1><script>{BODY}</script><p>Other.</p>",
        f"<p>{BODY}</p>",
        "<h1>Article</h1><p>No matching definition.</p>",
    ],
)
def test_unavailable_visible_text_is_not_reconstructed(raw: str) -> None:
    with pytest.raises(ValueError):
        verify_excerpt(raw.encode(), BODY)


def test_author_and_sentence_budgets() -> None:
    raw = f"<h1>Article</h1><p>{BODY}</p>".encode()
    with pytest.raises(ValueError, match="author"):
        verify_excerpt(raw, BODY, "Missing Author")
    with pytest.raises(ValueError):
        verify_excerpt(raw, BODY[:-1])
    with pytest.raises(ValueError, match="budget"):
        verify_excerpt(raw, "word " * 26 + ".")


def test_manifest_rejects_changed_receipts_and_paths(tmp_path: Path) -> None:
    assert read_completion_manifest(tmp_path) == ()
    root = tmp_path / "content/definition-drafts"
    root.mkdir(parents=True)
    payload = encoded(completion())
    (root / "fills.json").write_text(payload, encoding="utf-8")
    manifest = {
        "format": FORMAT,
        "inputs": [
            {
                "path": "content/definition-drafts/fills.json",
                "bytes": len(payload.encode()),
                "sha256": digest(payload),
            }
        ],
    }
    manifest_path = root / "completion-inputs.json"
    manifest_path.write_text(json.dumps(manifest))
    assert read_completion_manifest(tmp_path) == (root / "fills.json",)
    (root / "fills.json").write_text(payload + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="receipt"):
        read_completion_manifest(tmp_path)


def test_ordinary_compactor_keeps_total_and_definition_counts_separate(tmp_path: Path) -> None:
    from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference
    from test_definition_reference_pack import fixture

    source = tmp_path / "source.json"
    original = fixture()
    for term in seq(original["terms"], 10):
        obj(term)["title"] = "Другое исходное понятие"
    source.write_text(encoded(original), encoding="utf-8")
    names = tmp_path / "names.json"
    raw_names = encoded(inventory())
    names.write_text(raw_names, encoding="utf-8")
    payload = completion()
    obj(seq(payload["targets"], 10)[0])["discoveryReceipt"] = digest(raw_names)
    fills = tmp_path / "fills.json"
    fills.write_text(encoded(payload), encoding="utf-8")
    report = build_compact_definition_reference(
        (source,),
        tmp_path / "dictionary.db",
        input_root=tmp_path,
        edition_id="fixture.completed",
        version="1",
        built_at="2026-09-23",
        definitions_only=True,
        discovery_inputs=(names,),
        completion_inputs=(fills,),
    )
    assert report["entries"] == 2
    assert report["discoveredNames"] == 1
    assert report["completedNames"] == 1
    assert report["logicalRoundTripEqual"] is True
