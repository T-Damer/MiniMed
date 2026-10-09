"""Mine and recount the labels of the official clinical-recommendation template (STATE KR5).

Read-only on the raw files. Two modes over the raw JSON of the clinical recommendations the module
catalog lists as current (nothing is fetched):

* ``candidates``: the bold standalone lines (a paragraph all in bold, outside tables) counted by
  how many documents carry the same wording (normalised), with the section they sit in. This is the
  pool the curated list in ``clinical_template_labels.json`` was picked from by hand; evidence-level
  lines, table captions, per-document author lists and the like are in it too and are not labels.
* ``recount``: for the labels of the committed list, the number of documents that carry each one
  inside its section, and an example of the original wording. With ``--write`` the counts and
  examples are written back; without it the script only reports labels whose count fell under
  ``minDocuments`` or whose wording no longer occurs.

    uv run tools/ingest/scripts/mine_clinical_template_labels.py candidates \\
      --catalog apps/app/src/features/modules/catalog.preview.json \\
      --source-root data/raw/official-clinical-documents --min-documents 6
    uv run tools/ingest/scripts/mine_clinical_template_labels.py recount \\
      --catalog apps/app/src/features/modules/catalog.preview.json \\
      --source-root data/raw/official-clinical-documents --write
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from localmed_ingest.clinical_json_import import bold_standalone_paragraphs
from localmed_ingest.clinical_template_labels import (
    TEMPLATE_LABELS_PATH,
    TemplateLabelList,
    load_template_labels,
    normalize_label,
)

MODULE_PREFIX = "minimed.clinical.recommendation."


def current_ids(catalog: Path) -> list[str]:
    modules = json.loads(catalog.read_text(encoding="utf-8"))["modules"]
    return sorted(
        module["id"].removeprefix(MODULE_PREFIX)
        for module in modules
        if module["id"].startswith(MODULE_PREFIX)
    )


def pair(item: tuple[str, str]) -> tuple[str, str]:
    return normalize_label(item[0]), item[1]


def candidates(source_root: Path, ids: list[str], min_documents: int) -> None:
    documents: Counter[str] = Counter()
    sections: dict[str, Counter[str]] = defaultdict(Counter)
    examples: dict[str, str] = {}
    for official_id in ids:
        seen: set[str] = set()
        for title, text in bold_standalone_paragraphs(source_root / f"{official_id}.json"):
            label = normalize_label(text)
            if not label:
                continue
            examples.setdefault(label, text)
            sections[label][title[:40]] += 1
            if label not in seen:
                seen.add(label)
                documents[label] += 1
    rows = [
        {
            "label": label,
            "documents": count,
            "example": examples[label],
            "sections": sections[label].most_common(3),
        }
        for label, count in documents.most_common()
        if count >= min_documents
    ]
    print(json.dumps(rows, ensure_ascii=False, indent=1))


def recount(source_root: Path, ids: list[str], write: bool) -> int:
    template = load_template_labels()
    patterns = {name: re.compile(pattern) for name, pattern in template.contexts.items()}
    counts: Counter[tuple[str, str]] = Counter()
    examples: dict[tuple[str, str], str] = {}
    wanted = {(item.label, item.context) for item in template.labels}
    for official_id in ids:
        seen: set[tuple[str, str]] = set()
        for title, text in bold_standalone_paragraphs(source_root / f"{official_id}.json"):
            label = normalize_label(text)
            section = normalize_label(title)
            for context, pattern in patterns.items():
                key = (label, context)
                if key in wanted and pattern.search(section):
                    examples.setdefault(key, text)
                    if key not in seen:
                        seen.add(key)
                        counts[key] += 1
    problems = 0
    labels = []
    for item in template.labels:
        key = (item.label, item.context)
        count = counts[key]
        if count < template.min_documents:
            problems += 1
            print(
                f"under {template.min_documents} documents: {item.context} {item.label!r} ({count})"
            )
        labels.append(
            item.model_copy(
                update={"documents": max(1, count), "example": examples.get(key, item.example)}
            )
        )
    updated = template.model_copy(update={"document_count": len(ids), "labels": labels})
    for item in updated.labels:
        print(f"{item.documents:4d}  {item.context:18s} {item.label}")
    if write:
        write_list(updated)
    return problems


def write_list(template: TemplateLabelList) -> None:
    payload = template.model_dump(by_alias=True, mode="json")
    TEMPLATE_LABELS_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["candidates", "recount"])
    parser.add_argument("--catalog", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--min-documents", type=int, default=6)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    ids = current_ids(args.catalog)
    if args.mode == "candidates":
        candidates(args.source_root, ids, args.min_documents)
    else:
        raise SystemExit(1 if recount(args.source_root, ids, args.write) else 0)


if __name__ == "__main__":
    main()
