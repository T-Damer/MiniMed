"""Labels of the official clinical-recommendation template that the JSON kept as bold paragraphs.

The Minzdrav template fixes some sub-items inside its sections: the indications of section 6
(«Показания для плановой госпитализации …»), the criteria of section 2, the fixed headings of
Appendix А1 («Конфликт интересов»), А2 («Целевая аудитория данных клинических рекомендаций:»,
«Порядок обновления клинических рекомендаций.», the methods of evidence collection), А3
(«Связанные документы») and the passport fields of every Г scale («Содержание (шаблон):»,
«Ключ (интерпретация):»). The source stores each as a bold ``<p>``, so it is neither a heading nor
searchable as one.

``clinical_template_labels.json`` is the curated list (wording normalised: case, ё/е, spaces, a
trailing colon or full stop, spaces around «/»), each label with the section it lives in and the
number of current clinical recommendations that carry it. It was mined from the bold standalone
lines of the 774 current documents (``scripts/mine_clinical_template_labels.py``) and reviewed by
hand: only wording that recurs in at least ``minDocuments`` documents and that belongs to the
template qualifies. Evidence-level lines, table captions and scale titles, the «Комментарии:» that
follow single recommendations, doses and author lists never do. A label is only taken inside its
section (a generic word such as «Содержание» is a heading in a scale appendix only).
"""

from __future__ import annotations

import json
import re
import unicodedata
from functools import cache
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

TEMPLATE_LABELS_PATH = Path(__file__).with_name("clinical_template_labels.json")

_SPACE = re.compile(r"\s+")
_AROUND_SLASH = re.compile(r"\s*/\s*")
_TRAILING_PUNCTUATION = " :.;"


def normalize_label(text: str) -> str:
    """Unicode form, case, ё/е, whitespace and trailing punctuation folded, for comparing wording.

    The source mixes composed and decomposed «й» («и» + a combining breve), so the form is folded.
    """
    composed = unicodedata.normalize("NFKC", text)
    folded = _SPACE.sub(" ", composed.lower().replace("ё", "е")).strip()
    return _AROUND_SLASH.sub("/", folded).rstrip(_TRAILING_PUNCTUATION)


class TemplateLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    context: str
    documents: int = Field(ge=1)
    example: str


class TemplateLabelList(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int
    mined_from: str = Field(alias="minedFrom")
    document_count: int = Field(alias="documentCount")
    min_documents: int = Field(alias="minDocuments")
    # Context name -> regular expression over the normalised title of the source section.
    contexts: dict[str, str]
    labels: list[TemplateLabel]


@cache
def load_template_labels() -> TemplateLabelList:
    parsed = TemplateLabelList.model_validate(
        json.loads(TEMPLATE_LABELS_PATH.read_text(encoding="utf-8"))
    )
    unknown = {item.context for item in parsed.labels} - set(parsed.contexts)
    if unknown:
        raise ValueError(f"Template labels use undeclared contexts: {sorted(unknown)}")
    for item in parsed.labels:
        if normalize_label(item.label) != item.label:
            raise ValueError(f"Template label is not normalised: {item.label!r}")
    return parsed


@cache
def _label_contexts() -> tuple[dict[str, frozenset[str]], dict[str, re.Pattern[str]]]:
    parsed = load_template_labels()
    by_label: dict[str, set[str]] = {}
    for item in parsed.labels:
        by_label.setdefault(item.label, set()).add(item.context)
    patterns = {name: re.compile(pattern) for name, pattern in parsed.contexts.items()}
    return {label: frozenset(names) for label, names in by_label.items()}, patterns


def is_template_label(paragraph: str, section_title: str) -> bool:
    """Whether a bold standalone paragraph of ``section_title`` is a known template label."""
    by_label, patterns = _label_contexts()
    contexts = by_label.get(normalize_label(paragraph))
    if not contexts:
        return False
    title = normalize_label(section_title)
    return any(patterns[name].search(title) for name in contexts)
