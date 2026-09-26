# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "snowballstemmer==3.0.1",
# ]
# ///
"""Throwaway comparison of query-fact extraction: deterministic parser vs local LLM vs NER.

`run-llm` starts a loopback llama-server for one GGUF and asks for grammar-constrained JSON.
`score` maps every system into one coarse fact schema and scores it with the same relaxed
value matching, so format conventions of the deterministic parser do not decide the result.
Inputs come from `export-parser-llm-cases.ts`; outputs stay in the ignored data/build tree.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import snowballstemmer

ROOT = Path(__file__).resolve().parents[2]
WORK_DIR = ROOT / "data/build/parser-llm-poc"
CASES_PATH = WORK_DIR / "cases.jsonl"

FACT_TYPES = [
    "age",
    "sex",
    "weight",
    "gestational_age",
    "pregnancy",
    "duration",
    "temperature",
    "vital",
    "symptom",
    "investigation",
    "medication",
    "dose_form",
    "strength",
    "route",
    "frequency",
    "organ_function",
    "allergy",
]
POLARITIES = ["positive", "negative", "uncertain"]
INTENTS = [
    "diagnosis",
    "treatment",
    "medication",
    "disease-reference",
    "care-guidance",
    "administrative-reference",
    "mixed",
    "unknown",
]

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "intent": {"type": "string", "enum": INTENTS},
        "facts": {
            "type": "array",
            "maxItems": 16,
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "maxLength": 80},
                    "type": {"type": "string", "enum": FACT_TYPES},
                    "value": {"type": "string", "maxLength": 60},
                    "polarity": {"type": "string", "enum": POLARITIES},
                },
                "required": ["text", "type", "value", "polarity"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["intent", "facts"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """Ты извлекаешь факты из медицинского запроса врача на русском языке.
Верни только JSON. Ничего не придумывай: каждый факт должен опираться на фрагмент запроса.

Поля факта:
- text: дословный фрагмент запроса (скопируй символы как есть);
- type: тип факта;
- value: нормализованное значение;
- polarity: positive (есть), negative (отрицается, отсутствует, не принимал, не помог, исключено), uncertain (подозрение, возможно, кажется).

Типы и нормализация value:
- age: «N лет», «N месяцев», «N дней»; «полтора года» → «18 месяцев»; «1 год 3 месяца» → «15 месяцев»; новорождённый → «неонатальный период»;
- sex: «мужской» или «женский» (мальчик, мужчина → мужской; девочка, пациентка → женский);
- weight: «N кг» (десятичная точка);
- gestational_age: срок беременности «N недель»;
- pregnancy: «беременность»;
- duration: длительность, «N дней», «N недель», «N месяцев», «N часов», «N минут»; диапазон «5-7 дней»;
- temperature: число с точкой, например «38.5»;
- vital: АД, ЧСС/пульс, ЧДД, сатурация: «АД 120/80», «ЧСС 100», «ЧДД 30», «SpO2 95»;
- symptom: симптом, жалоба, синдром или диагноз в именительном падеже: «кашель», «боль в горле», «пневмония»;
- investigation: анализ или исследование с результатом: «СРБ 80», «ОАК: лейкоцитоз»;
- medication: препарат или группа препаратов: «парацетамол», «антибиотики»;
- dose_form: «сироп», «суспензия», «таблетки»;
- strength: дозировка препарата: «100 мг/5 мл», «1 г»;
- route: «внутривенно», «внутримышечно», «перорально», «ингаляционно», «ректально», «подкожно»;
- frequency: кратность приёма: «2 раза в сутки», «по необходимости»;
- organ_function: нарушение функции органа: «почечная недостаточность»;
- allergy: «аллергия на пенициллин» или «аллергия».

intent — что хочет врач: diagnosis (диагностика, анализы, что это за болезнь по симптомам), treatment (лечение, что делать), medication (препарат, доза, форма), disease-reference (что такое болезнь), care-guidance (уход, питание), administrative-reference (документы, приказы), mixed, unknown (неясно)."""

FEW_SHOT: list[tuple[str, dict[str, Any]]] = [
    (
        "Девочка 2 года 3 мес, насморк неделю, температуры нет, капли в нос какие?",
        {
            "intent": "medication",
            "facts": [
                {
                    "text": "Девочка",
                    "type": "sex",
                    "value": "женский",
                    "polarity": "positive",
                },
                {
                    "text": "2 года 3 мес",
                    "type": "age",
                    "value": "27 месяцев",
                    "polarity": "positive",
                },
                {
                    "text": "насморк",
                    "type": "symptom",
                    "value": "насморк",
                    "polarity": "positive",
                },
                {
                    "text": "неделю",
                    "type": "duration",
                    "value": "7 дней",
                    "polarity": "positive",
                },
                {
                    "text": "температуры нет",
                    "type": "symptom",
                    "value": "лихорадка",
                    "polarity": "negative",
                },
                {
                    "text": "капли в нос",
                    "type": "dose_form",
                    "value": "капли назальные",
                    "polarity": "positive",
                },
            ],
        },
    ),
    (
        "Мужчина 60 лет, возможно ТЭЛА, SpO2 90%, ЧСС 118, варфарин не получал, как обследовать",
        {
            "intent": "diagnosis",
            "facts": [
                {
                    "text": "Мужчина",
                    "type": "sex",
                    "value": "мужской",
                    "polarity": "positive",
                },
                {
                    "text": "60 лет",
                    "type": "age",
                    "value": "60 лет",
                    "polarity": "positive",
                },
                {
                    "text": "возможно ТЭЛА",
                    "type": "symptom",
                    "value": "тромбоэмболия легочной артерии",
                    "polarity": "uncertain",
                },
                {
                    "text": "SpO2 90%",
                    "type": "vital",
                    "value": "SpO2 90",
                    "polarity": "positive",
                },
                {
                    "text": "ЧСС 118",
                    "type": "vital",
                    "value": "ЧСС 118",
                    "polarity": "positive",
                },
                {
                    "text": "варфарин не получал",
                    "type": "medication",
                    "value": "варфарин",
                    "polarity": "negative",
                },
            ],
        },
    ),
]


# ---------------------------------------------------------------------------------------------
# LLM runner


def post_json(url: str, body: dict[str, Any], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_server(
    base_url: str, process: subprocess.Popen[bytes], timeout: float
) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"llama-server exited with {process.returncode}")
        try:
            with urllib.request.urlopen(f"{base_url}/health", timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            pass
        time.sleep(0.5)
    raise TimeoutError("llama-server did not become healthy")


def build_messages(query: str) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for example_query, example_answer in FEW_SHOT:
        messages.append({"role": "user", "content": example_query})
        messages.append(
            {
                "role": "assistant",
                "content": json.dumps(example_answer, ensure_ascii=False),
            }
        )
    messages.append({"role": "user", "content": query})
    return messages


def load_cases(limit_set: str | None = None) -> list[dict[str, Any]]:
    rows = [
        json.loads(line)
        for line in CASES_PATH.read_text("utf-8").splitlines()
        if line.strip()
    ]
    return [row for row in rows if limit_set is None or row["set"] == limit_set]


def run_llm(args: argparse.Namespace) -> None:
    model_path = Path(args.model).resolve()
    if not model_path.is_file():
        raise FileNotFoundError(model_path)
    cases = load_cases(args.only_set)
    if args.limit:
        cases = cases[: args.limit]
    port = args.port
    base_url = f"http://127.0.0.1:{port}"
    command = [
        "llama-server",
        "-m",
        str(model_path),
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "-c",
        "4096",
        "-np",
        "1",
        "-ngl",
        str(args.ngl),
        "--reasoning",
        "off",
        "--no-webui",
    ]
    if args.threads:
        command += ["-t", str(args.threads)]
    # Sanitized environment: no provider credentials or private paths reach the server.
    env = {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "HOME": str(Path.home())}
    log_path = WORK_DIR / f"llama-server-{args.name}.log"
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            command, stdout=log, stderr=subprocess.STDOUT, env=env
        )
        try:
            wait_for_server(base_url, process, timeout=180)
            # Warm-up request so model load and the shared prompt prefix are not charged to case 1.
            post_json(
                f"{base_url}/v1/chat/completions",
                {
                    "messages": build_messages("кашель"),
                    "max_tokens": 8,
                    "temperature": 0,
                },
                timeout=300,
            )
            output_path = WORK_DIR / f"pred-{args.name}.jsonl"
            with output_path.open("w", encoding="utf-8") as output:
                for index, case in enumerate(cases):
                    body = {
                        "messages": build_messages(case["query"]),
                        "temperature": 0,
                        "max_tokens": 900,
                        "response_format": {
                            "type": "json_schema",
                            "json_schema": {"name": "facts", "schema": RESPONSE_SCHEMA},
                        },
                    }
                    started = time.perf_counter()
                    error: str | None = None
                    parsed: dict[str, Any] | None = None
                    content = ""
                    timings: dict[str, Any] = {}
                    try:
                        response = post_json(
                            f"{base_url}/v1/chat/completions", body, timeout=600
                        )
                        content = response["choices"][0]["message"].get("content") or ""
                        timings = response.get("timings") or {}
                        parsed = json.loads(content)
                    except (
                        json.JSONDecodeError,
                        KeyError,
                        urllib.error.URLError,
                    ) as exc:
                        error = f"{type(exc).__name__}: {exc}"
                    elapsed_ms = (time.perf_counter() - started) * 1000
                    record = {
                        "id": case["id"],
                        "system": args.name,
                        "latency_ms": round(elapsed_ms, 1),
                        "predicted_tokens": timings.get("predicted_n"),
                        "prompt_tokens": timings.get("prompt_n"),
                        "error": error,
                        "raw": content if error else None,
                        "output": parsed,
                    }
                    output.write(json.dumps(record, ensure_ascii=False) + "\n")
                    output.flush()
                    if (index + 1) % 20 == 0:
                        print(f"  {args.name}: {index + 1}/{len(cases)}", flush=True)
            print(f"{args.name}: {len(cases)} predictions → {output_path}")
        finally:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()


# ---------------------------------------------------------------------------------------------
# Relaxed coarse scoring

STEMMER = snowballstemmer.stemmer("russian")
STOPWORDS = {
    "в",
    "во",
    "на",
    "при",
    "и",
    "с",
    "со",
    "по",
    "у",
    "от",
    "до",
    "за",
    "к",
    "о",
    "об",
    "не",
    "нет",
    "без",
    "есть",
    "был",
    "была",
    "было",
}
# Lenient scoring treats these as one "clinical finding" shelf: search uses the value, not the shelf.
FINDING_GROUP = {"symptom", "investigation", "vital", "temperature", "organ_function"}
NUMERIC_TYPES = {
    "age",
    "weight",
    "gestational_age",
    "duration",
    "temperature",
    "vital",
    "strength",
    "frequency",
}
SEX_WORDS = {
    "мужской": ("мальчик", "мужчин", "муж", "мужик", "юнош", "дедушк", "пациент", "м"),
    "женский": (
        "девочк",
        "женщин",
        "жен",
        "пациентк",
        "бабушк",
        "девушк",
        "мам",
        "ж",
        "кормящ",
    ),
}
ROUTE_WORDS = {
    "внутримышечно": ("в/м", "вм", "внутримыш"),
    "внутривенно": ("в/в", "вв", "внутривен"),
    "перорально": ("per os", "перорал", "внутрь"),
    "подкожно": ("п/к", "подкож"),
    "ингаляционно": ("ингаляц",),
    "ректально": ("ректал",),
}
UNIT_DAYS = [
    (re.compile(r"^(лет|год|года|годик|г|л)$"), 365.0),
    (re.compile(r"^мес"), 30.4),
    (re.compile(r"^нед"), 7.0),
    (re.compile(r"^(дн|ден|сут)"), 1.0),
    (re.compile(r"^час|^ч$"), 1 / 24),
    (re.compile(r"^мин"), 1 / 1440),
]


def clean(text: str) -> str:
    text = text.lower().replace("ё", "е").replace("–", "-").replace("—", "-")
    text = re.sub(r"(\d),(\d)", r"\1.\2", text)
    return re.sub(r"\s+", " ", text).strip()


def numbers(text: str) -> list[float]:
    return [float(value) for value in re.findall(r"\d+(?:\.\d+)?", clean(text))]


def stems(text: str) -> frozenset[str]:
    tokens = re.findall(r"[a-zа-я0-9]+", clean(text))
    return frozenset(
        STEMMER.stemWord(token) for token in tokens if token not in STOPWORDS
    )


def to_days(text: str) -> float | None:
    value = clean(text)
    if "полтора" in value:
        value = value.replace("полтора", "1.5")
    tokens = re.findall(r"\d+(?:\.\d+)?|[a-zа-я]+", value)
    total = 0.0
    found = False
    for index, token in enumerate(tokens):
        if not re.fullmatch(r"\d+(?:\.\d+)?", token):
            continue
        unit = tokens[index + 1] if index + 1 < len(tokens) else ""
        factor = next(
            (days for pattern, days in UNIT_DAYS if pattern.search(unit)), None
        )
        if factor is None:
            continue
        total += float(token) * factor
        found = True
    return total if found else None


def canonical_sex(text: str) -> str:
    value = clean(text)
    if value in SEX_WORDS:
        return value
    for canonical, prefixes in SEX_WORDS.items():
        for prefix in prefixes:
            if value == prefix or (len(prefix) > 2 and value.startswith(prefix)):
                return canonical
    return value


def canonical_route(text: str) -> str:
    value = clean(text)
    for canonical, prefixes in ROUTE_WORDS.items():
        if value == canonical or any(
            value.startswith(prefix) or prefix == value for prefix in prefixes
        ):
            return canonical
    return value


def edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for i, left_char in enumerate(left, 1):
        current = [i]
        for j, right_char in enumerate(right, 1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def stem_equal(left: str, right: str) -> bool:
    # Snowball leaves fleeting vowels apart (кашель → кашел, кашля → кашл); allow one edit.
    if left == right:
        return True
    if left.isdigit() or right.isdigit() or min(len(left), len(right)) < 4:
        return False
    return edit_distance(left, right) <= 1


def stems_subset(small: frozenset[str], large: frozenset[str]) -> bool:
    return all(any(stem_equal(item, other) for other in large) for item in small)


def text_match(left: str, right: str) -> bool:
    a, b = stems(left), stems(right)
    return bool(a) and bool(b) and (stems_subset(a, b) or stems_subset(b, a))


def value_match(fact_type: str, predicted: str, gold: str) -> bool:
    if fact_type == "sex":
        return canonical_sex(predicted) == canonical_sex(gold)
    if fact_type == "route":
        return canonical_route(predicted) == canonical_route(gold)
    if fact_type in {"age", "duration"}:
        left, right = to_days(predicted), to_days(gold)
        if left is not None and right is not None:
            return abs(left - right) <= max(0.5, 0.02 * right)
        if left is None and right is None:
            return text_match(predicted, gold)
        return False
    if fact_type in NUMERIC_TYPES:
        left, right = numbers(predicted), numbers(gold)
        if left and right:
            if fact_type in {"temperature", "gestational_age", "weight"}:
                return left[0] == right[0]
            return left == right
        if not left and not right:
            return text_match(predicted, gold)
        return False
    return text_match(predicted, gold)


@dataclass
class Fact:
    types: tuple[str, ...]
    values: tuple[str, ...]
    polarity: str | None
    optional: bool = False
    text: str | None = None

    def matches(self, other: Fact, lenient: bool = False) -> bool:
        other_types = set(other.types)
        if lenient and other_types & FINDING_GROUP:
            other_types |= FINDING_GROUP
        shared = [fact_type for fact_type in self.types if fact_type in other_types]
        return any(
            value_match(fact_type, left, right)
            for fact_type in shared
            for left in self.values
            for right in other.values
        )


FIXTURE_KIND = {
    "age": "age",
    "sex": "sex",
    "duration": "duration",
    "temperature": "temperature",
    "measurement": "vital",
    "symptom": "symptom",
    "investigation": "investigation",
    "medication": "medication",
    "weight": "weight",
    "route": "route",
    "dose-form": "dose_form",
    "strength": "strength",
    "frequency": "frequency",
    "gestational-age": "gestational_age",
    "pregnancy": "pregnancy",
    "organ-function": "organ_function",
    "allergy": "allergy",
}
NEGATIVE_FINDING_TYPES = (
    "symptom",
    "medication",
    "allergy",
    "organ_function",
    "pregnancy",
)


def fixture_types(kind: str, unit: str | None, value: str) -> tuple[str, ...] | None:
    if kind == "negative-finding":
        return NEGATIVE_FINDING_TYPES
    if kind == "measurement" and (
        (unit or "").strip() in {"кг", "г"} or clean(value).endswith("кг")
    ):
        return ("weight",)
    mapped = FIXTURE_KIND.get(kind)
    return (mapped,) if mapped else None


def dedupe(facts: list[Fact]) -> list[Fact]:
    unique: list[Fact] = []
    for fact in facts:
        if any(
            existing.polarity == fact.polarity
            and existing.types == fact.types
            and existing.matches(fact)
            for existing in unique
        ):
            continue
        unique.append(fact)
    # A generic symptom/negative finding that restates a more specific fact is not a second fact.
    specific = [fact for fact in unique if "symptom" not in fact.types]
    return [
        fact
        for fact in unique
        if "symptom" not in fact.types
        or not any(
            other.polarity == fact.polarity
            and any(
                text_match(left, right)
                for left in fact.values
                for right in other.values
            )
            for other in specific
        )
    ]


def gold_facts(case: dict[str, Any]) -> tuple[list[Fact], list[Fact], list[str]]:
    gold = case["gold"]
    intents = gold["intent"] if isinstance(gold["intent"], list) else [gold["intent"]]
    if gold["format"] == "coarse":
        facts = [
            Fact(
                types=tuple(item["type"])
                if isinstance(item["type"], list)
                else (item["type"],),
                values=tuple(item["value"])
                if isinstance(item["value"], list)
                else (item["value"],),
                polarity=item["polarity"],
                optional=bool(item.get("optional")),
            )
            for item in gold["facts"]
        ]
        return facts, [], intents
    facts: list[Fact] = []
    for item in [*gold["criticalContext"], *gold["negation"]]:
        types = fixture_types(item["kind"], item.get("unit"), item["normalizedValue"])
        if types is None:
            continue
        facts.append(
            Fact(types, (item["normalizedValue"], item["raw"]), item["polarity"])
        )
    forbidden: list[Fact] = []
    for item in gold["forbidden"]:
        types = fixture_types(item["kind"], item.get("unit"), item["normalizedValue"])
        if types is None:
            continue
        values = (item["normalizedValue"],) + (
            (item["raw"],) if item.get("raw") else ()
        )
        forbidden.append(Fact(types, values, item.get("polarity")))
    return dedupe(facts), forbidden, intents


def regex_prediction(case: dict[str, Any]) -> tuple[list[Fact], str, int]:
    facts: list[Fact] = []
    for item in case["regex"]["facts"]:
        types = fixture_types(item["kind"], item.get("unit"), item["normalizedValue"])
        if types is None:
            continue
        if item["kind"] == "negative-finding":
            types = ("symptom",)
        facts.append(
            Fact(
                types,
                (item["normalizedValue"], item["value"]),
                item["polarity"],
                text=item["value"],
            )
        )
    return dedupe(facts), case["regex"]["intent"], 0


def span_in_query(span: str, query: str) -> bool:
    return bool(span.strip()) and clean(span) in clean(query)


NEGATION_IN_SPAN = re.compile(
    r"(^|[^а-я])(нет|не|без|отсутств[а-я]*|исключен[а-я]*|отрица[а-я]*)([^а-я]|$)"
)
NEGATION_IN_CLAUSE = re.compile(
    r"(^|[^а-я])(нет|без|не было|не был|исключен[а-я]*|отсутств[а-я]*|отрица[а-я]*)([^а-я]|$)"
)
UNCERTAIN_CUE = re.compile(
    r"(подозрен[а-я]*|возможн[а-я]*|вероятн[а-я]*|кажется|под вопросом)"
)
SEX_LEXICON = re.compile(
    r"^(мальчик[а-я]*|девочк[а-я]*|мужчин[а-я]*|женщин[а-я]*|мужик[а-я]*|пациентк[а-я]*|бабушк[а-я]*|"
    r"дедушк[а-я]*|юнош[а-я]*|девушк[а-я]*|мам[а-я]*|кормящ[а-я]*|беременн[а-я]*|ж|м|муж|жен)$"
)


def clause_of(span: str, query: str) -> str:
    text = clean(query)
    start = text.find(clean(span))
    if start < 0:
        return clean(span)
    left = max(text.rfind(mark, 0, start) for mark in ",;.:")
    rights = [
        pos
        for pos in (text.find(mark, start + len(span)) for mark in ",;.")
        if pos >= 0
    ]
    return text[left + 1 : min(rights) if rights else len(text)]


def guard_fact(item: dict[str, Any], query: str) -> dict[str, Any] | None:
    """Deterministic post-checks a shipped adapter would own: polarity cues and explicit sex words."""
    span = clean(item["text"])
    if item["type"] == "sex":
        words = re.findall(r"[а-я]+", span)
        return (
            item
            if words and all(SEX_LEXICON.match(word) for word in words[:1])
            else None
        )
    clause = clause_of(item["text"], query)
    if NEGATION_IN_SPAN.search(span) or NEGATION_IN_CLAUSE.search(clause):
        return {**item, "polarity": "negative"}
    if UNCERTAIN_CUE.search(clause):
        return {**item, "polarity": "uncertain"}
    return item


def model_prediction(
    record: dict[str, Any], query: str, guard: bool = False
) -> tuple[list[Fact], str, int]:
    output = record.get("output") or {}
    hallucinated = 0
    facts: list[Fact] = []
    for item in output.get("facts", []):
        if item.get("type") not in FACT_TYPES or item.get("polarity") not in POLARITIES:
            hallucinated += 1
            continue
        if not span_in_query(item.get("text", ""), query):
            hallucinated += 1
            continue
        if guard:
            item = guard_fact(item, query)
            if item is None:
                continue
        values = tuple(
            value for value in (item.get("value", ""), item["text"]) if value
        )
        facts.append(Fact((item["type"],), values, item["polarity"], text=item["text"]))
    return dedupe(facts), output.get("intent", "unknown"), hallucinated


def union_prediction(
    regex: tuple[list[Fact], str, int], model: tuple[list[Fact], str, int]
) -> tuple[list[Fact], str, int]:
    """Deterministic facts stay authoritative; the model only adds facts regex did not find."""
    regex_facts, regex_intent, _ = regex
    model_facts, model_intent, hallucinated = model
    added = [
        fact
        for fact in model_facts
        if not any(fact.matches(existing) for existing in regex_facts)
    ]
    intent = regex_intent if regex_intent != "unknown" else model_intent
    return dedupe([*regex_facts, *added]), intent, hallucinated


@dataclass
class Tally:
    cases: int = 0
    tp: int = 0
    fp: int = 0
    fn: int = 0
    gold_negative: int = 0
    negative_recovered: int = 0
    polarity_flips: int = 0
    forbidden: int = 0
    intent_hits: int = 0
    hallucinated: int = 0
    invalid: int = 0
    latencies: list[float] = field(default_factory=list)
    fn_types: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        precision = self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0
        recall = self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0
        f1 = (
            2 * precision * recall / (precision + recall) if precision + recall else 0.0
        )
        latency = sorted(self.latencies)
        return {
            "cases": self.cases,
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "negative_recall": round(self.negative_recovered / self.gold_negative, 3)
            if self.gold_negative
            else None,
            "polarity_flips": self.polarity_flips,
            "forbidden_violations": self.forbidden,
            "intent_accuracy": round(self.intent_hits / self.cases, 3)
            if self.cases
            else 0.0,
            "dropped_ungrounded_facts": self.hallucinated,
            "invalid_outputs": self.invalid,
            "latency_p50_ms": round(statistics.median(latency), 1) if latency else None,
            "latency_p95_ms": round(
                latency[min(len(latency) - 1, int(0.95 * len(latency)))], 1
            )
            if latency
            else None,
            "missed_by_type": dict(
                sorted(self.fn_types.items(), key=lambda item: -item[1])
            ),
        }


def score_case(
    tally: Tally,
    gold: list[Fact],
    forbidden: list[Fact],
    intents: list[str],
    predicted: list[Fact],
    predicted_intent: str,
    lenient: bool = False,
) -> dict[str, Any]:
    tally.cases += 1
    tally.intent_hits += int(predicted_intent in intents)
    remaining = list(predicted)
    missed: list[Fact] = []
    for fact in [item for item in gold if not item.optional]:
        match = next(
            (
                p
                for p in remaining
                if p.polarity == fact.polarity and fact.matches(p, lenient)
            ),
            None,
        )
        if fact.polarity in {"negative", "uncertain"}:
            tally.gold_negative += 1
        if match is None:
            missed.append(fact)
            tally.fn += 1
            for fact_type in fact.types[:1]:
                tally.fn_types[fact_type] = tally.fn_types.get(fact_type, 0) + 1
            if any(
                p.polarity != fact.polarity and fact.matches(p, lenient)
                for p in remaining
            ):
                tally.polarity_flips += 1
            continue
        tally.tp += 1
        if fact.polarity in {"negative", "uncertain"}:
            tally.negative_recovered += 1
        remaining.remove(match)
    for fact in [item for item in gold if item.optional]:
        remaining = [p for p in remaining if not fact.matches(p, lenient)]
    tally.fp += len(remaining)
    violations = [
        item
        for item in forbidden
        if any(
            item.matches(p) and (item.polarity is None or item.polarity == p.polarity)
            for p in predicted
        )
    ]
    tally.forbidden += len(violations)
    return {
        "missed": [
            {"types": f.types, "values": f.values, "polarity": f.polarity}
            for f in missed
        ],
        "extra": [
            {"types": f.types, "values": f.values, "polarity": f.polarity}
            for f in remaining
        ],
    }


def score(args: argparse.Namespace) -> None:
    cases = load_cases()
    systems: dict[str, dict[str, dict[str, Any]]] = {"regex": {}}
    for path in sorted(WORK_DIR.glob("pred-*.jsonl")):
        name = path.stem.removeprefix("pred-")
        if args.systems and name not in args.systems:
            continue
        systems[name] = {}
        for line in path.read_text("utf-8").splitlines():
            record = json.loads(line)
            systems[name][record["id"]] = record
    for name in [name for name in systems if name != "regex"]:
        if args.guard:
            systems[f"{name}+guard"] = systems[name]
        if args.union:
            systems[f"regex+{name}"] = systems[name]
            if args.guard:
                systems[f"regex+{name}+guard"] = systems[name]
    report: dict[str, Any] = {}
    details: dict[str, Any] = {}
    for name, records in systems.items():
        per_set: dict[str, Tally] = {}
        strict_sets: dict[str, Tally] = {}
        details[name] = {}
        for case in cases:
            if name != "regex" and case["id"] not in records:
                continue
            gold, forbidden, intents = gold_facts(case)
            tally = per_set.setdefault(case["set"], Tally())
            overall = per_set.setdefault("all", Tally())
            if name == "regex":
                predicted, intent, hallucinated = regex_prediction(case)
                latency = None
            else:
                record = records[case["id"]]
                predicted, intent, hallucinated = model_prediction(
                    record, case["query"], guard=name.endswith("+guard")
                )
                if name.startswith("regex+"):
                    predicted, intent, hallucinated = union_prediction(
                        regex_prediction(case), (predicted, intent, hallucinated)
                    )
                latency = record.get("latency_ms")
                if record.get("error"):
                    tally.invalid += 1
                    overall.invalid += 1
            for target in (tally, overall):
                target.hallucinated += hallucinated
                if latency is not None:
                    target.latencies.append(latency)
            detail = score_case(
                tally, gold, forbidden, intents, predicted, intent, lenient=True
            )
            score_case(
                overall, gold, forbidden, intents, predicted, intent, lenient=True
            )
            for set_name in (case["set"], "all"):
                score_case(
                    strict_sets.setdefault(set_name, Tally()),
                    gold,
                    forbidden,
                    intents,
                    predicted,
                    intent,
                )
            if detail["missed"] or detail["extra"]:
                details[name][case["id"]] = {"query": case["query"], **detail}
        report[name] = {
            set_name: {
                **tally.as_dict(),
                "strict_type_f1": strict_sets[set_name].as_dict()["f1"],
            }
            for set_name, tally in per_set.items()
        }
    (WORK_DIR / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), "utf-8"
    )
    (WORK_DIR / "errors.json").write_text(
        json.dumps(details, ensure_ascii=False, indent=2), "utf-8"
    )
    header = f"{'system':<28}{'set':<11}{'P':>6}{'R':>6}{'F1':>6}{'F1str':>6}{'negR':>6}{'flip':>5}{'forb':>5}{'int':>6}{'drop':>5}{'inv':>4}{'p50ms':>8}{'p95ms':>8}"
    print(header)
    for name, sets in report.items():
        for set_name in ("fixtures", "generated", "ood", "all"):
            row = sets.get(set_name)
            if not row:
                continue
            print(
                f"{name:<28}{set_name:<11}{row['precision']:>6}{row['recall']:>6}{row['f1']:>6}{row['strict_type_f1']:>6}"
                f"{row['negative_recall']!s:>6}{row['polarity_flips']:>5}{row['forbidden_violations']:>5}"
                f"{row['intent_accuracy']:>6}{row['dropped_ungrounded_facts']:>5}{row['invalid_outputs']:>4}"
                f"{row['latency_p50_ms']!s:>8}{row['latency_p95_ms']!s:>8}"
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    llm = commands.add_parser("run-llm")
    llm.add_argument("--model", required=True)
    llm.add_argument("--name", required=True)
    llm.add_argument("--port", type=int, default=18_091)
    llm.add_argument("--ngl", type=int, default=99)
    llm.add_argument("--threads", type=int, default=0)
    llm.add_argument("--only-set", choices=["fixtures", "generated", "ood"])
    llm.add_argument("--limit", type=int, default=0)
    scorer = commands.add_parser("score")
    scorer.add_argument("--systems", nargs="*")
    scorer.add_argument(
        "--union", action="store_true", help="also score regex + each model"
    )
    scorer.add_argument(
        "--guard", action="store_true", help="also score deterministic post-checks"
    )
    args = parser.parse_args()
    if args.command == "run-llm":
        run_llm(args)
    else:
        score(args)


if __name__ == "__main__":
    main()
