"""Convert scanned PDFs to Markdown with Marker (marker-pdf + Surya, local, no keys), one document at a time.

Build tool for the private pipeline (MARKER1, docs/research/marker-eval-2026-10-14.md); never a runtime dependency.
Run it with the interpreter of the tool environment, from the main checkout:

    data/build/marker-eval/venv/bin/python -I scripts/marker_convert.py OUT_DIR PDF[:PAGES] [PDF[:PAGES] ...]

PAGES is Marker's 0-based list such as ``0-19`` or ``0,5-10`` (omitted = whole file). Per document it writes
``OUT_DIR/<stem>/<stem>.md`` (page breaks as ``{N}`` + dashes, N 0-based) plus the extracted pictures, and appends
one JSON line to ``OUT_DIR/results.jsonl`` (seconds per page, peak resident memory of the process tree including the
llama.cpp server, lowest system memory available). The run is aborted if available memory drops below 8 GiB.

Model weights and caches stay inside the tool folder (HF_HOME, MODEL_CACHE_DIR), nothing is written to ~/.cache
except the llama.cpp/Surya server state files that Surya places there itself. One request at a time
(SURYA_INFERENCE_PARALLEL=1); Apple Silicon uses Metal through llama.cpp.
"""

import json
import os
import sys
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("MARKER_EVAL_HOME", Path(__file__).resolve().parents[1] / "data/build/marker-eval"))
os.environ.setdefault("HF_HOME", str(HOME / "cache/hf"))
os.environ.setdefault("TORCH_HOME", str(HOME / "cache/torch"))
os.environ.setdefault("XDG_CACHE_HOME", str(HOME / "cache/xdg"))
os.environ.setdefault("MODEL_CACHE_DIR", str(HOME / "cache/datalab-models"))
os.environ.setdefault("SURYA_INFERENCE_BACKEND", "llamacpp")
os.environ.setdefault("SURYA_INFERENCE_PARALLEL", "1")
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import psutil  # noqa: E402  (imported after the environment is set)

FLOOR_BYTES = 8 * 1024**3
STATE = {"peak_rss": 0, "min_avail": 1 << 62, "stop": False}


def tree_rss() -> int:
    me = psutil.Process()
    procs = [me, *me.children(recursive=True)]
    seen = {p.pid for p in procs}
    for p in psutil.process_iter(["cmdline"]):
        cmdline = " ".join(p.info["cmdline"] or [])
        if p.pid not in seen and ("llama-server" in cmdline or "surya.fast_layout" in cmdline or "surya.ocr_error" in cmdline):
            procs.append(p)
            seen.add(p.pid)
    total = 0
    for p in procs:
        try:
            total += p.memory_info().rss
        except psutil.Error:
            continue
    return total


def watch_memory() -> None:
    while not STATE["stop"]:
        avail = psutil.virtual_memory().available
        STATE["min_avail"] = min(STATE["min_avail"], avail)
        STATE["peak_rss"] = max(STATE["peak_rss"], tree_rss())
        if avail < FLOOR_BYTES:
            print(f"ABORT: available memory {avail / 2**30:.1f} GiB is below 8 GiB", flush=True)
            os._exit(3)
        time.sleep(1.0)


def expand(pages: str, count: int) -> list[int]:
    out: list[int] = []
    for part in pages.split(","):
        if "-" in part:
            first, last = part.split("-")
            out.extend(range(int(first), int(last) + 1))
        else:
            out.append(int(part))
    return [p for p in out if p < count]


def main() -> None:
    out_dir, *items = sys.argv[1:]
    if not items:
        raise SystemExit(__doc__)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=watch_memory, daemon=True).start()

    import pypdfium2
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict, shutdown_models
    from marker.output import text_from_rendered

    models = create_model_dict()
    for item in items:
        path, _, pages = item.partition(":")
        stem = Path(path).stem
        count = len(pypdfium2.PdfDocument(path))
        selected = expand(pages, count) if pages else list(range(count))
        config: dict[str, object] = {"mode": "fast", "output_format": "markdown", "disable_tqdm": True, "paginate_output": True}
        if pages:
            config["page_range"] = selected
        STATE["peak_rss"] = 0
        started = time.time()
        error = None
        text, images = "", {}
        try:
            text, _ext, images = text_from_rendered(PdfConverter(artifact_dict=models, config=config)(path))
        except Exception as exc:  # recorded in results.jsonl; the run continues with the next file
            error = repr(exc)
        seconds = time.time() - started
        doc_dir = out / stem
        doc_dir.mkdir(parents=True, exist_ok=True)
        (doc_dir / f"{stem}.md").write_text(text)
        for name, image in images.items():
            image.save(doc_dir / name)
        record = {
            "file": stem,
            "pages": len(selected),
            "seconds": round(seconds, 1),
            "secondsPerPage": round(seconds / max(len(selected), 1), 2),
            "peakRssGiB": round(STATE["peak_rss"] / 2**30, 2),
            "minAvailGiB": round(STATE["min_avail"] / 2**30, 1),
            "images": len(images),
            "chars": len(text),
            "error": error,
        }
        print(json.dumps(record, ensure_ascii=False), flush=True)
        with open(out / "results.jsonl", "a") as log:
            log.write(json.dumps(record, ensure_ascii=False) + "\n")
    shutdown_models(models)
    STATE["stop"] = True


if __name__ == "__main__":
    main()
