"""Build the pilot colloquial-vocabulary dictionary as its own compose input.

Why this exists (coordinator decision, 2026-09-27): removing the 15 public-pilot documents also
silently removed `content/pilot-rf/aliases.yaml` -- 45 rows across the `finding` (4),
`investigation` (6), `measurement` (5), `symptom` (25), and `treatment` (2) alias categories,
which were entirely absent from the pilot-removed candidate (confirmed by a full metadata/alias
audit, docs/research/core-build-reconstruction-2026-09-27.md). These 45 entries are a general
Russian colloquial-to-clinical vocabulary layer (AGENTS.md: "Aliases are the intended Russian
vocabulary layer") -- e.g. `alias.pilot.cant-drink`: alias "не может пить" -> canonicalTerm
"невозможность пить отказ от жидкости дегидратация". They are NOT tied to a specific document id
in the source YAML (there is no target-document field on an alias row at all -- the `aliases`
table has no document foreign key; a search engine resolves an alias's canonicalTerm to whichever
surviving document's text actually matches it, at query time). So there is nothing to rewrite
structurally here -- see `report_pilot_vocabulary_retargeting.py` for the read-only audit of what
each alias now resolves to in a built candidate.

This script builds a minimal, schema-compatible SQLite file containing ONLY the aliases table
populated (`compose`'s `aliases` TableSpec copies rows unconditionally, with no document-scoped
join -- catalog_module_builder.py's compose track already relies on this for its own per-pointer
aliases) plus the required `schema_migrations`/`app_metadata`/`content_packs` scaffolding rows
`medbase compose`'s `_validate_input` expects. It is a genuine, hashed build stage over the
already-committed `content/pilot-rf/aliases.yaml`, decoupled from `content/pilot-rf`'s markdown
documents -- not a hand-edit of any built pack.

Usage:
    uv run --project tools/ingest python tools/ingest/scripts/build_pilot_vocabulary_pack.py \
        --aliases content/pilot-rf/aliases.yaml \
        --output data/build/pilot-vocabulary.db \
        --report data/build/pilot-vocabulary-report.json \
        --edition-id minimed.pilot.vocabulary \
        --edition-version 2026.09.27 \
        --schema-version 2
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


def build_pilot_vocabulary_pack(
    aliases_path: Path,
    output: Path,
    *,
    edition_id: str,
    edition_version: str,
    schema_version: int,
    built_at: str,
) -> dict[str, object]:
    aliases_path = aliases_path.resolve()
    output = output.resolve()
    payload = yaml.safe_load(aliases_path.read_text(encoding="utf-8")) or {}
    raw_aliases = payload.get("aliases", [])
    if not isinstance(raw_aliases, list) or not raw_aliases:
        raise ValueError(f"{aliases_path} has no aliases.")
    aliases = [Alias.model_validate(item) for item in raw_aliases]
    ids = [alias.id for alias in aliases]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate alias id in pilot vocabulary.")

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
                "Пилотный словарь разговорной лексики",
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
            raise ValueError(f"Pilot vocabulary pack failed integrity checks: {integrity}")
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
    parser.add_argument("--edition-id", default="minimed.pilot.vocabulary")
    parser.add_argument("--edition-version", required=True)
    parser.add_argument("--schema-version", type=int, default=2)
    parser.add_argument("--built-at", required=True)
    args = parser.parse_args()
    report = build_pilot_vocabulary_pack(
        args.aliases,
        args.output,
        edition_id=args.edition_id,
        edition_version=args.edition_version,
        schema_version=args.schema_version,
        built_at=args.built_at,
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
