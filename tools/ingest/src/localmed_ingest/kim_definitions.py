"""Lead definitions of krasotaimedicina.ru disease articles, as dictionary candidates.

Every article opens with «**Термин** – определение…» in its «Краткое описание» section. This
module reads the built, unchanged site module (`minimed.krasotaimedicina.diseases.db`), takes
the first sentence of that opening paragraph as the source definition, and records where it
stands: the page address, the reader anchor of the exact chunk, the crawl time and the page's
own rubric (`/diseases/psychiatric/…` → психиатрия), which names the field of the sense.

Boundaries (REFERENCE_SOURCE_POLICY, owner decision 2026-09-28):

- the text is the site's own sentence, markup removed, never reworded and never cut inside a
  sentence — a lead whose first sentence is longer than `MAX_SENTENCE_WORDS` is skipped and
  counted;
- the article stays `rightsStatus: unresolved`, `requiresReview: true`; nothing here is a
  clinical recommendation or a rights clearance;
- an article whose lead does not open with its own title followed by a dash is not a definition
  and is skipped.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path
from typing import Any

from .kr_fields import field_for_krasotaimedicina_url
from .kr_registry_glossary import digest, kind_for, normalized
from .kr_term_boundary import term_names

BASE_URL = "https://www.krasotaimedicina.ru/"
MAX_SENTENCE_WORDS = 60
MIN_SENTENCE_WORDS = 5
_ABBREVIATIONS = (
    "т.е", "т.д", "т.п", "т.н", "т.к", "и т", "и др", "и пр", "лат", "англ", "нем", "греч",
    "фр", "см", "рис", "табл", "напр", "ок", "ул", "им", "г", "гг", "мм", "ср", "стр", "проф",
    "доц", "акад", "вкл", "т.ч", "в т.ч", "о.", "p", "ст", "ч", "п",
)  # fmt: skip
_BOLD_LEAD = re.compile(r"^\s*\*\*(?P<term>.+?)\*\*\s*(?P<rest>.*)$", re.DOTALL)
_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")


def plain_text(markdown: str) -> str:
    """Visible text of a markdown paragraph: links keep their label, bold marks drop."""
    text = _LINK.sub(r"\1", markdown)
    text = text.replace("**", "").replace("__", "")
    return " ".join(text.split())


def first_sentence(text: str) -> str | None:
    """The first sentence, or `None` when no sentence boundary closes it.

    A boundary is «.», «!», «?» followed by space and a capital letter, quote or digit, except
    after a known abbreviation («лат.», «т.е.», «англ.») or a single initial.
    """
    for match in re.finditer(r"[.!?…](?=\s+[«\"A-ZА-ЯЁ0-9])", text):
        head = text[: match.start()]
        tail = re.search(r"(\S+)$", head)
        token = (tail.group(1) if tail else "").lower().strip('(«"')
        if token in _ABBREVIATIONS or (len(token) == 1 and token.isalpha()):
            continue
        return text[: match.end()].strip()
    return text.strip() if re.search(r"[.!?…]$", text.strip()) else None


_LATIN_LOOKALIKES = str.maketrans("ABCEHKMOPTXabcehkmoptx", "АВСЕНКМОРТХавсенкмортх")
_OPENER = re.compile(
    r"^\s*(?:\([^)]*\)\s*)?(?:[‐‑‒–—―−-]|(?:это|представляет собой)(?![\w]))", re.IGNORECASE
)


def loose(value: str) -> str:
    """Spelling-insensitive key: Latin lookalikes, case, hyphens and spaces do not matter."""
    folded = normalized(value).translate(_LATIN_LOOKALIKES)
    return re.sub(r"[\W_]+", "", folded)


def lead_definition(chunk: str, title: str) -> tuple[str, str] | None:
    """(term as the page prints it, first sentence with the term) or `None`."""
    bold = _BOLD_LEAD.match(chunk.strip().replace("\xad", ""))
    if bold is None:
        return None
    term = plain_text(bold.group("term")).rstrip(" ‐‑‒–—―−-")
    rest = plain_text(bold.group("rest"))
    inside = bold.group("term")
    if not term or not ((rest and _OPENER.match(rest)) or re.search(r"[–—―-]\s*$", inside)):
        return None
    head = loose(term_names(title).title)
    # The bold term may add a qualifier («Вирусный гепатит A» for the title «Гепатит A»).
    if not (head in loose(term) or loose(term) in head):
        return None
    sentence = first_sentence(plain_text(chunk.replace("\xad", "")))
    return (term, sentence) if sentence else None


def extract(database: Path, *, accessed: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """(version-3 shard, report) for every article of the site module."""
    stats: Counter[str] = Counter()
    blocks: list[dict[str, Any]] = []
    terms: list[dict[str, Any]] = []
    skipped: dict[str, list[str]] = {}
    uri = f"{database.resolve().as_uri()}?mode=ro"
    query = (
        "SELECT d.id, d.title, d.metadata_json, v.source_checksum, c.original_text, c.anchor "
        "FROM documents d JOIN document_versions v ON v.document_id = d.id "
        "JOIN sections s ON s.document_version_id = v.id AND s.title = 'Краткое описание' "
        "JOIN chunks c ON c.section_id = s.id AND c.order_index = 0 ORDER BY d.id"
    )
    with closing(sqlite3.connect(uri, uri=True)) as connection:
        rows = connection.execute(query).fetchall()
    for document_id, title, metadata_json, checksum, chunk, anchor in rows:
        stats["articles"] += 1
        metadata = json.loads(metadata_json)
        lead = lead_definition(chunk, title)
        reason: str | None = None
        if lead is None:
            reason = "lead-is-not-term-dash-definition"
        elif len(lead[1].split()) > MAX_SENTENCE_WORDS:
            reason = "first-sentence-too-long"
        elif len(lead[1].split()) < MIN_SENTENCE_WORDS:
            reason = "first-sentence-too-short"
        if reason is not None or lead is None:
            stats[f"skipped:{reason}"] += 1
            skipped.setdefault(str(reason), [])
            if len(skipped[str(reason)]) < 8:
                skipped[str(reason)].append(title)
            continue
        names = term_names(title)
        url = str(metadata["officialSourceUrl"])
        field_id = field_for_krasotaimedicina_url(url)
        block_id = len(blocks) + 1
        blocks.append(
            {
                "id": block_id,
                "source": 1,
                "text": lead[1],
                "textSha256": digest(lead[1]),
                "path": url.removeprefix(BASE_URL),
                "locator": (
                    f"site=krasotaimedicina.ru; document={document_id}; section=краткое-описание"
                ),
                "documentId": document_id,
                "documentTitle": title,
                "sectionTitle": "Краткое описание",
                "anchor": anchor,
                "rawSha256": str(checksum).removeprefix("sha256:"),
                "fetchedAt": metadata.get("fetchedAt"),
                **({"field": field_id} if field_id else {}),
            }
        )
        terms.append(
            {
                "id": f"kim.{digest(document_id)[:20]}",
                "title": names.title,
                "kind": "syndrome"
                if metadata.get("entityType") == "syndrome"
                else kind_for(names.title),
                "aliases": list(names.aliases),
                "blockIds": [block_id],
                "coverage": "explicit-definition",
            }
        )
        stats["extracted"] += 1
        stats[f"field:{field_id}"] += 1
    shard: dict[str, Any] = {
        "version": 3,
        "id": "minimed.definition.krasotaimedicina-leads.2026-10-08",
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [
            {
                "id": 1,
                "title": "Красота и медицина: «Краткое описание» статей о заболеваниях",
                "baseUrl": BASE_URL,
                "authority": "third-party",
                "accessed": accessed,
                "rightsStatus": "unresolved",
                "releaseEligible": False,
                "sourceType": "medical-reference-site",
                "publisher": "Красота и медицина",
                "decision": "owner experimental-preview 2026-09-28",
            }
        ],
        "blocks": blocks,
        "terms": terms,
    }
    report = {
        "format": "minimed-krasotaimedicina-leads-v1",
        "counts": dict(sorted(stats.items())),
        "skippedExamples": skipped,
        "maxSentenceWords": MAX_SENTENCE_WORDS,
    }
    return shard, report


SYMPTOM_SOURCE_TITLE = "Красота и медицина: описания симптомов"
_BOLD_TAG = re.compile(r"</?(?:b|strong)\b[^>]*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")
_DESCRIPTION = re.compile(r'itemprop="description"[^>]*>\s*<p[^>]*>(.*?)</p>', re.DOTALL)


def page_lead(html_text: str) -> str | None:
    """The opening paragraph of a site page as markdown-bold text, or `None` without one."""
    match = _DESCRIPTION.search(html_text)
    if match is None:
        return None
    marked = _BOLD_TAG.sub("**", match.group(1))
    return " ".join(html.unescape(_TAG.sub("", marked)).replace("\xa0", " ").split())


def extract_symptoms(raw_root: Path, *, accessed: str) -> tuple[dict[str, Any], dict[str, Any]]:
    """(version-3 shard, report) for the symptom pages of the unchanged crawl.

    The symptom pages are not part of the published disease module, so there is no reader anchor:
    the card links to the page itself. The owner decision of 2026-09-28 covers the disease
    articles only; this shard is a local candidate until the decision is extended.
    """
    stats: Counter[str] = Counter()
    blocks: list[dict[str, Any]] = []
    terms: list[dict[str, Any]] = []
    skipped: dict[str, list[str]] = {}
    for record_path in sorted((raw_root / "records").glob("*.json")):
        record = json.loads(record_path.read_text(encoding="utf-8"))
        if record.get("entityType") != "symptom":
            continue
        stats["pages"] += 1
        title = str(record["title"])
        page = (raw_root / str(record["rawPath"])).read_text(encoding="utf-8", errors="replace")
        chunk = page_lead(page)
        lead = lead_definition(chunk, title) if chunk else None
        reason: str | None = None
        if lead is None:
            reason = "lead-is-not-term-dash-definition"
        elif len(lead[1].split()) > MAX_SENTENCE_WORDS:
            reason = "first-sentence-too-long"
        elif len(lead[1].split()) < MIN_SENTENCE_WORDS:
            reason = "first-sentence-too-short"
        if reason is not None or lead is None:
            stats[f"skipped:{reason}"] += 1
            if len(skipped.setdefault(str(reason), [])) < 8:
                skipped[str(reason)].append(title)
            continue
        url = str(record["url"])
        field_id = field_for_krasotaimedicina_url(url)
        names = term_names(title)
        identity = digest(url)[:20]
        block_id = len(blocks) + 1
        blocks.append(
            {
                "id": block_id,
                "source": 1,
                "text": lead[1],
                "textSha256": digest(lead[1]),
                "path": url.removeprefix(BASE_URL),
                "locator": f"site=krasotaimedicina.ru; page={record_path.stem}; section=lead",
                "documentId": f"krasotaimedicina.symptom.{identity}",
                "documentTitle": title,
                "sectionTitle": "Описание симптома",
                "rawSha256": str(record["rawSha256"]),
                "fetchedAt": record.get("fetchedAt"),
                **({"field": field_id} if field_id else {}),
            }
        )
        terms.append(
            {
                "id": f"kimsym.{identity}",
                "title": names.title,
                "kind": "symptom",
                "aliases": list(names.aliases),
                "blockIds": [block_id],
                "coverage": "explicit-definition",
            }
        )
        stats["extracted"] += 1
        stats[f"field:{field_id}"] += 1
    shard: dict[str, Any] = {
        "version": 3,
        "id": "minimed.definition.krasotaimedicina-symptoms.2026-10-08",
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [
            {
                "id": 1,
                "title": SYMPTOM_SOURCE_TITLE,
                "baseUrl": BASE_URL,
                "authority": "third-party",
                "accessed": accessed,
                "rightsStatus": "unresolved",
                "releaseEligible": False,
                "sourceType": "medical-reference-site",
                "publisher": "Красота и медицина",
                "decision": (
                    "local candidate; the owner decision 2026-09-28 covers disease articles only"
                ),
            }
        ],
        "blocks": blocks,
        "terms": terms,
    }
    report = {
        "format": "minimed-krasotaimedicina-symptoms-v1",
        "counts": dict(sorted(stats.items())),
        "skippedExamples": skipped,
        "maxSentenceWords": MAX_SENTENCE_WORDS,
    }
    return shard, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--module", type=Path, required=True)
    parser.add_argument("--accessed", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or args.report.exists():
        parser.error("Choose new output paths")
    shard, report = extract(args.module, accessed=args.accessed)
    payload = json.dumps(shard, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    args.output.write_bytes(payload)
    report["output"] = {
        "path": args.output.name,
        "bytes": len(payload),
        "entries": len(shard["terms"]),
    }
    args.report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
