"""Report what each pilot-vocabulary alias resolves to in a built candidate core.db.

There is no target-document field on an alias row (see build_pilot_vocabulary_pack.py) -- a
search engine matches an alias's canonicalTerm against whichever document's text contains it, at
query time. So "retargeting" an alias that used to route toward a removed public-pilot document
means checking, read-only, which surviving document (a kr.rf.* clinical pointer, an esklp.mnn.*
medication pointer, or an MKB reference pointer) its canonicalTerm phrase now resolves to via the
same lexical FTS the app uses, and recording that -- not rewriting a field that never existed.

For each alias in content/pilot-rf/aliases.yaml, this runs `chunks_fts MATCH` for the
canonicalTerm against a built candidate's chunks_fts (external-content, joined back to
documents/catalogFamily), picks the top bm25 hit, and records its resolved target id/family/title.
Falls back to individual significant words (dropping stopword-length tokens) when the full phrase
has no hit, and records "no-lexical-match" when nothing matches at all.

Usage:
    uv run --project tools/ingest python \
        tools/ingest/scripts/report_pilot_vocabulary_retargeting.py \
        --aliases content/pilot-rf/aliases.yaml \
        --candidate data/build/core.<version>.no-pilot.db \
        --report data/build/pilot-vocabulary-retargeting-report.json
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

import yaml


def _fts_query(phrase: str) -> str:
    tokens = [token for token in phrase.replace('"', " ").split() if token]
    return " OR ".join(f'"{token}"' for token in tokens) if tokens else phrase


def _best_match(connection: sqlite3.Connection, phrase: str) -> dict[str, object] | None:
    query = _fts_query(phrase)
    if not query:
        return None
    rows = connection.execute(
        """SELECT d.id, d.title, json_extract(d.metadata_json, '$.catalogFamily') AS family,
                  json_extract(d.metadata_json, '$.targetDocumentId') AS target,
                  bm25(chunks_fts) AS score
           FROM chunks_fts
           JOIN chunks c ON c.id = chunks_fts.chunk_id
           JOIN document_versions dv ON dv.id = c.document_version_id
           JOIN documents d ON d.id = dv.document_id
           WHERE chunks_fts MATCH ?
           ORDER BY score
           LIMIT 1""",
        (query,),
    ).fetchall()
    if not rows:
        return None
    doc_id, title, family, target, score = rows[0]
    return {
        "documentId": doc_id,
        "title": title,
        "catalogFamily": family,
        "targetDocumentId": target,
        "bm25": score,
    }


def report_retargeting(aliases_path: Path, candidate_path: Path) -> dict[str, object]:
    payload = yaml.safe_load(aliases_path.read_text(encoding="utf-8")) or {}
    aliases = payload.get("aliases", [])
    connection = sqlite3.connect(f"file:{candidate_path.resolve()}?mode=ro", uri=True)
    rows: list[dict[str, object]] = []
    resolved = 0
    unresolved = 0
    for alias in aliases:
        canonical_term = str(alias.get("canonicalTerm", ""))
        match = _best_match(connection, canonical_term)
        if match is None:
            unresolved += 1
            rows.append(
                {
                    "id": alias.get("id"),
                    "category": alias.get("category"),
                    "alias": alias.get("alias"),
                    "canonicalTerm": canonical_term,
                    "resolvesTo": None,
                    "status": "no-lexical-match",
                }
            )
            continue
        resolved += 1
        rows.append(
            {
                "id": alias.get("id"),
                "category": alias.get("category"),
                "alias": alias.get("alias"),
                "canonicalTerm": canonical_term,
                "resolvesTo": match,
                "status": "resolved",
            }
        )
    return {
        "aliasesSource": str(aliases_path),
        "candidate": str(candidate_path),
        "totalAliases": len(aliases),
        "resolved": resolved,
        "unresolved": unresolved,
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aliases", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    report = report_retargeting(args.aliases, args.candidate)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {k: v for k, v in report.items() if k != "rows"},
            ensure_ascii=False,
            indent=2,
        )
    )
    if report["unresolved"]:
        print(f"WARNING: {report['unresolved']} alias(es) have no lexical match in the candidate.")


if __name__ == "__main__":
    main()
