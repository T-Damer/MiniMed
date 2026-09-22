"""Select useful source-local journal headings, preserving every original context block.

This is a lexical/structural intake, not clinical review. Rejected candidate identities
remain in the authoring ledger and their complete text remains in the article card.
"""

from __future__ import annotations

import copy
import re
from collections import Counter

from .definition_reference_pack import Projection, digest, encoded, number, obj, seq, text

CONTEXT_START = re.compile(
    r"^(?:достаточно|следствие|существенные различия|важнейший|сторонники|"
    r"основной методический|согласно|взаимодействие между|три основных|"
    r"таким образом|современная .+ практика|одно из|наиболее|большое значение|"
    r"у больных|клинически|одновременно|больным|детям|еще |ещё |"
    r"полоскание|большинство|следующий|нельзя|семейный врач|человек проделывает|"
    r"естественное следствие|скорее|такое течение|важное преимущество|"
    r"основные задач[аи]|новое лечебное направление|новая эра|следующим шагом|"
    r"непрямым методом|прямым методом)\b",
    re.I,
)
CLAUSE = re.compile(
    r"\b(?:является|являются|существует|существуют|нуждается|нуждаются|циркулирует|"
    r"считает|считают|считалось|имеет|имеют|регистрируется|используют|"
    r"могут|может|полагают|выделение|обусловлен|наблюдается|"
    r"происходит|происходят|отмечается|отмечаются|регулирует|регулируют|"
    r"описывается|описываются|наступила|характеризуется|характеризуются)\b",
    re.I,
)
UNQUALIFIED = {
    "абортивный", "острый", "хронический", "клинически это",
    "псевдокоронарная", "декомпенсационная", "аритмическая", "смешанная",
    "обязательные", "рекомендуемые", "факультативные",
}
GENERIC_SECTION = re.compile(
    r"^(?:(?:инвазивный |неинвазивный )?методы? исследования|"
    r"клиническая картина заболевания|"
    r"(?:перв(?:ая|ое)|втор(?:ая|ое)|треть(?:я|е)|четверт(?:ая|ое)|четвёрт(?:ая|ое))"
    r"(?: стадия| этап| группа)?)$", re.I,
)


def candidate_issue(title: str) -> str | None:
    # Bracketed original terminology is not a sentence clause and stays in the label.
    outside = re.sub(r"\([^()]*\)", "", title)
    outside = re.sub(r"^\d+(?:\.\d+)*[.)]?\s+", "", outside).strip()
    if CONTEXT_START.search(outside) or CLAUSE.search(outside):
        return "sentence-context-not-an-independent-term"
    if GENERIC_SECTION.fullmatch(outside):
        return "generic-section-without-medical-subject"
    if len(outside.split()) > 10:
        return "long-contextual-label-needs-editorial-review"
    if "," in outside and not re.search(r",\s+или\b", outside, re.I):
        return "clause-or-enumeration-not-a-single-label"
    if outside.lower() in UNQUALIFIED:
        return "contextual-subtype-without-parent-name"
    return None


def _offset(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Invalid source-label code-point offset")
    return value


def admit_article(payload: object) -> tuple[dict[str, object], dict[str, object]]:
    original = obj(payload)
    if original.get("version") != 3 or original.get("textKind") != "source-excerpt":
        raise ValueError("Journal admission expects a source-excerpt projection")
    sources = [obj(value) for value in seq(original.get("sources"), 1)]
    if len(sources) != 1 or sources[0].get("sourceType") != "specialist-journal":
        raise ValueError("Journal admission requires the original publication descriptor")
    source = sources[0]
    if (
        source.get("releaseEligible") is not False
        or source.get("license") not in {"CC-BY-4.0", "CC-BY-SA-4.0", "CC-BY-NC-SA-4.0"}
        or not source.get("publicationDate")
    ):
        raise ValueError("Journal source cannot acquire broader publication/review rights")
    projection = Projection()
    projection.add(original, digest(encoded(original)))
    terms = [obj(value) for value in seq(original.get("terms"), 5000)]
    blocks = {
        number(obj(value).get("id")): obj(value) for value in seq(original.get("blocks"), 10000)
    }
    selected: list[dict[str, object]] = []
    excluded: list[dict[str, object]] = []
    counts: Counter[str] = Counter()
    overviews = 0
    for term in terms:
        title = text(term.get("title"), 500)
        if term.get("recordRole") == "article-overview-not-independent-term":
            overviews += 1
            selected.append(term)
            counts["articleOverviews"] += 1
            continue
        evidence = obj(term.get("labelEvidence"))
        block = blocks.get(number(evidence.get("block")))
        start, end = _offset(evidence.get("start")), _offset(evidence.get("end"))
        if block is None or not start < end <= len(text(block.get("text"), 262144)):
            raise ValueError("Journal label has no in-range source span")
        if text(block.get("text"), 262144)[start:end] != title:
            raise ValueError("Journal label differs from its exact source span")
        issue = candidate_issue(title)
        if issue is not None:
            excluded.append(
                {"id": term["id"], "title": title, "reason": issue, "labelEvidence": evidence}
            )
            continue
        selected.append(term)
        coverage = term.get("coverage")
        key = {
            "explicit-definition": "definitionCandidates",
            "section-excerpt": "sectionCards",
            "criterion-list": "criterionLists",
        }.get(str(coverage))
        if key is None:
            raise ValueError("Unrecognized journal candidate coverage")
        counts[key] += 1
    if overviews != 1:
        raise ValueError("Each original article must retain one complete overview")
    admitted = copy.deepcopy(original)
    admitted["terms"] = copy.deepcopy(selected)
    if admitted["sources"] != original["sources"] or admitted["blocks"] != original["blocks"]:
        raise ValueError("Term selection modified original source content")
    validated = Projection()
    validated.add(admitted, digest(encoded(admitted)))
    counts["records"] = len(selected)
    counts["excludedCandidateLabels"] = len(excluded)
    counts["blocks"] = len(blocks)
    counts["tables"] = sum(len(seq(block.get("tables", []), 1000)) for block in blocks.values())
    extraction = obj(original.get("extraction"))
    report = {
        "version": 1,
        "counts": dict(counts),
        "excludedCandidates": excluded,
        "sourceTextUnchanged": True,
        "sourceDescriptorsUnchanged": True,
        "shortFullTextNeedsReview": number(extraction.get("bodyBlocks")) < 3,
        "boundary": (
            "Lexical/structural screening only; no clinical review or term rewriting. "
            "Rejected labels remain readable within the unchanged source article/context."
        ),
    }
    return admitted, report
