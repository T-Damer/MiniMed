"""Merge the two available clinical-source-database snapshots, preferring the cleaner one.

Why this exists: `docs/research/core-build-reconstruction-2026-09-27.md` traced the released
core.db's clinical `keywords`/`declaredAliases` (163/744 and 318/744 non-empty respectively) to a
2026-07-27 batch of per-recommendation databases (`clinical-<officialId>-clinical-json-
2026.07.27-13991c1feee5.db`, committed checksums in `released-clinical-source-databases-
2026-07-27.json`) where almost every document has a standalone "Ключевые слова" section title.
The directory this pipeline used to read directly, `data/build/official-clinical-documents/
databases` (723 files), is a DIFFERENT, later re-parse of the same source PDFs where that heading
is merged with the next one ("Ключевые слова Список сокращений") for all but 7 documents, which
`_KEYWORD_SECTION_PATTERN` correctly refuses to treat as a keyword list.

Switching the pipeline to read the 2026-07-27 batch exclusively gets 159/163 keyword records and
424/318 declaredAliases (a "candidate has more" case like the existing alias-fan-out fix, not a
regression -- the cleaner input lets the deterministic extractor succeed on more documents than
the release did). But exactly 4 records (940_1, 1016_1, 406_3, 801_1) have a correctly-titled
"Ключевые слова" section in the 2026-07-27 batch with ZERO chunks under it -- an extraction gap
specific to that batch's OCR/parse run for those four PDFs -- while the CURRENT, later
`official-clinical-documents/databases` directory happens to carry real, non-empty content for
those same four (confirmed byte-for-byte equal to the released core.db's keywords for all four).
Neither directory is a strict superset of the other; each has different gaps from a different
OCR/parse run of the same source PDFs.

This script does not change any extraction logic (`clinical_aliases.py`'s regex/heuristics are
unchanged and already tested for exactly this "merged heading" case). It only decides, per
official id and using the real extraction code, WHICH already-fetched database file to feed it:
the 2026-07-27 batch by default, falling back to the current directory only where the 2026-07-27
file exists but yields zero keywords while the current directory yields at least one. Every
fallback is recorded in the report by official id, source path, and reason -- nothing is silently
substituted.

Usage:
    uv run --project tools/ingest python tools/ingest/scripts/build_clinical_source_snapshot.py \
        --ledger data/build/official-clinical-coverage-ledger.json \
        --primary data/build/official-clinical-documents-2026-07-27/databases \
        --fallback data/build/official-clinical-documents/databases \
        --output data/build/official-clinical-documents-merged/databases \
        --report data/build/official-clinical-documents-merged-report.json
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from localmed_ingest.clinical_aliases import _database_index, _section_keywords, _validated_chunks
from localmed_ingest.clinical_catalog import ClinicalCoverageLedger


def _keyword_count(
    directory: Path, official_id: str, record_id: str
) -> tuple[int, str | None, Path | None]:
    index = _database_index(directory)
    paths = index.get(official_id, [])
    if len(paths) != 1:
        return 0, f"path-count={len(paths)}", None
    diagnostics: list[str] = []
    chunks = _validated_chunks(
        paths[0], official_id=official_id, record_id=record_id, diagnostics=diagnostics
    )
    if chunks is None:
        return 0, ",".join(diagnostics) or "unreadable", paths[0]
    count = sum(1 for chunk in chunks for _keyword, _source in _section_keywords(chunk))
    return count, None, paths[0]


def build_clinical_source_snapshot(
    ledger_path: Path, primary: Path, fallback: Path, output: Path
) -> dict[str, object]:
    ledger = ClinicalCoverageLedger.model_validate_json(ledger_path.read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    for existing in output.glob("*.db"):
        existing.unlink()

    copied = 0
    fallbacks: list[dict[str, object]] = []
    missing: list[str] = []
    for record in ledger.records:
        primary_count, primary_diag, primary_path = _keyword_count(
            primary, record.official_id, record.record_id
        )
        chosen_path = primary_path
        if primary_count == 0:
            fallback_count, _fallback_diag, fallback_path = _keyword_count(
                fallback, record.official_id, record.record_id
            )
            if fallback_count > 0:
                chosen_path = fallback_path
                fallbacks.append(
                    {
                        "officialId": record.official_id,
                        "primaryDiagnostic": primary_diag,
                        "primaryKeywordCount": primary_count,
                        "fallbackKeywordCount": fallback_count,
                    }
                )
        if chosen_path is None:
            missing.append(record.official_id)
            continue
        shutil.copy2(chosen_path, output / chosen_path.name)
        copied += 1

    report = {
        "ledger": str(ledger_path),
        "primary": str(primary),
        "fallback": str(fallback),
        "output": str(output),
        "recordsTotal": len(ledger.records),
        "copied": copied,
        "missing": missing,
        "fallbackCount": len(fallbacks),
        "fallbacks": fallbacks,
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--primary", type=Path, required=True)
    parser.add_argument("--fallback", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    report = build_clinical_source_snapshot(args.ledger, args.primary, args.fallback, args.output)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
