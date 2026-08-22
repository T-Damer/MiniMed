"""Deterministic MiniMed dataset generator for Cactus Needle fine-tuning.

Emits JSONL samples of the shape ``{"query", "tools", "answers", "reasoning"}``
grounded in repository content:

- calculator identifiers and inputs come from ``content/tool-modules/*.json``;
- search queries come from the retrieval benchmarks with their real expected
  scope/section metadata;
- off-topic samples carry ``answers: []``;
- ambiguous near-pairs between similar tools are included explicitly.

The model only selects a tool and copies values evidenced in the query text.
Arithmetic stays in deterministic application code.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FILE = Path(__file__).resolve()
NEEDLE_DIR = FILE.parents[2]
REPO_ROOT = FILE.parents[4]
TOOL_MODULES_DIR = REPO_ROOT / "content" / "tool-modules"
BENCHMARKS_DIR = REPO_ROOT / "tools" / "benchmarks"
TOOLS_PATH = NEEDLE_DIR / "minimed_tools.json"

CALCULATOR_PREFIX = "minimed.calculator."
ASSESSMENT_PREFIX = "minimed.assessment."

# Arguments that map onto fixed catalogs instead of query substrings; they are
# validated against those catalogs rather than by substring grounding.
SELECTION_ARGS = frozenset({"calculator_id", "assessment_id", "scope", "section"})

IMPLIED_UNIT_SELECTS = frozenset({"creatinineUnit", "glucoseUnit"})

# Schema input id -> flat tool argument name.
INPUT_MAP: dict[str, str] = {
    "ageYears": "age_years",
    "weightKg": "weight_kg",
    "bodyWeightKg": "weight_kg",
    "currentWeightKg": "weight_kg",
    "birthWeightKg": "birth_weight_kg",
    "heightCm": "height_cm",
    "sex": "sex",
    "creatinine": "creatinine_umol_l",
    "plasmaCreatinine": "creatinine_umol_l",
    "urineCreatinine": "urine_creatinine_umol_l",
    "sodium": "sodium_mmol_l",
    "plasmaSodium": "sodium_mmol_l",
    "urineSodium": "urine_sodium_mmol_l",
    "potassium": "potassium_mmol_l",
    "chloride": "chloride_mmol_l",
    "bicarbonate": "bicarbonate_mmol_l",
    "albumin": "albumin_g_l",
    "glucose": "glucose_mmol_l",
    "urea": "urea_mmol_l",
    "plasmaUrea": "urea_mmol_l",
    "urineUrea": "urine_urea_mmol_l",
    "ast": "ast_u_l",
    "alt": "alt_u_l",
    "platelets": "platelets_10_9_l",
    "whiteBloodCells": "wbc_10_9_l",
    "neutrophilsPercent": "neutrophils_percent",
    "bandsPercent": "bands_percent",
    "mcv": "mcv_fl",
    "redBloodCells": "rbc_10_12_l",
    "heartRateBpm": "heart_rate_bpm",
    "systolicBpMmHg": "systolic_bp_mmhg",
    "qtMs": "qt_ms",
    "rrSeconds": "rr_seconds",
    "tbsaPercent": "tbsa_percent",
    "hoursSinceBurn": "hours_since_burn",
    "urineVolumeMl": "urine_volume_ml",
    "hours": "collection_hours",
    "vomitingEpisodes": "vomiting_episodes",
    "diarrheaEpisodes": "diarrhea_episodes",
}

# arg -> (low, high, decimals)
RANGES: dict[str, tuple[float, float, int]] = {
    "age_years": (1, 88, 0),
    "weight_kg": (4, 95, 1),
    "birth_weight_kg": (0.8, 4.6, 2),
    "height_cm": (55, 195, 0),
    "creatinine_umol_l": (45, 620, 0),
    "urine_creatinine_umol_l": (2000, 16000, 0),
    "sodium_mmol_l": (118, 152, 0),
    "urine_sodium_mmol_l": (8, 120, 0),
    "potassium_mmol_l": (2.5, 6.4, 1),
    "chloride_mmol_l": (88, 118, 0),
    "bicarbonate_mmol_l": (7, 36, 0),
    "glucose_mmol_l": (2.2, 22, 1),
    "urea_mmol_l": (1.5, 28, 1),
    "urine_urea_mmol_l": (100, 900, 0),
    "albumin_g_l": (18, 48, 0),
    "ast_u_l": (12, 480, 0),
    "alt_u_l": (12, 520, 0),
    "platelets_10_9_l": (35, 480, 0),
    "wbc_10_9_l": (0.9, 26, 1),
    "neutrophils_percent": (12, 90, 0),
    "bands_percent": (0, 14, 0),
    "mcv_fl": (58, 118, 0),
    "rbc_10_12_l": (1.6, 6.2, 2),
    "heart_rate_bpm": (42, 175, 0),
    "systolic_bp_mmhg": (72, 205, 0),
    "qt_ms": (330, 600, 0),
    "rr_seconds": (0.32, 0.92, 2),
    "tbsa_percent": (4, 55, 0),
    "hours_since_burn": (1, 11, 0),
    "urine_volume_ml": (60, 2200, 0),
    "collection_hours": (6, 24, 0),
    "vomiting_episodes": (1, 12, 0),
    "diarrhea_episodes": (1, 12, 0),
    # extract_labs-only values
    "bilirubin_total_umol_l": (4, 180, 0),
    "crp_mg_l": (1, 240, 0),
    "hemoglobin_g_l": (55, 190, 0),
    "tsh_mu_l": (0.02, 40, 2),
}

DOSE_MG_KG_CHOICES: tuple[float, ...] = (
    0.01,
    0.05,
    0.1,
    0.15,
    1,
    5,
    7.5,
    10,
    12.5,
    15,
    20,
    40,
)

DOSE_DRUGS: tuple[str, ...] = ("парацетамол", "ибупрофен", "амоксициллин", "цефтриаксон")

ARG_PHRASES: dict[str, tuple[str, ...]] = {
    "weight_kg": ("вес {v} кг", "масса {v} кг", "{v} кг", "весит {v} кг"),
    "birth_weight_kg": ("масса при рождении {v} кг", "при рождении весил {v} кг"),
    "height_cm": ("рост {v} см", "{v} см"),
    "dose_mg_kg": ("доза {v} мг/кг", "по {v} мг/кг", "{v} мг/кг"),
    "creatinine_umol_l": ("креатинин {v}", "креатинин {v} мкмоль/л"),
    "urine_creatinine_umol_l": ("креатинин мочи {v} мкмоль/л",),
    "sodium_mmol_l": ("натрий {v}", "натрий {v} ммоль/л"),
    "urine_sodium_mmol_l": ("натрий мочи {v} ммоль/л",),
    "potassium_mmol_l": ("калий {v}", "калий {v} ммоль/л"),
    "chloride_mmol_l": ("хлор {v}", "хлор {v} ммоль/л"),
    "bicarbonate_mmol_l": ("бикарбонат {v}", "HCO3 {v}"),
    "glucose_mmol_l": ("глюкоза {v}", "глюкоза {v} ммоль/л"),
    "urea_mmol_l": ("мочевина {v}",),
    "urine_urea_mmol_l": ("мочевина мочи {v} ммоль/л",),
    "albumin_g_l": ("альбумин {v} г/л",),
    "ast_u_l": ("АСТ {v}",),
    "alt_u_l": ("АЛТ {v}",),
    "platelets_10_9_l": ("тромбоциты {v}",),
    "wbc_10_9_l": ("лейкоциты {v}",),
    "neutrophils_percent": ("нейтрофилы {v}%",),
    "bands_percent": ("палочкоядерные {v}%",),
    "mcv_fl": ("MCV {v}",),
    "rbc_10_12_l": ("эритроциты {v}",),
    "heart_rate_bpm": ("ЧСС {v}", "пульс {v}"),
    "systolic_bp_mmhg": ("давление {v}", "АД систолическое {v}"),
    "qt_ms": ("QT {v} мс",),
    "rr_seconds": ("RR {v} c",),
    "tbsa_percent": ("ожог {v}% поверхности тела", "площадь ожога {v}%"),
    "hours_since_burn": ("{v} часов от момента ожога",),
    "urine_volume_ml": ("диурез {v} мл",),
    "collection_hours": ("за {v} часов",),
    "vomiting_episodes": ("рвота {v} раза", "была рвота {v} раза"),
    "diarrhea_episodes": ("стул {v} раза", "диарея {v} раза"),
}

SEX_PHRASES: dict[str, tuple[str, ...]] = {
    "male": ("мужчина", "мужской пол", "мужского пола"),
    "female": ("женщина", "женский пол", "женского пола"),
}

CALC_FRAMES: tuple[str, ...] = (
    "Рассчитай {alias}: {facts}.",
    "{facts}. Посчитай {alias}, пожалуйста.",
    "Нужен расчёт {alias}: {facts}.",
)

LAB_POOL: dict[str, str] = {
    "sodium_mmol_l": "натрий {v}",
    "potassium_mmol_l": "калий {v}",
    "creatinine_umol_l": "креатинин {v}",
    "glucose_mmol_l": "глюкоза {v}",
    "urea_mmol_l": "мочевина {v}",
    "albumin_g_l": "альбумин {v} г/л",
    "ast_u_l": "АСТ {v}",
    "alt_u_l": "АЛТ {v}",
    "bilirubin_total_umol_l": "билирубин {v}",
    "crp_mg_l": "СРБ {v}",
    "hemoglobin_g_l": "гемоглобин {v}",
    "wbc_10_9_l": "лейкоциты {v}",
    "platelets_10_9_l": "тромбоциты {v}",
    "tsh_mu_l": "ТТГ {v}",
}

LAB_FRAMES: tuple[str, ...] = ("{facts}. Извлеки показатели.", "Лаборатория: {facts}.", "{facts}.")

VITAL_FRAMES: tuple[str, ...] = (
    "{facts}. Извлеки показатели осмотра.",
    "Осмотр: {facts}.",
    "{facts}.",
)

DRUG_TRADES: dict[str, tuple[str, ...]] = {
    "парацетамол": ("эффералган", "панадол", "цефекон"),
    "ибупрофен": ("нурофен",),
    "цефтриаксон": (),
    "амоксициллин": ("флемоксин солютаб",),
    "азитромицин": ("сумамед",),
    "осельтамивир": ("тамифлю",),
}

LOOKUP_FRAMES: tuple[str, ...] = (
    "{n} инструкция по применению",
    "дозировка {n}",
    "есть ли в справочнике препарат {n}",
    "как принимать {n}",
    "{n}: форма выпуска и дозы",
    "чем можно заменить {n}",
    "{n}: противопоказания",
)

INTERACTION_FRAMES: tuple[str, ...] = (
    "можно ли {a} вместе с {b}",
    "совместимы ли {a} и {b}",
    "взаимодействие {a} и {b}",
    "{b} на фоне {a}: есть ли взаимодействия?",
)

ICD_CONDITIONS: tuple[tuple[str, str], ...] = (
    ("пневмония", "J18.9"),
    ("бронхиальная астма", "J45"),
    ("гипертоническая болезнь", "I10"),
    ("сахарный диабет 2 типа", "E11"),
    ("острый гастрит", "K29"),
    ("пиелонефрит", "N10"),
    ("острый средний отит", "H66"),
    ("железодефицитная анемия", "D50"),
    ("мигрень", "G43"),
    ("гипотиреоз", "E03"),
    ("острый холецистит", "K81"),
    ("цистит", "N30"),
    ("обструктивный бронхит", "J20"),
    ("ринофарингит", "J00"),
    ("атопический дерматит", "L20"),
)

ICD_FRAMES: tuple[str, ...] = (
    "код МКБ при {c}",
    "МКБ-10 для {c}",
    "{c}: какой код МКБ?",
    "найди МКБ для {c}",
)

ICD_CODE_FRAMES: tuple[str, ...] = (
    "что означает код {c}?",
    "расшифровка {c}",
    "{c} — что это за диагноз?",
)

ASSESSMENT_PHRASES: dict[str, tuple[str, ...]] = {
    "glasgow-coma-scale": ("шкалу комы Глазго", "GCS"),
    "alvarado-appendicitis": ("балл Alvarado", "шкалу Альварадо"),
    "flacc-pain-scale": ("шкалу боли FLACC",),
    "apgar": ("шкалу Апгар", "оценку по Апгар"),
    "epds": ("Эдинбургскую шкалу послеродовой депрессии", "EPDS"),
    "ferriman-gallwey": ("шкалу Ферримана–Голлвея",),
    "whooley": ("скрининг Whooley",),
    "pucai": ("индекс PUCAI",),
    "vesikari-gastroenteritis": ("шкалу Везикари",),
    "partial-mayo-score": ("частичный индекс Мейо",),
    "braverman-behavioral": ("тест Бравермана",),
    "egogram": ("эгограмму",),
    "paei": ("профиль PAEI",),
    "team-roles": ("командные роли Белбина",),
    "temperament": ("тест на темперамент",),
    "silverman-andersen-respiratory-distress": ("шкалу Сильвермана–Андерсен",),
    "downes-vidyasagar-respiratory-distress": ("шкалу Даунса–Видьясагара",),
    "nips-neonatal-infant-pain-scale": ("неонатальную шкалу боли NIPS",),
    "ballard-neonatal-gestational-age": ("шкалу Балларда",),
}

ASSESSMENT_FRAMES: tuple[str, ...] = (
    "Открой {p}, пожалуйста.",
    "Проведи оценку: {p}.",
    "Нужна шкала: {p}.",
    "Посчитай балл: {p}.",
    "Какой результат даст {p} у этого пациента?",
)

NOTE_SCENES: tuple[tuple[str, str], ...] = (
    ("Осмотр", "температура 37,5 четвёртый день, аппетит снижен"),
    ("Назначения", "цефтриаксон 1 г в/м 2 раза в сутки, 5 дней"),
    ("Антропометрия", "вес 12 кг, рост 86 см"),
    ("Жалобы", "влажный кашель ночью без температуры"),
    ("Анализ крови", "гемоглобин 112, лейкоциты 9, СОЭ 14"),
    ("Прививка", "АКДС перенесена без осложнений"),
    ("Консультация", "ЛОР: аденоиды 2 степени, контроль через 3 месяца"),
    ("Выписка", "состояние удовлетворительное, наблюдение участкового"),
    ("Дневник давления", "утром 138/86, вечером 129/82"),
    ("Аллергия", "сыпи на пенициллины, реакция в 2023 году"),
    ("Хронические болезни", "хронический гастрит вне обострения"),
    ("Направление", "общий анализ крови и мочи перед осмотром"),
    ("Температурный лист", "пик 39,2 ночью, снизилась после жаропонижающего"),
    ("Рекомендации врача", "обильное питьё, постельный режим три дня"),
    ("Стационар", "госпитализация в инфекционное отделение с 12 по 18 число"),
    ("Профосмотр", "осмотрен, группа здоровья вторая"),
)

NOTE_FRAMES: tuple[str, ...] = (
    "Создай заметку «{t}»: {b}",
    "Запиши в карту «{t}»: {b}",
    "Новая заметка «{t}»: {b}",
)

SEARCH_WRAP_FRAMES: tuple[str, ...] = (
    "найди в документах: {q}",
    "поищи в источниках MiniMed: {q}",
)

DOSE_FRAMES: tuple[str, ...] = (
    "ребёнок весом {w} кг: {drug} по {d} мг/кг — рассчитай дозу",
    "{drug} ребёнку массой {w} кг в дозе {d} мг/кг",
    "рассчитай дозу {drug}: вес {w} кг, доза {d} мг/кг",
)

# Hand-written near-pairs between similar tools plus one medical off-topic trap.
# ``None`` as the tool means a refusal sample with empty answers.
AMBIGUOUS: tuple[tuple[str, str | None, dict[str, Any], str], ...] = (
    (
        "натрий 128, калий 3,4, креатинин 102 — извлеки показатели",
        "extract_labs",
        {"sodium_mmol_l": 128, "potassium_mmol_l": 3.4, "creatinine_umol_l": 102},
        "'натрий 128' -> sodium_mmol_l 128; 'калий 3,4' -> potassium_mmol_l 3.4;"
        " 'креатинин 102' -> creatinine_umol_l 102",
    ),
    (
        "натрий 128, калий 3,4, креатинин 102 — оцени СКФ у женщины 55 лет",
        "run_calculator",
        {
            "calculator_id": "adult-egfr-ckd-epi-2021",
            "age_years": 55,
            "sex": "female",
            "sodium_mmol_l": 128,
            "potassium_mmol_l": 3.4,
            "creatinine_umol_l": 102,
        },
        "'55 лет' -> age_years 55; 'женщины' -> sex female;"
        " 'креатинин 102' -> creatinine_umol_l 102",
    ),
    (
        "шкала комы Глазго у пострадавшего",
        "run_assessment",
        {"assessment_id": "glasgow-coma-scale"},
        "'шкала комы Глазго' -> glasgow-coma-scale",
    ),
    (
        "ЧСС 120, давление 85 — посчитай индекс шока",
        "run_calculator",
        {"calculator_id": "shock-index", "heart_rate_bpm": 120, "systolic_bp_mmhg": 85},
        "'ЧСС 120' -> heart_rate_bpm 120; 'давление 85' -> systolic_bp_mmhg 85",
    ),
    (
        "можно ли парацетамол вместе с ибупрофеном",
        "find_interaction",
        {"drug_a": "парацетамол", "drug_b": "ибупрофен"},
        "'парацетамол' -> drug_a; 'ибупрофен' -> drug_b",
    ),
    (
        "нурофен инструкция для ребёнка 7 лет",
        "lookup_drug",
        {"name": "нурофен", "age_years": 7},
        "'нурофен' -> name; '7 лет' -> age_years 7",
    ),
    ("код МКБ при пиелонефрите", "find_icd", {"query": "пиелонефрит"}, "'пиелонефрит' -> query"),
    (
        "Создай заметку «Выписка»: вес при выписке 3,4 кг",
        "create_note",
        {"title": "Выписка", "body": "вес при выписке 3,4 кг"},
        "'Выписка' -> title; остаток строки -> body",
    ),
    ("поставь диагноз по описанию: ребёнок вялый, отказывается от еды", None, {}, ""),
    (
        "клинические рекомендации по пневмонии у детей",
        "search_medical_documents",
        {"query": "клинические рекомендации по пневмонии у детей", "scope": "guidelines"},
        "'клинические рекомендации…пневмонии у детей' -> query; 'рекомендации' -> scope guidelines",
    ),
    (
        "что это может быть: боль в животе у подростка",
        "search_medical_documents",
        {
            "query": "боль в животе у подростка",
            "scope": "diagnosis",
            "section": "differential-diagnosis",
        },
        "'боль в животе…подростка' -> query; 'что это может быть' -> scope diagnosis,"
        " section differential-diagnosis",
    ),
    (
        "оцени дыхание недоношенного по шкале Даунса–Видьясагара",
        "run_assessment",
        {"assessment_id": "downes-vidyasagar-respiratory-distress"},
        "'шкале Даунса–Видьясагара' -> downes-vidyasagar-respiratory-distress",
    ),
    (
        "АД 120/80, пульс 76 — зафиксируй показатели осмотра",
        "extract_vitals",
        {"systolic_bp_mmhg": 120, "diastolic_bp_mmhg": 80, "heart_rate_bpm": 76},
        "'120/80' -> systolic_bp_mmhg 120 и diastolic_bp_mmhg 80; 'пульс 76' -> heart_rate_bpm 76",
    ),
)

TARGET_COUNTS: dict[str, int] = {
    "run_calculator": 280,
    "run_assessment": 96,
    "extract_labs": 120,
    "extract_vitals": 100,
    "search_medical_documents": 130,
    "lookup_drug": 120,
    "find_interaction": 88,
    "find_icd": 60,
    "create_note": 48,
}

OFF_TOPIC_COUNT = 130

OFF_TOPIC_CITIES = ("Москве", "Санкт-Петербурге", "Казани", "Новосибирске")
OFF_TOPIC_WORDS = ("treatment", "adherence", "outcome", "screening", "recovery")
OFF_TOPIC_DISHES = ("борщ", "сырники", "плов", "окрошка")
OFF_TOPIC_GENRES = ("классическую", "джазовую", "инструментальную")
OFF_TOPIC_CONDITIONS = (
    "головной боли",
    "кашле больше недели",
    "боли в спине",
    "сыпу на руках",
    "повышенном давлении",
    "бессоннице",
    "кровоточивости дёсен",
    "головокружении",
)

MED_TRAP_FRAMES: tuple[str, ...] = (
    "Поставь диагноз по описанию: {c}.",
    "Что у меня может быть при {c}?",
    "Скажи точно, чем я болею: {c}.",
    "Подбери лечение самостоятельно: {c}.",
    "Это опасно, когда {c}? Ответь без источников.",
)

MISC_OFFTOPIC_FRAMES: tuple[str, ...] = (
    "Какая погода будет завтра в {x}?",
    "Переведи слово «{w}» на русский.",
    "Найди рецепт {d}.",
    "Включи {g} музыку.",
    "Поставь будильник на семь утра.",
    "Закажи пиццу на ужин.",
    "Придумай шутку про программистов.",
    "Сколько калорий в яблоке?",
    "Который час?",
)


def _build_offtopic_queries() -> list[str]:
    queries: list[str] = []
    for condition in OFF_TOPIC_CONDITIONS:
        queries.extend(frame.format(c=condition) for frame in MED_TRAP_FRAMES)
    for city in OFF_TOPIC_CITIES:
        queries.append(MISC_OFFTOPIC_FRAMES[0].format(x=city))
    for word in OFF_TOPIC_WORDS:
        queries.append(MISC_OFFTOPIC_FRAMES[1].format(w=word))
    for dish in OFF_TOPIC_DISHES:
        queries.append(MISC_OFFTOPIC_FRAMES[2].format(d=dish))
    for genre in OFF_TOPIC_GENRES:
        queries.append(MISC_OFFTOPIC_FRAMES[3].format(g=genre))
    queries.extend(MISC_OFFTOPIC_FRAMES[4:])
    return queries


@dataclass(frozen=True)
class CalcSpec:
    """One trainable calculator mapped onto flat tool arguments."""

    calc_id: str
    alias: str
    required_args: tuple[str, ...]
    optional_args: tuple[str, ...]
    # Argument whose phrase must carry an explicit unit because the schema has an
    # implied unit select (creatinineUnit / glucoseUnit).
    unit_arg: str | None


def load_tool_schemas() -> dict[str, dict[str, Any]]:
    raw = json.loads(TOOLS_PATH.read_text(encoding="utf-8"))
    return {str(tool["name"]): tool for tool in raw}


def _calculator_alias(tool: dict[str, Any]) -> str:
    aliases = tool.get("aliases") or []
    for candidate in aliases:
        if isinstance(candidate, str) and re.search("[а-яё]", candidate.lower()):
            return candidate
    title = str(tool.get("title") or "")
    return title.split(" — ")[0].strip()


def _lower_first(alias: str) -> str:
    if len(alias) > 1 and alias[0].isupper() and alias[1].islower():
        return alias[0].lower() + alias[1:]
    return alias


def build_calculator_pool(
    schemas: dict[str, dict[str, Any]],
) -> tuple[list[CalcSpec], frozenset[str]]:
    """Collect calculators whose required inputs are fully mappable to flat args."""
    props = schemas["run_calculator"]["parameters"]["properties"]
    specs: list[CalcSpec] = []
    known_ids: set[str] = set()
    for path in sorted(TOOL_MODULES_DIR.glob("*.json")):
        module = json.loads(path.read_text(encoding="utf-8"))
        for tool in module.get("tools", []):
            if tool.get("kind") != "calculator":
                continue
            calc_id = str(tool["id"]).removeprefix(CALCULATOR_PREFIX)
            known_ids.add(calc_id)
            inputs = (tool.get("definition") or {}).get("inputs") or []
            required_args: list[str] = []
            optional_args: list[str] = []
            unit_arg: str | None = None
            supported = True
            for item in inputs:
                input_id = str(item.get("id"))
                if input_id in IMPLIED_UNIT_SELECTS and item.get("required"):
                    unit_arg = (
                        "glucose_mmol_l" if input_id == "glucoseUnit" else "creatinine_umol_l"
                    )
                    continue
                arg_name = INPUT_MAP.get(input_id)
                is_number = item.get("kind") == "number"
                is_sex_select = item.get("kind") == "select" and input_id == "sex"
                if arg_name is None or not (is_number or is_sex_select):
                    if item.get("required"):
                        supported = False
                        break
                    continue
                target_list = required_args if item.get("required") else optional_args
                if arg_name not in props:
                    if item.get("required"):
                        supported = False
                        break
                    continue
                if arg_name not in target_list:
                    target_list.append(arg_name)
            if not supported or not required_args:
                continue
            specs.append(
                CalcSpec(
                    calc_id=calc_id,
                    alias=_calculator_alias(tool),
                    required_args=tuple(required_args),
                    optional_args=tuple(optional_args),
                    unit_arg=unit_arg,
                )
            )
    dose = CalcSpec(
        calc_id="dose-by-weight",
        alias="дозу по массе тела",
        required_args=("weight_kg", "dose_mg_kg"),
        optional_args=(),
        unit_arg=None,
    )
    known_ids.add(dose.calc_id)
    return [dose, *specs], frozenset(known_ids)


def load_search_specs() -> list[tuple[str, str | None, str | None]]:
    """Load real retrieval-benchmark queries with their expected scope and section."""
    sources: tuple[tuple[str, int | None], ...] = (
        ("doctor-workflow-queries.json", None),
        ("regulatory-rf-major-queries.json", 24),
        ("pilot-rf-drug-queries.json", None),
    )
    specs: list[tuple[str, str | None, str | None]] = []
    for file_name, cap in sources:
        path = BENCHMARKS_DIR / file_name
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        taken = 0
        for item in data:
            if cap is not None and taken >= cap:
                break
            if not isinstance(item, dict):
                continue
            query = item.get("query")
            if not isinstance(query, str) or not query.strip():
                continue
            doc_ids = [str(d) for d in (item.get("expectedDocumentIds") or [])]
            scope: str | None = None
            if any(d.startswith("drug.") for d in doc_ids):
                scope = "medications"
            elif any(k in d for d in doc_ids for k in ("order", "federal", "regulatory")):
                scope = "legal"
            elif any(d.startswith("kr.rf") for d in doc_ids):
                scope = "guidelines"
            sections = item.get("expectedSectionTypes") or []
            section: str | None = None
            if sections and str(sections[0]) in SEARCH_SECTIONS:
                section = str(sections[0])
            specs.append((query, scope, section))
            taken += 1
    return specs


SEARCH_SECTIONS = frozenset(
    {
        "clinical-picture",
        "differential-diagnosis",
        "diagnostics",
        "treatment",
        "routing",
        "follow-up",
    }
)


def fmt(value: int | float | str) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, int):
        return str(value)
    if value.is_integer():
        return str(int(value))
    return f"{value:g}"


def years_label(n: int) -> str:
    if n % 100 in (11, 12, 13, 14):
        word = "лет"
    elif n % 10 == 1:
        word = "год"
    elif n % 10 in (2, 3, 4):
        word = "года"
    else:
        word = "лет"
    return f"{n} {word}"


INT_ARGS = frozenset({"age_years", "vomiting_episodes", "diarrhea_episodes"})


def sample_value(rng: random.Random, arg: str) -> float | int:
    low, high, decimals = RANGES[arg]
    raw = rng.uniform(low, high)
    if arg in INT_ARGS:
        return round(raw)
    if decimals == 0:
        return float(round(raw))
    if arg == "weight_kg":
        return round(raw * 2) / 2
    return round(raw, decimals)


def make_phrase(rng: random.Random, arg: str, value: float, force_unit: bool = False) -> str:
    shown = fmt(value)
    if arg == "age_years":
        label = years_label(int(value))
        return f"возраст {label}" if rng.random() < 0.4 else label
    if arg == "sex":
        return rng.choice(SEX_PHRASES["male" if value == 0 else "female"])
    templates = ARG_PHRASES[arg]
    index = rng.randrange(len(templates))
    if force_unit and len(templates) > 1:
        index = len(templates) - 1
    return templates[index].replace("{v}", shown)


def check_grounding(query: str, args: dict[str, Any]) -> str | None:
    """Return the first argument whose value is not evidenced in the query text."""
    lowered = query.lower()
    sex_words = {
        "male": ("мужчин", "мужск", "мальчик"),
        "female": ("женщин", "женск", "девочк"),
    }
    for key, value in args.items():
        if key in SELECTION_ARGS:
            continue
        if key == "sex":
            words = sex_words[str(value)]
            if not any(w in lowered for w in words):
                return f"sex={value} not grounded"
            continue
        if isinstance(value, bool):
            return f"{key}: boolean args are not used by this contract"
        if isinstance(value, (int, float)):
            text = fmt(value)
            if text not in lowered and text.replace(".", ",") not in lowered:
                return f"{key}={text} not grounded"
            continue
        if str(value).lower() not in lowered:
            return f"{key} not grounded: {value!r}"
    return None


def _slim_schema(tool: dict[str, Any]) -> dict[str, Any]:
    """Drop per-property descriptions and numeric ranges from the training context.

    Tool-level descriptions stay. The served catalog keeps its full schemas;
    trimming only the per-line payload keeps sequences near ~2k tokens so CPU
    LoRA training stays practical.
    """

    def slim(node: Any, top_level: bool = False) -> Any:
        if isinstance(node, dict):
            keep_description = top_level
            result: dict[str, Any] = {}
            for key, value in node.items():
                if key == "description":
                    if keep_description:
                        result[key] = slim(value)
                elif key not in ("minimum", "maximum", "enum", "required"):
                    result[key] = slim(value)
            return result
        if isinstance(node, list):
            return [slim(item) for item in node]
        return node

    return slim(tool, top_level=True)


# Confusable tool groups used to build small per-line menus; the model learns to
# discriminate inside a changing menu, and evaluation binds the full catalog.
DISTRACTORS: dict[str, tuple[str, ...]] = {
    "run_calculator": ("run_assessment", "extract_labs", "extract_vitals"),
    "run_assessment": ("run_calculator",),
    "extract_labs": ("extract_vitals", "run_calculator"),
    "extract_vitals": ("extract_labs",),
    "search_medical_documents": ("find_icd", "lookup_drug"),
    "lookup_drug": ("find_interaction", "search_medical_documents"),
    "find_interaction": ("lookup_drug",),
    "find_icd": ("search_medical_documents",),
    "create_note": ("search_medical_documents",),
}


def build_sample(
    rng: random.Random,
    schemas: dict[str, dict[str, Any]],
    target: str | None,
    query: str,
    args: dict[str, Any],
    reasoning: str,
) -> dict[str, Any]:
    names = sorted(schemas)
    if target is None:
        menu = rng.sample(names, rng.randint(3, 4))
        return {
            "query": query,
            "tools": [_slim_schema(schemas[n]) for n in menu],
            "answers": [],
            "_target": "off-topic",
        }
    pool = [n for n in DISTRACTORS[target] if n != target]
    extra = rng.sample(pool, rng.randint(0, min(2, len(pool))))
    filler = [n for n in names if n not in {target, *extra}]
    while len(extra) < 2 and filler and rng.random() < 0.4:
        extra.append(filler.pop(rng.randrange(len(filler))))
    sample = {
        "query": query,
        "tools": [_slim_schema(schemas[n]) for n in [target, *extra]],
        "answers": [{"name": target, "arguments": args}] if args else [],
        "_target": target,
    }
    if reasoning:
        sample["reasoning"] = reasoning
    return sample


def gen_calculators(
    rng: random.Random, pool: list[CalcSpec], count: int
) -> list[tuple[str, str | None, dict[str, Any], str]]:
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for i in range(count):
        spec = pool[i % len(pool)]
        if spec.calc_id == "dose-by-weight":
            drug = rng.choice(DOSE_DRUGS)
            weight = float(round(rng.uniform(5, 60)))
            dose = rng.choice(DOSE_MG_KG_CHOICES)
            frame = DOSE_FRAMES[i % len(DOSE_FRAMES)]
            query = frame.format(w=fmt(weight), drug=drug, d=fmt(dose))
            args: dict[str, Any] = {
                "calculator_id": spec.calc_id,
                "weight_kg": weight,
                "dose_mg_kg": dose,
            }
            reasoning = (
                f"'вес {fmt(weight)} кг' -> weight_kg {fmt(weight)};"
                f" '{fmt(dose)} мг/кг' -> dose_mg_kg {fmt(dose)}"
            )
            out.append((query, "run_calculator", args, reasoning))
            continue
        facts: list[str] = []
        parts: list[str] = []
        args = {"calculator_id": spec.calc_id}
        for arg in spec.required_args:
            if arg == "sex":
                shown = rng.choice(("male", "female"))
                value = 0.0 if shown == "male" else 1.0
            else:
                value = sample_value(rng, arg)
                shown = fmt(value)
            phrase = make_phrase(rng, arg, value, force_unit=arg == spec.unit_arg)
            facts.append(phrase)
            args[arg] = shown if arg == "sex" else value
            parts.append(f"'{phrase}' -> {arg} {shown}")
        for arg in spec.optional_args:
            if rng.random() < 0.18:
                value = sample_value(rng, arg)
                phrase = make_phrase(rng, arg, value)
                facts.append(phrase)
                args[arg] = value
                parts.append(f"'{phrase}' -> {arg} {fmt(value)}")
        alias = _lower_first(spec.alias)
        frame = CALC_FRAMES[rng.randrange(len(CALC_FRAMES))]
        query = frame.format(alias=alias, facts=", ".join(facts))
        out.append((query, "run_calculator", args, "; ".join(parts)))
    return out


def gen_assessments(
    rng: random.Random, count: int
) -> list[tuple[str, str | None, dict[str, Any], str]]:
    combos = [
        (slug, phrase, frame)
        for slug, phrases in sorted(ASSESSMENT_PHRASES.items())
        for phrase in phrases
        for frame in ASSESSMENT_FRAMES
    ]
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for i in range(count):
        slug, phrase, frame = combos[i % len(combos)]
        query = frame.format(p=phrase)
        reasoning = f"'{phrase}' -> assessment_id {slug}"
        out.append((query, "run_assessment", {"assessment_id": slug}, reasoning))
    return out


def _lab_value(rng: random.Random, arg: str) -> float:
    low, high, decimals = RANGES[arg]
    raw = rng.uniform(low, high)
    return float(round(raw)) if decimals == 0 else round(raw, decimals)


def gen_labs(rng: random.Random, count: int) -> list[tuple[str, str | None, dict[str, Any], str]]:
    keys = list(LAB_POOL)
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for _ in range(count):
        picks = rng.sample(keys, rng.randint(2, 5))
        facts: list[str] = []
        args: dict[str, Any] = {}
        parts: list[str] = []
        for arg in picks:
            value = _lab_value(rng, arg)
            shown = fmt(value)
            label = LAB_POOL[arg].replace(
                "{v}", shown.replace(".", ",") if rng.random() < 0.4 else shown
            )
            facts.append(label)
            args[arg] = value
            parts.append(f"'{label}' -> {arg} {shown}")
        sentence = ", ".join(facts)
        sentence = sentence[0].upper() + sentence[1:]
        query = rng.choice(LAB_FRAMES).format(facts=sentence)
        out.append((query, "extract_labs", args, "; ".join(parts)))
    return out


def gen_vitals(rng: random.Random, count: int) -> list[tuple[str, str | None, dict[str, Any], str]]:
    out: list[tuple[str, str | None, dict[str, Any], str]] = []

    def add(
        rng: random.Random,
        facts: list[str],
        args: dict[str, Any],
        parts: list[str],
        arg: str,
        low: float,
        high: float,
        templates: tuple[str, ...],
    ) -> None:
        value = float(round(rng.uniform(low, high)))
        label = templates[rng.randrange(len(templates))].replace("{v}", fmt(value))
        facts.append(label)
        args[arg] = value
        parts.append(f"'{label}' -> {arg} {value:g}")

    for _ in range(count):
        facts: list[str] = []
        args: dict[str, Any] = {}
        parts: list[str] = []

        systolic = round(rng.uniform(105, 190))
        diastolic = max(55, min(115, systolic - round(rng.uniform(20, 50))))
        label = f"АД {systolic}/{diastolic}"
        facts.append(label)
        args["systolic_bp_mmhg"] = float(systolic)
        args["diastolic_bp_mmhg"] = float(diastolic)
        parts.append(f"'{label}' -> systolic_bp_mmhg {systolic}, diastolic_bp_mmhg {diastolic}")
        add(rng, facts, args, parts, "heart_rate_bpm", 42, 170, ("пульс {v}", "ЧСС {v}"))
        temp = round(rng.uniform(35.8, 40.3), 1)
        shown = fmt(temp).replace(".", ",") if rng.random() < 0.6 else fmt(temp)
        label = f"температура {shown}"
        facts.append(label)
        args["temperature_c"] = temp
        parts.append(f"'{label}' -> temperature_c {temp:g}")
        add(rng, facts, args, parts, "spo2_percent", 78, 100, ("SpO2 {v}%", "сатурация {v}%"))
        add(rng, facts, args, parts, "respiratory_rate_min", 12, 48, ("ЧДД {v}",))
        sentence = ", ".join(facts)
        sentence = sentence[0].upper() + sentence[1:]
        query = rng.choice(VITAL_FRAMES).format(facts=sentence)
        out.append((query, "extract_vitals", args, "; ".join(parts)))
    return out


def gen_search(
    rng: random.Random, specs: list[tuple[str, str | None, str | None]], count: int
) -> list[tuple[str, str | None, dict[str, Any], str]]:
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    if not specs:
        return out
    for _ in range(count):
        base_query, scope, section = rng.choice(specs)
        query = (
            base_query
            if rng.random() < 0.65
            else rng.choice(SEARCH_WRAP_FRAMES).format(q=base_query)
        )
        snippet = base_query if len(base_query) <= 48 else base_query[:45] + "…"
        args: dict[str, Any] = {"query": base_query}
        parts = [f"'{snippet}' -> query"]
        if scope is not None and rng.random() < 0.85:
            args["scope"] = scope
            parts.append(f"'источник' -> scope {scope}")
        if section is not None and rng.random() < 0.7:
            args["section"] = section
            parts.append(f"'раздел' -> section {section}")
        out.append((query, "search_medical_documents", args, "; ".join(parts)))
    return out


def gen_lookup(rng: random.Random, count: int) -> list[tuple[str, str | None, dict[str, Any], str]]:
    names = sorted(set(DRUG_TRADES) | {t for v in DRUG_TRADES.values() for t in v})
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for _ in range(count):
        name = rng.choice(names)
        args: dict[str, Any] = {"name": name}
        parts = [f"'{name}' -> name"]
        context = ""
        if rng.random() < 0.3:
            age = int(sample_value(rng, "age_years"))
            args["age_years"] = age
            parts.append(f"'{years_label(age)}' -> age_years {age}")
            context += f" для ребёнка {years_label(age)}"
        if rng.random() < 0.25:
            weight = sample_value(rng, "weight_kg")
            args["weight_kg"] = weight
            parts.append(f"'весит {fmt(weight)} кг' -> weight_kg {fmt(weight)}")
            context += f", весит {fmt(weight)} кг"
        frame = LOOKUP_FRAMES[rng.randrange(len(LOOKUP_FRAMES))]
        out.append((frame.format(n=name) + context, "lookup_drug", args, "; ".join(parts)))
    return out


def gen_interactions(
    rng: random.Random, count: int
) -> list[tuple[str, str | None, dict[str, Any], str]]:
    names = sorted(set(DRUG_TRADES) | {t for v in DRUG_TRADES.values() for t in v})
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for _ in range(count):
        first, second = rng.sample(names, 2)
        frame = INTERACTION_FRAMES[rng.randrange(len(INTERACTION_FRAMES))]
        query = frame.format(a=first, b=second)
        args = {"drug_a": first, "drug_b": second}
        reasoning = f"'{first}' -> drug_a; '{second}' -> drug_b"
        out.append((query, "find_interaction", args, reasoning))
    return out


def gen_icd(rng: random.Random, count: int) -> list[tuple[str, str | None, dict[str, Any], str]]:
    combos = [
        (condition, frame.format(c=condition))
        for condition, _ in ICD_CONDITIONS
        for frame in ICD_FRAMES
    ] + [(code, frame.format(c=code)) for _, code in ICD_CONDITIONS for frame in ICD_CODE_FRAMES]
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for i in range(count):
        value, query = combos[i % len(combos)]
        out.append((query, "find_icd", {"query": value}, f"'{value}' -> query"))
    return out


def gen_notes(rng: random.Random, count: int) -> list[tuple[str, str | None, dict[str, Any], str]]:
    combos = [(title, body, frame) for title, body in NOTE_SCENES for frame in NOTE_FRAMES]
    out: list[tuple[str, str | None, dict[str, Any], str]] = []
    for i in range(count):
        title, body, frame = combos[i % len(combos)]
        query = frame.format(t=title, b=body)
        args = {"title": title, "body": body}
        reasoning = f"'{title}' -> title; остаток строки -> body"
        out.append((query, "create_note", args, reasoning))
    return out


def gen_offtopic(
    rng: random.Random, count: int
) -> list[tuple[str, str | None, dict[str, Any], str]]:
    queries = _build_offtopic_queries()
    picked = rng.sample(queries, min(count, len(queries)))
    return [(query, None, {}, "") for query in picked]


def validate_samples(
    samples: list[dict[str, Any]],
    schemas: dict[str, dict[str, Any]],
    known_calculator_ids: frozenset[str],
) -> list[str]:
    errors: list[str] = []
    seen: set[tuple[str, str]] = set()
    for index, sample in enumerate(samples):
        where = f"sample[{index}]"
        declared = {str(tool.get("name")) for tool in sample["tools"]}
        unknown = declared - schemas.keys()
        if unknown:
            errors.append(f"{where}: unknown tools {sorted(unknown)}")
        answers = sample["answers"]
        is_offtopic = sample.get("_target") == "off-topic"
        if not answers and not is_offtopic:
            errors.append(f"{where}: empty answers outside off-topic")
        if answers and is_offtopic:
            errors.append(f"{where}: off-topic sample carries answers")
        for answer in answers:
            name = str(answer.get("name"))
            args = answer.get("arguments") or {}
            if name not in declared:
                errors.append(f"{where}: answered tool {name} is not declared")
                continue
            schema = schemas[name]
            properties = schema["parameters"].get("properties") or {}
            required = set(schema["parameters"].get("required") or [])
            for key, value in args.items():
                prop = properties.get(key)
                if prop is None:
                    errors.append(f"{where}: {name}.{key} is not a schema property")
                    continue
                enum_values = prop.get("enum")
                if enum_values and value not in enum_values:
                    errors.append(f"{where}: {name}.{key}={value!r} outside enum")
                expected_type = prop.get("type")
                numeric_value = isinstance(value, (int, float)) and not isinstance(value, bool)
                if expected_type == "number" and not numeric_value:
                    errors.append(f"{where}: {name}.{key}={value!r} must be a number")
                    continue
                if expected_type == "integer" and (
                    not isinstance(value, int) or isinstance(value, bool)
                ):
                    errors.append(f"{where}: {name}.{key}={value!r} must be an integer")
                    continue
                if expected_type == "string" and not isinstance(value, str):
                    errors.append(f"{where}: {name}.{key}={value!r} must be a string")
                    continue
                minimum, maximum = prop.get("minimum"), prop.get("maximum")
                if numeric_value and minimum is not None and value < minimum:
                    errors.append(f"{where}: {name}.{key}={value} below minimum")
                if numeric_value and maximum is not None and value > maximum:
                    errors.append(f"{where}: {name}.{key}={value} above maximum")
                if key == "calculator_id" and str(value) not in known_calculator_ids:
                    errors.append(f"{where}: unknown calculator_id {value}")
            missing = required - set(args)
            if missing:
                errors.append(f"{where}: {name} missing required args {sorted(missing)}")
            grounding_error = check_grounding(str(sample["query"]), args)
            if grounding_error is not None:
                errors.append(f"{where}: {grounding_error}")
        key = (str(sample["query"]), json.dumps(answers, sort_keys=True, ensure_ascii=False))
        if key in seen:
            errors.append(f"{where}: duplicate sample")
        seen.add(key)
    return errors


def split_stratified(
    samples: list[dict[str, Any]], val_fraction: float, rng: random.Random
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    groups: dict[str, list[int]] = {}
    for index, sample in enumerate(samples):
        groups.setdefault(str(sample["_target"]), []).append(index)
    val_indices: set[int] = set()
    for indices in groups.values():
        rng.shuffle(indices)
        size = max(1, math.ceil(len(indices) * val_fraction))
        val_indices.update(indices[:size])
    train = [s for i, s in enumerate(samples) if i not in val_indices]
    val = [samples[i] for i in sorted(val_indices)]
    return train, val


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            payload = {k: v for k, v in row.items() if k != "_target"}
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def generate_dataset(out_dir: Path, seed: int = 42, scale: float = 1.0) -> dict[str, int]:
    rng = random.Random(seed)
    schemas = load_tool_schemas()
    pool, calculator_ids = build_calculator_pool(schemas)
    search_specs = load_search_specs()

    triples: list[tuple[str, str | None, dict[str, Any], str]] = []
    triples.extend(gen_calculators(rng, pool, int(TARGET_COUNTS["run_calculator"] * scale)))
    triples.extend(gen_assessments(rng, int(TARGET_COUNTS["run_assessment"] * scale)))
    triples.extend(gen_labs(rng, int(TARGET_COUNTS["extract_labs"] * scale)))
    triples.extend(gen_vitals(rng, int(TARGET_COUNTS["extract_vitals"] * scale)))
    triples.extend(
        gen_search(rng, search_specs, int(TARGET_COUNTS["search_medical_documents"] * scale))
    )
    triples.extend(gen_lookup(rng, int(TARGET_COUNTS["lookup_drug"] * scale)))
    triples.extend(gen_interactions(rng, int(TARGET_COUNTS["find_interaction"] * scale)))
    triples.extend(gen_icd(rng, int(TARGET_COUNTS["find_icd"] * scale)))
    triples.extend(gen_notes(rng, int(TARGET_COUNTS["create_note"] * scale)))
    triples.extend(AMBIGUOUS)
    triples.extend(gen_offtopic(rng, int(OFF_TOPIC_COUNT * scale)))

    samples = [
        build_sample(rng, schemas, target, query, args, reasoning)
        for query, target, args, reasoning in triples
    ]

    unique: dict[tuple[str, str], dict[str, Any]] = {}
    duplicates_dropped = 0
    for sample in samples:
        key = (
            str(sample["query"]),
            json.dumps(sample["answers"], sort_keys=True, ensure_ascii=False),
        )
        if key in unique:
            duplicates_dropped += 1
            continue
        unique[key] = sample
    samples = list(unique.values())

    errors = validate_samples(samples, schemas, calculator_ids)
    if errors:
        shown = "\n".join(errors[:40])
        extra = f"\n(+{len(errors) - 40} more)" if len(errors) > 40 else ""
        raise RuntimeError(f"dataset validation failed:\n{shown}{extra}")

    train, val = split_stratified(samples, 0.1, rng)
    write_jsonl(out_dir / "train.jsonl", train)
    write_jsonl(out_dir / "val.jsonl", val)

    counts: Counter[str] = Counter(str(s["_target"]) for s in samples)
    stats = dict(counts)
    stats["train"] = len(train)
    stats["val"] = len(val)
    stats["duplicates_dropped"] = duplicates_dropped
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=REPO_ROOT / "data" / "needle")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--scale", type=float, default=1.0)
    options = parser.parse_args()
    stats = generate_dataset(options.out_dir, seed=options.seed, scale=options.scale)
    for name in sorted(stats):
        print(f"{stats[name]:5d}  {name}")


if __name__ == "__main__":
    main()
