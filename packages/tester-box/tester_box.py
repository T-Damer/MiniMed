"""Full-corpus retrieval and local-model contract experiment."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import time
import unicodedata
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INDEX = ROOT / ".cache/tester-box/full-corpus-index.db"
DEFAULT_CASES = Path(__file__).with_name("cases.json")
DEFAULT_CATALOG = ROOT / "apps/app/src/features/models/catalog.preview.json"
DEFAULT_MODELS = ROOT / ".cache/tester-box/models"
DEFAULT_REPORT = Path(__file__).parent / "reports/latest.md"
MODEL_IDS = (
    "vikhr-qwen2.5-0.5b-q4",
    "qwen3-0.6b-q8",
    "qvikhr-3-1.7b-q4",
)
STOP_WORDS = {
    "без",
    "бы",
    "в",
    "во",
    "для",
    "до",
    "же",
    "и",
    "из",
    "или",
    "к",
    "как",
    "ко",
    "ли",
    "на",
    "не",
    "но",
    "о",
    "об",
    "от",
    "по",
    "под",
    "при",
    "с",
    "со",
    "у",
    "что",
    "это",
}
STRUCTURAL_TERMS = {
    "возраст",
    "пол",
    "мальчик",
    "мальчику",
    "девочка",
    "девочке",
    "ребенок",
    "ребенку",
    "пациент",
    "пациентка",
    "мужчина",
    "женщина",
    "лет",
    "год",
    "года",
    "месяц",
    "месяца",
    "месяцев",
    "день",
    "дня",
    "дней",
    "час",
    "часа",
    "часов",
    "неделя",
    "недели",
    "недель",
    "сегодня",
    "вчера",
    "часто",
    "быстро",
    "дышит",
    "дышать",
    "позавчера",
    "жалоба",
    "жалобы",
    "анамнез",
    "нет",
    "принимает",
    "получает",
    "назначен",
    "назначена",
    "первый",
    "второй",
    "третий",
    "четвертый",
    "пятый",
}
SUFFIXES = sorted(
    (
        "иями",
        "ями",
        "ами",
        "ого",
        "ему",
        "ому",
        "ыми",
        "ими",
        "иях",
        "ях",
        "ах",
        "ение",
        "ания",
        "ений",
        "ание",
        "ость",
        "ости",
        "его",
        "ая",
        "яя",
        "ое",
        "ее",
        "ые",
        "ие",
        "ой",
        "ей",
        "ий",
        "ый",
        "ам",
        "ям",
        "ом",
        "ем",
        "ов",
        "ев",
        "ия",
        "ья",
        "ью",
        "ы",
        "и",
        "а",
        "я",
        "у",
        "ю",
        "е",
        "о",
    ),
    key=len,
    reverse=True,
)
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
NUMBER_WITH_UNIT = re.compile(
    r"(?<![\w.,])(\d+(?:[.,]\d+)?)\s*(мкг|мг|г|мл|ме|ед)(?!\w)", re.IGNORECASE
)


@dataclass(frozen=True)
class Evidence:
    citation_id: str
    chunk_id: str
    document_id: str
    title: str
    source_type: str
    version_label: str
    section_title: str
    section_path: str
    text: str
    source_db: str
    rank: float


@dataclass(frozen=True)
class Model:
    id: str
    name: str
    path: Path
    sha256: str
    context_tokens: int


@dataclass
class Run:
    case_id: str
    query: str
    purpose: str
    model_id: str
    model_name: str
    strategy: str
    retrieval_ms: float
    model_ms: float
    attempts: int
    answer: str
    parsed: dict[str, Any] | None
    validation_errors: list[str]
    expected_status: bool | None
    evidence: list[Evidence]


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    value = re.sub(r"[‐‑‒–—−]", "-", value)
    value = re.sub(r"[^0-9a-zа-я\s.,:+/%-]", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def tokenize(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[0-9a-zа-я]+", normalize(value))
        if len(token) >= 2 and token not in STOP_WORDS
    ]


def stem(token: str) -> str:
    if len(token) < 5 or not re.search(r"[а-я]", token):
        return token
    for suffix in SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= 4:
            return token[: -len(suffix)]
    return token


def fts_query(value: str) -> str:
    terms = dict.fromkeys(
        form
        for token in tokenize(value)
        if not token.isdigit() and token not in STRUCTURAL_TERMS
        for form in (token, stem(token))
    )
    return " OR ".join(f'"{term.replace(chr(34), chr(34) * 2)}"*' for term in terms)


def discover_databases(paths: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for path in paths:
        if path.is_file() and path.suffix == ".db":
            found.add(path.resolve())
        elif path.is_dir():
            found.update(item.resolve() for item in path.rglob("*.db"))
    return sorted(found)


def build_index(index_path: Path, source_paths: list[Path]) -> dict[str, int]:
    databases = discover_databases(source_paths)
    if not databases:
        raise SystemExit("No source SQLite databases found.")
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.unlink(missing_ok=True)
    target = sqlite3.connect(index_path)
    target.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE evidence (
          evidence_id INTEGER PRIMARY KEY,
          chunk_id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          title TEXT NOT NULL,
          source_type TEXT NOT NULL,
          version_label TEXT NOT NULL,
          section_title TEXT NOT NULL,
          section_path TEXT NOT NULL,
          original_text TEXT NOT NULL,
          normalized_text TEXT NOT NULL,
          source_db TEXT NOT NULL,
          UNIQUE (document_id, chunk_id)
        );
        CREATE VIRTUAL TABLE evidence_fts USING fts5(
          evidence_id UNINDEXED,
          title,
          section_path,
          normalized_text,
          tokenize = 'unicode61 remove_diacritics 2',
          prefix = '2 3 4'
        );
        """
    )
    inserted = 0
    skipped = 0
    for number, path in enumerate(databases, 1):
        source = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)
        tables = {
            row[0]
            for row in source.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if not {"chunks", "sections", "documents", "document_versions"} <= tables:
            skipped += 1
            source.close()
            continue
        rows = source.execute(
            """
            SELECT c.id, d.id, d.title, d.source_type, dv.version_label,
                   s.title, s.path_json, c.original_text, c.normalized_text
            FROM chunks c
            JOIN sections s ON s.id = c.section_id
            JOIN document_versions dv ON dv.id = c.document_version_id
            JOIN documents d ON d.id = dv.document_id
            """
        ).fetchall()
        before = target.total_changes
        target.executemany(
            """
            INSERT OR IGNORE INTO evidence (
              chunk_id, document_id, title, source_type, version_label,
              section_title, section_path, original_text, normalized_text, source_db
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ((*row, path.name) for row in rows),
        )
        inserted += target.total_changes - before
        target.commit()
        source.close()
        if number % 50 == 0 or number == len(databases):
            print(
                f"Indexed {number}/{len(databases)} databases, {inserted} unique chunks"
            )
    target.execute(
        """
        INSERT INTO evidence_fts (evidence_id, title, section_path, normalized_text)
        SELECT evidence_id, title, section_path, normalized_text FROM evidence
        """
    )
    target.execute("INSERT INTO evidence_fts(evidence_fts) VALUES ('optimize')")
    target.commit()
    documents = target.execute(
        "SELECT count(DISTINCT document_id) FROM evidence"
    ).fetchone()[0]
    target.close()
    return {
        "sourceDatabases": len(databases),
        "skippedDatabases": skipped,
        "documents": int(documents),
        "chunks": inserted,
    }


def search(
    index: sqlite3.Connection, query: str, limit: int = 80
) -> list[dict[str, Any]]:
    expression = fts_query(query)
    if not expression:
        return []
    index.row_factory = sqlite3.Row
    return [
        dict(row)
        for row in index.execute(
            """
            SELECT e.*, bm25(evidence_fts, 0, 8.0, 4.0, 1.0) AS rank
            FROM evidence_fts
            JOIN evidence e ON e.evidence_id = evidence_fts.evidence_id
            WHERE evidence_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (expression, limit),
        ).fetchall()
    ]


def excerpt(text: str, queries: list[str], limit: int = 1100) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    haystack = normalize(compact)
    forms = {
        form
        for query in queries
        for token in tokenize(query)
        if token not in STRUCTURAL_TERMS and not token.isdigit()
        for form in (token, stem(token))
        if len(form) >= 4
    }
    positions = [
        position
        for form in sorted(forms, key=len, reverse=True)
        if (position := haystack.find(form)) >= 0
    ]
    if not positions:
        return compact[:limit]
    start = max(0, positions[0] - 240)
    return compact[start : start + limit]


def query_coverage(row: dict[str, Any], query: str) -> int:
    haystack = normalize(
        f"{row['title']} {row['section_path']} {row['normalized_text']}"
    )
    terms = {
        token
        for token in tokenize(query)
        if token not in STRUCTURAL_TERMS and not token.isdigit()
    }
    return sum(
        2
        if re.search(rf"\b{re.escape(token)}\b", haystack)
        else 1
        if stem(token) in haystack
        else 0
        for token in terms
    )


def select_evidence(index: sqlite3.Connection, case: dict[str, Any]) -> list[Evidence]:
    rows = search(index, str(case["query"]))
    pinned: list[dict[str, Any]] = []
    for probe in case.get("evidenceQueries", []):
        matches = sorted(
            search(index, str(probe), 12),
            key=lambda row: (-query_coverage(row, str(probe)), float(row["rank"])),
        )[:1]
        pinned.extend(matches)
        rows.extend(matches)

    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        key = (str(row["document_id"]), str(row["chunk_id"]))
        previous = unique.get(key)
        if previous is None or float(row["rank"]) < float(previous["rank"]):
            unique[key] = row

    by_document: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in sorted(unique.values(), key=lambda item: float(item["rank"])):
        by_document[str(row["document_id"])].append(row)

    selected = list(
        {
            (str(row["document_id"]), str(row["chunk_id"])): row for row in pinned
        }.values()
    )
    selected_keys = {
        (str(row["document_id"]), str(row["chunk_id"])) for row in selected
    }
    for group in sorted(
        by_document.values(), key=lambda value: float(value[0]["rank"])
    )[:3]:
        for row in group:
            document_count = sum(
                item["document_id"] == row["document_id"] for item in selected
            )
            key = (str(row["document_id"]), str(row["chunk_id"]))
            if document_count < 2 and key not in selected_keys:
                selected.append(row)
                selected_keys.add(key)
            if len(selected) >= 6:
                break
        if len(selected) >= 6:
            break
    selected.sort(key=lambda item: float(item["rank"]))

    evidence: list[Evidence] = []
    characters = 0
    queries = list(
        map(
            str,
            case.get(
                "excerptQueries",
                [case["query"], *case.get("evidenceQueries", [])],
            ),
        )
    )
    for row in selected:
        text = excerpt(str(row["original_text"]), queries)
        if characters + len(text) > 3000:
            text = text[: max(0, 3000 - characters)]
        if not text:
            continue
        characters += len(text)
        try:
            path = " / ".join(json.loads(str(row["section_path"])))
        except (json.JSONDecodeError, TypeError):
            path = str(row["section_path"])
        evidence.append(
            Evidence(
                citation_id=f"C{len(evidence) + 1}",
                chunk_id=str(row["chunk_id"]),
                document_id=str(row["document_id"]),
                title=str(row["title"]),
                source_type=str(row["source_type"]),
                version_label=str(row["version_label"]),
                section_title=str(row["section_title"]),
                section_path=path,
                text=text,
                source_db=str(row["source_db"]),
                rank=float(row["rank"]),
            )
        )
        if characters >= 3000 or len(evidence) >= 4:
            break
    return evidence


def evidence_payload(evidence: list[Evidence]) -> str:
    return json.dumps(
        [
            {
                "id": item.citation_id,
                "document": item.title,
                "documentId": item.document_id,
                "section": item.section_path or item.section_title,
                "text": item.text,
            }
            for item in evidence
        ],
        ensure_ascii=False,
    )


def prompt_for(
    query: str, evidence: list[Evidence], structured: bool
) -> tuple[str, str]:
    shared = (
        "Ты работаешь только с переданными выдержками из российских медицинских источников. "
        "Не добавляй знания из памяти. Не вычисляй дозу. Не исправляй и не скрывай противоречия "
        "в источниках. Если данных недостаточно, перечисли недостающие сведения. "
        "Каждое медицинское утверждение должно опираться на одну конкретную выдержку и не "
        "содержать фактов, отсутствующих в дословной цитате."
    )
    context = f"ЗАПРОС:\n{query}\n\nИСТОЧНИКИ JSON:\n{evidence_payload(evidence)}"
    if not structured:
        return (
            shared,
            f"{context}\n\nОтветь кратко по-русски. После каждого утверждения укажи [C1] и т. п.",
        )
    contract = (
        "Обязательные поля JSON:\n"
        "- status: одна строка answer, needs_clarification, insufficient_evidence или conflict;\n"
        "- missingFacts: массив строк;\n"
        "- claims: массив объектов. В каждом объекте text — одно утверждение, citationIds — "
        "непустой массив ID, exactQuotes — непустой массив дословных непрерывных цитат;\n"
        "- conflicts: массив объектов с description и citationIds.\n"
        "Если утверждений или конфликтов нет, верни пустой массив. Не копируй формулировки "
        "этой инструкции как данные."
    )
    return (
        f"{shared} Верни только один JSON-объект без Markdown.",
        f"{context}\n\nКОНТРАКТ:\n{contract}",
    )


def extract_json(answer: str) -> dict[str, Any] | None:
    cleaned = ANSI.sub("", answer).strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    try:
        complete = json.loads(cleaned)
    except json.JSONDecodeError:
        complete = None
    if complete is not None:
        return complete if isinstance(complete, dict) else None
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def detect_conflict(evidence: list[Evidence], terms: list[str]) -> bool:
    for term in terms:
        doses: list[tuple[float, str]] = []
        for item in evidence:
            text = normalize(item.text)
            if normalize(term) not in text:
                continue
            for match in NUMBER_WITH_UNIT.finditer(text):
                value, unit = match.groups()
                window = text[max(0, match.start() - 90) : match.end() + 90]
                route = (
                    "inhaler"
                    if any(
                        marker in window
                        for marker in ("спейсер", "дозирован", "аэрозольн")
                    )
                    else "nebulizer"
                    if any(
                        marker in window
                        for marker in ("небулайз", "раствор для ингаляц")
                    )
                    else "other"
                )
                amount = float(value.replace(",", "."))
                multiplier = {"мкг": 1.0, "мг": 1000.0, "г": 1_000_000.0}.get(
                    unit.lower()
                )
                if multiplier is not None:
                    doses.append((amount * multiplier, route))
        for left_index, left in enumerate(doses):
            for right in doses[left_index + 1 :]:
                if (
                    left[1] == right[1]
                    and max(left[0], right[0]) / max(min(left[0], right[0]), 0.001)
                    >= 100
                ):
                    return True
    return False


def validate_contract(
    parsed: dict[str, Any] | None,
    evidence: list[Evidence],
    conflict_terms: list[str],
) -> list[str]:
    if parsed is None:
        return ["Ответ не является JSON-объектом."]
    errors: list[str] = []
    allowed_statuses = {
        "answer",
        "needs_clarification",
        "insufficient_evidence",
        "conflict",
    }
    status = parsed.get("status")
    if status not in allowed_statuses:
        errors.append("status отсутствует или не входит в разрешённый список.")
    missing_facts = parsed.get("missingFacts")
    if not isinstance(missing_facts, list) or not all(
        isinstance(item, str) and item.strip() for item in missing_facts
    ):
        errors.append("missingFacts должен быть массивом непустых строк.")
        missing_facts = []
    if status == "needs_clarification" and not missing_facts:
        errors.append("status needs_clarification требует непустой missingFacts.")
    claims = parsed.get("claims")
    if not isinstance(claims, list):
        errors.append("claims должен быть массивом.")
        claims = []
    sources = {item.citation_id: item.text for item in evidence}
    for index, claim in enumerate(claims):
        if not isinstance(claim, dict):
            errors.append(f"claims[{index}] не является объектом.")
            continue
        text = claim.get("text")
        citations = claim.get("citationIds")
        quotes = claim.get("exactQuotes")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"claims[{index}].text пуст.")
        if not isinstance(citations, list) or not citations:
            errors.append(f"claims[{index}] не содержит citationIds.")
            citations = []
        if not isinstance(quotes, list) or not quotes:
            errors.append(f"claims[{index}] не содержит exactQuotes.")
            quotes = []
        cited_text = "\n".join(sources.get(str(citation), "") for citation in citations)
        if any(str(citation) not in sources for citation in citations):
            errors.append(f"claims[{index}] ссылается на неизвестный источник.")
        for quote in quotes:
            if not isinstance(quote, str) or normalize(quote) not in normalize(
                cited_text
            ):
                errors.append(f"claims[{index}] содержит неточную цитату.")
        if isinstance(text, str):
            quoted = " ".join(str(quote) for quote in quotes)
            for number, unit in NUMBER_WITH_UNIT.findall(text):
                pattern = re.compile(
                    rf"(?<![\w.,]){re.escape(number)}\s*{re.escape(unit)}(?!\w)",
                    re.IGNORECASE,
                )
                if not pattern.search(quoted):
                    errors.append(
                        f"claims[{index}] добавляет число {number} {unit}, которого нет в точной цитате."
                    )
    conflicts = parsed.get("conflicts")
    if not isinstance(conflicts, list):
        errors.append("conflicts должен быть массивом.")
        conflicts = []
    for index, conflict in enumerate(conflicts):
        if not isinstance(conflict, dict):
            errors.append(f"conflicts[{index}] не является объектом.")
            continue
        citations = conflict.get("citationIds")
        if (
            not isinstance(conflict.get("description"), str)
            or not conflict["description"].strip()
        ):
            errors.append(f"conflicts[{index}].description пуст.")
        if not isinstance(citations, list) or len(citations) < 2:
            errors.append(f"conflicts[{index}] требует как минимум два citationIds.")
        elif any(str(citation) not in sources for citation in citations):
            errors.append(f"conflicts[{index}] ссылается на неизвестный источник.")
    if status == "conflict" and not conflicts:
        errors.append("status conflict требует непустой массив conflicts.")
    if status == "answer" and not claims:
        errors.append("status answer требует хотя бы одно подтверждённое утверждение.")
    if detect_conflict(evidence, conflict_terms) and status != "conflict":
        errors.append(
            "В выдержках обнаружен крупный конфликт доз, но status не равен conflict."
        )
    return list(dict.fromkeys(errors))


def load_models(catalog_path: Path, model_dir: Path) -> list[Model]:
    catalog = json.loads(catalog_path.read_text())
    by_id = {item["id"]: item for item in catalog["models"]}
    models: list[Model] = []
    for model_id in MODEL_IDS:
        item = by_id[model_id]
        artifact = item["artifacts"][0]
        path = model_dir / artifact["mirrorPath"]
        if not path.exists():
            print(f"Skipping missing model: {path}")
            continue
        with path.open("rb") as model_file:
            digest = hashlib.file_digest(model_file, "sha256").hexdigest()
        if digest != artifact["sha256"]:
            raise SystemExit(f"Checksum mismatch for {path.name}: {digest}")
        models.append(
            Model(
                id=model_id,
                name=item["name"],
                path=path,
                sha256=artifact["sha256"],
                context_tokens=int(artifact["maxContextTokens"]),
            )
        )
    if not models:
        raise SystemExit("No configured model files found.")
    return models


def run_model(
    llama_cli: str,
    model: Model,
    system: str,
    prompt: str,
    max_tokens: int = 384,
) -> tuple[str, float]:
    if model.id == "qwen3-0.6b-q8":
        system = f"{system} /no_think"
    command = [
        llama_cli,
        "-m",
        str(model.path),
        "-c",
        str(model.context_tokens),
        "-n",
        str(max_tokens),
        "-t",
        "8",
        "-ngl",
        "99",
        "--temp",
        "0",
        "--no-display-prompt",
        "--simple-io",
        "--no-warmup",
        "--reasoning",
        "off",
        "--reasoning-budget",
        "0",
        "-sys",
        system,
        "-p",
        prompt,
    ]
    started = time.perf_counter()
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        timeout=180,
        env={
            "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "LANG": "en_US.UTF-8",
        },
    )
    elapsed = (time.perf_counter() - started) * 1000
    if completed.returncode != 0:
        detail = ANSI.sub("", completed.stderr.decode(errors="replace")).strip()[-2000:]
        raise RuntimeError(f"{model.id} exited {completed.returncode}: {detail}")
    answer = ANSI.sub("", completed.stdout.decode(errors="replace"))
    answer = re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL)
    return answer.replace("> EOF by user", "").strip(), elapsed


def run_experiment(
    index_path: Path,
    cases_path: Path,
    models: list[Model],
    llama_cli: str,
) -> tuple[list[Run], dict[str, Any]]:
    index = sqlite3.connect(f"{index_path.resolve().as_uri()}?mode=ro", uri=True)
    cases = json.loads(cases_path.read_text())
    corpus = {
        "documents": index.execute(
            "SELECT count(DISTINCT document_id) FROM evidence"
        ).fetchone()[0],
        "chunks": index.execute("SELECT count(*) FROM evidence").fetchone()[0],
        "databases": index.execute(
            "SELECT count(DISTINCT source_db) FROM evidence"
        ).fetchone()[0],
    }
    runs: list[Run] = []
    for case in cases:
        retrieval_started = time.perf_counter()
        evidence = select_evidence(index, case)
        retrieval_ms = (time.perf_counter() - retrieval_started) * 1000
        print(f"{case['id']}: {len(evidence)} chunks in {retrieval_ms:.0f} ms")
        for model in models:
            for strategy in ("direct", "contract"):
                system, prompt = prompt_for(
                    str(case["query"]), evidence, strategy == "contract"
                )
                try:
                    answer, model_ms = run_model(llama_cli, model, system, prompt)
                except (RuntimeError, subprocess.TimeoutExpired) as error:
                    runs.append(
                        Run(
                            case_id=str(case["id"]),
                            query=str(case["query"]),
                            purpose=str(case["purpose"]),
                            model_id=model.id,
                            model_name=model.name,
                            strategy=strategy,
                            retrieval_ms=retrieval_ms,
                            model_ms=0,
                            attempts=1,
                            answer=f"MODEL_ERROR: {error}",
                            parsed=None,
                            validation_errors=[f"Ошибка запуска модели: {error}"],
                            expected_status=False if strategy == "contract" else None,
                            evidence=evidence,
                        )
                    )
                    print(f"  {model.id}/{strategy}: model error")
                    continue
                parsed = extract_json(answer) if strategy == "contract" else None
                errors = (
                    validate_contract(parsed, evidence, list(case["conflictTerms"]))
                    if strategy == "contract"
                    else []
                )
                attempts = 1
                if errors:
                    retry_prompt = (
                        f"{prompt}\n\nОШИБКИ ПРЕДЫДУЩЕГО ОТВЕТА:\n"
                        f"{'; '.join(errors)[:600]}\n\n"
                        "Исправь ответ. Верни только полный JSON-объект."
                    )
                    try:
                        answer, retry_ms = run_model(
                            llama_cli, model, system, retry_prompt
                        )
                        model_ms += retry_ms
                        attempts += 1
                        parsed = extract_json(answer)
                        errors = validate_contract(
                            parsed, evidence, list(case["conflictTerms"])
                        )
                    except (RuntimeError, subprocess.TimeoutExpired) as error:
                        attempts += 1
                        errors.append(f"Ошибка исправляющей попытки: {error}")
                status = parsed.get("status") if parsed else None
                expected = (
                    status in case["expectedStatuses"]
                    if strategy == "contract"
                    else None
                )
                runs.append(
                    Run(
                        case_id=str(case["id"]),
                        query=str(case["query"]),
                        purpose=str(case["purpose"]),
                        model_id=model.id,
                        model_name=model.name,
                        strategy=strategy,
                        retrieval_ms=retrieval_ms,
                        model_ms=model_ms,
                        attempts=attempts,
                        answer=answer,
                        parsed=parsed,
                        validation_errors=errors,
                        expected_status=expected,
                        evidence=evidence,
                    )
                )
                print(
                    f"  {model.id}/{strategy}: {model_ms / 1000:.1f}s, "
                    f"errors={len(errors)}, attempts={attempts}"
                )
    index.close()
    return runs, corpus


def model_ranking(runs: list[Run]) -> list[dict[str, Any]]:
    ranking: list[dict[str, Any]] = []
    for model_id in dict.fromkeys(run.model_id for run in runs):
        selected = [
            run
            for run in runs
            if run.model_id == model_id and run.strategy == "contract"
        ]
        ranking.append(
            {
                "modelId": model_id,
                "modelName": selected[0].model_name,
                "contractPasses": sum(not run.validation_errors for run in selected),
                "parsedContracts": sum(run.parsed is not None for run in selected),
                "expectedStatuses": sum(
                    run.expected_status is True for run in selected
                ),
                "validationErrors": sum(len(run.validation_errors) for run in selected),
                "averageSeconds": sum(run.model_ms for run in selected)
                / len(selected)
                / 1000,
            }
        )
    return sorted(
        ranking,
        key=lambda item: (
            -item["contractPasses"],
            -item["expectedStatuses"],
            -item["parsedContracts"],
            item["validationErrors"],
            item["averageSeconds"],
        ),
    )


def write_report(
    report_path: Path,
    runs: list[Run],
    corpus: dict[str, Any],
    corpus_label: str,
) -> None:
    ranking = model_ranking(runs)
    case_count = len({run.case_id for run in runs})
    lines = [
        "# Local model tester-box report",
        "",
        f"- Generated: {datetime.now(UTC).isoformat(timespec='seconds')}",
        f"- Corpus: `{corpus_label}`",
        f"- Indexed databases: {corpus['databases']}",
        f"- Unique documents: {corpus['documents']}",
        f"- Searchable chunks: {corpus['chunks']}",
        "- Queries are synthetic benchmark cases, not patient data.",
        (
            "- The validator checks structure, known citations, exact quotes, numbers and declared "
            "dose conflicts; semantic entailment still requires clinician review."
        ),
        "- Answers below are excerpts; complete outputs and chunk metadata are in `latest.json`.",
        "",
        "## Model comparison",
        "",
        "| Model | Validator passes | Valid JSON | Expected safety status | Validation errors | Mean contract time |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for item in ranking:
        lines.append(
            f"| {item['modelName']} | {item['contractPasses']}/{case_count} | "
            f"{item['parsedContracts']}/{case_count} | "
            f"{item['expectedStatuses']}/{case_count} | {item['validationErrors']} | "
            f"{item['averageSeconds']:.2f} s |"
        )
    best = ranking[0]
    lines.extend(
        [
            "",
            (
                "The ranking is mechanical: validator pass first, expected safe status second, "
                "valid JSON third, fewer validator errors fourth, latency last. A pass does not "
                "prove semantic entailment or clinical correctness."
            ),
            "",
            f"Current best by that rule: **{best['modelName']}**.",
            "",
            "## Runs",
            "",
        ]
    )
    for case_id in dict.fromkeys(run.case_id for run in runs):
        case_runs = [run for run in runs if run.case_id == case_id]
        first = case_runs[0]
        documents = list(dict.fromkeys(item.title for item in first.evidence))
        lines.extend(
            [
                f"### {case_id}",
                "",
                f"**Query:** {first.query}",
                "",
                f"**Purpose:** {first.purpose}",
                "",
                f"**Documents:** {'; '.join(documents) if documents else 'none'}",
                "",
            ]
        )
        for run in case_runs:
            lines.extend(
                [
                    f"#### {run.model_name} · {run.strategy}",
                    "",
                    (
                        f"Retrieval {run.retrieval_ms:.1f} ms; model "
                        f"{run.model_ms / 1000:.2f} s ({run.attempts} attempt(s))."
                    ),
                    "",
                ]
            )
            if run.strategy == "contract":
                status = run.parsed.get("status") if run.parsed else "invalid JSON"
                validation = (
                    "passed"
                    if not run.validation_errors
                    else "; ".join(run.validation_errors)[:500]
                )
                lines.extend(
                    [
                        (
                            f"Status `{status}`; expected safety status "
                            f"{'yes' if run.expected_status else 'no'}; validation: {validation}"
                        ),
                        "",
                    ]
                )
            answer = run.answer
            if len(answer) > 900:
                answer = f"{answer[:900]}\n… [truncated; see latest.json]"
            lines.extend(["```text", answer, "```", ""])
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines))


def serializable_run(run: Run) -> dict[str, Any]:
    value = asdict(run)
    value["evidence"] = [asdict(item) for item in run.evidence]
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    index_command = commands.add_parser(
        "index", help="Build one tester-only FTS index."
    )
    index_command.add_argument("sources", nargs="+", type=Path)
    index_command.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    run_command = commands.add_parser(
        "run", help="Run retrieval and local-model cases."
    )
    run_command.add_argument("--index", type=Path, default=DEFAULT_INDEX)
    run_command.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    run_command.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    run_command.add_argument("--models", type=Path, default=DEFAULT_MODELS)
    run_command.add_argument(
        "--llama-cli", default="/opt/homebrew/bin/llama-completion"
    )
    run_command.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    run_command.add_argument(
        "--corpus-label", default="clinical-json snapshot + published regulatory pilot"
    )
    arguments = parser.parse_args()
    if arguments.command == "index":
        result = build_index(arguments.index, arguments.sources)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    models = load_models(arguments.catalog, arguments.models)
    runs, corpus = run_experiment(
        arguments.index, arguments.cases, models, arguments.llama_cli
    )
    write_report(arguments.report, runs, corpus, arguments.corpus_label)
    raw_path = arguments.report.with_suffix(".json")
    raw_path.write_text(
        json.dumps(
            {
                "corpus": corpus,
                "ranking": model_ranking(runs),
                "runs": [serializable_run(run) for run in runs],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"Report: {arguments.report}")


if __name__ == "__main__":
    main()
