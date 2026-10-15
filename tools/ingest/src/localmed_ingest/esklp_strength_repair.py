"""Repair the dosages of the released ЕСКЛП medication modules (STATE DOSE1, QA 0.6.60 item 4).

The 15 group modules were built from a registry archive that is no longer on this machine, with a
builder that glued the registry's «Кол-во» placeholder «1.0» to the dosage («1.0325 мг+10 мг+20 мг»,
see `esklp_strength`). The builder is fixed; this module applies the same rule to what was already
built, deterministically and without the archive:

* `documents.metadata_json` of a card: node and trade-name dosages read as `repair_strength`
  reads them (evidence from the node's own trade names), the card's `strengths` list recomputed
  the way the builder computes it and without the unstated values («НЕ УКАЗАНО», «~»);
  the registry's own klp rows, normalized form strings and every other field stay as they are;
* the card text (`chunks.original_text`): the same strings replaced where the generator wrote them,
  an unstated dosage written as «не указано в каталоге» like any other empty field, the registry's
  «(НЕ УКАЗАНО)» tail of a normalized form dropped;
* the search text of the changed chunks, rebuilt the way the released modules were indexed
  (`index_text`, checked against every unchanged chunk before anything is written).

Chunk ids, section ids, anchors, order and source spans do not change.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, cast

from .esklp_strength import has_glued_placeholder, is_unstated, repair_strength
from .normalization import light_stem_russian, normalize_surface_text, tokenize

_KEY = re.compile(r"[^0-9a-zа-я]+", re.IGNORECASE)

#: A dosage the glue left behind, in a stored string: «1.0325 мг», «1.0 650 мг», «1.0~»,
#: «1.0НЕ УКАЗАНО».
GLUE_IN_TEXT = re.compile(
    r"(?<![\d.,])1\.0(?:\s+[\d(]|\s?~|\s?НЕ УКАЗАНО|(?=[\d.,]+\s*[А-Яа-яA-Za-zµ%/]+\s*\+))"
)
UNSTATED_LITERAL = "НЕ УКАЗАНО"
EMPTY_FIELD = "не указано в каталоге"


def index_text(value: str) -> str:
    """The search text of a chunk as the released modules were indexed.

    Each distinct token once, in order of appearance, and a Russian light stem of every token right
    after it unless that stem was already written. `normalization.normalize_for_index` has since
    become a different function; this one reproduces every `normalized_text` of the released ЕСКЛП
    databases (checked on all of them by `scripts/repair_esklp_strengths.py` before it changes a
    chunk).
    """
    emitted: set[str] = set()
    out: list[str] = []
    for token in tokenize(normalize_surface_text(value)):
        if token not in emitted:
            out.append(token)
            emitted.add(token)
        stem = light_stem_russian(token)
        if stem != token and stem not in emitted:
            out.append(stem)
            emitted.add(stem)
    return " ".join(out)


def _key(value: str) -> str:
    return _KEY.sub("", value.replace("ё", "е").casefold())


def _unique(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        cleaned = re.sub(r"\s+", " ", value).strip()
        if cleaned and _key(cleaned) not in seen:
            seen.add(_key(cleaned))
            result.append(cleaned)
    return result


@dataclass
class CardRepair:
    """What changed on one card: old string → new string (`None`: the value is absent)."""

    changes: dict[str, str | None] = field(default_factory=lambda: dict[str, str | None]())
    node_strengths: int = 0
    trade_strengths: int = 0
    strengths_list: bool = False
    unresolved: list[str] = field(default_factory=lambda: list[str]())

    @property
    def changed(self) -> bool:
        return bool(self.changes) or self.strengths_list


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def repair_card_metadata(metadata: dict[str, Any]) -> CardRepair:
    """Repair `metadata` in place and say what changed."""
    repair = CardRepair()
    nodes = cast(list[dict[str, Any]], metadata.get("smnnNodes") or [])
    for node in nodes:
        trades = cast(list[dict[str, Any]], node.get("tradeNames") or [])
        evidence = [_text(trade.get("strength")) for trade in trades]
        old_node = _text(node.get("strength"))
        new_node = repair_strength(old_node, evidence)
        if old_node is not None and new_node != old_node:
            repair.changes[old_node] = new_node
            node["strength"] = new_node
            repair.node_strengths += 1
        elif has_glued_placeholder(old_node):
            repair.unresolved.append(str(old_node))
        for trade in trades:
            old = _text(trade.get("strength"))
            new = repair_strength(old)
            if old is not None and new != old:
                repair.changes[old] = new
                trade["strength"] = new
                repair.trade_strengths += 1
    # The card's own list keeps its order: each spelling is read like the node and trade-name
    # strengths, the unstated ones drop out, and spellings that now agree are written once.
    stored = cast(list[str], metadata.get("strengths") or [])
    fixed = [
        value
        for value in (
            repair.changes[item] if item in repair.changes else repair_strength(item)
            for item in stored
        )
        if value is not None and not is_unstated(value)
    ]
    rebuilt = _unique(fixed)
    if stored != rebuilt:
        for item in stored:
            if item in repair.changes:
                continue
            repaired = None if is_unstated(item) else repair_strength(item)
            if repaired != item:
                repair.changes[item] = repaired
        metadata["strengths"] = rebuilt
        repair.strengths_list = True
    return repair


def _guard(value: str) -> re.Pattern[str]:
    """`value` as a whole dosage of a list or a field: not inside a longer number or expression."""
    return re.compile(rf"(?<![\w.,+/(-]){re.escape(value)}(?=[.,;)]?(?:\s|$))")


_LIST_LABEL = r"концентраци[яи]: "
#: The list lines of a card: «Доступные дозировки/концентрации: A, B, C.» and the node lines' own.
_DOSAGE_LIST = re.compile(
    r"(?P<head>(?:Доступные дозировки|Дозировки)/концентрации: )(?P<body>[^\n]*?)"
    r"(?P<tail>\.(?=\s|$)|$)"
)


def _dedupe_dosage_lists(text: str) -> str:
    """A list that held a glued and a clean spelling of one dosage names it once."""

    def once(match: re.Match[str]) -> str:
        seen: set[str] = set()
        kept: list[str] = []
        for item in match.group("body").split(", "):
            key = re.sub(r"\s+", "", item).casefold()
            if key not in seen:
                seen.add(key)
                kept.append(item)
        return f"{match.group('head')}{', '.join(kept)}{match.group('tail')}"

    return _DOSAGE_LIST.sub(once, text)


def repair_chunk_text(text: str, changes: Mapping[str, str | None]) -> str:
    """The card text with the repaired dosages, as the generator would have written it."""
    result = text
    absent = [UNSTATED_LITERAL]
    for old, new in sorted(changes.items(), key=lambda item: -len(item[0])):
        if new is None:
            absent.append(old)
        else:
            result = _guard(old).sub(lambda _match, new=new: new, result)
    for item in dict.fromkeys(absent):
        escaped = re.escape(item)
        result = re.sub(rf"({_LIST_LABEL}){escaped}\.", rf"\1{EMPTY_FIELD}.", result)
        result = re.sub(rf"({_LIST_LABEL}){escaped}, ", r"\1", result)
        result = re.sub(rf", {escaped}(?=[,.](?:\s|$))", "", result)
    # A text cut by the chunk limit can hold what is left of a value or its label:
    # «…ия: НЕ УКАЗАНО.»,
    # «1.0 25 мг» without the rest of the line. The spaced placeholder is unambiguous by itself.
    result = re.sub(r"(?<![\d.,])1\.0\s+(?=[\d(])", "", result)
    result = re.sub(
        rf"(?:(?<=: )|^)(?:1\.0\s?~|(?:1\.0\s?)?{UNSTATED_LITERAL})(?=\.(?:\s|$)|$)",
        EMPTY_FIELD,
        result,
    )
    # The registry's normalized form string keeps its form and loses the empty dosage.
    result = re.sub(rf"\s*\({UNSTATED_LITERAL}\)", "", result)
    # …and the chunk limit can cut «(НЕ УКАЗАНО)» itself in two.
    result = re.sub(rf"^{UNSTATED_LITERAL}\)", "", result)
    result = re.sub(r"\s*\(НЕ$", "", result)
    if result != text:
        result = _dedupe_dosage_lists(result)
    return result


def card_residue(metadata: Mapping[str, Any]) -> list[str]:
    """Strings of a card's metadata that still show the glue or an unstated dosage."""
    found: list[str] = []
    for value in cast(Sequence[str], metadata.get("strengths") or []):
        if GLUE_IN_TEXT.search(value) or is_unstated(value):
            found.append(value)
    for node in cast(Sequence[Mapping[str, Any]], metadata.get("smnnNodes") or []):
        candidates = [node.get("strength")]
        trades = cast(Sequence[Mapping[str, Any]], node.get("tradeNames") or [])
        candidates += [trade.get("strength") for trade in trades]
        for value in candidates:
            if isinstance(value, str) and (GLUE_IN_TEXT.search(value) or is_unstated(value)):
                found.append(value)
    return found


def metadata_dump(metadata: Mapping[str, Any]) -> str:
    """Stored form of `documents.metadata_json` (compact, UTF-8), as the ATC fill writes it."""
    return json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))


# ---------------------------------------------------------------------------------------------
# The core's medication pointers (pinned to the released core, see pin_medication_pointers.py).
# ---------------------------------------------------------------------------------------------

_TITLE_SEPARATOR = " — "
_GLUED_STRENGTH = re.compile(r"^1\.0(?P<rest>[\d(].*)$", re.DOTALL)


def _compact(value: str) -> str:
    """A dosage text for comparison: no spaces, one decimal mark, the same trailing zeros."""
    text = re.sub(r"\s+", "", value).casefold().replace(",", ".")
    return re.sub(r"(\d)\.0+(?!\d)", r"\1", text)


def repair_pointer_title(
    title: str, section_text: str, changes: Mapping[str, str | None] | None = None
) -> str | None:
    """A pointer section title «<код СМНН> — <форма> — <дозировка>» without the glued placeholder.

    `changes` is what the repair of the pointer's target card did to its dosages (old → new): a
    title that carries one of the old spellings gets the new one. Without it the dosage is
    repaired only when the section's own text, which lists the registry's normalized form and
    dosage («ФОРМА (325 мг + 10 мг + 20 мг)»), spells the same dosage without the placeholder. One
    the registry does not state is dropped from the title. `None` when the title needs no repair.
    """
    parts = title.split(_TITLE_SEPARATOR)
    if len(parts) != 3:
        return None
    strength = parts[2].strip()
    if changes is not None and strength in changes:
        known = changes[strength]
        return _TITLE_SEPARATOR.join(parts[:2] if known is None else [*parts[:2], known])
    fixed = repair_strength(strength)
    if fixed is None:
        return _TITLE_SEPARATOR.join(parts[:2])
    if fixed != strength:
        return _TITLE_SEPARATOR.join([*parts[:2], fixed])
    glued = _GLUED_STRENGTH.match(strength)
    if glued and _compact(glued.group("rest")) in _compact(section_text):
        return _TITLE_SEPARATOR.join([*parts[:2], glued.group("rest")])
    return None


def repair_pointer_pack(
    connection: sqlite3.Connection,
    repairs: Mapping[str, Mapping[str, str | None]] | None = None,
) -> dict[str, int]:
    """Repair the dosage titles and the «(НЕ УКАЗАНО)» tails of the medication pointers in place.

    `repairs` maps a ЕСКЛП card id to what the module repair changed on it (`strength-repairs.json`
    of `scripts/repair_esklp_strengths.py`); a pointer reads its own card's entry by the
    `targetDocumentId` of its metadata.

    Stable ids, anchors, order and the pointers' documents are untouched; the search text of every
    changed chunk (and of the chunks under a retitled section) is rebuilt with `index_text`.
    """
    retitled: dict[str, str] = {}
    sections = connection.execute(
        "SELECT s.id, s.title, s.path_json, d.metadata_json FROM sections s "
        "JOIN document_versions v ON v.id = s.document_version_id "
        "JOIN documents d ON d.id = v.document_id "
        "WHERE d.id LIKE 'core.catalog.pointer.medication.%'"
    ).fetchall()
    for section_id, title, path_json, document_metadata in sections:
        if _TITLE_SEPARATOR not in title:
            continue
        text = " ".join(
            row[0]
            for row in connection.execute(
                "SELECT original_text FROM chunks WHERE section_id = ?", (section_id,)
            )
        )
        target = json.loads(document_metadata).get("targetDocumentId")
        known = repairs.get(target) if repairs and isinstance(target, str) else None
        repaired = repair_pointer_title(title, text, known)
        if repaired is None:
            continue
        path = [repaired if item == title else item for item in json.loads(path_json)]
        retitled[section_id] = repaired
        connection.execute(
            "UPDATE sections SET title = ?, normalized_title = ?, path_json = ? WHERE id = ?",
            (
                repaired,
                index_text(repaired),
                json.dumps(path, ensure_ascii=False, separators=(",", ":")),
                section_id,
            ),
        )
    changed_chunks = 0
    rows = connection.execute(
        "SELECT c.id, c.section_id, c.original_text, d.title, s.path_json FROM chunks c "
        "JOIN sections s ON s.id = c.section_id "
        "JOIN document_versions v ON v.id = c.document_version_id "
        "JOIN documents d ON d.id = v.document_id "
        "WHERE d.id LIKE 'core.catalog.pointer.medication.%'"
    ).fetchall()
    for chunk_id, section_id, text, document_title, path_json in rows:
        repaired_text = re.sub(rf"\s*\({UNSTATED_LITERAL}\)", "", text)
        if repaired_text == text and section_id not in retitled:
            continue
        changed_chunks += 1
        connection.execute(
            "UPDATE chunks SET original_text = ?, normalized_text = ? WHERE id = ?",
            (
                repaired_text,
                index_text(f"{document_title} {' '.join(json.loads(path_json))} {repaired_text}"),
                chunk_id,
            ),
        )
    return {"sectionsRetitled": len(retitled), "chunksChanged": changed_chunks}
