"""Second round: direction from long verbatim repeats (16-grams), selection by the contract validator."""

import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
import wsp

RUNS = wsp.WSP / "runs"
N = 16
tok, model = wsp.load()
items = wsp.cases()
train = items[0::2]
generations = json.loads((RUNS / "baseline-generations.json").read_text())
mean_loop, mean_ok, counts = wsp.hidden_means(tok, model, train, generations, n=N)
print("positions", counts, flush=True)
diff = mean_loop - mean_ok
torch.save({"diff": diff.cpu(), "counts": counts, "n": N}, RUNS / "directions16.pt")
original = {
    i: layer.mlp.down_proj.weight.detach().clone()
    for i, layer in enumerate(model.model.layers)
}


def restore():
    with torch.no_grad():
        for i, layer in enumerate(model.model.layers):
            layer.mlp.down_proj.weight.copy_(original[i])


def score(label):
    rows = []
    for item in train:
        answer, new, _, hit = wsp.generate(tok, model, item["system"], item["prompt"])
        parsed = wsp.tb.extract_json(answer)
        errors = wsp.tb.validate_contract(
            parsed, item["evidence"], item["conflictTerms"]
        )
        status = parsed.get("status") if parsed else None
        rows.append(
            {
                "rep16": wsp.repetition(new, N),
                "hit": hit,
                "json": parsed is not None,
                "valid": not errors,
                "status_ok": status
                in (
                    "answer",
                    "needs_clarification",
                    "insufficient_evidence",
                    "conflict",
                ),
            }
        )
    s = {
        "label": label,
        "mean_rep16": round(sum(r["rep16"] for r in rows) / len(rows), 3),
    }
    for key in ("hit", "json", "valid", "status_ok"):
        s[key] = sum(r[key] for r in rows)
    s["looping16"] = sum(r["rep16"] >= 0.1 for r in rows)
    print(s, flush=True)
    return s


results = [score("baseline")]
L = model.config.num_hidden_layers
configs = [
    (16, list(range(L))),
    (16, list(range(8, 20))),
    (12, list(range(4, 16))),
    (20, list(range(12, 24))),
    (16, [14, 15]),
]
for k, layers in configs:
    restore()
    wsp.ablate(model, diff[k], layers)
    results.append(
        score(f"dir16@{k} -> mlp{layers[0]}..{layers[-1]}") | {"k": k, "layers": layers}
    )
(RUNS / "search2.json").write_text(json.dumps(results, indent=1))
