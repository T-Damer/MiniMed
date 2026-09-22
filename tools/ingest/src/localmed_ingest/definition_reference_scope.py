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


def definition_scope(
    entries: Mapping[str, ScopeEntry],
) -> tuple[set[str], dict[str, object]]:
    """Return a source-local selection; coverage labels are not medical approval."""
    selected: set[str] = set()
    excluded: list[dict[str, str]] = []
    coverage: Counter[str] = Counter()
    kinds: Counter[str] = Counter()
    reasons: Counter[str] = Counter()
    for identifier, entry in sorted(entries.items()):
        if identifier != entry.id:
            raise ValueError("Definition scope identity differs from its source key")
        reason = (
            "lexical-gloss-not-clinical-definition"
            if entry.text_kind == "source-gloss"
            else "history-is-a-separate-reference"
            if entry.kind == "history_note"
            else "not-a-standalone-definition"
            if entry.coverage not in {"definition", "explicit-definition"}
            else None
        )
        if reason is None:
            selected.add(identifier)
            coverage[entry.coverage] += 1
            kinds[entry.kind] += 1
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
        "excludedByReason": dict(reasons),
        "excludedEntries": excluded,
        "selectedIdsSha256": hashlib.sha256(serialized).hexdigest(),
        "boundary": (
            "Source-local definition candidates, not unique concepts or medical approval. "
            "Original inputs, source blocks and annotations remain unchanged. "
            "Lexical glosses and other reference cards remain in the authoring sources; "
            "a definition of a scale does not enable scoring or treatment decisions."
        ),
    }
