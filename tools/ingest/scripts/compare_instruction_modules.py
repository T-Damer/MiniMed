"""Compare two releases of the instruction modules, document by document (LEAF1 and later rebuilds).

    uv run python scripts/compare_instruction_modules.py --old DIR --new DIR --out report.json \\
        [--overlay data/build/grls-contents-lists.jsonl] [--vectors]

`DIR` holds decoded `minimed.medications.instructions.<group>.ru.db` files. For every document the
rows of `sections` and `chunks` (all columns) and `documents.metadata_json` are hashed in both
releases; a document is *unchanged* when all three hashes are equal. The report names, per module,
the changed documents (split into those the overlay names and the rest), the numbered one-line chunks
and chunks that are only a list number in both releases, and, with `--vectors`, whether the KD1
vector of every chunk that exists in both releases is byte-identical.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

LONE_NUMBER = re.compile(r"^\d{1,2}(?:\.\d{1,2})*\.?$")
ONE_LINE_NUMBERED = re.compile(r"^\d{1,2}\.\s*\S[^\n]{0,160}$")


def _digest(rows: list[tuple[Any, ...]]) -> str:
    payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def document_hashes(path: Path) -> dict[str, dict[str, str]]:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        sections: dict[str, list[tuple[Any, ...]]] = {}
        for row in db.execute(
            """SELECT v.document_id, s.id, s.parent_section_id, s.title, s.normalized_title,
                      s.section_type, s.depth, s.order_index, s.page_start, s.page_end, s.anchor,
                      s.path_json
                 FROM sections s JOIN document_versions v ON v.id = s.document_version_id
                ORDER BY v.document_id, s.order_index"""
        ):
            sections.setdefault(row[0], []).append(row[1:])
        chunks: dict[str, list[tuple[Any, ...]]] = {}
        for row in db.execute(
            """SELECT v.document_id, c.id, c.section_id, c.order_index, c.original_text,
                      c.page_start, c.page_end, c.char_start, c.char_end, c.previous_chunk_id,
                      c.next_chunk_id, c.anchor, c.metadata_json
                 FROM chunks c JOIN document_versions v ON v.id = c.document_version_id
                ORDER BY v.document_id, c.order_index"""
        ):
            chunks.setdefault(row[0], []).append(row[1:])
        documents = {
            row[0]: row[1:]
            for row in db.execute("SELECT id, title, short_title, metadata_json FROM documents")
        }
    finally:
        db.close()
    return {
        document_id: {
            "sections": _digest(sections.get(document_id, [])),
            "chunks": _digest(chunks.get(document_id, [])),
            "document": _digest([documents[document_id]]),
        }
        for document_id in documents
    }


def chunk_shapes(path: Path) -> dict[str, int]:
    """Counts of chunk paragraphs that are only a list number and of numbered one-line chunks."""
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    lone_chunks = lone_documents = one_line = one_line_documents = 0
    sections = chunks = 0
    try:
        sections = db.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
        seen_lone: set[str] = set()
        seen_one_line: set[str] = set()
        for chunks_total, (document_id, text) in enumerate(
            db.execute(
                """SELECT v.document_id, c.original_text FROM chunks c
                     JOIN document_versions v ON v.id = c.document_version_id"""
            ),
            start=1,
        ):
            chunks = chunks_total
            paragraphs = [part.strip() for part in re.split(r"\n\s*\n|\n", text) if part.strip()]
            if any(LONE_NUMBER.match(part) for part in paragraphs):
                lone_chunks += 1
                seen_lone.add(document_id)
            if ONE_LINE_NUMBERED.match(text.strip()):
                one_line += 1
                seen_one_line.add(document_id)
        lone_documents = len(seen_lone)
        one_line_documents = len(seen_one_line)
    finally:
        db.close()
    return {
        "sections": sections,
        "chunks": chunks,
        "chunksWithLoneNumber": lone_chunks,
        "documentsWithLoneNumber": lone_documents,
        "numberedOneLineChunks": one_line,
        "documentsWithNumberedOneLineChunk": one_line_documents,
    }


def vector_differences(old: Path, new: Path) -> dict[str, int]:
    """Chunks in both releases whose KD1 vector differs, and chunks with a vector only in one."""
    result = {"common": 0, "identical": 0, "different": 0, "onlyOld": 0, "onlyNew": 0}
    old_db = sqlite3.connect(f"file:{old}?mode=ro", uri=True)
    new_db = sqlite3.connect(f"file:{new}?mode=ro", uri=True)
    try:
        before = {
            chunk_id: (bytes(vector), norm)
            for chunk_id, vector, norm in old_db.execute(
                "SELECT chunk_id, vector, vector_norm FROM chunk_embeddings"
            )
        }
        after = {
            chunk_id: (bytes(vector), norm)
            for chunk_id, vector, norm in new_db.execute(
                "SELECT chunk_id, vector, vector_norm FROM chunk_embeddings"
            )
        }
    finally:
        old_db.close()
        new_db.close()
    for chunk_id, value in after.items():
        if chunk_id in before:
            result["common"] += 1
            result["identical" if before[chunk_id] == value else "different"] += 1
        else:
            result["onlyNew"] += 1
    result["onlyOld"] = sum(1 for chunk_id in before if chunk_id not in after)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--old", type=Path, required=True)
    parser.add_argument("--new", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--overlay", type=Path)
    parser.add_argument("--vectors", action="store_true")
    args = parser.parse_args()
    named: set[str] = set()
    if args.overlay is not None and args.overlay.is_file():
        named = {
            json.loads(line)["sourceId"]
            for line in args.overlay.read_text(encoding="utf-8").splitlines()
            if line
        }
    modules: dict[str, Any] = {}
    totals = {"documents": 0, "changed": 0, "changedNamed": 0, "changedOther": 0, "added": 0}
    for new_path in sorted(args.new.glob("*.db")):
        old_path = args.old / new_path.name
        before = document_hashes(old_path) if old_path.is_file() else {}
        after = document_hashes(new_path)
        changed = sorted(
            document_id
            for document_id, hashes in after.items()
            if document_id in before and hashes != before[document_id]
        )
        added = sorted(set(after) - set(before))
        removed = sorted(set(before) - set(after))
        changed_named = [document_id for document_id in changed if document_id in named]
        changed_other = [document_id for document_id in changed if document_id not in named]
        entry: dict[str, Any] = {
            "documents": len(after),
            "unchanged": len(after) - len(changed) - len(added),
            "changed": len(changed),
            "changedNamedByOverlay": len(changed_named),
            "changedOther": changed_other,
            "added": added,
            "removed": removed,
            "namedButUnchanged": sorted(
                document_id for document_id in after if document_id in named and document_id not in changed
            ),
            "shapesOld": chunk_shapes(old_path) if old_path.is_file() else None,
            "shapesNew": chunk_shapes(new_path),
        }
        if args.vectors and old_path.is_file():
            entry["vectors"] = vector_differences(old_path, new_path)
        modules[new_path.name.removesuffix(".db")] = entry
        totals["documents"] += len(after)
        totals["changed"] += len(changed)
        totals["changedNamed"] += len(changed_named)
        totals["changedOther"] += len(changed_other)
        totals["added"] += len(added)
        print(new_path.name, json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in entry.items() if k not in {"shapesOld", "shapesNew", "vectors"}}, ensure_ascii=False), flush=True)
    args.out.write_text(
        json.dumps({"totals": totals, "modules": modules}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(totals))


if __name__ == "__main__":
    main()
