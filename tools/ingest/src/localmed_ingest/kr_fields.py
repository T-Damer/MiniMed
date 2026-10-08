"""Medical field (specialty) of a source, derived from its own metadata and nothing else.

A term such as «депрессия» means different things in psychiatry, traumatology and
hematology. To tell which sense a doctor most likely wants, every definition carries the field
of the source that gave it. The field is read from facts the source states:

- a клинические рекомендации document lists its МКБ-10 codes; the chapter of those codes
  names the field (F00–F99 → психиатрия, S00–T98 → травматология, …);
- a krasotaimedicina.ru page lives under a rubric in its own address
  (`/diseases/psychiatric/depression`);
- a Wiktionary sense carries a usage label («психиатр.», «мед.») in its own text.

No model, no guess from the title. A source with no stated field has none.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True)
class Field:
    id: str
    label: str


GENERAL = Field("general", "общая медицина")
_FIELDS = {
    field.id: field
    for field in (
        GENERAL,
        Field("infectious", "инфекционные болезни"),
        Field("oncology", "онкология"),
        Field("hematology", "гематология"),
        Field("immunology", "иммунология"),
        Field("endocrinology", "эндокринология"),
        Field("psychiatry", "психиатрия"),
        Field("neurology", "неврология"),
        Field("ophthalmology", "офтальмология"),
        Field("otolaryngology", "оториноларингология"),
        Field("cardiology", "кардиология"),
        Field("pulmonology", "пульмонология"),
        Field("gastroenterology", "гастроэнтерология"),
        Field("dentistry", "стоматология"),
        Field("dermatology", "дерматология"),
        Field("rheumatology", "ревматология"),
        Field("orthopedics", "ортопедия"),
        Field("nephrology", "нефрология"),
        Field("urology", "урология"),
        Field("gynecology", "гинекология"),
        Field("obstetrics", "акушерство"),
        Field("neonatology", "неонатология"),
        Field("pediatrics", "педиатрия"),
        Field("genetics", "медицинская генетика"),
        Field("traumatology", "травматология"),
        Field("surgery", "хирургия"),
        Field("anesthesiology", "анестезиология"),
        Field("radiology", "лучевая диагностика"),
        Field("cosmetology", "косметология"),
        Field("allergology", "аллергология"),
        Field("phthisiology", "фтизиатрия"),
        Field("toxicology", "токсикология"),
        Field("rehabilitation", "реабилитация"),
        Field("emergency", "неотложные состояния"),
        Field("speech", "нарушения речи"),
        Field("narcology", "наркология"),
        Field("proctology", "проктология"),
        Field("mammology", "маммология"),
        Field("phlebology", "флебология"),
        Field("plastic", "пластическая хирургия"),
        Field("trichology", "трихология"),
        Field("venereology", "венерология"),
        Field("andrology", "андрология"),
    )
}

# Chapter ranges of МКБ-10 → field id. The first matching range wins, so narrower ranges
# come before the chapter that contains them.
_MKB_RANGES: tuple[tuple[str, str, str], ...] = (
    ("A15", "A19", "phthisiology"),
    ("A00", "B99", "infectious"),
    ("C00", "D48", "oncology"),
    ("D80", "D89", "immunology"),
    ("D50", "D77", "hematology"),
    ("E00", "E90", "endocrinology"),
    ("F10", "F19", "narcology"),
    ("F00", "F99", "psychiatry"),
    ("G00", "G99", "neurology"),
    ("H00", "H59", "ophthalmology"),
    ("H60", "H95", "otolaryngology"),
    ("I60", "I69", "neurology"),
    ("I00", "I99", "cardiology"),
    ("J00", "J99", "pulmonology"),
    ("K00", "K14", "dentistry"),
    ("K20", "K93", "gastroenterology"),
    ("L00", "L99", "dermatology"),
    ("M00", "M36", "rheumatology"),
    ("M40", "M99", "orthopedics"),
    ("N00", "N29", "nephrology"),
    ("N30", "N51", "urology"),
    ("N60", "N98", "gynecology"),
    ("O00", "O99", "obstetrics"),
    ("P00", "P96", "neonatology"),
    ("Q00", "Q99", "genetics"),
    ("S00", "T98", "traumatology"),
)

# krasotaimedicina.ru rubric (`/diseases/<rubric>/…`) → field id. Rubrics that are not a
# medical field («children», «cosmetic-defects» are audiences/themes) have no entry.
KRASOTAIMEDICINA_RUBRICS: dict[str, str] = {
    "children": "pediatrics",
    "zabolevanija_neurology": "neurology",
    "zabolevanija_gastroenterologia": "gastroenterology",
    "zabolevanija_gynaecology": "gynecology",
    "traumatology": "traumatology",
    "zabolevanija_dermatologia": "dermatology",
    "psychiatric": "psychiatry",
    "genetic": "genetics",
    "zabolevanija_pulmonology": "pulmonology",
    "zabolevanija_cardiology": "cardiology",
    "ophthalmology": "ophthalmology",
    "infectious": "infectious",
    "zabolevanija_stomatology": "dentistry",
    "zabolevanija_lor": "otolaryngology",
    "zabolevanija_urology": "urology",
    "oncologic": "oncology",
    "zabolevanija_endocrinology": "endocrinology",
    "zabolevanija_proctology": "proctology",
    "rheumatology": "rheumatology",
    "urgent": "emergency",
    "speech-disorder": "speech",
    "narcologic": "narcology",
    "hematologic": "hematology",
    "zabolevanija_andrology": "andrology",
    "zabolevanija_mammology": "mammology",
    "allergic": "allergology",
    "zabolevanija_phlebology": "phlebology",
    "problem-anaplasty": "plastic",
    "zabolevanija_cosmetology": "cosmetology",
    "immune": "immunology",
    "zabolevanija_venereology": "venereology",
    "zabolevanija_trihology": "trichology",
}

# krasotaimedicina.ru symptom rubric (`/symptom/<rubric>/…`) → field id. Only rubrics that name
# an organ system or a specialty are mapped; sensation and location rubrics have no field.
KRASOTAIMEDICINA_SYMPTOM_RUBRICS: dict[str, str] = {
    "blood": "hematology",
    "speech": "speech",
    "speech-distortion": "speech",
    "handwriting": "speech",
    "vision": "ophthalmology",
    "eye-discharge": "ophthalmology",
    "urine": "urology",
    "urinary": "urology",
    "stranguria": "urology",
    "painful-urination": "urology",
    "penile-discharge": "andrology",
    "men-itching": "andrology",
    "psycho-emotional": "psychiatry",
    "hallucination": "psychiatry",
    "senestopathy": "psychiatry",
    "digestive": "gastroenterology",
    "vomiting": "gastroenterology",
    "constipation": "gastroenterology",
    "diarrhea": "gastroenterology",
    "heartburn": "gastroenterology",
    "belching": "gastroenterology",
    "nausea": "gastroenterology",
    "stool": "gastroenterology",
    "abdominal-pain": "gastroenterology",
    "tremor": "neurology",
    "convulsion": "neurology",
    "paresis": "neurology",
    "paraparesis": "neurology",
    "involuntary-movement": "neurology",
    "movement-disorder": "neurology",
    "numbness": "neurology",
    "dizziness": "neurology",
    "headache": "neurology",
    "gait": "neurology",
    "neurological": "neurology",
    "ENT": "otolaryngology",
    "nasal-discharge": "otolaryngology",
    "ear-discharge": "otolaryngology",
    "cardiovascular": "cardiology",
    "heart-murmur": "cardiology",
    "cough": "pulmonology",
    "sputum": "pulmonology",
    "dyspnea": "pulmonology",
    "breath-sound": "pulmonology",
    "pathological-breathing": "pulmonology",
    "respiratory": "pulmonology",
    "rhonchi": "pulmonology",
    "vaginal-discharge": "gynecology",
    "menstrual": "gynecology",
    "nipple-discharge": "mammology",
    "female-genital-pain": "gynecology",
    "women-itching": "gynecology",
    "hot-flash": "gynecology",
    "itchy-skin": "dermatology",
    "hyperhidrosis": "dermatology",
    "fever": "infectious",
    "joint-pain": "rheumatology",
}

# Wiktionary usage labels at the start of a sense («психиатр. то же, что …»).
WIKTIONARY_LABELS: dict[str, str] = {
    "психиатр": "psychiatry",
    "невр": "neurology",
    "кардиол": "cardiology",
    "онкол": "oncology",
    "гематол": "hematology",
    "эндокрин": "endocrinology",
    "гастроэнтерол": "gastroenterology",
    "пульмонол": "pulmonology",
    "нефрол": "nephrology",
    "урол": "urology",
    "гинекол": "gynecology",
    "акуш": "obstetrics",
    "дермат": "dermatology",
    "ревматол": "rheumatology",
    "офтальмол": "ophthalmology",
    "отоларингол": "otolaryngology",
    "стомат": "dentistry",
    "травматол": "traumatology",
    "ортопед": "orthopedics",
    "хир": "surgery",
    "инфекц": "infectious",
    "аллергол": "allergology",
    "иммунол": "immunology",
    "генет": "genetics",
    "анестезиол": "anesthesiology",
    "радиол": "radiology",
    "токсикол": "toxicology",
    "мед": "general",
    "физиол": "general",
    "патол": "general",
    "анат": "general",
}
# English `sourceSubjects` slugs of the same source (`{"sourceSubjects":["psychiatry"]}`).
SUBJECT_SLUGS: dict[str, str] = {
    "psychiatry": "psychiatry",
    "neurology": "neurology",
    "cardiology": "cardiology",
    "oncology": "oncology",
    "hematology": "hematology",
    "endocrinology": "endocrinology",
    "gastroenterology": "gastroenterology",
    "pulmonology": "pulmonology",
    "nephrology": "nephrology",
    "urology": "urology",
    "gynecology": "gynecology",
    "obstetrics": "obstetrics",
    "dermatology": "dermatology",
    "rheumatology": "rheumatology",
    "ophthalmology": "ophthalmology",
    "otolaryngology": "otolaryngology",
    "dentistry": "dentistry",
    "traumatology": "traumatology",
    "orthopedics": "orthopedics",
    "surgery": "surgery",
    "infectious-diseases": "infectious",
    "allergology": "allergology",
    "immunology": "immunology",
    "genetics": "genetics",
    "anesthesiology": "anesthesiology",
    "radiology": "radiology",
    "toxicology": "toxicology",
    "medicine": "general",
    "physiology": "general",
    "pathology": "general",
    "anatomy": "general",
}
_MKB_CODE = re.compile(r"^([A-Z])(\d{2})")


def field_by_id(identifier: str) -> Field:
    return _FIELDS[identifier]


def all_fields() -> tuple[Field, ...]:
    return tuple(_FIELDS.values())


def field_for_mkb_code(code: str) -> str | None:
    """Field id of one МКБ-10 code (`S72.3` → `traumatology`), or `None` when unmapped."""
    match = _MKB_CODE.match(code.strip().upper())
    if not match:
        return None
    head = f"{match.group(1)}{match.group(2)}"
    for start, end, identifier in _MKB_RANGES:
        if start <= head <= end:
            return identifier
    return None


def field_for_mkb_codes(codes: Iterable[str]) -> str | None:
    """The field most of a document's МКБ-10 codes belong to; ties go to the first code."""
    found = [identifier for code in codes if (identifier := field_for_mkb_code(code))]
    if not found:
        return None
    counts = Counter(found)
    best = max(counts.values())
    return next(identifier for identifier in found if counts[identifier] == best)


def field_for_krasotaimedicina_url(url: str) -> str | None:
    """`https://www.krasotaimedicina.ru/diseases/psychiatric/depression` → `psychiatry`."""
    match = re.search(r"/diseases/([A-Za-z0-9_-]+)/", url)
    if match:
        return KRASOTAIMEDICINA_RUBRICS.get(match.group(1))
    symptom = re.search(r"/symptom/([A-Za-z0-9_-]+)/", url)
    return KRASOTAIMEDICINA_SYMPTOM_RUBRICS.get(symptom.group(1)) if symptom else None


def field_for_wiktionary_text(text: str) -> str | None:
    """Field of a Wiktionary sense from its leading usage label («психиатр. …»)."""
    match = re.match(r"^\s*([а-яё]+)\.", text.lower())
    if not match:
        return None
    label = match.group(1)
    for prefix, identifier in WIKTIONARY_LABELS.items():
        if label.startswith(prefix):
            return identifier
    return None


def field_for_subjects(subjects: Iterable[str]) -> str | None:
    """Field of a source that lists English subject slugs; the first specific one wins."""
    mapped = [SUBJECT_SLUGS[item] for item in subjects if item in SUBJECT_SLUGS]
    specific = [item for item in mapped if item != "general"]
    if specific:
        return specific[0]
    return mapped[0] if mapped else None
