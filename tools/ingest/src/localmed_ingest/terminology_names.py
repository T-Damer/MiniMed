"""Conservative search-only spelling projections; source names/definitions remain untouched."""

from __future__ import annotations

import hashlib
import re

from .models import Alias
from .terminology_models import MedicalTerm

_LOOKALIKES = str.maketrans("ABCEHKMOPTXYaceopxy", "АВСЕНКМОРТХУасеорху")
_WORD = re.compile(r"[A-Za-zА-Яа-яЁё]+")


def russian_search_spelling(value: str) -> str:
    def project(match: re.Match[str]) -> str:
        word = match.group()
        latin = re.findall(r"[A-Za-z]", word)
        cyrillic = len(re.findall(r"[А-Яа-яЁё]", word))
        if cyrillic < 3 or not latin or len(latin) >= cyrillic:
            return word
        if any(ord(letter) not in _LOOKALIKES for letter in latin):
            return word
        return word.translate(_LOOKALIKES)

    return _WORD.sub(project, value)


def terminology_search_aliases(terms: list[MedicalTerm]) -> list[Alias]:
    aliases: dict[str, Alias] = {}
    for term in terms:
        for name in term.names:
            if name.language != "ru":
                continue
            variant = russian_search_spelling(name.text)
            if variant == name.text:
                continue
            key = f"alias.{term.id}.script." + hashlib.sha256(name.text.encode()).hexdigest()[:16]
            aliases[key] = Alias(
                id=key,
                canonical_term=name.text,
                alias=variant,
                category="terminology-search-spelling",
                weight=0.5,
            )
    return [aliases[key] for key in sorted(aliases)]
