"""Assemble the candidate source set for the next dictionary edition (local build, not published).

    uv run --project tools/ingest python -m localmed_ingest.definition_candidate \
      --repo-root . --data-root <checkout with data/> --tag candidate-2026.10.08 \
      --reader-databases <data>/build/official-clinical-documents-merged/databases \
      --kim-module <data>/build/krasotaimedicina-module/minimed.krasotaimedicina.diseases.db

What it does, in order:

1. reads the committed source manifest (`content/definition-drafts/source-inputs.json`);
2. drops the КР glossary / «Определение заболевания» entries of the first extraction, which
   worked on flattened text and cut some terms at the wrong dash (they are replaced, not edited);
3. adds the registry extraction (`kr_registry_cli`: every current КР «Термины и определения»
   section, term boundary at the first dash outside brackets) and the Красота и медицина lead
   definitions of the disease module and of the symptom pages of the crawl (`kim_definitions`);
4. measures the usage of every ambiguous headword's senses across all КР and writes the sense
   signals into every term row (`definition_senses`);
5. writes the shards and a new manifest under `content/definition-drafts/<tag>/` and a report.

Committed shards are never modified; the candidate directory is deleted after the build.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .definition_reference_pack import number
from .definition_senses import annotate_shards
from .kim_definitions import extract as extract_kim
from .kim_definitions import extract_symptoms
from .kr_registry_cli import extract_registry
from .sense_usage import load_registry_corpus

GLOSSARY_SECTIONS = ("Термины и определения", "1.1 Определение заболевания")
REPLACED_PREFIXES = ("prepared.definition.", "clinical-glossary.")


def replaced_by_registry_extraction(term: dict[str, Any]) -> bool:
    """A first-extraction КР glossary or disease-definition entry (never an abbreviation)."""
    if term.get("kind") == "abbreviation" or not str(term.get("id", "")).startswith(
        REPLACED_PREFIXES
    ):
        return False
    if str(term["id"]).startswith("clinical-glossary."):
        return True
    return str(term.get("sectionTitle", "")).startswith(GLOSSARY_SECTIONS) and (
        term.get("coverage") == "explicit-definition"
    )


def drop_replaced(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """The shard without the replaced entries and without the blocks only they used."""
    if payload.get("version") != 3:
        return payload, 0
    kept = [term for term in payload["terms"] if not replaced_by_registry_extraction(term)]
    removed = len(payload["terms"]) - len(kept)
    if not removed:
        return payload, 0
    used = {
        int(block_id)
        for term in kept
        for key in ("blockIds", "itemBlocks", "detailBlocks")
        for block_id in term.get(key, [])
    }
    blocks = [block for block in payload["blocks"] if int(block["id"]) in used]
    return {**payload, "terms": kept, "blocks": blocks}, removed


def write_json(path: Path, payload: object) -> int:
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    path.write_bytes(data)
    return len(data)


def assemble(args: argparse.Namespace) -> dict[str, Any]:
    from .definition_source_manifest import describe_input

    repo = args.repo_root.resolve()
    data_root = args.data_root.resolve()
    drafts = repo / "content/definition-drafts"
    output = drafts / args.tag
    if output.exists():
        raise FileExistsError(output)
    committed = json.loads((drafts / "source-inputs.json").read_text(encoding="utf-8"))
    shards: list[tuple[str, dict[str, Any]]] = []
    removed_total = 0
    for row in committed["inputs"]:
        payload = json.loads((repo / row["path"]).read_text(encoding="utf-8"))
        payload, removed = drop_replaced(payload)
        removed_total += removed
        shards.append(
            (Path(row["path"]).relative_to("content/definition-drafts").as_posix(), payload)
        )
    registry_parts, registry_report = extract_registry(
        data_root,
        args.raw,
        list(args.reader_databases),
        f"minimed.definition.kr-glossary.{args.tag}",
    )
    for index, part in enumerate(registry_parts, 1):
        shards.append((f"kr-registry-glossary.part-{index:02d}.json", part))
    kim_shard, kim_report = extract_kim(args.kim_module, accessed=args.kim_accessed)
    shards.append(("krasotaimedicina-leads.json", kim_shard))
    symptom_shard, symptom_report = extract_symptoms(
        data_root / args.kim_raw, accessed=args.kim_accessed
    )
    shards.append(("krasotaimedicina-symptoms.json", symptom_shard))
    corpus = load_registry_corpus(data_root, args.raw)
    sense_report = annotate_shards([payload for _, payload in shards], corpus)
    sense_report["corpusDocuments"] = len(corpus.documents)
    sense_report["corpusParagraphs"] = corpus.paragraph_count
    output.mkdir(parents=True)
    paths: list[Path] = []
    sizes: dict[str, int] = {}
    for name, payload in shards:
        path = output / name.replace("/", "__")
        sizes[path.name] = write_json(path, payload)
        paths.append(path)
    rows = [describe_input(repo, path) for path in paths]
    manifest = {
        "version": 1,
        "publicationState": "local-dev",
        "reviewStatus": "requires-review",
        "entries": sum(number(row["entries"]) for row in rows),
        "inputs": rows,
    }
    (output / "source-inputs.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    report = {
        "format": "minimed-definition-candidate-v1",
        "tag": args.tag,
        "replacedFirstExtractionEntries": removed_total,
        "registry": registry_report,
        "krasotaimedicina": kim_report,
        "krasotaimedicinaSymptoms": symptom_report,
        "senses": sense_report,
        "inputs": len(rows),
        "inputBytes": sizes,
        "manifest": f"content/definition-drafts/{args.tag}/source-inputs.json",
    }
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--raw", type=Path, default=Path("data/raw/official-clinical-documents"))
    parser.add_argument("--reader-databases", type=Path, nargs="*", default=[])
    parser.add_argument("--kim-module", type=Path, required=True)
    parser.add_argument("--kim-raw", type=Path, default=Path("data/raw/krasotaimedicina"))
    parser.add_argument("--kim-accessed", default="2026-09-04")
    parser.add_argument("--tag", required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("Choose a new report path")
    report = assemble(args)
    summary = {
        key: report[key]
        for key in ("replacedFirstExtractionEntries", "inputs", "senses", "manifest")
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
