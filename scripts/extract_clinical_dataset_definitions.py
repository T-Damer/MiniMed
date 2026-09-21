"""Mass-extract all pinned clinical detail packs into bounded source-excerpt shards.

Explicit network work on existing public repository data; never a runtime query request.
Every input is Git-blob verified and read-only. Complete source blocks/lists are retained.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import importlib.util
import json
import re
import tempfile
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

REPOSITORY = "T-Damer/MiniMed"
DATA_REF = "77fe143a31608a925c608fff3a5de28163cc77a4"
DATA_TREE = "5234e93faeeef01c364df182b84399536a4213ab"
PREFIX = "apps/app/public/content/clinical/"
MAX_FILE = 96 * 1024 * 1024
MAX_TOTAL = 12 * 1024**3
MAX_FILES = 2500
SHARD_BYTES = 8 * 1024 * 1024
MAX_SHARDS = 24
SPEC = importlib.util.spec_from_file_location("prepared", Path(__file__).with_name("extract_prepared_definitions.py"))
assert SPEC is not None and SPEC.loader is not None
prepared = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepared)


def fetch(url: str, limit: int) -> bytes:
    for attempt in range(3):
        request = urllib.request.Request(url, headers={"User-Agent": "MiniMedDefinitionExtraction/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                data = response.read(limit + 1)
                if len(data) > limit:
                    raise ValueError("Download budget exceeded")
                return data
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("Download attempts exhausted")


def one(entry: dict) -> dict:
    name, size = entry["path"], entry["size"]
    if not re.fullmatch(r"[A-Za-z0-9_.-]+\.db", name) or not 0 < size <= MAX_FILE:
        raise ValueError("Invalid or oversized dataset entry")
    data = fetch(f"https://raw.githubusercontent.com/{REPOSITORY}/{DATA_REF}/{PREFIX}{name}", MAX_FILE)
    if len(data) != size or hashlib.sha1(f"blob {size}\0".encode() + data).hexdigest() != entry["sha"]:
        raise ValueError("Git dataset blob verification failed")
    if not data.startswith(b"SQLite format 3\0"):
        raise ValueError("Expected materialized SQLite, not an LFS pointer")
    with tempfile.TemporaryDirectory(prefix="minimed-definition-") as temporary:
        path = Path(temporary) / name
        path.write_bytes(data)
        collector = prepared.Collector(name)
        prepared.scan_sqlite(path, collector, DATA_REF)
    return {"name": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": size,
            "catalog": collector.catalog, "stats": dict(collector.stats),
            "sourceTypes": dict(collector.source_types), "mentions": collector.mentions}


def save_shards(merged, output: Path, report: Path, receipts: list[dict], total: int) -> dict:
    if output.exists() or report.exists():
        raise ValueError("Choose new immutable output paths")
    output.parent.mkdir(parents=True, exist_ok=True)
    by_block = {block["id"]: block for block in merged.catalog["blocks"]}
    shards = []
    selected_terms = []
    selected_blocks = {}
    estimated = 2048

    def flush():
        nonlocal selected_terms, selected_blocks, estimated
        if not selected_terms:
            return
        part = {**merged.catalog, "id": merged.catalog["id"] + f".part-{len(shards) + 1:02d}", "terms": selected_terms, "blocks": list(selected_blocks.values())}
        payload = prepared.compact(part)
        if len(payload) > SHARD_BYTES or len(shards) >= MAX_SHARDS:
            raise ValueError("Source shard admission exceeded; no silent source truncation")
        path = output.with_name(output.stem + f".part-{len(shards) + 1:02d}.json")
        if path.exists():
            raise ValueError("Shard already exists")
        path.write_bytes(payload)
        shards.append({"path": path.name, "records": len(selected_terms), "sharedBlocks": len(selected_blocks), "bytes": len(payload), "gzipBytes": len(gzip.compress(payload, mtime=0)), "sha256": hashlib.sha256(payload).hexdigest()})
        selected_terms, selected_blocks, estimated = [], {}, 2048

    for term in merged.catalog["terms"]:
        required = {key: by_block[key] for key in term["blockIds"] if key not in selected_blocks}
        cost = len(prepared.compact(term)) + sum(len(prepared.compact(block)) + 2 for block in required.values()) + 2
        if selected_terms and estimated + cost > SHARD_BYTES - 8192:
            flush()
            required = {key: by_block[key] for key in term["blockIds"]}
            cost = len(prepared.compact(term)) + sum(len(prepared.compact(block)) + 2 for block in required.values()) + 2
        selected_terms.append(term)
        selected_blocks.update(required)
        estimated += cost
    flush()
    manifest = {"version": 1, "id": merged.catalog["id"], "reviewStatus": "requires-review", "publicationState": "local-dev", "sourceCommit": DATA_REF, "sourceTree": DATA_TREE, "parts": shards}
    output.write_bytes(prepared.compact(manifest))
    # Build-time loader imports immutable data shards only. The production UI remains disabled.
    loader = output.parent / "clinical-source-excerpt-assets.ts"
    if loader.exists():
        raise ValueError("Loader already exists")
    imports = ",\n".join("  import('./" + part["path"] + "')" for part in shards)
    loader.write_text("export async function loadClinicalSourceExcerptAssets(): Promise<readonly unknown[]> {\n  const parts = await Promise.all([\n" + imports + "\n  ]);\n  return parts.map((part) => part.default);\n}\n")
    result = {"schemaVersion": 1, "edition": merged.catalog["id"], "examined": dict(merged.stats), "sourceTypes": dict(merged.source_types), "records": len(merged.catalog["terms"]), "distinctTitles": len({term["title"].casefold() for term in merged.catalog["terms"]}), "byKind": dict(Counter(term["kind"] for term in merged.catalog["terms"])), "byCoverage": dict(Counter(term["coverage"] for term in merged.catalog["terms"])), "sources": len(merged.catalog["sources"]), "sharedBlocks": len(merged.catalog["blocks"]), "jsonBytes": sum(part["bytes"] for part in shards), "gzipBytes": sum(part["gzipBytes"] for part in shards), "shards": shards, "instrumentMentionCandidates": len(merged.mentions), "datasetCommit": DATA_REF, "datasetTree": DATA_TREE, "downloadedBytes": total, "allPinnedPacksScanned": True, "receipts": receipts, "qualification": "source-extraction-only; no clinical/independent reverse-search/device qualification or new-release rights implied. Shards bound payload size, not in-memory index size."}
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def run(output: Path, report: Path, mentions_path: Path) -> dict:
    tree_bytes = fetch(f"https://api.github.com/repos/{REPOSITORY}/git/trees/{DATA_TREE}", 4 * 1024 * 1024)
    tree = json.loads(tree_bytes)
    if tree.get("truncated") or tree.get("sha") != DATA_TREE:
        raise ValueError("Incomplete or wrong pinned dataset tree")
    entries = sorted((item for item in tree["tree"] if item["type"] == "blob" and item["path"].endswith(".db")), key=lambda item: item["path"])
    total = sum(item["size"] for item in entries)
    if not entries or len(entries) > MAX_FILES or total > MAX_TOTAL:
        raise ValueError("Dataset admission budget exceeded")
    merged = prepared.Collector("minimed.definition.clinical-detail.2026-09-21")
    merged.source(3002, title="Клинические рекомендации: полные подготовленные пакеты MiniMed, закреплённая редакция", baseUrl=f"https://github.com/{REPOSITORY}/blob/{DATA_REF}/{PREFIX}", sourceType="existing-clinical-detail-dataset", datasetCommit=DATA_REF, datasetTree=DATA_TREE, treeReceiptSha256=hashlib.sha256(tree_bytes).hexdigest())
    receipts = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for number, result in enumerate(executor.map(one, entries), 1):
            mapping = {}
            for block in result["catalog"]["blocks"]:
                metadata = {key: value for key, value in block.items() if key not in {"id", "source", "text", "locator", "textSha256", "path"}}
                mapping[block["id"]] = merged.block(3002, block["text"], f"{result['name']}; {block['locator']}", path=result["name"], databaseSha256=result["sha256"], **metadata)
            for term in result["catalog"]["terms"]:
                metadata = {key: value for key, value in term.items() if key not in {"id", "title", "kind", "aliases", "blockIds", "coverage", "note"}}
                identity = term["id"]
                if identity in merged.term_keys:
                    identity += "." + hashlib.sha256(result["name"].encode()).hexdigest()[:12]
                merged.term(identity, term["title"], term["kind"], [mapping[index] for index in term["blockIds"]], coverage=term["coverage"], aliases=term["aliases"], **metadata)
            merged.mentions.extend({**item, "database": result["name"], "databaseSha256": result["sha256"], "source": 3002} for item in result["mentions"])
            merged.stats.update(result["stats"])
            merged.source_types.update(result["sourceTypes"])
            receipts.append({"path": result["name"], "sha256": result["sha256"], "bytes": result["bytes"], "extractedRecords": len(result["catalog"]["terms"])})
            if number % 100 == 0:
                print(json.dumps({"packsScanned": number, "totalPacks": len(entries), "records": len(merged.catalog["terms"])}), flush=True)
    merged.stats["detail_packs"] = len(entries)
    result = save_shards(merged, output, report, receipts, total)
    mentions_path.write_bytes(prepared.compact({"version": 1, "reviewStatus": "requires-review", "candidates": merged.mentions}))
    print(json.dumps({key: value for key, value in result.items() if key != "receipts"}, ensure_ascii=False, indent=2))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--network", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--mentions", type=Path, required=True)
    args = parser.parse_args()
    if not args.network:
        parser.error("Public dataset extraction requires explicit --network")
    if any(path.exists() for path in (args.output, args.report, args.mentions)):
        parser.error("Use new immutable output paths")
    run(args.output, args.report, args.mentions)


if __name__ == "__main__":
    main()
