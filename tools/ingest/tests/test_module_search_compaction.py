from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.builder import build_content_pack
from localmed_ingest.module_search_compaction import (
    STATE_EMPTIED,
    STATE_KEY,
    compact_search_text,
    migrate_module_search,
    search_text_is_emptied,
)
from localmed_ingest.sqlite_builder import (
    chunks_fts_uses_external_content,
    rebuild_chunks_fts_index,
    write_sqlite_pack,
)
from test_builder import fixture_dir
from test_sqlite_builder import _pack  # pyright: ignore[reportPrivateUsage]

_LEGACY_FTS = """CREATE VIRTUAL TABLE chunks_fts USING fts5(
  chunk_id UNINDEXED, document_id UNINDEXED, document_version_id UNINDEXED,
  section_id UNINDEXED, anchor UNINDEXED, title, section_path, normalized_text,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3 4')"""


def _external_pack(tmp_path: Path) -> Path:
    output = tmp_path / "external.db"
    write_sqlite_pack(_pack(), output)
    return output


def _legacy_pack(tmp_path: Path) -> Path:
    """The layout of the packs released before migration 010: a self-contained FTS table."""
    output = tmp_path / "legacy.db"
    write_sqlite_pack(_pack(), output)
    connection = sqlite3.connect(output)
    try:
        connection.execute("CREATE TEMP TABLE source AS SELECT * FROM chunks_fts_source")
        connection.execute("DROP TABLE chunks_fts")
        connection.execute("DROP VIEW chunks_fts_source")
        connection.execute(_LEGACY_FTS)
        connection.execute(
            """INSERT INTO chunks_fts(rowid, chunk_id, document_id, document_version_id,
                section_id, anchor, title, section_path, normalized_text)
            SELECT rowid, chunk_id, document_id, document_version_id, section_id, anchor,
                title, section_path, normalized_text FROM source"""
        )
        connection.commit()
        connection.execute("VACUUM")
    finally:
        connection.close()
    return output


def _search(path: Path, query: str) -> list[tuple[object, ...]]:
    connection = sqlite3.connect(path)
    try:
        return connection.execute(
            """SELECT chunk_id, round(bm25(chunks_fts, 0, 0, 0, 0, 0, 8.0, 4.0, 1.0), 9)
            FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY 2, 1""",
            (query,),
        ).fetchall()
    finally:
        connection.close()


def _source_text(path: Path) -> list[tuple[object, ...]]:
    connection = sqlite3.connect(path)
    try:
        return connection.execute(
            """SELECT id, original_text, char_start, char_end, anchor, metadata_json
            FROM chunks ORDER BY id"""
        ).fetchall()
    finally:
        connection.close()


@pytest.mark.parametrize("layout", ["legacy", "external"])
def test_migration_keeps_index_results_and_source_text_and_empties_normalized_text(
    tmp_path: Path, layout: str
) -> None:
    source = _legacy_pack(tmp_path) if layout == "legacy" else _external_pack(tmp_path)
    output = tmp_path / "compact.db"

    report = migrate_module_search(source, output)

    assert report["previousLayout"] == ("internal" if layout == "legacy" else "external")
    assert report["convertedToExternalContent"] is (layout == "legacy")
    assert report["emptiedChunks"] == 4
    assert report["sqliteIntegrity"] == "ok"
    for query in ('"пневмония"', "контр*", '"лечение" "бронхит"', "наблюдение"):
        assert _search(output, query) == _search(source, query)
        assert _search(output, query)
    assert _source_text(output) == _source_text(source)
    connection = sqlite3.connect(output)
    try:
        assert chunks_fts_uses_external_content(connection)
        assert connection.execute(
            "SELECT count(*) FROM chunks WHERE normalized_text != ''"
        ).fetchone() == (0,)
        assert search_text_is_emptied(connection)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        # The index options of the source are kept: the legacy pack's own prefix list survives.
        options = connection.execute("SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'")
        expected_prefix = "2 3 4" if layout == "legacy" else "2 3"
        assert f"prefix = '{expected_prefix}'" in str(options.fetchone()[0])
        assert connection.execute("SELECT count(*) FROM chunks_fts").fetchone() == (4,)
    finally:
        connection.close()
    # The source pack is an input: it keeps its normalized text and is never modified.
    reference = sqlite3.connect(source)
    try:
        assert reference.execute(
            "SELECT count(*) FROM chunks WHERE normalized_text != ''"
        ).fetchone() == (4,)
    finally:
        reference.close()
    assert output.stat().st_size <= source.stat().st_size


def test_emptied_pack_refuses_a_second_compaction_and_any_index_rebuild(tmp_path: Path) -> None:
    source = _external_pack(tmp_path)
    output = tmp_path / "compact.db"
    migrate_module_search(source, output)
    with pytest.raises(ValueError, match="already emptied"):
        migrate_module_search(output, tmp_path / "again.db")
    connection = sqlite3.connect(output)
    try:
        with pytest.raises(ValueError, match="normalized_text was emptied"):
            rebuild_chunks_fts_index(connection)
        assert connection.execute(
            "SELECT value FROM app_metadata WHERE key = ?", (STATE_KEY,)
        ).fetchone() == (STATE_EMPTIED,)
    finally:
        connection.close()


def test_a_tampered_index_is_rejected_before_anything_is_emptied(tmp_path: Path) -> None:
    source = _external_pack(tmp_path)
    connection = sqlite3.connect(source)
    try:
        # The index no longer matches its rows: rank-1 verification must refuse the pack.
        connection.execute("UPDATE chunks SET normalized_text = 'иное содержимое' WHERE rowid = 1")
        connection.commit()
        with pytest.raises(sqlite3.DatabaseError):
            compact_search_text(connection)
        assert connection.execute(
            "SELECT count(*) FROM chunks WHERE normalized_text = ''"
        ).fetchone() == (0,)
    finally:
        connection.close()


def test_migration_checks_the_input_checksum_and_never_overwrites(tmp_path: Path) -> None:
    source = _external_pack(tmp_path)
    with pytest.raises(ValueError, match="checksum"):
        migrate_module_search(source, tmp_path / "out.db", expected_checksum="sha256:" + "0" * 64)
    with pytest.raises(ValueError, match="separate staged output"):
        migrate_module_search(source, source)
    assert not (tmp_path / "out.db").exists()


def test_build_can_emit_a_compacted_module_pack(tmp_path: Path) -> None:
    plain = tmp_path / "plain.db"
    compact = tmp_path / "compact.db"
    _, plain_report = build_content_pack(fixture_dir(), plain, include_embeddings=False)
    _, compact_report = build_content_pack(
        fixture_dir(), compact, include_embeddings=False, compact_search_text=True
    )
    assert compact_report.chunks == plain_report.chunks
    assert compact_report.sqlite_integrity == "ok"
    connection = sqlite3.connect(compact)
    try:
        assert search_text_is_emptied(connection)
        assert connection.execute(
            "SELECT count(*) FROM chunks WHERE normalized_text != ''"
        ).fetchone() == (0,)
    finally:
        connection.close()
    for query in ("бронхит", "лечение", "пневмония"):
        assert _search(compact, query) == _search(plain, query)
    assert _source_text(compact) == _source_text(plain)
