"""Review-only mass extraction from existing prepared MiniMed SQLite and tool schemas.

No network, model, clinical promotion, invented scoring rules or input mutations.
Owner PDFs use a separate local source-profile importer; they are never uploaded here.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

LIMIT = 16 * 1024 * 1024
KINDS = {"term", "symptom", "syndrome", "criterion_set", "scale", "classification", "law", "tool", "history_note"}
SKIP_SOURCE = {"core_catalog_pointer", "official_registry_summary", "regulatory_act", "regulatory_act_summary", "personal_note"}
DEF_HEADING = re.compile(r"(?:^|\b)(?:определени[еяй]|термины\s+и\s+определения)(?:\b|$)", re.I)
INSTRUMENT = re.compile(r"\b(?:шкала|шкалы|опросник|индекс|критерии|классификация|стадии|степени)\b", re.I)
NOISE = re.compile(r"^(?:критерии оценки качества|критерии качества|уровень убедительности|уровень достоверности|список|методология|оглавление|литература|содержание)", re.I)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compact(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def kind_for(title: str) -> str:
    if re.search(r"\b(?:шкала|опросник|индекс)\b", title, re.I):
        return "scale"
    if re.search(r"\b(?:критерии|признаки|триада)\b", title, re.I):
        return "criterion_set"
    if re.search(r"\b(?:классификация|стадии|степени)\b", title, re.I):
        return "classification"
    if re.search(r"\bзакон\b", title, re.I):
        return "law"
    if re.search("синдром", title, re.I):
        return "syndrome"
    if re.search("симптом|феномен", title, re.I):
        return "symptom"
    return "term"


class Collector:
    def __init__(self, edition: str):
        self.catalog = {"version": 3, "id": edition, "reviewStatus": "requires-review", "publicationState": "local-dev", "textKind": "source-excerpt", "sources": [], "blocks": [], "terms": []}
        self.block_keys = {}
        self.term_keys = {}
        self.stats = Counter()
        self.source_types = Counter()
        self.mentions = []

    def source(self, source_id: int, **metadata):
        if any(row["id"] == source_id for row in self.catalog["sources"]):
            raise ValueError("Duplicate source identifier")
        self.catalog["sources"].append({"id": source_id, "authority": "third-party", "accessed": "2026-09-21", "rightsStatus": "not-qualified-for-new-release", "releaseEligible": False, **metadata})

    def block(self, source: int, text: str, locator: str, **metadata) -> int:
        key = (source, locator, digest(text.encode()))
        previous = self.block_keys.get(key)
        if previous is not None:
            return previous
        block_id = len(self.catalog["blocks"]) + 1
        self.catalog["blocks"].append({"id": block_id, "source": source, "text": text, "locator": locator, "textSha256": key[2], **metadata})
        self.block_keys[key] = block_id
        return block_id

    def term(self, identity: str, title: str, kind: str, blocks: list[int], *, coverage="source-description", aliases=None, **metadata):
        if kind not in KINDS or not title.strip() or not blocks:
            raise ValueError("Invalid extracted term")
        row = {"id": identity, "title": title.strip(), "kind": kind, "aliases": aliases or [], "blockIds": blocks, "coverage": coverage, "note": "Извлечено из подготовленного источника; клиническая и редакторская проверка не выполнена.", **metadata}
        old = self.term_keys.get(identity)
        if old and old != row:
            raise ValueError("Conflicting stable term identity")
        if not old:
            self.term_keys[identity] = row
            self.catalog["terms"].append(row)

    def save(self, output: Path, report: Path):
        if output.exists() or report.exists():
            raise ValueError("Choose new output paths; editions are immutable")
        payload = compact(self.catalog)
        if len(payload) > LIMIT:
            raise ValueError("Split the source edition; never silently truncate entries")
        data = {"schemaVersion": 1, "edition": self.catalog["id"], "examined": dict(self.stats), "sourceTypes": dict(self.source_types), "records": len(self.catalog["terms"]), "distinctTitles": len({r["title"].casefold() for r in self.catalog["terms"]}), "byKind": dict(Counter(r["kind"] for r in self.catalog["terms"])), "byCoverage": dict(Counter(r["coverage"] for r in self.catalog["terms"])), "sources": len(self.catalog["sources"]), "sharedBlocks": len(self.catalog["blocks"]), "jsonBytes": len(payload), "gzipBytes": len(gzip.compress(payload, mtime=0)), "sha256": digest(payload), "instrumentMentionCandidates": len(self.mentions), "qualification": "source-extraction-only; no clinical approval, UI/device qualification, independent retrieval gold or new-release rights implied"}
        output.parent.mkdir(parents=True, exist_ok=True)
        report.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(payload)
        report.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        return data


def paragraphs(text: str):
    # Original chunks remain unmodified. Offsets refer to Python Unicode code points.
    for match in re.finditer(r"[^\n]+(?:\n(?!\s*\n)[^\n]+)*", text):
        yield match.start(), match.end(), match.group(0)


def explicit_label(text: str) -> str | None:
    match = re.match(r"^\s*(?:[-*#]+\s*|\d+(?:\.\d+)*[.)]?\s*)?(.{2,170}?)\s+[—–]\s+\S", text)
    if not match:
        return None
    title = match[1].strip(" *#\t\n")
    if NOISE.search(title) or len(title.split()) > 18 or re.match(r"^(?:в |на |при |для |это |кроме |также |если )", title, re.I):
        return None
    return title


def scan_sqlite(path: Path, collector: Collector, repo_ref: str):
    with path.open("rb") as handle:
        sha = hashlib.file_digest(handle, "sha256").hexdigest()
    collector.source(3001, title="MiniMed: подготовленные исходные документы, закреплённая редакция", baseUrl=f"https://github.com/T-Damer/MiniMed/blob/{repo_ref}/", path="content/bundled/core.db.gz", sourceSha256=sha, sourceType="existing-repository-corpus")
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("Source SQLite is corrupt")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("Source SQLite foreign-key failure")
        for table in ("documents", "sections", "chunks"):
            collector.stats[table] = connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        query = """SELECT d.id AS document_id,d.title AS document_title,d.source_type,d.metadata_json AS document_metadata,
        v.id AS version_id,v.source_checksum,s.id AS section_id,s.title AS section_title,s.section_type,s.order_index AS section_order,
        c.id AS chunk_id,c.anchor,c.original_text,c.order_index AS chunk_order
        FROM documents d JOIN document_versions v ON v.id=d.current_version_id
        JOIN sections s ON s.document_version_id=v.id JOIN chunks c ON c.section_id=s.id
        ORDER BY d.id,s.order_index,c.order_index,c.id"""
        seen_docs = set()
        seen_section = set()
        direct_documents = set()
        for row in connection.execute(query):
            source_type = row["source_type"]
            if row["document_id"] not in seen_docs:
                collector.source_types[source_type] += 1
                seen_docs.add(row["document_id"])
            if source_type in SKIP_SOURCE:
                collector.stats["excluded_pointer_or_nonclinical_chunks"] += 1
                continue
            meta = json.loads(row["document_metadata"] or "{}")
            if meta.get("syntheticFixture") or meta.get("synthetic_fixture") or meta.get("personal"):
                collector.stats["excluded_synthetic_or_personal_chunks"] += 1
                continue
            text = row["original_text"].strip()
            if not text:
                continue
            section = row["section_title"]
            heading = re.sub(r"^\d+(?:\.\d+)*[.)]?\s*", "", section).strip()
            loc = f"document={row['document_id']}; version={row['version_id']}; section={row['section_id']}; chunk={row['chunk_id']}; anchor={row['anchor']}"

            def add_block():
                return collector.block(3001, text, loc, documentId=row["document_id"], documentTitle=row["document_title"], documentVersionId=row["version_id"], sectionId=row["section_id"], chunkId=row["chunk_id"], anchor=row["anchor"], originalSourceSha256=row["source_checksum"])

            if INSTRUMENT.search(heading) and not NOISE.search(heading) and len(heading) <= 200:
                key = row["section_id"]
                block_id = add_block()
                identity = "prepared.instrument." + digest(key.encode())[:24]
                old = collector.term_keys.get(identity)
                if old:
                    old["blockIds"].append(block_id)
                else:
                    collector.term(identity, heading, kind_for(heading), [block_id], coverage="section-excerpt", sectionTitle=section)
                seen_section.add(key)
            if DEF_HEADING.search(heading) or row["section_type"] == "definition":
                extracted = 0
                for start, end, paragraph in paragraphs(text):
                    title = explicit_label(paragraph)
                    if not title:
                        continue
                    block_id = collector.block(3001, paragraph, loc + f"; chars={start}:{end}", documentId=row["document_id"], documentVersionId=row["version_id"], chunkId=row["chunk_id"], anchor=row["anchor"], charStart=start, charEnd=end)
                    identity = "prepared.definition." + digest(f"{row['version_id']}:{row['chunk_id']}:{start}".encode())[:24]
                    collector.term(identity, title, kind_for(title), [block_id], coverage="explicit-definition", sectionTitle=section)
                    extracted += 1
                if not extracted:
                    collector.term("prepared.definition." + digest(row["chunk_id"].encode())[:24], row["document_title"], "term", [add_block()], coverage="definition-section", sectionTitle=section)
                collector.stats["definition_chunks"] += 1
            elif source_type in {"krasotaimedicina_reference", "medical_reference", "clinical_recommendation"} and row["document_id"] not in direct_documents and row["chunk_order"] < 3:
                title = explicit_label(text)
                if title:
                    collector.term("prepared.lead." + digest(row["chunk_id"].encode())[:24], title, kind_for(title), [add_block()], coverage="explicit-definition", sectionTitle=section)
                    direct_documents.add(row["document_id"])
            for match in re.finditer(r"\b(?:шкала|опросник|критерии|классификация)\s+[А-ЯA-Z][^\n.;:]{1,100}", text):
                collector.mentions.append({"name": match[0], "documentId": row["document_id"], "chunkId": row["chunk_id"], "anchor": row["anchor"], "charStart": match.start(), "charEnd": match.end(), "reviewStatus": "requires-review", "coverage": "mention-only"})
        collector.stats["instrument_sections"] = len(seen_section)
    finally:
        connection.close()


def scan_tools(directory: Path, collector: Collector, repo_ref: str):
    collector.source(4001, title="MiniMed: авторские схемы инструментов с сохранёнными оговорками", baseUrl=f"https://github.com/T-Damer/MiniMed/blob/{repo_ref}/content/tool-modules/", sourceType="existing-tool-schemas")
    for path in sorted(directory.glob("*.json")):
        raw = path.read_bytes()
        module = json.loads(raw)
        if not isinstance(module.get("tools"), list):
            raise ValueError("Unexpected tool module shape")
        collector.stats["tool_modules"] += 1
        for index, tool in enumerate(module["tools"]):
            collector.stats["tool_records_examined"] += 1
            definition = tool.get("definition", {})
            if not isinstance(definition, dict):
                raise ValueError("Unexpected tool definition")
            description = tool.get("description") or definition.get("description") or definition.get("summary")
            if not isinstance(description, str) or not description.strip():
                collector.stats["tools_without_description"] += 1
                continue
            notes = []
            for key in ("disclaimer", "limitations", "warning", "warnings", "interpretationNote", "educationalNotice"):
                value = definition.get(key, tool.get(key))
                if value:
                    notes.append({"field": key, "value": value})
            block_id = collector.block(4001, description, f"{path.name}#/tools/{index}/definition; tool={tool['id']}", path=path.name, rawFileSha256=digest(raw), toolId=tool["id"], sourceCaveats=notes)
            collector.term("prepared.tool." + digest(tool["id"].encode())[:24], tool["title"], kind_for(tool["title"]) if kind_for(tool["title"]) != "term" else "tool", [block_id], coverage="tool-description", aliases=[x for x in tool.get("aliases", []) if isinstance(x, str)], toolId=tool["id"], originalKind=tool.get("kind"), sourceCaveats=notes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--tools", type=Path, required=True)
    parser.add_argument("--repo-ref", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--mentions", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}", args.repo_ref):
        parser.error("Use a pinned repository commit")
    if any(p.exists() for p in (args.output, args.report, args.mentions)):
        parser.error("Use new output paths")
    collector = Collector("minimed.definition.prepared.2026-09-21")
    scan_sqlite(args.sqlite, collector, args.repo_ref)
    scan_tools(args.tools, collector, args.repo_ref)
    report = collector.save(args.output, args.report)
    args.mentions.parent.mkdir(parents=True, exist_ok=True)
    args.mentions.write_bytes(compact({"version": 1, "reviewStatus": "requires-review", "candidates": collector.mentions}))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
