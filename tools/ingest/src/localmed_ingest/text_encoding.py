from __future__ import annotations

import re

_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
_LATIN = re.compile(r"[A-Za-z]")
_GARBLE_TOKEN = re.compile(r"(?i)(?=[0-9=@<>;:?.]{6,})(?:[0-9A-Za-z=@<>;:?.]{6,})")


def cyrillic_letter_ratio(text: str) -> float:
    letters = [character for character in text if character.isalpha()]
    if not letters:
        return 0.0
    return len(_CYRILLIC.findall("".join(letters))) / len(letters)


def latin_letter_ratio(text: str) -> float:
    letters = [character for character in text if character.isalpha()]
    if not letters:
        return 0.0
    return len(_LATIN.findall("".join(letters))) / len(letters)


def garble_token_count(text: str) -> int:
    count = 0
    for token in _GARBLE_TOKEN.findall(text):
        if _CYRILLIC.search(token):
            continue
        if sum(character in "=@<>?08" for character in token) >= 3:
            count += 1
    return count


def is_likely_garbled_russian_pdf_text(
    text: str,
    *,
    min_alphabetic_chars: int = 80,
    max_cyrillic_ratio: float = 0.08,
    min_garble_tokens: int = 3,
) -> bool:
    stripped = text.strip()
    if len(stripped) < min_alphabetic_chars:
        return False
    letters = [character for character in stripped if character.isalpha()]
    if len(letters) < min_alphabetic_chars:
        return False
    if cyrillic_letter_ratio(stripped) > max_cyrillic_ratio:
        return False
    return garble_token_count(stripped) >= min_garble_tokens


def is_likely_english_dominant_russian_source(
    text: str,
    *,
    min_alphabetic_chars: int = 500,
    max_cyrillic_ratio: float = 0.12,
    min_latin_ratio: float = 0.75,
) -> bool:
    """Detect OCR/model output that replaced a Russian document with English prose.

    This check runs on a whole document rather than one reference/table chunk so Latin drug names and
    bibliography entries do not fail an otherwise Russian source.
    """

    letters = [character for character in text if character.isalpha()]
    if len(letters) < min_alphabetic_chars:
        return False
    if garble_token_count(text) >= 3:
        return False
    return (
        cyrillic_letter_ratio(text) <= max_cyrillic_ratio
        and latin_letter_ratio(text) >= min_latin_ratio
    )


def expects_russian_clinical_text(title: str, *, source_type: str | None = None) -> bool:
    if _CYRILLIC.search(title):
        return True
    return source_type == "clinical_recommendation"


def lint_garbled_russian_text(text: str, *, context: str) -> str | None:
    if not is_likely_garbled_russian_pdf_text(text):
        return None
    return (
        f"{context}: extracted text looks like broken PDF font encoding "
        f"(cyrillic ratio {cyrillic_letter_ratio(text):.3f}); "
        "OCR fallback or source replacement is required."
    )


def lint_english_dominant_russian_text(text: str, *, context: str) -> str | None:
    if not is_likely_english_dominant_russian_source(text):
        return None
    return (
        f"{context}: Russian source text is English-dominant "
        f"(cyrillic ratio {cyrillic_letter_ratio(text):.3f}, "
        f"Latin ratio {latin_letter_ratio(text):.3f}); "
        "OCR must preserve the original Russian wording and must not translate it."
    )
