"""Conservative syntax intake, not a clinical correctness classifier."""

from __future__ import annotations

import re

DISCOURSE_START = re.compile(
    r"^(?:одна|одной|одни|все|остальные|кроме того|довольно|"
    r"отсутствие единых подходов)\b",
    re.IGNORECASE,
)
FRAME_OR_FREQUENCY = re.compile(
    r"\b(?:согласно|обычно|чаще|реже|преимущественно|по существу|впервые)$|"
    r"\b(?:согласно|обычно|чаще|реже|преимущественно)\b",
    re.IGNORECASE,
)
MULTIPLE_UNRESOLVED_LABELS = re.compile(r"^[A-ZА-ЯЁ0-9-]{2,12},\s")


def candidate_rejection(label: str) -> str | None:
    """Preserve the underlying statement in article context when its name is not standalone."""
    if DISCOURSE_START.search(label):
        return "discourse-or-context-dependent-subject"
    if FRAME_OR_FREQUENCY.search(label):
        return "author-frame-or-frequency-qualifier"
    if MULTIPLE_UNRESOLVED_LABELS.search(label):
        return "unresolved-multiple-subjects"
    return None
