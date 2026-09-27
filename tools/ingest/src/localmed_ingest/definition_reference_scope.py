"""Select definition records, not article titles, lexical glosses or whole instruments.

Selection runs after ordinary source validation. It changes only the searchable identity
set, never source wording, source blocks, licensing or clinical review status.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping
from typing import Protocol


class ScopeEntry(Protocol):
    @property
    def id(self) -> str: ...

    @property
    def coverage(self) -> str: ...

    @property
    def text_kind(self) -> str: ...

    @property
    def kind(self) -> str: ...


def _record_type(entry: ScopeEntry) -> str:
    if entry.kind == "abbreviation":
        return "abbreviation"
    if entry.text_kind == "source-gloss":
        return "lexical-gloss"
    return "clinical-definition"


def definition_scope(
    entries: Mapping[str, ScopeEntry],
) -> tuple[set[str], dict[str, object]]:
    """Return a source-local selection; coverage labels are not medical approval.

    Three disjoint record types can be selected, each requiring its own explicit coverage
    label so one type can never be silently promoted into another:

    - clinical definitions (``coverage`` in {"definition", "explicit-definition"});
    - Wiktionary lexical glosses (``text_kind == "source-gloss"`` and ``coverage == "gloss"``),
      kept distinct so the UI can label them "Викисловарь" rather than a clinical card;
    - abbreviation expansions (``kind == "abbreviation"`` and ``coverage == "abbreviation"``),
      which are never counted as clinical definitions.
    """
    selected: set[str] = set()
    excluded: list[dict[str, str]] = []
    coverage: Counter[str] = Counter()
    kinds: Counter[str] = Counter()
    reasons: Counter[str] = Counter()
    record_types: Counter[str] = Counter()
    for identifier, entry in sorted(entries.items()):
        if identifier != entry.id:
            raise ValueError("Definition scope identity differs from its source key")
        record_type = _record_type(entry)
        if entry.kind == "history_note":
            reason: str | None = "history-is-a-separate-reference"
        elif record_type == "abbreviation":
            reason = None if entry.coverage == "abbreviation" else "not-a-standalone-definition"
        elif record_type == "lexical-gloss":
            reason = None if entry.coverage == "gloss" else "lexical-gloss-not-clinical-definition"
        else:
            reason = (
                None
                if entry.coverage in {"definition", "explicit-definition"}
                else "not-a-standalone-definition"
            )
        if reason is None:
            selected.add(identifier)
            coverage[entry.coverage] += 1
            kinds[entry.kind] += 1
            record_types[record_type] += 1
        else:
            reasons[reason] += 1
            excluded.append({"id": identifier, "coverage": entry.coverage, "reason": reason})
    serialized = json.dumps(sorted(selected), separators=(",", ":")).encode("utf-8")
    return selected, {
        "scope": "definitions",
        "sourceRecordsBefore": len(entries),
        "definitionRecordsAfter": len(selected),
        "excludedRecords": len(excluded),
        "selectedByCoverage": dict(coverage),
        "selectedByKind": dict(kinds),
        "selectedByRecordType": dict(record_types),
        "excludedByReason": dict(reasons),
        "excludedEntries": excluded,
        "selectedIdsSha256": hashlib.sha256(serialized).hexdigest(),
        "boundary": (
            "Source-local definition candidates, not unique concepts or medical approval. "
            "Original inputs, source blocks and annotations remain unchanged. Lexical "
            "glosses and abbreviation expansions are selected as their own record types, "
            "not clinical definitions; a definition of a scale does not enable scoring or "
            "treatment decisions."
        ),
    }
