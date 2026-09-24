"""Offline source fidelity and SQLite verification for an explicit DEV reference refresh."""

from __future__ import annotations

import argparse
import gzip
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from localmed_ingest.definition_reference_pack import Projection
from localmed_ingest.definition_source_manifest import read_source_manifest
from localmed_ingest.wikipedia_definitions import (
    Snapshot,
    integer,
    items,
    obj,
    sha,
    text,
)
from localmed_ingest.wikipedia_reference_refresh import (
    SourceRecord,
    deepen_record,
    load_collection,
    read_records,
    repack,
)


def wiki_records(paths: tuple[Path, ...]) -> dict[str, SourceRecord]:
    result: dict[str, SourceRecord] = {}
    for path in paths:
        payload = obj(json.loads(path.read_bytes()))
        terms = [obj(v) for v in items(payload["terms"])]
        if any(text(t["id"]).startswith("ruwiki.definition.") for t in terms):
            loaded = read_records(payload)
            if result.keys() & loaded.keys():
                raise ValueError("Duplicate active Wikipedia page ID")
            result.update(loaded)
    return result


def verify(
    root: Path, edition: Path, incoming: Path, database: Path
) -> dict[str, object]:
    report = obj(json.loads((edition / "refresh-report.json").read_bytes()))
    active_paths, count = read_source_manifest(
        root, root / "content/definition-drafts/source-inputs.json"
    )
    old_paths, previous_count = read_source_manifest(
        root, edition / "previous-inputs.json"
    )
    previous = wiki_records(old_paths)
    active = wiki_records(active_paths)
    collected = load_collection(
        incoming, root / "content/definition-drafts/ruwiki-scope-2026.09.22.json"
    )
    assert active.keys() == previous.keys() | collected.keys()
    assert previous_count == report["previousRecords"]
    assert count == previous_count + len(collected.keys() - previous.keys())
    assert count == report["combinedRecords"]
    for value in items(report["unchangedOtherInputs"]):
        receipt = obj(value)
        assert sha((root / text(receipt["path"])).read_bytes()) == receipt["sha256"]
    archive = edition / "section-api-snapshots.jsonl.gz"
    assert sha(archive.read_bytes()) == report["sectionArchiveSha256"]
    snapshots: dict[str, Snapshot] = {}
    with gzip.open(archive, "rb") as stream:
        expanded = 0
        for line in stream:
            expanded += len(line)
            assert expanded <= 256 * 1024 * 1024
            saved = obj(json.loads(line))
            raw = text(saved["response"], 16 * 1024 * 1024).encode()
            assert sha(raw) == saved["responseSha256"]
            snapshots[sha(raw)] = Snapshot(
                obj(json.loads(raw)), sha(raw), text(saved["retrievedAt"])
            )
    enriched: set[str] = set()
    for value in items(report["sectionResults"]):
        row = obj(value)
        if "sections" not in row:
            continue
        key = text(row["id"])
        original = previous.get(key, collected.get(key))
        assert original is not None
        expected, _ = deepen_record(
            original,
            snapshots[text(row["apiResponseSha256"])],
            integer(row["revisionId"], 1),
            "2026-09-22",
        )
        assert repack([expected]) == repack([active[key]])
        enriched.add(key)
    for key, actual in active.items():
        if key in enriched:
            continue
        expected = previous.get(key, collected.get(key))
        assert expected is not None
        assert repack([actual]) == repack([expected])
    projection = Projection()
    for path in active_paths:
        raw = path.read_bytes()
        projection.add(json.loads(raw), sha(raw))
    with closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True)) as db:
        assert db.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
        assert db.execute("SELECT count(*) FROM knowledge_entities").fetchone() == (
            count,
        )
        for table in ("knowledge_facts", "knowledge_relations"):
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone() == (0,)
        for key, record in active.items():
            assert db.execute(
                "SELECT canonical_name FROM knowledge_entities WHERE id=?", (key,)
            ).fetchone() == (record.term["title"],)
        for chunk_id, (_, chunk) in projection.chunks.items():
            stored = db.execute(
                "SELECT original_text, metadata_json FROM chunks WHERE id=?",
                (chunk_id,),
            ).fetchone()
            assert stored is not None and stored[0] == chunk.original_text
            assert json.loads(stored[1]) == chunk.metadata
    return {
        "combinedRecords": count,
        "activeWikipediaRecords": len(active),
        "newPageIds": len(collected.keys() - previous.keys()),
        "enrichedCardsReplayed": len(enriched),
        "allProjectedSourceBlocksCompared": len(projection.chunks),
        "unmodifiedSourceRecordsExact": True,
        "revisionRenderReplayExact": True,
        "otherSourceInputsUnchanged": True,
        "duplicatePageIdentities": 0,
        "integrity": "ok",
        "foreignKeyViolations": 0,
        "networkRequests": 0,
        "sqliteBytes": database.stat().st_size,
        "boundary": "Source fidelity and real SQLite, not clinical review or search relevance.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--edition", type=Path, required=True)
    parser.add_argument("--incoming", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.root.resolve(), args.edition, args.incoming, args.database)
    args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
