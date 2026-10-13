"""Deterministic ATC code completion for the ЕСКЛП medication modules, with provenance per code.

The ЕСКЛП registry gives every СМНН node an ``atcCode``, but ``~`` ("none") for 899 of 7 672 nodes
and a group stub (``L03AX``, ``N06BX``) instead of a substance code for another 1 404. This module
proposes the missing codes from sources that already are in the repository and decides without
guessing:

* ``instruction-text`` – the code printed in the registration's own instruction («Код АТХ: …»);
  ``instruction-text-ocr`` when the instruction was recovered by OCR (needs a second source);
* ``same-inn`` – the same normalised МНН and the same dosage-form class already carries a full
  level-5 code elsewhere in ЕСКЛП (an МНН whose codes differ by route is only filled from the same
  form class: hydrocortisone is ``H02AB09`` systemic, ``D07AA02`` skin, ``S01BA02`` eye …);
  ``same-inn-other-form`` when no donor has the form class but every ЕСКЛП donor of the МНН
  agrees on one code (the МНН is not route dependent anywhere in the registry);
* ``same-inn-instruction`` – the same МНН and form class, a code printed in another registration's
  instruction;
* ``registry-nsi`` – the Minzdrav НСИ «АТХ» dictionary (WHOCC data) names exactly this substance
  (or combination) at level 5. A name that has several codes (route dependent) is only an option
  set: it supports a code another source chose and never picks one itself.

A code is applied only when every source agrees (a longer code that starts with a shorter one
agrees: ``L03AX`` + ``L03AX13``). When sources disagree, with each other or with the registry's own
full code, nothing is changed: every candidate is kept on the node and the node is flagged. The
original registry value stays on the node (``atcOriginal``) whenever it is replaced.

Pure functions only; the I/O of the command line lives in ``scripts/build_atc_fill.py``.
"""

from __future__ import annotations

import itertools
import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, cast

FILL_VERSION = "atc-fill-1"

#: Code lengths that complete ATC levels 1-5: N, N06, N06B, N06BX, N06BX03.
LEVEL_LENGTHS = (1, 3, 4, 5, 7)
_LEVEL_PATTERNS = (
    re.compile(r"^[ABCDGHJLMNPRSV]$"),
    re.compile(r"^[ABCDGHJLMNPRSV]\d{2}$"),
    re.compile(r"^[ABCDGHJLMNPRSV]\d{2}[A-Z]$"),
    re.compile(r"^[ABCDGHJLMNPRSV]\d{2}[A-Z]{2}$"),
    re.compile(r"^[ABCDGHJLMNPRSV]\d{2}[A-Z]{2}\d{2}$"),
)
#: Cyrillic letters that look like Latin ones (ATC codes typed on a Russian keyboard, OCR).
_LOOKALIKES = str.maketrans("АВСЕНКМОРТХ", "ABCEHKMOPTX")
_DIGIT_POSITIONS = (1, 2, 5, 6)

SOURCE_INSTRUCTION = "instruction-text"
SOURCE_INSTRUCTION_OCR = "instruction-text-ocr"
SOURCE_SAME_INN = "same-inn"
SOURCE_SAME_INN_OTHER_FORM = "same-inn-other-form"
SOURCE_SAME_INN_INSTRUCTION = "same-inn-instruction"
SOURCE_NSI = "registry-nsi"
SOURCE_ESKLP = "esklp"

#: Sources that may apply a code on their own; the OCR one needs corroboration.
_SELF_SUFFICIENT = frozenset(
    {
        SOURCE_INSTRUCTION,
        SOURCE_SAME_INN,
        SOURCE_SAME_INN_OTHER_FORM,
        SOURCE_SAME_INN_INSTRUCTION,
        SOURCE_NSI,
    }
)
_SOURCE_ORDER = (
    SOURCE_ESKLP,
    SOURCE_INSTRUCTION,
    SOURCE_SAME_INN,
    SOURCE_SAME_INN_INSTRUCTION,
    SOURCE_SAME_INN_OTHER_FORM,
    SOURCE_NSI,
    SOURCE_INSTRUCTION_OCR,
)


def normalize_atc(raw: str | None) -> str | None:
    """Latin upper-case code of level 1-5, or None for ``~``, empty values and anything else."""
    if raw is None:
        return None
    stripped = re.sub(r"[\s\u00ad\u200b]+", "", raw)
    if not stripped or stripped == "~":
        return None
    chars = list(stripped.upper().translate(_LOOKALIKES))
    for index in _DIGIT_POSITIONS:
        if index < len(chars) and chars[index] == "O":
            chars[index] = "0"
    code = "".join(chars)
    return code if any(pattern.match(code) for pattern in _LEVEL_PATTERNS) else None


def atc_level(code: str | None) -> int:
    """0 for no code, otherwise the ATC level 1-5 the code completes."""
    if not code:
        return 0
    try:
        return LEVEL_LENGTHS.index(len(code)) + 1
    except ValueError:
        return 0


def codes_agree(left: str, right: str) -> bool:
    """Same code, or one is the group prefix of the other."""
    return left.startswith(right) or right.startswith(left)


# --------------------------------------------------------------------------------------------
# Instruction text
# --------------------------------------------------------------------------------------------

_MARKER = re.compile(
    r"(?<![A-Za-zА-Яа-яЁё])(?:АТХ|ATX|ATХ|АТX|ATC|АТС|АТC|ATС)(?![A-Za-zА-Яа-яЁё0-9])"
)
_LEAD = re.compile(r"[\s:\uff1a\-\u2013\u2014.()\u2116\u00ab\u00bb\"]*")
_CODE = re.compile(r"[A-ZА-Я][0-9OО]{2}(?:[A-ZА-Я]{2}(?:[0-9OО]{2})?|[A-ZА-Я])?")
_SEPARATOR = re.compile(r"\s*[,;/]\s*|\s+и\s+|\s+")
_WINDOW = 160
_MAX_CODES = 6


def _code_at(text: str, start: int) -> tuple[str, int] | None:
    match = _CODE.match(text, start)
    if not match:
        return None
    end = match.end()
    if end < len(text) and text[end] in "0123456789":
        return None
    code = normalize_atc(match.group(0))
    if code is None:
        return None
    # A short code followed by a letter is the start of a longer, malformed token or a word.
    if len(code) < 5 and end < len(text) and text[end].isalpha():
        return None
    return code, end


def parse_instruction_atc(text: str) -> list[str]:
    """Every distinct ATC code printed after an «АТХ» / «ATC» marker, in order of appearance.

    «Код АТХ: C09AA05», «АТХ: N06BX03, N06BX12», «АТХ C01EB04» and OCR/keyboard variants (Cyrillic
    look-alike letters, letter O for a zero) are read; a marker that is not followed by a code (a
    heading, the strain «ATCC 25922») yields nothing.
    """
    found: list[str] = []
    for marker in _MARKER.finditer(text):
        window_end = min(len(text), marker.end() + _WINDOW)
        lead = _LEAD.match(text, marker.end())
        position = lead.end() if lead else marker.end()
        for _ in range(_MAX_CODES):
            if position >= window_end:
                break
            parsed = _code_at(text, position)
            if parsed is None:
                break
            code, end = parsed
            if code not in found:
                found.append(code)
            separator = _SEPARATOR.match(text, end)
            if separator is None or separator.end() == end:
                break
            position = separator.end()
    return found


# --------------------------------------------------------------------------------------------
# МНН and dosage-form keys
# --------------------------------------------------------------------------------------------


def _squash(value: str) -> str:
    return re.sub(r"\s+", " ", value.casefold().replace("ё", "е")).strip()


def inn_components(inn: str) -> tuple[str, ...]:
    """Normalised components of a ЕСКЛП МНН («А+Б» → ``("а", "б")``), sorted."""
    return tuple(sorted(part for part in (_squash(p) for p in inn.split("+")) if part))


def inn_key(inn: str) -> str:
    return "+".join(inn_components(inn))


_FORM_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "injection",
        re.compile(
            r"инъекц|инфузи|лиофилизат|ампул|шприц|для\s+(?:внутривенного|внутримышечного|подкожного)"
        ),
    ),
    ("eye", re.compile(r"глазн|для\s+глаз|офтальм")),
    ("ear", re.compile(r"ушн|для\s+ушей|отиче")),
    ("nasal", re.compile(r"назальн|в\s+нос|для\s+носа|интраназальн")),
    ("inhalation", re.compile(r"ингаляц|небулайзер")),
    ("rectal", re.compile(r"суппозитор|свеч|ректальн")),
    ("vaginal", re.compile(r"вагинальн|пессари")),
    (
        "topical",
        re.compile(
            r"мазь|крем|гель|линимент|паста|пластыр|присыпк|лосьон|шампун|наружн|аэрозол|спрей"
        ),
    ),
    (
        "oral-liquid",
        re.compile(
            r"сироп|суспензи|эликсир|настойк|(?:раствор|р-р|капли)[^.;\n]*(?:внутрь|приема\s+внутрь|перорал)|капли\s+для\s+приема"
        ),
    ),
    ("oral-solid", re.compile(r"таблет|табл\.|капсул|капс\.|драже|пастилк|гранул")),
)


def form_class(dosage_form: str | None) -> str:
    """Route class of a dosage form (the first matching class; the form text itself if none)."""
    text = _squash(dosage_form or "")
    for name, pattern in _FORM_PATTERNS:
        if pattern.search(text):
            return name
    return f"form:{text}" if text else "form:"


# --------------------------------------------------------------------------------------------
# НСИ «АТХ»
# --------------------------------------------------------------------------------------------


def nsi_substance_index(rows: Iterable[Mapping[str, Any]]) -> dict[str, frozenset[str]]:
    """Normalised Russian level-5 name → every level-5 code the dictionary gives that name.

    ``rows`` are the dictionary rows as ``{ATC_CODE, ATC_NAME}`` mappings (``flatten_nsi_rows``).
    """
    index: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        code = normalize_atc(str(row.get("ATC_CODE") or ""))
        name = str(row.get("ATC_NAME") or "")
        if atc_level(code) != 5 or not name:
            continue
        index[_squash(name)].add(cast(str, code))
    return {name: frozenset(codes) for name, codes in index.items()}


def flatten_nsi_rows(raw_rows: Iterable[Sequence[Mapping[str, Any]]]) -> list[dict[str, Any]]:
    """The НСИ REST rows (a list of ``{column, value}`` cells per row) as plain mappings."""
    return [{str(cell["column"]): cell.get("value") for cell in row} for row in raw_rows]


def nsi_options(components: Sequence[str], index: Mapping[str, frozenset[str]]) -> frozenset[str]:
    """Level-5 codes the dictionary names exactly after this МНН (all component orders)."""
    if not components or len(components) > 4:
        return frozenset()
    names: set[str] = set()
    if len(components) == 1:
        names.add(components[0])
    else:
        for order in itertools.permutations(components):
            names.add(" и ".join(order))
            names.add(", ".join(order[:-1]) + " и " + order[-1])
    found: set[str] = set()
    for name in names:
        found |= index.get(name, frozenset())
    return frozenset(found)


# --------------------------------------------------------------------------------------------
# Nodes and decisions
# --------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class AtcNode:
    """One СМНН node of an ЕСКЛП МНН card."""

    document_id: str
    smnn_code: str
    module: str
    inn: str
    form: str
    original_raw: str | None
    original: str | None
    registrations: frozenset[str]

    @property
    def key(self) -> tuple[str, str]:
        return (self.document_id, self.smnn_code)

    @property
    def components(self) -> tuple[str, ...]:
        return inn_components(self.inn)

    @property
    def inn_key(self) -> str:
        return inn_key(self.inn)

    @property
    def form_class(self) -> str:
        return form_class(self.form)


def _records(value: object) -> list[Mapping[str, Any]]:
    if not isinstance(value, list):
        return []
    return [
        cast(Mapping[str, Any], item)
        for item in cast(list[object], value)
        if isinstance(item, dict)
    ]


def nodes_of_document(document_id: str, module: str, metadata: Mapping[str, Any]) -> list[AtcNode]:
    nodes: list[AtcNode] = []
    for node in _records(metadata.get("smnnNodes")):
        registrations: set[str] = set()
        for key in ("tradeNames", "klpPositions"):
            for item in _records(node.get(key)):
                registration = item.get("registrationNumber")
                if isinstance(registration, str) and registration:
                    registrations.add(registration)
        raw = node.get("atcCode")
        raw_text = raw if isinstance(raw, str) else None
        nodes.append(
            AtcNode(
                document_id=document_id,
                smnn_code=str(node.get("smnnCode") or ""),
                module=module,
                inn=str(node.get("standardizedInn") or ""),
                form=str(node.get("dosageForm") or ""),
                original_raw=raw_text,
                original=normalize_atc(raw_text),
                registrations=frozenset(registrations),
            )
        )
    return nodes


@dataclass(frozen=True)
class InstructionCodes:
    """The ATC codes one instruction document prints, and which registrations it serves."""

    document_id: str
    registrations: tuple[str, ...]
    codes: tuple[str, ...]
    ocr: bool


@dataclass
class Candidate:
    code: str
    source: str
    #: Where the code comes from (document ids, donor counts); short, JSON-safe.
    detail: dict[str, Any] = field(default_factory=dict[str, Any])


@dataclass
class Decision:
    node: AtcNode
    #: filled, refined, confirmed, unchanged, conflict, ambiguous, unconfirmed or unresolved.
    status: str
    code: str | None
    sources: list[str]
    candidates: list[Candidate]
    nsi_options: list[str]

    @property
    def changed(self) -> bool:
        return self.status in {"filled", "refined"}


@dataclass
class DonorIndex:
    """What the registry and the instructions already say about each МНН, by form class."""

    #: (inn_key, form_class) → code → donor node keys (level-5 ЕСКЛП codes only).
    esklp: dict[tuple[str, str], dict[str, set[tuple[str, str]]]]
    #: inn_key → code → donor node keys over every form class.
    esklp_by_inn: dict[str, dict[str, set[tuple[str, str]]]]
    #: (inn_key, form_class) → code → instruction document ids.
    instruction: dict[tuple[str, str], dict[str, set[str]]]


def build_donor_index(
    nodes: Sequence[AtcNode],
    registration_codes: Mapping[str, Sequence[InstructionCodes]],
) -> DonorIndex:
    esklp: dict[tuple[str, str], dict[str, set[tuple[str, str]]]] = defaultdict(
        lambda: defaultdict(set)
    )
    by_inn: dict[str, dict[str, set[tuple[str, str]]]] = defaultdict(lambda: defaultdict(set))
    instruction: dict[tuple[str, str], dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for node in nodes:
        if atc_level(node.original) == 5 and node.inn_key:
            assert node.original is not None
            esklp[(node.inn_key, node.form_class)][node.original].add(node.key)
            by_inn[node.inn_key][node.original].add(node.key)
        for registration in node.registrations:
            for doc in registration_codes.get(registration, ()):
                if doc.ocr:
                    continue
                for code in doc.codes:
                    if atc_level(code) == 5 and node.inn_key:
                        instruction[(node.inn_key, node.form_class)][code].add(doc.document_id)
    return DonorIndex(
        esklp={key: dict(value) for key, value in esklp.items()},
        esklp_by_inn={key: dict(value) for key, value in by_inn.items()},
        instruction={key: dict(value) for key, value in instruction.items()},
    )


def _candidates_for(
    node: AtcNode,
    registration_codes: Mapping[str, Sequence[InstructionCodes]],
    donors: DonorIndex,
    nsi_codes: frozenset[str],
) -> list[Candidate]:
    candidates: list[Candidate] = []
    own_docs: set[str] = set()
    for registration in sorted(node.registrations):
        for doc in registration_codes.get(registration, ()):
            if doc.document_id in own_docs:
                continue
            own_docs.add(doc.document_id)
            for code in doc.codes:
                if atc_level(code) >= 4:
                    candidates.append(
                        Candidate(
                            code,
                            SOURCE_INSTRUCTION_OCR if doc.ocr else SOURCE_INSTRUCTION,
                            {"document": doc.document_id, "registration": registration},
                        )
                    )
    if node.inn_key:
        group = (node.inn_key, node.form_class)
        for code, keys in sorted(donors.esklp.get(group, {}).items()):
            others = keys - {node.key}
            if others:
                candidates.append(Candidate(code, SOURCE_SAME_INN, {"donors": len(others)}))
        same_class_donors = {
            key for keys in donors.esklp.get(group, {}).values() for key in keys if key != node.key
        }
        # A node with its own full code gains nothing from a donor of another route.
        if not same_class_donors and atc_level(node.original) < 5:
            all_codes = {
                code
                for code, keys in donors.esklp_by_inn.get(node.inn_key, {}).items()
                if keys - {node.key}
            }
            if len(all_codes) == 1 and (not nsi_codes or all_codes <= nsi_codes):
                (code,) = all_codes
                candidates.append(
                    Candidate(code, SOURCE_SAME_INN_OTHER_FORM, {"formClasses": "other"})
                )
        for code, documents in sorted(donors.instruction.get(group, {}).items()):
            outside = documents - own_docs
            if outside:
                candidates.append(
                    Candidate(code, SOURCE_SAME_INN_INSTRUCTION, {"documents": len(outside)})
                )
    return candidates


def decide(
    node: AtcNode,
    registration_codes: Mapping[str, Sequence[InstructionCodes]],
    donors: DonorIndex,
    nsi_index: Mapping[str, frozenset[str]],
) -> Decision:
    """The outcome for one node; see the module docstring for the rules."""
    nsi_codes: frozenset[str] = (
        nsi_options(node.components, nsi_index) if node.inn_key else frozenset[str]()
    )
    candidates = _candidates_for(node, registration_codes, donors, nsi_codes)
    singles: list[Candidate] = list(candidates)
    if node.original and atc_level(node.original) >= 1:
        singles.append(Candidate(node.original, SOURCE_ESKLP, {}))
    options = sorted(nsi_codes)

    maximal = sorted(
        {
            c.code
            for c in singles
            if not any(o.code != c.code and o.code.startswith(c.code) for o in singles)
        }
    )
    if not maximal:
        if len(options) == 1:
            nsi_candidate = Candidate(options[0], SOURCE_NSI, {"name": node.inn})
            return _outcome(node, options[0], [nsi_candidate], [nsi_candidate], options)
        status = "ambiguous" if options else "unresolved"
        return Decision(node, status, None, [], [], options)
    if len(maximal) > 1:
        return Decision(node, "conflict", None, [], singles, options)
    code = maximal[0]
    supporting = [c for c in singles if codes_agree(c.code, code)]
    if options:
        # The dictionary names the substance: it must lead to the code (or extend a group code).
        compatible = [option for option in options if option.startswith(code)]
        if not compatible:
            return Decision(node, "conflict", None, [], singles, options)
        if code in compatible:
            supporting.append(Candidate(code, SOURCE_NSI, {"name": node.inn}))
        elif len(compatible) == 1:
            code = compatible[0]
            supporting.append(Candidate(code, SOURCE_NSI, {"name": node.inn}))
        else:
            return Decision(node, "ambiguous", None, [], singles, compatible)
    return _outcome(node, code, supporting, singles, options)


def _outcome(
    node: AtcNode,
    code: str,
    supporting: Sequence[Candidate],
    candidates: Sequence[Candidate],
    options: Sequence[str],
) -> Decision:
    sources = sorted({c.source for c in supporting}, key=_SOURCE_ORDER.index)
    original = node.original
    if original == code:
        return Decision(
            node,
            "confirmed" if len(sources) > 1 else "unchanged",
            code,
            sources,
            list(candidates),
            list(options),
        )
    new_sources = [s for s in sources if s != SOURCE_ESKLP]
    if not any(s in _SELF_SUFFICIENT for s in new_sources):
        return Decision(node, "unconfirmed", None, new_sources, list(candidates), list(options))
    status = "refined" if original else "filled"
    return Decision(node, status, code, new_sources, list(candidates), list(options))


def decide_all(
    nodes: Sequence[AtcNode],
    instructions: Sequence[InstructionCodes],
    nsi_index: Mapping[str, frozenset[str]],
) -> list[Decision]:
    registration_codes: dict[str, list[InstructionCodes]] = defaultdict(list)
    for doc in instructions:
        for registration in doc.registrations:
            registration_codes[registration].append(doc)
    donors = build_donor_index(nodes, registration_codes)
    return [decide(node, registration_codes, donors, nsi_index) for node in nodes]


# --------------------------------------------------------------------------------------------
# Metadata patch
# --------------------------------------------------------------------------------------------


def final_code(decision: Decision) -> str | None:
    """The code the node carries after the fill (the original when nothing changed)."""
    return decision.code if decision.changed else decision.node.original


def patch_metadata(
    metadata: Mapping[str, Any], decisions: Mapping[tuple[str, str], Decision], document_id: str
) -> tuple[dict[str, Any], int]:
    """A copy of one card's metadata with the filled codes and provenance; (copy, changed nodes)."""
    patched = cast(dict[str, Any], _deep_copy(metadata))
    changed = 0
    flagged = 0
    code_sources: dict[str, list[str]] = {}
    for node in _records(patched.get("smnnNodes")):
        decision = decisions.get((document_id, str(node.get("smnnCode") or "")))
        mutable = cast(dict[str, Any], node)
        if decision is None:
            continue
        if decision.changed and decision.code:
            mutable["atcOriginal"] = decision.node.original_raw
            mutable["atcCode"] = decision.code
            mutable["atcSource"] = decision.sources[0]
            mutable["atcSources"] = decision.sources
            code_sources.setdefault(decision.code, []).extend(decision.sources)
            changed += 1
        elif decision.status in {"conflict", "ambiguous", "unconfirmed"}:
            mutable["atcFlag"] = decision.status
            mutable["atcCandidates"] = _candidate_summary(decision)
            flagged += 1
    if changed:
        codes: list[str] = []
        for node in _records(patched.get("smnnNodes")):
            raw = node.get("atcCode")
            if isinstance(raw, str) and raw not in codes:
                codes.append(raw)
        patched["atcCodes"] = codes
    if changed or flagged:
        patched["atcFill"] = {
            "version": FILL_VERSION,
            "filledNodes": changed,
            "flaggedNodes": flagged,
            "codeSources": {code: sorted(set(sources)) for code, sources in code_sources.items()},
        }
    return patched, changed


def _candidate_summary(decision: Decision) -> list[dict[str, Any]]:
    by_code: dict[str, set[str]] = defaultdict(set)
    for candidate in decision.candidates:
        by_code[candidate.code].add(candidate.source)
    for option in decision.nsi_options:
        by_code[option].add(SOURCE_NSI)
    return [
        {"code": code, "sources": sorted(sources, key=_SOURCE_ORDER.index)}
        for code, sources in sorted(by_code.items())
    ]


def _deep_copy(value: object) -> object:
    if isinstance(value, dict):
        return {key: _deep_copy(item) for key, item in cast(dict[str, object], value).items()}
    if isinstance(value, list):
        return [_deep_copy(item) for item in cast(list[object], value)]
    return value


# --------------------------------------------------------------------------------------------
# Coverage
# --------------------------------------------------------------------------------------------


def best_level(levels: Iterable[int]) -> int:
    return max(levels, default=0)


def coverage_row(levels: Sequence[int]) -> dict[str, Any]:
    """Share of records with any code, a group-level (4-5) code and a full level-5 code."""
    total = len(levels)
    counts = Counter(levels)
    any_code = sum(count for level, count in counts.items() if level >= 1)
    group = sum(count for level, count in counts.items() if level >= 4)
    full = counts.get(5, 0)

    def share(value: int) -> float:
        return round(100 * value / total, 1) if total else 0.0

    return {
        "total": total,
        "anyCode": any_code,
        "anyCodePct": share(any_code),
        "levelAtLeast4": group,
        "levelAtLeast4Pct": share(group),
        "level5": full,
        "level5Pct": share(full),
        "levels": {str(level): counts.get(level, 0) for level in range(6)},
    }
