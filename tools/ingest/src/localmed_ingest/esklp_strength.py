"""One way to read a ЕСКЛП dosage: quantity + unit, a composite expression, or nothing.

The registry prints a dosage in two cells, «Кол-во» and «Единица измерения дозировки». For a
single substance they are «500.0» and «мг». For a combination drug the registry fills the first
cell with the placeholder «1.0» and writes the whole composite dosage into the second one
(«1.0» + «325 мг+10 мг+20 мг»), and for a dosage it does not state it writes «1.0» + «~» or the
literal «НЕ УКАЗАНО». Gluing the cells together gave «1.0325 мг+10 мг+20 мг», «1.0 650 мг», «1.01.42
мг+18.26 мг+20 мг/мл» and «1.0~» on the cards (STATE DOSE1, QA 0.6.60 item 4).

* `registry_strength` is the builder rule: the cells in, one strength or `None` out.
* `repair_strength` is the same rule applied to an already glued string. It needs evidence that the
  prefix is the placeholder (the other spelling of the same dosage on the same node), so a real
  «1.025 мг» is never touched.
* `is_unstated` is the registry's «no value» vocabulary; such a value is absent, never text.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

#: Values the registry writes where it has no dosage. Compared after `normalize_unstated`.
_UNSTATED = frozenset({"", "~", "-", "—", "не указано", "не указан", "не указана", "не указаны"})
#: The quantity the registry prints in front of a composite dosage, «1», «1.0», «1,0».
_PLACEHOLDER_QUANTITY = re.compile(r"^1(?:[.,]0+)?$")
#: A unit cell that is itself a dosage expression: «325 мг+10 мг+20 мг», «0.0005 мг»,
#: «(125 мг+2 мг)/5 мл».
_EXPRESSION = re.compile(r"^(?:\d|\()")
#: «1.0 325 мг+…» (the cells joined by a space, trade-name rows).
_SPACED = re.compile(r"^1\.0\s+(?P<rest>(?:\d|\().*)$", re.DOTALL)
#: «1.0325 мг+…» (the cells joined without a space, node rows); `rest` is what follows «1.0».
_GLUED = re.compile(r"^1\.0(?P<rest>(?:\d|\().*)$", re.DOTALL)
#: «1.0~», «1.0 ~», «1.0НЕ УКАЗАНО»: the placeholder in front of an unstated dosage.
_PLACEHOLDER_UNSTATED = re.compile(r"^1\.0\s*(?P<rest>.*)$", re.DOTALL)


def _clean(value: object | None) -> str | None:
    if value is None:
        return None
    cleaned = re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()
    return cleaned or None


def is_unstated(value: object | None) -> bool:
    """True for «~», «НЕ УКАЗАНО» and the like: the registry says it has no value."""
    cleaned = _clean(value)
    return cleaned is None or cleaned.casefold() in _UNSTATED


def registry_strength(
    quantity: object | None, unit: object | None, *, separator: str = ""
) -> str | None:
    """The dosage of two registry cells, or `None` when the registry states none.

    * unit unstated: the quantity placeholder carries nothing (`None`); any other quantity stays;
    * unit is a dosage expression and the quantity is the placeholder «1.0»: the unit alone;
    * otherwise quantity and unit joined by `separator` («500.0» + «мг» → «500.0мг»).
    """
    amount = _clean(quantity)
    measure = _clean(unit)
    if is_unstated(amount) and not is_unstated(measure):
        return measure if measure and _EXPRESSION.match(measure) else None
    if amount is None:
        return None
    if measure is None or is_unstated(measure):
        return None if _PLACEHOLDER_QUANTITY.match(amount) or is_unstated(amount) else amount
    if _EXPRESSION.match(measure) and _PLACEHOLDER_QUANTITY.match(amount):
        return measure
    normalized_amount = re.sub(r"\s+", "", amount).casefold()
    normalized_measure = re.sub(r"\s+", "", measure).casefold()
    if normalized_amount.endswith(normalized_measure):
        return amount
    return f"{amount}{separator}{measure}"


def repair_strength(value: object | None, evidence: Iterable[object | None] = ()) -> str | None:
    """A strength the builder glued wrongly, read the way `registry_strength` reads its cells.

    `evidence` is every other spelling of the dosage on the same node (the trade-name rows). A
    glued «1.0<rest>» is repaired only when the evidence holds «1.0 <rest>»; the spaced «1.0 <rest>»
    is unambiguous by itself. A value no rule applies to is returned exactly as it was given, and
    an unstated value is `None`.
    """
    text = _clean(value)
    if text is None:
        return None
    spaced = _SPACED.match(text)
    if spaced:
        return spaced.group("rest").strip()
    glued = _GLUED.match(text)
    if glued:
        spellings = {_clean(item) for item in evidence}
        if f"1.0 {glued.group('rest')}" in spellings:
            return glued.group("rest").strip()
        return str(value)
    placeholder = _PLACEHOLDER_UNSTATED.match(text)
    if placeholder and is_unstated(placeholder.group("rest")):
        return None
    return None if is_unstated(text) else str(value)


def has_glued_placeholder(value: object | None) -> bool:
    """True when `value` still shows the placeholder joined to a dosage («1.0 325 мг», «1.0~»)."""
    text = _clean(value)
    if text is None:
        return False
    if _SPACED.match(text):
        return True
    placeholder = _PLACEHOLDER_UNSTATED.match(text)
    return bool(placeholder and text.startswith("1.0") and is_unstated(placeholder.group("rest")))
