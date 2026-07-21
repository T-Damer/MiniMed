from __future__ import annotations

import re
from collections import Counter
from typing import Literal, NamedTuple, TypeAlias

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
QueryLanguage = Literal["ru", "en", "mixed", "unknown"]
AnnotationMethod = Literal["rule-based-ru-first-v1"]


class ClinicalQueryAnnotation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    primary_decision: DecisionKind
    secondary_decisions: list[DecisionKind]
    confidence: float = Field(ge=0, le=1)
    matched_signals: list[str]
    method: AnnotationMethod = "rule-based-ru-first-v1"
    detected_language: QueryLanguage
    needs_review: bool
    complexity: QueryComplexity
    patient_context_signals: list[str]
    word_count: int = Field(ge=1)
    clause_count: int = Field(ge=1)


class _SignalRule(NamedTuple):
    label: str
    pattern: re.Pattern[str]
    weight: int


RuleSpec: TypeAlias = tuple[str, str, int]
RuleMap: TypeAlias = dict[DecisionKind, tuple[_SignalRule, ...]]
Profile: TypeAlias = tuple[str, RuleMap, tuple[_SignalRule, ...]]


def _compile_rules(specs: dict[DecisionKind, tuple[RuleSpec, ...]]) -> RuleMap:
    return {
        decision: tuple(
            _SignalRule(label, re.compile(pattern, re.IGNORECASE), weight)
            for label, pattern, weight in rules
        )
        for decision, rules in specs.items()
    }


def _compile_patient_rules(specs: tuple[RuleSpec, ...]) -> tuple[_SignalRule, ...]:
    return tuple(
        _SignalRule(label, re.compile(pattern, re.IGNORECASE), weight)
        for label, pattern, weight in specs
    )


_RU_PATIENT_RULES = _compile_patient_rules(
    (
        (
            "patient-noun",
            r"\b(?:пациент|пациентка|мужчин|женщин|мальчик|девочк|"
            r"реб[её]н|младен|новорожд[её]нн|подрост)\w*\b",
            2,
        ),
        ("patient-reference", r"\b(?:этот|данный|мой|наш)\s+пациент\w*\b", 3),
        (
            "age",
            r"\b\d{1,3}\s*(?:лет|года?|месяц(?:а|ев)?|дн(?:я|ей)|недел(?:я|и|ь))\b",
            3,
        ),
        ("weight", r"\b(?:вес|масса|весит|\d+(?:[.,]\d+)?\s*(?:кг|г))\b", 2),
        (
            "clinical-presentation",
            r"\b(?:жалуется|обратил(?:ся|ась)|поступил[аи]?|болеет|анамнез|"
            r"получает|принимает|назначен[аоы]?)\b",
            2,
        ),
    )
)

_EN_PATIENT_RULES = _compile_patient_rules(
    (
        (
            "patient-noun",
            r"\b(?:patient|man|woman|male|female|boy|girl|child|infant|newborn|adolescent)\b",
            2,
        ),
        ("patient-reference", r"\b(?:this|my|our) patient\b", 3),
        ("age", r"\b\d{1,3}[ -]?(?:year|month|day)s?[ -]?(?:old)?\b", 3),
        ("weight", r"\b(?:weigh(?:s|ing)?|weight|\d+(?:\.\d+)?\s?(?:kg|lb))\b", 2),
        (
            "clinical-presentation",
            r"\b(?:presents?|presented|history of|complains? of|was diagnosed|"
            r"is taking|currently on)\b",
            2,
        ),
    )
)

_RU_RULES = _compile_rules(
    {
        "urgency-routing": (
            (
                "emergency",
                r"\b(?:срочн|неотложн|экстренн|немедленн|красн\w*\s+флаг)\w*\b",
                3,
            ),
            ("admission", r"\b(?:госпитал|стационар|при[её]мн\w*\s+отделен)\w*\b", 3),
            (
                "referral",
                r"\b(?:куда\s+направ|направ|маршрутиз|консультац|специалист)\w*\b",
                2,
            ),
        ),
        "diagnosis-cause": (
            ("differential", r"\b(?:дифференциальн\w*\s+диагноз|этиолог)\w*\b", 3),
            ("cause", r"\b(?:причин|чем\s+обусловлен|почему|что\s+вызвал)\w*\b", 2),
            (
                "possible",
                r"\b(?:вероятн|возможн|наиболее\s+вероятн)\w*\s+диагноз\w*\b",
                3,
            ),
            (
                "what-could",
                r"\b(?:что\s+это\s+может\s+быть|что\s+может\s+вызывать)\b",
                3,
            ),
        ),
        "diagnostic-confirmation": (
            ("confirm", r"\b(?:подтверд|верифицир)\w*\b", 2),
            (
                "criteria",
                r"\b(?:диагностическ\w*\s+критери|критери\w*\s+диагноз)\w*\b",
                3,
            ),
            ("rule-out", r"\b(?:исключ|отличить|различить|дифференцир)\w*\b", 2),
        ),
        "test-selection": (
            (
                "next-test",
                r"\b(?:следующ|перв|начальн|оптимальн|наиболее\s+информативн)\w*\s+"
                r"(?:исследован|анализ|обследован|тест|визуализац)\w*\b",
                3,
            ),
            (
                "what-test",
                r"\b(?:какое|какие|что\s+из)\s+(?:исследован|анализ|обследован|тест)\w*\b",
                3,
            ),
            (
                "order-test",
                r"\b(?:назначить|выполнить|провести|сделать)\s+(?:анализ|исследован|обследован|мрт|кт|узи|рентген)\w*\b",
                2,
            ),
        ),
        "result-interpretation": (
            (
                "interpret",
                r"\b(?:интерпретир|расшифров|значени|значимость|что\s+означает)\w*\b",
                3,
            ),
            (
                "artifact",
                r"\b(?:экг|ээг|мрт|кт|рентген|биопси|гистолог|анализ|hb)\w*\b",
                1,
            ),
        ),
        "treatment-selection": (
            ("treatment", r"\b(?:лечени|терапи|ведение|лечить|тактик)\w*\b", 2),
            (
                "first-line",
                r"\b(?:(?:перв|втор)\w*\s+лини\w*|препарат\w*\s+выбора)\b",
                3,
            ),
            ("prescribe", r"\b(?:назначить|начать|инициировать)\w*\b", 1),
        ),
        "treatment-adjustment": (
            (
                "nonresponse",
                r"\b(?:нет\s+эффекта|без\s+эффекта|не\s+ответил|не\s+отвечает|неэффективн|рефрактерн)\w*\b",
                3,
            ),
            (
                "change",
                r"\b(?:заменить|сменить|скорректировать|увеличить|снизить|отменить|продолжить|перевести)\w*\b",
                2,
            ),
        ),
        "dosing-calculation": (
            (
                "dose",
                r"\b(?:доз\w*|дозиров\w*|сколько\s+(?:мг|мл|таблет|капель)\w*)\b",
                3,
            ),
            ("weight-dose", r"\b(?:мг|мкг|г)\s*/\s*(?:кг|м2|м²)|по\s+массе\b", 3),
            (
                "frequency",
                r"\b(?:кратност|как\s+часто|раз\s+в\s+сутки|каждые\s+\d+\s+час)\w*\b",
                2,
            ),
        ),
        "medication-safety": (
            (
                "interaction",
                r"\b(?:взаимодейств|совместим|сочетать|комбинац|одновременно)\w*\b",
                3,
            ),
            (
                "contraindication",
                r"\b(?:противопоказ|нельзя|избегать|безопасн)\w*\b",
                3,
            ),
            ("population", r"\b(?:беременн|грудн\w*\s+вскармливан|лактац)\w*\b", 2),
        ),
        "monitoring-follow-up": (
            (
                "monitor",
                r"\b(?:контрол|монитор|наблюдени|диспансерн\w*\s+наблюдени)\w*\b",
                3,
            ),
            (
                "repeat",
                r"\b(?:повторить|переоцен|повторн\w*\s+осмотр|динамик|явка)\w*\b",
                2,
            ),
        ),
        "prevention": (
            (
                "prevention",
                r"\b(?:профилактик|предотврат|вакцин|привив|иммунизац|скрининг)\w*\b",
                3,
            ),
        ),
        "prognosis": (
            (
                "prognosis",
                r"\b(?:прогноз|исход|выживаемост|летальност|смертност|рецидив)\w*\b",
                3,
            ),
        ),
        "administrative": (
            (
                "status",
                r"\b(?:военн|призыв|категори\w*\s+годност|инвалидност|льгот)\w*\b",
                3,
            ),
            (
                "regulation",
                r"\b(?:приказ|порядок|норматив|закон|постановлен|регламент)\w*\b",
                3,
            ),
            (
                "document",
                r"\b(?:оформить|оформлен|справк|заключени|извещени|документац)\w*\b",
                2,
            ),
        ),
        "education-reference": (
            ("definition", r"\b(?:определени|что\s+такое|обзор)\w*\b", 2),
            ("mechanism", r"\b(?:механизм|патогенез|патофизиолог|физиолог)\w*\b", 2),
            ("classification", r"\b(?:классификац|степен|стади)\w*\b", 2),
        ),
    }
)

_EN_RULES = _compile_rules(
    {
        "urgency-routing": (
            (
                "urgency",
                r"\b(?:emergency|urgent|admit|admission|referral|specialist)\w*\b",
                3,
            ),
        ),
        "diagnosis-cause": (
            (
                "diagnosis",
                r"\b(?:differential|etiology|cause of|most likely diagnosis)\b",
                3,
            ),
        ),
        "diagnostic-confirmation": (
            (
                "confirmation",
                r"\b(?:confirm|diagnostic criteria|rule out|differentiate)\w*\b",
                3,
            ),
        ),
        "test-selection": (
            (
                "test",
                r"\b(?:next|best|appropriate|initial|first|what)\s+(?:test|study|imaging|workup)\b",
                3,
            ),
        ),
        "result-interpretation": (
            (
                "interpret",
                r"\b(?:interpret|interpretation|meaning|significance|ecg|ekg|lab result)\w*\b",
                3,
            ),
        ),
        "treatment-selection": (
            ("treatment", r"\b(?:treat|treatment|therapy|management|manage)\b", 2),
            (
                "first-line",
                r"\b(?:first-line|second-line|preferred|best)\s+(?:drug|medication|therapy|treatment)\b",
                3,
            ),
        ),
        "treatment-adjustment": (
            (
                "nonresponse",
                r"\b(?:not respond(?:ing|ed)?|no response|failed|failure|refractory)\b",
                3,
            ),
            (
                "change",
                r"\b(?:switch(?:ed)?|change(?:d)?|adjust(?:ed)?|stop(?:ped)?|continue(?:d)?)\b",
                2,
            ),
        ),
        "dosing-calculation": (
            ("dose", r"\b(?:dose|dosage|dosing|how much|mg/kg|weight-based)\b", 3),
        ),
        "medication-safety": (
            (
                "safety",
                r"\b(?:interaction|contraindicat|unsafe|safe to use|side effect|pregnan)\w*\b",
                3,
            ),
        ),
        "monitoring-follow-up": (
            (
                "monitor",
                r"\b(?:monitor|monitoring|follow-up|follow up|recheck|repeat)\b",
                3,
            ),
        ),
        "prevention": (
            (
                "prevention",
                r"\b(?:prevent|prevention|prophylaxis|vaccine|vaccination|screening)\b",
                3,
            ),
        ),
        "prognosis": (
            (
                "prognosis",
                r"\b(?:prognosis|outcome|survival|mortality|recurrence|relapse)\b",
                3,
            ),
        ),
        "administrative": (
            (
                "administrative",
                r"\b(?:insurance|coverage|authorization|disability|military service|regulatory)\b",
                3,
            ),
        ),
        "education-reference": (
            (
                "reference",
                r"\b(?:define|definition|what is|overview|mechanism|pathophysiology|epidemiology|guideline)\b",
                2,
            ),
        ),
    }
)

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
_CYRILLIC = re.compile(r"[А-Яа-яЁё]")
_LATIN = re.compile(r"[A-Za-z]")
_WORD = re.compile(r"[A-Za-zА-Яа-яЁё0-9]+(?:[-'][A-Za-zА-Яа-яЁё0-9]+)?")
_CLAUSE_BOUNDARY = re.compile(
    r"[?;:]|\.(?:\s|$)|,(?:\s+(?:and|but|with|while|after|before|и|но|при|после|до|если|когда|однако)\b)",
    re.IGNORECASE,
)


def detect_query_language(text: str) -> QueryLanguage:
    cyrillic = len(_CYRILLIC.findall(text))
    latin = len(_LATIN.findall(text))
    if cyrillic == 0 and latin == 0:
        return "unknown"
    if cyrillic and latin:
        if cyrillic >= latin * 3:
            return "ru"
        if latin >= cyrillic * 3:
            return "en"
        return "mixed"
    return "ru" if cyrillic else "en"


def _resolve_language(text: str, declared_language: str | None) -> QueryLanguage:
    if declared_language:
        normalized = declared_language.strip().lower()
        if normalized.startswith("ru"):
            return "ru"
        if normalized.startswith("en"):
            return "en"
    return detect_query_language(text)


def _active_profiles(language: QueryLanguage) -> tuple[Profile, ...]:
    if language == "en":
        return (("en", _EN_RULES, _EN_PATIENT_RULES),)
    if language == "ru":
        return (("ru", _RU_RULES, _RU_PATIENT_RULES),)
    return (
        ("ru", _RU_RULES, _RU_PATIENT_RULES),
        ("en", _EN_RULES, _EN_PATIENT_RULES),
    )


def _matched_rules(text: str, rules: tuple[_SignalRule, ...]) -> tuple[int, list[str]]:
    matched = [rule for rule in rules if rule.pattern.search(text)]
    return sum(rule.weight for rule in matched), [rule.label for rule in matched]


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


def annotate_clinical_query(
    text: str,
    *,
    language: str | None = None,
) -> ClinicalQueryAnnotation:
    normalized = " ".join(text.split())
    if not normalized:
        raise ValueError("Clinical query cannot be blank.")

    detected_language = _resolve_language(normalized, language)
    scores: Counter[DecisionKind] = Counter()
    signals_by_decision: dict[DecisionKind, list[str]] = {}
    patient_signals: list[str] = []

    for profile, decision_rules, patient_rules in _active_profiles(detected_language):
        for decision, rules in decision_rules.items():
            score, labels = _matched_rules(normalized, rules)
            if score:
                scores[decision] += score
                signals_by_decision.setdefault(decision, []).extend(
                    f"{profile}:{label}" for label in labels
                )
        patient_signals.extend(
            f"{profile}:{rule.label}" for rule in patient_rules if rule.pattern.search(normalized)
        )

    priority = {decision: index for index, decision in enumerate(_DECISION_PRIORITY)}
    ranked: list[DecisionKind] = sorted(
        scores.keys(),
        key=lambda decision: (-scores[decision], priority.get(decision, len(priority))),
    )
    if not ranked:
        primary: DecisionKind = "unknown"
        secondary: list[DecisionKind] = []
        matched_signals: list[str] = []
        confidence = 0.2
    else:
        primary = ranked[0]
        top_score = scores[primary]
        secondary_candidates: list[DecisionKind] = []
        for decision in ranked[1:]:
            if scores[decision] >= max(2, top_score - 1):
                secondary_candidates.append(decision)
        secondary = secondary_candidates[:3]
        ordered: list[DecisionKind] = [primary]
        ordered.extend(secondary)
        matched_signals = [
            f"{decision}:{label}" for decision in ordered for label in signals_by_decision[decision]
        ]
        second_score = scores[ranked[1]] if len(ranked) > 1 else 0
        confidence = min(0.96, 0.45 + top_score * 0.08 + (top_score - second_score) * 0.05)

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
        detected_language=detected_language,
        needs_review=needs_review,
        complexity=complexity,
        patient_context_signals=patient_signals,
        word_count=word_count,
        clause_count=clause_count,
    )
