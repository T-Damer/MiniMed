"""Split KR "Термины и определения"/"Список сокращений" glossary blocks into records.

Operates only on already-prepared `clinical-source-excerpts-2026.09.21` draft shards
(coverage `definition-section`, or any `sectionTitle` containing "сокращ"). Every emitted
body is a byte-exact substring of an existing draft block: nothing is paraphrased, no
sources are merged, and paragraphs that do not look like a clean "term - definition" line
are left out and reported rather than force-fit. Two record types come out of this module:

- clinical glossary terms / promoted single-paragraph disease definitions (coverage
  ``explicit-definition``, kind carried over from the source record);
- abbreviation expansions (kind ``abbreviation``, coverage ``abbreviation``) - these are
  never clinical definitions and must stay excluded from the definition count.

Same-normalized-title records with byte-identical definition text are folded into one
entry with multiple citation blocks (repeated legal/glossary boilerplate is extremely
common across KR documents). Same-normalized-title records with *different* wording are
kept as separate entries and flagged ``conflicting-definition``/``conflicting-expansion``;
nothing is silently reconciled.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path

from .abbreviation_line_parsing import split_abbreviation_pair
from .definition_reference_pack import contained, digest, normalized_name, obj, seq, text

EMPTY_RE = re.compile(
    r"не\s+примен[яа]ю?тся|\bнет\b\.?$|не\s+использ\w*|не\s+вы?делен\w*|см\.?\s+раздел|^-{1,3}$",
    re.IGNORECASE,
)
OCR_MARKERS = ("�", "­")
MAX_TERM_WORDS = 12
# Only a heading that is *specifically* the disease/condition definition may be promoted as
# a whole-paragraph definition of the entry's own title. Many other KR headings contain the
# substring "определени" incidentally (an appendix scoring instrument, a lab-criteria
# section, a staging algorithm) and must not be mistaken for the disease's own definition.
DISEASE_DEFINITION_HEADING_RE = re.compile(
    r"^\d+(?:\.\d+)*[.)]?\s*определени[еяй]\s+заболевани", re.IGNORECASE
)
# A source chunk that is only an embedded image reference, not extracted text.
IMAGE_PLACEHOLDER_RE = re.compile(
    r"^[\w.\-]+\.(?:png|jpe?g|gif|bmp|svg|webp|tiff?)$", re.IGNORECASE
)
# For de-duplication only: "антибактериальная терапия", "антибактериальная терапия." and
# "антибактериальная терапия;" are the same expansion with incidental trailing punctuation
# picked up by the paragraph split (a table cell border, a list separator). Stripping this
# before hashing lets identical-in-substance quotes fold into one entry instead of each
# distinct trailing character minting its own "conflicting" record. The stored block text
# stays the untouched verbatim quote; only the fold/compare key is normalized.
_TRAILING_PUNCT_RE = re.compile(r"[\s.;,]+$")


def _dedup_key_text(definition: str) -> str:
    return _TRAILING_PUNCT_RE.sub("", definition)


def _split_paragraphs(value: str) -> list[tuple[int, int, str]]:
    """Blank-line separated paragraphs as (start, end, text); offsets index `value`."""
    return [
        (match.start(), match.end(), match.group(0))
        for match in re.finditer(r"[^\n]+(?:\n(?!\s*\n)[^\n]+)*", value)
    ]


def _looks_empty(paragraph: str) -> bool:
    stripped = paragraph.strip()
    return len(stripped) <= 80 and bool(EMPTY_RE.search(stripped))


def _ocr_flags(value: str) -> tuple[str, ...]:
    return ("ocr-artifact",) if any(marker in value for marker in OCR_MARKERS) else ()


@dataclass(frozen=True)
class ParsedPair:
    term: str
    definition: str
    start: int
    end: int
    flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class SectionParse:
    status: str  # "glossary" | "glossary-partial" | "prose" | "empty" | "nonstandard"
    pairs: tuple[ParsedPair, ...] = ()
    skipped: int = 0


def parse_glossary_block(body: str) -> SectionParse:
    """Parse a section expected to hold one or more "term - definition" lines."""
    paragraphs = _split_paragraphs(body)
    if not paragraphs or (len(paragraphs) == 1 and _looks_empty(paragraphs[0][2])):
        return SectionParse("empty")
    pairs: list[ParsedPair] = []
    skipped = 0
    for start, end, paragraph in paragraphs:
        pair = split_abbreviation_pair(paragraph)
        term, definition = pair if pair else ("", "")
        if (
            not pair
            or len(definition) < 3
            or not term
            or len(term.split()) > MAX_TERM_WORDS
            or term.count("(") != term.count(")")  # a fragment cut mid-parenthetical
        ):
            skipped += 1
            continue
        pairs.append(ParsedPair(term, definition, start, end, _ocr_flags(paragraph)))
    if not pairs:
        return SectionParse("empty" if _looks_empty(body) else "nonstandard", skipped=skipped)
    return SectionParse("glossary" if skipped == 0 else "glossary-partial", tuple(pairs), skipped)


def parse_prose_definition(body: str) -> SectionParse:
    """A section that is expected to be a single definitional paragraph, not a glossary."""
    stripped = body.strip()
    if not stripped or _looks_empty(stripped) or IMAGE_PLACEHOLDER_RE.match(stripped):
        return SectionParse("empty")
    return SectionParse("prose", (ParsedPair("", stripped, 0, len(body), _ocr_flags(body)),))


# --------------------------------------------------------------------------------------
# Reading the existing draft shards (read-only; never mutated by this module).
# --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class RawSection:
    file_name: str
    entry_id: str
    title: str
    kind: str
    section_title: str
    source_descriptor: dict[str, object]
    block_text: str
    block_locator: str
    block_path: str


def _part_paths(root: Path) -> list[Path]:
    index_path = contained(
        root, Path("content/definition-drafts/clinical-source-excerpts-2026.09.21.json")
    )
    index = obj(json.loads(index_path.read_bytes()))
    return [
        contained(root, Path("content/definition-drafts") / text(obj(part)["path"]))
        for part in seq(index["parts"], 32)
    ]


def _iter_raw_sections(root: Path, *, only_definition_section: bool) -> Iterator[RawSection]:
    for path in _part_paths(root):
        payload = obj(json.loads(path.read_bytes()))
        sources = {obj(s)["id"]: obj(s) for s in seq(payload["sources"], 1000)}
        blocks = {obj(b)["id"]: obj(b) for b in seq(payload["blocks"], 200000)}
        for value in seq(payload["terms"], 50000):
            row = obj(value)
            section_title = text(row.get("sectionTitle", ""), 4096, empty=True)
            if only_definition_section:
                if row.get("coverage") != "definition-section":
                    continue
            elif "сокращ" not in section_title.lower():
                continue
            block_ids = seq(row.get("blockIds", []), 10)
            if not block_ids:
                continue
            block = blocks[block_ids[0]]
            descriptor = dict(sources[block["source"]])
            descriptor.pop("id", None)
            yield RawSection(
                file_name=path.name,
                entry_id=text(row["id"]),
                title=text(row["title"]),
                kind=text(row["kind"], 40),
                section_title=section_title,
                source_descriptor=descriptor,
                block_text=text(block["text"], 262144, empty=True),
                block_locator=text(block["locator"], 4096),
                block_path=text(block.get("path", ""), 2048, empty=True),
            )


# --------------------------------------------------------------------------------------
# Building the two derived draft manifests.
# --------------------------------------------------------------------------------------


@dataclass
class _Block:
    text: str
    locator: str
    path: str
    section_title: str
    parent_entry_id: str
    parent_title: str
    source_file: str
    offset_start: int
    offset_end: int


@dataclass
class _Record:
    record_type: str
    term: str
    kind: str
    blocks: list[_Block] = field(default_factory=list)
    flags: set[str] = field(default_factory=set)


def _stable_id(prefix: str, *parts: str) -> str:
    return f"{prefix}.{hashlib.sha256('|'.join(parts).encode()).hexdigest()[:24]}"


def _add_pair(
    records: dict[tuple[str, str, str], _Record],
    *,
    record_type: str,
    term: str,
    kind: str,
    definition: str,
    flags: tuple[str, ...],
    entry: RawSection,
    offset_start: int,
    offset_end: int,
) -> None:
    definition_sha = hashlib.sha256(_dedup_key_text(definition).encode("utf-8")).hexdigest()
    key = (record_type, normalized_name(term), definition_sha)
    record = records.setdefault(key, _Record(record_type, term, kind))
    record.flags.update(flags)
    record.blocks.append(
        _Block(
            text=definition,
            locator=f"{entry.block_locator}; chars={offset_start}:{offset_end}",
            path=entry.block_path,
            section_title=entry.section_title,
            parent_entry_id=entry.entry_id,
            parent_title=entry.title,
            source_file=entry.file_name,
            offset_start=offset_start,
            offset_end=offset_end,
        )
    )


def _flag_conflicts(records: dict[tuple[str, str, str], _Record], *, flag: str) -> None:
    by_title: dict[tuple[str, str], set[str]] = defaultdict(set)
    for record_type, normalized_title, definition_sha in records:
        by_title[(record_type, normalized_title)].add(definition_sha)
    for key, record in records.items():
        record_type, normalized_title, _ = key
        if len(by_title[(record_type, normalized_title)]) > 1:
            record.flags.add(flag)


def _serialize(
    records: dict[tuple[str, str, str], _Record],
    *,
    edition: str,
    coverage: str,
    id_prefix: str,
    source_descriptor: dict[str, object] | None,
    note: str,
) -> dict[str, object] | None:
    if not records:
        return None
    assert source_descriptor is not None
    blocks_out: list[dict[str, object]] = []
    terms_out: list[dict[str, object]] = []
    counter = 0
    for (record_type, normalized_title, definition_sha), record in sorted(records.items()):
        block_ids: list[int] = []
        for block in record.blocks:
            counter += 1
            block_ids.append(counter)
            blocks_out.append(
                {
                    "id": counter,
                    "source": 1,
                    "text": block.text,
                    "textSha256": digest(block.text),
                    "path": block.path,
                    "locator": block.locator,
                    "sourceFile": block.source_file,
                    "sectionTitle": block.section_title,
                    "parentEntryId": block.parent_entry_id,
                    "parentTitle": block.parent_title,
                    "offsetStart": block.offset_start,
                    "offsetEnd": block.offset_end,
                }
            )
        terms_out.append(
            {
                "id": _stable_id(id_prefix, record_type, normalized_title, definition_sha[:16]),
                "title": record.term,
                "kind": record.kind,
                "aliases": [],
                "blockIds": block_ids,
                "coverage": coverage,
                "recordType": record.record_type,
                "flags": sorted(record.flags),
                "note": note,
            }
        )
    return {
        "version": 3,
        "id": edition,
        "reviewStatus": "requires-review",
        "publicationState": "local-dev",
        "textKind": "source-excerpt",
        "sources": [{"id": 1, **source_descriptor}],
        "blocks": blocks_out,
        "terms": terms_out,
    }


GLOSSARY_NOTE = (
    "Построчно извлечено из раздела «Термины и определения» / «Определение заболевания или "
    "состояния» клинической рекомендации; клиническая и редакторская проверка не выполнена."
)
ABBREVIATION_NOTE = (
    "Построчно извлечено из раздела «Список сокращений» клинической рекомендации. Это "
    "расшифровка сокращения, а не клиническое определение."
)


def build_clinical_glossary_drafts(root: Path) -> dict[str, object]:
    """Read the existing clinical-source-excerpt shards and derive two new draft files.

    Returns ``{"glossary": v3dict|None, "abbreviations": v3dict|None, "report": {...}}``.
    Nothing is written to disk and no existing file is modified; the caller decides whether
    and where to persist the returned payloads.
    """
    glossary_records: dict[tuple[str, str, str], _Record] = {}
    abbreviation_records: dict[tuple[str, str, str], _Record] = {}
    glossary_source: dict[str, object] | None = None
    abbreviation_source: dict[str, object] | None = None
    stats: Counter[str] = Counter()
    nonstandard_examples: list[dict[str, object]] = []
    empty_examples: list[dict[str, object]] = []

    for entry in _iter_raw_sections(root, only_definition_section=True):
        stats["definition_section_records"] += 1
        is_term_section = "терм" in entry.section_title.lower()
        is_disease_definition_heading = bool(
            DISEASE_DEFINITION_HEADING_RE.search(entry.section_title)
        )
        if is_term_section:
            parsed = parse_glossary_block(entry.block_text)
        elif is_disease_definition_heading:
            parsed = parse_prose_definition(entry.block_text)
        else:
            # Neither a "Термины и определения" glossary nor the disease's own "N.N
            # Определение заболевания" heading - e.g. an appendix instrument or a lab
            # criteria section whose title only happens to contain "определени". Do not
            # guess that its text defines the entry's own title.
            stats["heading_not_a_definition_section"] += 1
            if len(nonstandard_examples) < 10:
                nonstandard_examples.append(
                    {
                        "title": entry.title,
                        "sectionTitle": entry.section_title,
                        "excerpt": entry.block_text[:200],
                        "reason": "heading-not-a-definition-section",
                    }
                )
            continue
        if parsed.status == "empty":
            stats["empty"] += 1
            if len(empty_examples) < 10:
                empty_examples.append({"title": entry.title, "sectionTitle": entry.section_title})
            continue
        if parsed.status == "nonstandard":
            stats["nonstandard"] += 1
            if len(nonstandard_examples) < 10:
                nonstandard_examples.append(
                    {
                        "title": entry.title,
                        "sectionTitle": entry.section_title,
                        "excerpt": entry.block_text[:200],
                    }
                )
            continue
        if parsed.status == "glossary-partial":
            stats["glossary_partial_sections"] += 1
            stats["glossary_partial_skipped_paragraphs"] += parsed.skipped
        elif parsed.status == "glossary":
            stats["glossary_full_sections"] += 1
        else:
            stats["prose_sections"] += 1
        glossary_source = glossary_source or entry.source_descriptor
        for pair in parsed.pairs:
            term = pair.term or entry.title
            record_type = "term-glossary" if is_term_section else "disease-definition"
            _add_pair(
                glossary_records,
                record_type=record_type,
                term=term,
                kind="term" if is_term_section else entry.kind,
                definition=pair.definition,
                flags=pair.flags,
                entry=entry,
                offset_start=pair.start,
                offset_end=pair.end,
            )
            stats["pairs_" + record_type] += 1

    for entry in _iter_raw_sections(root, only_definition_section=False):
        stats["abbreviation_section_records"] += 1
        parsed = parse_glossary_block(entry.block_text)
        if parsed.status == "empty":
            stats["abbreviation_empty"] += 1
            continue
        if parsed.status == "nonstandard":
            stats["abbreviation_nonstandard"] += 1
            if len(nonstandard_examples) < 10:
                nonstandard_examples.append(
                    {
                        "title": entry.title,
                        "sectionTitle": entry.section_title,
                        "excerpt": entry.block_text[:200],
                    }
                )
            continue
        stats["abbreviation_sections_parsed"] += 1
        stats["abbreviation_skipped_paragraphs"] += parsed.skipped
        abbreviation_source = abbreviation_source or entry.source_descriptor
        for pair in parsed.pairs:
            _add_pair(
                abbreviation_records,
                record_type="abbreviation",
                term=pair.term,
                kind="abbreviation",
                definition=pair.definition,
                flags=pair.flags,
                entry=entry,
                offset_start=pair.start,
                offset_end=pair.end,
            )
            stats["pairs_abbreviation"] += 1

    _flag_conflicts(glossary_records, flag="conflicting-definition")
    _flag_conflicts(abbreviation_records, flag="conflicting-expansion")

    glossary = _serialize(
        glossary_records,
        edition="minimed.definition.clinical-glossary.2026-09-28",
        coverage="explicit-definition",
        id_prefix="clinical-glossary",
        source_descriptor=glossary_source,
        note=GLOSSARY_NOTE,
    )
    abbreviations = _serialize(
        abbreviation_records,
        edition="minimed.definition.clinical-abbreviations.2026-09-28",
        coverage="abbreviation",
        id_prefix="clinical-abbrev",
        source_descriptor=abbreviation_source,
        note=ABBREVIATION_NOTE,
    )
    conflicting_terms = {
        key[1] for key, rec in glossary_records.items() if "conflicting-definition" in rec.flags
    }
    conflicting_abbrevs = {
        key[1] for key, rec in abbreviation_records.items() if "conflicting-expansion" in rec.flags
    }
    ocr_flagged = sum(
        1
        for rec in {**glossary_records, **abbreviation_records}.values()
        if "ocr-artifact" in rec.flags
    )
    report = {
        "format": "minimed-clinical-glossary-inventory-v1",
        "counts": dict(stats),
        "glossaryEntries": len(glossary_records),
        "abbreviationEntries": len(abbreviation_records),
        "distinctConflictingGlossaryTitles": len(conflicting_terms),
        "distinctConflictingAbbreviations": len(conflicting_abbrevs),
        "ocrFlaggedEntries": ocr_flagged,
        "nonstandardExamples": nonstandard_examples,
        "emptyExamples": empty_examples,
        "boundary": (
            "Every emitted definition/expansion is a byte-exact substring of an already "
            "prepared clinical-source-excerpt block. No paraphrase, no cross-source merge; "
            "sections that do not look like a clean term/definition line are excluded and "
            "listed in nonstandardExamples rather than force-parsed."
        ),
    }
    return {"glossary": glossary, "abbreviations": abbreviations, "report": report}
