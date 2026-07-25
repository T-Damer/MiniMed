from __future__ import annotations

import re

_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
_GARBLE_TOKEN = re.compile(r"(?i)(?=[0-9=@<>;:?.]{6,})(?:[0-9A-Za-z=@<>;:?.]{6,})")


def cyrillic_letter_ratio(text: str) -> float:
    letters = [character for character in text if character.isalpha()]
    if not letters:
        return 0.0
    return len(_CYRILLIC.findall("".join(letters))) / len(letters)


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
