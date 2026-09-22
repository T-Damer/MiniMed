"""Compose admitted source batches and deepen instrument cards using pinned source revisions.

Only the explicit DEV input manifest changes. Existing non-Wikipedia sources and private
materials are untouched. Same page IDs are not additional concepts. Prepared shards are
regenerated, not hand-edited. No clinical rules, scoring actions or canonical links are created.
"""

from __future__ import annotations

import argparse
import copy
import gzip
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from .definition_source_manifest import read_source_manifest, write_source_manifest
from .wikipedia_definitions import (
    Snapshot, WikiApi, encoded, integer, items, normalized, obj, sha, source_descriptor, text,
)
from .wikipedia_reference_sections import extract_sections
from .wikipedia_scope import child

LINK_FIELDS = ("blockIds", "itemBlocks", "detailBlocks")


@dataclass
class SourceRecord:
    term: dict[str, object]
    blocks: dict[int, dict[str, object]]
    sources: dict[int, dict[str, object]]


def read_records(payload: dict[str, object]) -> dict[str, SourceRecord]:
    if payload.get("version") != 3 or payload.get("textKind") != "source-excerpt":
        raise ValueError("Only source-excerpt V3 records can be refreshed")
    if payload.get("reviewStatus") != "requires-review":
        raise ValueError("Source refresh cannot change the review boundary")
    if payload.get("publicationState") != "local-dev":
        raise ValueError("Source refresh only prepares local DEV records")
    if set(payload) - {
        "version", "id", "textKind", "reviewStatus", "publicationState", "sources", "blocks", "terms"
    }:
        raise ValueError("Root source annotations require an explicit refresh adapter")
    sources: dict[int, dict[str, object]] = {}
    for value in items(payload["sources"]):
        row = obj(value)
        key = integer(row["id"], 1)
        if key in sources or row.get("releaseEligible") is not False:
            raise ValueError("Duplicate source identity or changed rights boundary")
        if not str(row.get("sourceType", "")).startswith("wikipedia-api-"):
            raise ValueError("Refresh only owns explicitly selected Wikipedia source records")
        sources[key] = row
    blocks: dict[int, dict[str, object]] = {}
    for value in items(payload["blocks"]):
        row = obj(value)
        key = integer(row["id"], 1)
        if key in blocks or integer(row["source"], 1) not in sources:
            raise ValueError("Duplicate block or unresolved source reference")
        if sha(text(row["text"], 262144).encode()) != row["textSha256"]:
            raise ValueError("Original source text checksum mismatch")
        blocks[key] = row
    result: dict[str, SourceRecord] = {}
    for value in items(payload["terms"]):
        term = obj(value)
        key = text(term["id"], 256)
        if not key.startswith("ruwiki.definition.") or key in result:
            raise ValueError("Unexpected or duplicate Wikipedia page identity")
        selected: dict[int, dict[str, object]] = {}
        for field in LINK_FIELDS:
            for reference in items(term.get(field, [])):
                block_id = integer(reference, 1)
                if block_id not in blocks:
                    raise ValueError("Missing linked source block")
                selected[block_id] = blocks[block_id]
        if not items(term.get("blockIds", [])):
            raise ValueError("A source card must have a definition block")
        result[key] = SourceRecord(term, selected, sources)
    return result


def load_collection(collection: Path, policy: Path) -> dict[str, SourceRecord]:
    manifest = obj(json.loads((collection / "manifest.json").read_bytes()))
    if (
        manifest.get("sourceFamily") != "ruwiki-medical-introductions"
        or manifest.get("intakePolicySha256") != sha(policy.read_bytes())
    ):
        raise ValueError("New source batch must pass the selected medical-scope intake")
    result: dict[str, SourceRecord] = {}
    for value in items(manifest["parts"]):
        receipt = obj(value)
        path = child(collection, receipt["path"])
        raw = path.read_bytes()
        if len(raw) != receipt["bytes"] or sha(raw) != receipt["sha256"]:
            raise ValueError("Admitted source receipt mismatch")
        records = read_records(obj(json.loads(raw)))
        if len(records) != receipt["entries"] or result.keys() & records.keys():
            raise ValueError("Duplicate or miscounted admitted source records")
        result.update(records)
    if len(result) != manifest["entries"]:
        raise ValueError("Admitted source total mismatch")
    return result


def merge_new_records(
    previous: dict[str, SourceRecord], incoming: dict[str, SourceRecord]
) -> tuple[dict[str, SourceRecord], dict[str, int]]:
    # A second observation of a page is not a second meaning or a second new concept.
    result = dict(previous)
    added = incoming.keys() - previous.keys()
    for key in sorted(added):
        result[key] = incoming[key]
    return result, {"newPageIdentities": len(added), "overlapPageIdentities": len(incoming) - len(added)}


def section_source(date: str) -> dict[str, object]:
    source = source_descriptor(date)
    source.update({
        "sourceType": "wikipedia-api-parsed-sections",
        "title": "Русская Википедия — разделы справочных статей",
        "changes": (
            "Pinned article revisions rendered to plain text. Paragraph/list order retained; "
            "tables preserve physical cells and declared spans. Layout, scripts and media omitted. "
            "No rewriting, clinical review, inferred roots, executable instruments or scoring."
        ),
        "sourceLimitations": (
            "Article revision is pinned; transcluded templates may reflect render-time versions. "
            "Exact API response is archived. Table geometry requires review. Media are not copied. "
            "An encyclopedia description is not proof of complete or licensed clinical scoring."
        ),
    })
    return source


def deepen_record(
    record: SourceRecord, snapshot: Snapshot, revision: int, date: str
) -> tuple[SourceRecord, dict[str, object]]:
    parsed = obj(snapshot.data["parse"])
    page_id = integer(text(record.term["id"]).rsplit(".", 1)[1].isdigit() and
                      int(text(record.term["id"]).rsplit(".", 1)[1]), 1)
    if parsed.get("pageid") != page_id or parsed.get("revid") != revision:
        raise ValueError("Parsed source belongs to another page or revision")
    html = text(parsed["text"], 4 * 1024 * 1024)
    sections, omissions = extract_sections(html)
    title = text(parsed["title"], 2048)
    path = quote(title.replace(" ", "_"), safe="")
    blocks: dict[int, dict[str, object]] = {}
    for index, section in enumerate(sections, 1):
        blocks[index] = {
            "id": index, "source": 1, "text": section.text,
            "textSha256": sha(section.text.encode()), "path": path,
            "locator": f"pageid={page_id}; oldid={revision}; section={section.anchor or 'lead'}",
            "pageId": page_id, "revisionId": revision, "sectionOrdinal": index,
            "sectionTitle": section.title, "sectionAnchor": section.anchor,
            "retrievedAt": snapshot.retrieved_at,
            "apiResponseSha256": snapshot.response_sha256,
            "renderedHtmlSha256": sha(html.encode()),
            "permalink": f"https://ru.wikipedia.org/w/index.php?oldid={revision}",
            "historyUrl": "https://ru.wikipedia.org/w/index.php?title=" + path + "&action=history",
            "renderer": "reference-html-v1",
            "tableGeometry": section.tables,
            "tableReviewStatus": "requires-review" if section.tables else "not-applicable",
            "mediaPolicy": "not-copied",
        }
    term = copy.deepcopy(record.term)
    if term["title"] != title:
        term["aliases"] = list(dict.fromkeys([
            text(term["title"]), *[text(v) for v in items(term.get("aliases", []))]
        ]))
    term.update({
        "title": title, "coverage": "source-description", "blockIds": [1],
        "detailBlocks": list(range(2, len(blocks) + 1)),
    })
    term.pop("itemBlocks", None)
    result = SourceRecord(term, blocks, {1: section_source(date)})
    return result, {
        "id": term["id"], "title": title, "revisionId": revision,
        "sections": len(sections), "tables": sum(len(s.tables) for s in sections),
        "omissions": omissions, "apiResponseSha256": snapshot.response_sha256,
        "oldBlockTextSha256": [b["textSha256"] for b in record.blocks.values()],
        "newBlockTextSha256": [b["textSha256"] for b in blocks.values()],
        "status": "source-sections-rendered-not-clinically-reviewed",
    }


def repack(records: list[SourceRecord]) -> dict[str, object]:
    sources: list[dict[str, object]] = []
    blocks: list[dict[str, object]] = []
    terms: list[dict[str, object]] = []
    source_ids: dict[str, int] = {}
    block_ids: dict[str, int] = {}
    for record in records:
        local_map: dict[int, int] = {}
        for old_id, original in record.blocks.items():
            source = dict(record.sources[integer(original["source"], 1)])
            source.pop("id")
            key = sha(encoded(source))
            if key not in source_ids:
                source_ids[key] = len(sources) + 1
                sources.append({"id": source_ids[key], **source})
            block = {k: v for k, v in original.items() if k not in {"id", "source"}}
            block["source"] = source_ids[key]
            block_key = sha(encoded(block))
            if block_key not in block_ids:
                block_ids[block_key] = len(blocks) + 1
                blocks.append({"id": block_ids[block_key], **block})
            local_map[old_id] = block_ids[block_key]
        term = dict(record.term)
        for field in LINK_FIELDS:
            if field in term:
                term[field] = [local_map[integer(v, 1)] for v in items(term[field])]
        terms.append(term)
    return {
        "version": 3, "id": "ruwiki.reference.refreshed",
        "reviewStatus": "requires-review", "publicationState": "local-dev",
        "textKind": "source-excerpt", "sources": sources, "blocks": blocks, "terms": terms,
    }


def write_shards(records: list[SourceRecord], destination: Path) -> list[Path]:
    paths: list[Path] = []

    def write(group: list[SourceRecord]) -> None:
        raw = encoded(repack(group))
        if len(raw) > 8 * 1024 * 1024:
            if len(group) < 2:
                raise ValueError("A single source card exceeds the shard budget")
            middle = len(group) // 2
            write(group[:middle])
            write(group[middle:])
            return
        path = destination / f"records-{len(paths) + 1:03d}.json"
        with path.open("xb") as stream:
            stream.write(raw)
        paths.append(path)

    for start in range(0, len(records), 750):
        write(records[start:start + 750])
    return paths


def refresh(
    root: Path, collection: Path, destination: Path, cache: Path,
    *, date: str, offline: bool = False,
) -> dict[str, object]:
    root = root.resolve(strict=True)
    source_root = root / "content/definition-drafts"
    if destination.exists() or destination.resolve().parent != source_root:
        raise ValueError("Use a new direct-child source edition destination")
    if collection.resolve().parent != source_root:
        raise ValueError("Incoming collection must stay inside the source workspace")
    manifest_path = source_root / "source-inputs.json"
    previous_manifest = manifest_path.read_bytes()
    paths, previous_count = read_source_manifest(root, manifest_path)
    previous: dict[str, SourceRecord] = {}
    untouched: list[Path] = []
    previous_names: set[str] = set()
    for path in paths:
        payload = obj(json.loads(path.read_bytes()))
        terms = [obj(v) for v in items(payload["terms"])]
        for term in terms:
            previous_names.update(normalized(text(v)) for v in [term["title"], *items(term.get("aliases", []))])
        owns = [text(term["id"]).startswith("ruwiki.definition.") for term in terms]
        if any(owns):
            if not all(owns):
                raise ValueError("Mixed source ownership is not refreshable")
            loaded = read_records(payload)
            if previous.keys() & loaded.keys():
                raise ValueError("Conflicting previous page identities")
            previous.update(loaded)
        else:
            untouched.append(path)
    incoming = load_collection(collection, source_root / "ruwiki-scope-2026.09.22.json")
    combined, merge_stats = merge_new_records(previous, incoming)
    api = WikiApi(cache, offline=offline)
    targets = sorted(key for key, value in combined.items()
                     if value.term["kind"] in {"scale", "classification"})
    if len(targets) > 200:
        raise ValueError("Section collection exceeds the explicit 200-page work budget")
    section_reports: list[dict[str, object]] = []
    for key in targets:
        record = combined[key]
        first = record.blocks[integer(items(record.term["blockIds"])[0], 1)]
        revision = integer(first.get("revisionId", first.get("observedRevisionId")), 1)
        snapshot = api.get({
            "action": "parse", "oldid": str(revision), "prop": "text|revid",
            "disableeditsection": "1", "disablelimitreport": "1",
        })
        try:
            updated, report = deepen_record(record, snapshot, revision, date)
        except ValueError as error:
            # Retain the old whole card; report unsupported layout rather than drop table cells.
            section_reports.append({
                "id": key, "status": "retained-previous-source-needs-review",
                "reason": str(error), "apiResponseSha256": snapshot.response_sha256,
            })
        else:
            combined[key] = updated
            section_reports.append(report)
    destination.mkdir()
    new_paths = write_shards([combined[key] for key in sorted(combined)], destination)
    archive = destination / "section-api-snapshots.jsonl.gz"
    with archive.open("xb") as out, gzip.GzipFile(fileobj=out, mode="wb", filename="", mtime=0) as gz:
        for path in sorted(cache.glob("*.json")):
            gz.write(path.read_bytes() + b"\n")
    (destination / "previous-inputs.json").write_bytes(previous_manifest)
    source_manifest = write_source_manifest(root, tuple(untouched + new_paths), manifest_path)
    added = incoming.keys() - previous.keys()
    new_names = {normalized(text(incoming[key].term["title"])) for key in added}
    report = {
        "version": 1, "previousRecords": previous_count,
        "newSourceRecords": len(added), "combinedRecords": source_manifest["entries"],
        "newNormalizedNames": len(new_names - previous_names),
        "additionalSourcesForExistingNames": len(new_names & previous_names),
        "pageIdentityMerge": merge_stats,
        "newKinds": dict(Counter(str(incoming[key].term["kind"]) for key in added)),
        "sectionTargets": len(targets),
        "enrichedCards": sum("sections" in row for row in section_reports),
        "renderedSections": sum(integer(row.get("sections", 0)) for row in section_reports),
        "renderedTables": sum(integer(row.get("tables", 0)) for row in section_reports),
        "sectionResults": section_reports,
        "newSectionRequests": api.requests,
        "sourceInputManifestSha256": sha(manifest_path.read_bytes()),
        "sectionArchiveSha256": sha(archive.read_bytes()),
        "unchangedOtherInputs": [
            {"path": p.relative_to(root).as_posix(), "sha256": sha(p.read_bytes())}
            for p in untouched
        ],
        "boundaries": (
            "New page IDs and source descriptions, not distinct clinically reviewed concepts. "
            "Pinned article revisions plus exact render responses; templates may be render-time. "
            "Table/list content is reference-only, not approved scoring. Raw archives stay off-device."
        ),
    }
    (destination / "refresh-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (destination / "ATTRIBUTION.md").write_text(
        "# Reference source attribution\n\n"
        "Text: contributors to the individually linked Russian Wikipedia articles. "
        "License: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). "
        "Article and author-history URLs are retained for each source block.\n\n"
        "Changes: medical-source selection; HTML-to-plain-text formatting; source lists and "
        "physical table cells retained, merged cells explicitly annotated. No translation, "
        "medical harmonization or executable scoring. Raw revision-render responses remain "
        "in the authoring archive, not the runtime inputs. The article revision is pinned; "
        "transcluded templates can reflect render-time versions.\n", encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--collection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    report = refresh(args.root, args.collection, args.output, args.cache,
                     date=args.date, offline=args.offline)
    print(json.dumps({k: report[k] for k in (
        "newSourceRecords", "combinedRecords", "enrichedCards", "renderedSections", "renderedTables"
    )}, ensure_ascii=False))


if __name__ == "__main__":
    main()
