"""Compare rebuilt single-recommendation modules with the published ones (STATE KR3).

Read-only. For every `<official id>.db` present in both `--published` and `--rebuilt` it compares
the document, its versions, sections and chunks (ids, anchors, titles, paths, text, order) and
sorts the module into one class:

* `identical`: nothing differs (vectors, FTS and build timestamps are not compared);
* `structure`: the section set differs (sub-headings were added or removed): a content change;
* `drift`: sections are equal but chunk text, order, ids or metadata differ (importer changes
  since the published build, not the heading rule).

For `structure` modules it also reports the id movement (sections added, chunk ids kept, changed,
removed, added) and whether the ordered text of the document is preserved once whitespace is
ignored. Writes a JSON report to `--report`.

    uv run tools/ingest/scripts/compare_clinical_modules.py \\
      --published data/build/official-clinical-2026-10-07/published-decoded \\
      --rebuilt data/build/official-clinical-2026-10-07/rebuilt-compacted \\
      --report data/build/official-clinical-2026-10-07/compare-report.json
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

SPACE = re.compile(r"\s+")


def load(path: Path) -> dict[str, Any]:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        documents = db.execute(
            "SELECT id, title, source_type, status, current_version_id FROM documents ORDER BY id"
        ).fetchall()
        versions = db.execute(
            "SELECT id, document_id, version_label, source_checksum FROM document_versions"
            " ORDER BY id"
        ).fetchall()
        sections = db.execute(
            "SELECT id, parent_section_id, title, section_type, depth, order_index, anchor,"
            " path_json FROM sections ORDER BY order_index, id"
        ).fetchall()
        chunks = db.execute(
            "SELECT id, section_id, order_index, original_text, anchor, metadata_json,"
            " previous_chunk_id, next_chunk_id FROM chunks ORDER BY order_index, id"
        ).fetchall()
    finally:
        db.close()
    return {"documents": documents, "versions": versions, "sections": sections, "chunks": chunks}


def flat_text(chunks: list[tuple[Any, ...]]) -> str:
    return SPACE.sub("", "".join(row[3] for row in chunks))


def compare(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    old_sections = {row[0]: row for row in old["sections"]}
    new_sections = {row[0]: row for row in new["sections"]}
    old_chunks = {row[0]: row for row in old["chunks"]}
    new_chunks = {row[0]: row for row in new["chunks"]}
    added_sections = sorted(new_sections.keys() - old_sections.keys())
    removed_sections = sorted(old_sections.keys() - new_sections.keys())
    changed_sections = sorted(
        key
        for key in old_sections.keys() & new_sections.keys()
        if old_sections[key] != new_sections[key]
    )
    kept = old_chunks.keys() & new_chunks.keys()
    chunk_text_changed = sorted(key for key in kept if old_chunks[key][3] != new_chunks[key][3])
    chunk_other_changed = sorted(
        key
        for key in kept
        if old_chunks[key][3] == new_chunks[key][3] and old_chunks[key] != new_chunks[key]
    )
    same_documents = old["documents"] == new["documents"]
    same_versions = old["versions"] == new["versions"]
    structure = bool(added_sections or removed_sections or changed_sections)
    exact = not structure and same_documents and same_versions and old_chunks == new_chunks
    kind = "identical" if exact else "structure" if structure else "drift"
    return {
        "class": kind,
        "documentRowsEqual": same_documents,
        "versionRowsEqual": same_versions,
        "sectionsOld": len(old_sections),
        "sectionsNew": len(new_sections),
        "sectionsAdded": len(added_sections),
        "sectionsRemoved": len(removed_sections),
        "sectionsChanged": len(changed_sections),
        "chunksOld": len(old_chunks),
        "chunksNew": len(new_chunks),
        "chunksKeptId": len(kept),
        "chunksRemovedId": len(old_chunks.keys() - new_chunks.keys()),
        "chunksAddedId": len(new_chunks.keys() - old_chunks.keys()),
        "keptChunkTextChanged": len(chunk_text_changed),
        "keptChunkOtherChanged": len(chunk_other_changed),
        "textPreserved": flat_text(old["chunks"]) == flat_text(new["chunks"]),
        "addedSectionTitles": [new_sections[key][2] for key in added_sections],
        "removedSectionIds": removed_sections,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--published", type=Path, required=True)
    parser.add_argument("--rebuilt", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    published = {path.stem: path for path in args.published.glob("*.db")}
    rebuilt = {path.stem: path for path in args.rebuilt.glob("*.db")}
    modules: dict[str, dict[str, Any]] = {}
    for official_id in sorted(published.keys() & rebuilt.keys()):
        modules[official_id] = compare(load(published[official_id]), load(rebuilt[official_id]))
    summary: dict[str, int] = {}
    for result in modules.values():
        summary[result["class"]] = summary.get(result["class"], 0) + 1
    report = {
        "summary": summary,
        "onlyPublished": sorted(published.keys() - rebuilt.keys()),
        "onlyRebuilt": sorted(rebuilt.keys() - published.keys()),
        "modules": modules,
    }
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(json.dumps({k: v for k, v in report.items() if k != "modules"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
