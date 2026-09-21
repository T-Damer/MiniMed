from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from localmed_ingest.definition_reference_compact_pack import build_compact_definition_reference
from localmed_ingest.definition_reference_layout import (
    compact_reference_links,
    link_digest,
    reference_content_digest,
)
from localmed_ingest.definition_reference_profile import file_receipt, profile_reference
from test_definition_reference_pack import build, fixture, write_input


def compact_build(root: Path, name: str = "compact.db") -> tuple[Path, dict[str, object]]:
    write_input(root, fixture())
    output = root / name
    report = build_compact_definition_reference(
        (Path("input.json"),), output, input_root=root,
        edition_id="fixture.reference", version="1", built_at="2026-09-21",
    )
    return output, report


def test_full_source_identity_and_provenance_roundtrip(tmp_path: Path) -> None:
    baseline = build(tmp_path, fixture(), "baseline.db")
    compact, report = compact_build(tmp_path)
    with closing(sqlite3.connect(baseline)) as old, closing(sqlite3.connect(compact)) as new:
        assert reference_content_digest(old, compact=False) == reference_content_digest(
            new, compact=True
        )
        assert new.execute("SELECT count(*) FROM knowledge_document_links").fetchone() == (0,)
        assert new.execute("SELECT count(*) FROM definition_reference_links").fetchone() == (7,)
        assert new.execute("PRAGMA foreign_key_check").fetchall() == []
        assert new.execute("SELECT value FROM app_metadata WHERE key='schema_version'").fetchone() == (
            "7",
        )
        assert new.execute("SELECT count(*) FROM knowledge_facts").fetchone() == (0,)
        assert new.execute("SELECT count(*) FROM knowledge_relations").fetchone() == (0,)
    assert report["logicalRoundTripEqual"] is True
    assert report["postVacuumFtsIntegrity"] == "ok"


def test_repeated_roles_and_context_exclusion_survive_compaction(tmp_path: Path) -> None:
    compact, _ = compact_build(tmp_path)
    with closing(sqlite3.connect(compact)) as db:
        rows = db.execute(
            "SELECT link_type FROM definition_reference_links "
            "WHERE entity_id='fixture.first' ORDER BY id"
        ).fetchall()
        assert [row[0] for row in rows] == [
            "reference:definition", "reference:item", "reference:item",
            "reference:context", "reference:annotation",
        ]
        for query, count in (("определение", 1), ("контекстмаркер", 0), ("аннотациямаркер", 0)):
            assert db.execute(
                "SELECT count(*) FROM definition_reference_fts "
                "WHERE definition_reference_fts MATCH ?", (query,)
            ).fetchone() == (count,)
        assert db.execute("SELECT count(*) FROM chunks_fts").fetchone() == (0,)


@pytest.mark.parametrize("assignment", [
    "weight=0.5",
    "review_status='reviewed'",
    "link_type='reference:unknown'",
    "id='unreconstructible.id'",
    "document_id='different.source'",
    "metadata_json=json_set(metadata_json,'$.extra','must not be discarded')",
    "metadata_json=json_set(metadata_json,'$.ordinal',0.5)",
    "metadata_json=json_set(metadata_json,'$.role','context')",
])
def test_unreconstructible_links_are_not_silently_normalized(
    tmp_path: Path, assignment: str,
) -> None:
    baseline = build(tmp_path, fixture())
    with closing(sqlite3.connect(baseline)) as db, db:
        # Fixed test cases, not caller-provided SQL. Wrong references are intentional fixtures.
        db.execute(f"UPDATE knowledge_document_links SET {assignment} "
                   "WHERE id='fixture.first.reference.000000'")
        before = link_digest(db, compact=False)
        with pytest.raises(ValueError, match="non-reconstructible"):
            compact_reference_links(db)
        assert link_digest(db, compact=False) == before
        assert db.execute("SELECT count(*) FROM definition_reference_compact_links").fetchone() == (0,)
        assert db.execute("SELECT count(*) FROM definition_reference_chunk_keys").fetchone() == (0,)


def test_repeated_compaction_fails_without_changing_data(tmp_path: Path) -> None:
    compact, _ = compact_build(tmp_path)
    before = file_receipt(compact)
    with closing(sqlite3.connect(compact)) as db:
        with pytest.raises(ValueError, match="start empty"):
            compact_reference_links(db)
    assert file_receipt(compact) == before


def test_readonly_profile_never_copies_source_text_or_changes_file(tmp_path: Path) -> None:
    compact, _ = compact_build(tmp_path)
    before = file_receipt(compact)
    report = profile_reference(compact)
    assert file_receipt(compact) == before
    assert report["readOnlyReceiptUnchanged"] is True
    assert report["accountedBtreeBytes"] == report["sqliteBytes"]
    assert "Точное определение" not in str(report)
    assert report["foreignKeyViolations"] == 0


def test_profiler_rejects_missing_files_and_live_journals(tmp_path: Path) -> None:
    missing = tmp_path / "missing.db"
    with pytest.raises(FileNotFoundError):
        profile_reference(missing)
    assert not missing.exists()
    compact, _ = compact_build(tmp_path)
    Path(str(compact) + "-wal").write_bytes(b"live-journal")
    with pytest.raises(ValueError, match="journal/WAL"):
        profile_reference(compact)


def test_compact_output_is_immutable(tmp_path: Path) -> None:
    compact, _ = compact_build(tmp_path)
    before = file_receipt(compact)
    with pytest.raises(ValueError, match="immutable"):
        compact_build(tmp_path)
    assert file_receipt(compact) == before
