# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = [
#   "gliner2[local]==2.0.0",
#   "protobuf>=5,<7",
#   "sentencepiece>=0.2,<0.3",
# ]
# ///
"""Zero-shot GLiNER2 baseline for the throwaway parser comparison in `parser_llm_poc.py`.

No fine-tuning: labels and descriptions are the only task definition. Values are the raw spans;
polarity comes only from negated/suspected label variants. Predictions are written in the same
record shape as the LLM runner and scored by `parser_llm_poc.py score`.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from gliner2 import AutoExtractor

ROOT = Path(__file__).resolve().parents[2]
WORK_DIR = ROOT / "data/build/parser-llm-poc"

# label → (coarse type, polarity, description)
LABELS: dict[str, tuple[str, str, str]] = {
    "age": ("age", "positive", "Patient age, e.g. '5 лет', '7 мес', 'полтора года'"),
    "sex": (
        "sex",
        "positive",
        "Patient sex or gender word, e.g. 'мальчик', 'женщина', 'пациентка'",
    ),
    "body weight": ("weight", "positive", "Patient body weight, e.g. '12 кг'"),
    "gestational age": (
        "gestational_age",
        "positive",
        "Pregnancy term in weeks, e.g. '32 нед'",
    ),
    "pregnancy": ("pregnancy", "positive", "Mention that the patient is pregnant"),
    "absent pregnancy": (
        "pregnancy",
        "negative",
        "Pregnancy explicitly denied or excluded",
    ),
    "duration": (
        "duration",
        "positive",
        "How long something lasts, e.g. '3 дня', '2 недели'",
    ),
    "body temperature": (
        "temperature",
        "positive",
        "Body temperature value, e.g. 't 38,5', 'температура 39'",
    ),
    "vital sign": (
        "vital",
        "positive",
        "Blood pressure, heart rate, respiratory rate or oxygen saturation with value",
    ),
    "symptom or diagnosis": (
        "symptom",
        "positive",
        "Present complaint, clinical sign, syndrome or disease",
    ),
    "absent symptom": (
        "symptom",
        "negative",
        "Symptom or sign explicitly denied, e.g. 'кашля нет', 'без сыпи', 'не лихорадит'",
    ),
    "suspected diagnosis": (
        "symptom",
        "uncertain",
        "Disease that is only suspected or possible",
    ),
    "lab or test result": (
        "investigation",
        "positive",
        "Laboratory or instrumental test with its result, e.g. 'СРБ 80'",
    ),
    "medication": (
        "medication",
        "positive",
        "Drug or drug class the patient takes or the question is about",
    ),
    "failed or not taken medication": (
        "medication",
        "negative",
        "Drug that was not taken or did not help",
    ),
    "dosage form": (
        "dose_form",
        "positive",
        "Drug form such as 'сироп', 'суспензия', 'таблетки'",
    ),
    "drug strength": (
        "strength",
        "positive",
        "Drug strength or concentration such as '100 мг/5 мл'",
    ),
    "route of administration": (
        "route",
        "positive",
        "How a drug is given, e.g. 'в/м', 'внутривенно'",
    ),
    "dosing frequency": (
        "frequency",
        "positive",
        "How often a drug is given, e.g. '2 раза в день'",
    ),
    "organ dysfunction": (
        "organ_function",
        "positive",
        "Kidney or liver failure or other organ dysfunction",
    ),
    "absent organ dysfunction": (
        "organ_function",
        "negative",
        "Organ dysfunction explicitly denied",
    ),
    "drug allergy": ("allergy", "positive", "Allergy to a drug or substance"),
    "absent allergy": (
        "allergy",
        "negative",
        "Allergy explicitly denied, e.g. 'аллергии нет'",
    ),
}
INTENT_LABELS = [
    "diagnosis",
    "treatment",
    "medication",
    "disease-reference",
    "care-guidance",
    "administrative-reference",
    "unknown",
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="fastino/gliner2.5-multi-v1")
    parser.add_argument("--name", default="gliner2.5-multi")
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()

    cases = [
        json.loads(line)
        for line in (WORK_DIR / "cases.jsonl").read_text("utf-8").splitlines()
        if line.strip()
    ]
    started = time.perf_counter()
    model = AutoExtractor.from_pretrained(args.model)
    print(f"loaded {args.model} in {time.perf_counter() - started:.1f}s", flush=True)
    schema = {label: description for label, (_, _, description) in LABELS.items()}
    model.extract_entities("кашель", schema)  # warm-up

    output_path = WORK_DIR / f"pred-{args.name}.jsonl"
    with output_path.open("w", encoding="utf-8") as output:
        for case in cases:
            query = case["query"]
            started = time.perf_counter()
            entities = model.extract_entities(
                query, schema, threshold=args.threshold, include_spans=True
            )["entities"]
            intent = model.classify_text(query, {"intent": INTENT_LABELS})["intent"]
            elapsed_ms = (time.perf_counter() - started) * 1000
            facts = []
            for label, spans in entities.items():
                fact_type, polarity, _ = LABELS[label]
                for span in spans:
                    text = span["text"] if isinstance(span, dict) else span
                    facts.append(
                        {
                            "text": text,
                            "type": fact_type,
                            "value": text,
                            "polarity": polarity,
                        }
                    )
            record = {
                "id": case["id"],
                "system": args.name,
                "latency_ms": round(elapsed_ms, 1),
                "error": None,
                "output": {
                    "intent": intent if isinstance(intent, str) else intent["label"],
                    "facts": facts,
                },
            }
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"{args.name}: {len(cases)} predictions → {output_path}")


if __name__ == "__main__":
    main()
