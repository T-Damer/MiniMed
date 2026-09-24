"""Select medical paths from archived category edges; preserve excluded source snapshots."""

from __future__ import annotations

import argparse
import gzip
import json
import re
from collections import Counter, deque
from pathlib import Path

from .wikipedia_definitions import (
    ETYMOLOGY,
    Snapshot,
    encoded,
    exclusion,
    integer,
    items,
    obj,
    project_page,
    sha,
    source_descriptor,
    text,
)


def child(directory: Path, name: object) -> Path:
    path = (directory / text(name)).resolve(strict=True)
    if path.parent != directory.resolve():
        raise ValueError("Source path escapes the collection directory")
    return path


def archived_sources(
    collection: Path, manifest: dict[str, object]
) -> tuple[dict[str, list[object]], dict[int, tuple[dict[str, object], Snapshot]]]:
    receipt = obj(manifest["snapshotArchive"])
    archive = child(collection, receipt["path"])
    if archive.stat().st_size != receipt["bytes"] or sha(archive.read_bytes()) != receipt["sha256"]:
        raise ValueError("Source snapshot archive receipt mismatch")
    categories: dict[str, list[object]] = {}
    pages: dict[int, tuple[dict[str, object], Snapshot]] = {}
    expanded = 0
    with gzip.open(archive, "rb") as stream:
        while line := stream.readline(32 * 1024 * 1024 + 1):
            expanded += len(line)
            if len(line) > 32 * 1024 * 1024 or expanded > 256 * 1024 * 1024:
                raise ValueError("Authoring archive exceeds its expansion budget")
            saved = obj(json.loads(line))
            response = text(saved["response"], 16 * 1024 * 1024).encode()
            checksum = sha(response)
            if checksum != saved["responseSha256"]:
                raise ValueError("Individual API response checksum mismatch")
            params = obj(saved["parameters"])
            data = obj(json.loads(response))
            query = obj(data["query"])
            if params.get("list") == "categorymembers":
                category = text(params["cmtitle"])
                categories.setdefault(category, []).extend(items(query["categorymembers"]))
            elif "extracts" in str(params.get("prop", "")):
                snapshot = Snapshot(data, checksum, text(saved["retrievedAt"]))
                for raw in items(query["pages"]):
                    page = obj(raw)
                    page_id = integer(page["pageid"], 1)
                    if page_id in pages:
                        raise ValueError("Ambiguous duplicate page snapshot")
                    pages[page_id] = (page, snapshot)
    return categories, pages


def select_paths(
    categories: dict[str, list[object]],
    selection: dict[str, object],
    policy: dict[str, object],
) -> tuple[dict[int, dict[str, object]], dict[str, object]]:
    patterns = [
        re.compile(text(value), re.I) for value in items(policy["excludedCategoryPatterns"])
    ]
    queue: deque[tuple[str, int, int, str]] = deque()
    for raw in items(selection["seeds"]):
        seed = obj(raw)
        maximum = integer(seed["depth"])
        if maximum > 4:
            raise ValueError("Unsupported source traversal depth")
        queue.append((text(seed["category"]), 0, maximum, text(seed["family"])))
    visited: set[tuple[str, str, int]] = set()
    rejected: set[str] = set()
    missing: set[str] = set()
    candidates: dict[int, dict[str, object]] = {}
    while queue:
        category, depth, maximum, family = queue.popleft()
        key = (category, family, maximum - depth)
        if key in visited:
            continue
        visited.add(key)
        if len(visited) > 10000:
            raise ValueError("Category replay exceeds its work budget")
        if any(pattern.search(category) for pattern in patterns):
            rejected.add(category)
            continue
        if category not in categories:
            missing.add(category)
            continue
        for raw in categories[category]:
            row = obj(raw)
            namespace = integer(row["ns"])
            title = text(row["title"])
            if namespace == 14 and depth < maximum:
                queue.append((title, depth + 1, maximum, family))
            elif namespace == 0:
                page_id = integer(row["pageid"], 1)
                candidate = candidates.setdefault(
                    page_id, {"pageid": page_id, "title": title, "families": [], "categories": []}
                )
                for field, value in (("families", family), ("categories", category)):
                    values = items(candidate[field])
                    if value not in values:
                        values.append(value)
    return candidates, {
        "excludedCategories": sorted(rejected),
        "unfetchedCategories": sorted(missing),
        "networkRequests": 0,
        "boundary": "Only archived categories are replayed; missing branches remain open.",
    }


def intake(collection: Path, selection_path: Path, policy_path: Path) -> dict[str, object]:
    manifest_path = collection / "manifest.json"
    original = manifest_path.read_bytes()
    manifest = obj(json.loads(original))
    if "intakePolicySha256" in manifest:
        raise ValueError("This source snapshot already has an intake; use a new snapshot")
    if manifest["configSha256"] != sha(selection_path.read_bytes()):
        raise ValueError("Acquisition selection config changed")
    policy_raw = policy_path.read_bytes()
    policy = obj(json.loads(policy_raw))
    if policy.get("version") != 1:
        raise ValueError("Unsupported source scope policy")
    categories, pages = archived_sources(collection, manifest)
    candidates, traversal = select_paths(
        categories, obj(json.loads(selection_path.read_bytes())), policy
    )
    excluded_titles = {text(value) for value in items(policy["excludedPageTitles"])}
    original_ids: set[int] = set()
    for raw in items(manifest["parts"]):
        part = obj(raw)
        path = child(collection, part["path"])
        body = path.read_bytes()
        if len(body) != part["bytes"] or sha(body) != part["sha256"]:
            raise ValueError("Acquired source shard changed")
        payload = obj(json.loads(body))
        for value in items(payload["terms"]):
            term = obj(value)
            original_ids.add(integer(items(term["blockIds"])[0], 1))
    terms: list[dict[str, object]] = []
    blocks: list[dict[str, object]] = []
    queue: list[dict[str, object]] = []
    for page_id, (page, snapshot) in sorted(pages.items()):
        title = text(page["title"])
        reason = (
            "outside-allowed-medical-category-path"
            if page_id not in candidates
            else "explicit-nonmedical-title"
            if title in excluded_titles
            else exclusion(page)
        )
        if reason:
            queue.append({"pageid": page_id, "title": title, "reason": reason})
            continue
        block, term = project_page(page, candidates[page_id], snapshot)
        block["intakePolicySha256"] = sha(policy_raw)
        if block["text"] != page["extract"]:
            raise ValueError("Intake changed original API source text")
        terms.append(term)
        blocks.append(block)
    if not terms:
        raise ValueError("Scope policy admitted no records")
    parts: list[dict[str, object]] = []
    date = text(manifest["date"])
    for start in range(0, len(terms), 500):
        name = f"admitted-{start // 500 + 1:03d}.json"
        raw = encoded(
            {
                "version": 3,
                "id": "ruwiki.medical.introductions",
                "reviewStatus": "requires-review",
                "publicationState": "local-dev",
                "textKind": "source-excerpt",
                "sources": [source_descriptor(date)],
                "blocks": blocks[start : start + 500],
                "terms": terms[start : start + 500],
            }
        )
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError("Admitted source shard exceeds its byte budget")
        with (collection / name).open("xb") as stream:
            stream.write(raw)
        parts.append(
            {
                "path": name,
                "sha256": sha(raw),
                "bytes": len(raw),
                "entries": len(terms[start : start + 500]),
            }
        )
    accepted = {integer(block["pageId"]) for block in blocks}
    report = {
        "version": 1,
        "acquiredDescriptions": len(original_ids),
        "admittedDescriptions": len(terms),
        "quarantinedAcquiredDescriptions": len(original_ids - accepted),
        "restoredFromRawQueue": len(accepted - original_ids),
        "scopePolicySha256": sha(policy_raw),
        "acquisitionManifestSha256": sha(original),
        "kinds": dict(Counter(str(term["kind"]) for term in terms)),
        "introductionsWithLanguageMarkers": sum(
            bool(ETYMOLOGY.search(str(block["text"]))) for block in blocks
        ),
        "queueCounts": dict(Counter(str(row["reason"]) for row in queue)),
        "traversal": traversal,
        "sourceTextExact": True,
        "boundaries": (
            "Scope filtering, not clinician review or semantic deduplication. "
            "All original acquired shards and API snapshots are retained outside runtime inputs. "
            "Language markers are not a validated etymology count; scale entries are descriptions."
        ),
    }
    (collection / "acquisition-manifest.json").write_bytes(original)
    (collection / "intake-queue.json").write_bytes(encoded(queue))
    (collection / "intake-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    manifest["parts"] = parts
    manifest["entries"] = len(terms)
    manifest["intakePolicySha256"] = sha(policy_raw)
    manifest["acquisitionManifestSha256"] = sha(original)
    manifest_path.write_bytes(encoded(manifest))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--collection", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    args = parser.parse_args()
    report = intake(args.collection, args.selection, args.policy)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
