"""Repair the glued dosages of the released ЕСКЛП medication modules (STATE DOSE1).

Local-only and deterministic; the rules live in `localmed_ingest.esklp_strength` and
`localmed_ingest.esklp_strength_repair`.

    cd tools/ingest
    uv run python scripts/repair_esklp_strengths.py scan  --dir DIR
    uv run python scripts/repair_esklp_strengths.py repairs --published DIR --out strength-repairs.json
    uv run python scripts/repair_esklp_strengths.py apply --original DIR --published DIR \
        --work DIR --out DIR --report FILE

* `--original`: the modules as the ЕСКЛП build wrote them, before search compaction
  (`data/build/release-esklp` of the main checkout);
* `--published`: the decoded modules the catalog serves today (ATC2/ATC3 patched, compacted).

`scan` counts the cards and chunks that still show the glue («1.0325 мг+10 мг+20 мг», «1.0~») or the
literal «НЕ УКАЗАНО` in one directory of module databases. `apply` rebuilds each module from the
original, carries the published metadata over (so the ATC fill stays), repairs it, and runs the
same search compaction that produced the published module. It refuses to continue unless the
original and the published module agree on every id and text, and the index text rebuilt for every
chunk equals the stored one. Afterwards it compares the result with the published module: only
`documents.metadata_json` and the text of the touched chunks may differ.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any, cast

from localmed_ingest.esklp_strength import is_unstated
from localmed_ingest.esklp_strength_repair import (
    GLUE_IN_TEXT,
    UNSTATED_LITERAL,
    card_residue,
    index_text,
    metadata_dump,
    repair_card_metadata,
    repair_chunk_text,
)
from localmed_ingest.module_search_compaction import migrate_module_search

MODULE_GLOB = "minimed.medications.*.ru.db"


def modules(directory: Path) -> list[Path]:
    return sorted(
        path
        for path in directory.glob(MODULE_GLOB)
        if ".instructions." not in path.name and path.name != "minimed.medications.ru.db"
    )


def connect_ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def scan_module(path: Path) -> Counter[str]:
    """Counts of the places that still show the glue or an unstated dosage."""
    counts: Counter[str] = Counter()
    with closing(connect_ro(path)) as connection:
        for _id, raw in connection.execute("SELECT id, metadata_json FROM documents"):
            metadata = json.loads(raw)
            counts["cards"] += 1
            strengths = cast(list[str], metadata.get("strengths") or [])
            if any(GLUE_IN_TEXT.search(item) for item in strengths):
                counts["cardsGlueInStrengths"] += 1
            if any(is_unstated(item) for item in strengths):
                counts["cardsUnstatedInStrengths"] += 1
            glued_nodes = False
            for node in cast(list[dict[str, Any]], metadata.get("smnnNodes") or []):
                values = [node.get("strength")] + [
                    trade.get("strength") for trade in node.get("tradeNames") or []
                ]
                if any(isinstance(v, str) and GLUE_IN_TEXT.search(v) for v in values):
                    glued_nodes = True
                if any(isinstance(v, str) and is_unstated(v) for v in values):
                    counts["cardsUnstatedInNodes"] += 1
                    break
            if glued_nodes:
                counts["cardsGlueInNodes"] += 1
            if card_residue(metadata):
                counts["cardsAffected"] += 1
        for (text,) in connection.execute("SELECT original_text FROM chunks"):
            counts["chunks"] += 1
            if GLUE_IN_TEXT.search(text):
                counts["chunksGlueInText"] += 1
            if UNSTATED_LITERAL in text:
                counts["chunksUnstatedInText"] += 1
    return counts


def scan(directory: Path) -> dict[str, Any]:
    total: Counter[str] = Counter()
    per_module: dict[str, dict[str, int]] = {}
    for path in modules(directory):
        counts = scan_module(path)
        per_module[path.name.removeprefix("minimed.medications.").removesuffix(".ru.db")] = dict(
            counts
        )
        total.update(counts)
    return {"total": dict(total), "modules": per_module}


def table_digest(connection: sqlite3.Connection, table: str, skip: tuple[str, ...] = ()) -> str:
    columns = [
        row[1] for row in connection.execute(f"PRAGMA table_info({table})") if row[1] not in skip
    ]
    digest = hashlib.sha256()
    for row in connection.execute(f"SELECT {', '.join(columns)} FROM {table} ORDER BY 1"):
        digest.update(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def check_original_matches_published(original: Path, published: Path) -> None:
    """The original build and the published module hold the same ids and the same card text."""
    with closing(connect_ro(original)) as base, closing(connect_ro(published)) as final:
        query = "SELECT id, document_version_id, section_id, anchor, original_text FROM chunks"
        left = {row[0]: row[1:] for row in base.execute(query)}
        right = {row[0]: row[1:] for row in final.execute(query)}
        if left != right:
            raise SystemExit(f"{original.name}: original and published chunks differ.")
        for table in ("documents", "document_versions", "sections", "aliases", "content_packs"):
            skip = ("metadata_json",) if table == "documents" else ()
            if table_digest(base, table, skip) != table_digest(final, table, skip):
                raise SystemExit(f"{original.name}: table {table} differs from the published one.")


def check_index_text(original: Path) -> int:
    """`index_text` rebuilds the stored `normalized_text` of every chunk of the original."""
    checked = 0
    with closing(connect_ro(original)) as connection:
        for chunk_id, title, path_json, text, stored in connection.execute(
            "SELECT c.id, d.title, s.path_json, c.original_text, c.normalized_text FROM chunks c "
            "JOIN sections s ON s.id = c.section_id "
            "JOIN document_versions v ON v.id = c.document_version_id "
            "JOIN documents d ON d.id = v.document_id"
        ):
            built = index_text(f"{title} {' '.join(json.loads(path_json))} {text}")
            if built != stored:
                raise SystemExit(f"{original.name}: index text of {chunk_id} is not reproducible.")
            checked += 1
    return checked


def repair_module(
    original: Path, published: Path, work: Path, out: Path
) -> tuple[dict[str, Any], set[str]]:
    check_original_matches_published(original, published)
    reproduced = check_index_text(original)
    shutil.copyfile(original, work)
    stats: Counter[str] = Counter()
    touched_chunks: set[str] = set()
    unresolved: list[str] = []
    with closing(connect_ro(published)) as final, closing(sqlite3.connect(work)) as connection:
        connection.execute("PRAGMA journal_mode = OFF")
        connection.execute("PRAGMA synchronous = OFF")
        changes_by_document: dict[str, dict[str, str | None]] = {}
        for document_id, raw in final.execute("SELECT id, metadata_json FROM documents"):
            metadata = json.loads(raw)
            repair = repair_card_metadata(metadata)
            unresolved.extend(repair.unresolved)
            changes_by_document[str(document_id)] = repair.changes
            if repair.changed:
                stats["cardsRepaired"] += 1
                stats["nodeStrengths"] += repair.node_strengths
                stats["tradeStrengths"] += repair.trade_strengths
                stored = metadata_dump(metadata)
            else:
                stored = str(raw)
            leftover = card_residue(metadata)
            if leftover:
                stats["cardsWithResidue"] += 1
                unresolved.extend(leftover)
            connection.execute(
                "UPDATE documents SET metadata_json = ? WHERE id = ?", (stored, document_id)
            )
        rows = list(
            connection.execute(
                "SELECT c.id, v.document_id, d.title, s.path_json, c.original_text "
                "FROM chunks c JOIN sections s ON s.id = c.section_id "
                "JOIN document_versions v ON v.id = c.document_version_id "
                "JOIN documents d ON d.id = v.document_id"
            )
        )
        for chunk_id, document_id, title, path_json, text in rows:
            repaired = repair_chunk_text(text, changes_by_document.get(document_id, {}))
            if repaired == text:
                continue
            touched_chunks.add(chunk_id)
            searchable = index_text(f"{title} {' '.join(json.loads(path_json))} {repaired}")
            connection.execute(
                "UPDATE chunks SET original_text = ?, normalized_text = ? WHERE id = ?",
                (repaired, searchable, chunk_id),
            )
            # The original build keeps its own copy of the indexed text; the compaction below
            # compares the old index with the rebuilt one, so both must carry the new text.
            connection.execute(
                "UPDATE chunks_fts SET normalized_text = ? WHERE chunk_id = ?",
                (searchable, chunk_id),
            )
        connection.commit()
    compaction = migrate_module_search(work, out)
    stats["chunksRepaired"] = len(touched_chunks)
    stats["indexTextVerified"] = reproduced
    return {
        "stats": dict(stats),
        "unresolved": sorted(set(unresolved)),
        "compaction": {
            key: compaction[key]
            for key in ("outputBytes", "indexInstances", "chunks", "sourceTextSha256")
        },
    }, touched_chunks


def compare_with_published(published: Path, out: Path, touched: set[str]) -> dict[str, Any]:
    """Only the metadata of repaired cards and the text of the touched chunks may differ."""
    with closing(connect_ro(published)) as before, closing(connect_ro(out)) as after:
        if table_digest(before, "sections") != table_digest(after, "sections"):
            raise SystemExit(f"{out.name}: sections differ from the published module.")
        for table in ("document_versions", "aliases", "content_packs", "app_metadata"):
            if table_digest(before, table) != table_digest(after, table):
                raise SystemExit(f"{out.name}: {table} differs from the published module.")
        if table_digest(before, "documents", ("metadata_json",)) != table_digest(
            after, "documents", ("metadata_json",)
        ):
            raise SystemExit(f"{out.name}: document columns other than metadata changed.")
        columns = "id, document_version_id, section_id, order_index, page_start, page_end, "
        columns += "char_start, char_end, previous_chunk_id, next_chunk_id, anchor, metadata_json"
        left = {row[0]: row for row in before.execute(f"SELECT {columns} FROM chunks")}
        right = {row[0]: row for row in after.execute(f"SELECT {columns} FROM chunks")}
        if left != right:
            raise SystemExit(f"{out.name}: chunk ids, order, anchors or spans changed.")
        texts_before = dict(before.execute("SELECT id, original_text FROM chunks"))
        texts_after = dict(after.execute("SELECT id, original_text FROM chunks"))
        changed = {key for key in texts_before if texts_before[key] != texts_after[key]}
        if changed != touched:
            raise SystemExit(f"{out.name}: changed chunks differ from the repaired set.")
        metadata_changed = sum(
            1
            for (a,), (b,) in zip(
                before.execute("SELECT metadata_json FROM documents ORDER BY id"),
                after.execute("SELECT metadata_json FROM documents ORDER BY id"),
                strict=True,
            )
            if a != b
        )
        if after.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit(f"{out.name}: integrity check failed.")
    return {"cardsWithNewMetadata": metadata_changed, "chunksWithNewText": len(changed)}


def write_repairs(published_dir: Path, out: Path) -> int:
    """`{card id: {glued dosage: repaired dosage}}` for the pin of the core's medication pointers."""
    repairs: dict[str, dict[str, str | None]] = {}
    for published in modules(published_dir):
        with closing(connect_ro(published)) as connection:
            for document_id, raw in connection.execute("SELECT id, metadata_json FROM documents"):
                # An unstated dosage needs no entry: the pin drops it from a title on its own.
                changes = {
                    old: new
                    for old, new in repair_card_metadata(json.loads(raw)).changes.items()
                    if new is not None and old.startswith("1.0")
                }
                if changes:
                    repairs[str(document_id)] = changes
    out.write_text(
        json.dumps(repairs, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    return len(repairs)


def apply(args: argparse.Namespace) -> None:
    original_dir, published_dir = Path(args.original), Path(args.published)
    work_dir, out_dir = Path(args.work), Path(args.out)
    work_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = Path(args.report)
    only = {name for name in (args.only or "").split(",") if name}
    # A rerun of some groups keeps the results of the others from the report of the earlier run.
    report: dict[str, Any] = (
        json.loads(report_path.read_text(encoding="utf-8"))
        if only and report_path.exists()
        else {"modules": {}}
    )
    for published in modules(published_dir):
        if only and not any(f".{name}.ru." in published.name for name in only):
            continue
        original = original_dir / published.name
        work, out = work_dir / published.name, out_dir / published.name
        work.unlink(missing_ok=True)
        out.unlink(missing_ok=True)
        result, touched = repair_module(original, published, work, out)
        result["comparison"] = compare_with_published(published, out, touched)
        work.unlink(missing_ok=True)
        report["modules"][published.name] = result
        print(published.name, json.dumps(result["stats"], ensure_ascii=False), flush=True)
    report["before"] = scan(published_dir)
    report["after"] = scan(out_dir)
    Path(args.report).write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"before": report["before"]["total"], "after": report["after"]["total"]}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    scanner = sub.add_parser("scan")
    scanner.add_argument("--dir", required=True)
    applier = sub.add_parser("apply")
    for name in ("original", "published", "work", "out", "report"):
        applier.add_argument(f"--{name}", required=True)
    applier.add_argument(
        "--only", help="comma-separated group names to (re)run, e.g. blood,various"
    )
    mapper = sub.add_parser("repairs")
    mapper.add_argument("--published", required=True)
    mapper.add_argument("--out", required=True)
    args = parser.parse_args()
    if args.command == "scan":
        print(json.dumps(scan(Path(args.dir)), ensure_ascii=False, indent=2))
    elif args.command == "repairs":
        print(write_repairs(Path(args.published), Path(args.out)), "cards with repaired dosages")
    else:
        apply(args)


if __name__ == "__main__":
    main()
