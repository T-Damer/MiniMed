from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

REAL_POCQI_DATASET_ID = "jjfenglab/Real-POCQi"
REAL_POCQI_SPLIT = "questions"
REAL_POCQI_LICENSE = "CC-BY-4.0"
REAL_POCQI_SOURCE_URL = "https://huggingface.co/datasets/jjfenglab/Real-POCQi"
REAL_POCQI_API_URL = "https://datasets-server.huggingface.co/rows"
REAL_POCQI_CITATION = (
    "Feng J, Patel V, Heagerty P, et al. Expert Evaluation of Clinical AI Tools "
    "on Real Point-of-Care Clinical Queries. 2026. arXiv:2606.28960."
)

ProvenanceClass = Literal[
    "real_clinician_query", "ru_source_reconstructed", "synthetic_edge_case"
]
ReviewStatus = Literal["candidate", "source_validated", "clinician_reviewed"]


class RealPocqiQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: str = Field(min_length=1)
    question_text: str = Field(min_length=1)
    specialty: str = Field(min_length=1)

    @model_validator(mode="after")
    def normalize(self) -> RealPocqiQuestion:
        self.question_id = self.question_id.strip()
        self.question_text = " ".join(self.question_text.split())
        self.specialty = " ".join(self.specialty.split())
        if not self.question_id or not self.question_text or not self.specialty:
            raise ValueError("Real-POCQi rows cannot contain blank fields.")
        return self


class _DatasetServerRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    row: RealPocqiQuestion


class _DatasetServerPage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    rows: list[_DatasetServerRow]
    num_rows_total: int = Field(ge=0)


class ScenarioSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dataset_id: str
    split: str
    record_id: str
    source_url: str
    license: str
    citation: str


class ClinicalQueryScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = 1
    id: str
    provenance: ProvenanceClass
    review_status: ReviewStatus = "candidate"
    language: str
    jurisdiction: str
    specialty: str
    query: str
    patient_specific: bool
    source: ScenarioSource


class ClinicalQueryImportReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generated_at: str
    dataset_id: str
    dataset_split: str
    source_count: int = Field(ge=0)
    selected_count: int = Field(ge=0)
    requested_count: int = Field(ge=1)
    seed: str
    source_sha256: str
    output_sha256: str
    specialty_counts_source: dict[str, int]
    specialty_counts_selected: dict[str, int]
    patient_specific_selected: int = Field(ge=0)
    cache_pages_used: int = Field(ge=0)
    remote_pages_downloaded: int = Field(ge=0)


def _utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_bytes(payload)
    temporary.replace(path)


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _validate_questions(questions: list[RealPocqiQuestion]) -> list[RealPocqiQuestion]:
    if not questions:
        raise ValueError("The clinical query source contains no questions.")
    identifiers: set[str] = set()
    normalized_texts: set[str] = set()
    for question in questions:
        if question.question_id in identifiers:
            raise ValueError(f"Duplicate question id: {question.question_id}")
        normalized = question.question_text.casefold()
        if normalized in normalized_texts:
            raise ValueError(f"Duplicate normalized question text: {question.question_id}")
        identifiers.add(question.question_id)
        normalized_texts.add(normalized)
    return questions


def load_real_pocqi_snapshot(path: Path) -> list[RealPocqiQuestion]:
    payload: object = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict) and isinstance(payload.get("questions"), list):
        rows = payload["questions"]
    elif isinstance(payload, list):
        rows = payload
    else:
        raise ValueError("Snapshot must be a JSON array or an object with a questions array.")
    return _validate_questions([RealPocqiQuestion.model_validate(row) for row in rows])


def _fetch_page(offset: int, length: int, timeout_seconds: float) -> bytes:
    query = urllib.parse.urlencode(
        {
            "dataset": REAL_POCQI_DATASET_ID,
            "config": "default",
            "split": REAL_POCQI_SPLIT,
            "offset": offset,
            "length": length,
        }
    )
    request = urllib.request.Request(
        f"{REAL_POCQI_API_URL}?{query}",
        headers={
            "Accept": "application/json",
            "User-Agent": "MiniMed-Medbase/1.0 (+https://github.com/T-Damer/MiniMed)",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        final_url = urllib.parse.urlparse(str(response.geturl()))
        if final_url.scheme != "https" or final_url.hostname != "datasets-server.huggingface.co":
            raise ValueError("Real-POCQi request redirected to an unexpected host.")
        payload = response.read(2 * 1024 * 1024 + 1)
    if len(payload) > 2 * 1024 * 1024:
        raise ValueError("Real-POCQi API page exceeds the 2 MiB safety limit.")
    return payload


def fetch_real_pocqi_questions(
    cache_root: Path,
    *,
    offline: bool = False,
    timeout_seconds: float = 60.0,
    page_size: int = 100,
) -> tuple[list[RealPocqiQuestion], int, int]:
    if page_size < 1 or page_size > 100:
        raise ValueError("Real-POCQi page size must be between 1 and 100.")
    questions: list[RealPocqiQuestion] = []
    offset = 0
    total: int | None = None
    cache_pages_used = 0
    remote_pages_downloaded = 0
    while total is None or offset < total:
        cache_path = cache_root / f"real-pocqi.questions.{offset:04d}.json"
        payload: bytes
        if offline:
            if not cache_path.is_file():
                raise FileNotFoundError(f"Missing cached Real-POCQi page: {cache_path}")
            payload = cache_path.read_bytes()
            cache_pages_used += 1
        else:
            try:
                payload = _fetch_page(offset, page_size, timeout_seconds)
                json.loads(payload.decode("utf-8"))
                _write_atomic(cache_path, payload)
                remote_pages_downloaded += 1
            except (urllib.error.URLError, TimeoutError, OSError, ValueError):
                if not cache_path.is_file():
                    raise
                payload = cache_path.read_bytes()
                cache_pages_used += 1
        page = _DatasetServerPage.model_validate_json(payload)
        if total is None:
            total = page.num_rows_total
        elif total != page.num_rows_total:
            raise ValueError("Real-POCQi total row count changed during pagination.")
        if not page.rows and offset < total:
            raise ValueError(f"Real-POCQi returned an empty page at offset {offset}.")
        questions.extend(item.row for item in page.rows)
        offset += len(page.rows)
    validated = _validate_questions(questions)
    if total is None or len(validated) != total:
        raise ValueError(f"Expected {total} Real-POCQi questions, received {len(validated)}.")
    return validated, cache_pages_used, remote_pages_downloaded


def _stable_rank(seed: str, question: RealPocqiQuestion) -> str:
    return hashlib.sha256(f"{seed}\0{question.question_id}".encode()).hexdigest()


def _specialty_quotas(questions: list[RealPocqiQuestion], count: int) -> dict[str, int]:
    available = Counter(question.specialty for question in questions)
    if count >= len(questions):
        return dict(available)
    ideals = {specialty: amount * count / len(questions) for specialty, amount in available.items()}
    quotas = {specialty: int(value) for specialty, value in ideals.items()}
    remaining = count - sum(quotas.values())
    order = sorted(
        available,
        key=lambda specialty: (-(ideals[specialty] - quotas[specialty]), specialty.casefold()),
    )
    for specialty in order:
        if remaining == 0:
            break
        if quotas[specialty] < available[specialty]:
            quotas[specialty] += 1
            remaining -= 1
    if remaining != 0:
        raise RuntimeError("Could not allocate all specialty sample slots.")
    return quotas


def sample_real_pocqi_questions(
    questions: list[RealPocqiQuestion], count: int, seed: str
) -> list[RealPocqiQuestion]:
    if count < 1:
        raise ValueError("Sample count must be positive.")
    if not seed.strip():
        raise ValueError("Sample seed cannot be blank.")
    quotas = _specialty_quotas(questions, min(count, len(questions)))
    grouped: dict[str, list[RealPocqiQuestion]] = defaultdict(list)
    for question in questions:
        grouped[question.specialty].append(question)
    selected: list[RealPocqiQuestion] = []
    for specialty, quota in quotas.items():
        ranked = sorted(grouped[specialty], key=lambda question: _stable_rank(seed, question))
        selected.extend(ranked[:quota])
    return sorted(selected, key=lambda question: _stable_rank(seed, question))


_PATIENT_CONTEXT = re.compile(
    r"\b(?:patient|man|woman|male|female|boy|girl|child|infant|newborn|adolescent|"
    r"\d{1,3}[ -]?(?:year|month|day)s?[ -]?old|weigh(?:s|ing)|presents? with|history of)\b",
    re.IGNORECASE,
)


def _scenario(question: RealPocqiQuestion) -> ClinicalQueryScenario:
    return ClinicalQueryScenario(
        id=f"real-pocqi.{question.question_id}",
        provenance="real_clinician_query",
        language="en",
        jurisdiction="US",
        specialty=question.specialty,
        query=question.question_text,
        patient_specific=bool(_PATIENT_CONTEXT.search(question.question_text)),
        source=ScenarioSource(
            dataset_id=REAL_POCQI_DATASET_ID,
            split=REAL_POCQI_SPLIT,
            record_id=question.question_id,
            source_url=REAL_POCQI_SOURCE_URL,
            license=REAL_POCQI_LICENSE,
            citation=REAL_POCQI_CITATION,
        ),
    )


def import_real_pocqi_benchmark(
    output: Path,
    *,
    report_path: Path | None = None,
    snapshot: Path | None = None,
    cache_root: Path = Path(".cache/localmed/clinical-queries"),
    count: int = 120,
    seed: str = "minimed-real-pocqi-v1",
    offline: bool = False,
    timeout_seconds: float = 60.0,
) -> ClinicalQueryImportReport:
    if snapshot is not None:
        questions = load_real_pocqi_snapshot(snapshot)
        cache_pages_used = 0
        remote_pages_downloaded = 0
    else:
        questions, cache_pages_used, remote_pages_downloaded = fetch_real_pocqi_questions(
            cache_root, offline=offline, timeout_seconds=timeout_seconds
        )
    selected = sample_real_pocqi_questions(questions, count, seed)
    scenarios = [_scenario(question) for question in selected]
    output_payload = b"".join(
        (
            json.dumps(scenario.model_dump(mode="json"), ensure_ascii=False, sort_keys=True) + "\n"
        ).encode("utf-8")
        for scenario in scenarios
    )
    _write_atomic(output, output_payload)
    source_payload = _json_bytes(
        [
            question.model_dump(mode="json")
            for question in sorted(questions, key=lambda row: row.question_id)
        ]
    )
    report = ClinicalQueryImportReport(
        generated_at=_utc_now(),
        dataset_id=REAL_POCQI_DATASET_ID,
        dataset_split=REAL_POCQI_SPLIT,
        source_count=len(questions),
        selected_count=len(selected),
        requested_count=count,
        seed=seed,
        source_sha256=_sha256(source_payload),
        output_sha256=_sha256(output_payload),
        specialty_counts_source=dict(sorted(Counter(row.specialty for row in questions).items())),
        specialty_counts_selected=dict(sorted(Counter(row.specialty for row in selected).items())),
        patient_specific_selected=sum(scenario.patient_specific for scenario in scenarios),
        cache_pages_used=cache_pages_used,
        remote_pages_downloaded=remote_pages_downloaded,
    )
    if report_path is not None:
        _write_atomic(report_path, _json_bytes(report.model_dump(mode="json")))
    return report
