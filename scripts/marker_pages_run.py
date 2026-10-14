"""Resumable one-page-at-a-time Marker run (LEGAL1; build tool of the private pipeline, never a runtime dependency).

    data/build/marker-eval/venv/bin/python -I scripts/marker_pages_run.py JOBS.json OUT_DIR [--max-pages N]

JOBS.json is an ordered list of ``{"id": "<name>", "pdf": "<absolute path>", "pages": [1-based page numbers, optional]}``.
Each page is converted by Marker separately (batch size 1, ``fast`` mode, pictures off) and written to
``OUT_DIR/<id>/p<NNNN>.md`` (1-based page number) once, so the run can be stopped and started again at any time: finished
pages are skipped. A line per page goes to ``OUT_DIR/progress.jsonl`` (seconds, characters, peak resident size of the process
tree, lowest free memory). Exit codes: 0 = everything done, 10 = stopped after ``--max-pages`` (restart me, the helper
servers are restarted by the supervisor), 3 = free memory fell below the floor (wait, then restart), 4 = one page ran past
the time limit (it is recorded in ``OUT_DIR/failed.json`` after the second attempt and skipped).

Weights and caches stay inside ``data/build/marker-eval`` (see ``scripts/marker_convert.py``). Run it from the main checkout.
"""

import json
import os
import sys
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("MARKER_EVAL_HOME", "/Users/d/Projects/Personal/MiniMed/data/build/marker-eval"))
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

FLOOR_BYTES = 9 * 1024**3
PAGE_LIMIT_SECONDS = 700
STATE = {"peak_rss": 0, "min_avail": 1 << 62, "stop": False, "started": 0.0, "current": ""}
FAILED_PATH = Path()


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


def note_failure(label: str) -> None:
    failed = json.loads(FAILED_PATH.read_text()) if FAILED_PATH.exists() else {}
    failed[label] = failed.get(label, 0) + 1
    FAILED_PATH.write_text(json.dumps(failed, indent=1))


def watch() -> None:
    while not STATE["stop"]:
        avail = psutil.virtual_memory().available
        STATE["min_avail"] = min(STATE["min_avail"], avail)
        STATE["peak_rss"] = max(STATE["peak_rss"], tree_rss())
        if avail < FLOOR_BYTES:
            print(f"MEMORY: available {avail / 2**30:.1f} GiB is below the floor, stopping", flush=True)
            os._exit(3)
        if STATE["started"] and time.time() - STATE["started"] > PAGE_LIMIT_SECONDS:
            print(f"TIMEOUT on {STATE['current']}", flush=True)
            note_failure(STATE["current"])
            os._exit(4)
        time.sleep(1.0)


def main() -> None:
    global FAILED_PATH
    args = sys.argv[1:]
    max_pages = 10**9
    if "--max-pages" in args:
        i = args.index("--max-pages")
        max_pages = int(args[i + 1])
        del args[i : i + 2]
    jobs_path, out_dir = args
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    FAILED_PATH = out / "failed.json"
    jobs = json.loads(Path(jobs_path).read_text())
    threading.Thread(target=watch, daemon=True).start()

    import pypdfium2
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    failed = json.loads(FAILED_PATH.read_text()) if FAILED_PATH.exists() else {}
    models = None
    done_now = 0
    for job in jobs:
        pdf = job["pdf"]
        document = pypdfium2.PdfDocument(pdf)
        count = len(document)
        document.close()
        pages = job.get("pages") or list(range(1, count + 1))
        target_dir = out / job["id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        for page in pages:
            target = target_dir / f"p{page:04d}.md"
            label = f"{job['id']}:{page}"
            if target.exists() or failed.get(label, 0) >= 2:
                continue
            if done_now >= max_pages:
                print("max pages reached", flush=True)
                os._exit(10)
            if models is None:
                models = create_model_dict()
            config = {
                "mode": "fast",
                "output_format": "markdown",
                "disable_tqdm": True,
                "paginate_output": False,
                "page_range": [page - 1],
                "extract_images": False,
            }
            STATE["peak_rss"] = 0
            STATE["current"] = label
            STATE["started"] = time.time()
            started = time.time()
            error = None
            text = ""
            try:
                text, _ext, _images = text_from_rendered(PdfConverter(artifact_dict=models, config=config)(pdf))
            except Exception as exc:  # recorded; the page is retried once on the next start
                error = repr(exc)
            STATE["started"] = 0.0
            seconds = time.time() - started
            record = {
                "id": job["id"],
                "page": page,
                "seconds": round(seconds, 1),
                "chars": len(text),
                "peakRssGiB": round(STATE["peak_rss"] / 2**30, 2),
                "minAvailGiB": round(STATE["min_avail"] / 2**30, 1),
                "error": error,
            }
            if error is None:
                tmp = target.with_suffix(".tmp")
                tmp.write_text(text)
                tmp.rename(target)
            else:
                note_failure(label)
            with open(out / "progress.jsonl", "a") as log:
                log.write(json.dumps(record, ensure_ascii=False) + "\n")
            print(json.dumps(record, ensure_ascii=False), flush=True)
            done_now += 1
    STATE["stop"] = True
    os._exit(0)


if __name__ == "__main__":
    main()
