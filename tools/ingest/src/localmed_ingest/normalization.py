from __future__ import annotations

import re
import unicodedata

STOP_WORDS = {
    "а",
    "без",
    "бы",
    "в",
    "во",
    "для",
    "до",
    "же",
    "и",
    "из",
    "или",
    "к",
    "как",
    "ко",
    "ли",
    "на",
    "не",
    "но",
    "о",
    "об",
    "от",
    "по",
    "под",
    "при",
    "с",
    "со",
    "у",
    "что",
    "это",
}

RUSSIAN_SUFFIXES = sorted(
    {
        "иями",
        "ями",
        "ами",
        "ого",
        "ему",
        "ому",
        "ыми",
        "ими",
        "иях",
        "ях",
        "ах",
        "ение",
        "ания",
        "ений",
        "ание",
        "ость",
        "ости",
        "его",
        "ая",
        "яя",
        "ое",
        "ее",
        "ые",
        "ие",
        "ой",
        "ей",
        "ий",
        "ый",
        "ам",
        "ям",
        "ом",
        "ем",
        "ов",
        "ев",
        "ия",
        "ья",
        "ью",
        "ы",
        "и",
        "а",
        "я",
        "у",
        "ю",
        "е",
        "о",
    },
    key=len,
    reverse=True,
)


def normalize_surface_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    normalized = re.sub(r"[‐‑‒–—−]", "-", normalized)
    normalized = re.sub(r"[^0-9a-zа-я\s.,:+/%-]", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def tokenize(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[0-9a-zа-я]+", value)
        if len(token) >= 2 and token not in STOP_WORDS
    ]


def light_stem_russian(token: str) -> str:
    if len(token) < 5 or re.search(r"[а-я]", token) is None:
        return token
    for suffix in RUSSIAN_SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            return token[: -len(suffix)]
    return token


def normalize_for_index(value: str) -> str:
    forms: dict[str, None] = {}
    for token in tokenize(normalize_surface_text(value)):
        forms[token] = None
        forms[light_stem_russian(token)] = None
    return " ".join(forms)
