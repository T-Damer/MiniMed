from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from localmed_ingest.builder import load_content_pack
from localmed_ingest.edition_manifest import sha256_file
from localmed_ingest.sqlite_builder import write_sqlite_pack
from localmed_ingest.sqlite_layout_migration_008 import migrate_sqlite_layout

ROOT = Path(__file__).resolve().parents[3]


def test_repacks_pages_without_changing_content_or_source(tmp_path: Path) -> None:
    source, output = tmp_path / "source.db", tmp_path / "repacked.db"
    write_sqlite_pack(load_content_pack(ROOT / "content" / "pilot-rf"), source)
    checksum = sha256_file(source)
    with pytest.raises(ValueError, match="checksum"):
        migrate_sqlite_layout(source, output, "sha256:incorrect")
    assert not output.exists()
    with pytest.raises(ValueError, match="separate staged output"):
        migrate_sqlite_layout(source, source, checksum)
    report = migrate_sqlite_layout(source, output, checksum)
    assert sha256_file(source) == checksum
    assert report["inputChecksum"] == checksum
    assert report["outputChecksum"] == sha256_file(output)
    with sqlite3.connect(source) as before, sqlite3.connect(output) as after:
        assert before.execute("PRAGMA page_size").fetchone()[0] == 4096
        assert after.execute("PRAGMA page_size").fetchone()[0] == 65536
        assert list(before.iterdump()) == list(after.iterdump())
        query = "SELECT chunk_id FROM chunks_fts WHERE chunks_fts MATCH 'кашель' ORDER BY chunk_id"
        assert before.execute(query).fetchall() == after.execute(query).fetchall()
