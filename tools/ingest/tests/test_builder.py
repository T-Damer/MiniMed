from __future__ import annotations

import hashlib
import sqlite3
from pathlib import Path

from localmed_ingest.builder import build_content_pack, load_content_pack
from localmed_ingest.markdown_parser import parse_markdown_document
from localmed_ingest.normalization import light_stem_russian, normalize_for_index


def fixture_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "content/fixtures"


def test_normalization_matches_runtime_expectations() -> None:
    assert light_stem_russian("пневмонией") == "пневмони"
    assert "ребенок" in normalize_for_index("Ребёнок температурит")


def test_markdown_parser_builds_stable_anchors() -> None:
    path = fixture_dir() / "pneumonia.md"
    first = parse_markdown_document(path, "2026-07-16T00:00:00Z")
    second = parse_markdown_document(path, "2026-07-16T00:00:00Z")
    assert first.model_dump() == second.model_dump()
    assert all(section.anchor for section in first.sections)
    assert all(chunk.anchor for section in first.sections for chunk in section.chunks)


def test_markdown_parser_disambiguates_repeated_heading_paths(tmp_path: Path) -> None:
    source = tmp_path / "repeated.md"
    source.write_text(
        """---
id: kr.test.repeated
title: Repeated headings
version_label: "1"
source_type: clinical_recommendation
status: current
---

# Treatment

## Evidence level 5

First recommendation.

## Evidence level 5

First recommendation.

## Evidence level 5

Second recommendation.
""",
        encoding="utf-8",
    )

    document = parse_markdown_document(source, "2026-07-24T00:00:00Z")
    anchors = [
        anchor
        for section in document.sections
        for anchor in [section.anchor, *(chunk.anchor for chunk in section.chunks)]
    ]
    chunk_ids = [chunk.id for section in document.sections for chunk in section.chunks]

    assert len(anchors) == len(set(anchors))
    assert len(chunk_ids) == len(set(chunk_ids))


def test_build_is_deterministic_and_searchable(tmp_path: Path) -> None:
    first_db = tmp_path / "first.db"
    second_db = tmp_path / "second.db"
    first_json = tmp_path / "first.json"
    pack, first_report = build_content_pack(fixture_dir(), first_db, first_json)
    _, second_report = build_content_pack(fixture_dir(), second_db)
    assert first_report.output_checksum == second_report.output_checksum
    assert (
        hashlib.sha256(first_db.read_bytes()).digest()
        == hashlib.sha256(second_db.read_bytes()).digest()
    )
    assert len(pack.documents) == 3

    connection = sqlite3.connect(first_db)
    try:
        result = connection.execute(
            """SELECT document_id FROM chunks_fts
            WHERE chunks_fts MATCH 'тахипноэ*'
            ORDER BY bm25(chunks_fts, 0, 0, 0, 8, 4, 1, 1)
            LIMIT 1"""
        ).fetchone()
        assert result == ("kr.demo.pediatrics.pneumonia",)
        assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    finally:
        connection.close()


def test_load_pack_has_unique_document_ids() -> None:
    pack = load_content_pack(fixture_dir())
    assert len({document.id for document in pack.documents}) == len(pack.documents)


def test_portable_embedding_matches_typescript_golden() -> None:
    import json

    from localmed_ingest.embedding import embed_text

    golden_path = (
        Path(__file__).resolve().parents[3]
        / "packages/search-semantic/tests/portable-hash-golden.json"
    )
    golden = json.loads(golden_path.read_text(encoding="utf-8"))
    for row in golden["rows"]:
        values, norm = embed_text(row["text"])
        assert values == row["values"]
        assert abs(norm - row["norm"]) < 1e-10


def test_generated_pack_has_complete_embedding_coverage(tmp_path: Path) -> None:
    database = tmp_path / "semantic.db"
    pack, report = build_content_pack(fixture_dir(), database)
    chunk_count = sum(
        len(section.chunks) for document in pack.documents for section in document.sections
    )
    assert len(pack.embedding_profiles) == 1
    assert len(pack.embeddings) == chunk_count
    assert report.embeddings == chunk_count

    connection = sqlite3.connect(database)
    try:
        profile = connection.execute("SELECT id, dimensions FROM embedding_profiles").fetchone()
        assert profile == ("localmed.feature-hash.384.v1", 384)
        row = connection.execute(
            "SELECT length(vector), vector_norm FROM chunk_embeddings LIMIT 1"
        ).fetchone()
        assert row is not None
        assert row[0] == 384
        assert row[1] > 0
    finally:
        connection.close()
