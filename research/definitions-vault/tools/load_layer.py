"""Read-only loader: flattens the curated definitions/aliases layer into one record list.

Inputs (never modified):
  content/definition-drafts/source-inputs.json   -> the 31 definition source files (27 790 entries)
  content/definition-drafts/completion-inputs.json -> 6 dated name-completion batches
  content/definition-drafts/discovered-names-*.json -> name-only inventory (needs-definition)
  content/definition-gap-fills/*.json
  content/definition-pilot/*.md (+ aliases.yaml)
  content/colloquial-aliases.yaml

Each definition record = one (term entry, definition block) pair with its provenance.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DRAFTS = ROOT / "content" / "definition-drafts"


def norm(text: str) -> str:
    """Concept key: casefold, ё→е, strip punctuation/extra whitespace."""
    text = unicodedata.normalize("NFKC", text).casefold().replace("ё", "е")
    text = re.sub("[\u00ad\u200b]", "", text)
    text = re.sub(r"[«»\"'`()\[\]{}.,;:!?]", " ", text)
    text = re.sub(r"[‐-―−-]+", "-", text)
    return re.sub(r"\s+", " ", text).strip()


def text_norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold().replace("ё", "е")
    text = re.sub(r"\[\d+(?:[,–-]\d+)*\]", "", text)  # citation markers
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class Definition:
    file: str
    term_id: str
    title: str
    kind: str
    aliases: list[str]
    text: str
    family: str
    source: dict = field(default_factory=dict)  # resolved source entry
    block: dict = field(
        default_factory=dict
    )  # provenance fields of the block / reference
    term: dict = field(default_factory=dict)  # remaining term fields


def family_of(rel: str) -> str:
    name = rel.split("/")[-1]
    if "clinical-glossary" in rel:
        return "kr-glossary-abbrev"
    if "clinical-source-excerpts" in rel:
        return "kr-source-excerpts"
    if "ruwiktionary" in rel:
        return "ruwiktionary"
    if "specialist" in rel:
        return "specialist-journals"
    if "prepared-source" in rel:
        return "prepared-excerpts"
    if "completions" in rel:
        return "name-completions"
    if "gap-fills" in rel:
        return "gap-fills"
    if "pilot" in rel:
        return "pilot-md"
    return name.replace(".json", "")


def load_block_file(rel: str, data: dict) -> list[Definition]:
    sources = {s["id"]: s for s in data.get("sources", [])}
    blocks = {b["id"]: b for b in data.get("blocks", [])}
    out: list[Definition] = []
    fam = family_of(rel)
    for t in data.get("terms", []):
        rest = {
            k: v
            for k, v in t.items()
            if k
            not in (
                "id",
                "title",
                "kind",
                "aliases",
                "blockIds",
                "definition",
                "references",
            )
        }
        if "definition" in t:  # inline style (catalog.json, ruwiktionary)
            refs = t.get("references") or [{}]
            ref = refs[0]
            out.append(
                Definition(
                    rel,
                    t["id"],
                    t["title"],
                    t.get("kind", ""),
                    list(t.get("aliases", [])),
                    t["definition"],
                    fam,
                    sources.get(ref.get("source"), {}),
                    dict(ref),
                    rest,
                )
            )
            continue
        for bid in t.get("blockIds", []):
            b = blocks[bid]
            prov = {k: v for k, v in b.items() if k != "text"}
            out.append(
                Definition(
                    rel,
                    t["id"],
                    t["title"],
                    t.get("kind", ""),
                    list(t.get("aliases", [])),
                    b["text"],
                    fam,
                    sources.get(b.get("source"), {}),
                    prov,
                    rest,
                )
            )
    return out


def load_completions(rel: str, data: dict) -> list[Definition]:
    cat = data["catalog"]
    sources = {s["id"]: s for s in cat.get("sources", [])}
    blocks = {b["id"]: b for b in cat.get("blocks", [])}
    out = []
    terms = cat.get("terms", [])
    for t in terms:
        for bid in t.get("blockIds", []):
            b = blocks[bid]
            out.append(
                Definition(
                    rel,
                    t["id"],
                    t["title"],
                    t.get("kind", ""),
                    list(t.get("aliases", [])),
                    b["text"],
                    "name-completions",
                    sources.get(b.get("source"), {}),
                    {k: v for k, v in b.items() if k != "text"},
                    {
                        k: v
                        for k, v in t.items()
                        if k not in ("id", "title", "kind", "aliases", "blockIds")
                    },
                )
            )
    return out


def load_gap_fills(rel: str, data: dict) -> list[Definition]:
    sources = {s["id"]: s for s in data.get("sources", [])}
    return [
        Definition(
            rel,
            "gapfill." + f["id"],
            f["targetTitle"],
            "",
            [],
            f["excerpt"],
            "gap-fills",
            sources.get(f.get("source"), {}),
            {k: v for k, v in f.items() if k not in ("excerpt",)},
            {},
        )
        for f in data.get("fills", [])
    ]


def load_pilot() -> list[Definition]:
    out = []
    for p in sorted((ROOT / "content" / "definition-pilot").glob("*.md")):
        raw = p.read_text()
        _, fm, body = raw.split("---", 2)
        title = re.search(r"^title: (.+)$", fm, re.MULTILINE).group(1).strip()
        tid = re.search(r"^id: (.+)$", fm, re.MULTILINE).group(1).strip()
        al = re.search(r"navigationAliases: \[(.*)\]", fm)
        aliases = [a.strip() for a in al.group(1).split(",")] if al else []
        m = re.search(
            r"# Определение\s*\n(?:<!--.*?-->\s*\n)?(.+?)(?:\n#|\Z)", body, re.DOTALL
        )
        out.append(
            Definition(
                f"content/definition-pilot/{p.name}",
                tid,
                title,
                "",
                aliases,
                m.group(1).strip() if m else "",
                "pilot-md",
            )
        )
    return out


def load_colloquial() -> list[dict]:
    rows, cur = [], None
    for line in (ROOT / "content" / "colloquial-aliases.yaml").read_text().splitlines():
        m = re.match(r"\s*-\s+id:\s*(.+)", line)
        if m:
            cur = {"id": m.group(1).strip()}
            rows.append(cur)
            continue
        m = re.match(r"\s+(\w+):\s*(.+)", line)
        if m and cur is not None:
            cur[m.group(1)] = m.group(2).strip()
    return rows


def source_input_paths() -> list[str]:
    return [
        i["path"]
        for i in json.loads((DRAFTS / "source-inputs.json").read_text())["inputs"]
    ]


def completion_paths() -> list[str]:
    return [
        i["path"]
        for i in json.loads((DRAFTS / "completion-inputs.json").read_text())["inputs"]
    ]


def load_all() -> list[Definition]:
    defs: list[Definition] = []
    for rel in source_input_paths():
        defs += load_block_file(rel, json.loads((ROOT / rel).read_text()))
    for rel in completion_paths():
        defs += load_completions(rel, json.loads((ROOT / rel).read_text()))
    for p in sorted((ROOT / "content" / "definition-gap-fills").glob("*.json")):
        defs += load_gap_fills(str(p.relative_to(ROOT)), json.loads(p.read_text()))
    defs += load_pilot()
    return defs


def discovered_names() -> list[dict]:
    path = next(DRAFTS.glob("discovered-names-*.json"))
    return json.loads(path.read_text())["names"]
