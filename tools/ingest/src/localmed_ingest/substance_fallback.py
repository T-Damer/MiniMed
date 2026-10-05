"""Same-substance instruction fallback (ADR-0023): donors for registrations with no text.

A product of the drug screen whose own registration has no instruction document may show the text of
ANOTHER registration of the SAME МНН card, always labelled as another preparation's instruction.
This module decides which registrations may serve as donors. Everything here is pure (no I/O) so it
can be tested; `scripts/build_substance_fallback.py` supplies the ЕСКЛП cards, the documents the
released modules hold and the ГРЛС registry facts, and writes the asset the app validates.

Rules (the ADR is the contract):

* A donor is always a registration of the same ЕСКЛП МНН card as the target: nothing crosses
  an МНН, because a card is exactly one standardized МНН (a combination is its own МНН).
* Level 1: same dosage form and same strength. «Same» is the registry's own grouping (the same
  СМНН node) or an identical normalized form string with an identical canonical strength. A strength
  the registry does not state («НЕ УКАЗАНО») never counts as the same strength.
* Level 2, only when level 1 has no donor: same form class (``grls_groups.dosage_form_class``) but a
  different strength, an unstated strength or a different wording of the form. Every difference is
  recorded in the donor's flags so the screen can warn about it.
* Nothing is merged and nothing is inferred; a fallback is a pointer to an existing document.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, cast

from .grls_groups import FormClass, dosage_form_class

SCHEMA_VERSION = 1
#: Donors kept per registration; the app walks the list until one of them is installed.
MAX_DONORS = 4

#: Flags of a level-2 donor, relative to the target.
FLAG_STRENGTH_DIFFERS = 1
FLAG_STRENGTH_UNKNOWN = 2
FLAG_FORM_DIFFERS = 4

SourceClass = Literal["grls", "manufacturer-site"]
DocumentKind = Literal["ohlp", "national-instruction", "leaflet", "unknown"]

_KIND_RANK: dict[str, int] = {"ohlp": 0, "national-instruction": 1, "unknown": 2, "leaflet": 3}
_SOURCE_RANK: dict[str, int] = {"grls": 0, "manufacturer-site": 1}
#: Form classes too coarse to say that two forms are alike.
_UNCLASSIFIED_FORMS: frozenset[str] = frozenset({"other", "substance"})
_UNSTATED_STRENGTH = {"", "не указано", "не указана", "~", "-", "—"}


def normalize_text(value: str | None) -> str:
    return " ".join((value or "").casefold().replace("ё", "е").split())


# --------------------------------------------------------------------------------------------
# Strength parsing
# --------------------------------------------------------------------------------------------

#: Mass and volume units are compared in one base unit, so «0,5 г» equals «500 мг».
_UNIT_FACTORS: dict[str, tuple[str, Decimal]] = {
    "г": ("мг", Decimal(1000)),
    "мг": ("мг", Decimal(1)),
    "мкг": ("мг", Decimal("0.001")),
    "нг": ("мг", Decimal("0.000001")),
    "л": ("мл", Decimal(1000)),
    "мл": ("мл", Decimal(1)),
}
_TERM = re.compile(
    r"^(?P<value>\d+(?:[.,]\d+)?)\s*(?P<unit>[^\d/\s][^/]*?)"
    r"(?:\s*/\s*(?:(?P<denominator_value>\d+(?:[.,]\d+)?)\s*)?(?P<denominator_unit>[^\d/\s].*))?$"
)


def _decimal(text: str) -> Decimal | None:
    try:
        return Decimal(text.replace(",", "."))
    except InvalidOperation:
        return None


def _decimal_text(value: Decimal) -> str:
    text = format(value.normalize(), "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _scaled(value: Decimal, unit: str) -> tuple[Decimal, str]:
    base = _UNIT_FACTORS.get(unit)
    return (value * base[1], base[0]) if base else (value, unit)


def _term_key(term: str) -> str:
    match = _TERM.match(term)
    value = _decimal(match.group("value")) if match else None
    if match is None or value is None:
        return term
    unit = match.group("unit").strip()
    amount, unit_key = _scaled(value, unit)
    key = f"{_decimal_text(amount)} {unit_key}"
    denominator_unit = match.group("denominator_unit")
    if denominator_unit:
        denominator_value = _decimal(match.group("denominator_value") or "1")
        if denominator_value is None:
            return term
        divisor, denominator_key = _scaled(denominator_value, denominator_unit.strip())
        # «1 мг/1 мл» and «1 мг/мл» are one concentration; other ratios stay as printed.
        key += (
            f"/{denominator_key}"
            if divisor == 1
            else f"/{_decimal_text(divisor)} {denominator_key}"
        )
    return key


def canonical_strength(raw: str | None) -> str | None:
    """A strength as a comparable key, or ``None`` when the registry does not state one.

    ``«500 мг»``, ``«0.5 г»`` and ``«500.0мг»`` give one key; the components of a combination keep
    their order (``«40 мг + 10 мг»`` is not ``«10 мг + 40 мг»``). Text the grammar does not know is
    kept as normalized text, so identical text still matches and nothing is guessed.
    """
    text = normalize_text(raw)
    if text in _UNSTATED_STRENGTH:
        return None
    terms = [term.strip() for term in re.split(r"\s*(?:\+|\sи\s)\s*", text) if term.strip()]
    return " + ".join(_term_key(term) for term in terms) if terms else None


# --------------------------------------------------------------------------------------------
# Registrations
# --------------------------------------------------------------------------------------------

_FORM_AND_STRENGTH = re.compile(r"^(?P<form>.*?)\s*\((?P<strength>[^()]*)\)\s*$")


@dataclass(frozen=True)
class Presentation:
    """One form-and-strength fact of a registration inside one СМНН node."""

    node: str
    form: str
    form_class: FormClass
    strength: str | None


@dataclass(frozen=True)
class Registration:
    number: str
    card_id: str
    trade_name: str
    presentations: tuple[Presentation, ...]


def _mapping_list(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [
        cast(Mapping[str, Any], item)
        for item in cast(list[object], value)
        if isinstance(item, dict)
    ]


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def card_registrations(card_id: str, metadata: Mapping[str, Any]) -> list[Registration]:
    """The registrations of one ЕСКЛП МНН card with their presentations, in a stable order."""
    presentations: dict[str, dict[Presentation, None]] = {}
    names: dict[str, str] = {}
    for node in _mapping_list(metadata.get("smnnNodes")):
        code = _text(node.get("smnnCode")) or ""
        node_form = _text(node.get("dosageForm"))
        for trade in _mapping_list(node.get("tradeNames")):
            number = _text(trade.get("registrationNumber"))
            if not number:
                continue
            names.setdefault(number, _text(trade.get("tradeName")) or "")
            pairs: list[tuple[str, str | None]] = []
            normalized = trade.get("normalizedFormsStrengths")
            for item in cast(list[object], normalized) if isinstance(normalized, list) else []:
                match = _FORM_AND_STRENGTH.match(item) if isinstance(item, str) else None
                if match:
                    pairs.append((match.group("form"), match.group("strength")))
            if not pairs:
                # The raw fields carry a «1.0» pack-count prefix on the strength; keep them as the
                # last resort so a registration is never dropped.
                pairs.append(
                    (
                        _text(trade.get("dosageForm")) or node_form or "",
                        _text(trade.get("strength")),
                    )
                )
            bucket = presentations.setdefault(number, {})
            for form, strength in pairs:
                form_key = normalize_text(form)
                if not form_key:
                    continue
                bucket[
                    Presentation(
                        code, form_key, dosage_form_class(form), canonical_strength(strength)
                    )
                ] = None
    return [
        Registration(number, card_id, names.get(number, ""), tuple(bucket))
        for number, bucket in sorted(presentations.items())
    ]


@dataclass(frozen=True)
class DonorFacts:
    """What the ranking needs to know about a registration that has a document."""

    source_class: SourceClass
    kind: str
    foreign_holder: bool
    registered_on: date | None


def relate(target: Registration, donor: Registration) -> tuple[int, int] | None:
    """(level, flags) of the best relation of ``donor`` to ``target``, or ``None`` if unrelated."""
    if target.card_id != donor.card_id or target.number == donor.number:
        return None
    best: tuple[int, int] | None = None
    for own in target.presentations:
        for other in donor.presentations:
            same_node = bool(own.node) and own.node == other.node
            same_form = same_node or own.form == other.form
            if own.strength is not None and own.strength == other.strength and same_form:
                return 1, 0
            if own.form_class in _UNCLASSIFIED_FORMS or own.form_class != other.form_class:
                continue
            flags = 0 if same_form else FLAG_FORM_DIFFERS
            if own.strength is None or other.strength is None:
                flags |= FLAG_STRENGTH_UNKNOWN
            elif own.strength != other.strength:
                flags |= FLAG_STRENGTH_DIFFERS
            if flags == 0:
                continue
            if best is None or (flags.bit_count(), flags) < (best[1].bit_count(), best[1]):
                best = 2, flags
    return best


def _rank(number: str, flags: int, facts: DonorFacts) -> tuple[object, ...]:
    return (
        flags.bit_count(),
        flags,
        _SOURCE_RANK.get(facts.source_class, len(_SOURCE_RANK)),
        _KIND_RANK.get(facts.kind, len(_KIND_RANK)),
        0 if facts.foreign_holder else 1,
        facts.registered_on or date.max,
        number,
    )


@dataclass(frozen=True)
class FallbackEntry:
    level: Literal[1, 2]
    donors: tuple[tuple[str, int], ...]


class _CardIndex:
    """Donors of one card, indexed so a target only meets plausible candidates."""

    def __init__(self, donors: Iterable[Registration]) -> None:
        self.by_node: dict[str, list[Registration]] = defaultdict(list)
        self.by_form_strength: dict[tuple[str, str], list[Registration]] = defaultdict(list)
        self.by_class: dict[str, list[Registration]] = defaultdict(list)
        for donor in donors:
            seen_nodes: set[str] = set()
            seen_pairs: set[tuple[str, str]] = set()
            seen_classes: set[str] = set()
            for item in donor.presentations:
                if item.node and item.node not in seen_nodes:
                    seen_nodes.add(item.node)
                    self.by_node[item.node].append(donor)
                if item.strength is not None and (item.form, item.strength) not in seen_pairs:
                    seen_pairs.add((item.form, item.strength))
                    self.by_form_strength[(item.form, item.strength)].append(donor)
                if (
                    item.form_class not in _UNCLASSIFIED_FORMS
                    and item.form_class not in seen_classes
                ):
                    seen_classes.add(item.form_class)
                    self.by_class[item.form_class].append(donor)

    def candidates(self, target: Registration, *, wide: bool) -> dict[str, Registration]:
        found: dict[str, Registration] = {}
        for item in target.presentations:
            pools: list[list[Registration]] = []
            if wide:
                pools.append(self.by_class.get(item.form_class, []))
            else:
                if item.node:
                    pools.append(self.by_node.get(item.node, []))
                if item.strength is not None:
                    pools.append(self.by_form_strength.get((item.form, item.strength), []))
            for pool in pools:
                for donor in pool:
                    found[donor.number] = donor
        return found


def assign_fallbacks(
    registrations: Sequence[Registration],
    with_text: Mapping[str, DonorFacts],
) -> dict[str, FallbackEntry]:
    """Donors for every registration that has no document of its own (keyed by its number)."""
    by_card: dict[str, list[Registration]] = defaultdict(list)
    for registration in registrations:
        by_card[registration.card_id].append(registration)
    result: dict[str, FallbackEntry] = {}
    for members in by_card.values():
        index = _CardIndex(member for member in members if member.number in with_text)
        for target in members:
            if target.number in with_text:
                continue
            for level in (1, 2):
                related: list[tuple[tuple[object, ...], str, int]] = []
                for donor in index.candidates(target, wide=level == 2).values():
                    relation = relate(target, donor)
                    if relation is None or relation[0] != level:
                        continue
                    facts = with_text[donor.number]
                    related.append(
                        (_rank(donor.number, relation[1], facts), donor.number, relation[1])
                    )
                if related:
                    related.sort(key=lambda item: item[0])
                    result[target.number] = FallbackEntry(
                        1 if level == 1 else 2,
                        tuple((number, flags) for _, number, flags in related[:MAX_DONORS]),
                    )
                    break
    return result


# --------------------------------------------------------------------------------------------
# Asset
# --------------------------------------------------------------------------------------------


def parse_registry_date(value: object) -> date | None:
    match = (
        re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", value.strip())
        if isinstance(value, str)
        else None
    )
    if not match:
        return None
    try:
        return date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
    except ValueError:
        return None


def is_foreign_country(country: object) -> bool:
    text = normalize_text(country if isinstance(country, str) else "")
    return bool(text) and text not in {"россия", "российская федерация", "рф"}


def best_kind(kinds: Iterable[str]) -> str:
    """The kind the app shows for a registration with several documents (ОХЛП first)."""
    return min(kinds, key=lambda kind: _KIND_RANK.get(kind, len(_KIND_RANK)), default="unknown")


def asset_payload(
    entries: Mapping[str, FallbackEntry], basis: Mapping[str, object]
) -> dict[str, object]:
    """The JSON the app loads: shared donor lists once, registrations pointing at them."""
    groups: dict[tuple[int, tuple[tuple[str, int], ...]], int] = {}
    registrations: dict[str, int] = {}
    for number in sorted(entries):
        entry = entries[number]
        key = (entry.level, entry.donors)
        registrations[number] = groups.setdefault(key, len(groups))
    return {
        "schemaVersion": SCHEMA_VERSION,
        "basis": dict(basis),
        "groups": [
            {"level": level, "donors": [[number, flags] for number, flags in donors]}
            for (level, donors) in groups
        ],
        "registrations": registrations,
    }
