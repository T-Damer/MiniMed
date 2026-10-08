"""Write the КР glossary shards (`kr_registry_glossary`) with exact reader anchors and a report.

    uv run --project tools/ingest python -m localmed_ingest.kr_registry_cli \
      --root <checkout with data/raw> --edition minimed.definition.kr-glossary.2026-10-08 \
      --output-prefix content/definition-drafts/kr-registry-glossary-2026.10.08 \
      --report docs/research/kr-glossary-extraction-2026-10-08.json \
      --reader-databases data/build/official-clinical-documents-merged/databases

Inputs are read-only. Outputs must be new paths (editions are immutable).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any

from .kr_registry_glossary import (
    SECTION_DISEASE,
    SECTION_TERMS,
    Entry,
    ExtractionStats,
    FoldedEntry,
    RegistryDocument,
    build_shard,
    extract_document,
    fold_entries,
    normalized,
    read_registry_document,
    section_paragraphs,
)

SECTION_TITLES = ("Термины и определения", "1.1 Определение заболевания или состояния")
ANCHOR_PROBE = 160
SHARD_BYTES = 6 * 1024 * 1024


def probe(text: str) -> str:
    return normalized(text)[:ANCHOR_PROBE]


def find_database(code_version: str, directories: list[Path]) -> Path | None:
    for directory in directories:
        for path in sorted(directory.glob(f"clinical-{code_version}-clinical-*.db")):
            return path
    return None


def reader_chunks(database: Path) -> list[tuple[str, str, str, str, str]]:
    """(normalized text, chunk id, anchor, document version id, section title) per chunk."""
    uri = f"{database.resolve().as_uri()}?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        rows = connection.execute(
            "SELECT c.original_text, c.id, c.anchor, c.document_version_id, s.title "
            "FROM chunks c JOIN sections s ON s.id = c.section_id "
            f"WHERE s.title IN ({','.join('?' * len(SECTION_TITLES))}) "
            "ORDER BY s.order_index, c.order_index",
            SECTION_TITLES,
        ).fetchall()
    return [(normalized(row[0]), row[1], row[2], row[3], row[4]) for row in rows]


def resolve_anchors(
    entries: list[Entry], directories: list[Path]
) -> tuple[dict[tuple[str, str], dict[str, str]], Counter[str]]:
    """The installed reader's chunk that holds each paragraph, keyed like `build_shard`."""
    anchors: dict[tuple[str, str], dict[str, str]] = {}
    outcome: Counter[str] = Counter()
    cache: dict[str, list[tuple[str, str, str, str, str]] | None] = {}
    for entry in entries:
        code = entry.document.code_version
        if code not in cache:
            database = find_database(code, directories)
            cache[code] = reader_chunks(database) if database else None
        chunks = cache[code]
        if chunks is None:
            outcome["no-reader-document"] += 1
            continue
        needle = probe(entry.text)
        section = SECTION_TITLES[0] if entry.section == SECTION_TERMS else SECTION_TITLES[1]
        match = next((c for c in chunks if c[4] == section and needle in c[0]), None)
        if match is None:
            outcome["paragraph-not-in-reader-chunks"] += 1
            continue
        anchors[(code, needle)] = {"anchor": match[2]}
        outcome["anchored"] += 1
    return anchors, outcome


def split_shards(shard: dict[str, Any], *, limit: int = SHARD_BYTES) -> list[dict[str, Any]]:
    """Cut a shard at term boundaries so each file stays far below the 16 MiB input cap."""
    terms: list[dict[str, Any]] = shard["terms"]
    blocks = {block["id"]: block for block in shard["blocks"]}
    parts: list[dict[str, Any]] = []
    current_terms: list[dict[str, Any]] = []
    current_blocks: list[dict[str, Any]] = []
    size = 4096

    def flush() -> None:
        nonlocal current_terms, current_blocks, size
        if not current_terms:
            return
        renumber = {old["id"]: index for index, old in enumerate(current_blocks, 1)}
        parts.append(
            {
                **{k: v for k, v in shard.items() if k not in {"terms", "blocks", "id"}},
                "id": f"{shard['id']}.part-{len(parts) + 1:02d}",
                "blocks": [{**old, "id": renumber[old["id"]]} for old in current_blocks],
                "terms": [
                    {**term, "blockIds": [renumber[i] for i in term["blockIds"]]}
                    for term in current_terms
                ],
            }
        )
        current_terms, current_blocks, size = [], [], 4096

    for term in terms:
        term_blocks = [blocks[i] for i in term["blockIds"]]
        cost = len(json.dumps(term, ensure_ascii=False)) + sum(
            len(json.dumps(block, ensure_ascii=False)) for block in term_blocks
        )
        if current_terms and size + cost > limit:
            flush()
        current_terms.append(term)
        current_blocks.extend(term_blocks)
        size += cost
    flush()
    return parts


_NOT_APPLICABLE = re.compile(
    r"не\s+примен[яа]ю?тся|не\s+использ|не\s+вы?делен|не\s+требу|см\.?\s+раздел|"
    r"специфическ\w+\s+термин|новые\s+и\s+узконаправленные",
    re.IGNORECASE,
)


def glossary_gaps(documents: list[RegistryDocument]) -> dict[str, object]:
    """Why current recommendations have no extracted glossary term, by reason and code."""
    reasons: dict[str, list[str]] = {"section-empty": [], "states-no-terms": [], "unparsed": []}
    for document in documents:
        paragraphs = section_paragraphs(document.sections.get(SECTION_TERMS, ""))
        body = " ".join(paragraph.text for paragraph in paragraphs)
        if not body.strip():
            reasons["section-empty"].append(document.code_version)
        elif _NOT_APPLICABLE.search(body):
            reasons["states-no-terms"].append(document.code_version)
        else:
            reasons["unparsed"].append(document.code_version)
    return {"count": sum(len(codes) for codes in reasons.values()), **reasons}


def build_report(
    stats: ExtractionStats,
    folded: list[FoldedEntry],
    anchors: Counter[str],
    documents: list[RegistryDocument],
) -> dict[str, object]:
    current = {d.code_version for d in documents if d.current}
    with_section = {d.code_version for d in documents if SECTION_TERMS in d.sections}
    extracted = {
        member.document.code_version
        for item in folded
        for member in item.entries
        if member.section == SECTION_TERMS
    }
    gaps = glossary_gaps([d for d in documents if d.current and d.code_version not in extracted])
    return {
        "format": "minimed-kr-registry-glossary-v1",
        "registryDocuments": len(documents),
        "currentEditions": len(current),
        "documentsWithTermsSection": len(with_section),
        "documentsWithExtractedTerms": len(extracted),
        "currentEditionsWithExtractedTerms": len(extracted & current),
        "currentEditionsWithoutTerms": gaps,
        "diseaseDefinitionSection": SECTION_DISEASE,
        "paragraphs": stats.paragraphs,
        "entriesBeforeFolding": stats.entries,
        "entriesAfterFolding": len(folded),
        "foldedFromSeveralRecommendations": sum(
            1 for item in folded if len({m.document.code_version for m in item.entries}) > 1
        ),
        "continuationParagraphs": stats.continuation_paragraphs,
        "unparsedParagraphs": stats.unparsed_paragraphs,
        "rejectedByReason": dict(sorted(stats.rejected.items())),
        "flags": dict(sorted(stats.flags.items())),
        "readerAnchors": dict(sorted(anchors.items())),
        "rejectedExamples": dict(sorted(stats.rejected_examples.items())),
        "unparsedExamples": stats.unparsed_examples,
    }


def extract_registry(
    root: Path, raw: Path, reader_databases: list[Path], edition: str
) -> tuple[list[dict[str, Any]], dict[str, object]]:
    """Version-3 shards (split below the input cap) and the measured report, nothing written."""
    stats = ExtractionStats()
    documents: list[RegistryDocument] = []
    entries: list[Entry] = []
    for path in sorted((root / raw).glob("*.json")):
        document = read_registry_document(path, root)
        documents.append(document)
        entries.extend(extract_document(document, stats))
    anchors, outcome = resolve_anchors(entries, reader_databases)
    folded = fold_entries(entries)
    shard = build_shard(folded, edition=edition, anchors=anchors)
    return split_shards(shard), build_report(stats, folded, outcome, documents)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="checkout that holds data/raw")
    parser.add_argument("--raw", type=Path, default=Path("data/raw/official-clinical-documents"))
    parser.add_argument("--reader-databases", type=Path, nargs="*", default=[])
    parser.add_argument("--edition", required=True)
    parser.add_argument("--output-prefix", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("Choose a new report path")
    parts, report = extract_registry(
        args.root.resolve(), args.raw, list(args.reader_databases), args.edition
    )
    written: list[dict[str, object]] = []
    for part in parts:
        suffix = str(part["id"]).rsplit(".", 1)[-1]
        target = args.output_prefix.with_name(f"{args.output_prefix.name}.{suffix}.json")
        if target.exists():
            raise FileExistsError(target)
        payload = json.dumps(part, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        target.write_bytes(payload)
        written.append({"path": target.name, "bytes": len(payload), "entries": len(part["terms"])})
    report["shards"] = written
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    summary = {k: v for k, v in report.items() if not k.endswith("Examples")}
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
