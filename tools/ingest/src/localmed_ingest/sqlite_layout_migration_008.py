"""Repack an existing content pack into 64 KiB pages without changing its logical content."""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import cast

from .edition_manifest import sha256_file

MIGRATION_ID = "008-opfs-page-layout"
PAGE_SIZE = 65536


def migrate_sqlite_layout(source: Path, output: Path, expected_checksum: str) -> dict[str, object]:
    source, output = source.resolve(), output.resolve()
    if source == output:
        raise ValueError("Use a separate staged output for the page-layout migration.")
    if sha256_file(source) != expected_checksum:
        raise ValueError("Source pack checksum does not match its report.")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".partial")
    if temporary.exists():
        raise ValueError(f"A staged output already exists: {temporary}")
    shutil.copyfile(source, temporary)
    try:
        with closing(sqlite3.connect(temporary)) as connection:
            previous_page_size = connection.execute("PRAGMA page_size").fetchone()[0]
            connection.execute(f"PRAGMA page_size = {PAGE_SIZE}")
            connection.execute("VACUUM")
            if (
                connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok"
                or connection.execute("PRAGMA foreign_key_check").fetchone()
            ):
                raise ValueError("Page-layout migration failed SQLite integrity checks.")
        if sha256_file(source) != expected_checksum:
            raise ValueError("Source pack changed during the page-layout migration.")
        temporary.replace(output)
        return {
            "migration": MIGRATION_ID,
            "inputChecksum": expected_checksum,
            "outputChecksum": sha256_file(output),
            "previousPageSize": previous_page_size,
            "pageSize": PAGE_SIZE,
            "inputBytes": source.stat().st_size,
            "outputBytes": output.stat().st_size,
            "sqliteIntegrity": "ok",
            "foreignKeyViolations": 0,
        }
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--source-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    loaded: object = json.loads(args.source_report.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict):
        raise ValueError("Source report must contain an outputChecksum.")
    report = cast(dict[str, object], loaded)
    checksum = report.get("outputChecksum")
    if not isinstance(checksum, str):
        raise ValueError("Source report must contain an outputChecksum.")
    migration = migrate_sqlite_layout(args.input, args.output, checksum)
    report["outputChecksum"] = migration["outputChecksum"]
    report["sqlitePageLayoutMigration"] = migration
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(migration, ensure_ascii=False))


if __name__ == "__main__":
    main()
