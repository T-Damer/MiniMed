"""A native text layer of the same product beats OCR (STATE OCR1).

When a registration's instruction exists only as a scan but the same product (trade name, INN,
holder and dosage form) has another registration whose PDF carries a text layer, the two usually
hold the same text (re-registration, EAEU number next to the national one). The native text then
replaces the OCR text, but only when the documents are demonstrably the same, doses included: a
different strength or dose is never adopted
from another registration's text.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

_TOKEN = re.compile(r"[а-яёa-z0-9]+(?:[,.]\d+)?")
_NUMBER = re.compile(r"\d+(?:[.,]\d+)?")
MIN_SIBLING_WORDS = 300
MIN_TRIGRAM_CONTAINMENT = 0.75
LENGTH_RATIO = (0.7, 1.4)
MAX_OCR_ONLY_NUMBERS = 2


def normalise_name(value: object) -> str:
    text = str(value or "").casefold().replace("®", "").replace("™", "")
    return re.sub(r"[^0-9a-zа-яё]+", " ", text).strip()


def product_key(metadata: Mapping[str, Any]) -> tuple[str, str, str, str] | None:
    """Same trade name, INN, holder and dosage form; None when the registry left one empty."""
    key = tuple(
        normalise_name(metadata.get(name)) for name in ("tradeName", "inn", "holder", "dosageForm")
    )
    return cast(tuple[str, str, str, str], key) if all(key) else None


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text.casefold())


def _trigrams(tokens: Sequence[str]) -> set[tuple[str, str, str]]:
    return set(zip(tokens, tokens[1:], tokens[2:], strict=False))


def within_one_edit(left: str, right: str) -> bool:
    if left == right:
        return True
    if len(left) == len(right):
        return sum(a != b for a, b in zip(left, right, strict=True)) == 1
    if abs(len(left) - len(right)) != 1:
        return False
    short, long = sorted((left, right), key=len)
    return any(long[:i] + long[i + 1 :] == short for i in range(len(long)))


@dataclass(frozen=True)
class Comparison:
    containment: float
    word_ratio: float
    ocr_only_numbers: tuple[str, ...]
    native_only_numbers: tuple[str, ...]

    @property
    def same_document(self) -> bool:
        """The native text is the same document as the OCR text, doses included.

        Every number of the native text must be in the OCR text; an OCR-only number is tolerated
        only as a one-character misreading of a native number, and then at most a couple.
        """
        if self.containment < MIN_TRIGRAM_CONTAINMENT:
            return False
        if not LENGTH_RATIO[0] <= self.word_ratio <= LENGTH_RATIO[1]:
            return False
        if len(self.ocr_only_numbers) > MAX_OCR_ONLY_NUMBERS:
            return False
        return all(
            any(within_one_edit(number, other) for other in self.ocr_only_numbers)
            for number in self.native_only_numbers
        )


def compare_with_native(ocr_text: str, native_text: str) -> Comparison:
    ocr_tokens, native_tokens = _tokens(ocr_text), _tokens(native_text)
    if not ocr_tokens or not native_tokens:
        return Comparison(0.0, 0.0, (), ())
    ocr_grams, native_grams = _trigrams(ocr_tokens), _trigrams(native_tokens)
    containment = len(ocr_grams & native_grams) / len(ocr_grams) if ocr_grams else 0.0
    ocr_numbers = {n.replace(",", ".") for n in _NUMBER.findall(" ".join(ocr_tokens))}
    native_numbers = {n.replace(",", ".") for n in _NUMBER.findall(" ".join(native_tokens))}
    return Comparison(
        containment=containment,
        word_ratio=len(native_tokens) / len(ocr_tokens),
        ocr_only_numbers=tuple(sorted(ocr_numbers - native_numbers)),
        native_only_numbers=tuple(sorted(native_numbers - ocr_numbers)),
    )
