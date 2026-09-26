"""Rebuild an owner-only definition overlay from a checksum-bound PDF boundary profile.

Profiles contain titles and source coordinates, not replacement medical prose. The
PDF and resulting private text are never uploaded. PyMuPDF must be installed locally.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_lines(raw: str) -> str:
    def joined(match: re.Match[str]) -> str:
        left, right = match.groups()
        return left + ("-" if right in {"либо", "нибудь", "то"} else "") + right
    raw = re.sub(r"([А-Яа-яЁёA-Za-z])[-\u00ad]\n\s*([А-Яа-яЁёA-Za-z]+)", joined, raw)
    return re.sub(r"\s+", " ", raw).strip()


def read_native_rows(path: Path, config: dict) -> list[dict]:
    import fitz
    rows = []
    with fitz.open(path) as pdf:
        if len(pdf) > 4096:
            raise ValueError("PDF page budget exceeded")
        for page_index, page in enumerate(pdf):
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    spans = line["spans"]
                    text = "".join(s["text"] for s in spans)
                    y = line["bbox"][1]
                    if not text.strip() or y < config["top"] or y > config["bottom"]:
                        continue
                    rows.append({"page": page_index + 1, "text": text, "x": next((s["bbox"][0] for s in spans if s["text"].strip()), line["bbox"][0]), "y": y, "spans": spans})
    rows.sort(key=lambda row: (row["page"], round(row["y"], 1), row["x"]))
    merged = []
    for row in rows:
        if merged and row["page"] == merged[-1]["page"] and abs(row["y"] - merged[-1]["y"]) < config["sameBaselineTolerance"]:
            previous = merged[-1]
            previous["spans"] += row["spans"]
            previous["spans"].sort(key=lambda span: span["bbox"][0])
            previous["text"] = " ".join(span["text"].strip() for span in previous["spans"] if span["text"].strip())
            previous["x"] = min(previous["x"], row["x"])
        else:
            merged.append(row)
    for index, row in enumerate(merged):
        row["id"] = index
    return merged


def extract(pdf_path: Path, profile: dict) -> tuple[dict, dict, list[dict]]:
    if pdf_path.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("PDF input budget exceeded")
    source = profile["source"]
    if profile.get("version") != 1 or digest(pdf_path.read_bytes()) != source["sourceSha256"]:
        raise ValueError("Wrong source PDF or profile version")
    if source.get("sourceType") != "owner-pdf" or source.get("releaseEligible") is not False:
        raise ValueError("Owner-source overlay must not imply publication rights")
    rows = read_native_rows(pdf_path, profile["nativeRows"])
    paragraphs = []
    first, last = profile["bodyPages"]
    for row in rows:
        if not first <= row["page"] <= last:
            continue
        explicit_start = any(row["page"] == rule["page"] and row["text"].lstrip().startswith(rule["prefix"]) for rule in profile.get("extraParagraphStarts", []))
        if row["x"] > profile["nativeRows"]["paragraphIndent"] or explicit_start or not paragraphs:
            paragraphs.append([])
        paragraphs[-1].append(row)
    if len(paragraphs) != len(profile["paragraphs"]):
        raise ValueError("Source layout changed; paragraph profile must be reviewed")
    blocks = []
    audit = []
    for expected, paragraph in zip(profile["paragraphs"], paragraphs, strict=True):
        raw = "\n".join(row["text"].rstrip() for row in paragraph)
        text = normalize_lines(raw)
        if digest(text.encode()) != expected["textSha256"]:
            raise ValueError(f"Native paragraph mismatch: block {expected['id']}; no guessed text repair")
        blocks.append({"id": expected["id"], "source": source["id"], "text": text, "locator": expected["locator"], "pageStart": expected["pageStart"], "pageEnd": expected["pageEnd"], "textSha256": expected["textSha256"]})
        audit.append({"block": expected["id"], "rawNativeText": raw, "rawSha256": digest(raw.encode()), "nativeRows": [{"id": row["id"], "page": row["page"], "x": row["x"], "y": row["y"]} for row in paragraph]})
    by_id = {block["id"]: block for block in blocks}
    terms = profile["records"]
    ids = set()
    for term in terms:
        if term["id"] in ids or not term["title"].strip() or not term["blockIds"]:
            raise ValueError("Invalid source-profile term identity")
        ids.add(term["id"])
        for key in ("blockIds", "detailBlocks", "itemBlocks"):
            for block_id in term.get(key, []):
                if block_id not in by_id:
                    raise ValueError("Dangling source block")
    origins = []
    for span in profile.get("etymologySpans", []):
        text = by_id[span["block"]]["text"]
        if not 0 <= span["start"] < span["end"] <= len(text):
            raise ValueError("Invalid etymology source span")
        origins.append({**span, "sourceStatement": text[span["start"]:span["end"]]})
    catalog = {"version": 3, "id": profile["catalogId"], "reviewStatus": "requires-review", "publicationState": "local-dev", "textKind": "source-excerpt", "sources": [source], "blocks": blocks, "terms": terms, "etymologyStatements": origins, "historicalMentions": profile.get("historicalMentions", [])}
    payload = json.dumps(catalog, ensure_ascii=False, separators=(",", ":")).encode()
    if len(payload) > 16 * 1024 * 1024:
        raise ValueError("Split the source overlay instead of truncating it")
    report = {"sourceSha256": source["sourceSha256"], "bodyPageRange": [first, last], "blocks": len(blocks), "records": len(terms), "byKind": dict(Counter(term["kind"] for term in terms)), "byCoverage": dict(Counter(term["coverage"] for term in terms)), "etymologyStatements": len(origins), "eponymMentionIdentities": len(catalog["historicalMentions"]), "jsonBytes": len(payload), "gzipBytes": len(gzip.compress(payload, mtime=0)), "allParagraphHashesVerified": True, "clinicalReview": "requires-review", "publication": "owner-local-only"}
    return catalog, report, audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Use a new output directory; source editions are immutable")
    if args.profile.stat().st_size > 4 * 1024 * 1024:
        parser.error("Source profile is too large")
    catalog, report, audit = extract(args.pdf, json.loads(args.profile.read_text()))
    args.output.mkdir(parents=True)
    for name, data in (("definitions.json", catalog), ("report.json", report), ("native-audit.json", audit)):
        (args.output / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
