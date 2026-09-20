#!/usr/bin/env python3
"""Opt-in CPU relevance classifier. Download once, then use offline JSONL stdin.

No HTTP service, hosted inference, generated medical text or model weights in Git.
Default observe mode returns the original order alongside an experimental order.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time
from typing import Any, Callable
import urllib.request

MODEL_ID = "ARGA100/ru-reranker-modernbert-small"
REVISION = "8d4ea05d7c793bc812879ca18e7e310ac4cb228f"
FILES = ("config.json", "tokenizer.json", "tokenizer_config.json", "model.safetensors", "README.md")
MAX_REQUEST_BYTES = 1_000_000
MAX_CANDIDATES = 40
MAX_QUERY_CHARS = 2048
MAX_TEXT_CHARS = 4000


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare(destination: Path) -> None:
    """Explicit, public, pinned download; never called by inference or tests."""
    if destination.exists():
        verify(destination)
        print(json.dumps({"status": "already-present", "revision": REVISION}))
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".reranker-", dir=destination.parent))
    try:
        records = {}
        for name in FILES:
            url = f"https://huggingface.co/{MODEL_ID}/resolve/{REVISION}/{name}"
            request = urllib.request.Request(url, headers={"User-Agent": "MiniMed-local-research/1"})
            with urllib.request.urlopen(request, timeout=120) as response, (stage / name).open("wb") as output:
                size = 0
                while block := response.read(1024 * 1024):
                    size += len(block)
                    if size > 200_000_000:
                        raise ValueError("Model asset exceeds download bound")
                    output.write(block)
            if size == 0:
                raise ValueError("Empty model asset")
            records[name] = {"sha256": file_hash(stage / name), "bytes": size}
        manifest = {"schemaVersion": 1, "modelId": MODEL_ID, "revision": REVISION,
                    "declaredLicense": "mit", "files": records}
        (stage / "minimed-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        verify(stage)
        stage.rename(destination)
        print(json.dumps({"status": "downloaded", "revision": REVISION,
                          "bytes": sum(row["bytes"] for row in records.values())}))
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def verify(directory: Path) -> dict[str, Any]:
    manifest = json.loads((directory / "minimed-manifest.json").read_text())
    if (manifest.get("schemaVersion") != 1 or manifest.get("modelId") != MODEL_ID
            or manifest.get("revision") != REVISION or set(manifest.get("files", {})) != set(FILES)):
        raise ValueError("Unexpected local model manifest")
    for name in FILES:
        path = directory / name
        record = manifest["files"][name]
        if (path.is_symlink() or not path.is_file() or path.stat().st_size != record["bytes"]
                or file_hash(path) != record["sha256"]):
            raise ValueError("Local model asset checksum mismatch")
    return manifest


def disable_network() -> None:
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      TOKENIZERS_PARALLELISM="false", HF_HUB_DISABLE_TELEMETRY="1")
    def audit(event: str, _args: tuple[Any, ...]) -> None:
        if event in {"socket.connect", "socket.connect_ex", "socket.getaddrinfo", "socket.sendto"}:
            raise RuntimeError("Network disabled during local inference")
    sys.addaudithook(audit)


def validate_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) - {"query", "analysisMode", "candidates"}:
        raise ValueError("Invalid request fields")
    query = value.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_CHARS:
        raise ValueError("Invalid query length")
    mode = value.get("analysisMode", "clinical")
    if mode not in {"clinical", "lookup"}:
        raise ValueError("Invalid analysis mode")
    candidates = value.get("candidates")
    if not isinstance(candidates, list) or len(candidates) > MAX_CANDIDATES:
        raise ValueError("Invalid candidate count")
    seen: set[str] = set()
    clean = []
    for candidate in candidates:
        if not isinstance(candidate, dict) or set(candidate) - {"id", "text", "strictIdentity"}:
            raise ValueError("Invalid candidate fields")
        identity, text = candidate.get("id"), candidate.get("text")
        strict = candidate.get("strictIdentity", False)
        if (not isinstance(identity, str) or not identity or len(identity) > 512 or identity in seen
                or not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT_CHARS
                or type(strict) is not bool):
            raise ValueError("Invalid candidate or duplicate identifier")
        seen.add(identity)
        clean.append({"id": identity, "text": text, "strictIdentity": strict})
    return {"query": query, "analysisMode": mode, "candidates": clean}


def rank(request: dict[str, Any], score: Callable[[list[tuple[str, str]]], list[float]],
         *, apply: bool = False) -> dict[str, Any]:
    request = validate_request(request)
    candidates = request["candidates"]
    original = [row["id"] for row in candidates]
    response = {"schemaVersion": 1, "orderedIds": original, "experimentalIds": original,
                "applied": False, "scoreMeaning": "relevance only; not diagnosis probability"}
    if request["analysisMode"] == "lookup" or any(row["strictIdentity"] for row in candidates):
        return {**response, "status": "identity-bypass", "inferenceMs": 0.0}
    if len(candidates) < 2:
        return {**response, "status": "insufficient-candidates", "inferenceMs": 0.0}
    started = time.perf_counter()
    try:
        # Only natural language reaches the classifier. IDs, gold labels and previous scores do not.
        scores = score([(request["query"], row["text"]) for row in candidates])
        if len(scores) != len(candidates) or any(type(x) not in (int, float) or not math.isfinite(x) for x in scores):
            raise ValueError("Invalid model scores")
        indices = sorted(range(len(candidates)), key=lambda index: (-scores[index], index))
        proposed = [original[index] for index in indices]
        return {**response, "orderedIds": proposed if apply else original, "experimentalIds": proposed,
                "applied": apply, "status": "experimental" if apply else "observe",
                "scores": [{"id": row["id"], "score": value} for row, value in zip(candidates, scores, strict=True)],
                "inferenceMs": (time.perf_counter() - started) * 1000}
    except Exception as exc:
        # Surface failure without logging query/evidence, and preserve the exact original order.
        return {**response, "status": "fallback", "errorCode": type(exc).__name__,
                "inferenceMs": (time.perf_counter() - started) * 1000}


class CpuScorer:
    def __init__(self, directory: Path, threads: int = 2) -> None:
        verify(directory)
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        torch.set_num_threads(threads)
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(str(directory), local_files_only=True,
                                                        trust_remote_code=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            str(directory), local_files_only=True, trust_remote_code=False,
            use_safetensors=True, attn_implementation="eager")
        if self.model.config.num_labels != 1:
            raise ValueError("Expected a scalar relevance classifier")
        self.model.to("cpu").eval()

    def __call__(self, pairs: list[tuple[str, str]]) -> list[float]:
        result = []
        for start in range(0, len(pairs), 8):
            batch = pairs[start:start + 8]
            inputs = self.tokenizer([x[0] for x in batch], [x[1] for x in batch],
                                    padding=True, truncation=True, max_length=512, return_tensors="pt")
            with self.torch.inference_mode():
                logits = self.model(**inputs).logits.reshape(-1).float().tolist()
            result.extend(logits)
        return result


def serve(directory: Path, *, apply: bool, threads: int) -> None:
    disable_network()
    scorer: CpuScorer | None = None
    load_error: str | None = None
    def score(pairs: list[tuple[str, str]]) -> list[float]:
        nonlocal scorer, load_error
        if load_error is not None:
            raise RuntimeError("Local model unavailable")
        if scorer is None:
            try:
                scorer = CpuScorer(directory, threads)
            except Exception as exc:
                load_error = type(exc).__name__
                raise
        return scorer(pairs)
    while True:
        raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 1)
        if not raw:
            break
        if len(raw) > MAX_REQUEST_BYTES:
            print('{"schemaVersion":1,"status":"invalid-request","errorCode":"TooLarge"}', flush=True)
            break
        try:
            response = rank(json.loads(raw), score, apply=apply)
            response["modelRevision"] = REVISION
            response["networkDisabled"] = True
            if load_error:
                response["modelLoadError"] = load_error
        except (ValueError, TypeError, KeyError) as exc:
            response = {"schemaVersion": 1, "status": "invalid-request", "errorCode": type(exc).__name__}
        print(json.dumps(response, ensure_ascii=False, allow_nan=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "serve"))
    parser.add_argument("--model-dir", type=Path, default=Path(".cache/minimed/ru-reranker"))
    parser.add_argument("--experimental-apply", action="store_true")
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.threads <= 8:
        parser.error("--threads must be between 1 and 8")
    if args.command == "prepare":
        prepare(args.model_dir)
    else:
        serve(args.model_dir, apply=args.experimental_apply, threads=args.threads)


if __name__ == "__main__":
    main()
