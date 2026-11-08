"""Definitions as a vault of linked Markdown notes — research prototype (measure only).

  python3 vault.py convert  --out DIR [--pilot FILE] [--link]   JSON layer -> notes
  python3 vault.py build    --vault DIR --out DIR               notes -> the JSON/YAML files of today
  python3 vault.py validate --vault DIR                         ids, aliases, provenance, hashes
  python3 vault.py compare  --built DIR [--pilot]               byte comparison with content/

Notes: one per concept (normalized title). Frontmatter = id, title, aliases, kind, related, sources.
Each definition = `## <source>` + verbatim text (+ optional [[links]]) + `^def-…` + a ```def fence
with the original record (text replaced by "@text"). Records without text (term entries, discovered
names, completion targets, colloquial aliases) sit in ```rec fences under «## Записи».
File headers (sources, ids, receipts) live in `_источники/*.md`.
"""

from __future__ import annotations

import argparse
import collections
import copy
import hashlib
import json
import re
import sys
import time
from pathlib import Path

import linker as LK
import load_layer as L

ROOT = L.ROOT
TEXT = "@text"
FENCE_DEF = "```def"
FENCE_REC = "```rec"
FENCE_SRC = "```source-file"
LINK_RE = re.compile(r"\[\[[^\]|]*\|([^\]]*)\]\]")
LINK_PLAIN_RE = re.compile(r"\[\[([^\]|]*)\]\]")
SOURCES_DIR = "_источники"

# --------------------------------------------------------------------------- layouts


def dumps(v) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def layout_render(doc, layout: str) -> str:
    name, tail = layout.split("+") if "+" in layout else (layout, "")
    nl = "\n" if tail == "nl" else ""
    if name == "compact":
        return dumps(doc) + nl
    if name == "indent2":
        return json.dumps(doc, ensure_ascii=False, indent=2) + nl
    if name == "rows-compact":
        parts = []
        for k, v in doc.items():
            if isinstance(v, list):
                parts.append(
                    json.dumps(k, ensure_ascii=False)
                    + ":[\n"
                    + ",\n".join(dumps(x) for x in v)
                    + "\n]"
                )
            else:
                parts.append(json.dumps(k, ensure_ascii=False) + ":" + dumps(v))
        return "{" + ",".join(parts) + "}" + nl
    if name == "rows-indent2":
        parts = []
        for k, v in doc.items():
            key = json.dumps(k, ensure_ascii=False)
            if isinstance(v, list):
                parts.append(
                    f"  {key}: [\n"
                    + ",\n".join("    " + json.dumps(x, ensure_ascii=False) for x in v)
                    + "\n  ]"
                )
            else:
                parts.append(f"  {key}: " + json.dumps(v, ensure_ascii=False))
        return "{\n" + ",\n".join(parts) + "\n}" + nl
    raise ValueError(layout)


def detect_layout(raw: str, doc) -> str | None:
    for name in ("compact", "indent2", "rows-compact", "rows-indent2"):
        for tail in ("", "nl"):
            lay = name + ("+" + tail if tail else "")
            if layout_render(doc, lay) == raw:
                return lay
    return None


def render_yaml_aliases(rows: list[dict]) -> str:
    out = ["aliases:"]
    for r in rows:
        first = True
        for k, v in r.items():
            out.append(("  - " if first else "    ") + f"{k}: {v}")
            first = False
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------- inputs


def input_files() -> list[str]:
    files = L.source_input_paths() + L.completion_paths()
    files += [
        str(p.relative_to(ROOT))
        for p in sorted((ROOT / "content" / "definition-gap-fills").glob("*.json"))
    ]
    files.append(str(next(L.DRAFTS.glob("discovered-names-*.json")).relative_to(ROOT)))
    return files


def container(doc: dict) -> dict:
    return (
        doc["catalog"] if "catalog" in doc and isinstance(doc["catalog"], dict) else doc
    )


COLLECTIONS = ("terms", "blocks", "fills", "names")


def split_file(rel: str):
    raw = (ROOT / rel).read_text()
    doc = json.loads(raw)
    layout = detect_layout(raw, doc) or "compact"
    header = copy.deepcopy(doc)
    c = container(doc)
    hc = container(header)
    recs = []  # (at, pos, record)
    for coll in COLLECTIONS:
        if coll in c:
            for i, r in enumerate(c[coll]):
                recs.append((coll, i, r))
            hc[coll] = "@" + coll
    if "targets" in doc:
        for i, r in enumerate(doc["targets"]):
            recs.append(("targets", i, r))
        header["targets"] = "@targets"
    return header, layout, recs, raw


# --------------------------------------------------------------------------- naming

UNSAFE = re.compile(r'[\\/*"<>|?#^\[\]]')


def note_name(title: str) -> str:
    t = title.replace(":", " — ")
    t = UNSAFE.sub(lambda m: "∕" if m.group(0) in "/\\" else "-", t)
    t = re.sub(r"\s+", " ", t).strip().strip(".") or "без названия"
    if len(t) > 100:
        t = t[:90].rstrip() + "… " + hashlib.sha256(title.encode()).hexdigest()[:6]
    return t


def concept_id(key: str) -> str:
    return "c." + hashlib.sha256(key.encode()).hexdigest()[:12]


def def_id(rel: str, at: str, rid) -> str:
    return "def-" + hashlib.sha256(f"{rel}:{at}:{rid}".encode()).hexdigest()[:10]


def short_source(rel: str, header: dict, rec: dict) -> str:
    srcs = {
        s.get("id"): s
        for s in container(header).get("sources", [])
        if isinstance(s, dict)
    }
    s = srcs.get(rec.get("source")) or {}
    if rec.get("documentTitle"):
        name = "КР — " + rec["documentTitle"]
    elif "clinical-glossary" in rel or "clinical-source" in rel:
        name = "КР — " + (
            rec.get("parentTitle")
            or rec.get("sourceFile")
            or rec.get("documentId")
            or s.get("title")
            or ""
        )
    else:
        name = s.get("title") or Path(rel).stem
    name = re.sub(r"\s+", " ", name.replace("#", "-").replace("^", "-")).strip()
    return name if len(name) <= 80 else name[:78] + "…"


# --------------------------------------------------------------------------- convert


def fm_line(k: str, v) -> str:
    return f"{k}: {json.dumps(v, ensure_ascii=False)}"


def convert(out: Path, pilot: set[str] | None, link: bool) -> dict:
    t0 = time.time()
    files = input_files()
    notes: dict[str, dict] = collections.OrderedDict()

    def note(key: str, title: str) -> dict:
        if key not in notes:
            notes[key] = {
                "title": title,
                "kinds": collections.Counter(),
                "aliases": [],
                "defs": [],
                "recs": [],
                "sources": [],
            }
        return notes[key]

    headers = {}
    for rel in files:
        header, layout, recs, _ = split_file(rel)
        headers[rel] = (header, layout)
        terms = [r for at, _, r in recs if at == "terms"]
        block_owner: dict[int, str] = {}
        block_role: dict[int, str] = {}
        for t in terms:
            for k, role in (
                ("blockIds", "definition"),
                ("itemBlocks", "detail"),
                ("detailBlocks", "detail"),
            ):
                for b in t.get(k, []) or []:
                    if b not in block_owner:
                        block_owner[b] = L.norm(t["title"])
                        block_role[b] = role
        for at, pos, r in recs:
            rec = copy.deepcopy(r)
            text = None
            if at == "terms":
                key, title = L.norm(r["title"]), r["title"]
                if "definition" in r:
                    text, rec["definition"] = r["definition"], TEXT
            elif at == "blocks":
                key = block_owner.get(r["id"])
                title = None
                text, rec["text"] = r["text"], TEXT
                if key is None:
                    key = "__orphan__" + rel
            elif at == "fills":
                key, title = L.norm(r["targetTitle"]), r["targetTitle"]
                text, rec["excerpt"] = r["excerpt"], TEXT
            elif at == "names":
                key, title = L.norm(r["title"]), r["title"]
            else:  # targets
                key, title = L.norm(r["expectedTitle"]), r["expectedTitle"]
            if pilot is not None and key not in pilot:
                continue
            n = note(key, title or key)
            if title and n["title"] == key:
                n["title"] = title
            if at in ("terms", "names"):
                n["kinds"][r.get("kind", "")] += 1
                for a in r.get("aliases", []) or []:
                    if a not in n["aliases"]:
                        n["aliases"].append(a)
            fence = {"file": rel, "at": at, "pos": pos, "record": rec}
            if text is not None:
                role = (
                    block_role.get(r.get("id"), "definition")
                    if at == "blocks"
                    else "definition"
                )
                src = short_source(rel, header, r)
                if src not in n["sources"]:
                    n["sources"].append(src)
                n["defs"].append(
                    {
                        "text": text,
                        "fence": fence,
                        "role": role,
                        "src": src,
                        "id": def_id(rel, at, r.get("id", pos)),
                    }
                )
            else:
                n["recs"].append(fence)
    # colloquial aliases
    for i, r in enumerate(L.load_colloquial()):
        key = L.norm(r["canonicalTerm"])
        if pilot is not None and key not in pilot:
            continue
        n = note(key, r["canonicalTerm"])
        if n["title"] == key:
            n["title"] = r["canonicalTerm"]
        if r["alias"] not in n["aliases"]:
            n["aliases"].append(r["alias"])
        n["recs"].append(
            {
                "file": "content/colloquial-aliases.yaml",
                "at": "aliases",
                "pos": i,
                "record": r,
            }
        )

    # names (filenames), case-insensitive unique
    used: dict[str, int] = {}
    for key, n in notes.items():
        if key.startswith("__orphan__"):
            n["file"] = f"{SOURCES_DIR}/осиротевшие — {Path(key[10:]).stem}"
            continue
        base = note_name(n["title"])
        k = base.casefold()
        used[k] = used.get(k, 0) + 1
        n["file"] = base if used[k] == 1 else f"{base} ({used[k]})"

    linked = 0
    if link:
        forms: dict[str, str] = {}
        for key, n in notes.items():
            if key.startswith("__orphan__"):
                continue
            for f in [n["title"], *n["aliases"]]:
                forms.setdefault(f, key)
        lk = LK.Linker(forms, "exact")
        for key, n in notes.items():
            for d in n["defs"]:
                if d["role"] != "definition":
                    continue
                tx = d["text"]
                # a match glued to "[" or "]" would form "[[[" / "]]]" (unresolvable, and not strippable)
                spans = [
                    s
                    for s in lk.find(tx)
                    if s[2] != key
                    and tx[s[0] - 1 : s[0]] != "["
                    and tx[s[1] : s[1] + 1] != "]"
                ]
                if not spans:
                    continue
                t = d["text"]
                for s, e, tgt in reversed(spans):
                    t = t[:s] + f"[[{notes[tgt]['file']}|{t[s:e]}]]" + t[e:]
                    linked += 1
                d["text"] = t

    out.mkdir(parents=True, exist_ok=True)
    (out / SOURCES_DIR).mkdir(exist_ok=True)
    for rel, (header, layout) in headers.items():
        if (
            pilot is not None
            and not any(
                f["fence"]["file"] == rel for n in notes.values() for f in n["defs"]
            )
            and not any(f["file"] == rel for n in notes.values() for f in n["recs"])
        ):
            continue
        body = [
            "---",
            fm_line("type", "source-file"),
            fm_line("file", rel),
            fm_line("layout", layout),
            "---",
            "",
            f"Заголовок файла `{rel}`: источники, квитанции, состояние проверки. Записи терминов — в заметках понятий.",
            "",
            FENCE_SRC,
            json.dumps(header, ensure_ascii=False, indent=1),
            "```",
            "",
        ]
        (out / SOURCES_DIR / (Path(rel).name.replace(".json", "") + ".md")).write_text(
            "\n".join(body)
        )

    for key, n in notes.items():
        lines = []
        if not key.startswith("__orphan__"):
            kind = n["kinds"].most_common(1)[0][0] if n["kinds"] else ""
            lines += [
                "---",
                fm_line("id", concept_id(key)),
                fm_line("title", n["title"]),
                fm_line("aliases", n["aliases"]),
                fm_line("kind", kind),
                fm_line("related", []),
                fm_line("sources", n["sources"]),
                fm_line(
                    "definitions",
                    sum(1 for d in n["defs"] if d["role"] == "definition"),
                ),
                "---",
                "",
            ]
        seen_h = collections.Counter()
        for d in n["defs"]:
            h = d["src"] if d["role"] == "definition" else "Фрагмент — " + d["src"]
            seen_h[h] += 1
            if seen_h[h] > 1:
                h = f"{h} ({seen_h[h]})"
            lines += [
                f"## {h}",
                "",
                d["text"],
                "",
                "^" + d["id"],
                "",
                FENCE_DEF,
                json.dumps(d["fence"], ensure_ascii=False),
                "```",
                "",
            ]
        if n["recs"]:
            lines += ["## Записи", ""]
            for r in n["recs"]:
                lines += [FENCE_REC, json.dumps(r, ensure_ascii=False), "```", ""]
        path = out / (n["file"] + ".md")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines))
    return {
        "notes": len(notes),
        "links_inserted": linked,
        "seconds": round(time.time() - t0, 2),
    }


# --------------------------------------------------------------------------- parse / build


def parse_note(path: Path) -> dict:
    raw = path.read_text()
    fm = {}
    body = raw
    if raw.startswith("---\n"):
        end = raw.index("\n---\n", 4)
        for line in raw[4:end].splitlines():
            k, _, v = line.partition(": ")
            fm[k] = json.loads(v)
        body = raw[end + 5 :]
    defs, recs, src = [], [], None
    i = 0
    while True:
        j_def = body.find("\n" + FENCE_DEF + "\n", i)
        j_rec = body.find(FENCE_REC + "\n", i)
        j_src = body.find(FENCE_SRC + "\n", i)
        nxt = min(
            x
            for x in (
                j_def if j_def >= 0 else 1 << 60,
                j_rec if j_rec >= 0 else 1 << 60,
                j_src if j_src >= 0 else 1 << 60,
            )
        )
        if nxt == 1 << 60:
            break
        if nxt == j_def:
            # text = between heading's blank line and "\n\n^def-…\n"
            hstart = body.rfind("\n## ", 0, j_def)
            hstart = 0 if hstart < 0 and body.startswith("## ") else hstart + 1
            text_start = body.index("\n", hstart) + 2
            marker = body.rfind("\n\n^def-", text_start, j_def + 1)
            text = body[text_start:marker]
            did = body[marker + 3 : body.index("\n", marker + 3)]
            fstart = j_def + len(FENCE_DEF) + 2
            fend = body.index("\n```", fstart)
            defs.append(
                {"text": text, "id": did, "fence": json.loads(body[fstart:fend])}
            )
            i = fend + 4
        elif nxt == j_rec:
            fstart = j_rec + len(FENCE_REC) + 1
            fend = body.index("\n```", fstart)
            recs.append(json.loads(body[fstart:fend]))
            i = fend + 4
        else:
            fstart = j_src + len(FENCE_SRC) + 1
            fend = body.index("\n```", fstart)
            src = json.loads(body[fstart:fend])
            i = fend + 4
    return {"fm": fm, "defs": defs, "recs": recs, "src": src}


def strip_links(text: str) -> str:
    return LINK_PLAIN_RE.sub(r"\1", LINK_RE.sub(r"\1", text))


def build(vault: Path, out: Path) -> dict:
    t0 = time.time()
    headers: dict[str, tuple[dict, str]] = {}
    coll: dict[str, dict[str, list]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    aliases_rows = []
    nnotes = 0
    for p in sorted(vault.rglob("*.md")):
        if ".obsidian" in p.parts:
            continue
        nnotes += 1
        n = parse_note(p)
        if n["src"] is not None:
            headers[n["fm"]["file"]] = (n["src"], n["fm"]["layout"])
        for d in n["defs"]:
            f = d["fence"]
            rec = copy.deepcopy(f["record"])
            text = strip_links(d["text"])
            for k, v in rec.items():
                if v == TEXT:
                    rec[k] = text
            coll[f["file"]][f["at"]].append((f["pos"], rec))
        for f in n["recs"]:
            if f["file"].endswith(".yaml"):
                aliases_rows.append((f["pos"], f["record"]))
            else:
                coll[f["file"]][f["at"]].append((f["pos"], f["record"]))
    written = []
    for rel, (header, layout) in headers.items():
        doc = copy.deepcopy(header)
        c = container(doc)
        for at, items in coll[rel].items():
            items.sort(key=lambda x: x[0])
            seen = {}
            vals = []
            for pos, rec in items:
                if pos in seen:  # same block stored in two notes
                    if seen[pos] != rec:
                        raise SystemExit(f"{rel} {at} pos {pos}: copies differ")
                    continue
                seen[pos] = rec
                vals.append(rec)
            if at == "targets":
                doc["targets"] = vals
            else:
                c[at] = vals
        for k in COLLECTIONS:
            if c.get(k) == "@" + k:
                c[k] = []
        if doc.get("targets") == "@targets":
            doc["targets"] = []
        dst = out / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(layout_render(doc, layout))
        written.append(rel)
    if aliases_rows:
        aliases_rows.sort(key=lambda x: x[0])
        dst = out / "content" / "colloquial-aliases.yaml"
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(render_yaml_aliases([r for _, r in aliases_rows]))
        written.append("content/colloquial-aliases.yaml")
    return {
        "notes_read": nnotes,
        "files_written": len(written),
        "seconds": round(time.time() - t0, 2),
    }


# --------------------------------------------------------------------------- validate

REQUIRED_PROV = ("source", "locator")
HASH_KEYS = ("textSha256", "recordSha256")


def validate(vault: Path) -> dict:
    errs = collections.Counter()
    examples = collections.defaultdict(list)

    def err(kind: str, msg: str) -> None:
        errs[kind] += 1
        if len(examples[kind]) < 5:
            examples[kind].append(msg)

    ids: dict[str, str] = {}
    alias_owner: dict[str, set[str]] = collections.defaultdict(set)
    titles: dict[str, str] = {}
    notes = {}
    for p in sorted(vault.rglob("*.md")):
        if ".obsidian" in p.parts:
            continue
        n = parse_note(p)
        notes[p] = n
        fm = n["fm"]
        if fm.get("type") == "source-file" or p.parent.name == SOURCES_DIR:
            continue
        cid = fm.get("id", "")
        if not re.fullmatch(r"c\.[0-9a-f]{12}", cid or ""):
            err("bad-id", p.name)
        elif cid in ids:
            err("duplicate-id", f"{p.name} = {ids[cid]}")
        ids[cid] = p.name
        titles[L.norm(fm.get("title", ""))] = p.stem
        for a in fm.get("aliases", []):
            alias_owner[L.norm(a)].add(p.stem)
    for a, owners in alias_owner.items():
        if len(owners) > 1:
            err("alias-two-concepts", f"{a} → {sorted(owners)}")
        if a in titles and titles[a] not in owners:
            err("alias-is-other-title", f"{a} → {sorted(owners)} vs {titles[a]}")
    stems = {p.stem for p in notes}
    unresolved = collections.Counter()
    for p, n in notes.items():
        for d in n["defs"]:
            rec = d["fence"]["record"]
            text = strip_links(d["text"])
            f = d["fence"]
            for tgt in re.findall(r"\[\[([^\]|]*)", d["text"]):
                if tgt not in stems:
                    unresolved[tgt] += 1
            if f["at"] == "terms":  # inline definitions keep provenance in references[]
                prov = dict((rec.get("references") or [{}])[0])
            elif f["at"] == "fills":
                prov = {"source": rec.get("source"), "locator": rec.get("locator")}
            else:
                prov = rec
            for k in REQUIRED_PROV:
                if prov.get(k) in (None, ""):
                    err(f"missing-{k}", f"{p.stem}: {f['file']}")
            h = (
                prov.get("textSha256")
                or prov.get("recordSha256")
                or (prov.get("sourceVerification") or {}).get("excerptSha256")
            )
            if not h:
                err("missing-hash", f"{p.stem}: {f['file']}")
            elif (
                prov.get("textSha256")
                and hashlib.sha256(text.encode()).hexdigest() != prov["textSha256"]
            ):
                err("hash-mismatch", f"{p.stem}: {f['file']} {d['id']}")
    return {
        "errors": dict(errs),
        "examples": dict(examples),
        "unresolved_link_targets": len(unresolved),
        "unresolved_link_occurrences": sum(unresolved.values()),
        "notes": len(notes),
    }


# --------------------------------------------------------------------------- compare


def compare(built: Path, files: list[str]) -> dict:
    res = {"identical": [], "different": [], "missing": []}
    for rel in files:
        b = built / rel
        if not b.exists():
            res["missing"].append(rel)
            continue
        same = b.read_bytes() == (ROOT / rel).read_bytes()
        res["identical" if same else "different"].append(rel)
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "cmd", choices=["convert", "build", "validate", "compare", "pilot-compare"]
    )
    ap.add_argument("--out")
    ap.add_argument("--vault")
    ap.add_argument("--built")
    ap.add_argument("--pilot")
    ap.add_argument("--link", action="store_true")
    a = ap.parse_args()
    if a.cmd == "convert":
        pilot = set(json.loads(Path(a.pilot).read_text())) if a.pilot else None
        r = convert(Path(a.out), pilot, a.link)
    elif a.cmd == "build":
        r = build(Path(a.vault), Path(a.out))
    elif a.cmd == "validate":
        r = validate(Path(a.vault))
    elif a.cmd == "pilot-compare":
        r = pilot_compare(Path(a.built), set(json.loads(Path(a.pilot).read_text())))
    else:
        r = compare(Path(a.built), input_files() + ["content/colloquial-aliases.yaml"])
        r = {k: (v if k != "identical" else len(v)) for k, v in r.items()}
    json.dump(r, sys.stdout, ensure_ascii=False, indent=1)
    print()


# --------------------------------------------------------------------------- pilot projection


def project_original(rel: str, pilot: set[str]) -> str:
    """Original file reduced to the pilot's records, rendered in its own layout (independent of convert)."""
    header, layout, recs, _ = split_file(rel)
    doc = copy.deepcopy(header)
    c = container(doc)
    terms = [r for at, _, r in recs if at == "terms"]
    owner = {}
    for t in terms:
        for k in ("blockIds", "itemBlocks", "detailBlocks"):
            for b in t.get(k, []) or []:
                owner.setdefault(b, L.norm(t["title"]))
    keep = collections.defaultdict(list)
    for at, _, r in recs:
        if at in ("terms", "names"):
            key = L.norm(r["title"])
        elif at == "fills":
            key = L.norm(r["targetTitle"])
        elif at == "targets":
            key = L.norm(r["expectedTitle"])
        else:
            key = owner.get(r["id"])
        if key in pilot:
            keep[at].append(r)
    for k in COLLECTIONS:
        if c.get(k) == "@" + k:
            c[k] = keep.get(k, [])
    if doc.get("targets") == "@targets":
        doc["targets"] = keep.get("targets", [])
    return layout_render(doc, layout)


def pilot_compare(built: Path, pilot: set[str]) -> dict:
    out = {
        "files": {},
        "projection_identical": 0,
        "projection_different": 0,
        "whole_file_identical": [],
    }
    for rel in input_files():
        b = built / rel
        if not b.exists():
            continue
        got = b.read_text()
        same = got == project_original(rel, pilot)
        out["projection_identical" if same else "projection_different"] += 1
        whole = got == (ROOT / rel).read_text()
        if whole:
            out["whole_file_identical"].append(rel)
        out["files"][rel] = {
            "records_bytes": len(got.encode()),
            "projection_identical": same,
            "whole_file_identical": whole,
        }
    y = built / "content" / "colloquial-aliases.yaml"
    if y.exists():
        rows = [r for r in L.load_colloquial() if L.norm(r["canonicalTerm"]) in pilot]
        out["colloquial_yaml_projection_identical"] = (
            y.read_text() == render_yaml_aliases(rows)
        )
    return out


if __name__ == "__main__":
    main()
