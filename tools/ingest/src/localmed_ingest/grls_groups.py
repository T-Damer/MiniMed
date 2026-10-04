"""Real-difference grouping of GRLS registrations: one text per INN + dosage-form class.

A doctor gains nothing from forty ibuprofen tablet generics, so the collection queue is built from
groups of active registrations that share a normalized INN and a dosage-form class, and each group
that has no instruction text yet gets ONE representative registration. Everything here is pure
(no I/O) so it can be tested; the collector supplies the registry records, the plan and the state.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

FormClass = Literal[
    "parenteral",
    "oral-solid",
    "oral-liquid",
    "topical",
    "eye",
    "ear",
    "nasal",
    "inhalation",
    "rectal",
    "vaginal",
    "transdermal",
    "dialysis",
    "implant",
    "dental",
    "herbal",
    "substance",
    "other",
]

DocumentKind = Literal["ohlp", "leaflet", "national-instruction", "unknown"]

_NO_INN = {"", "~", "-", "—"}

# Words that decide the route of administration, checked in this order.
_PARENTERAL = (
    "для инъекц",
    "для инфуз",
    "внутривенн",
    "внутримышечн",
    "подкожн",
    "внутрикожн",
    "внутриартериальн",
    "внутрисуставн",
    "внутрибрюшинн",
    "внутриплевральн",
    "внутриполостн",
    "внутрипузырн",
    "интравитреальн",
    "интратекальн",
    "эпидуральн",
    "субконъюнктивальн",
    "парентеральн",
    "внутриглазн",
    "внутрикостн",
    "эндотрахеальн",
    "интратрахеальн",
    "внутрицервикальн",
    "околосуставн",
    "периартикулярн",
    "инъекц",
    "инфузи",
)
_ORAL_LIQUID_NOUNS = (
    "раствор",
    "суспенз",
    "сироп",
    "капли",
    "эмульс",
    "эликсир",
    "настойк",
    "порошок",
    "гранул",
    "экстракт",
    "концентрат",
    "паста",
    "гель",
)
_ORAL_SOLID = (
    "таблет",
    "капсул",
    "драже",
    "пастил",
    "леденц",
    "гранул",
    "порошок",
    "пилюл",
    "сбор",
    "брикет",
    "облатк",
    "жевательн",
)
_HERBAL = (
    "измельчен",
    "цельн",
    "трава",
    "листья",
    "лист ",
    "плоды",
    "цветки",
    "корни",
    "корневищ",
    "кора",
    "семена",
    "почки",
    "побеги",
    "слоевищ",
    "чага",
    "столбики",
    "резано-прессован",
)
_DOSAGE_NOUNS = ("таблет", "капсул", "раствор", "суспенз", "сироп", "мазь", "капли", "драже")
_TOPICAL = (
    "наружн",
    "местного",
    "мазь",
    "крем",
    "гель",
    "линимент",
    "паста",
    "пластырь",
    "лосьон",
    "присыпка",
    "для полоскания",
    "для обработки",
    "для кожи",
    "для втирания",
    "шампунь",
    "пена",
    "лак ",
    "салфетк",
    "для накожного",
    "накожн",
)


def _normalize_text(value: str | None) -> str:
    return " ".join((value or "").casefold().replace("ё", "е").split())


def normalize_inn(value: str | None) -> str | None:
    """Casefolded INN with the components of a combination sorted; ``None`` when there is none."""
    text = _normalize_text(value)
    if text in _NO_INN:
        return None
    parts = [part.strip(" ,;.") for part in re.split(r"[+;]| и | / ", text)]
    parts = [part for part in parts if part and part not in _NO_INN]
    if not parts:
        return None
    return "+".join(sorted(set(parts)))


def dosage_form_class(form: str | None) -> FormClass:
    """Classify a registry dosage form by route of administration (coarse by design)."""
    text = _normalize_text(form)
    if not text:
        return "other"
    # Routes that name the organ come before the generic nouns they share with oral forms.
    if text.startswith(("субстанция", "полуфабрикат")):
        return "substance"
    if any(word in text for word in _HERBAL) and not any(noun in text for noun in _DOSAGE_NOUNS):
        return "herbal"
    if "диализ" in text:
        return "dialysis"
    if "внутриматочн" in text:
        return "implant"
    if "интестинальн" in text:
        return "oral-liquid"
    if "спрей" in text and any(word in text for word in ("подъязычн", "защечн", "полости рта")):
        return "oral-liquid"
    if "имплантат" in text or "имплант" in text:
        return "implant"
    if "трансдермальн" in text or ("пластырь" in text and "трансдерм" in text):
        return "transdermal"
    if "глазн" in text or "для глаз" in text:
        # «раствор для интравитреального введения» is an injection, not an eye drop.
        if any(word in text for word in ("интравитреальн", "субконъюнктивальн", "инъекц")):
            return "parenteral"
        return "eye"
    if "ушн" in text or "в ухо" in text:
        return "ear"
    if "назальн" in text or "в нос" in text or "интраназальн" in text:
        return "nasal"
    if "ингаляц" in text or "аэрозоль" in text or "газ " in f"{text} " or text.startswith("газ"):
        return "inhalation"
    if "вагинальн" in text or "влагалищн" in text:
        return "vaginal"
    if "ректальн" in text or "суппозитор" in text or "клизм" in text:
        return "rectal"
    if "стоматолог" in text or "десневой" in text or "зубн" in text:
        return "dental"
    # Reconstituted forms are named after the injection they become.
    if any(word in text for word in _PARENTERAL):
        return "parenteral"
    reconstituted = "лиофилизат" in text or (
        "порошок" in text and "для приготовления раствора" in text
    )
    if reconstituted and not any(word in text for word in ("внутрь", "приема", "наружн")):
        # «лиофилизат» / «порошок для приготовления раствора» without an oral route is an injection.
        return "parenteral"
    if "для приема внутрь" in text or "внутрь" in text or "пероральн" in text:
        if any(noun in text for noun in _ORAL_LIQUID_NOUNS) and not any(
            solid in text for solid in ("таблет", "капсул", "драже")
        ):
            return "oral-liquid"
        return "oral-solid"
    if any(word in text for word in _TOPICAL):
        return "topical"
    if any(word in text for word in ("таблет", "капсул", "драже", "пастил", "леденц")):
        return "oral-solid"
    if any(word in text for word in ("сироп", "эликсир", "настойк", "капли", "суспенз", "эмульс")):
        return "oral-liquid"
    if any(word in text for word in ("гранул", "порошок", "сбор", "брикет")):
        return "oral-solid"
    if "раствор" in text or "концентрат" in text:
        return "other"
    return "other"


_OHLP = re.compile(r"общая\s+характеристика\s+лекарственного\s+препарата|\bохлп\b")
_LEAFLET = re.compile(r"листок[\s-]*вкладыш")
_NATIONAL = re.compile(r"инструкци[яи]\s+(?:по\s+)?(?:медицинскому\s+)?применени")
_MARKUP = re.compile(r"<!--.*?-->|[#*_|]+", re.DOTALL)


def classify_document_kind(text: str | None) -> DocumentKind:
    """Kind of an instruction document from the start of its text (title page).

    ОХЛП is the EAEU summary of product characteristics; the листок-вкладыш is the patient
    leaflet; anything titled «инструкция по (медицинскому) применению» is a national instruction.
    """
    head = _normalize_text(_MARKUP.sub(" ", (text or "")[:12000]))[:4000]
    if not head:
        return "unknown"
    candidates: list[tuple[int, DocumentKind]] = []
    for pattern, kind in (
        (_OHLP, "ohlp"),
        (_LEAFLET, "leaflet"),
        (_NATIONAL, "national-instruction"),
    ):
        match = pattern.search(head)
        if match:
            candidates.append((match.start(), kind))  # type: ignore[arg-type]
    if not candidates:
        return "unknown"
    return min(candidates, key=lambda item: item[0])[1]


def _registration_date(value: object) -> date:
    if isinstance(value, str):
        match = re.fullmatch(r"(\d{2})\.(\d{2})\.(\d{4})", value.strip())
        if match:
            try:
                return date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
            except ValueError:
                return date.max
    return date.max


def _is_foreign_holder(record: Mapping[str, object]) -> bool:
    country = _normalize_text(str(record.get("holderCountry") or ""))
    return bool(country) and country not in {"россия", "российская федерация", "рф"}


def record_form_class(record: Mapping[str, object]) -> FormClass:
    """Form class of a registry record; falls back to the first release-form clause."""
    form_class = dosage_form_class(str(record.get("dosageForm") or ""))
    if form_class != "other":
        return form_class
    release = str(record.get("releaseForms") or "")
    first_clause = release.split(",", 1)[0] if release else ""
    return dosage_form_class(first_clause) if first_clause else form_class


def is_active_record(record: Mapping[str, object]) -> bool:
    status = _normalize_text(str(record.get("status") or ""))
    return "действ" in status or "еаэс" in status


@dataclass(frozen=True)
class GroupKey:
    inn: str | None
    form_class: FormClass
    trade_name: str | None = None  # only for the INN-less tail

    def label(self) -> str:
        return f"{self.inn or ('~' + str(self.trade_name))}|{self.form_class}"


@dataclass
class Group:
    key: GroupKey
    members: list[str] = field(default_factory=lambda: list[str]())
    essential: bool = False


@dataclass(frozen=True)
class GroupPick:
    key: GroupKey
    registration_number: str
    group_size: int
    essential: bool
    reason: Literal["uncovered", "ohlp-second-pass"]


@dataclass(frozen=True)
class GroupStats:
    groups_total: int
    groups_covered: int
    essential_groups_total: int
    essential_groups_covered: int
    inn_less_groups_total: int
    inn_less_groups_covered: int
    unreachable_groups: int
    queue_first_pass: int
    queue_second_pass: int
    leaflet_only_groups: int
    groups_with_ohlp: int


def build_groups(records: Collection[Mapping[str, object]]) -> dict[GroupKey, Group]:
    """Group active, non-substance registrations by normalized INN and dosage-form class."""
    groups: dict[GroupKey, Group] = {}
    for record in records:
        number = record.get("registrationNumber")
        if not isinstance(number, str) or number.startswith("ФС-") or not is_active_record(record):
            continue
        form_class = record_form_class(record)
        if form_class == "substance":
            continue
        inn = normalize_inn(str(record.get("inn") or ""))
        trade = _normalize_text(str(record.get("tradeName") or "")) or number
        key = GroupKey(inn, form_class, None if inn else trade)
        group = groups.setdefault(key, Group(key))
        group.members.append(number)
        if record.get("essentialDrug") == "Да":
            group.essential = True
    return groups


def build_group_queue(
    records: Collection[Mapping[str, object]],
    plan_numbers: Collection[str],
    covered_numbers: Collection[str],
    permanent_failures: Mapping[str, int],
    *,
    document_kinds: Mapping[str, Collection[DocumentKind]] | None = None,
    revisit_candidates: Collection[str] = (),
    plan_alias: Mapping[str, str] | None = None,
    max_permanent_failures: int = 2,
) -> tuple[list[GroupPick], GroupStats]:
    """One representative per uncovered group, then ОХЛП revisits for leaflet-only groups.

    ``plan_numbers``: registrations the interactive search can resolve (eligible plan items).
    ``covered_numbers``: registrations whose instruction text we already hold (including the
    registrations an EAEU canonical item answers for). ``permanent_failures``: attempts of
    «the site did not find it / no PDF» per registration. ``revisit_candidates``: covered plan
    registrations whose card was never read in all-documents mode. ``plan_alias`` maps a
    registration that is only *requested* by a canonical plan item (EAEU numbers) to that item.
    """
    by_number = {
        str(record["registrationNumber"]): record
        for record in records
        if isinstance(record.get("registrationNumber"), str)
    }
    groups = build_groups(records)
    plan = set(plan_numbers)
    alias = dict(plan_alias or {})
    covered = set(covered_numbers)
    revisit = set(revisit_candidates)
    kinds = document_kinds or {}

    first_pass: list[tuple[tuple[object, ...], GroupPick]] = []
    second_pass: list[tuple[tuple[object, ...], GroupPick]] = []
    covered_groups = essential_total = essential_covered = 0
    tail_total = tail_covered = unreachable = leaflet_only = with_ohlp = 0
    for group in groups.values():
        key = group.key
        tail = key.inn is None
        is_covered = any(member in covered for member in group.members)
        if group.essential:
            essential_total += 1
        if tail:
            tail_total += 1
        if is_covered:
            covered_groups += 1
            essential_covered += 1 if group.essential else 0
            tail_covered += 1 if tail else 0
        size = len(group.members)
        sort_key = (tail, not group.essential, -size, key.label())
        if not is_covered:
            reachable: dict[str, str] = {}
            for member in group.members:
                target = member if member in plan else alias.get(member)
                if (
                    target is not None
                    and permanent_failures.get(target, 0) < max_permanent_failures
                ):
                    reachable[member] = target
            if not reachable:
                unreachable += 1
                continue
            best = min(
                reachable,
                key=lambda member: (
                    permanent_failures.get(reachable[member], 0),
                    not _is_foreign_holder(by_number[member]),
                    _registration_date(by_number[member].get("registrationDate")),
                    member,
                ),
            )
            first_pass.append(
                (
                    sort_key,
                    GroupPick(key, reachable[best], size, group.essential, "uncovered"),
                )
            )
            continue
        member_kinds: set[DocumentKind] = set()
        for member in group.members:
            member_kinds.update(kinds.get(member, ()))
        if "ohlp" in member_kinds:
            with_ohlp += 1
        elif member_kinds == {"leaflet"}:
            leaflet_only += 1
            options = sorted(
                member
                for member in group.members
                if member in revisit and member in plan and kinds.get(member)
            )
            if options:
                second_pass.append(
                    (
                        sort_key,
                        GroupPick(key, options[0], size, group.essential, "ohlp-second-pass"),
                    )
                )
    first_pass.sort(key=lambda item: item[0])
    second_pass.sort(key=lambda item: item[0])
    stats = GroupStats(
        groups_total=len(groups),
        groups_covered=covered_groups,
        essential_groups_total=essential_total,
        essential_groups_covered=essential_covered,
        inn_less_groups_total=tail_total,
        inn_less_groups_covered=tail_covered,
        unreachable_groups=unreachable,
        queue_first_pass=len(first_pass),
        queue_second_pass=len(second_pass),
        leaflet_only_groups=leaflet_only,
        groups_with_ohlp=with_ohlp,
    )
    return [pick for _, pick in first_pass + second_pass], stats


def group_index_by_number(records: Collection[Mapping[str, object]]) -> dict[str, GroupKey]:
    index: dict[str, GroupKey] = defaultdict(lambda: GroupKey(None, "other"))
    for key, group in build_groups(records).items():
        for member in group.members:
            index[member] = key
    return dict(index)
