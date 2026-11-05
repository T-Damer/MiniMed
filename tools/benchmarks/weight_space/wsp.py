"""Directional-ablation ("weight-space programming", exp. 8 style) probe on Vikhr Qwen 2.5 0.5B.

Rebuilds the tester-box contract prompts from packages/tester-box/reports/latest.json, generates
greedily in PyTorch, measures looping, and projects a "looping" direction out of MLP outputs.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "packages/tester-box"))
import tester_box as tb

# Weights and run outputs stay outside Git (gitignored cache or a scratch directory).
WSP = Path(os.environ.get("WSP_DIR", REPO / ".cache/weight-space"))
MODEL_DIR = WSP / "model"
MODEL_ID = "vikhr-qwen2.5-0.5b-q4"
NGRAM = 6
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def load():
    tok = AutoTokenizer.from_pretrained(MODEL_DIR)
    model = AutoModelForCausalLM.from_pretrained(MODEL_DIR, dtype=torch.float32).to(
        DEVICE
    )
    model.eval()
    return tok, model


def cases() -> list[dict]:
    report = json.loads((REPO / "packages/tester-box/reports/latest.json").read_text())
    meta = {
        c["id"]: c
        for c in json.loads((REPO / "packages/tester-box/cases.json").read_text())
    }
    out = []
    for run in report["runs"]:
        if run["model_id"] != MODEL_ID or run["strategy"] != "contract":
            continue
        evidence = [tb.Evidence(**e) for e in run["evidence"]]
        system, prompt = tb.prompt_for(run["query"], evidence, True)
        out.append(
            {
                "id": run["case_id"],
                "system": system,
                "prompt": prompt,
                "evidence": evidence,
                "conflictTerms": list(meta[run["case_id"]]["conflictTerms"]),
                "expectedStatuses": list(meta[run["case_id"]]["expectedStatuses"]),
            }
        )
    return out


def input_ids(tok, system: str, prompt: str) -> torch.Tensor:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    ids = tok.apply_chat_template(
        messages, add_generation_prompt=True, return_tensors="pt"
    )
    if not isinstance(ids, torch.Tensor):
        ids = ids["input_ids"]
    return ids.to(DEVICE)


@torch.no_grad()
def generate(tok, model, system: str, prompt: str, max_new: int = 384):
    ids = input_ids(tok, system, prompt)
    out = model.generate(
        ids,
        max_new_tokens=max_new,
        do_sample=False,
        pad_token_id=tok.eos_token_id,
    )
    new = out[0, ids.shape[1] :].tolist()
    hit_limit = len(new) >= max_new and new[-1] not in (
        tok.eos_token_id,
        *tok.all_special_ids,
    )
    return tok.decode(new, skip_special_tokens=True), new, ids, hit_limit


def loop_positions(tokens: list[int], n: int = NGRAM) -> list[bool]:
    """True where the n-gram ending at this token already occurred earlier in the generation."""
    seen: set[tuple[int, ...]] = set()
    flags = []
    for i in range(len(tokens)):
        if i + 1 < n:
            flags.append(False)
            continue
        gram = tuple(tokens[i + 1 - n : i + 1])
        flags.append(gram in seen)
        seen.add(gram)
    return flags


def repetition(tokens: list[int], n: int = NGRAM) -> float:
    flags = loop_positions(tokens, n)
    return sum(flags) / max(1, len(flags))


def evaluate(
    tok, model, items: list[dict], repair: bool = True, label: str = ""
) -> list[dict]:
    rows = []
    for item in items:
        started = time.perf_counter()
        answer, new, _, hit = generate(tok, model, item["system"], item["prompt"])
        first = {
            "answer": answer,
            "tokens": len(new),
            "hit_limit": hit,
            "rep": repetition(new),
        }
        parsed = tb.extract_json(answer)
        errors = tb.validate_contract(parsed, item["evidence"], item["conflictTerms"])
        attempts = 1
        if errors and repair:
            retry = (
                f"{item['prompt']}\n\nОШИБКИ ПРЕДЫДУЩЕГО ОТВЕТА:\n"
                f"{'; '.join(errors)[:600]}\n\n"
                "Исправь ответ. Верни только полный JSON-объект."
            )
            answer, new, _, hit = generate(tok, model, item["system"], retry)
            parsed = tb.extract_json(answer)
            errors = tb.validate_contract(
                parsed, item["evidence"], item["conflictTerms"]
            )
            attempts = 2
        status = parsed.get("status") if parsed else None
        rows.append(
            {
                "id": item["id"],
                "first": first,
                "final_answer": answer,
                "final_rep": repetition(new),
                "final_hit_limit": hit,
                "json": parsed is not None,
                "valid": not errors,
                "expected_status": status in item["expectedStatuses"],
                "errors": errors[:3],
                "attempts": attempts,
                "seconds": round(time.perf_counter() - started, 1),
            }
        )
        r = rows[-1]
        print(
            f"{label} {item['id'][:26]:26} rep={r['first']['rep']:.2f} "
            f"limit={int(r['first']['hit_limit'])} json={int(r['json'])} valid={int(r['valid'])} "
            f"{r['seconds']}s",
            flush=True,
        )
    return rows


def summary(rows: list[dict]) -> dict:
    n = len(rows)
    return {
        "n": n,
        "first_looping": sum(r["first"]["rep"] >= 0.2 for r in rows),
        "first_hit_limit": sum(r["first"]["hit_limit"] for r in rows),
        "first_mean_rep": round(sum(r["first"]["rep"] for r in rows) / n, 3),
        "json": sum(r["json"] for r in rows),
        "valid": sum(r["valid"] for r in rows),
        "expected_status": sum(r["expected_status"] for r in rows),
    }


@torch.no_grad()
def hidden_means(
    tok, model, items: list[dict], generations: dict[str, list[int]], n: int = NGRAM
):
    """Mean residual stream after each layer at looping vs pre-loop generated positions."""
    layers = model.config.num_hidden_layers
    sums = {
        k: torch.zeros(layers + 1, model.config.hidden_size, device=DEVICE)
        for k in ("loop", "ok")
    }
    counts = {"loop": 0, "ok": 0}
    for item in items:
        new = generations[item["id"]]
        flags = loop_positions(new, n)
        if not new:
            continue
        ids = input_ids(tok, item["system"], item["prompt"])
        full = torch.cat([ids, torch.tensor([new], device=DEVICE)], dim=1)
        hs = model(
            full, output_hidden_states=True
        ).hidden_states  # (layers+1) x [1, T, H]
        start = ids.shape[1]
        onset = next((i for i, f in enumerate(flags) if f), len(flags))
        # Predict-side positions: the state at token i decides token i+1, so label by the next token.
        loop_idx = [start + i - 1 for i in range(1, len(new)) if flags[i]]
        ok_idx = [start + i - 1 for i in range(1, onset)]
        stack = torch.stack([h[0] for h in hs])  # [L+1, T, H]
        if loop_idx:
            sums["loop"] += stack[:, loop_idx].sum(1)
            counts["loop"] += len(loop_idx)
        if ok_idx:
            sums["ok"] += stack[:, ok_idx].sum(1)
            counts["ok"] += len(ok_idx)
    mean_loop = sums["loop"] / max(1, counts["loop"])
    mean_ok = sums["ok"] / max(1, counts["ok"])
    return mean_loop, mean_ok, counts


@torch.no_grad()
def ablate(model, direction: torch.Tensor, layers: list[int]) -> int:
    """Project `direction` out of the MLP output (down_proj) columns of `layers`. Returns weights changed."""
    r = direction / direction.norm()
    changed = 0
    for layer in layers:
        w = model.model.layers[layer].mlp.down_proj.weight  # [hidden, intermediate]
        w -= torch.outer(r, r @ w)
        changed += w.numel()
    return changed


@torch.no_grad()
def nll(tok, model, texts: list[str]) -> float:
    total, count = 0.0, 0
    for text in texts:
        ids = tok(text, return_tensors="pt").input_ids[:, :512].to(DEVICE)
        loss = model(ids, labels=ids).loss
        total += loss.item() * (ids.shape[1] - 1)
        count += ids.shape[1] - 1
    return total / count
