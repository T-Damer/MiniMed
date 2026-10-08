"""Ranking signals for the senses of one term, written into the draft shards before the build.

Several dictionaries define the same headword differently («Депрессия» in a traumatology
recommendation is a fracture pattern, in Красота и медицина a mood disorder). The app shows the
most likely sense first and the others one tap away, labelled by medical field. It needs four
facts per sense, all taken from the sources and the corpus, never from a model:

- `field` — the medical field the source itself states (`kr_fields`);
- `documents` — independent sources that give the meaning (recommendations, articles, entries
  that word it alike), `meaning` — which alike-worded group of the headword the sense is in;
- `authority` — 3 КР «Термины и определения», 2 other official/specialist works, 1 reference
  sites, 0 general dictionaries;
- `usage` / `termUsage` — recommendations using the sense / the term at all (`sense_usage`);
  measured only for a headword with two or more defined senses.

Text, identities, blocks and provenance of the shards are not touched; each term row only gains
a `sense` object that `definition_reference_pack.Projection` stores with the entity.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .kr_fields import field_by_id, field_for_wiktionary_text
from .sense_usage import Corpus, SenseText, measure_usage

DEFINITION_COVERAGE = frozenset({"definition", "explicit-definition", "gloss"})
KR_GLOSSARY_SECTIONS = frozenset({"Термины и определения"})
OFFICIAL = frozenset({"official"})
SPECIALIST = frozenset(
    {"authored-specialist-publication", "professional-reference", "institutional-reference"}
)
SPECIALIST_TYPES = frozenset({"specialist-journal", "professional-medical-reference"})
OFFICIAL_TYPES = frozenset({"existing-clinical-detail-dataset", "official-clinical-recommendation"})


def title_key(title: str) -> str:
    from .definition_reference_pack import normalized_name

    return normalized_name(title)


def authority(source: Mapping[str, Any], section_title: str | None, coverage: str) -> int:
    if source.get("authority") in OFFICIAL or source.get("sourceType") in OFFICIAL_TYPES:
        return 3 if section_title in KR_GLOSSARY_SECTIONS else 2
    if coverage == "gloss":
        return 0
    if source.get("authority") in SPECIALIST or source.get("sourceType") in SPECIALIST_TYPES:
        return 2
    return 1


@dataclass(frozen=True)
class SenseRow:
    shard: int
    index: int
    key: str
    group: str
    title: str
    text: str
    field: str | None
    authority: int
    documents: int


def _majority(values: Sequence[str]) -> str | None:
    if not values:
        return None
    counts = Counter(values)
    best = max(counts.values())
    return next(value for value in values if counts[value] == best)


def sense_rows(shard: int, payload: Mapping[str, Any]) -> list[SenseRow]:
    """The defined senses of one draft shard (version 2 or 3), in file order."""
    sources = {int(source["id"]): source for source in payload.get("sources", [])}
    blocks = {int(block["id"]): block for block in payload.get("blocks", [])}
    rows: list[SenseRow] = []
    for index, term in enumerate(payload.get("terms", [])):
        coverage = str(term.get("coverage", term.get("definitionKind", "definition")))
        if term.get("kind") == "abbreviation" or coverage not in DEFINITION_COVERAGE:
            continue
        if payload.get("version") == 3:
            members = [blocks[int(i)] for i in term.get("blockIds", [])]
            if not members:
                continue
            first = members[0]
            source = sources[int(first["source"])]
            text = str(first["text"])
            field = _majority([str(b["field"]) for b in members if b.get("field")])
            current = {
                str(b.get("documentId", i))
                for i, b in enumerate(members)
                if b.get("editionState") != "replaced"
            }
            documents = len(current) or len(
                {str(b.get("documentId", i)) for i, b in enumerate(members)}
            )
            section = first.get("sectionTitle")
        else:
            references = term.get("references") or []
            if not references:
                continue
            source = sources[int(references[0]["source"])]
            text = str(term.get("definition", ""))
            field = None
            documents = 1
            section = None
        if not text.strip():
            continue
        if field is None and coverage == "gloss":
            field = field_for_wiktionary_text(text)
        rows.append(
            SenseRow(
                shard,
                index,
                f"{shard}:{index}",
                title_key(str(term["title"])),
                str(term["title"]),
                text,
                field,
                authority(source, section if isinstance(section, str) else None, coverage),
                documents,
            )
        )
    return rows


def group_senses(rows: Sequence[SenseRow]) -> dict[str, tuple[str, list[SenseRow]]]:
    groups: dict[str, tuple[str, list[SenseRow]]] = {}
    for row in rows:
        groups.setdefault(row.group, (row.title, []))[1].append(row)
    return groups


def sense_object(
    row: SenseRow,
    documents: int,
    usage: int | None,
    term_usage: int | None,
    meaning: int | None,
) -> dict[str, object]:
    signals: dict[str, object] = {"documents": documents, "authority": row.authority}
    if meaning is not None:
        signals["meaning"] = meaning
    if row.field:
        signals["field"] = row.field
        signals["fieldLabel"] = field_by_id(row.field).label
    if usage is not None and term_usage is not None:
        signals["usage"] = usage
        signals["termUsage"] = term_usage
    return signals


def annotate_shards(payloads: Sequence[dict[str, Any]], corpus: Corpus) -> dict[str, object]:
    """Add `sense` to every defined term of every shard in place; return a measured report."""
    rows = [row for shard, payload in enumerate(payloads) for row in sense_rows(shard, payload)]
    groups = group_senses(rows)
    ambiguous = {
        key: (title, [SenseText(row.key, row.text) for row in members])
        for key, (title, members) in groups.items()
        if len({row.text for row in members}) > 1
    }
    measured = measure_usage(corpus, ambiguous)
    by_field: Counter[str] = Counter()
    for key, (_, members) in groups.items():
        usage = measured.get(key)
        # Independent sources of a meaning: every document that words it in any of its variants.
        sources: Counter[int] = Counter()
        if usage:
            for row in members:
                sources[usage.senses[row.key].meaning] += row.documents
        for row in members:
            sense = usage.senses.get(row.key) if usage else None
            payloads[row.shard]["terms"][row.index]["sense"] = sense_object(
                row,
                sources[sense.meaning] if sense else row.documents,
                sense.usage if sense else None,
                usage.term_usage if usage and sense else None,
                sense.meaning if sense else None,
            )
            by_field[row.field or "none"] += 1
    ranked_apart = sum(
        1
        for usage in measured.values()
        if len({sense.usage for sense in usage.senses.values()}) > 1
    )
    return {
        "definedSenses": len(rows),
        "headwords": len(groups),
        "ambiguousHeadwords": len(ambiguous),
        "ambiguousMeasured": len(measured),
        "ambiguousWithDistinctUsage": ranked_apart,
        "sensesByField": dict(sorted(by_field.items())),
        "sensesWithoutField": by_field.get("none", 0),
    }
