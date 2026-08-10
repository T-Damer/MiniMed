#!/usr/bin/env python
"""Run an oMLX candidate bake-off on a PDF using one-page requests."""

from __future__ import annotations

import base64
import json
import re
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from subprocess import Popen
from typing import Any
from difflib import SequenceMatcher

import fitz


OMLX_BIN = "/opt/homebrew/bin/omlx"
OMLX_HOST = "127.0.0.1"
OMLX_PORT = 19020
WORK_DIR = Path("/Users/d/Projects/Personal/MiniMed/data/build/omlx-bakeoff")
REPORT_DIR = WORK_DIR / "runs"
PDF_PATH = Path("/Users/d/Projects/Personal/MiniMed/Med/ПДБ/ПДБМетодичка_less.pdf")
DOTS_PROMPT = (
    "Please output the layout information from the PDF image, including each layout element's "
    "bbox, its category, and the corresponding text content within the bbox.\n\n"
    "1. Bbox format: [x1, y1, x2, y2]\n\n"
    "2. Layout Categories: The possible categories are ['Caption', 'Footnote', 'Formula', "
    "'List-item', 'Page-footer', 'Page-header', 'Picture', 'Section-header', 'Table', 'Text', 'Title'].\n\n"
    "3. Text Extraction & Formatting Rules:\n"
    "    - Picture: For the 'Picture' category, the text field should be omitted.\n"
    "    - Formula: Format its text as LaTeX.\n"
    "    - Table: Format its text as HTML.\n"
    "    - All Others (Text, Title, etc.): Format their text as Markdown.\n\n"
    "4. Constraints:\n"
    "    - The output text must be the original text from the image, with no translation.\n"
    "    - All layout elements must be sorted according to human reading order.\n\n"
    "5. Final Output: The entire output must be a single JSON object."
)

CANDIDATES: list[dict[str, Any]] = [
    {"id": "mlx-community/DeepSeek-OCR-4bit", "label": "DeepSeek OCR (v1)"},
    {"id": "mlx-community/Qwen3-VL-4B-Instruct-4bit", "label": "Qwen3-VL 4B Instruct"},
    {"id": "mlx-community/DeepSeek-OCR-2-5bit", "label": "DeepSeek OCR v2 (5bit)"},
    {"id": "dots-studio/dots.ocr", "label": "dots.ocr (dots-studio)", "prompt": DOTS_PROMPT},
    {"id": "mlx-community/Unlimited-OCR-mxfp8", "label": "Unlimited-OCR mxfp8"},
    {"id": "mlx-community/GLM-OCR-4bit", "label": "GLM-OCR"},
]
MODEL_PAGE_COUNT = 30
MEMORY_GUARD_GB = 24
REQUEST_TIMEOUT_SECONDS = 180


PROMPT = (
    "Ты — точный OCR ассистент.\n"
    "Проанализируй ОДНУ страницу PDF-изображения и верни ТОЛЬКО JSON.\n"
    "Формат JSON: {\"page\":number, \"language\":\"ru\", \"text\":\"...\",\n"
    "\"headings\":[{\"level\":2,\"text\":\"...\"}], \"lists\":[[\"...\"], [\"...\"]],\n"
    "\"tables\":[[{\"rows\": [[\"...\"]]}], \"reading_order\":\"...\"}\n"
    "Не добавляй пояснения и markdown. Переводить текст не нужно, только точная передача.\n"
    "Не добавляй поле warnings и ничего кроме перечисленных полей."
)



@dataclass
class PageEval:
    page: int
    status: str
    latency_seconds: float
    model: str
    valid_json: bool
    json_error: str | None
    full_text: str
    reference_text: str
    similarity_text: float
    text_numeric_mismatch: int
    invented_text_score: float
    headings_ok: bool
    lists_ok: bool
    tables_ok: bool
    reading_order_ok: bool
    invalid_json: bool
    response_raw: str
    confidence: float


def normalize_text(value: str) -> str:
    normalized = value.lower()
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def extract_numbers(value: str) -> set[str]:
    return {m.group(0) for m in re.finditer(r"\d+[,.]?\d*", value)}


def parse_json_from_text(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    # Remove markdown wrappers.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"```$", "", text)
        text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Balanced JSON extraction fallback.
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                return None
        return None


def hf_model_cache_path(model_id: str) -> Path:
    safe = model_id.replace("/", "--")
    return Path.home() / ".cache" / "huggingface" / "hub" / f"models--{safe}"


def sanitize_model_id(model_id: str) -> str:
    return model_id.replace("/", "--")


def _looks_like_lfs_pointer(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        return path.read_text(encoding="utf-8", errors="ignore").startswith("version https://git-lfs.github.com/spec/v1")
    except Exception:
        return False


def ensure_local_model(model_id: str, model_dir: Path) -> Path:
    safe_id = sanitize_model_id(model_id)
    target = model_dir / safe_id
    if target.exists():
        pointer_path = target / "model.safetensors"
        if not _looks_like_lfs_pointer(pointer_path):
            return target
        run_command(["git", "-C", str(target), "lfs", "install", "--local"])
        run_command(["git", "-C", str(target), "lfs", "pull"])
        run_command(["git", "-C", str(target), "lfs", "checkout"])
        if not _looks_like_lfs_pointer(pointer_path):
            return target
        raise RuntimeError(f"Existing model clone still has pointer file: {pointer_path}")

    code, out = run_command(
        [
            "git",
            "clone",
            "--depth",
            "1",
            f"https://huggingface.co/{model_id}",
            str(target),
        ]
    )
    if code != 0:
        raise RuntimeError(f"Failed to clone model '{model_id}': {out}")

    code, out = run_command(["git", "-C", str(target), "lfs", "install", "--local"])
    if code != 0:
        raise RuntimeError(f"Failed to initialize Git LFS for '{model_id}': {out}")

    code, out = run_command(["git", "-C", str(target), "lfs", "pull"])
    if code != 0:
        raise RuntimeError(f"Failed to download LFS objects for '{model_id}': {out}")

    code, out = run_command(["git", "-C", str(target), "lfs", "checkout"])
    if code != 0:
        raise RuntimeError(f"Failed to materialize LFS files for '{model_id}': {out}")

    if not target.exists():
        raise RuntimeError(f"Model not present after clone: {target}")
    return target


def model_cache_snapshot_dir(model_dir: Path) -> Path | None:
    snap = model_dir / "snapshots"
    if not snap.exists():
        return None
    dirs = [p for p in snap.iterdir() if p.is_dir()]
    if not dirs:
        return None
    return max(dirs, key=lambda p: p.stat().st_mtime)


def run_command(command: list[str]) -> tuple[int, str]:
    proc = subprocess.run(command, check=False, capture_output=True, text=True)
    return proc.returncode, proc.stdout.strip() + proc.stderr


def get_api_key() -> str:
    api_key = os.environ.get("OMLX_API_KEY")
    if not api_key:
        raise RuntimeError("OMLX_API_KEY environment variable is required")
    return api_key


def request_models(base_url: str) -> dict[str, Any] | None:
    req = urllib.request.Request(
        url=f"{base_url}/v1/models",
        method="GET",
        headers={"Authorization": f"Bearer {get_api_key()}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            data = response.read().decode("utf-8")
            return json.loads(data)
    except Exception:
        return None


def call_infer(base_url: str, model_id: str, page_image_b64: str, prompt: str = PROMPT) -> tuple[int, str, dict[str, float]]:
    payload: dict[str, Any] = {
        "model": model_id,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt,
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{page_image_b64}",
                        },
                    },
                ],
            }
        ],
        "temperature": 0.0,
        "top_p": 0.9,
        "max_tokens": 8192,
        "stream": False,
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=f"{base_url}/v1/chat/completions",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {get_api_key()}",
            "Content-Type": "application/json",
        },
    )
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8")
            elapsed = time.perf_counter() - start
            return 200, raw, {"latency": elapsed}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="ignore")
        elapsed = time.perf_counter() - start
        return error.code, raw, {"latency": elapsed}
    except Exception as exc:  # pragma: no cover - network/path-dependent
        elapsed = time.perf_counter() - start
        return 0, str(exc), {"latency": elapsed}


def page_images(doc: fitz.Document, selected_pages: list[int], img_dir: Path) -> dict[int, Path]:
    img_dir.mkdir(parents=True, exist_ok=True)
    mapping: dict[int, Path] = {}
    for page in selected_pages:
        page_obj = doc.load_page(page)
        matrix = fitz.Matrix(2.0, 2.0)
        pix = page_obj.get_pixmap(matrix=matrix)
        out = img_dir / f"page-{page+1:03d}.png"
        pix.save(out.as_posix())
        mapping[page] = out
    return mapping


def encode_image(path: Path) -> str:
    data = path.read_bytes()
    return base64.b64encode(data).decode("ascii")


def extract_message_content(raw: str) -> str:
    """Unwrap an OpenAI-style chat completion envelope to the text content."""
    try:
        envelope = json.loads(raw)
        choices = envelope.get("choices") or []
        for choice in choices:
            message = choice.get("message") or {}
            content = message.get("content")
            if isinstance(content, str):
                return content
    except Exception:
        pass
    return raw


def text_field_from_broken_json(content: str) -> str:
    """Extract the 'text' value when the model's JSON is malformed (e.g. bad tables array)."""
    match = re.search(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"', content)
    if not match:
        return ""
    return match.group(1).replace("\\n", "\n").replace("\\\\", "\\")


def safe_eval(page: int, model_id: str, raw: str, reference: str, latency: float) -> PageEval:
    content = extract_message_content(raw)
    parsed = parse_json_from_text(content)
    if not parsed:
        output_text = text_field_from_broken_json(content)
        if not output_text:
            return PageEval(
                page=page,
                status="invalid-json",
                latency_seconds=latency,
                model=model_id,
                valid_json=False,
                json_error="invalid json",
                full_text="",
                reference_text=reference,
                similarity_text=0.0,
                text_numeric_mismatch=0,
                invented_text_score=1.0,
                headings_ok=False,
                lists_ok=False,
                tables_ok=False,
                reading_order_ok=False,
                invalid_json=True,
                response_raw=raw,
                confidence=0.0,
            )
        ref_norm = normalize_text(reference)
        out_norm = normalize_text(output_text)
        similarity = SequenceMatcher(None, ref_norm, out_norm).ratio() if ref_norm else 0.0
        return PageEval(
            page=page,
            status="ok",
            latency_seconds=latency,
            model=model_id,
            valid_json=False,
            json_error="partial-json-text-only",
            full_text=output_text,
            reference_text=reference,
            similarity_text=similarity,
            text_numeric_mismatch=len((extract_numbers(reference) - extract_numbers(output_text)) | (extract_numbers(output_text) - extract_numbers(reference))),
            invented_text_score=1.0 - similarity,
            headings_ok=False,
            lists_ok=False,
            tables_ok=False,
            reading_order_ok=False,
            invalid_json=True,
            response_raw=raw,
            confidence=0.4 * similarity,
        )

    output_text = ""
    if isinstance(parsed, list):
        parts = []
        for element in parsed:
            if not isinstance(element, dict):
                continue
            text = element.get("text")
            if text:
                parts.append(str(text))
        output_text = "\n".join(parts)
    else:
        output_text = str(parsed.get("text", "") or "")
    ref_norm = normalize_text(reference)
    out_norm = normalize_text(output_text)
    similarity = SequenceMatcher(None, ref_norm, out_norm).ratio() if ref_norm else 0.0

    ref_nums = extract_numbers(reference)
    out_nums = extract_numbers(output_text)
    numeric_mismatch = len((out_nums - ref_nums) | (ref_nums - out_nums))

    # Invented text heuristic: low overlap with reference text.
    invented_score = 1.0 - similarity

    headings_ok = bool(parsed.get("headings")) if isinstance(parsed, dict) else False
    lists_ok = bool(parsed.get("lists")) if isinstance(parsed, dict) else False
    tables_ok = bool(parsed.get("tables")) if isinstance(parsed, dict) else False
    ro = str(parsed.get("reading_order", "") if isinstance(parsed, dict) else "").strip().lower()
    reading_order_ok = bool(ro)

    invalid_json = False

    token_confidence = (
        0.5 * similarity
        + 0.2 * (1.0 if headings_ok else 0.5)
        + 0.15 * (1.0 if lists_ok else 0.5)
        + 0.15 * (1.0 if tables_ok else 0.5)
    )

    return PageEval(
        page=page,
        status="ok",
        latency_seconds=latency,
        model=model_id,
        valid_json=True,
        json_error=None,
        full_text=output_text,
        reference_text=reference,
        similarity_text=similarity,
        text_numeric_mismatch=numeric_mismatch,
        invented_text_score= invented_score,
        headings_ok=headings_ok,
        lists_ok=lists_ok,
        tables_ok=tables_ok,
        reading_order_ok=reading_order_ok,
        invalid_json=invalid_json,
        response_raw=raw,
        confidence=min(max(token_confidence, 0.0), 1.0),
    )


def select_pages(page_count: int, limit: int = MODEL_PAGE_COUNT) -> list[int]:
    if page_count <= limit:
        return list(range(page_count))
    return sorted({int(i * (page_count - 1) / (limit - 1)) for i in range(limit)})


def collect_model_metadata(model_id: str, start_snapshot: int, model: str | None, model_dir: Path | None = None) -> dict[str, Any]:
    cache_dir = model_dir or hf_model_cache_path(model_id)
    meta: dict[str, Any] = {
        "model_id": model_id,
        "candidate": model,
        "cache_dir": str(cache_dir),
        "downloaded": cache_dir.exists(),
        "snapshot": None,
        "license": None,
        "version": None,
        "quantization": None,
        "disk_usage_bytes": None,
        "sha256_of_main_model_file": None,
    }
    if not cache_dir.exists():
        return meta
    snapshot = cache_dir if (cache_dir / "config.json").exists() else model_cache_snapshot_dir(cache_dir)
    if not snapshot:
        return meta
    meta["snapshot"] = str(snapshot)
    config_path = snapshot / "config.json"
    readme_path = snapshot / "README.md"

    if config_path.exists():
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
            meta["version"] = config.get("_name_or_path") or config.get("architectures")
            quantization = config.get("quantization_config")
            if isinstance(quantization, dict):
                meta["quantization"] = quantization
            elif quantization:
                meta["quantization"] = str(quantization)
        except Exception:
            pass

    if readme_path.exists():
        text = readme_path.read_text(encoding="utf-8", errors="ignore")
        if "license" in text.lower():
            for line in text.splitlines():
                if line.lower().startswith("license"):
                    meta["license"] = line.strip().split(":", 1)[-1].strip().strip("\"")
                    break

    # Approximate SHA of first safetensors file (best-effort).
    safetensors = sorted(snapshot.glob("**/*.safetensors"))
    if safetensors:
        first = safetensors[0]
        code, out = run_command(["shasum", "-a", "256", str(first)])
        if code == 0:
            sha = out.split()[0]
            meta["sha256_of_main_model_file"] = sha

    # Disk usage approximation (for files modified after run start).
    try:
        total = 0
        for dirpath, _dirnames, filenames in os.walk(snapshot):
            for name in filenames:
                try:
                    total += os.path.getsize(os.path.join(dirpath, name))
                except OSError:
                    pass
        meta["disk_usage_bytes"] = total
    except Exception:
        meta["disk_usage_bytes"] = None

    return meta


def stream_to_float(bytes_value: str | bytes) -> int:
    path = WORK_DIR / bytes_value
    if not path.exists():
        return 0
    st = path.stat()
    return int(st.st_size)


def start_model(model_dir: Path, log_path: Path):
    cmd = [
        OMLX_BIN,
        "serve",
        "--host",
        OMLX_HOST,
        "--port",
        str(OMLX_PORT),
        "--max-concurrent-requests",
        "1",
        "--memory-guard-gb",
        str(MEMORY_GUARD_GB),
        "--log-level",
        "warning",
        "--sse-keepalive-mode",
        "off",
        "--model-dir",
        str(model_dir),
        "--api-key",
        get_api_key(),
    ]
    return subprocess.Popen(
        cmd,
        stdout=log_path.open("w"),
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )


def stop_process(proc: Popen[str]) -> None:
    if proc.poll() is not None:
        return
    try:
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
            proc.wait(timeout=3)
        except Exception:
            pass


def wait_for_ready(base_url: str, model_id: str, timeout_seconds: int = 180) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        models = request_models(base_url)
        if isinstance(models, dict) and models.get("data") is not None:
            return any(
                isinstance(models.get("data"), list)
                and model.get("id") == model_id
                for model in models.get("data", [])
            ) or model_id == "" and bool(models.get("data"))
        time.sleep(2)
    return False


def evaluate_candidate(model_id: str, selected_pages: list[int], page_texts: dict[int, str], image_map: dict[int, Path], base_dir: Path, prompt: str = PROMPT) -> dict[str, Any]:
    run_dir = base_dir / model_id_to_dir(model_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    server_log = run_dir / "omlx-serve.log"
    out_path = run_dir / "page-results.jsonl"
    served_model_id = sanitize_model_id(model_id)
    model_path = ensure_local_model(model_id, run_dir)

    proc = start_model(model_path, server_log)
    base_url = f"http://{OMLX_HOST}:{OMLX_PORT}"

    model_metadata: dict[str, Any]
    started = time.time()

    model_metadata = collect_model_metadata(model_id, int(time.time()), model_id, model_path)
    try:
        if not wait_for_ready(base_url, served_model_id, timeout_seconds=180):
            return {
                "model": model_id,
                "served_model_id": served_model_id,
                "status": "server-not-ready",
                "results": [],
                "metadata": model_metadata,
                "summary": {
                    "valid_response": 0,
                    "invalid_response": 0,
                    "mean_latency": None,
                },
            }

        model_metadata = collect_model_metadata(model_id, int(started), model_id, model_path)

        # One-image smoke request per model before full sweep.
        smoke_page = selected_pages[0]
        smoke_image = encode_image(image_map[smoke_page])
        status_code, raw, timing = call_infer(base_url, served_model_id, smoke_image, prompt)
        smoke = safe_eval(smoke_page, served_model_id, raw, page_texts[smoke_page], timing["latency"])

        rows: list[dict[str, Any]] = []
        if status_code == 200 and not smoke.invalid_json:
            rows.append(asdict(smoke))

        # Full sample.
        for page in selected_pages:
            image = encode_image(image_map[page])
            status_code, raw, timing = call_infer(base_url, served_model_id, image, prompt)
            row = safe_eval(page, served_model_id, raw, page_texts[page], timing["latency"])
            row.status = "ok" if status_code == 200 and row.valid_json else "failed"
            if status_code == 401:
                row.json_error = "authentication"
            elif status_code and status_code >= 500:
                row.json_error = "server-error"
            elif row.invalid_json and row.json_error is None:
                row.json_error = "invalid-json"
            rows.append(asdict(row))
            time.sleep(1)

        with out_path.open("w", encoding="utf-8") as handle:
            for item in rows:
                handle.write(json.dumps(item, ensure_ascii=False) + "\n")

        valid = sum(1 for item in rows if item["status"] == "ok")
        total = len(rows)

        return {
            "model": model_id,
            "served_model_id": served_model_id,
            "status": "ok",
            "results": rows,
            "metadata": model_metadata,
            "summary": {
                "valid_response": valid,
                "invalid_response": total - valid,
                "mean_latency": sum(item["latency_seconds"] for item in rows) / max(1, total),
                "mean_similarity": sum(item["similarity_text"] for item in rows) / max(1, total),
                "mean_invented_score": sum(item["invented_text_score"] for item in rows) / max(1, total),
                "avg_text_numeric_mismatch": sum(item["text_numeric_mismatch"] for item in rows) / max(1, total),
            },
            "smoke_test": asdict(smoke),
            "server_log": str(server_log),
            "run_dir": str(run_dir),
        }
    finally:
        stop_process(proc)


def asdict(value: PageEval) -> dict[str, Any]:
    return {
        "page": value.page,
        "status": value.status,
        "latency_seconds": value.latency_seconds,
        "model": value.model,
        "valid_json": value.valid_json,
        "json_error": value.json_error,
        "full_text": value.full_text,
        "reference_text": value.reference_text,
        "similarity_text": value.similarity_text,
        "text_numeric_mismatch": value.text_numeric_mismatch,
        "invented_text_score": value.invented_text_score,
        "headings_ok": value.headings_ok,
        "lists_ok": value.lists_ok,
        "tables_ok": value.tables_ok,
        "reading_order_ok": value.reading_order_ok,
        "invalid_json": value.invalid_json,
        "response_raw": value.response_raw,
        "confidence": value.confidence,
    }


def ensure_output_dirs() -> Path:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    return WORK_DIR


def build_reference_texts(document_path: Path, pages: list[int]) -> dict[int, str]:
    doc = fitz.open(document_path)
    refs = {}
    for page in pages:
        refs[page] = doc.load_page(page).get_text("text").strip()
    doc.close()
    return refs


def manual_review_pack(pages: list[int], refs: dict[int, str], image_map: dict[int, Path], run_root: Path):
    manual = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "document": str(PDF_PATH),
        "notes": "first 10 pages with reference text/images for manual review",
        "pages": [],
    }
    for page in pages[:10]:
        manual["pages"].append(
            {
                "page": page,
                "reference_text": refs[page],
                "image": str(image_map[page]),
            }
        )
    (run_root / "manual_reference.json").write_text(json.dumps(manual, ensure_ascii=False, indent=2), encoding="utf-8")


def pick_primary_and_rescue(report: dict[str, Any]) -> tuple[str | None, str | None]:
    rows = report["candidates"]
    scored = []
    for item in rows:
        if item["status"] != "ok":
            scored.append((item["model"], -10**9))
            continue
        s = item["summary"]
        score = (
            s["mean_similarity"] * 100
            - 0.05 * s["mean_latency"]
        )
        scored.append((item["model"], score))
    scored = sorted(scored, key=lambda x: x[1], reverse=True)
    if not scored:
        return None, None
    primary = scored[0][0]
    rescue = scored[1][0] if len(scored) > 1 else None
    return primary, rescue


def rescore_from_saved() -> None:
    """Rebuild the report from saved page-results.jsonl without re-inference."""
    final_report: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "document": str(PDF_PATH),
        "pages": None,
        "candidate_order": [item["id"] for item in CANDIDATES],
        "candidates": [],
    }
    refs: dict[int, str] = {}
    rows_by_model: dict[str, list[dict[str, Any]]] = {}
    for candidate in CANDIDATES:
        run_dir = REPORT_DIR / model_id_to_dir(candidate["id"])
        results_path = run_dir / "page-results.jsonl"
        if not results_path.exists():
            continue
        for line in results_path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            row["model"] = candidate["id"]
            refs[row["page"]] = row["reference_text"]
            rows_by_model.setdefault(candidate["id"], []).append(row)
    selected = sorted(refs)
    final_report["pages"] = selected
    for candidate in CANDIDATES:
        model_id = candidate["id"]
        rows = rows_by_model.get(model_id, [])
        rescored = [asdict(safe_eval(r["page"], model_id, r["response_raw"], r["reference_text"], r["latency_seconds"])) for r in rows]
        valid = sum(1 for item in rescored if item["status"] == "ok")
        total = len(rescored)
        info: dict[str, Any] = {
            "model": model_id,
            "label": candidate["label"],
            "status": "ok" if rows else "failed",
            "results": rescored,
            "metadata": collect_model_metadata(model_id, int(time.time()), model_id, REPORT_DIR / model_id_to_dir(model_id) / sanitize_model_id(model_id)),
            "summary": {
                "valid_response": valid,
                "invalid_response": total - valid,
                "mean_latency": sum(item["latency_seconds"] for item in rescored) / max(1, total),
                "mean_similarity": sum(item["similarity_text"] for item in rescored) / max(1, total),
                "mean_invented_score": sum(item["invented_text_score"] for item in rescored) / max(1, total),
                "avg_text_numeric_mismatch": sum(item["text_numeric_mismatch"] for item in rescored) / max(1, total),
            },
        }
        if not rows:
            info["error"] = "no saved results"
        final_report["candidates"].append(info)
    primary, rescue = pick_primary_and_rescue(final_report)
    final_report["selection"] = {
        "primary": primary,
        "rescue": rescue,
        "model_count": len(CANDIDATES),
    }
    out = WORK_DIR / "bakeoff-report.json"
    out.write_text(json.dumps(final_report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(out)


def model_id_to_dir(model_id: str) -> str:
    return model_id.replace("/", "_")


def main() -> None:
    if not PDF_PATH.exists():
        raise FileNotFoundError(f"PDF not found: {PDF_PATH}")

    only: str | None = None
    smoke_pages = 0
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]
    if "--smoke" in sys.argv:
        smoke_pages = 3

    ensure_output_dirs()
    doc = fitz.open(PDF_PATH)
    selected_pages = select_pages(doc.page_count)
    doc.close()
    if smoke_pages:
        selected_pages = selected_pages[:smoke_pages]

    refs = build_reference_texts(PDF_PATH, selected_pages)
    page_images_map = page_images(fitz.open(PDF_PATH), selected_pages, WORK_DIR / "page-images")
    manual_review_pack(selected_pages, refs, page_images_map, WORK_DIR)

    final_report: dict[str, Any] = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "document": str(PDF_PATH),
        "pages": selected_pages,
        "candidate_order": [item["id"] for item in CANDIDATES],
        "candidates": [],
    }

    for candidate in CANDIDATES:
        model_id = candidate["id"]
        if only and model_id != only:
            continue
        print(f"Running bake-off candidate: {model_id}")
        try:
            info = evaluate_candidate(model_id, selected_pages, refs, page_images_map, REPORT_DIR, candidate.get("prompt", PROMPT))
        except Exception as exc:
            info = {
                "model": model_id,
                "status": "failed",
                "results": [],
                "metadata": collect_model_metadata(model_id, int(time.time()), model_id),
                "summary": {
                    "valid_response": 0,
                    "invalid_response": 0,
                    "mean_latency": None,
                },
                "error": str(exc),
            }
        info["label"] = candidate["label"]
        final_report["candidates"].append(info)

    primary, rescue = pick_primary_and_rescue(final_report)
    final_report["selection"] = {
        "primary": primary,
        "rescue": rescue,
        "model_count": len(CANDIDATES),
    }

    out = WORK_DIR / "bakeoff-report.json"
    out.write_text(json.dumps(final_report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(out)


if __name__ == "__main__":
    import sys

    if "--rescore" in sys.argv:
        rescore_from_saved()
    else:
        main()
