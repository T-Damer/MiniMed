"""Build an alias-only dictionary as its own compose input.

The core's Russian vocabulary layer (AGENTS.md: aliases are the intended Russian vocabulary layer)
comes from committed alias YAML files, not from documents: the `aliases` table has no document
foreign key, and a search resolves an alias's canonical term to whichever document's text matches
it at query time. Two inputs use this script:

- `content/colloquial-aliases.yaml`: 45 colloquial-to-clinical rows (`alias.colloquial.*`:
  abbreviations of laboratory tests, lay phrasing of symptoms and findings). They were written
  alongside the retired 15-card pilot pack (`alias.pilot.*` before the 2026-10-02 core rebuild) and
  outlive it; see docs/research/pilot-corpus-retired-2026-10-02.md.
- `data/build/medication-source-aliases.yaml`: source-listed medicine names projected onto the
  existing INN pointers (`localmed_ingest.medication_aliases`).

The script writes a minimal, schema-compatible SQLite file with only the `aliases` table populated
(`compose` copies alias rows unconditionally) plus the `schema_migrations`/`app_metadata`/
`content_packs` scaffolding rows `medbase compose` expects. It is a hashed build stage over a
committed file, not an edit of any built pack.

Usage:
    uv run --project tools/ingest python tools/ingest/scripts/build_alias_pack.py \
        --aliases content/colloquial-aliases.yaml \
        --output data/build/colloquial-aliases.db \
        --report data/build/colloquial-aliases-report.json \
        --edition-id minimed.core.vocabulary \
        --edition-version 0.6.47 \
        --built-at 2026-10-02T00:00:00Z
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

import yaml

from localmed_ingest.models import Alias
from localmed_ingest.sqlite_builder import schema_sql


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return f"sha256:{digest.hexdigest()}"


def build_alias_pack(
    aliases_path: Path,
    output: Path,
    *,
    edition_id: str,
    edition_version: str,
    schema_version: int,
    built_at: str,
    allow_empty: bool = False,
    title: str = "Поисковый словарь ядра",
) -> dict[str, object]:
    aliases_path = aliases_path.resolve()
    output = output.resolve()
    payload = yaml.safe_load(aliases_path.read_text(encoding="utf-8")) or {}
    raw_aliases = payload.get("aliases", [])
    if not isinstance(raw_aliases, list) or (not raw_aliases and not allow_empty):
        raise ValueError(f"{aliases_path} has no aliases.")
    aliases = [Alias.model_validate(item) for item in raw_aliases]
    ids = [alias.id for alias in aliases]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate alias id in alias pack.")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(f"{output.suffix}.tmp")
    temporary.unlink(missing_ok=True)
    connection = sqlite3.connect(temporary)
    try:
        connection.executescript(schema_sql(include_indexes=False))
        connection.execute("BEGIN")
        connection.execute(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
            (schema_version, built_at),
        )
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('schema_version', ?)",
            (str(schema_version),),
        )
        connection.execute(
            "INSERT INTO app_metadata(key, value) VALUES ('publication_state', 'local-dev')"
        )
        connection.execute(
            """INSERT INTO content_packs(
                id, version, schema_version, title, checksum, installed_at, enabled
            )
            VALUES (?, ?, ?, ?, '', ?, 1)""",
            (
                edition_id,
                edition_version,
                schema_version,
                title,
                built_at,
            ),
        )
        connection.executemany(
            """INSERT INTO aliases(id, canonical_term, alias, category, weight)
            VALUES (?, ?, ?, ?, ?)""",
            [
                (alias.id, alias.canonical_term, alias.alias, alias.category, alias.weight)
                for alias in aliases
            ],
        )
        connection.commit()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        fk_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or fk_violations:
            raise ValueError(f"Alias pack failed integrity checks: {integrity}")
    except Exception:
        connection.close()
        temporary.unlink(missing_ok=True)
        raise
    connection.close()
    temporary.replace(output)

    return {
        "source": str(aliases_path),
        "sourceSha256": _sha256_file(aliases_path),
        "aliasCount": len(aliases),
        "categories": sorted({alias.category for alias in aliases if alias.category}),
        "outputChecksum": _sha256_file(output),
        "sqliteIntegrity": "ok",
        "foreignKeyViolations": 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aliases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--edition-id", default="minimed.core.vocabulary")
    parser.add_argument("--edition-version", required=True)
    parser.add_argument("--schema-version", type=int, default=2)
    parser.add_argument("--built-at", required=True)
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Accept an alias file without rows (every name is already in the pinned pointers).",
    )
    parser.add_argument("--title", default="Поисковый словарь ядра")
    args = parser.parse_args()
    report = build_alias_pack(
        args.aliases,
        args.output,
        edition_id=args.edition_id,
        edition_version=args.edition_version,
        schema_version=args.schema_version,
        built_at=args.built_at,
        allow_empty=args.allow_empty,
        title=args.title,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
