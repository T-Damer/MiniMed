"""Verify selected specialist sources offline against a freshly built reference database."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path

from localmed_ingest.definition_reference_pack import Projection, obj, seq, text
from localmed_ingest.definition_source_manifest import read_source_manifest
from localmed_ingest.definition_source_policy import require_active_definition_source
from localmed_ingest.specialist_journal_refresh import compose_selected


def verify(
    root: Path, selected: Path, database: Path, report_path: Path, cards_path: Path
) -> None:
    selection = obj(json.loads((selected / "selection-report.json").read_bytes()))
    refresh = obj(selection["refresh"])
    collections = tuple(
        dict.fromkeys(
            root / text(obj(value)["collection"])
            for value in seq(selection["articles"], 96)
        )
    )
    with tempfile.TemporaryDirectory(prefix="journal-replay-") as directory:
        replay_dir = Path(directory) / "selection"
        replay = compose_selected(collections, replay_dir)
        before = {key: value for key, value in selection.items() if key != "refresh"}
        for result in (replay, before):
            for value in seq(result["articles"], 96):
                row = obj(value)
                row["collection"] = (
                    (root / text(row["collection"])).resolve().as_posix()
                )
        if replay != before:
            raise ValueError(
                "Archived source replay changed the selected article projection"
            )
        for value in seq(selection["articles"], 96):
            row = obj(value)
            if row.get("status") == "selected-requires-clinical-review":
                name = text(row["prepared"], 255)
                if (replay_dir / name).read_bytes() != (selected / name).read_bytes():
                    raise ValueError("Selected source file differs from offline replay")
    for value in seq(refresh["previousInputs"], 32):
        row = obj(value)
        raw = (root / text(row["path"])).read_bytes()
        if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
            raise ValueError("A pre-existing source input was changed")
    paths, expected_count = read_source_manifest(
        root, root / "content/definition-drafts/source-inputs.json"
    )
    projection = Projection()
    for path in paths:
        raw = path.read_bytes()
        payload = obj(json.loads(raw))
        require_active_definition_source(payload)
        projection.add(payload, hashlib.sha256(raw).hexdigest())
    new_ids: set[str] = set()
    for value in seq(refresh["newInputs"], 32):
        payload = obj(json.loads((root / text(value)).read_bytes()))
        new_ids.update(
            text(obj(term)["id"], 256) for term in seq(payload["terms"], 5000)
        )
    cards: list[dict[str, object]] = []
    checked_sources = 0
    checked_links = 0
    with closing(
        sqlite3.connect(f"{database.resolve().as_uri()}?mode=ro", uri=True)
    ) as db:
        if db.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("SQLite integrity failure")
        if db.execute("PRAGMA foreign_key_check").fetchall():
            raise ValueError("SQLite foreign-key failure")
        actual_ids = {
            str(row[0]) for row in db.execute("SELECT id FROM knowledge_entities")
        }
        if actual_ids != set(projection.entries) or len(actual_ids) != expected_count:
            raise ValueError(
                "SQLite identity set differs from selected source identities"
            )
        if any(
            identifier.startswith("ruwiki.definition.") for identifier in actual_ids
        ):
            raise ValueError("Excluded Wikipedia source reappeared")
        for table in ("knowledge_facts", "knowledge_relations"):
            if db.execute(f"SELECT count(*) FROM {table}").fetchone() != (0,):
                raise ValueError(
                    "Source extraction created clinical facts or relations"
                )
        for chunk_id, (_, chunk) in projection.chunks.items():
            row = db.execute(
                "SELECT original_text, metadata_json FROM chunks WHERE id=?",
                (chunk_id,),
            ).fetchone()
            if (
                row is None
                or row[0] != chunk.original_text
                or json.loads(row[1]) != chunk.metadata
            ):
                raise ValueError("Source block text or provenance differs in SQLite")
        for source in projection.sources.values():
            row = db.execute(
                "SELECT metadata_json FROM documents WHERE id=?", (source.id,)
            ).fetchone()
            if (
                row is None
                or obj(json.loads(row[0])).get("source") != source.descriptor
            ):
                raise ValueError(
                    "Source descriptor, date or licensing changed in SQLite"
                )
            checked_sources += 1
        for identifier in sorted(new_ids):
            entry = projection.entries[identifier]
            row = db.execute(
                "SELECT canonical_name, metadata_json FROM knowledge_entities WHERE id=?",
                (identifier,),
            ).fetchone()
            if row is None or row[0] != entry.title:
                raise ValueError("Source title changed")
            metadata = obj(json.loads(row[1]))
            if (
                metadata.get("reviewStatus") != "requires-review"
                or metadata.get("coverage") != entry.coverage
            ):
                raise ValueError("Source review/completeness was promoted")
            links = db.execute(
                "SELECT substr(link_type,11), chunk_id FROM definition_reference_links "
                "WHERE entity_id=? ORDER BY id",
                (identifier,),
            ).fetchall()
            if links != entry.links:
                raise ValueError("Source card lost or reordered its context blocks")
            checked_links += len(links)
            cards.append(
                {
                    "id": identifier,
                    "title": entry.title,
                    "coverage": entry.coverage,
                    "blocks": [
                        {
                            "chunkId": chunk_id,
                            "role": role,
                            "sourceId": projection.chunks[chunk_id][0].id,
                            "characters": len(
                                projection.chunks[chunk_id][1].original_text
                            ),
                            "sha256": hashlib.sha256(
                                projection.chunks[chunk_id][1].original_text.encode()
                            ).hexdigest(),
                        }
                        for role, chunk_id in entry.links
                    ],
                }
            )
    report = {
        "selectedRecords": expected_count,
        "newRecords": len(new_ids),
        "sourceBlocksCompared": len(projection.chunks),
        "sourceDescriptorsCompared": checked_sources,
        "newCardLinksCompared": checked_links,
        "selectedIdentitySetExact": True,
        "sourceTextAndMetadataExact": True,
        "previousInputsUnchanged": True,
        "archivedArticleReplayExact": True,
        "wikipediaRecords": 0,
        "approvedFactsOrRelations": 0,
        "integrity": "ok",
        "foreignKeyViolations": 0,
        "networkRequests": 0,
        "boundary": "Source fidelity, not clinical review, current-guideline approval or search relevance.",
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    cards_path.parent.mkdir(parents=True, exist_ok=True)
    cards_path.write_text(json.dumps(cards, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--selected", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--cards", type=Path, required=True)
    args = parser.parse_args()

    def guard(event: str, _args: object) -> None:
        if event in {"socket.connect", "socket.__new__", "socket.getaddrinfo"}:
            raise RuntimeError("Offline source verification forbids networking")

    sys.addaudithook(guard)
    verify(args.root.resolve(), args.selected, args.database, args.report, args.cards)


if __name__ == "__main__":
    main()
