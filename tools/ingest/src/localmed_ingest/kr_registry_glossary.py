"""Extract «Термины и определения» of every клинические рекомендации straight from the registry.

Input is the raw JSON the Минздрав registry serves (one file per recommendation, kept
unchanged under `data/raw/official-clinical-documents/`). The glossary section is HTML with one
`<p>` per entry, usually `<strong>Термин</strong> – определение`. Reading that HTML directly
fixes the first extraction, which worked on flattened text and cut the term at the wrong dash.

What is kept is exactly what the source says:

- the definition block is the visible text of the source paragraph, whitespace collapsed,
  never reworded; a bullet list that continues a definition stays with it;
- the term is the bold run (or the text before the first dash outside brackets); brackets such
  as «(ПОЯ)» or «англ. …» become aliases, never part of the headword;
- an entry the term rules reject is counted and sampled in the report, not repaired by guess.

Identical term and text in several recommendations fold into one entry with a citation per
recommendation; different wording stays a separate entry. The result is a version-3 draft
shard for `definition_reference_pack`, plus a report with the measured coverage.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from .kr_fields import field_for_mkb_codes
from .kr_term_boundary import (
    looks_like_abbreviation_entry,
    split_term_definition,
    term_defect,
    term_names,
)

REGISTRY_BASE = "https://cr.minzdrav.gov.ru/"
SECTION_TERMS = "doc_terms"
SECTION_DISEASE = "doc_crat_info_1_1"
KINDS_BY_TITLE: tuple[tuple[str, str], ...] = (
    (r"\b(?:шкала|опросник|индекс)\b", "scale"),
    (r"\b(?:критерии|признаки|триада)\b", "criterion_set"),
    (r"\b(?:классификация|стадии|степени)\b", "classification"),
    (r"синдром", "syndrome"),
    (r"симптом|феномен", "symptom"),
)
# Leading characters of a normalized paragraph that identify it among the reader's chunks.
ANCHOR_PROBE = 160
_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_BULLET_END = re.compile(r"[:;,]\s*$")


def normalized(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).lower().replace("ё", "е").split())


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass
class Paragraph:
    text: str
    bold_prefix: str
    is_list_item: bool


class _ParagraphParser(HTMLParser):
    """`<p>` / `<li>` units of one section with the bold run that opens each of them."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paragraphs: list[Paragraph] = []
        self._runs: list[tuple[str, bool]] = []
        self._strong = 0
        self._open: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        name = tag.lower()
        if name in {"p", "li"}:
            self._flush()
            self._open = name
        elif name in {"strong", "b"}:
            self._strong += 1
        elif name == "br":
            self._runs.append((" ", False))

    def handle_endtag(self, tag: str) -> None:
        name = tag.lower()
        if name in {"p", "li"}:
            self._flush()
        elif name in {"strong", "b"}:
            self._strong = max(0, self._strong - 1)

    def handle_data(self, data: str) -> None:
        if self._open is None and not data.strip():
            return
        if self._open is None:
            self._open = "p"
        self._runs.append((data, self._strong > 0))

    def _flush(self) -> None:
        runs, kind = self._runs, self._open
        self._runs, self._open = [], None
        text = " ".join("".join(piece for piece, _ in runs).replace("\xa0", " ").split())
        if not text:
            return
        bold = ""
        for piece, is_bold in runs:
            if not is_bold:
                if piece.strip():
                    break
                bold += piece
                continue
            bold += piece
        self.paragraphs.append(
            Paragraph(text, " ".join(bold.replace("\xa0", " ").split()), kind == "li")
        )

    def close(self) -> None:
        super().close()
        self._flush()


def section_paragraphs(html: str) -> list[Paragraph]:
    parser = _ParagraphParser()
    parser.feed(html)
    parser.close()
    return parser.paragraphs


@dataclass(frozen=True)
class RegistryDocument:
    code_version: str
    name: str
    mkb: tuple[str, ...]
    current: bool
    sha256: str
    path: str
    sections: dict[str, str]


def read_registry_document(path: Path, root: Path) -> RegistryDocument:
    raw = path.read_bytes()
    payload = json.loads(raw)
    sections = payload.get("obj", {}).get("sections") or []
    wanted = {
        str(section.get("id")): str(section.get("content") or "")
        for section in sections
        if section.get("id") in {SECTION_TERMS, SECTION_DISEASE}
    }
    mkb = payload.get("mkbs") or [part for part in str(payload.get("mkb") or "").split("/") if part]
    return RegistryDocument(
        code_version=str(payload["id"]),
        name=str(payload["name"]).strip(),
        mkb=tuple(str(code) for code in mkb),
        current=payload.get("status") == 0 and payload.get("apply_status") == "Применяется",
        sha256=hashlib.sha256(raw).hexdigest(),
        path=path.resolve().relative_to(root.resolve()).as_posix(),
        sections=wanted,
    )


@dataclass
class Entry:
    """One glossary entry of one recommendation, before folding."""

    document: RegistryDocument
    section: str
    paragraph_index: int
    term: str
    title: str
    aliases: tuple[str, ...]
    text: str
    flags: tuple[str, ...]


@dataclass
class ExtractionStats:
    documents: int = 0
    documents_with_section: int = 0
    paragraphs: int = 0
    entries: int = 0
    continuation_paragraphs: int = 0
    unparsed_paragraphs: int = 0
    rejected: Counter[str] = field(default_factory=Counter)
    rejected_examples: dict[str, list[dict[str, str]]] = field(
        default_factory=lambda: defaultdict(list)
    )
    flags: Counter[str] = field(default_factory=Counter)
    unparsed_examples: list[dict[str, str]] = field(default_factory=list)


def _bold_term(bold: str, text: str) -> str | None:
    """The leading bold run as a term, when it stops before the end of the paragraph."""
    term = bold.strip(" \t*#:–—-.,;")
    if not term or len(term) >= len(text.strip(" .")) - 3:
        return None
    return term


@dataclass(frozen=True)
class Pair:
    term: str
    definition: str
    flags: tuple[str, ...]


def _entry_from_paragraph(paragraph: Paragraph) -> Pair | None:
    """Term and definition of one paragraph, or `None` when it holds no pair.

    The first dash outside brackets is the boundary; authors' bold runs are inconsistent
    (they often spill past the term), so a bold run that disagrees only adds `bold-mismatch`.
    A paragraph without a dash but with a bold opening run takes that run as the term.
    """
    split = split_term_definition(paragraph.text)
    bold = _bold_term(paragraph.bold_prefix, paragraph.text)
    if split is not None:
        flags = list(split.flags)
        if bold and not (
            normalized(split.term).startswith(normalized(bold))
            or normalized(bold).startswith(normalized(split.term))
        ):
            flags.append("bold-mismatch")
        return Pair(split.term, split.definition, tuple(flags))
    if bold is None:
        return None
    rest = paragraph.text[len(bold) :].lstrip(" \t*#:–—-.,;")
    return Pair(bold, rest, ("bold-boundary",))


def kind_for(title: str) -> str:
    for pattern, kind in KINDS_BY_TITLE:
        if re.search(pattern, title, re.IGNORECASE):
            return kind
    return "term"


def _is_continuation(paragraph: Paragraph, previous: Entry | None) -> bool:
    if previous is None or paragraph.bold_prefix:
        return False
    if paragraph.is_list_item:
        return True
    first = paragraph.text[:1]
    return first.islower() or bool(_BULLET_END.search(previous.text.split("\n")[-1]))


def extract_document(
    document: RegistryDocument, stats: ExtractionStats, *, sample_limit: int = 6
) -> list[Entry]:
    entries: list[Entry] = []
    stats.documents += 1
    for section_id in (SECTION_TERMS, SECTION_DISEASE):
        html = document.sections.get(section_id)
        if not html:
            continue
        paragraphs = section_paragraphs(html)
        if not paragraphs:
            continue
        stats.documents_with_section += section_id == SECTION_TERMS
        previous: Entry | None = None
        group: list[Entry] = []
        for index, paragraph in enumerate(paragraphs):
            stats.paragraphs += 1
            pair = _entry_from_paragraph(paragraph)
            if pair is None:
                if section_id == SECTION_DISEASE and len(paragraphs) == 1:
                    pair = Pair(
                        document_title(document), paragraph.text, ("section-defines-title",)
                    )
                elif _is_continuation(paragraph, previous) and previous is not None:
                    previous.text = f"{previous.text}\n{paragraph.text}"
                    stats.continuation_paragraphs += 1
                    continue
                else:
                    stats.unparsed_paragraphs += 1
                    if len(stats.unparsed_examples) < 40:
                        stats.unparsed_examples.append(
                            {"document": document.code_version, "text": paragraph.text[:160]}
                        )
                    previous = None
                    continue
            term, flags = pair.term, pair.flags
            defect = term_defect(term)
            if defect is not None:
                stats.rejected[defect] += 1
                bucket = stats.rejected_examples[defect]
                if len(bucket) < sample_limit:
                    bucket.append(
                        {
                            "document": document.code_version,
                            "term": term[:120],
                            "text": paragraph.text[:120],
                        }
                    )
                previous = None
                continue
            names = term_names(term)
            entry = Entry(
                document,
                section_id,
                index,
                term,
                names.title,
                names.aliases,
                paragraph.text,
                flags,
            )
            if looks_like_abbreviation_entry(term, pair.definition):
                entry.flags = (*entry.flags, "abbreviation-like")
            for flag in entry.flags:
                stats.flags[flag] += 1
            group.append(entry)
            previous = entry
        entries.extend(group)
    stats.entries += len(entries)
    return entries


def document_title(document: RegistryDocument) -> str:
    """The recommendation's own name without its trailing «(МКБ-рубрика)» clarification."""
    return re.sub(r"\s*\((?:[^()]*МКБ|Другие|Прочие|Неуточнённ)[^()]*\)\s*$", "", document.name)


def entry_fold_key(entry: Entry) -> tuple[str, str]:
    """Same headword and same wording (trailing punctuation aside) are one entry."""
    return normalized(entry.title), digest(re.sub(r"[\s.;,]+$", "", normalized(entry.text)))


@dataclass
class FoldedEntry:
    identifier: str
    title: str
    aliases: list[str]
    kind: str
    entries: list[Entry]


def fold_entries(entries: list[Entry]) -> list[FoldedEntry]:
    groups: dict[tuple[str, str], list[Entry]] = {}
    for entry in entries:
        groups.setdefault(entry_fold_key(entry), []).append(entry)
    folded: list[FoldedEntry] = []
    for (title_key, text_key), members in sorted(groups.items()):
        # The newest edition of each recommendation leads; replaced editions follow.
        members.sort(key=lambda item: (not item.document.current, item.document.code_version))
        first = members[0]
        aliases = list(dict.fromkeys(alias for member in members for alias in member.aliases))
        folded.append(
            FoldedEntry(
                identifier=f"krterm.{digest(title_key + '|' + text_key)[:24]}",
                title=first.title,
                aliases=aliases,
                kind=kind_for(first.title),
                entries=members,
            )
        )
    return folded


def _source_descriptor() -> dict[str, object]:
    return {
        "id": 1,
        "title": "Клинические рекомендации Минздрава России: «Термины и определения»",
        "baseUrl": REGISTRY_BASE,
        "authority": "official",
        "accessed": "2026-10-02",
        "rightsStatus": "official-publication-not-reviewed",
        "releaseEligible": False,
        "sourceType": "official-clinical-recommendation",
        "registry": "cr.minzdrav.gov.ru",
    }


def build_shard(
    folded: list[FoldedEntry],
    *,
    edition: str,
    anchors: dict[tuple[str, str], dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Version-3 draft shard; every block is one source paragraph (group) with its locator."""
    blocks: list[dict[str, Any]] = []
    terms: list[dict[str, Any]] = []
    anchors = anchors or {}
    for item in folded:
        block_ids: list[int] = []
        for member in item.entries:
            document = member.document
            located = anchors.get(
                (document.code_version, normalized(member.text)[:ANCHOR_PROBE]), {}
            )
            block_id = len(blocks) + 1
            block_ids.append(block_id)
            field_id = field_for_mkb_codes(document.mkb)
            section_title = (
                "Термины и определения"
                if member.section == SECTION_TERMS
                else "1.1 Определение заболевания или состояния"
            )
            locator = (
                f"registry=cr.minzdrav.gov.ru; document=kr.rf.{document.code_version}; "
                f"section={member.section}; paragraph={member.paragraph_index}"
            )
            blocks.append(
                {
                    "id": block_id,
                    "source": 1,
                    "text": member.text,
                    "textSha256": digest(member.text),
                    "path": f"preview-cr/{document.code_version}",
                    "locator": locator,
                    "documentId": f"kr.rf.{document.code_version}",
                    "documentTitle": document.name,
                    "sectionTitle": section_title,
                    "rawSha256": document.sha256,
                    "editionState": "current" if document.current else "replaced",
                    **({"field": field_id} if field_id else {}),
                    **located,
                }
            )
        terms.append(
            {
                "id": item.identifier,
                "title": item.title,
                "kind": item.kind,
                "aliases": item.aliases,
                "blockIds": block_ids,
                "coverage": "explicit-definition",
            }
        )
    return {
        "version": 3,
        "id": edition,
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [_source_descriptor()],
        "blocks": blocks,
        "terms": terms,
    }
