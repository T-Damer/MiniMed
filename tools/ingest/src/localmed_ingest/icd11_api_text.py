"""Read the cached Russian ICD-API entity text; decide what WHO really served in Russian.

The container answers every request in the requested language and tags every string with
`"@language": "ru"`, even when WHO has no Russian text: the English text is then served with a
trailing `[No translation available]` marker (plus `[Residual translation rule not defined]` for
residual rows), and some English definitions are served without any marker. WHO also marks Russian
strings it has only proposed with a trailing `[possible translation]`.

Rules (owner decision 2026-10-06: never translate, never substitute English silently):

* a value with a `[No translation available]` marker is English fallback: **omitted** and counted;
* a definition, long definition, fully specified name or coding note without a single Cyrillic
  letter is English text served unmarked: **omitted** and counted (definitions stay absent unless a
  Russian one exists); short labels (inclusions, exclusions, index terms) that are Latin-only but
  unmarked are WHO's own Russian-version text (organism names, abbreviations), kept as served,
  the same as the Latin-only titles of the tabulation;
* a `[possible translation]` marker is removed from the string and kept as a flag: the text is WHO's
  Russian text, shown with the note that WHO marked it so;
* nothing else is rewritten (line breaks inside a label become spaces).

The raw archive bytes are verified against the manifest before anything is read.
"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .icd11_api_fetch import (
    API_ARCHIVE_NAME,
    API_DIRECTORY,
    API_MANIFEST_NAME,
    entity_uri,
    entry_name,
)

_CYRILLIC = re.compile("[А-Яа-яЁё]")
_KNOWN_MARKER = re.compile(
    r"\s*\[(No translation available|Residual translation rule not defined"
    r"|possible translation)\]\s*$"
)
_ANY_TRANSLATION_BRACKET = re.compile(r"\[[^\[\]]*translat[^\[\]]*\]", re.IGNORECASE)
_FALLBACK_MARKERS = frozenset({"No translation available", "Residual translation rule not defined"})
_PROVISIONAL_MARKER = "possible translation"
_LINE_UNSAFE = re.compile(r"^\s*(?:#|---|<!--)")
LONG_TEXT_PROPERTIES = ("definition", "longDefinition", "fullySpecifiedName", "codingNote")
LABEL_PROPERTIES = ("inclusion", "exclusion", "indexTerm", "foundationChildElsewhere")


@dataclass(frozen=True)
class ApiText:
    """A string as WHO served it in Russian; `provisional` = flagged «possible translation»."""

    text: str
    provisional: bool = False


@dataclass(frozen=True)
class ApiEntityText:
    entity_id: str
    entry: str
    entry_sha256: str
    definition: ApiText | None = None
    long_definition: ApiText | None = None
    fully_specified_name: ApiText | None = None
    coding_note: ApiText | None = None
    inclusions: tuple[ApiText, ...] = ()
    exclusions: tuple[ApiText, ...] = ()
    index_terms: tuple[ApiText, ...] = ()
    elsewhere: tuple[ApiText, ...] = ()
    served: Counter[str] = field(default_factory=Counter)
    kept: Counter[str] = field(default_factory=Counter)
    omitted_fallback: Counter[str] = field(default_factory=Counter)
    omitted_unmarked_foreign: Counter[str] = field(default_factory=Counter)
    provisional: Counter[str] = field(default_factory=Counter)


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def classify_text(raw: str) -> tuple[str | None, bool]:
    """(text without WHO markers, or None for English fallback; provisional flag)."""
    text = raw
    markers: list[str] = []
    while True:
        match = _KNOWN_MARKER.search(text)
        if match is None:
            break
        markers.append(match.group(1))
        text = text[: match.start()]
    if _ANY_TRANSLATION_BRACKET.search(text):
        raise ValueError(f"An unknown or misplaced WHO translation marker in «{raw[:80]}»")
    if any(marker in _FALLBACK_MARKERS for marker in markers):
        return None, False
    return text.strip(), _PROVISIONAL_MARKER in markers


def _value(node: object) -> str | None:
    if isinstance(node, dict) and node.get("@language") == "ru":
        value = node.get("@value")
        if isinstance(value, str):
            return value
    return None


def parse_api_entity(
    entity_id: str, entry: str, entry_sha256: str, payload: object
) -> ApiEntityText:
    if not isinstance(payload, dict):
        raise ValueError(f"{entity_id}: the API answer is not a JSON object")
    served: Counter[str] = Counter()
    kept: Counter[str] = Counter()
    fallback: Counter[str] = Counter()
    foreign: Counter[str] = Counter()
    provisional_count: Counter[str] = Counter()
    long_text: dict[str, ApiText | None] = {}
    for prop in LONG_TEXT_PROPERTIES:
        raw = _value(payload.get(prop))
        if raw is None:
            if prop in payload:
                raise ValueError(f"{entity_id}: {prop} is not Russian text")
            long_text[prop] = None
            continue
        served[prop] += 1
        text, provisional = classify_text(raw)
        if text is None:
            fallback[prop] += 1
            long_text[prop] = None
            continue
        if not _CYRILLIC.search(text):
            foreign[prop] += 1
            long_text[prop] = None
            continue
        text = "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").split("\n")).strip()
        for line in text.split("\n"):
            if _LINE_UNSAFE.match(line):
                raise ValueError(f"{entity_id}: {prop} has a line that would read as markup")
        kept[prop] += 1
        provisional_count[prop] += provisional
        long_text[prop] = ApiText(text, provisional)
    labels: dict[str, tuple[ApiText, ...]] = {}
    for prop in LABEL_PROPERTIES:
        items: list[ApiText] = []
        seen: set[str] = set()
        for item in payload.get(prop, []):
            label = item.get("label") if isinstance(item, dict) else None
            raw = _value(label)
            if raw is None:
                raise ValueError(f"{entity_id}: a {prop} entry has no Russian label")
            served[prop] += 1
            text, provisional = classify_text(raw)
            if text is None:
                fallback[prop] += 1
                continue
            text = _clean(text)
            if not text:
                continue
            if _LINE_UNSAFE.match(text):
                raise ValueError(f"{entity_id}: a {prop} label would read as markup")
            if text in seen:
                continue
            seen.add(text)
            kept[prop] += 1
            provisional_count[prop] += provisional
            items.append(ApiText(text, provisional))
        labels[prop] = tuple(items)
    return ApiEntityText(
        entity_id=entity_id,
        entry=entry,
        entry_sha256=entry_sha256,
        definition=long_text["definition"],
        long_definition=long_text["longDefinition"],
        fully_specified_name=long_text["fullySpecifiedName"],
        coding_note=long_text["codingNote"],
        inclusions=labels["inclusion"],
        exclusions=labels["exclusion"],
        index_terms=labels["indexTerm"],
        elsewhere=labels["foundationChildElsewhere"],
        served=served,
        kept=kept,
        omitted_fallback=fallback,
        omitted_unmarked_foreign=foreign,
        provisional=provisional_count,
    )


@dataclass(frozen=True)
class ApiTextArchive:
    release: str
    archive_sha256: str
    container_image: str
    data_release: str
    fetched_at: str
    entities: dict[str, ApiEntityText]
    missing: frozenset[str]


def load_api_text(raw_root: Path, release: str) -> ApiTextArchive:
    """Verify the cached archive against its manifest and parse every entity."""
    directory = raw_root / API_DIRECTORY
    manifest = json.loads((directory / API_MANIFEST_NAME).read_text(encoding="utf-8"))
    if manifest.get("release") != release:
        raise ValueError("The ICD-API cache is for another release")
    archive_path = directory / API_ARCHIVE_NAME
    archive_sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    recorded = manifest["archive"]["sha256"]
    if archive_sha256 != recorded:
        raise ValueError("The ICD-API archive differs from its manifest checksum")
    entries: dict[str, str] = manifest["entries"]
    entities: dict[str, ApiEntityText] = {}
    with zipfile.ZipFile(archive_path) as bundle:
        for entity_id, expected in entries.items():
            name = entry_name(entity_id)
            body = bundle.read(name)
            if hashlib.sha256(body).hexdigest() != expected:
                raise ValueError(f"{name}: differs from the manifest checksum")
            payload = json.loads(body)
            if payload.get("@id") != entity_uri(release, entity_id):
                raise ValueError(f"{name}: answers for another entity")
            entities[entity_id] = parse_api_entity(entity_id, name, expected, payload)
    return ApiTextArchive(
        release=release,
        archive_sha256=archive_sha256,
        container_image=str(manifest["containerImage"]),
        data_release=str(manifest["dataRelease"]),
        fetched_at=str(manifest["fetchedAt"]),
        entities=entities,
        missing=frozenset(manifest.get("missing", {})),
    )
