from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

from localmed_ingest.builder import load_content_pack
from localmed_ingest.markdown_parser import parse_markdown_document
from localmed_ingest.registry_copy_migration_007 import NEW_LABEL, OLD_LABEL, migrate_registry_copy
from localmed_ingest.sqlite_builder import write_sqlite_pack

ROOT = Path(__file__).resolve().parents[3]


def test_clarifies_prepared_summaries_and_evidence_without_changing_anchors_or_reviews(
    tmp_path: Path,
) -> None:
    prepared = ROOT / "content" / "pilot-rf"
    original = tmp_path / "original"
    shutil.copytree(prepared, original)
    for path in original.iterdir():
        if path.suffix in {".md", ".json"}:
            path.write_text(
                path.read_text(encoding="utf-8").replace(NEW_LABEL, OLD_LABEL), encoding="utf-8"
            )
    old_chunk_ids: dict[str, str] = {}
    for path in original.glob("*.md"):
        before_doc = parse_markdown_document(path, extracted_at="2026-09-06T00:00:00Z")
        after_doc = parse_markdown_document(
            prepared / path.name, extracted_at="2026-09-06T00:00:00Z"
        )
        for before_section, after_section in zip(
            before_doc.sections, after_doc.sections, strict=True
        ):
            for before_chunk, after_chunk in zip(
                before_section.chunks, after_section.chunks, strict=True
            ):
                old_chunk_ids[after_chunk.id] = before_chunk.id
    for path in original.glob("*.json"):
        text = path.read_text(encoding="utf-8")
        for new, old in old_chunk_ids.items():
            text = text.replace(new, old)
        path.write_text(text, encoding="utf-8")
    source, output = tmp_path / "source.db", tmp_path / "updated.db"
    write_sqlite_pack(load_content_pack(original), source)
    report = migrate_registry_copy(source, output, prepared, built_at="2026-09-06T00:00:00Z")
    assert report["summariesUpdated"] == 8
    with sqlite3.connect(source) as before, sqlite3.connect(output) as after:
        for query in (
            "SELECT id, anchor, metadata_json FROM chunks ORDER BY id",
            "SELECT id, review_status FROM knowledge_facts ORDER BY id",
        ):
            assert before.execute(query).fetchall() == after.execute(query).fetchall()
        assert (
            after.execute(
                "SELECT count(*) FROM chunks WHERE instr(original_text, ?) > 0", (OLD_LABEL,)
            ).fetchone()[0]
            == 0
        )
        assert (
            after.execute(
                "SELECT count(*) FROM chunks WHERE instr(original_text, ?) > 0", (NEW_LABEL,)
            ).fetchone()[0]
            == 8
        )
        for quote, text in after.execute(
            "SELECT evidence_quote, original_text FROM knowledge_evidence "
            "JOIN chunks ON chunk_id = chunks.id WHERE instr(evidence_quote, ?) > 0",
            (NEW_LABEL,),
        ):
            assert quote in text
