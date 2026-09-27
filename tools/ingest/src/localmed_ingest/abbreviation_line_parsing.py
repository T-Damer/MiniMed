"""One shared "term <dash> expansion" line splitter for KR "Список сокращений" sections.

Before this module existed, `clinical_definition_sections.py` (which derives the "Словарь"
abbreviation-expansion drafts) and `clinical_aliases.py` (which derives core search
aliases) each carried their own independent regex for splitting a "СВДС - синдром
внезапной детской смерти" style line into (label, expansion). They were never guaranteed
to agree, and in practice `clinical_aliases.py`'s pattern recognized fewer typographic
dash variants and did not treat a soft hyphen as an OCR/ligature artifact.

`clinical_definition_sections.PAIR_RE` is the more rigorously exercised of the two (it has
dedicated regression tests for the ASCII-hyphen-vs-Russian-compound-word ambiguity and for
soft-hyphen OCR artifacts), so this module re-exports exactly that pattern as the single
source of truth. Both callers keep their own downstream policy: `clinical_aliases.py` still
decides whether the label looks like a real acronym and whether the expansion is lexically
related to the record's own title; `clinical_definition_sections.py` still decides section
membership, de-duplication and conflict flagging. Only the raw line split is shared.
"""

from __future__ import annotations

import re

# Typographic dashes (en/em/figure/minus) essentially never sit inside a Russian compound
# word, so they may have optional surrounding whitespace as the "term - definition" split.
# The plain ASCII hyphen is exactly how Russian compounds are written ("какой-либо",
# "герминативно-клеточная"), so it only counts as a separator when whitespace surrounds it
# on *both* sides - otherwise "герминативно-клеточная опухоль" would wrongly split in two.
TYPOGRAPHIC_DASH_CLASS = "‐‑‒–—―−"
PLAIN_HYPHEN = "-"
PAIR_RE = re.compile(
    rf"^(?:[-*•]\s+)?(?P<term>[^\n]{{1,140}}?)(?:"
    rf"[­]?\s*[{TYPOGRAPHIC_DASH_CLASS}]\s*"
    rf"|\s[{PLAIN_HYPHEN}]\s"
    rf")(?P<definition>.+)$",
    re.DOTALL,
)


def split_abbreviation_pair(paragraph: str) -> tuple[str, str] | None:
    """Split one "label <dash> expansion" paragraph/line.

    Returns `(label, expansion)` with surrounding whitespace and list/heading markup
    trimmed from the label, or `None` when the paragraph does not look like a labelled
    dash-separated pair at all. Callers apply their own further validation (acronym shape,
    lexical relation to a title, minimum expansion length, and so on).
    """
    match = PAIR_RE.match(paragraph)
    if not match:
        return None
    label = match.group("term").strip(" \t*#\xad")
    expansion = match.group("definition").strip()
    return label, expansion
