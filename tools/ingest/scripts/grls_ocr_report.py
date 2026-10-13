"""OCR1 measurements: the OCR-derived GRLS instruction texts before and after the cleanup stage.

    cd tools/ingest
    MINIMED_DATA_ROOT=<main checkout> uv run python scripts/grls_ocr_report.py [--out report.json]

Before = the prepared Markdown the released modules were built from (manifest `workspace`), after = the
re-prepared workspace named by the overlay. The same measures run on both: unknown-word ratio against the
native-text lexicon, stamp lines left in the body, paragraph shape, how many documents with three or more
pages have the dosage / indications / contraindications sections, plus kinds, grades and confidence coverage.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
from collections import Counter
from pathlib import Path
from typing import Any, cast

from localmed_ingest.grls_ocr_requality import plain_text, read_jsonl, split_markdown
from localmed_ingest.markdown_parser import expand_grls_instruction_sections, parse_sections
from localmed_ingest.ocr_text_cleanup import Lexicon, stamp_kind
from localmed_ingest.sqlite_builder import repository_root

REPO = Path(os.environ.get("MINIMED_DATA_ROOT", repository_root()))
BUILD = REPO / "data" / "build"
WORD = re.compile(r"[а-яёА-ЯЁ]{4,}")
TERMINAL = re.compile(r"[.!?:;»)]\s*$")


def measure(documents: list[tuple[str, int, bool]], lexicon: Lexicon) -> dict[str, Any]:
    """`documents` are (Markdown body, page count, is an instruction)."""
    words = unknown = stamps = paragraphs = unterminated = 0
    lengths: list[int] = []
    ratios: list[float] = []
    sections: Counter[str] = Counter()
    long_documents = 0
    for body, pages, is_instruction in documents:
        text = plain_text(body)
        doc_words = [w.casefold() for w in WORD.findall(text)]
        doc_unknown = sum(1 for w in doc_words if lexicon.cyrillic.get(w, 0) < 3)
        words += len(doc_words)
        unknown += doc_unknown
        if doc_words:
            ratios.append(doc_unknown / len(doc_words))
        found: set[str] = set()
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            if stamp_kind(line) is not None:
                stamps += 1
            paragraphs += 1
            lengths.append(len(line))
            unterminated += 0 if TERMINAL.search(line) else 1
        if pages >= 3 and is_instruction:
            # the builder's own segmentation: Markdown headings plus inline standard headings
            found = {
                section.section_type
                for section in expand_grls_instruction_sections(parse_sections(body))
                if section.section_type
            }
            long_documents += 1
            for name in ("dosage", "indications", "contraindications"):
                sections[name] += name in found
    return {
        "documents": len(documents),
        "words": words,
        "unknownWordRatioOverall": round(unknown / words, 4) if words else None,
        "unknownWordRatioMedian": round(statistics.median(ratios), 4) if ratios else None,
        "stampLinesInBody": stamps,
        "paragraphs": paragraphs,
        "paragraphMedianChars": statistics.median(lengths) if lengths else None,
        "paragraphsWithoutTerminalPunctuation": round(unterminated / paragraphs, 3)
        if paragraphs
        else None,
        "documentsWith3PlusPages": long_documents,
        "sectionCoverage": {k: round(v / long_documents, 3) for k, v in sections.items()}
        if long_documents
        else {},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest", type=Path, default=BUILD / "grls-instruction-text-manifest.jsonl"
    )
    parser.add_argument("--overlay", type=Path, default=BUILD / "grls-ocr-quality.jsonl")
    parser.add_argument("--lexicon", type=Path, default=BUILD / "grls-ocr-lexicon.json")
    parser.add_argument("--out", type=Path, default=BUILD / "grls-ocr-report.json")
    args = parser.parse_args()
    lexicon = Lexicon.from_json(json.loads(args.lexicon.read_text(encoding="utf-8")))
    manifest = {str(r["sourceId"]): r for r in read_jsonl(args.manifest) if r.get("sourceId")}
    overlay = read_jsonl(args.overlay)
    before: list[tuple[str, int, bool]] = []
    after: list[tuple[str, int, bool]] = []
    grades: Counter[str] = Counter()
    kinds_before: Counter[str] = Counter()
    kinds_after: Counter[str] = Counter()
    confidence_before = confidence_after = 0
    uncertain = edits = marks = replaced = 0
    for row in overlay:
        source_id = str(row["sourceId"])
        old = manifest[source_id]
        old_path = (REPO / "tools" / "ingest" / str(old["workspace"])).resolve() / f"{source_id}.md"
        new_path = (REPO / "tools" / "ingest" / str(row["workspace"])).resolve() / f"{source_id}.md"
        pages = int(row.get("pageCount") or 1)
        instruction = row.get("documentKind") in {"national-instruction", "leaflet", "ohlp"}
        before.append((split_markdown(old_path.read_text("utf-8"))[1], pages, instruction))
        after.append((split_markdown(new_path.read_text("utf-8"))[1], pages, instruction))
        kinds_before[str(old.get("documentKind") or "unknown")] += 1
        kinds_after[str(row.get("documentKind"))] += 1
        grades[
            str(
                row.get("ocrQuality")
                or ("sibling-text-layer" if row.get("textSource") else "native")
            )
        ] += 1
        confidence_before += old.get("ocrMeanConfidence") is not None
        confidence_after += row.get("ocrMeanConfidence") is not None
        uncertain += int(row.get("uncertainNumbers") or 0)
        edits += int(row.get("wordEdits") or 0)
        marks += int(row.get("pageMarks") or 0)
        replaced += bool(row.get("textSource"))
    report = {
        "documents": len(overlay),
        "pages": sum(p for _, p, _ in before),
        "before": measure(before, lexicon),
        "after": measure(after, lexicon),
        "kindsBefore": dict(kinds_before),
        "kindsAfter": dict(kinds_after),
        "qualityGrades": dict(grades),
        "documentsWithConfidenceBefore": confidence_before,
        "documentsWithConfidenceAfter": confidence_after,
        "uncertainNumbers": uncertain,
        "wordEdits": edits,
        "pageMarks": marks,
        "replacedByNativeText": replaced,
    }
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(cast(dict[str, Any], report), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
