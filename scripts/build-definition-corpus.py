"""Project every released Russian medical sense into a compact, source-linked glossary.

No network, model, clinical promotion or released-pack mutation. Inputs are the
checksum-verified senses.jsonl.gz and source.json from the existing terminology release.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import quote

MAX_INPUT_BYTES = 128 * 1024 * 1024
MAX_LINE_BYTES = 1024 * 1024
MAX_CATALOG_BYTES = 16 * 1024 * 1024
SUBJECTS = {"medicine", "anatomy", "physiology", "pharmacology", "psychology", "psychiatry"}
SOURCE_ID = 1001


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def compact(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def text(value: object, label: str, limit: int = 65536) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"Invalid {label}")
    return value


def integer(value: object, label: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"Invalid {label}")
    return value


def string_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"Invalid {label}")
    return [text(item, label) for item in value]


def build(senses: Path, source_path: Path, *, expected_senses: int | None = None) -> tuple[dict, dict]:
    source = json.loads(source_path.read_text(encoding="utf-8"))
    if not isinstance(source, dict) or source.get("schemaVersion") != 1:
        raise ValueError("Unsupported source schema")
    if source.get("license") != "CC-BY-SA-4.0" or source.get("sourceProject") != "ru.wiktionary.org":
        raise ValueError("Unexpected source license/project; do not infer redistribution rights")
    digest = text(source.get("sha256"), "source SHA-256")
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ValueError("Invalid source SHA-256")
    retrieved = text(source.get("retrievedAt"), "retrieval date")
    if not re.match(r"\d{4}-\d{2}-\d{2}(?:T|$)", retrieved):
        raise ValueError("Invalid retrieval date")
    terms = []
    seen = set()
    labels = set()
    memberships = Counter()
    expanded = 0
    gloss_count = 0
    crossref_count = 0
    with gzip.open(senses, "rb") as stream:
        while line := stream.readline(MAX_LINE_BYTES + 1):
            expanded += len(line)
            if len(line) > MAX_LINE_BYTES or expanded > MAX_INPUT_BYTES:
                raise ValueError("Input expansion/line budget exceeded")
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("Expected a prepared dictionary record")
            identity = text(row.get("id"), "sense ID")
            if not re.fullmatch(r"ruwikt\.[a-f0-9]{24}", identity) or identity in seen:
                raise ValueError("Invalid or duplicate sense identity")
            if row.get("sourceSha256") != "sha256:" + digest:
                raise ValueError("Sense/source snapshot mismatch")
            record_hash = text(row.get("recordSha256"), "record hash")
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", record_hash):
                raise ValueError("Invalid record checksum")
            word = text(row.get("word"), "word", 2000)
            pos = text(row.get("partOfSpeech"), "part of speech", 64)
            glosses = string_list(row.get("glosses"), "glosses")
            subjects = string_list(row.get("subjects"), "subjects")
            if not set(subjects) <= SUBJECTS:
                raise ValueError("Unexpected source subject; needs explicit admission")
            line_number = integer(row.get("sourceLine"), "source line", 1)
            sense_index = integer(row.get("senseIndex"), "sense index")
            page = quote(word, safe="")
            if row.get("sourceUrl") != "https://ru.wiktionary.org/wiki/" + page:
                raise ValueError("Source page does not match the original word")
            definition = "\n".join(glosses)
            if len(definition) > 65536:
                raise ValueError("Definition exceeds the field budget; no silent truncation")
            seen.add(identity)
            labels.add(word)
            memberships.update(set(subjects))
            gloss_count += len(glosses)
            is_crossref = all(re.match(r"^(?:то же,? что|см\.|сокр\.|аббревиатура|форма\b)", g.lower()) for g in glosses)
            crossref_count += int(is_crossref)
            terms.append({
                "id": identity, "title": word, "kind": "term", "aliases": [],
                "definition": definition, "items": [], "note": "",
                "sourceSubjects": sorted(set(subjects)),
                "definitionKind": "cross-reference" if is_crossref else "gloss",
                "references": [{
                    "source": SOURCE_ID, "path": page,
                    "locator": f"ru-extract.jsonl:{line_number}; sense={sense_index}; pos={pos}",
                    "recordSha256": record_hash,
                }],
            })
    if not terms or (expected_senses is not None and len(terms) != expected_senses):
        raise ValueError(f"Sense count mismatch: {len(terms)} (expected {expected_senses})")
    terms.sort(key=lambda item: item["id"])
    catalog = {
        "version": 2, "reviewStatus": "requires-review", "publicationState": "local-dev",
        "textKind": "source-gloss", "language": "ru",
        "sources": [{
            "id": SOURCE_ID, "title": "Русский Викисловарь; медицинская выборка Kaikki/Wiktextract",
            "baseUrl": "https://ru.wiktionary.org/wiki/", "authority": "third-party",
            "accessed": retrieved[:10], "license": "CC-BY-SA-4.0",
            "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
            "attribution": text(source.get("attribution"), "attribution"),
            "sourceSha256": digest, "preparedSha256": sha256(senses),
            "sourceUrl": text(source.get("url"), "source URL"),
            "changes": "Selection and whitespace normalization inherited from the released prepared corpus; glossary projection and multi-gloss joining only. No medical rewriting or translation.",
        }],
        "terms": terms,
    }
    payload = compact(catalog)
    if len(payload) > MAX_CATALOG_BYTES:
        raise ValueError("Catalog exceeds 16 MiB; split into optional source modules")
    report = {
        "schemaVersion": 1, "source": "terminology-ru-2026.9.16",
        "senses": len(terms), "distinctNames": len(labels), "suppliedRussianGlosses": gloss_count,
        "crossReferenceLikeSenses": crossref_count, "subjectMemberships": dict(sorted(memberships.items())),
        "catalogBytes": len(payload), "gzipBytes": len(gzip.compress(payload, compresslevel=9, mtime=0)),
        "catalogSha256": hashlib.sha256(payload).hexdigest(), "preparedInputSha256": sha256(senses),
        "rawSourceSha256": digest, "clinicalReview": "requires-review",
        "note": "Source senses are not unique canonical clinical concepts. Cross-reference detection is conservative and not a semantic completeness audit. Sizes exclude the runtime index, JS, SQLite and device overhead.",
    }
    return catalog, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--senses", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--expected-senses", type=int)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists() or args.output.resolve() == args.report.resolve():
        parser.error("Choose distinct new output/report paths; existing outputs are immutable")
    catalog, report = build(args.senses, args.source, expected_senses=args.expected_senses)
    for path in (args.output, args.report):
        path.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(compact(catalog))
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
