from __future__ import annotations

import re
from collections import Counter
from typing import Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field

DecisionKind = Literal[
    "urgency-routing",
    "diagnosis-cause",
    "diagnostic-confirmation",
    "test-selection",
    "result-interpretation",
    "treatment-selection",
    "treatment-adjustment",
    "dosing-calculation",
    "medication-safety",
    "monitoring-follow-up",
    "prevention",
    "prognosis",
    "administrative",
    "education-reference",
    "unknown",
]
QueryComplexity = Literal["brief-reference", "focused-clinical", "long-case"]
AnnotationMethod = Literal["rule-based-en-v1"]


class ClinicalQueryAnnotation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    primary_decision: DecisionKind
    secondary_decisions: list[DecisionKind]
    confidence: float = Field(ge=0, le=1)
    matched_signals: list[str]
    method: AnnotationMethod = "rule-based-en-v1"
    needs_review: bool
    complexity: QueryComplexity
    patient_context_signals: list[str]
    word_count: int = Field(ge=1)
    clause_count: int = Field(ge=1)


class _SignalRule(NamedTuple):
    label: str
    pattern: re.Pattern[str]
    weight: int


def _rule(label: str, pattern: str, weight: int = 1) -> _SignalRule:
    return _SignalRule(label, re.compile(pattern, re.IGNORECASE), weight)


_PATIENT_RULES: tuple[_SignalRule, ...] = (
    _rule(
        "patient-noun",
        r"\b(?:patient|man|woman|male|female|boy|girl|child|infant|newborn|adolescent)\b",
        2,
    ),
    _rule("patient-reference", r"\b(?:this|my|our) patient\b", 3),
    _rule("age", r"\b\d{1,3}[ -]?(?:year|month|day)s?[ -]?(?:old)?\b", 3),
    _rule("weight", r"\b(?:weigh(?:s|ing)?|weight|\d+(?:\.\d+)?\s?(?:kg|lb))\b", 2),
    _rule(
        "clinical-presentation",
        r"\b(?:presents?|presented|history of|complains? of|was diagnosed|is taking|currently on)\b",
        2,
    ),
)

_DECISION_RULES: dict[DecisionKind, tuple[_SignalRule, ...]] = {
    "urgency-routing": (
        _rule("emergency", r"\b(?:emergency|emergent|urgent|immediately|red flag)s?\b", 3),
        _rule("admission", r"\b(?:admit|admission|hospitali[sz]e|inpatient|disposition)\b", 3),
        _rule("referral", r"\b(?:refer|referral|consult|specialist)\b", 2),
    ),
    "diagnosis-cause": (
        _rule("differential", r"\b(?:differential diagnosis|differential|etiolog(?:y|ies))\b", 3),
        _rule("cause", r"\b(?:cause of|causes of|causing|why does|why is)\b", 2),
        _rule("possible-diagnosis", r"\b(?:possible|likely|most likely) diagnos(?:is|es)\b", 3),
        _rule("what-could", r"\bwhat (?:could|might|may) (?:cause|be)\b", 2),
    ),
    "diagnostic-confirmation": (
        _rule("confirm", r"\b(?:confirm|confirmation|confirmed)\b", 2),
        _rule("criteria", r"\bdiagnostic criteria\b", 3),
        _rule("rule-out", r"\b(?:rule out|exclude|distinguish|differentiate)\b", 2),
        _rule("diagnose", r"\bhow (?:is|do you) diagnos(?:e|ed)\b", 2),
    ),
    "test-selection": (
        _rule("next-test", r"\b(?:next|best|appropriate|initial|first) (?:test|study|imaging)\b", 3),
        _rule("what-test", r"\bwhat (?:test|tests|study|studies|imaging|workup)\b", 3),
        _rule("order-test", r"\b(?:order|obtain|perform) (?:a |an )?(?:test|panel|scan|mri|ct|ultrasound)\b", 2),
        _rule("workup", r"\b(?:workup|evaluation|investigation)s?\b", 1),
    ),
    "result-interpretation": (
        _rule("interpret", r"\b(?:interpret|interpretation|meaning|significance)\b", 3),
        _rule("abnormal-result", r"\b(?:elevated|decreased|low|high|abnormal|positive|negative) (?:level|result|value|test)\b", 2),
        _rule("result-artifact", r"\b(?:ecg|ekg|eeg|mri|ct|x-ray|radiograph|pathology|biopsy|lab result)s?\b", 1),
    ),
    "treatment-selection": (
        _rule("treatment", r"\b(?:treat|treatment|therapy|management|manage)\b", 2),
        _rule("first-line", r"\b(?:first-line|second-line|preferred|best) (?:drug|medication|therapy|treatment)\b", 3),
        _rule("prescribe", r"\b(?:prescribe|start|initiate)\b", 1),
    ),
    "treatment-adjustment": (
        _rule("nonresponse", r"\b(?:not responding|no response|failed|failure|refractory|persistent despite)\b", 3),
        _rule("change-treatment", r"\b(?:switch|change|adjust|escalate|de-escalate|taper|discontinue|stop|continue)\b", 2),
        _rule("next-line", r"\b(?:next-line|third-line|salvage therapy)\b", 3),
    ),
    "dosing-calculation": (
        _rule("dose", r"\b(?:dose|dosage|dosing|how much)\b", 3),
        _rule("weight-dose", r"\b(?:mg|mcg|g)/(?:kg|m2)|weight-based\b", 3),
        _rule("frequency", r"\b(?:frequency|how often|times daily|every \d+ hours)\b", 2),
        _rule("dose-adjustment", r"\b(?:renal|hepatic) dose adjustment\b", 3),
    ),
    "medication-safety": (
        _rule("interaction", r"\b(?:interaction|interact|combine|combination|coadminister)\b", 3),
        _rule("contraindication", r"\b(?:contraindicat|avoid|unsafe|safe to use)\w*\b", 3),
        _rule("adverse-effect", r"\b(?:adverse effect|side effect|toxicity|toxic|allerg)\w*\b", 2),
        _rule("special-population", r"\b(?:pregnan|breastfeed|lactat)\w*\b", 2),
    ),
    "monitoring-follow-up": (
        _rule("monitor", r"\b(?:monitor|monitoring|surveillance)\b", 3),
        _rule("follow-up", r"\b(?:follow-up|follow up|recheck|repeat|return visit)\b", 2),
        _rule("when-repeat", r"\bwhen (?:should|to) (?:repeat|reassess|re-evaluate)\b", 3),
    ),
    "prevention": (
        _rule("prevent", r"\b(?:prevent|prevention|prophylaxis|prophylactic)\b", 3),
        _rule("vaccine", r"\b(?:vaccine|vaccination|immuni[sz]ation)\b", 3),
        _rule("screening", r"\b(?:screen|screening)\b", 2),
    ),
    "prognosis": (
        _rule("prognosis", r"\b(?:prognosis|prognostic|outcome|survival|mortality)\b", 3),
        _rule("recurrence", r"\b(?:recurrence|relapse|risk of developing|long-term risk)\b", 2),
    ),
    "administrative": (
        _rule("coverage", r"\b(?:insurance|coverage|authorization|reimbursement)\b", 3),
        _rule("disability", r"\b(?:disability|work restriction|fitness for duty|military service)\b", 3),
        _rule("legal", r"\b(?:legal|regulation|regulatory|reportable|documentation requirement)\b", 2),
    ),
    "education-reference": (
        _rule("definition", r"\b(?:define|definition|what is|overview of)\b", 2),
        _rule("mechanism", r"\b(?:mechanism|pathophysiology|physiology)\b", 2),
        _rule("epidemiology", r"\b(?:incidence|prevalence|epidemiology)\b", 2),
        _rule("guideline", r"\b(?:guideline|recommendation|standard of care)\b", 1),
    ),
}

_DECISION_PRIORITY: tuple[DecisionKind, ...] = (
    "urgency-routing",
    "dosing-calculation",
    "medication-safety",
    "treatment-adjustment",
    "result-interpretation",
    "test-selection",
    "diagnostic-confirmation",
    "diagnosis-cause",
    "monitoring-follow-up",
    "prevention",
    "prognosis",
    "administrative",
    "treatment-selection",
    "education-reference",
)

_WORD = re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?")
_CLAUSE_BOUNDARY = re.compile(r"[?;:]|\.(?:\s|$)|,(?:\s+(?:and|but|with|while|after|before)\b)", re.IGNORECASE)


def _matched_rules(text: str, rules: tuple[_SignalRule, ...]) -> tuple[int, list[str]]:
    score = 0
    labels: list[str] = []
    for rule in rules:
        if rule.pattern.search(text):
            score += rule.weight
            labels.append(rule.label)
    return score, labels


def _patient_signals(text: str) -> list[str]:
    return [rule.label for rule in _PATIENT_RULES if rule.pattern.search(text)]


def _complexity(
    text: str,
    word_count: int,
    clause_count: int,
    patient_specific: bool,
    decision_count: int,
) -> QueryComplexity:
    if len(text) >= 500 or word_count >= 90 or (patient_specific and clause_count >= 6):
        return "long-case"
    if patient_specific or word_count >= 20 or clause_count >= 3 or decision_count >= 2:
        return "focused-clinical"
    return "brief-reference"


def annotate_clinical_query(text: str) -> ClinicalQueryAnnotation:
    normalized = " ".join(text.split())
    if not normalized:
        raise ValueError("Clinical query cannot be blank.")

    scores: Counter[DecisionKind] = Counter()
    signals_by_decision: dict[DecisionKind, list[str]] = {}
    for decision, rules in _DECISION_RULES.items():
        score, labels = _matched_rules(normalized, rules)
        if score > 0:
            scores[decision] = score
            signals_by_decision[decision] = labels

    priority_index = {decision: index for index, decision in enumerate(_DECISION_PRIORITY)}
    ranked = sorted(
        scores,
        key=lambda decision: (-scores[decision], priority_index.get(decision, len(priority_index))),
    )
    if not ranked:
        primary: DecisionKind = "unknown"
        secondary: list[DecisionKind] = []
        matched_signals: list[str] = []
        confidence = 0.2
    else:
        primary = ranked[0]
        top_score = scores[primary]
        secondary = [
            decision
            for decision in ranked[1:]
            if scores[decision] >= max(2, top_score - 1)
        ][:3]
        matched_signals = [
            f"{decision}:{label}"
            for decision in [primary, *secondary]
            for label in signals_by_decision[decision]
        ]
        second_score = scores[ranked[1]] if len(ranked) > 1 else 0
        margin = top_score - second_score
        confidence = min(0.96, 0.45 + top_score * 0.08 + margin * 0.05)

    patient_signals = _patient_signals(normalized)
    word_count = len(_WORD.findall(normalized))
    clause_count = max(1, len(_CLAUSE_BOUNDARY.findall(normalized)) + 1)
    complexity = _complexity(
        normalized,
        word_count,
        clause_count,
        bool(patient_signals),
        len(ranked),
    )
    needs_review = primary == "unknown" or confidence < 0.65 or len(secondary) >= 2

    return ClinicalQueryAnnotation(
        primary_decision=primary,
        secondary_decisions=secondary,
        confidence=round(confidence, 3),
        matched_signals=matched_signals,
        needs_review=needs_review,
        complexity=complexity,
        patient_context_signals=patient_signals,
        word_count=word_count,
        clause_count=clause_count,
    )
